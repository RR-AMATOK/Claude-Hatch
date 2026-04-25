/**
 * `glyphling doctor` — one-shot diagnostics command
 *
 * Reads (does NOT acquire) state. Reports as plain text:
 *   - Watcher running? (daemon lockfile present + process alive via kill -0)
 *   - Last tokens.delta event: timestamp + XP awarded
 *   - Today's token cap usage: XP from tokens today / cap
 *   - Last entry from watch.log if it's an error line
 *
 * Architecture §7.4 / §14.2: doctor is a read-only one-shot (no state writes,
 * no lockfile acquisition). Never calls writeState or appendEvent.
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { Config } from "../config/env.js";
import { readState } from "../state/persistence.js";
import { DAILY_CAP_TOKENS } from "../xp/engine.js";
import { parseEvent } from "../state/schema.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAEMON_LOCK_FILENAME = "watch.lock";
const WATCH_LOG_FILENAME = "watch.log";

// ---------------------------------------------------------------------------
// doctor main
// ---------------------------------------------------------------------------

export async function runDoctor(config: Config): Promise<number> {
  const lines: string[] = [];
  const out = (s: string) => lines.push(s);

  out("glyphling doctor");
  out("────────────────────────────────────────");

  // -------------------------------------------------------------------------
  // 1. Watcher status
  // -------------------------------------------------------------------------
  const lockPath = path.join(config.stateHome, DAEMON_LOCK_FILENAME);
  const watcherStatus = await checkWatcherRunning(lockPath);
  out(`Watcher:  ${watcherStatus}`);

  // -------------------------------------------------------------------------
  // 2. State + last tokens.delta event
  // -------------------------------------------------------------------------
  const state = await readState(config);

  // -------------------------------------------------------------------------
  // 2. Pet state
  // -------------------------------------------------------------------------
  let activePet = null;
  if (state === null) {
    out("State:    (no state file found — adopt a pet first)");
  } else {
    const activePetId = state.globals.activePetId;
    activePet = activePetId
      ? (state.pets.find((p) => p.id === activePetId) ?? null)
      : null;

    if (activePet === null) {
      out("State:    (no active pet)");
    } else {
      out(`Pet:      ${activePet.name ?? "(unnamed)"} [${activePet.eggType}] L${activePet.level} — ${activePet.xp} XP`);
    }
  }

  // -------------------------------------------------------------------------
  // 3. Last tokens.delta event from events.jsonl (always checked)
  // -------------------------------------------------------------------------
  const lastTokenEvent = await findLastTokenEvent(config.paths.eventsLog);
  if (lastTokenEvent !== null) {
    out(`Last signal: tokens.delta at ${lastTokenEvent.ts} (+${lastTokenEvent.xpDelta ?? 0} XP, ${(lastTokenEvent.payload as Record<string, unknown>)?.["tokens"] ?? "?"} tokens)`);
  } else {
    out("Last signal: (no tokens.delta events recorded yet)");
  }

  // -------------------------------------------------------------------------
  // 4. Today's token cap usage
  // -------------------------------------------------------------------------
  if (activePet !== null) {
    const today = new Date().toISOString().slice(0, 10);
    const todayCaps = activePet.dailyCaps[today];
    const usedToday = todayCaps?.["tokens"] ?? 0;
    const capPct = DAILY_CAP_TOKENS > 0
      ? Math.round((usedToday / DAILY_CAP_TOKENS) * 100)
      : 0;
    out(`Token cap: ${usedToday} / ${DAILY_CAP_TOKENS} XP today (${capPct}%)`);
  }

  // -------------------------------------------------------------------------
  // 5. Last error from watch.log
  // -------------------------------------------------------------------------
  const logError = await lastLogError(path.join(config.stateHome, WATCH_LOG_FILENAME));
  if (logError !== null) {
    out("");
    out("watch.log last error:");
    out(`  ${logError}`);
  }

  out("────────────────────────────────────────");
  return output(lines);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a human-readable watcher status string. */
async function checkWatcherRunning(lockPath: string): Promise<string> {
  // Check if the lockfile exists
  let lockStat: fs.Stats | null = null;
  try {
    lockStat = await fs.promises.stat(lockPath);
  } catch {
    return "not running (no lockfile)";
  }

  // Lockfile exists — read PID from the accompanying .lock file
  // proper-lockfile creates a directory at `${lockPath}.lock`
  const lockDirPath = lockPath + ".lock";
  let pidContent: string | null = null;
  try {
    pidContent = await fs.promises.readFile(
      path.join(lockDirPath, "pid"),
      "utf8"
    );
  } catch {
    // proper-lockfile stores pid differently — try reading the lockfile itself
    try {
      pidContent = await fs.promises.readFile(lockPath, "utf8");
    } catch {
      pidContent = null;
    }
  }

  // Try to detect if the lock-holding process is alive via kill -0
  // proper-lockfile stores the lock metadata in a .lock directory, containing a file
  // named after the pid. We can glob for it.
  let pid: number | null = null;
  try {
    const lockDir = lockPath + ".lock";
    const entries = await fs.promises.readdir(lockDir);
    for (const entry of entries) {
      // The lock directory often contains files like "pid" or a pid number
      const candidate = parseInt(entry, 10);
      if (!isNaN(candidate) && candidate > 0) {
        pid = candidate;
        break;
      }
      // Also try reading a file named "pid" or check entry content
      if (entry === "pid") {
        const content = await fs.promises.readFile(path.join(lockDir, entry), "utf8");
        const parsed = parseInt(content.trim(), 10);
        if (!isNaN(parsed) && parsed > 0) {
          pid = parsed;
          break;
        }
      }
    }
  } catch {
    // Lock dir not accessible
  }

  if (pid !== null) {
    const alive = isProcessAlive(pid);
    if (alive) {
      return `running (pid=${pid})`;
    } else {
      const staleAge = lockStat
        ? Math.round((Date.now() - lockStat.mtimeMs) / 1000)
        : "?";
      return `stale lockfile (pid=${pid} not found; age=${staleAge}s)`;
    }
  }

  // Could not determine PID — report lockfile exists
  return "lockfile present (could not determine pid)";
}

/** Cross-platform process liveness check via kill(pid, 0). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan events.jsonl (in reverse by reading the last N KB) for the most
 * recent tokens.delta event.
 */
async function findLastTokenEvent(
  eventsLog: string
): Promise<{ ts: string; xpDelta?: number; payload: unknown } | null> {
  let raw: string;
  try {
    const stat = await fs.promises.stat(eventsLog);
    // Read up to 128 KB from the end to find recent events
    const readSize = Math.min(131_072, stat.size);
    const buf = Buffer.allocUnsafe(readSize);
    const fd = await fs.promises.open(eventsLog, "r");
    try {
      await fd.read(buf, 0, readSize, stat.size - readSize);
    } finally {
      await fd.close();
    }
    raw = buf.toString("utf8");
  } catch {
    return null;
  }

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  // Scan in reverse to find the last tokens.delta event
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    try {
      const parsed = parseEvent(JSON.parse(line));
      if (parsed !== null && parsed.type === "tokens.delta") {
        const result: { ts: string; payload: unknown; xpDelta?: number } = {
          ts: parsed.ts,
          payload: parsed.payload,
        };
        if (parsed.xpDelta !== undefined) result.xpDelta = parsed.xpDelta;
        return result;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Read the last line from watch.log that contains "[ERROR]" or "[WARN]".
 * Returns null if the file doesn't exist or has no error lines.
 */
async function lastLogError(logPath: string): Promise<string | null> {
  let raw: string;
  try {
    const stat = await fs.promises.stat(logPath);
    // Read up to 64 KB from the end
    const readSize = Math.min(65_536, stat.size);
    const buf = Buffer.allocUnsafe(readSize);
    const fd = await fs.promises.open(logPath, "r");
    try {
      await fd.read(buf, 0, readSize, stat.size - readSize);
    } finally {
      await fd.close();
    }
    raw = buf.toString("utf8");
  } catch {
    return null;
  }

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.includes("[ERROR]") || line.includes("[WARN]")) {
      return line.trim();
    }
  }

  return null;
}

function output(lines: string[]): number {
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

// Silence unused import warning
void os;
