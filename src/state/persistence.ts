/**
 * StatePersistence — Module #5 (architecture §2.2)
 *
 * Implements the full §4 protocol:
 *   - readState()    — §4.4 reader protocol (no lock, retry on parse error)
 *   - writeState()   — §4.3 writer: acquire → validate → tmp → fsync → rename → release
 *   - appendEvent()  — DEC-010 primary write path: events.jsonl first, then fold into state
 *   - replayEvents() — DEC-010/DEC-018: chain-verified replay with optional transcript check
 *   - watchState()   — §4.5 chokidar + 50ms trailing-edge debounce
 *
 * DEC-018 integrity mechanisms (all four, landing together):
 *   1. Event-chain hashing  — prevHash chain maintained in appendEvent; verified in replayEvents
 *   2. Transcript cross-check — tokens.delta with transcriptLineHash verified against JSONL files
 *   3. Monotonic clock guards — appendEvent clamps timestamps; emits signal.rejected on jumps
 *   4. (Daily XP caps are enforced in xp/engine.ts, not here)
 */

import crypto from "crypto";
import fs from "fs";
import readline from "readline";
import os from "os";
import path from "path";
import { watch as chokidarWatch } from "chokidar";
import { ulid } from "ulid";
import type { Config } from "../config/env.js";
import {
  validateState,
  parseEvent,
  type StateFileV1,
  type GlyphlingEvent,
  type SignalRejectedPayload,
  type DaemonResyncPayload,
} from "./schema.js";
import { withLock, sweepStale } from "./lockfile.js";
import { sha256, canonicalJson } from "../util/hash.js";
import { safeForLog } from "../util/lang.js";

export type StateChangeListener = (state: StateFileV1) => void;

/**
 * TODO-038: Payload emitted to the optional onError callback in watchState()
 * when a file-watch event triggers a parse/validation failure.
 *
 * `kind` discriminates this from the DEC-018 chain-break warning so the
 * renderer can display a different banner or combine them without confusion.
 */
export interface WatchValidationError {
  kind: "validation";
  /** One-line human-readable reason (first Zod issue message, ≤60 chars). */
  reason: string;
  /** ms epoch when the bad write was first detected in this retry window. */
  rejectedAt: number;
  /** Number of retry attempts made (0 = first failure, max 1 per §4.4). */
  retryCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Trailing-edge debounce window for file-watch events (§4.5). */
const WATCH_DEBOUNCE_MS = 50;

/** Jitter window for the retry-on-parse-error in the reader protocol (§4.4). */
const READ_RETRY_JITTER_MS = 20;

/**
 * DEC-022: forward-jump threshold for monotonic clock guard.
 * Events timestamped more than 24 h after the previous event trigger a
 * daemon.resync event; the incoming event's timestamp is accepted as-is
 * (no clamping). The backward-clamp path is unaffected.
 */
const CLOCK_FORWARD_JUMP_MS = 24 * 60 * 60 * 1000;

// SEC-003: File size caps to prevent unbounded reads / OOM.
const MAX_STATE_BYTES = 5 * 1024 * 1024;        // 5 MB
const MAX_EVENTS_BYTES = 100 * 1024 * 1024;     // 100 MB
const MAX_TRANSCRIPT_BYTES = 50 * 1024 * 1024;  // 50 MB per transcript file
const MAX_PROJECTS_RECURSE_DEPTH = 8;

// ---------------------------------------------------------------------------
// readState — §4.4 reader protocol
// ---------------------------------------------------------------------------

/**
 * Read and validate state.json from disk.
 * Returns null if the file does not exist (first-run).
 * On parse error, retries once after a 20ms jitter; falls back to null.
 */
export async function readState(
  config: Config
): Promise<StateFileV1 | null> {
  return readStateFromPath(config.paths.stateFile);
}

/**
 * Result type for the watcher variant of readStateFromPath.
 * Carries either the valid parsed state or a structured error reason.
 */
interface ReadStateResult {
  state: StateFileV1 | null;
  /** Non-null only when a parse/validation error was the terminal reason. */
  parseError: string | null;
}

async function readStateFromPath(
  stateFile: string,
  attempt = 0
): Promise<StateFileV1 | null> {
  return (await readStateFromPathFull(stateFile, attempt)).state;
}

async function readStateFromPathFull(
  stateFile: string,
  attempt = 0
): Promise<ReadStateResult> {
  // SEC-003: stat first; refuse if too large
  try {
    const stat = await fs.promises.stat(stateFile);
    if (stat.size > MAX_STATE_BYTES) {
      process.stderr.write(
        `[glyphling] state.json exceeds size limit (${stat.size} bytes > ${MAX_STATE_BYTES}); refusing to load\n`
      );
      return { state: null, parseError: null };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { state: null, parseError: null };
    throw err;
  }

  let raw: string;
  try {
    raw = await fs.promises.readFile(stateFile, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { state: null, parseError: null };
    throw err;
  }

  // Empty file = same semantics as missing (first-run race or interrupted truncate).
  if (raw.length === 0) return { state: null, parseError: null };

  try {
    const parsed: unknown = JSON.parse(raw);
    const state = validateState(parsed);
    return { state, parseError: null };
  } catch (err) {
    if (attempt === 0) {
      // §4.4: retry once after jitter in case a writer is mid-rename
      await sleep(READ_RETRY_JITTER_MS);
      return readStateFromPathFull(stateFile, 1);
    }
    // Still failing — extract a short reason from the error
    const reason = extractParseReason(err);
    // TODO-038: stderr is suppressed here; the caller (watchState) logs once
    // after all retries to avoid 3× duplication.
    return { state: null, parseError: reason };
  }
}

/**
 * TODO-038: Extract a short ≤60-char reason string from a parse/Zod error.
 * Used to populate WatchValidationError.reason.
 */
function extractParseReason(err: unknown): string {
  if (err instanceof Error) {
    // Zod errors have a `.issues` array; use the first issue's message.
    const zodErr = err as Error & { issues?: Array<{ message: string; path?: unknown[] }> };
    if (Array.isArray(zodErr.issues) && zodErr.issues.length > 0) {
      const first = zodErr.issues[0]!;
      const pathStr = Array.isArray(first.path) && first.path.length > 0
        ? first.path.join(".") + ": "
        : "";
      return (pathStr + first.message).slice(0, 60);
    }
    return err.message.slice(0, 60);
  }
  return String(err).slice(0, 60);
}

// ---------------------------------------------------------------------------
// writeState — §4.3 writer protocol
// ---------------------------------------------------------------------------

/**
 * Atomically write state to disk:
 *   acquire lock → validate → write tmp → fsync → rename → fsync dir → release
 */
export async function writeState(
  config: Config,
  state: StateFileV1
): Promise<void> {
  // Validate before acquiring the lock so we fail fast on bad input
  validateState(state);

  const { stateFile } = config.paths;

  await withLock(stateFile, async () => {
    await writeStateUnderLock(config, state);
  });
}

/**
 * Internal: perform the tmp→fsync→rename write sequence.
 * MUST be called while the stateFile lock is already held by the caller.
 * Not exported — use writeState() or call from within a withLock block.
 */
async function writeStateUnderLock(
  config: Config,
  state: StateFileV1
): Promise<void> {
  const { stateFile } = config.paths;
  const tmpPath = path.join(
    config.stateHome,
    `state.json.tmp.${process.pid}.${randomHex()}`
  );

  const dir = path.dirname(stateFile);
  // SEC-009: stateHome dir created with mode 0o700
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });

  // Write to tmp file
  const payload = JSON.stringify(state, null, 2);
  // SEC-009: open tmp file with mode 0o600 (owner read/write only)
  const fh = await fs.promises.open(tmpPath, "w", 0o600);
  try {
    await fh.write(payload);
    // fsync the tmp file before rename (§4.3 step 4)
    await fh.sync();
  } finally {
    await fh.close();
  }

  // Atomic rename tmp → state.json (§4.3 step 5)
  await fs.promises.rename(tmpPath, stateFile);

  // Best-effort fsync the directory (§4.3 step 6; skipped on Windows)
  if (process.platform !== "win32") {
    try {
      const dirFh = await fs.promises.open(dir, "r");
      await dirFh.sync().catch(() => undefined);
      await dirFh.close();
    } catch {
      // Non-fatal
    }
  }
}

// ---------------------------------------------------------------------------
// appendEvent — DEC-010 primary write path + DEC-018 integrity
// ---------------------------------------------------------------------------

/**
 * The canonical mutation path (DEC-010 + DEC-018):
 *   1. Read current state to get eventsHead and lastEventAt.
 *   2. DEC-018 Mechanism 4: enforce monotonic clock (clamp backward jumps;
 *      clamp large forward jumps; emit signal.rejected on either).
 *   3. DEC-018 Mechanism 1: set event.prevHash = state.globals.eventsHead.
 *   4. Append event to events.jsonl.
 *   5. Compute new eventsHead = sha256(canonicalJson(event)).
 *   6. Update state.globals.eventsHead + lastEventAt, fold event, persist.
 *
 * Returns: the event as actually persisted (prevHash set), plus any side-effect
 * events (signal.rejected or daemon.resync) emitted during the integrity checks.
 *
 * `fold` is a caller-supplied function that applies the event to the current
 * state and returns the mutated state. If `fold` is omitted, only the event
 * is appended (useful for collectors that don't touch state directly).
 */
export async function appendEvent(
  config: Config,
  event: GlyphlingEvent,
  fold?: (currentState: StateFileV1, event: GlyphlingEvent) => StateFileV1
): Promise<{ appended: GlyphlingEvent; rejections: GlyphlingEvent[] }> {
  const { eventsLog, stateFile } = config.paths;

  // Ensure parent directory exists before acquiring lock
  // SEC-009: create with mode 0o700
  await fs.promises.mkdir(path.dirname(eventsLog), { recursive: true, mode: 0o700 });

  // -------------------------------------------------------------------------
  // Hold the state lock for the ENTIRE read-compute-append-write sequence.
  //
  // BUG-002 fix: previously readState() ran OUTSIDE the lock window, so two
  // concurrent callers could both read the same eventsHead and produce events
  // with identical prevHash values, breaking the DEC-018 hash chain.
  //
  // Now: acquire once → read current head inside the lock → compute new event
  // → append to JSONL → write updated state → release. All under one lock.
  // -------------------------------------------------------------------------
  let appended!: GlyphlingEvent;
  // sideEffects holds daemon.resync and signal.rejected events that are
  // prepended to the log before the main event. Returned as `rejections`
  // for backwards-compatible callers.
  const sideEffects: GlyphlingEvent[] = [];

  await withLock(stateFile, async () => {
    // Read current state for integrity fields (inside the lock)
    const current = await readState(config);
    const currentHead = current?.globals.eventsHead ?? "";
    const lastEventAt = current?.globals.lastEventAt ?? 0;

    // -----------------------------------------------------------------------
    // DEC-022 / DEC-018 Mechanism 4: monotonic clock guards
    // -----------------------------------------------------------------------
    const eventTs = new Date(event.ts).getTime();
    let clampedTs = eventTs;
    const tsNow = new Date(event.ts).toISOString();

    if (lastEventAt > 0) {
      if (eventTs < lastEventAt) {
        // Backward jump — clamp to lastEventAt; emit signal.rejected
        clampedTs = lastEventAt;
        sideEffects.push(
          makeRejectionEvent(
            { reason: "clock.jump.backward", origEventId: event.id },
            event.petId,
            new Date(lastEventAt).toISOString()
          )
        );
      } else if (eventTs > lastEventAt + CLOCK_FORWARD_JUMP_MS) {
        // Forward jump > 24 h — DEC-022: emit daemon.resync; accept ts as-is
        sideEffects.push(
          makeDaemonResyncEvent(
            {
              from: new Date(lastEventAt).toISOString(),
              to: tsNow,
              gapMs: eventTs - lastEventAt,
              reason: "forward-gap-exceeded-threshold",
            },
            tsNow
          )
        );
        // clampedTs stays = eventTs (no clamping)
      }
    }

    // -----------------------------------------------------------------------
    // Append side-effect events first (they precede the main event in the log).
    // Each side-effect is chained off the previous hash so the full sequence
    // forms a valid chain: currentHead → sideEffect[0] → ... → mainEvent.
    // -----------------------------------------------------------------------
    let chainHead = currentHead;
    for (const sideEffect of sideEffects) {
      const seWithHash: GlyphlingEvent = {
        ...sideEffect,
        prevHash: chainHead,
      };
      const seLine = JSON.stringify(seWithHash) + "\n";
      // SEC-009: appendFile with mode 0o600
      await fs.promises.appendFile(eventsLog, seLine, { encoding: "utf8", mode: 0o600 });
      // Advance the running head so the next event in the sequence chains off this one
      chainHead = sha256(canonicalJson(seWithHash));
    }

    const eventToAppend: GlyphlingEvent = {
      ...event,
      ts: clampedTs !== eventTs ? new Date(clampedTs).toISOString() : event.ts,
      prevHash: chainHead,
    };

    // -----------------------------------------------------------------------
    // Append the main event to events.jsonl (DEC-010)
    // Partial appendFile after SIGKILL produces an unparseable trailing line;
    // the next replay flags chainBroken (acceptable per security audit SEC-015).
    // -----------------------------------------------------------------------
    const line = JSON.stringify(eventToAppend) + "\n";
    // SEC-009: appendFile with mode 0o600
    await fs.promises.appendFile(eventsLog, line, { encoding: "utf8", mode: 0o600 });

    // -----------------------------------------------------------------------
    // Compute the new eventsHead = sha256(canonicalJson(eventToAppend))
    // -----------------------------------------------------------------------
    const newHead = sha256(canonicalJson(eventToAppend));
    const newLastEventAt = clampedTs;

    // -----------------------------------------------------------------------
    // Fold into state if a fold function was provided, then write under lock.
    // Always persist eventsHead (even when current === null) so consecutive
    // appendEvent calls without an initial writeState still chain correctly.
    // -----------------------------------------------------------------------
    if (fold) {
      const stateForFold = current ?? makeMinimalState();
      const folded = fold(stateForFold, eventToAppend);
      const nextState: StateFileV1 = {
        ...folded,
        globals: {
          ...folded.globals,
          eventsHead: newHead,
          lastEventAt: newLastEventAt,
        },
      };
      validateState(nextState);
      await writeStateUnderLock(config, nextState);
    } else {
      // No fold: persist the updated integrity fields, creating minimal state if needed
      const base = current ?? makeMinimalState();
      const nextState: StateFileV1 = {
        ...base,
        globals: {
          ...base.globals,
          eventsHead: newHead,
          lastEventAt: newLastEventAt,
        },
        updatedAt: new Date().toISOString(),
      };
      validateState(nextState);
      await writeStateUnderLock(config, nextState);
    }

    appended = eventToAppend;
  });

  return { appended, rejections: sideEffects };
}

// ---------------------------------------------------------------------------
// replayEvents — DEC-010 cold-start recovery + DEC-018 chain verification
// ---------------------------------------------------------------------------

/**
 * DEC-018 result type for replayEvents.
 *
 * When the chain is intact: `{ ok: true, events, lastByteOffset, chainBroken: false }`.
 * When a break is detected: `{ ok: true, events, lastByteOffset, chainBroken: true,
 *   brokenAtEventId, reason }`. Events past the break are NOT included.
 */
export interface ReplayResult {
  /** Events successfully replayed (stops at break if chain is broken). */
  events: GlyphlingEvent[];
  /** Byte offset of the last processed line (for cursor update). */
  lastByteOffset: number;
  /** True if a hash-chain break was detected. */
  chainBroken: boolean;
  /** ULID of the event at which the chain break was detected (if chainBroken). */
  brokenAtEventId?: string;
  /** Human-readable reason for the break. */
  reason?: string;
}

/**
 * Read events.jsonl and return all events after `afterByteOffset`.
 *
 * SEC-003: Stat first; refuse if > MAX_EVENTS_BYTES. Streams via readline
 * to avoid loading the entire file into memory.
 *
 * DEC-018 Mechanism 1: Verifies the hash chain (prevHash → eventsHead).
 * SEC-002: Genesis is allowed only at the very first event (runningHead === "").
 * Once a chain is established, ANY event with missing or mismatching prevHash
 * is a chain break — prevHash="" no longer bypasses the check.
 *
 * DEC-018 Mechanism 2: For tokens.delta events with transcriptLineHash, verifies
 * the hash against ~/.claude/projects/**\/*.jsonl. SEC-003: Hashes are collected
 * once per replay run (not re-walked per event) for O(1) lookup.
 *
 * Skips unparseable trailing lines (§9 failure mode: corrupt last line).
 */
export async function replayEvents(
  config: Config,
  afterByteOffset = 0,
  knownHead = ""
): Promise<ReplayResult> {
  const { eventsLog } = config.paths;

  // SEC-003: stat first; refuse if > MAX_EVENTS_BYTES
  let fileSize: number;
  try {
    const stat = await fs.promises.stat(eventsLog);
    fileSize = stat.size;
    if (fileSize > MAX_EVENTS_BYTES) {
      process.stderr.write(
        `[glyphling] events.jsonl exceeds size limit (${fileSize} bytes > ${MAX_EVENTS_BYTES}); refusing to replay\n`
      );
      return { events: [], lastByteOffset: afterByteOffset, chainBroken: false };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { events: [], lastByteOffset: 0, chainBroken: false };
    }
    throw err;
  }

  // Nothing new since the cursor — short-circuit before opening the file
  if (afterByteOffset >= fileSize) {
    return { events: [], lastByteOffset: afterByteOffset, chainBroken: false };
  }

  const strictTranscript =
    process.env["GLYPHLING_STRICT_TRANSCRIPT"] === "1";

  // SEC-003: Transcript hash cache is built lazily — only when we encounter a
  // tokens.delta event with a transcriptLineHash. Once built, it covers all
  // remaining events in this replay run (O(1) lookup, not O(N * dir-scan).
  let transcriptHashCache: Set<string> | null | undefined = undefined;

  // SEC-003: Stream via readline to avoid holding the full file in memory.
  // The size check above ensures we won't OOM on files under MAX_EVENTS_BYTES.
  const rawLines = await readLinesFromOffset(eventsLog, afterByteOffset);

  const events: GlyphlingEvent[] = [];
  let processed = afterByteOffset;
  let runningHead = knownHead;

  for (const line of rawLines) {
    // Skip blank lines
    if (line.trim().length === 0) {
      processed += Buffer.byteLength(line + "\n", "utf8");
      continue;
    }

    let parsed: GlyphlingEvent | null = null;
    try {
      parsed = parseEvent(JSON.parse(line));
    } catch {
      // Skip corrupt lines (§9)
      process.stderr.write(
        `[glyphling] events.jsonl: skipping unparseable line: ${safeForLog(line.slice(0, 80))}\n`
      );
    }

    // Advance byte offset by line length + newline regardless
    processed += Buffer.byteLength(line + "\n", "utf8");

    if (parsed === null) continue;

    // -----------------------------------------------------------------------
    // DEC-018 Mechanism 1: chain verification (SEC-002 fix)
    //
    // Genesis is allowed only at the very first event (runningHead === "").
    // Once a chain is established, ANY event with missing or mismatching
    // prevHash is a break — prevHash="" no longer bypasses the check.
    // -----------------------------------------------------------------------
    if (runningHead !== "" && parsed.prevHash !== runningHead) {
      process.stderr.write(
        `[glyphling] event-chain broken at event ${safeForLog(parsed.id)}: ` +
          `expected prevHash=${safeForLog(runningHead)}, got ${safeForLog(parsed.prevHash)}\n`
      );
      return {
        events,
        lastByteOffset: processed,
        chainBroken: true,
        brokenAtEventId: parsed.id,
        reason: parsed.prevHash === "" ? "chain.broken.missing-prev" : "chain.broken",
      };
    }

    // -----------------------------------------------------------------------
    // DEC-018 Mechanism 2: transcript cross-check for tokens.delta
    // -----------------------------------------------------------------------
    if (
      parsed.type === "tokens.delta" &&
      parsed.transcriptLineHash !== undefined
    ) {
      // SEC-003: Build cache lazily on first tokens.delta event with a hash.
      // This avoids scanning ~/.claude/projects/ when no transcript events exist.
      if (transcriptHashCache === undefined) {
        transcriptHashCache = await buildTranscriptHashCache();
      }
      // O(1) lookup: null cache means projects dir is absent → pass-through
      const matched =
        transcriptHashCache === null ||
        transcriptHashCache.has(parsed.transcriptLineHash);
      if (!matched) {
        if (strictTranscript) {
          // In strict mode: drop the event; it doesn't count toward the chain
          const rejection = makeRejectionEvent(
            {
              reason: "transcript.missing",
              origEventId: parsed.id,
            },
            parsed.petId,
            parsed.ts
          );
          events.push(rejection);
          // Update runningHead to include this event (it was in the log)
          runningHead = sha256(canonicalJson(parsed));
          continue;
        }
        // Non-strict mode: emit rejection but still apply the event
        const rejection = makeRejectionEvent(
          {
            reason: "transcript.missing",
            origEventId: parsed.id,
          },
          parsed.petId,
          parsed.ts
        );
        events.push(rejection);
      }
    }

    events.push(parsed);
    // Advance the running head regardless of transcript check result
    runningHead = sha256(canonicalJson(parsed));
  }

  return { events, lastByteOffset: processed, chainBroken: false };
}

/**
 * Read all lines from a file starting at `startByte` via readline streaming.
 * Returns an array of raw line strings (without newlines).
 * SEC-003: streams the file so we don't hold it fully in memory at once.
 */
function readLinesFromOffset(
  filePath: string,
  startByte: number
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const stream = fs.createReadStream(filePath, {
      start: startByte,
      encoding: "utf8",
    });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on("line", (line) => {
      lines.push(line);
    });

    rl.on("close", () => {
      resolve(lines);
    });

    rl.on("error", reject);
    stream.on("error", (err) => {
      // Only reject if readline hasn't already resolved
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// watchState — §4.5 chokidar + 50ms trailing-edge debounce
// ---------------------------------------------------------------------------

/**
 * Subscribe to state.json changes via chokidar with a 50ms trailing-edge debounce.
 * Returns an unsubscribe function.
 *
 * On each debounced event, reads state.json and calls listener with the parsed
 * state. When the read fails schema/parse validation, calls onError (if provided)
 * with a structured WatchValidationError — listener is NOT called.
 *
 * TODO-038 additions:
 *   - onError callback surfaces parse/validation failures to the store (and TUI).
 *   - stderr is emitted ONCE per unique error message per failure batch
 *     (not once per retry attempt) to prevent 2× duplication.
 *
 * Note: Risk §13.2 — iCloud folder may cause spurious chokidar events. The
 * debounce collapses bursts. If dev env is unreliable, override GLYPHLING_HOME
 * to /tmp/glyphling-dev.
 */
export function watchState(
  config: Config,
  listener: StateChangeListener,
  onError?: (err: WatchValidationError) => void
): () => void {
  const { stateFile } = config.paths;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // TODO-038: track the last stderr message we emitted to deduplicate.
  // Only log when the error message changes, so repeated failures on the same
  // bad write produce exactly one stderr line, not one per debounce tick.
  let lastLoggedError: string | null = null;

  // Track when the current failure batch started (for rejectedAt).
  let failureBatchStartMs: number | null = null;
  let retryCount = 0;

  const watcher = chokidarWatch(stateFile, {
    persistent: false,
    ignoreInitial: true,
    // Disable fsevents polling on iCloud mounts where it may be noisy
    usePolling: false,
    awaitWriteFinish: false,
  });

  const onEvent = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      // TODO-038: use readStateFromPathFull to get structured error info
      readStateFromPathFull(stateFile).then((result) => {
        if (result.state !== null) {
          // Successful read — reset failure tracking, call the success listener
          lastLoggedError = null;
          failureBatchStartMs = null;
          retryCount = 0;
          listener(result.state);
        } else if (result.parseError !== null) {
          // Parse/validation failure — surface to the store via onError,
          // and emit ONE stderr line (deduplicated by message content).
          const now = Date.now();
          if (failureBatchStartMs === null) {
            failureBatchStartMs = now;
            retryCount = 0;
          } else {
            retryCount += 1;
          }

          // Deduplicate stderr: only log when the message changes
          if (result.parseError !== lastLoggedError) {
            process.stderr.write(
              `[glyphling] state.json invalid (watcher rejected): ${result.parseError}\n`
            );
            lastLoggedError = result.parseError;
          }

          if (onError !== undefined) {
            onError({
              kind: "validation",
              reason: result.parseError,
              rejectedAt: failureBatchStartMs,
              retryCount,
            });
          }
        }
        // If result.state === null && result.parseError === null it means the
        // file was missing/empty/oversized — not a validation error; don't surface.
      }).catch(() => {
        // Unexpected I/O error — not a schema issue; silence it (next tick recovers)
      });
    }, WATCH_DEBOUNCE_MS);
  };

  watcher.on("change", onEvent);
  watcher.on("add", onEvent);

  return () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    void watcher.close();
  };
}

// ---------------------------------------------------------------------------
// Boot helper: crash recovery
// ---------------------------------------------------------------------------

/**
 * Run once at startup:
 *   1. Sweep stale tmp files in stateHome
 *   2. Check if state.json.updatedAt < events.jsonl last-line timestamp
 *      → if so, return the unsynced event count so the caller can trigger replay
 */
export async function checkRecoveryNeeded(config: Config): Promise<boolean> {
  await sweepStale(config.stateHome);

  const state = await readState(config);
  if (state === null) return false;

  const { eventsLog } = config.paths;
  let raw: string;
  try {
    raw = await fs.promises.readFile(eventsLog, "utf8");
  } catch {
    return false;
  }

  // Find the last non-empty line
  const lines = raw.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return false;

  const lastLine = lines[lines.length - 1]!;
  try {
    const lastEvent = parseEvent(JSON.parse(lastLine));
    if (lastEvent === null) return false;

    const stateUpdatedAt = new Date(state.updatedAt).getTime();
    const lastEventTs = new Date(lastEvent.ts).getTime();

    return lastEventTs > stateUpdatedAt;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// DEC-018 Mechanism 2: transcript cross-check (SEC-003 caching)
// ---------------------------------------------------------------------------

/**
 * Build a Set of all sha256 hashes found in ~/.claude/projects/**\/*.jsonl.
 * Called once per replayEvents run so we don't re-walk the tree per event.
 *
 * Returns null if the projects directory does not exist (dev/test environment),
 * indicating all checks should be skipped (pass-through).
 *
 * `GLYPHLING_PROJECTS_DIR` overrides the default location. Used by integration
 * tests to point the cache at a deterministic empty tmp dir, and by users
 * whose Claude Code data lives outside `~/.claude`.
 */
async function buildTranscriptHashCache(): Promise<Set<string> | null> {
  const override = process.env["GLYPHLING_PROJECTS_DIR"];
  const projectsDir =
    override && override.length > 0
      ? override
      : path.join(os.homedir(), ".claude", "projects");

  try {
    await fs.promises.access(projectsDir);
  } catch {
    // Missing projects dir → skip check (dev/test environment)
    return null;
  }

  const hashSet = new Set<string>();
  await collectHashesFromDir(projectsDir, hashSet, 0);
  return hashSet;
}

async function collectHashesFromDir(
  dir: string,
  hashSet: Set<string>,
  depth: number
): Promise<void> {
  // SEC-003: cap recursion depth
  if (depth > MAX_PROJECTS_RECURSE_DEPTH) return;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    // SEC-003: skip symlinks to prevent traversal of circular links
    if (entry.isSymbolicLink()) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectHashesFromDir(fullPath, hashSet, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      await collectHashesFromFile(fullPath, hashSet);
    }
  }
}

async function collectHashesFromFile(
  filePath: string,
  hashSet: Set<string>
): Promise<void> {
  // SEC-003: stat first; skip if > MAX_TRANSCRIPT_BYTES
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_TRANSCRIPT_BYTES) return;
  } catch {
    return;
  }

  let content: string;
  try {
    content = await fs.promises.readFile(filePath, "utf8");
  } catch {
    return;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    hashSet.add(sha256(Buffer.from(trimmed, "utf8")));
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build a minimal StateFileV1 for use when no state file exists yet. */
function makeMinimalState(): StateFileV1 {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    pets: [],
    globals: {
      activePetId: null,
      unlocks: {
        gifTier1: false,
        gifTier2: false,
        gifTier3: false,
        adoption: false,
      },
      eventsCursor: 0,
      eventsHead: "",
      lastEventAt: 0,
    },
  };
}

/**
 * Build a signal.rejected event.
 *
 * @param payload  The rejection payload (reason + optional fields).
 * @param petId    The pet ID to associate with the rejection (or null).
 * @param ts       ISO8601 timestamp for the event.
 */
function makeRejectionEvent(
  payload: SignalRejectedPayload,
  petId: string | null,
  ts: string
): GlyphlingEvent {
  return {
    id: ulid(),
    type: "signal.rejected",
    ts,
    petId,
    source: "persistence",
    payload,
    prevHash: "",
  };
}

/**
 * Build a daemon.resync event (DEC-022).
 *
 * Emitted when the incoming event's timestamp is more than 24 h ahead of
 * `globals.lastEventAt`. The resync event is prepended to the log before the
 * main event and re-anchors the clock anchor so subsequent events are accepted
 * at their real timestamps.
 *
 * @param payload  The resync payload (from/to/gapMs/reason).
 * @param ts       ISO8601 timestamp for the event (equals the incoming event's ts).
 */
function makeDaemonResyncEvent(
  payload: DaemonResyncPayload,
  ts: string
): GlyphlingEvent {
  return {
    id: ulid(),
    type: "daemon.resync",
    ts,
    petId: null,
    source: "daemon",
    payload,
    xpDelta: 0,
    prevHash: "",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomHex(): string {
  return crypto.randomBytes(4).toString("hex");
}
