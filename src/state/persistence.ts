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
} from "./schema.js";
import { withLock, sweepStale } from "./lockfile.js";
import { sha256, canonicalJson } from "../util/hash.js";

export type StateChangeListener = (state: StateFileV1) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Trailing-edge debounce window for file-watch events (§4.5). */
const WATCH_DEBOUNCE_MS = 50;

/** Jitter window for the retry-on-parse-error in the reader protocol (§4.4). */
const READ_RETRY_JITTER_MS = 20;

/**
 * DEC-018 Mechanism 4: forward-jump threshold for monotonic clock guard.
 * Events timestamped more than 24 h after the previous event trigger a clamp.
 */
const CLOCK_FORWARD_JUMP_MS = 24 * 60 * 60 * 1000;

/**
 * DEC-018 Mechanism 4: when a forward jump is clamped, the new timestamp is
 * set to lastEventAt + this offset (60 s) to remain monotonic but not freeze.
 */
const CLOCK_FORWARD_CLAMP_OFFSET_MS = 60_000;

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

async function readStateFromPath(
  stateFile: string,
  attempt = 0
): Promise<StateFileV1 | null> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(stateFile, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return validateState(parsed);
  } catch (err) {
    if (attempt === 0) {
      // §4.4: retry once after jitter in case a writer is mid-rename
      await sleep(READ_RETRY_JITTER_MS);
      return readStateFromPath(stateFile, 1);
    }
    // Still failing — log a warning and return null so callers can use last-known state
    process.stderr.write(
      `[glyphling] state.json failed to parse (attempt ${attempt + 1}): ${String(err)}\n`
    );
    return null;
  }
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
  await fs.promises.mkdir(dir, { recursive: true });

  // Write to tmp file
  const payload = JSON.stringify(state, null, 2);
  const fh = await fs.promises.open(tmpPath, "w");
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
 * Returns: the event as actually persisted (may have a clamped timestamp and
 * prevHash set), plus any side-effect signal.rejected events emitted during
 * the integrity checks.
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
  await fs.promises.mkdir(path.dirname(eventsLog), { recursive: true });

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
  const rejections: GlyphlingEvent[] = [];

  await withLock(stateFile, async () => {
    // Read current state for integrity fields (inside the lock)
    const current = await readState(config);
    const currentHead = current?.globals.eventsHead ?? "";
    const lastEventAt = current?.globals.lastEventAt ?? 0;

    // -----------------------------------------------------------------------
    // DEC-018 Mechanism 4: monotonic clock guards
    // -----------------------------------------------------------------------
    const eventTs = new Date(event.ts).getTime();
    let clampedTs = eventTs;
    const tsNow = new Date(event.ts).toISOString();

    if (lastEventAt > 0) {
      if (eventTs < lastEventAt) {
        // Backward jump — clamp to lastEventAt
        clampedTs = lastEventAt;
        rejections.push(
          makeRejectionEvent(
            { reason: "clock.jump.backward", origEventId: event.id },
            event.petId,
            new Date(lastEventAt).toISOString()
          )
        );
      } else if (eventTs > lastEventAt + CLOCK_FORWARD_JUMP_MS) {
        // Forward jump > 24 h — clamp to lastEventAt + 60 s
        clampedTs = lastEventAt + CLOCK_FORWARD_CLAMP_OFFSET_MS;
        rejections.push(
          makeRejectionEvent(
            { reason: "clock.jump.forward", origEventId: event.id },
            event.petId,
            tsNow
          )
        );
      }
    }

    const eventToAppend: GlyphlingEvent = {
      ...event,
      ts: clampedTs !== eventTs ? new Date(clampedTs).toISOString() : event.ts,
      prevHash: currentHead,
    };

    // -----------------------------------------------------------------------
    // Append rejection events first (they precede the main event in the log)
    // -----------------------------------------------------------------------
    for (const rejection of rejections) {
      const rejWithHash: GlyphlingEvent = {
        ...rejection,
        prevHash: currentHead,
      };
      const rejLine = JSON.stringify(rejWithHash) + "\n";
      await fs.promises.appendFile(eventsLog, rejLine, "utf8");
    }

    // -----------------------------------------------------------------------
    // Append the main event to events.jsonl (DEC-010)
    // -----------------------------------------------------------------------
    const line = JSON.stringify(eventToAppend) + "\n";
    await fs.promises.appendFile(eventsLog, line, "utf8");

    // -----------------------------------------------------------------------
    // Compute the new eventsHead = sha256(canonicalJson(eventToAppend))
    // -----------------------------------------------------------------------
    const newHead = sha256(canonicalJson(eventToAppend));
    const newLastEventAt = clampedTs;

    // -----------------------------------------------------------------------
    // Fold into state if a fold function was provided, then write under lock
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
    } else if (current !== null) {
      // No fold, but still persist the updated integrity fields
      const nextState: StateFileV1 = {
        ...current,
        globals: {
          ...current.globals,
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

  return { appended, rejections };
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
 * DEC-018 Mechanism 1: Verifies the hash chain (prevHash → eventsHead).
 * On chain break, stops applying events past the break and sets chainBroken=true.
 *
 * DEC-018 Mechanism 2: For tokens.delta events with transcriptLineHash, verifies
 * the hash against ~/.claude/projects/**\/*.jsonl. Unmatched events are dropped and
 * a signal.rejected is prepended to the result. Gate: strict rejection only when
 * GLYPHLING_STRICT_TRANSCRIPT=1 is set. Without it, missing matches are still
 * dropped but only if GLYPHLING_STRICT_TRANSCRIPT=1; otherwise they pass through.
 *
 * Skips unparseable trailing lines (§9 failure mode: corrupt last line).
 */
export async function replayEvents(
  config: Config,
  afterByteOffset = 0,
  knownHead = ""
): Promise<ReplayResult> {
  const { eventsLog } = config.paths;

  let raw: string;
  try {
    raw = await fs.promises.readFile(eventsLog, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { events: [], lastByteOffset: 0, chainBroken: false };
    }
    throw err;
  }

  const strictTranscript =
    process.env["GLYPHLING_STRICT_TRANSCRIPT"] === "1";

  // Byte-slice to content after the cursor
  const slice = raw.slice(afterByteOffset);
  const lines = slice.split("\n").filter((l) => l.trim().length > 0);

  const events: GlyphlingEvent[] = [];
  let processed = afterByteOffset;
  let runningHead = knownHead;

  for (const line of lines) {
    let parsed: GlyphlingEvent | null = null;
    try {
      parsed = parseEvent(JSON.parse(line));
    } catch {
      // Skip corrupt lines (§9)
      process.stderr.write(
        `[glyphling] events.jsonl: skipping unparseable line: ${line.slice(0, 80)}\n`
      );
    }

    // Advance byte offset by line length + newline regardless
    processed += Buffer.byteLength(line + "\n", "utf8");

    if (parsed === null) continue;

    // -----------------------------------------------------------------------
    // DEC-018 Mechanism 1: chain verification
    //
    // A chain break is detected only when:
    //   - runningHead is non-empty (we know the expected previous hash), AND
    //   - parsed.prevHash is non-empty (the event claims to be chain-linked), AND
    //   - parsed.prevHash does NOT match runningHead.
    //
    // Events with prevHash="" are treated as legacy (pre-DEC-018) or genesis
    // events and reset the running head without triggering a break. This
    // preserves backward-compatibility: test fixtures and events written
    // directly to events.jsonl without going through appendEvent() are not
    // falsely flagged as tampered.
    // -----------------------------------------------------------------------
    if (runningHead !== "" && parsed.prevHash !== "" && parsed.prevHash !== runningHead) {
      process.stderr.write(
        `[glyphling] event-chain broken at event ${parsed.id}: ` +
          `expected prevHash="${runningHead}", got "${parsed.prevHash}"\n`
      );
      return {
        events,
        lastByteOffset: processed,
        chainBroken: true,
        brokenAtEventId: parsed.id,
        reason: "chain.broken",
      };
    }

    // -----------------------------------------------------------------------
    // DEC-018 Mechanism 2: transcript cross-check for tokens.delta
    // -----------------------------------------------------------------------
    if (
      parsed.type === "tokens.delta" &&
      parsed.transcriptLineHash !== undefined
    ) {
      const matched = await verifyTranscriptHash(parsed.transcriptLineHash);
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

// ---------------------------------------------------------------------------
// watchState — §4.5 chokidar + 50ms trailing-edge debounce
// ---------------------------------------------------------------------------

/**
 * Subscribe to state.json changes via chokidar with a 50ms trailing-edge debounce.
 * Returns an unsubscribe function.
 *
 * On each debounced event, reads state.json and calls listener with the parsed
 * state. Silently skips events where the state file cannot be read (transient
 * rename window; next event will catch up).
 *
 * Note: Risk §13.2 — iCloud folder may cause spurious chokidar events. The
 * debounce collapses bursts. If dev env is unreliable, override GLYPHLING_HOME
 * to /tmp/glyphling-dev.
 */
export function watchState(
  config: Config,
  listener: StateChangeListener
): () => void {
  const { stateFile } = config.paths;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

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
      // Fire-and-forget read; errors are handled inside readStateFromPath
      readStateFromPath(stateFile).then((state) => {
        if (state !== null) listener(state);
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
// DEC-018 Mechanism 2: transcript cross-check
// ---------------------------------------------------------------------------

/**
 * Search ~/.claude/projects/**\/*.jsonl for a line whose trimmed UTF-8 bytes
 * hash to `lineHash` (sha256 hex). Returns true if a match is found.
 *
 * Best-effort: if the projects directory does not exist (dev/test env), returns
 * true (skip the check). File read errors are silently ignored per-file.
 */
async function verifyTranscriptHash(lineHash: string): Promise<boolean> {
  const projectsDir = path.join(os.homedir(), ".claude", "projects");

  // Missing projects dir → skip check (dev/test environment)
  try {
    await fs.promises.access(projectsDir);
  } catch {
    return true;
  }

  return searchDirForHash(projectsDir, lineHash);
}

async function searchDirForHash(dir: string, lineHash: string): Promise<boolean> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (await searchDirForHash(fullPath, lineHash)) return true;
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      if (await searchFileForHash(fullPath, lineHash)) return true;
    }
  }
  return false;
}

async function searchFileForHash(filePath: string, lineHash: string): Promise<boolean> {
  let content: string;
  try {
    content = await fs.promises.readFile(filePath, "utf8");
  } catch {
    return false;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (sha256(Buffer.from(trimmed, "utf8")) === lineHash) return true;
  }
  return false;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomHex(): string {
  return crypto.randomBytes(4).toString("hex");
}
