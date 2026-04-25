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

/**
 * Read and validate state.json from disk (§4.4 reader protocol).
 * Returns null if the file does not exist (first-run).
 * On parse error, retries once after a 20ms jitter; falls back to null.
 *
 * Never acquires the lockfile — safe to call from the statusline subprocess
 * which must not block on lock contention (DEC-016 §13 risk #6).
 */
export async function readState(config: Config): Promise<StateFileV1 | null> {
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
      await sleep(READ_RETRY_JITTER_MS);
      return readStateFromPath(stateFile, 1);
    }
    process.stderr.write(
      `[glyphling] state.json failed to parse (attempt ${attempt + 1}): ${String(err)}\n`
    );
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
