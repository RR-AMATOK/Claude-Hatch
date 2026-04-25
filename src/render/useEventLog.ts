/**
 * useEventLog — reads and watches events.jsonl for the TUI log panel
 *
 * Returns the last N log entries from events.jsonl, most recent first.
 * Subscribes to file changes via chokidar (same debounce as watchState)
 * so new events appear without manual refresh.
 *
 * This is a read-only view — it never mutates state.
 */

import { useState, useEffect } from "react";
import fs from "fs";
import { watch as chokidarWatch } from "chokidar";
import type { Config } from "../config/env.js";
import { parseEvent, type GlyphlingEvent } from "../state/schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogEntry {
  id: string;
  type: string;
  ts: string;
  petId: string | null;
  /** Human-readable label for the log panel. */
  label: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 10;
const WATCH_DEBOUNCE_MS = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an event into a human-readable label for the log panel.
 * Keeps lines short (≤60 chars target).
 */
function formatEventLabel(event: GlyphlingEvent): string {
  switch (event.type) {
    case "tokens.delta":
      return "tokens processed";
    case "git.commit":
      return "git commit";
    case "test.pass":
      return "tests passed";
    case "file.edit":
      return "file edited";
    case "error.fixed":
      return "error fixed";
    case "daily.checkin":
      return "daily check-in";
    case "pet.fed":
      return "pet fed";
    case "pet.played":
      return "played with pet";
    case "pet.paused":
      return "paused";
    case "pet.resumed":
      return "resumed";
    case "level.up": {
      const p = event.payload as Record<string, unknown> | null;
      const lvl = typeof p?.["level"] === "number" ? p["level"] : "";
      return lvl ? `leveled up to ${lvl}!` : "level up!";
    }
    case "personality.refresh":
      return "personality refreshed";
    case "unlock.gif.tier1":
      return "GIF tier 1 unlocked";
    case "unlock.gif.tier2":
      return "GIF tier 2 unlocked";
    case "unlock.gif.tier3":
      return "GIF tier 3 unlocked";
    case "unlock.adoption":
      return "adoption unlocked";
    case "pet.hungry":
      return "pet is hungry";
    case "pet.sick":
      return "pet is sick";
    case "pet.dying":
      return "pet is dying!";
    case "pet.died":
      return "pet has died";
    case "pet.adopted":
      return "new pet adopted";
    case "export.started":
      return "GIF export started";
    case "export.completed":
      return "GIF export done";
    case "export.failed":
      return "GIF export failed";
    case "signal.rejected":
      return "signal rejected";
    default:
      return event.type;
  }
}

/**
 * Format a timestamp as a relative human-readable string: "just now", "2m ago", "5h ago", etc.
 */
export function formatRelativeTime(isoTs: string, nowMs: number): string {
  const ts = new Date(isoTs).getTime();
  const diffMs = nowMs - ts;
  if (diffMs < 0 || diffMs < 5000) return "just now";
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return `${diffSecs}s ago`;
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Read the last N events from events.jsonl synchronously.
 * Returns an empty array if the file doesn't exist or has errors.
 */
function readLastEvents(eventsLog: string, maxCount: number): LogEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(eventsLog, "utf8");
  } catch {
    return [];
  }

  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Take the last maxCount lines to avoid parsing the whole file
  const tail = lines.slice(-maxCount);
  const entries: LogEntry[] = [];

  for (const line of tail) {
    try {
      const parsed = parseEvent(JSON.parse(line));
      if (parsed === null) continue;
      entries.push({
        id: parsed.id,
        type: parsed.type,
        ts: parsed.ts,
        petId: parsed.petId,
        label: formatEventLabel(parsed),
      });
    } catch {
      // Skip malformed lines
    }
  }

  // Return most-recent first
  return entries.reverse();
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the last MAX_ENTRIES log entries from events.jsonl, most recent first.
 * Subscribes to file-change events via chokidar so the panel auto-refreshes.
 */
export function useEventLog(config: Config): LogEntry[] {
  const [entries, setEntries] = useState<LogEntry[]>(() =>
    readLastEvents(config.paths.eventsLog, MAX_ENTRIES)
  );

  useEffect(() => {
    const { eventsLog } = config.paths;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      setEntries(readLastEvents(eventsLog, MAX_ENTRIES));
    };

    const watcher = chokidarWatch(eventsLog, {
      persistent: false,
      ignoreInitial: true,
      usePolling: false,
      awaitWriteFinish: false,
    });

    const onEvent = () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        refresh();
      }, WATCH_DEBOUNCE_MS);
    };

    watcher.on("change", onEvent);
    watcher.on("add", onEvent);

    return () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      void watcher.close();
    };
  }, [config.paths.eventsLog]);

  return entries;
}
