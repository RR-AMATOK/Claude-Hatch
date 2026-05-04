/**
 * EventBus — Module #12 (architecture §2.2)
 *
 * In-process pub/sub. Persists each event by appending to events.jsonl
 * before fanning out to in-proc subscribers (DEC-010: events are source
 * of truth; state.json is a materialised view).
 *
 * TODO: Implement append-to-events.jsonl + fan-out in TODO-005/006.
 */

import type { ISO8601, PetId, LanguageId } from "../state/schema.js";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type EventType =
  | "tokens.delta"
  | "git.commit"
  | "test.pass"
  | "file.edit"
  | "error.fixed"
  | "daily.checkin"
  | "pet.fed"
  | "pet.played"
  | "pet.petted"
  | "pet.paused"
  | "pet.resumed"
  | "level.up"
  | "personality.refresh"
  | "unlock.gif.tier1"
  | "unlock.gif.tier2"
  | "unlock.gif.tier3"
  | "unlock.adoption"
  | "pet.hungry"
  | "pet.sick"
  | "pet.dying"
  | "pet.died"
  // Lifecycle milestone events (emitted by AdoptionManager / lifecycle)
  | "pet.hatched"
  | "pet.evolved"
  // Adoption events (emitted by AdoptionManager)
  | "pet.adopted"
  // Export events (emitted by GIFExporter — TODO-008)
  | "export.started"
  | "export.completed"
  | "export.failed"
  // Integrity events (emitted by persistence / XP engine — DEC-018)
  | "signal.rejected"
  // Migration events (emitted by DEC-020 migration on first load)
  | "pet.regrade";

export interface GlyphlingEvent {
  id: string;
  type: EventType;
  ts: ISO8601;
  petId: PetId | null;
  source: string;
  payload: unknown;
  xpDelta?: number;
  lang?: LanguageId;
  /**
   * DEC-018: SHA-256 hex digest of the previous event's canonical JSON.
   * Empty string for the genesis event (no prior event).
   * Populated by appendEvent() in persistence.ts — event producers leave
   * this absent; it is set before the event is persisted.
   */
  prevHash?: string;
  /**
   * DEC-018 Mechanism 2: hash of the matching Claude Code transcript JSONL line.
   * Only present on `tokens.delta` events produced by the Stop hook adapter.
   * sha256(trimmedLineBytes). Optional — absent on legacy / non-hook events.
   */
  transcriptLineHash?: string;
}

// ---------------------------------------------------------------------------
// Bus
// ---------------------------------------------------------------------------

type EventListener = (event: GlyphlingEvent) => void | Promise<void>;

/**
 * In-process event bus. All XP-affecting and lifecycle mutations flow
 * through here. Durable append to events.jsonl happens before fan-out.
 *
 * TODO: Wire StatePersistence append + cursor update in TODO-005.
 */
export class EventBus {
  private listeners = new Map<EventType, Set<EventListener>>();

  /** Append event to events.jsonl, then fan out to in-proc subscribers. */
  emit(event: GlyphlingEvent): void {
    // TODO: await StatePersistence.appendEvent(event) before fan-out
    const handlers = this.listeners.get(event.type);
    if (!handlers) return;
    for (const fn of handlers) {
      void fn(event);
    }
  }

  /** Subscribe to a specific event type. Returns an unsubscribe function. */
  on(type: EventType, fn: EventListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(fn);
    return () => {
      this.listeners.get(type)?.delete(fn);
    };
  }
}
