/**
 * StateStore — Module #3 (architecture §2.2)
 *
 * In-memory mirror of state.json. Provides:
 *   - getState()        — snapshot read (safe to call from React render)
 *   - dispatch(event)   — apply a GlyphlingEvent to in-memory state + persist
 *   - hydrate(state)    — replace in-memory state from an external source
 *   - subscribe(fn)     — pub/sub compatible with useSyncExternalStore
 *   - replayEvents()    — replay unsynced events from events.jsonl (DEC-010)
 *   - materialize()     — rebuild state.json from events.jsonl from scratch
 *
 * DEC-018: On boot, if a chain break is detected during replay, the store
 * logs to stderr, retains pet state at the last valid event, and exposes
 * `integrityWarning` for the renderer to surface a non-fatal banner.
 *
 * This module is intentionally thin: it owns the in-memory cache and the
 * subscriber notification ring. Business logic (XP fold, level-up checks, etc.)
 * lives in XPEngine and LifecycleClock, which call dispatch() with resolved state.
 */

import type { Config } from "../config/env.js";
import {
  type StateFileV1,
  type GlyphlingEvent,
  makeEmptyState,
} from "./schema.js";
import {
  readState,
  writeState,
  appendEvent,
  replayEvents,
  watchState,
  checkRecoveryNeeded,
  type StateChangeListener,
} from "./persistence.js";

// ---------------------------------------------------------------------------
// Action types (discriminated union — expand per module)
// ---------------------------------------------------------------------------

export type Action =
  | { type: "NOOP" }
  | { type: "HYDRATE"; state: StateFileV1 }
  | { type: "APPLY_EVENT"; event: GlyphlingEvent; fold: FoldFn };

/** A function that applies a GlyphlingEvent to state, returning the new state. */
export type FoldFn = (
  state: StateFileV1,
  event: GlyphlingEvent
) => StateFileV1;

// ---------------------------------------------------------------------------
// Subscriber
// ---------------------------------------------------------------------------

type Subscriber = () => void;

// ---------------------------------------------------------------------------
// StateStore class
// ---------------------------------------------------------------------------

export class StateStore {
  private _state: StateFileV1 | null = null;
  private _subscribers = new Set<Subscriber>();
  private _config: Config | null = null;
  private _unwatch: (() => void) | null = null;

  /**
   * DEC-018: set to a non-null string if the event chain was broken at boot.
   * Renderer reads this via integrityWarning() to surface a non-fatal banner.
   */
  private _integrityWarning: string | null = null;

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  /**
   * Initialise the store with a config and load state from disk.
   * Sets up the file-watch so external writes are reflected immediately.
   * Call once at application boot.
   */
  async boot(config: Config): Promise<void> {
    this._config = config;

    // Crash recovery: sweep stale tmp files; check if replay is needed
    const needsReplay = await checkRecoveryNeeded(config);

    if (needsReplay) {
      await this.replayEvents();
    } else {
      const state = await readState(config);
      this._state = state;
      this.notifySubscribers();
    }

    // Start file-watch for cross-instance sync
    this._unwatch = watchState(config, (newState) => {
      this._state = newState;
      this.notifySubscribers();
    });
  }

  /**
   * Stop the file watcher and clean up resources.
   */
  teardown(): void {
    if (this._unwatch) {
      this._unwatch();
      this._unwatch = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Returns the current in-memory state snapshot.
   * May be null before first load (between construction and boot()).
   * Safe to call from React render — returns a stable reference until state changes.
   */
  getState(): StateFileV1 | null {
    return this._state;
  }

  /**
   * DEC-018: Returns a non-null banner string if the event chain was broken
   * at boot, null otherwise. The renderer uses this to surface a warning.
   */
  integrityWarning(): string | null {
    return this._integrityWarning;
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  /**
   * Dispatch an action to update state.
   * - NOOP: no-op.
   * - HYDRATE: replace in-memory state, persist, notify.
   * - APPLY_EVENT: append event to events.jsonl, fold into state, persist, notify.
   */
  async dispatch(action: Action): Promise<void> {
    const config = this._requireConfig();

    switch (action.type) {
      case "NOOP":
        break;

      case "HYDRATE":
        this._state = action.state;
        await writeState(config, action.state);
        this.notifySubscribers();
        break;

      case "APPLY_EVENT": {
        // appendEvent handles: clock guards, prevHash assignment, chain update,
        // fold, and writeState. We read the final persisted state back so
        // this._state reflects eventsHead / lastEventAt correctly.
        await appendEvent(config, action.event, action.fold);
        const persisted = await readState(config);
        if (persisted !== null) {
          this._state = persisted;
        }
        this.notifySubscribers();
        break;
      }
    }
  }

  /**
   * Replace the in-memory state entirely (used after file-watch reload or
   * first boot read). Does NOT persist — callers that want to persist should
   * use dispatch(HYDRATE).
   */
  hydrate(newState: StateFileV1): void {
    this._state = newState;
    this.notifySubscribers();
  }

  // ---------------------------------------------------------------------------
  // DEC-010 + DEC-018: Event replay / materialisation
  // ---------------------------------------------------------------------------

  /**
   * Replay events from events.jsonl after `eventsCursor` byte offset.
   * Applies each event via the provided fold function and persists the result.
   * Uses the cursor stored in state for idempotency.
   *
   * DEC-018: If the hash chain is broken, stops applying events past the break,
   * sets the integrity warning, and logs to stderr. Pet state is kept at the
   * last valid event — does NOT crash.
   *
   * @param fold Optional fold function. If omitted, events are loaded
   *             but state is not recomputed — useful for diagnostics.
   */
  async replayEvents(fold?: FoldFn): Promise<GlyphlingEvent[]> {
    const config = this._requireConfig();

    const cursor = this._state?.globals.eventsCursor ?? 0;
    const knownHead = this._state?.globals.eventsHead ?? "";
    const result = await replayEvents(config, cursor, knownHead);

    // DEC-018: surface chain-broken warning
    if (result.chainBroken) {
      const warning =
        `event log tampered since last session` +
        (result.brokenAtEventId
          ? ` (at event ${result.brokenAtEventId})`
          : "");
      this._integrityWarning = warning;
      process.stderr.write(`[glyphling] integrity: ${warning}\n`);
    }

    if (result.events.length === 0) return [];

    if (fold) {
      let state = this._state ?? makeEmptyState();
      for (const event of result.events) {
        state = fold(state, event);
      }
      // Update the cursor to the latest byte offset
      state = {
        ...state,
        globals: {
          ...state.globals,
          eventsCursor: result.lastByteOffset,
        },
        updatedAt: new Date().toISOString(),
      };
      await writeState(config, state);
      this._state = state;
      this.notifySubscribers();
    }

    return result.events;
  }

  /**
   * Rebuild state from scratch by replaying ALL events in events.jsonl.
   * Used for full recovery when state.json is corrupt or missing.
   * `fold` is required — the caller provides the business-logic fold function.
   *
   * DEC-018: If the chain is broken, still rebuilds up to the break point.
   */
  async materialize(fold: FoldFn): Promise<StateFileV1> {
    const config = this._requireConfig();

    const result = await replayEvents(config, 0, "");

    // DEC-018: surface chain-broken warning during full materialisation
    if (result.chainBroken) {
      const warning =
        `event log tampered since last session` +
        (result.brokenAtEventId
          ? ` (at event ${result.brokenAtEventId})`
          : "");
      this._integrityWarning = warning;
      process.stderr.write(`[glyphling] integrity: ${warning}\n`);
    }

    let state = makeEmptyState();
    for (const event of result.events) {
      state = fold(state, event);
    }

    state = {
      ...state,
      globals: {
        ...state.globals,
        eventsCursor: result.lastByteOffset,
      },
      updatedAt: new Date().toISOString(),
    };

    await writeState(config, state);
    this._state = state;
    this.notifySubscribers();
    return state;
  }

  // ---------------------------------------------------------------------------
  // Subscriptions (useSyncExternalStore compatible)
  // ---------------------------------------------------------------------------

  /**
   * Register a change subscriber. Returns an unsubscribe function.
   * Compatible with React's useSyncExternalStore API.
   */
  subscribe(fn: Subscriber): () => void {
    this._subscribers.add(fn);
    return () => {
      this._subscribers.delete(fn);
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private notifySubscribers(): void {
    for (const fn of this._subscribers) {
      fn();
    }
  }

  private _requireConfig(): Config {
    if (!this._config) {
      throw new Error(
        "[glyphling] StateStore.boot() must be called before dispatching actions."
      );
    }
    return this._config;
  }
}

// ---------------------------------------------------------------------------
// Re-export persistence helpers for convenience
// ---------------------------------------------------------------------------

export type { StateChangeListener };
export { readState, writeState, appendEvent, watchState };
