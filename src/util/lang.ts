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

// ---------------------------------------------------------------------------
// SEC-008: Safe log helper — prevents ANSI/control-char injection in stderr
// ---------------------------------------------------------------------------

/**
 * Escape a potentially attacker-controlled string for safe stderr logging.
 *
 * JSON.stringify wraps the value in double-quotes and escapes all control
 * characters (including ANSI escape sequences). The result is truncated to
 * 200 characters to prevent log-flooding.
 *
 * Usage: `process.stderr.write(\`[glyphling] event id: \${safeForLog(id)}\n\`)`
 */
export function safeForLog(value: unknown): string {
  // JSON.stringify(undefined) returns undefined; coerce to string defensively.
  const json = JSON.stringify(value);
  return (json ?? "undefined").slice(0, 200);
}
