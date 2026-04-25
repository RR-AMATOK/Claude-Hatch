/**
 * LogTail TokenSignalSource adapter (architecture §7.3)
 *
 * Tails ~/.claude/projects/**\/*.jsonl files and emits TokenDelta records as
 * new assistant messages appear.
 *
 * # Cursor strategy: byte offset per session file
 *
 * Each session file gets a cursor stored as a byte offset (number) in
 * `${GLYPHLING_HOME}/signal-state/tokens.json`, keyed by the absolute file
 * path. Alternative considered: last-seen `message.id` (string). Byte offset
 * wins because:
 *   - No need to track the entire message graph; position in the file
 *     unambiguously identifies how much we have already consumed.
 *   - Works even if the upstream format never includes a stable message ID.
 *   - Survives log-file growth; the chokidar "change" event tells us the file
 *     grew, and we read from the stored offset forward.
 *   - Tradeoff: if a session file is truncated or rotated, a stale offset
 *     > file size causes us to skip processing; we detect this and reset the
 *     cursor to 0 (treating it as a fresh file).
 *
 * # Start-at-tail semantic (Bug A fix)
 *
 * On first encounter of a transcript file (no cursor entry in the map), we
 * stat the file and set the cursor to the current file size, then emit ZERO
 * deltas. This is the standard log-tail "start at tail" semantic: historical
 * content in files that existed before glyphling was installed is not counted.
 * Only bytes appended AFTER the first observation are eligible for XP.
 *
 * Edge case: a file currently being written when first observed may have
 * bytes appended between stat and the next chokidar `change` event. Those
 * bytes are not counted — this is acceptable. The alternative (reading from
 * 0 on first-open) would count up to 10 GB of historical transcript data
 * and award billions of phantom XP (confirmed live incident, 2026-04-24).
 *
 * # Token field extraction (Bug B fix)
 *
 * Claude Code transcript lines are JSONL objects. An assistant message line
 * has this shape (confirmed from live transcripts):
 *
 *   {
 *     "type": "assistant",
 *     "message": {
 *       "usage": {
 *         "input_tokens": number,
 *         "output_tokens": number,
 *         "cache_creation_input_tokens": number,   // NOT counted
 *         "cache_read_input_tokens": number         // NOT counted
 *       }
 *     }
 *   }
 *
 * We count ONLY `input_tokens + output_tokens` for XP purposes.
 * `cache_creation_input_tokens` and `cache_read_input_tokens` are excluded
 * because they reflect re-reading prior context, not new work the user did.
 * In a long Claude Code conversation each prompt re-reads the cached context
 * (200K tokens × 50 turns = 10M cache_read tokens for one session), which
 * would dwarf real work tokens and award orders-of-magnitude too much XP.
 * Missing fields default to 0. Non-assistant-type lines are skipped.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import type { TokenDelta, TokenSignalSource, AdapterHealth } from "./adapter.js";
import type { ISO8601 } from "../../state/schema.js";

// ---------------------------------------------------------------------------
// Cursor state persisted between runs
// ---------------------------------------------------------------------------

/**
 * Map from absolute JSONL file path → byte offset of last-processed byte.
 * Persisted to ${GLYPHLING_HOME}/signal-state/tokens.json.
 */
type CursorMap = Record<string, number>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Override the projects dir for testing. Set GLYPHLING_PROJECTS_DIR to a
 * controlled tmp directory in tests (same env var used by persistence.ts).
 */
function projectsDir(): string {
  const override = process.env["GLYPHLING_PROJECTS_DIR"];
  if (override && override.length > 0) return override;
  return path.join(os.homedir(), ".claude", "projects");
}

// ---------------------------------------------------------------------------
// LogTailTokenSignalSource
// ---------------------------------------------------------------------------

export class LogTailTokenSignalSource implements TokenSignalSource {
  readonly name = "logtail";

  private readonly cursorFile: string;
  private watcher: FSWatcher | null = null;
  private started = false;

  // In-memory cursor cache. Loaded lazily on first access (or via start()).
  // Holding cursors in memory eliminates a read-modify-write race that the
  // disk-only path had: when chokidar fires `add` for hundreds of files
  // concurrently on startup, two processFile calls would each loadCursors
  // → modify their key → saveCursors, with the later write overwriting the
  // earlier one's update for a different key. The fix is to keep authoritative
  // state in memory and serialize disk flushes (see flushChain below).
  private cursorsInMem: CursorMap | null = null;
  private flushChain: Promise<unknown> = Promise.resolve();

  /**
   * @param signalStateDir Path to ${GLYPHLING_HOME}/signal-state/ (for cursor persistence).
   */
  constructor(private readonly signalStateDir: string) {
    this.cursorFile = path.join(signalStateDir, "tokens.json");
  }

  /**
   * Start watching ~/.claude/projects/**\/*.jsonl for new assistant messages.
   *
   * Returns a stop function. Calling the stop function closes the watcher and
   * flushes cursor state.
   */
  start(onDelta: (delta: TokenDelta) => void): () => Promise<void> {
    if (this.started) {
      throw new Error("[logtail] start() called more than once");
    }
    this.started = true;

    const projDir = projectsDir();

    // chokidar v4+ behaviour required three changes vs. its v3 defaults:
    //   1. Glob patterns are gone — pass the bare directory and filter
    //      `.jsonl` in the handler. Auto-picks-up new project subdirs.
    //   2. Default recursion depth is shallow — pass `depth: 99` so all
    //      `~/.claude/projects/<encoded-cwd>/<session>.jsonl` files are
    //      reached.
    //   3. `awaitWriteFinish` would suppress initial scan adds for files
    //      that aren't currently being written, which is exactly what we
    //      need on startup. Dropped — the cursor mechanism in
    //      processFile() already handles repeated notifications
    //      idempotently (only reads from saved offset forward).
    //   4. The previous `ignored: /(^|[/\\])\../` dotfile guard matched
    //      ANY path component starting with `.` including `.claude`
    //      itself — so the watched root was self-ignored. Dropped; the
    //      `.jsonl` filter below is sufficient.
    this.watcher = chokidarWatch(projDir, {
      persistent: true,
      ignoreInitial: false, // process existing files on startup to catch up
      depth: 99,
    });

    // Handle new files and changes identically: read from cursor forward.
    // Filter to .jsonl here since the watcher binds to the whole directory.
    const handleFile = (filePath: string) => {
      if (!filePath.endsWith(".jsonl")) return;
      void this.processFile(filePath, onDelta);
    };

    this.watcher.on("add", handleFile);
    this.watcher.on("change", handleFile);

    // Non-fatal: log errors but don't crash
    this.watcher.on("error", (err) => {
      process.stderr.write(`[glyphling/logtail] chokidar error: ${String(err)}\n`);
    });

    return async () => {
      if (this.watcher) {
        await this.watcher.close();
        this.watcher = null;
      }
    };
  }

  async health(): Promise<AdapterHealth> {
    const projDir = projectsDir();
    try {
      await fs.promises.access(projDir);
      return {
        ok: true,
        mode: "logtail",
        detail: `Tailing ${projDir}/**/*.jsonl`,
      };
    } catch {
      return {
        ok: false,
        mode: "logtail",
        detail: `Projects directory not found: ${projDir}`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: process one file from its cursor forward
  // Exposed as a public method so tests can drive file processing directly
  // without relying on chokidar timing (which is unreliable on iCloud mounts).
  // ---------------------------------------------------------------------------

  async processFile(
    filePath: string,
    onDelta: (delta: TokenDelta) => void
  ): Promise<void> {
    // Use the in-memory cache; load from disk on first access.
    const cursors = await this.getCursors();

    // Get current file size
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return; // File gone between watcher event and now
    }

    // Start-at-tail: on first encounter (no cursor entry), set cursor to the
    // current file size and emit nothing. This prevents re-counting historical
    // transcripts that existed before glyphling was installed.
    if (!(filePath in cursors)) {
      cursors[filePath] = stat.size;
      await this.queueFlush();
      return;
    }

    const savedOffset = cursors[filePath]!;

    // If file shrunk (truncated/rotated), reset cursor to 0
    const startOffset = savedOffset > stat.size ? 0 : savedOffset;

    if (startOffset >= stat.size) {
      return; // Nothing new to read
    }

    // Read from startOffset to end
    const buffer = Buffer.allocUnsafe(stat.size - startOffset);
    let fd: fs.promises.FileHandle | null = null;
    try {
      fd = await fs.promises.open(filePath, "r");
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, startOffset);
      if (bytesRead === 0) return;

      const text = buffer.subarray(0, bytesRead).toString("utf8");
      const newOffset = startOffset + Buffer.byteLength(text, "utf8");

      // Parse lines
      const lines = text.split("\n");
      let totalTokens = 0;
      let latestTs: ISO8601 | null = null;
      let model: string | undefined;
      let sessionId: string | undefined;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        const delta = parseTranscriptLine(trimmed);
        if (delta === null) continue;

        totalTokens += delta.tokens;
        latestTs = delta.ts;
        if (delta.model) model = delta.model;
        if (delta.session) sessionId = delta.session;
      }

      // Update cursor in memory; queue a serialized flush to disk.
      cursors[filePath] = newOffset;
      await this.queueFlush();

      // Emit delta if we found any tokens
      if (totalTokens > 0 && latestTs !== null) {
        const delta: TokenDelta = { ts: latestTs, tokens: totalTokens };
        if (model !== undefined) delta.model = model;
        if (sessionId !== undefined) delta.session = sessionId;
        onDelta(delta);
      }
    } finally {
      await fd?.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: cursor persistence
  // ---------------------------------------------------------------------------

  private async loadCursors(): Promise<CursorMap> {
    try {
      const raw = await fs.promises.readFile(this.cursorFile, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Validate: all values must be non-negative numbers
        const map: CursorMap = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "number" && v >= 0) {
            map[k] = v;
          }
        }
        return map;
      }
    } catch {
      // Missing or corrupt — start fresh
    }
    return {};
  }

  /**
   * Lazily load cursors from disk into the in-memory cache. Returns the
   * cache reference — callers may mutate it directly; mutations become
   * durable on the next queueFlush().
   */
  private async getCursors(): Promise<CursorMap> {
    if (this.cursorsInMem === null) {
      this.cursorsInMem = await this.loadCursors();
    }
    return this.cursorsInMem;
  }

  /**
   * Schedule a write of the current in-memory cursors to disk. Multiple
   * concurrent calls collapse into a serial chain — each flush writes the
   * latest snapshot, so coalescing is safe (later writes simply supersede
   * earlier ones with no data loss).
   */
  private queueFlush(): Promise<void> {
    const next = this.flushChain.then(() => this.flushNow());
    this.flushChain = next.catch(() => undefined);
    return next;
  }

  /**
   * Atomic write: tmp file with a unique random suffix, then rename onto
   * the canonical cursor file. Unique tmp avoids the rename-source-ENOENT
   * race the previous shared-tmp-name implementation had under concurrency.
   */
  private async flushNow(): Promise<void> {
    if (this.cursorsInMem === null) return;
    const snapshot = { ...this.cursorsInMem };
    await fs.promises.mkdir(this.signalStateDir, { recursive: true, mode: 0o700 });
    const tmp =
      this.cursorFile +
      ".tmp." +
      process.pid +
      "." +
      Math.random().toString(36).slice(2);
    try {
      await fs.promises.writeFile(tmp, JSON.stringify(snapshot, null, 2) + "\n", {
        encoding: "utf8",
        mode: 0o600,
      });
      await fs.promises.rename(tmp, this.cursorFile);
    } finally {
      try {
        await fs.promises.unlink(tmp);
      } catch {
        // Rename succeeded (tmp gone) or never written — fine.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Transcript line parser
// ---------------------------------------------------------------------------

/**
 * Extract token usage from a single JSONL line.
 * Returns null if the line is not an assistant message with usage data.
 *
 * Expected shape (confirmed from live ~/.claude/projects/**\/*.jsonl):
 * {
 *   "type": "assistant",
 *   "message": {
 *     "id": "msg_...",
 *     "model": "claude-...",
 *     "usage": {
 *       "input_tokens": number,
 *       "output_tokens": number,
 *       "cache_creation_input_tokens": number,   // intentionally excluded (see Bug B)
 *       "cache_read_input_tokens": number         // intentionally excluded (see Bug B)
 *     }
 *   },
 *   "timestamp": "2026-...",
 *   "sessionId": "..."
 * }
 *
 * XP counts ONLY `input_tokens + output_tokens`. Cache fields are excluded
 * because `cache_read_input_tokens` reflects re-reading prior context, not
 * new work — a long session can accumulate 10M+ cached tokens vs. ~50K real
 * tokens, awarding orders of magnitude too much XP if included.
 */
export function parseTranscriptLine(
  line: string
): { tokens: number; ts: ISO8601; model?: string; session?: string } | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }

  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return null;

  const rec = obj as Record<string, unknown>;

  // Must be an assistant message
  if (rec["type"] !== "assistant") return null;

  const msg = rec["message"];
  if (msg === null || typeof msg !== "object" || Array.isArray(msg)) return null;

  const msgRec = msg as Record<string, unknown>;
  const usage = msgRec["usage"];
  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) return null;

  const u = usage as Record<string, unknown>;

  // Count only input + output tokens. Cache tokens excluded — see function comment.
  const inputTokens = typeof u["input_tokens"] === "number" ? u["input_tokens"] : 0;
  const outputTokens = typeof u["output_tokens"] === "number" ? u["output_tokens"] : 0;

  const tokens = inputTokens + outputTokens;
  if (tokens <= 0) return null;

  // Timestamp: prefer the top-level timestamp field
  const ts =
    typeof rec["timestamp"] === "string"
      ? rec["timestamp"]
      : new Date().toISOString();

  const model =
    typeof msgRec["model"] === "string" ? msgRec["model"] : undefined;

  const session =
    typeof rec["sessionId"] === "string" ? rec["sessionId"] : undefined;

  const result: { tokens: number; ts: ISO8601; model?: string; session?: string } = { tokens, ts };
  if (model !== undefined) result.model = model;
  if (session !== undefined) result.session = session;
  return result;
}
