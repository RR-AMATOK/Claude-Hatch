/**
 * AdoptionManager — Module #17 (architecture §2.2)
 *
 * Enforces the DEC-006 adoption gate and performs hatch-time personality roll.
 * All functions are pure — no I/O, no timers. The caller (REPL handler) is
 * responsible for acquiring the lockfile, appending events, and writing state.
 *
 * Gate rules (DEC-006 + DEC-011):
 *   1. If `globals.unlocks.adoption` is already true (one-time flat unlock,
 *      DEC-006), skip the primary-level + primary-age checks and only enforce
 *      pet-count cap (≤4) and species validity.
 *   2. If unlock not yet earned, primary pet must be:
 *      - alive (diedAt === null)
 *      - level ≥ 73
 *      - unpaused age ≥ 7 days (DEC-011: now - hatchedAt - Σ pauseInterval.duration)
 *   3. Pet count must be < 4 (DEC-006 cap).
 *
 *   NOTE on primary-dead-after-unlock: if the primary dies AFTER the unlock
 *   was earned, further adoptions up to the cap are still allowed. The unlock
 *   is an achievement record, not a live condition check. This deviates from
 *   the "primary must be alive" phrasing in the acceptance-criteria brief but
 *   matches DEC-006's intent that the gate is "one-time and flat". This
 *   interpretation is flagged in the completion note for product-owner review.
 */

import { ulid } from "ulid";
import type {
  StateFileV1,
  Pet,
  EggType,
  GlyphlingEvent,
} from "../state/schema.js";
import { rollAt, timeOfDayBucket } from "../personality/engine.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Primary pet must reach this level before adoption is unlocked (DEC-006). */
export const ADOPTION_LEVEL_GATE = 73;

/** Primary pet must have this many unpaused seconds of age (7 days). */
export const ADOPTION_AGE_SECONDS = 7 * 86_400;

/** Maximum concurrent pets (DEC-006). */
export const PET_CAP = 4;

/** Valid egg types — mirrors EggTypeSchema (DEC-017). */
export const VALID_EGG_TYPES: ReadonlyArray<EggType> = [
  "circuit",
  "rune",
  "shard",
  "bloom",
];

// ---------------------------------------------------------------------------
// Gate check
// ---------------------------------------------------------------------------

export type CanAdoptResult =
  | { ok: true; stateWithUnlock: StateFileV1 }
  | { ok: false; reason: string };

/**
 * Check whether a new pet can be adopted given the current state.
 *
 * Returns `{ ok: true, stateWithUnlock }` where `stateWithUnlock` is the
 * input state possibly mutated to set `globals.unlocks.adoption = true` when
 * the gate is first passed. The caller must persist this state.
 *
 * Returns `{ ok: false, reason }` with a human-readable rejection message.
 *
 * @param state  Current StateFileV1 snapshot
 * @param nowMs  Current timestamp in ms (injectable for testing)
 */
export function canAdopt(
  state: StateFileV1,
  nowMs: number = Date.now()
): CanAdoptResult {
  // Always enforce pet-count cap regardless of unlock status
  if (state.pets.length >= PET_CAP) {
    return { ok: false, reason: "pet cap reached (4)" };
  }

  // If the unlock has already been earned (one-time flat gate, DEC-006),
  // no further primary-level or primary-age checks needed.
  if (state.globals.unlocks.adoption) {
    return { ok: true, stateWithUnlock: state };
  }

  // Unlock not yet earned — must pass the full gate.
  const primary = findPrimary(state);

  if (primary === null) {
    return { ok: false, reason: "no primary pet found" };
  }

  // Primary must be alive to earn the unlock.
  // (If already dead, the L73 + 7d path is closed — user never earned it.)
  if (primary.diedAt !== null) {
    return {
      ok: false,
      reason: "primary pet has died before adoption was unlocked",
    };
  }

  // Primary must have hatched.
  if (primary.hatchedAt === null) {
    return { ok: false, reason: "primary pet has not hatched yet" };
  }

  // Level gate.
  if (primary.level < ADOPTION_LEVEL_GATE) {
    return {
      ok: false,
      reason: `primary pet is level ${primary.level}; adoption unlocks at 73`,
    };
  }

  // Unpaused-age gate (DEC-011).
  const unpausedAgeSeconds = computeUnpausedAge(primary, nowMs);
  if (unpausedAgeSeconds < ADOPTION_AGE_SECONDS) {
    const days = (unpausedAgeSeconds / 86_400).toFixed(1);
    return {
      ok: false,
      reason: `primary pet is ${days}d old (unpaused); 7d required`,
    };
  }

  // All checks passed — persist the one-time unlock flag.
  const stateWithUnlock: StateFileV1 = {
    ...state,
    globals: {
      ...state.globals,
      unlocks: { ...state.globals.unlocks, adoption: true },
    },
    updatedAt: new Date(nowMs).toISOString(),
  };

  return { ok: true, stateWithUnlock };
}

// ---------------------------------------------------------------------------
// Adopt operation (pure)
// ---------------------------------------------------------------------------

export interface AdoptOptions {
  eggType: EggType;
  /** Optional seed for personality roll salt (defaults to current pet count). */
  seed?: number;
  /** Injectable time source for testing. Defaults to Date.now(). */
  nowMs?: number;
}

export interface AdoptResult {
  /** The updated state (not yet persisted). */
  state: StateFileV1;
  /** Events to append to events.jsonl (caller appends under lock). */
  events: GlyphlingEvent[];
  /** The newly created pet. */
  pet: Pet;
}

/**
 * Create a new pet and return the updated state + events to emit.
 * Pure function — no I/O. Caller must:
 *   1. Call canAdopt() first and use the returned stateWithUnlock as input.
 *   2. Under a withLock(), appendEvent() each event and writeState(state).
 *
 * Throws if eggType is not a valid DEC-017 species.
 */
export function adopt(
  stateBefore: StateFileV1,
  options: AdoptOptions
): AdoptResult {
  const { eggType, seed, nowMs = Date.now() } = options;

  // Runtime guard for invalid egg type (belt + suspenders alongside TS type)
  if (!(VALID_EGG_TYPES as readonly string[]).includes(eggType)) {
    throw new Error(
      `[glyphling] adopt: invalid eggType "${eggType}". Must be one of: ${VALID_EGG_TYPES.join(", ")}.`
    );
  }

  const now = new Date(nowMs);
  const nowIso = now.toISOString();

  // Roll personality using hatch-time inputs (architecture §5.3)
  const salt = seed ?? stateBefore.pets.length;
  const personality = rollAt(
    {
      eggType,
      timeOfDay: timeOfDayBucket(now),
      dayOfWeek: now.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      cwdLanguage: "unknown",
      salt,
    },
    nowIso
  );

  const petId = ulid();

  const newPet: Pet = {
    id: petId,
    schemaVersion: 1,
    eggType,
    name: null,
    createdAt: nowIso,
    hatchedAt: nowIso,
    lastFedAt: null,
    lastInteractionAt: nowIso,
    xp: 0,
    level: 1,
    personality,
    pauseIntervals: [],
    accumulatedNeglectSeconds: 0,
    lastTickAt: nowIso,
    diedAt: null,
    tombstone: null,
    languageExposure: {},
    dailyCaps: {},
    lastLevelUpAt: null,
    lastPlayedAt: null,
    lastHatchedAt: null,
    lastEvolvedAt: null,
  };

  const events: GlyphlingEvent[] = [];

  // Emit unlock.adoption event if this is the first unlock
  if (!stateBefore.globals.unlocks.adoption) {
    events.push({
      id: ulid(),
      type: "unlock.adoption",
      ts: nowIso,
      petId: null,
      source: "adoption",
      payload: { triggeredBy: petId },
      prevHash: "",
    });
  }

  // Emit pet.adopted event
  events.push({
    id: ulid(),
    type: "pet.adopted",
    ts: nowIso,
    petId,
    source: "adoption",
    payload: {
      eggType,
      personality: {
        dominant: personality.dominant,
      },
    },
    prevHash: "",
  });

  const nextState: StateFileV1 = {
    ...stateBefore,
    pets: [...stateBefore.pets, newPet],
    globals: {
      ...stateBefore.globals,
      unlocks: { ...stateBefore.globals.unlocks, adoption: true },
    },
    updatedAt: nowIso,
  };

  return { state: nextState, events, pet: newPet };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Find the primary pet.
 * Heuristic: first non-dead pet in pets[]. If all dead, return pets[0]
 * (so dead-primary edge cases can be properly reasoned about).
 */
export function findPrimary(state: StateFileV1): Pet | null {
  if (state.pets.length === 0) return null;
  const alive = state.pets.find((p) => p.diedAt === null);
  return alive ?? state.pets[0] ?? null;
}

/**
 * Compute the unpaused age of a pet in seconds (DEC-011).
 * unpausedAge = now - hatchedAt - Σ pauseInterval.duration
 * Open (still-active) pause intervals are also subtracted.
 */
export function computeUnpausedAge(pet: Pet, nowMs: number): number {
  if (pet.hatchedAt === null) return 0;

  const hatchedMs = new Date(pet.hatchedAt).getTime();
  const totalElapsedMs = nowMs - hatchedMs;

  let pausedMs = 0;
  for (const interval of pet.pauseIntervals) {
    const start = new Date(interval.pausedAt).getTime();
    if (interval.resumedAt !== null) {
      // Closed interval: subtract entire duration
      const end = new Date(interval.resumedAt).getTime();
      pausedMs += end - start;
    } else {
      // Open interval: pet is currently paused; subtract time since pause began
      pausedMs += nowMs - start;
    }
  }

  const unpausedMs = Math.max(0, totalElapsedMs - pausedMs);
  return unpausedMs / 1000;
}
