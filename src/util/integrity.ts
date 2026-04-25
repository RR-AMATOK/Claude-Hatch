/**
 * Integrity warning helpers for DEC-018.
 *
 * Exports a single function that the compact statusline renderer and the
 * Ink TUI can use to get a one-line banner string when the event chain is
 * broken.  The renderer does NOT import from store.ts directly — it just
 * calls integrityWarning(state) which reads the presence of the warning
 * from state itself.
 *
 * NOTE: The actual chain-broken flag lives on the StateStore instance
 * (set by boot-time replay).  For the one-shot statusline renderer that
 * never runs a full boot cycle, we instead check state.json for a sentinel
 * field.  Since the compact statusline ONLY reads state.json and never runs
 * replayEvents, we surface the warning via a separate exported helper that
 * the Ink TUI wires from the store instance.
 */

import type { StateFileV1 } from "../state/schema.js";

/**
 * Returns the chain-broken banner string if the state indicates a tampered
 * event log, or null if everything is clean.
 *
 * Banner (DEC-018 spec): "event log tampered since last session"
 *
 * For the compact statusline, this function is called with the loaded state;
 * for the Ink TUI, use StateStore.integrityWarning() directly (it has
 * richer context from the replay result).
 *
 * Currently: we have no place in state.json to record the broken-chain flag
 * (the flag lives on the store instance, which the one-shot renderer doesn't
 * instantiate).  This helper is therefore a no-op for now and exists as the
 * stable API surface for the renderer.  A follow-up TODO can persist the
 * flag into state.json if needed.
 *
 * @param _state  The loaded StateFileV1 (unused in this milestone).
 * @returns       Banner string or null.
 */
export function integrityWarning(_state: StateFileV1): string | null {
  // Phase 1: chain-broken flag is store-instance state only.
  // The one-shot statusline renderer does not run replayEvents, so it never
  // detects a chain break.  A future milestone can write a `globals.chainBroken`
  // boolean into state.json so the statusline can read it.
  return null;
}

/**
 * The canonical chain-broken banner string (DEC-018).
 * Used by StateStore to emit the warning, and exported for tests.
 */
export const CHAIN_BROKEN_BANNER = "event log tampered since last session";
