/**
 * Lean state reader — statusline fast-path only.
 *
 * Exports only `readState()`. Does NOT import chokidar, proper-lockfile,
 * ulid, or crypto — keeping the module load time under 5ms compiled.
 *
 * Used by src/statusline-entry.ts (BUG-001 fix, DEC-016).
 * All other callers should continue to import from ./persistence.js.
 */

import fs from "fs";
import type { Config } from "../config/env.js";
import { validateState, type StateFileV1 } from "./schema.js";

/** Jitter window for the retry-on-parse-error in the reader protocol (§4.4). */
const READ_RETRY_JITTER_MS = 20;

/** SEC-003: Refuse state.json reads larger than this (5 MB). */
const MAX_STATE_BYTES = 5 * 1024 * 1024;

/**
 * Read and validate state.json from disk (§4.4 reader protocol).
 * Returns null if the file does not exist (first-run).
 * On parse error, retries once after a 20ms jitter; falls back to null.
 *
 * Never acquires the lockfile — safe to call from the statusline subprocess
 * which must not block on lock contention (DEC-016 §13 risk #6).
 */
export async function readState(config: Config): Promise<StateFileV1 | null> {
  return (await readStateOrError(config)).state;
}

/**
 * TODO-038: Like readState, but also reports whether a parse/schema error was
 * the terminal failure (as opposed to a missing or empty file).
 *
 * Used by renderOnce to distinguish "no pet" from "state stale" in the
 * statusline fallback output.
 */
export async function readStateOrError(
  config: Config
): Promise<{ state: StateFileV1 | null; parseError: boolean }> {
  return readStateFromPath(config.paths.stateFile);
}

async function readStateFromPath(
  stateFile: string,
  attempt = 0
): Promise<{ state: StateFileV1 | null; parseError: boolean }> {
  // SEC-003: stat first; refuse if too large
  try {
    const stat = await fs.promises.stat(stateFile);
    if (stat.size > MAX_STATE_BYTES) {
      process.stderr.write(
        `[glyphling] state.json exceeds size limit (${stat.size} bytes > ${MAX_STATE_BYTES}); refusing to load\n`
      );
      return { state: null, parseError: false };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { state: null, parseError: false };
    throw err;
  }

  let raw: string;
  try {
    raw = await fs.promises.readFile(stateFile, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { state: null, parseError: false };
    throw err;
  }

  // Empty file = same semantics as missing (first-run race or interrupted truncate).
  if (raw.length === 0) return { state: null, parseError: false };

  try {
    const parsed: unknown = JSON.parse(raw);
    const state = validateState(parsed);
    return { state, parseError: false };
  } catch (err) {
    if (attempt === 0) {
      await sleep(READ_RETRY_JITTER_MS);
      return readStateFromPath(stateFile, 1);
    }
    process.stderr.write(
      `[glyphling] state.json failed to parse (attempt ${attempt + 1}): ${String(err)}\n`
    );
    return { state: null, parseError: true };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
