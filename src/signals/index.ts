/**
 * SignalCollectors index — Module #13 (architecture §2.2)
 *
 * Re-exports all signal collectors. Each collector observes an external
 * source and emits normalized GlyphlingEvents to the EventBus.
 *
 * Collectors: tokens, commits, tests, edits, daily (§6.3).
 * Token adapter (Module #14) is a separate sub-module under signals/tokens/.
 *
 * TODO: Implement individual collectors in TODO-014 (signal task).
 */

export type { SignalCollectorContext } from "./types.js";
