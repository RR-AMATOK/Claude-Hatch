/**
 * XPEngine — Module #15 (architecture §2.2)
 *
 * Pure reducer: no I/O, no timers, no side effects beyond the return value.
 *
 * Implements:
 *   - xpToNext(L)        — DEC-020 golden curve: floor(2 * L^φ), cap at LEVEL_CAP
 *   - levelFromCumXp(x)  — inverse: highest L s.t. Σ_{k=1..L-1} xpToNext(k) ≤ x
 *   - displayLevel(L)    — "1618 · Ascendant" at cap, plain number otherwise
 *   - applyEvent(e, pet) — fold one GlyphlingEvent onto a Pet; returns {pet, sideEffects}
 *   - XP_PER_SIGNAL      — preliminary per-signal XP values (see §6.3 table)
 *
 * GOLDEN XP CURVE (DEC-020)
 * ─────────────────────────
 *   xpToNext(L) = floor(2 * L^φ)   where φ = (1 + √5) / 2 ≈ 1.6180339887498949
 *   LEVEL_CAP   = 1618              (the Golden Level = ⌊φ × 1000⌋)
 *
 * The exponent is φ itself — a structurally golden curve.
 * At L=1618, xpToNext returns 0 (Ascendant). XP keeps accumulating past cap (vanity).
 *
 * PRELIMINARY XP VALUES (TODO-006)
 * ─────────────────────────────────
 * These numbers were chosen to hit a ~2,000 XP/day budget for a "heavy use"
 * developer. They have NOT been validated through Phase 1 testing and must be
 * calibrated before public release (architecture §13, risk #4).
 *
 *   tokens.delta  : floor(tokens / 1000) — 1 XP per 1000 tokens  (DEC-020: 1/500 → 1/1000)
 *                   (§6.3: emit when ≥5000 tokens OR 60s elapsed with any tokens)
 *   git.commit    : 25 XP flat per commit
 *   test.pass     : 5 XP per new passing test, capped at 50 XP/run
 *   file.edit     : 1 XP per edited file-minute
 *   error.fixed   : 15 XP flat
 *   daily.checkin : 20 XP base + streak bonus (+10% per consecutive day, cap ×2.0)
 *   pet.fed/played: 5 XP flat
 *
 * DEC-020: NO DAILY CAPS
 * ─────────────────────
 * Daily per-signal XP caps are removed. Rate-limits and cursor-based dedupe
 * (DEC-018 Mechanisms 1-4) remain in effect to prevent pathological throughput.
 *
 * @see DEC-004 (XP curve history)
 * @see DEC-018 (integrity model; Mechanism 3 daily caps removed per DEC-020)
 * @see DEC-020 (golden curve + cap bump to 1618)
 * @see architecture §6.3 (per-signal rate limits and dedupe)
 * @see architecture §6.4 (XP fold algorithm)
 */

import { ulid } from "ulid";
import type { Pet, StateFileV1 } from "../state/schema.js";
import type { GlyphlingEvent } from "../events/bus.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The golden ratio φ = (1 + √5) / 2.
 * Used as the exponent in the DEC-020 XP curve: xpToNext(L) = floor(2 * L^φ).
 */
export const PHI = (1 + Math.sqrt(5)) / 2;

/** The sacred level cap — the Golden Level (DEC-020). Never soften, never round. */
export const LEVEL_CAP = 1618 as const;

/** Honorific appended to the display name at LEVEL_CAP (DEC-004/DEC-020). */
export const ASCENDANT_HONORIFIC = "Ascendant" as const;

// ---------------------------------------------------------------------------
// Token XP denominator (DEC-020)
// ---------------------------------------------------------------------------

/**
 * Number of tokens per 1 XP in tokens.delta events (DEC-020: 1 XP per 1000 tokens).
 * Single constant so future tuning is a one-line change.
 */
export const XP_PER_TOKEN_DENOMINATOR = 1000;

// ---------------------------------------------------------------------------
// XP curve (DEC-020)
// ---------------------------------------------------------------------------

/**
 * XP required to advance from level L to level L+1.
 *
 * Formula: floor(2 * L^φ) per DEC-020.
 * At L >= LEVEL_CAP: returns 0 (pet is Ascendant; callers should gate on level).
 *
 * Computability constraint: result is exact in IEEE-754 double for L ≤ 1619
 * and the Math.floor maps cleanly to a non-negative 32-bit integer.
 */
export function xpToNext(L: number): number {
  if (L >= LEVEL_CAP) return 0;
  return Math.floor(2 * Math.pow(L, PHI));
}

// ---------------------------------------------------------------------------
// Cumulative XP table
// ---------------------------------------------------------------------------

/**
 * Precomputed cumulative XP table: cumulativeTable[L] = total XP to reach level L.
 *
 * cumulativeTable[1] = 0        (level 1 starts at 0 XP)
 * cumulativeTable[2] = xpToNext(1)
 * cumulativeTable[L] = Σ_{k=1..L-1} xpToNext(k)
 *
 * Built lazily on first use and cached for the process lifetime.
 */
let _cumulativeTable: number[] | null = null;

function getCumulativeTable(): number[] {
  if (_cumulativeTable !== null) return _cumulativeTable;

  // Index 0 is unused; table[L] = cumulative XP needed to be at level L.
  const table = new Array<number>(LEVEL_CAP + 1).fill(0);
  let running = 0;
  for (let k = 1; k <= LEVEL_CAP; k++) {
    table[k] = running;
    running += xpToNext(k);
  }
  _cumulativeTable = table;
  return table;
}

/**
 * Cumulative XP required to be at level L (i.e., Σ_{k=1..L-1} xpToNext(k)).
 * Level 1 = 0 XP; level 2 = xpToNext(1) XP; etc.
 * Saturates at LEVEL_CAP.
 */
export function cumulativeXpForLevel(L: number): number {
  const lvl = Math.min(Math.max(1, Math.floor(L)), LEVEL_CAP);
  const table = getCumulativeTable();
  return table[lvl] ?? 0;
}

// ---------------------------------------------------------------------------
// Level derivation
// ---------------------------------------------------------------------------

/**
 * Derive the highest level L (in [1, LEVEL_CAP]) for which
 * cumulativeXpForLevel(L) <= cumXp.
 *
 * Uses binary search on the precomputed table. Monotonic; saturates at 1618.
 */
export function levelFromCumXp(cumXp: number): number {
  if (cumXp < 0) return 1;
  const table = getCumulativeTable();

  let lo = 1;
  let hi = LEVEL_CAP;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((table[mid] ?? Infinity) <= cumXp) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Returns the level string for display in HUD / status line.
 * At LEVEL_CAP, appends the "Ascendant" honorific (DEC-004/DEC-020).
 *
 * HUD variants per docs/design/compact-frames.md §4 (variant 3 — Ascendant):
 *   Normal:    "42"
 *   Ascendant: "1618 · Ascendant"
 */
export function displayLevel(L: number): string {
  if (L >= LEVEL_CAP) return `${LEVEL_CAP} · ${ASCENDANT_HONORIFIC}`;
  return String(L);
}

// ---------------------------------------------------------------------------
// Per-signal XP values (PRELIMINARY — see file-level comment)
// ---------------------------------------------------------------------------

/**
 * Compute the XP delta for a tokens.delta event payload.
 * @param tokens Total token count in the delta.
 */
export function xpForTokens(tokens: number): number {
  return Math.floor(tokens / XP_PER_TOKEN_DENOMINATOR);
}

/** XP per git commit (§6.3). */
export const XP_PER_COMMIT = 25;

/** XP per new passing test (§6.3). */
export const XP_PER_TEST_PASS = 5;

/** Max XP per test run (§6.3 cap: 50/run). */
export const XP_PER_TEST_RUN_CAP = 50;

/** XP per edited file-minute (§6.3). */
export const XP_PER_FILE_EDIT = 1;

/** XP per error.fixed event (§6.3). */
export const XP_PER_ERROR_FIXED = 15;

/** Base XP for daily.checkin (§6.3). */
export const XP_DAILY_CHECKIN_BASE = 20;

/** XP multiplier bonus per consecutive day (+10%, cap ×2.0 at 10-day streak). */
export const XP_DAILY_STREAK_BONUS_PER_DAY = 0.10;

/** Maximum streak multiplier (10-day streak = ×2.0). */
export const XP_DAILY_STREAK_MAX_MULTIPLIER = 2.0;

/** XP per pet.fed or pet.played command (§6.3). */
export const XP_PER_INTERACTION = 5;

// ---------------------------------------------------------------------------
// applyEvent — pure XP fold (architecture §6.4)
// ---------------------------------------------------------------------------

export interface ApplyEventResult {
  pet: Pet;
  sideEffects: GlyphlingEvent[];
}

/**
 * Apply a GlyphlingEvent to a Pet.
 *
 * Pure reducer: accepts current Pet, returns a new Pet + any derived side-effect
 * events (level.up, unlock.gif.*, unlock.adoption, etc.). No I/O.
 *
 * Algorithm (§6.4):
 *  1. If event.id has already been applied (event.id <= lastAppliedId) — no-op.
 *  2. If pet.diedAt != null — no-op (dead pets earn nothing).
 *  3. If event.xpDelta is defined and > 0: pet.xp += xpDelta.
 *  4. Derive new level via levelFromCumXp(pet.xp).
 *  5. If newLevel > pet.level: emit level.up side-effect event.
 *  6. Clamp displayed level at LEVEL_CAP; raw XP keeps accumulating (vanity).
 *  7. Check unlock thresholds; emit unlock.* events if newly crossed.
 *  8. At LEVEL_CAP: emit unlock.gif.tier3 + ascended notice (if new).
 *
 * DEC-020: Daily caps removed. Rate-limits and cursor dedupe (DEC-018 Mechanisms 1-4)
 * remain in effect.
 *
 * @param event          The event to apply.
 * @param pet            Current pet state.
 * @param lastAppliedId  ULID of the last successfully applied event ("" to skip).
 */
export function applyEvent(
  event: GlyphlingEvent,
  pet: Pet,
  lastAppliedId = ""
): ApplyEventResult {
  // Step 1: cursor-based dedupe (ULID is lexicographically monotonic)
  if (lastAppliedId !== "" && event.id <= lastAppliedId) {
    return { pet, sideEffects: [] };
  }

  // Step 2: dead pets earn nothing
  if (pet.diedAt !== null) {
    return { pet, sideEffects: [] };
  }

  // signal.rejected events are informational — they don't award XP.
  if (event.type === "signal.rejected") {
    return { pet, sideEffects: [] };
  }

  // If the event carries no XP delta, return the pet unchanged.
  if (event.xpDelta === undefined || event.xpDelta <= 0) {
    return { pet, sideEffects: [] };
  }

  const sideEffects: GlyphlingEvent[] = [];
  const now = new Date().toISOString();

  // Step 3: add XP
  const newXp = pet.xp + event.xpDelta;

  // Step 4: derive new level (caps at LEVEL_CAP)
  const newLevel = levelFromCumXp(newXp);

  // Step 5: emit level.up if level changed; record the timestamp for the renderer.
  let lastLevelUpAt = pet.lastLevelUpAt ?? null;

  if (newLevel > pet.level) {
    lastLevelUpAt = now;

    sideEffects.push({
      id: ulid(),
      type: "level.up",
      ts: now,
      petId: pet.id,
      source: "xp-engine",
      payload: { from: pet.level, to: newLevel },
    });

    // Step 7a: GIF unlock thresholds — only emit if crossing the threshold
    // (old level was strictly below, new level is at or above).
    if (pet.level < 25 && newLevel >= 25) {
      sideEffects.push(makeUnlockEvent("unlock.gif.tier1", pet.id, now));
    }
    if (pet.level < 250 && newLevel >= 250) {
      sideEffects.push(makeUnlockEvent("unlock.gif.tier2", pet.id, now));
    }

    // Step 8: LEVEL_CAP ascension
    if (pet.level < LEVEL_CAP && newLevel >= LEVEL_CAP) {
      sideEffects.push(makeUnlockEvent("unlock.gif.tier3", pet.id, now));
      // Ascension marker — renderer checks payload.ascended === true on level.up events
      sideEffects.push({
        id: ulid(),
        type: "level.up",
        ts: now,
        petId: pet.id,
        source: "xp-engine",
        payload: { ascended: true, level: LEVEL_CAP },
      });
    }
  }

  // Step 6: clamp displayed level at LEVEL_CAP; XP continues to accumulate (vanity)
  const clampedLevel = Math.min(newLevel, LEVEL_CAP);

  const updatedPet: Pet = {
    ...pet,
    xp: newXp,
    level: clampedLevel,
    lastLevelUpAt,
  };

  return { pet: updatedPet, sideEffects };
}

/**
 * Build a fold function compatible with StateStore.dispatch(APPLY_EVENT).
 *
 * Given an event that carries xpDelta, applies it to the matching pet in state.
 * Side effects (level.up, unlocks) are emitted onto the provided EventBus.
 *
 * Usage:
 *   const fold = makeXpFold();
 *   await store.dispatch({ type: "APPLY_EVENT", event, fold });
 */
export function makeXpFold(): (state: StateFileV1, event: GlyphlingEvent) => StateFileV1 {
  return (state, event) => {
    if (!event.petId) return state;

    const petIndex = state.pets.findIndex((p) => p.id === event.petId);
    if (petIndex === -1) return state;

    const pet = state.pets[petIndex];
    if (!pet) return state;

    // Compute the ULID of the last applied event from eventsCursor.
    // Since we use byte offsets (not ULIDs) as the cursor, we pass "" here
    // and rely on the caller's cursor management for idempotency.
    const { pet: updatedPet, sideEffects } = applyEvent(event, pet);

    if (sideEffects.length === 0 && updatedPet === pet) return state;

    const updatedPets = [...state.pets];
    updatedPets[petIndex] = updatedPet;

    // Apply unlock flags from side effects
    let unlocks = { ...state.globals.unlocks };
    for (const se of sideEffects) {
      if (se.type === "unlock.gif.tier1") unlocks = { ...unlocks, gifTier1: true };
      if (se.type === "unlock.gif.tier2") unlocks = { ...unlocks, gifTier2: true };
      if (se.type === "unlock.gif.tier3") unlocks = { ...unlocks, gifTier3: true };
    }

    return {
      ...state,
      pets: updatedPets,
      globals: {
        ...state.globals,
        unlocks,
      },
      updatedAt: new Date().toISOString(),
    };
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makeUnlockEvent(
  type: "unlock.gif.tier1" | "unlock.gif.tier2" | "unlock.gif.tier3" | "unlock.adoption",
  petId: string,
  ts: string
): GlyphlingEvent {
  return {
    id: ulid(),
    type,
    ts,
    petId,
    source: "xp-engine",
    payload: {},
  };
}
