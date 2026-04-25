/**
 * DEC-020 state migration — Option A (recompute level from XP on first load).
 *
 * On every state load, recomputes `pet.level` for every pet via
 * `levelFromCumXp(pet.xp)` using the DEC-020 golden curve. If the derived
 * level differs from the stored level, writes the corrected state and appends
 * a `pet.regrade` event via `appendEvent` (DEC-018 chain integrity).
 *
 * The recomputation is idempotent: a pet whose stored level already matches
 * the new curve produces no write and no event.
 *
 * Respects DEC-008: uses the caller-supplied Config (which honours
 * $GLYPHLING_HOME). Never touches ~/.claude/ directly.
 *
 * @see DEC-020 §6 (Option A migration)
 */

import { ulid } from "ulid";
import type { Config } from "../config/env.js";
import type { StateFileV1, Pet } from "./schema.js";
import { levelFromCumXp } from "../xp/engine.js";
import { appendEvent, writeState, readState } from "./persistence.js";
import type { GlyphlingEvent } from "./schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegradeResult {
  /** Pet id → { fromLevel, toLevel } for pets that were regraded. */
  regraded: Map<string, { fromLevel: number; toLevel: number }>;
  /** Updated state (may equal input if nothing changed). */
  state: StateFileV1;
}

// ---------------------------------------------------------------------------
// applyDec020Migration
// ---------------------------------------------------------------------------

/**
 * Recompute `pet.level` for every pet using the DEC-020 golden curve.
 *
 * If any pet's level changed:
 *  1. Mutate the state to reflect the corrected levels.
 *  2. Write the updated state to disk.
 *  3. Append a `pet.regrade` event via `appendEvent` (one per affected pet).
 *
 * Returns a `RegradeResult` describing which pets were changed and the updated
 * state. If no pets changed, the state is written back unchanged (idempotent).
 *
 * @param config  Runtime config (honours $GLYPHLING_HOME — DEC-008).
 * @param state   State as loaded from disk (already Zod-validated).
 */
export async function applyDec020Migration(
  config: Config,
  state: StateFileV1
): Promise<RegradeResult> {
  const regraded = new Map<string, { fromLevel: number; toLevel: number }>();

  // Build updated pets array
  const updatedPets: Pet[] = state.pets.map((pet) => {
    const derivedLevel = levelFromCumXp(pet.xp);
    if (derivedLevel !== pet.level) {
      regraded.set(pet.id, { fromLevel: pet.level, toLevel: derivedLevel });
      return { ...pet, level: derivedLevel };
    }
    return pet;
  });

  if (regraded.size === 0) {
    // Nothing changed — no writes needed.
    return { regraded, state };
  }

  // Build updated state with corrected levels.
  const migratedState: StateFileV1 = {
    ...state,
    pets: updatedPets,
    updatedAt: new Date().toISOString(),
  };

  // Write corrected state first (before appending events, so the state file is
  // consistent even if a subsequent appendEvent fails).
  await writeState(config, migratedState);

  // Append one pet.regrade event per affected pet via appendEvent to maintain
  // DEC-018 chain integrity.
  let currentState = migratedState;
  for (const [petId, { fromLevel, toLevel }] of regraded) {
    const regradeEvent: GlyphlingEvent = {
      id: ulid(),
      type: "pet.regrade",
      ts: new Date().toISOString(),
      petId,
      source: "migration-dec020",
      payload: {
        fromLevel,
        toLevel,
        fromCurve: "DEC-004",
        toCurve: "DEC-020",
      },
      // prevHash is set by appendEvent before persisting (DEC-018 chain integrity).
      prevHash: "",
    };

    // appendEvent reads current state for eventsHead, appends, and writes back.
    await appendEvent(config, regradeEvent);

    // Re-read state to pick up the updated eventsHead for the next iteration.
    // (appendEvent updates state.globals.eventsHead internally.)
    const refreshed = await readState(config);
    if (refreshed !== null) {
      currentState = refreshed;
    }
  }

  return { regraded, state: currentState };
}
