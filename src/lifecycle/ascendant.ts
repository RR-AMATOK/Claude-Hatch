/**
 * Ascendant helpers (DEC-019, D6)
 *
 * Once a pet reaches level 1024 it becomes an Ascendant.
 * Ascendants are immune to sickness and death — the lifecycle clock does not
 * accumulate neglect for them, and no health/death events are emitted.
 *
 * Use `isAscendant(pet)` wherever code needs to gate on this immunity.
 *
 * The helper is intentionally placed here (not in xp/engine.ts) to avoid a
 * circular dependency: clock.ts already imports from state/schema.ts, and
 * xp/engine.ts is a heavy module with its own precomputed table. This
 * lightweight helper is safe to import from both.
 */

import { levelFromCumXp, LEVEL_CAP } from "../xp/engine.js";
import type { Pet } from "../state/schema.js";

/**
 * Returns true if the pet has reached LEVEL_CAP (1024) and is therefore
 * an Ascendant — immune to sickness, hunger, and death.
 *
 * Uses levelFromCumXp(pet.xp) rather than pet.level so that the gate is
 * always derived from the source-of-truth XP value and cannot be gamed by
 * direct state mutations that only update pet.level.
 */
export function isAscendant(pet: Pick<Pet, "xp">): boolean {
  return levelFromCumXp(pet.xp) >= LEVEL_CAP;
}

/**
 * Ascendant aura mood key — replaces the sickness mood glyph for L1024 pets.
 * Matches the MoodKey type in compact.ts ("content" maps to the calm aura).
 */
export const ASCENDANT_MOOD = "content" as const;
