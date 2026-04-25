/**
 * useGlyphlingStore — React integration for StateStore
 *
 * Provides a useSyncExternalStore wrapper and a shared singleton boot path
 * for the Ink TUI. The store is booted once at the module level and exposed
 * as a singleton so multiple components can subscribe without re-booting.
 *
 * Import pattern:
 *   import { useGlyphlingStore, glyphlingStore } from "./useGlyphlingStore.js";
 */

import { useSyncExternalStore } from "react";
import { StateStore } from "../state/store.js";
import type { StateFileV1 } from "../state/schema.js";
import type { Config } from "../config/env.js";

// ---------------------------------------------------------------------------
// Singleton store instance
// ---------------------------------------------------------------------------

/**
 * Module-level singleton so all TUI components share one store and one
 * file-watcher without needing a React context provider.
 */
export const glyphlingStore = new StateStore();

// ---------------------------------------------------------------------------
// useSyncExternalStore wrapper
// ---------------------------------------------------------------------------

/**
 * Subscribe to the StateStore and return a snapshot.
 * Returns null until the store has been booted and state is loaded.
 *
 * This hook is safe to call from any Ink component — it integrates with
 * React's concurrent rendering via useSyncExternalStore.
 */
export function useGlyphlingStore(): StateFileV1 | null {
  return useSyncExternalStore(
    (cb) => glyphlingStore.subscribe(cb),
    () => glyphlingStore.getState()
  );
}

// ---------------------------------------------------------------------------
// Boot helper
// ---------------------------------------------------------------------------

/**
 * Boot the singleton store with the given config.
 * Idempotent — safe to call multiple times (only the first call has effect
 * since StateStore.boot sets up the watcher internally).
 */
export async function bootStore(config: Config): Promise<void> {
  await glyphlingStore.boot(config);
}
