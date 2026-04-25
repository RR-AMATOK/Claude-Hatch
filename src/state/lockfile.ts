/**
 * Lockfile — Module #6 (architecture §2.2)
 *
 * Wraps `proper-lockfile@4.1.2` (DEC-013) with the exact acquire/release/
 * recovery protocol specified in architecture §4.3.
 *
 * proper-lockfile already implements:
 *   - O_EXCL atomic create
 *   - heartbeat-based stale detection (configurable `stale` + `update` intervals)
 *   - exponential retry on contention (via the `retry` option)
 *   - cross-platform (macOS, Linux, Windows)
 *
 * We add:
 *   - withLock(fn) convenience wrapper (§12.2: "no bare acquire/release in product code")
 *   - sweepStale(home) for crash recovery on boot (§4.3 crash-mid-write handling)
 *   - LockTimeoutError typed exception with holder diagnostics (§4.3 step 5)
 */

import fs from "fs";
import path from "path";
import lockfile from "proper-lockfile";

// ---------------------------------------------------------------------------
// Constants (§4.3)
// ---------------------------------------------------------------------------

/** Maximum time to wait for the lock before throwing. */
const DEFAULT_TIMEOUT_MS = 5_000;

/** How often proper-lockfile refreshes the heartbeat timestamp. */
const HEARTBEAT_INTERVAL_MS = 1_000;

/** Age threshold for treating a lock as stale (5× heartbeat per §4.3). */
const STALE_MS = 5_000;

/** Initial backoff before first retry (ms). proper-lockfile handles the curve. */
const INITIAL_RETRY_DELAY_MS = 50;

/** Cap on retry delay to prevent very long individual sleeps. */
const MAX_RETRY_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class LockTimeoutError extends Error {
  constructor(
    public readonly lockPath: string,
    public readonly elapsedMs: number
  ) {
    super(
      `[glyphling] Could not acquire lock at "${lockPath}" within ${elapsedMs}ms. ` +
        `Another process may be holding it. ` +
        `If glyphling crashed, restart it — the stale lock will be swept automatically.`
    );
    this.name = "LockTimeoutError";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the proper-lockfile options object.
 * proper-lockfile's `retry` option maps to the `retry` npm package options.
 */
function lockOptions(timeoutMs: number): Parameters<typeof lockfile.lock>[1] {
  // Number of retries: heuristic — allow retries until timeoutMs is consumed.
  // Each attempt sleeps INITIAL_RETRY_DELAY_MS * 2^n, capped at MAX_RETRY_DELAY_MS.
  const retries = Math.ceil(
    Math.log2(timeoutMs / INITIAL_RETRY_DELAY_MS + 1) + 2
  );

  return {
    stale: STALE_MS,
    update: HEARTBEAT_INTERVAL_MS,
    retries: {
      retries,
      minTimeout: INITIAL_RETRY_DELAY_MS,
      maxTimeout: MAX_RETRY_DELAY_MS,
      factor: 2,
      randomize: true, // jitter ±20% equivalent
    },
    realpath: false, // we pass absolute paths ourselves
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Acquire the lockfile for the given resource path.
 * proper-lockfile locks `path + ".lock"` by convention; the caller passes
 * the resource path (e.g. `state.json`), NOT the `.lock` path.
 *
 * Returns a release function. Prefer `withLock` over bare acquire/release.
 */
export async function acquire(
  resourcePath: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<() => Promise<void>> {
  // Ensure the resource file exists — proper-lockfile requires the target file
  // to exist before it can lock it.
  await ensureFileExists(resourcePath);

  const start = Date.now();
  let releaseFn: (() => Promise<void>) | undefined;

  try {
    releaseFn = await lockfile.lock(resourcePath, lockOptions(timeoutMs));
  } catch (err) {
    const elapsed = Date.now() - start;
    // proper-lockfile throws ELOCKED when all retries are exhausted
    if (
      err instanceof Error &&
      (err.message.includes("ELOCKED") ||
        err.message.includes("already being held") ||
        elapsed >= timeoutMs)
    ) {
      throw new LockTimeoutError(resourcePath, elapsed);
    }
    throw err;
  }

  return releaseFn;
}

/**
 * Release a previously acquired lock. Idempotent — safe to call multiple times.
 * Prefer `withLock` over bare acquire/release in product code (§12.2).
 */
export async function release(releaseFn: () => Promise<void>): Promise<void> {
  try {
    await releaseFn();
  } catch {
    // Already released or stale — swallow silently (idempotent contract)
  }
}

/**
 * Run fn while holding the lockfile for resourcePath.
 * Acquires before fn, releases in a finally block regardless of outcome.
 * This is the recommended write path (§12.2).
 */
export async function withLock<T>(
  resourcePath: string,
  fn: () => Promise<T>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const releaseFn = await acquire(resourcePath, timeoutMs);
  try {
    return await fn();
  } finally {
    await release(releaseFn);
  }
}

/**
 * Crash-recovery sweep, called on startup (§4.3 crash-mid-write handling).
 *
 * Removes stale `.tmp.*` files in `stateHome` older than STALE_MS.
 * proper-lockfile handles stale lock recovery automatically on the next lock
 * attempt, so we only need to sweep the tmp staging files here.
 */
export async function sweepStale(stateHome: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(stateHome);
  } catch {
    // Directory doesn't exist yet on first boot — nothing to sweep
    return;
  }

  const now = Date.now();
  const sweepPromises: Promise<void>[] = [];

  for (const entry of entries) {
    // Match state.json.tmp.<pid>.<rand> pattern (§4.2)
    if (!entry.startsWith("state.json.tmp.")) continue;

    const fullPath = path.join(stateHome, entry);
    sweepPromises.push(
      (async () => {
        try {
          const stat = await fs.promises.stat(fullPath);
          const ageMs = now - stat.mtimeMs;
          if (ageMs > STALE_MS) {
            await fs.promises.unlink(fullPath);
          }
        } catch {
          // File already gone or not accessible — skip
        }
      })()
    );
  }

  await Promise.all(sweepPromises);
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

/**
 * Ensure a file exists so proper-lockfile can lock it.
 * Creates an empty file if it does not exist. Creates parent dirs as needed.
 * SEC-009: stateHome dir is created with mode 0o700; lock file with 0o600.
 */
async function ensureFileExists(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });

  try {
    // O_WRONLY | O_CREAT — create if missing, otherwise no-op. Mode 0o600 (SEC-009).
    const fh = await fs.promises.open(filePath, "a", 0o600);
    await fh.close();
  } catch {
    // Already exists — fine
  }
}
