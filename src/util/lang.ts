/**
 * LanguageDetect utility — Module #20 (architecture §2.2)
 *
 * Sniffs the programming language of a directory from file extensions and
 * package markers (package.json, Cargo.toml, go.mod, etc.).
 *
 * TODO: Implement full detection logic; stub returns "unknown".
 */

import type { LanguageId } from "../state/schema.js";

// ---------------------------------------------------------------------------
// Extension / marker map
// ---------------------------------------------------------------------------

/**
 * Returns the dominant LanguageId for the given directory, or "unknown"
 * if no recognisable source files are found.
 *
 * TODO: Walk the directory for package markers + count file extensions.
 *       Weight TypeScript over JavaScript when both are present.
 */
export function detectLanguage(_dir: string): LanguageId {
  // TODO: Implement in TODO-016 (personality engine uses this at hatch).
  return "unknown";
}
