/**
 * Hash utilities for DEC-018 integrity model.
 *
 * Provides:
 *   - sha256(input)       — SHA-256 hex digest of an arbitrary string or Buffer
 *   - canonicalJson(obj)  — deterministic JSON serialisation (sorted keys, no indentation)
 *
 * The canonical-JSON algorithm is intentionally simple: JSON.stringify with a
 * replacer that sorts object keys recursively. This is sufficient for the
 * event-chain use case where objects are plain data (no Dates, no undefined
 * values, no cycles). The output must be deterministic across process restarts
 * so that two events with identical payloads always produce the same hash.
 */

import crypto from "crypto";

// ---------------------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------------------

/**
 * Returns the SHA-256 hex digest (64 lowercase hex chars) of the given input.
 *
 * @param input  A UTF-8 string or Buffer. Strings are encoded as UTF-8.
 */
export function sha256(input: string | Buffer): string {
  return crypto
    .createHash("sha256")
    .update(typeof input === "string" ? Buffer.from(input, "utf8") : input)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Canonical JSON
// ---------------------------------------------------------------------------

/**
 * Serialise `obj` to a canonical JSON string with sorted object keys.
 *
 * Rules:
 *  - Object keys are sorted lexicographically (depth-first recursive).
 *  - Arrays preserve order (elements are serialised in order).
 *  - `undefined` values are omitted (same behaviour as JSON.stringify).
 *  - No indentation; compact single-line output.
 *
 * This is deterministic: two calls with structurally equal objects always
 * return the same string, regardless of the order keys were inserted.
 */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, sortedReplacer);
}

/**
 * JSON.stringify replacer that sorts object keys lexicographically.
 *
 * Note: the replacer is called with `this` bound to the parent object, so
 * we receive (key, value) where value is already the result of `toJSON()` if
 * one exists.  We only sort keys on plain objects; arrays and primitives pass
 * through unchanged.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
