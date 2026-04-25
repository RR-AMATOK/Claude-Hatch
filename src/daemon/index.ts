/**
 * Daemon entry point — `glyphling watch`
 *
 * Long-running process that:
 *   1. Acquires a daemon lockfile at ${GLYPHLING_HOME}/watch.lock via
 *      proper-lockfile. Refuses to start if another watcher holds it.
 *   2. Reads the active pet ID from state.json.
 *   3. Starts the LogTailTokenSignalSource + TokenCollector.
 *   4. Handles chokidar errors with exponential backoff (1s → 2s → 4s → 8s →
 *      16s → 30s capped). Restarts the source on error.
 *   5. Logs to ${GLYPHLING_HOME}/watch.log (rotates at 1 MB).
 *   6. SIGINT/SIGTERM → flush accumulated tokens, release lockfile, exit 0.
 *
 * The daemon lockfile is separate from the state.json lockfile. It uses
 * proper-lockfile directly (like the state lockfile), locking the file at
 * `watch.lock` (which we pre-create so proper-lockfile can lock it).
 */

import fs from "fs";
import path from "path";
import lockfile from "proper-lockfile";
import type { Config } from "../config/env.js";
import { readState } from "../state/persistence.js";
import { LogTailTokenSignalSource } from "../signals/tokens/logtail.js";
import { TokenCollector } from "../signals/tokens/collector.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Daemon lockfile name inside stateHome. */
const DAEMON_LOCK_FILENAME = "watch.lock";

/** Watch log filename inside stateHome. */
const WATCH_LOG_FILENAME = "watch.log";

/** Rotate watch.log when it exceeds this size. */
const LOG_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

/** Backoff schedule for chokidar error restarts (ms). */
const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

// ---------------------------------------------------------------------------
// Daemon log helpers
// ---------------------------------------------------------------------------

/**
 * Write a timestamped line to watch.log.
 * Rotates the log if it exceeds LOG_MAX_BYTES (rename to watch.log.1).
 */
async function daemonLog(logFile: string, level: "INFO" | "ERROR" | "WARN", msg: string): Promise<void> {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  // Also mirror to stderr so operators see daemon output
  process.stderr.write(line);

  try {
    // Rotate if needed
    let size = 0;
    try {
      const stat = await fs.promises.stat(logFile);
      size = stat.size;
    } catch {
      // File doesn't exist yet — size stays 0
    }

    if (size >= LOG_MAX_BYTES) {
      // Rotate: move to .1 (overwrite any existing .1)
      const rotated = logFile + ".1";
      try {
        await fs.promises.rename(logFile, rotated);
      } catch {
        // Non-fatal — log rotation failure shouldn't crash the daemon
      }
    }

    await fs.promises.appendFile(logFile, line, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Log write failure is non-fatal
  }
}

// ---------------------------------------------------------------------------
// Daemon lockfile helpers
// ---------------------------------------------------------------------------

async function acquireDaemonLock(lockFilePath: string): Promise<() => Promise<void>> {
  // Ensure the file exists (proper-lockfile requires target to exist)
  const dir = path.dirname(lockFilePath);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const fh = await fs.promises.open(lockFilePath, "a", 0o600);
  await fh.close();

  // Attempt to lock — do NOT retry on ELOCKED (second watcher should exit immediately)
  const release = await lockfile.lock(lockFilePath, {
    stale: 10_000,
    update: 2_000,
    retries: 0,
    realpath: false,
  });

  return async () => {
    try {
      await release();
    } catch {
      // Already released — safe to ignore
    }
  };
}

// ---------------------------------------------------------------------------
// Main daemon function
// ---------------------------------------------------------------------------

export async function runWatchDaemon(config: Config): Promise<number> {
  const lockFilePath = path.join(config.stateHome, DAEMON_LOCK_FILENAME);
  const logFile = path.join(config.stateHome, WATCH_LOG_FILENAME);
  const signalStateDir = path.join(config.stateHome, "signal-state");

  // Log startup
  await daemonLog(logFile, "INFO", `glyphling watch starting (pid=${process.pid})`);

  // Acquire daemon lockfile — exits non-zero if another watcher is running
  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await acquireDaemonLock(lockFilePath);
  } catch (err) {
    const msg =
      err instanceof Error && err.message.includes("ELOCKED")
        ? "Another glyphling watcher is already running. Exiting."
        : `Failed to acquire daemon lock: ${String(err)}`;
    process.stderr.write(`[glyphling/watch] ${msg}\n`);
    return 1;
  }

  await daemonLog(logFile, "INFO", "Daemon lock acquired");

  // Read active pet ID from state
  let petId: string | null = null;
  try {
    const state = await readState(config);
    petId = state?.globals.activePetId ?? null;
    await daemonLog(logFile, "INFO", `Active pet: ${petId ?? "(none)"}`);
  } catch (err) {
    await daemonLog(logFile, "WARN", `Could not read state: ${String(err)}`);
  }

  // Build source + collector
  const source = new LogTailTokenSignalSource(signalStateDir);
  const collector = new TokenCollector(source, config);

  let stopCollector: (() => Promise<void>) | null = null;
  let backoffIndex = 0;
  let shuttingDown = false;

  async function startCollector(): Promise<void> {
    try {
      stopCollector = collector.start(petId);
      backoffIndex = 0; // Reset backoff on successful start
      await daemonLog(logFile, "INFO", "Token collector started");
    } catch (err) {
      await daemonLog(logFile, "ERROR", `Failed to start collector: ${String(err)}`);
      scheduleRestart();
    }
  }

  function scheduleRestart(): void {
    if (shuttingDown) return;
    const delay = BACKOFF_SCHEDULE_MS[Math.min(backoffIndex, BACKOFF_SCHEDULE_MS.length - 1)]!;
    backoffIndex++;
    void daemonLog(logFile, "WARN", `Scheduling restart in ${delay}ms (attempt ${backoffIndex})`);
    setTimeout(() => {
      if (!shuttingDown) void startCollector();
    }, delay);
  }

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    await daemonLog(logFile, "INFO", `Received ${signal} — shutting down`);

    try {
      if (stopCollector !== null) {
        await stopCollector();
        stopCollector = null;
      }
    } catch (err) {
      await daemonLog(logFile, "ERROR", `Error during collector stop: ${String(err)}`);
    }

    try {
      if (releaseLock !== null) {
        await releaseLock();
        releaseLock = null;
      }
    } catch (err) {
      await daemonLog(logFile, "ERROR", `Error releasing daemon lock: ${String(err)}`);
    }

    await daemonLog(logFile, "INFO", "glyphling watch stopped");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Start the collector loop
  await startCollector();

  // Block indefinitely — the process will exit via shutdown()
  await new Promise<never>(() => {
    // This promise never resolves; the process exits via signal handlers above
  });

  // Unreachable, but TypeScript needs a return
  return 0;
}
