/**
 * XPEngine — Module #15 (architecture §2.2)
 *
 * Pure reducer: no I/O, no timers, no side effects beyond the return value.
 *
 * Implements:
 *   - xpToNext(L)        — DEC-004 curve: floor(25 * L^1.20), cap at LEVEL_CAP
 *   - levelFromCumXp(x)  — inverse: highest L s.t. Σ_{k=1..L-1} xpToNext(k) ≤ x
 *   - displayLevel(L)    — "1024 · Ascendant" at cap, plain number otherwise
 *   - applyEvent(e, pet) — fold one GlyphlingEvent onto a Pet; returns {pet, sideEffects}
 *   - XP_PER_SIGNAL      — preliminary per-signal XP values (see §6.3 table)
 *
 * PRELIMINARY XP VALUES (TODO-006)
 * ─────────────────────────────────
 * These numbers were chosen to hit the DEC-004 budget estimate of ~2,000 XP/day
 * for a "heavy use" developer. They have NOT been validated through Phase 1 testing
 * and must be calibrated before public release (architecture §13, risk #4).
 *
 *   tokens.delta  : floor(tokens / 500) — 1 XP per 500 tokens
 *                   (§6.3: emit when ≥5000 tokens OR 60s elapsed with any tokens)
 *   git.commit    : 25 XP flat per commit
 *   test.pass     : 5 XP per new passing test, capped at 50 XP/run
 *   file.edit     : 1 XP per edited file-minute, capped at 100 XP/day
 *   error.fixed   : 15 XP flat
 *   daily.checkin : 20 XP base + streak bonus (+10% per consecutive day, cap ×2.0)
 *   pet.fed/played: 5 XP flat
 *
 * Rough daily budget at heavy use (~8h of coding):
 *   tokens: ~100k tokens → 200 XP
 *   commits: ~8 commits → 200 XP
 *   tests: ~20 test runs, 50 XP cap each → up to 1000 XP (dedupe will limit this)
 *   edits: ~100 file-minute events → 100 XP (at daily cap)
 *   checkin: 20 XP
 *   fed/played: ~30 XP
 *   ≈ 1550–2000 XP/day — consistent with DEC-004's "heavy use" estimate.
 *
 * DEC-018 DAILY CAPS
 * ──────────────────
 * Per-signal caps enforced per UTC day (YYYY-MM-DD key in pet.dailyCaps).
 * Excess is partially granted (up to the cap) and the remainder logged as
 * signal.rejected { reason: "cap.daily" }. Stale days pruned on each tick
 * (retain last 7 days).
 *
 *   tokens  : 6000 XP/day
 *   tests   : 200  XP/day
 *   commits : 500  XP/day
 *   edits   : 100  XP/day
 *
 * @see DEC-004 (XP curve + 1024 cap)
 * @see DEC-018 (integrity model + daily caps)
 * @see architecture §6.3 (per-signal rate limits and dedupe)
 * @see architecture §6.4 (XP fold algorithm)
 */

import { ulid } from "ulid";
import type { Pet, StateFileV1, DailyCaps, SignalType } from "../state/schema.js";
import type { GlyphlingEvent } from "../events/bus.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The sacred level cap (DEC-004). Never soften, never round. */
export const LEVEL_CAP = 1024 as const;

/** Honorific appended to the display name at LEVEL_CAP (DEC-004). */
export const ASCENDANT_HONORIFIC = "Ascendant" as const;

// ---------------------------------------------------------------------------
// DEC-018: Daily XP caps
// ---------------------------------------------------------------------------

/** Daily XP cap for tokens.delta events (DEC-018). */
export const DAILY_CAP_TOKENS = 6000;

/** Daily XP cap for test.pass events (DEC-018). */
export const DAILY_CAP_TESTS = 200;

/** Daily XP cap for git.commit events (DEC-018). */
export const DAILY_CAP_COMMITS = 500;

/** Daily XP cap for file.edit events (DEC-018). */
export const DAILY_CAP_EDITS = 100;

/** How many days of cap data to retain in pet.dailyCaps (DEC-018). */
export const DAILY_CAPS_RETENTION_DAYS = 7;

// ---------------------------------------------------------------------------
// XP curve (DEC-004)
// ---------------------------------------------------------------------------

/**
 * XP required to advance from level L to level L+1.
 *
 * Formula: floor(25 * L^1.20) per DEC-004 (exponent amended 2026-04-17).
 * At L >= LEVEL_CAP: returns 0 (pet is Ascendant; callers should gate on level).
 */
export function xpToNext(L: number): number {
  if (L >= LEVEL_CAP) return 0;
  return Math.floor(25 * Math.pow(L, 1.20));
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
 * Uses binary search on the precomputed table. Monotonic; saturates at 1024.
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
 * At LEVEL_CAP, appends the "Ascendant" honorific (DEC-004).
 *
 * HUD variants per docs/design/compact-frames.md §4 (variant 3 — Ascendant):
 *   Normal:    "42"
 *   Ascendant: "1024 · Ascendant"
 */
export function displayLevel(L: number): string {
  if (L >= LEVEL_CAP) return `${LEVEL_CAP} · ${ASCENDANT_HONORIFIC}`;
  return String(L);
}

// ---------------------------------------------------------------------------
// Per-signal XP values (PRELIMINARY — see file-level comment)
// ---------------------------------------------------------------------------

/** XP awarded per 500 tokens in a tokens.delta event. */
export const XP_PER_500_TOKENS = 1;

/**
 * Compute the XP delta for a tokens.delta event payload.
 * @param tokens Total token count in the delta.
 */
export function xpForTokens(tokens: number): number {
  return Math.floor(tokens / 500) * XP_PER_500_TOKENS;
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
// DEC-018: Daily cap helpers
// ---------------------------------------------------------------------------

/**
 * Map an event type to its daily-cap SignalType key (or null if not capped).
 */
function signalTypeForEvent(eventType: string): SignalType | null {
  switch (eventType) {
    case "tokens.delta": return "tokens";
    case "test.pass":    return "tests";
    case "git.commit":   return "commits";
    case "file.edit":    return "edits";
    default:             return null;
  }
}

/**
 * Return the cap limit (in XP) for a given SignalType.
 */
function dailyCapLimit(signalType: SignalType): number {
  switch (signalType) {
    case "tokens":  return DAILY_CAP_TOKENS;
    case "tests":   return DAILY_CAP_TESTS;
    case "commits": return DAILY_CAP_COMMITS;
    case "edits":   return DAILY_CAP_EDITS;
  }
}

/**
 * Derive the UTC date string (YYYY-MM-DD) from an ISO8601 timestamp.
 */
function utcDateKey(ts: string): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Prune pet.dailyCaps to retain only the last DAILY_CAPS_RETENTION_DAYS days.
 */
function pruneDailyCaps(caps: DailyCaps, today: string): DailyCaps {
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - DAILY_CAPS_RETENTION_DAYS + 1);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  const pruned: DailyCaps = {};
  for (const [day, signals] of Object.entries(caps)) {
    if (day >= cutoffKey) {
      pruned[day] = signals;
    }
  }
  return pruned;
}

/**
 * Apply DEC-018 daily cap logic to an xpDelta.
 *
 * Returns:
 *  - `grantedXp`: the XP actually to be granted (0 if fully capped)
 *  - `updatedCaps`: new dailyCaps after applying the grant
 *  - `capExceeded`: true if any XP was withheld
 *  - `requestedXp`: the original xpDelta (for the rejection event payload)
 */
function applyDailyCap(
  xpDelta: number,
  signalType: SignalType,
  today: string,
  currentCaps: DailyCaps
): {
  grantedXp: number;
  updatedCaps: DailyCaps;
  capExceeded: boolean;
  requestedXp: number;
} {
  const cap = dailyCapLimit(signalType);
  const dayData: Partial<Record<SignalType, number>> = currentCaps[today] ?? {};
  const accumulated = dayData[signalType] ?? 0;
  const remaining = Math.max(0, cap - accumulated);

  const grantedXp = Math.min(xpDelta, remaining);
  const capExceeded = grantedXp < xpDelta;

  // DailyCapsSchema uses z.record(SignalTypeSchema, ...) which TypeScript infers
  // as Partial<Record<SignalType, number>>. We spread the existing partial record
  // and set the specific key — the resulting object satisfies the schema at runtime.
  const updatedDay = {
    ...dayData,
    [signalType]: accumulated + grantedXp,
  } as Record<SignalType, number>;

  const updatedCaps: DailyCaps = {
    ...currentCaps,
    [today]: updatedDay,
  };

  return { grantedXp, updatedCaps, capExceeded, requestedXp: xpDelta };
}

// ---------------------------------------------------------------------------
// applyEvent — pure XP fold (architecture §6.4 + DEC-018)
// ---------------------------------------------------------------------------

export interface ApplyEventResult {
  pet: Pet;
  sideEffects: GlyphlingEvent[];
}

/**
 * Apply a GlyphlingEvent to a Pet.
 *
 * Pure reducer: accepts current Pet, returns a new Pet + any derived side-effect
 * events (level.up, unlock.gif.*, unlock.adoption, signal.rejected, etc.).
 * No I/O.
 *
 * Algorithm (§6.4 + DEC-018):
 *  1. If event.id has already been applied (event byte position <= eventsCursor)
 *     — no-op. The cursor check is the caller's responsibility; this function
 *     instead checks event.id order via a per-call guard parameter.
 *  2. If pet.diedAt != null — no-op (dead pets earn nothing).
 *  3. If event.xpDelta is defined and > 0:
 *     a. DEC-018: check daily cap for this signal type.
 *     b. Grant only the XP up to the cap; emit signal.rejected for the excess.
 *     c. pet.xp += grantedXp.
 *  4. Derive new level via levelFromCumXp(pet.xp).
 *  5. If newLevel > pet.level: emit level.up side-effect event.
 *  6. Clamp displayed level at 1024; raw XP keeps accumulating (vanity).
 *  7. Check unlock thresholds; emit unlock.* events if newly crossed.
 *  8. At level 1024: emit unlock.gif.tier3 + ascended notice (if new).
 *  9. Prune pet.dailyCaps to last 7 days.
 *
 * Cursor-based dedupe: caller passes `lastAppliedId` (ULID of the last
 * applied event, or "" to skip). If event.id <= lastAppliedId, it is a no-op.
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

  // signal.rejected events are informational — they don't award XP but we
  // still record them as applied (the pet doesn't change).
  if (event.type === "signal.rejected") {
    return { pet, sideEffects: [] };
  }

  // If the event carries no XP delta, return the pet unchanged (but still
  // record this event in the cursor — handled by the caller).
  if (event.xpDelta === undefined || event.xpDelta <= 0) {
    return { pet, sideEffects: [] };
  }

  const sideEffects: GlyphlingEvent[] = [];
  const now = new Date().toISOString();
  const today = utcDateKey(event.ts);

  // -------------------------------------------------------------------------
  // DEC-018 Mechanism 3: daily XP cap enforcement
  // -------------------------------------------------------------------------
  let effectiveXpDelta = event.xpDelta;
  let updatedDailyCaps = pruneDailyCaps(pet.dailyCaps, today);

  const signalType = signalTypeForEvent(event.type);
  if (signalType !== null) {
    const {
      grantedXp,
      updatedCaps,
      capExceeded,
      requestedXp,
    } = applyDailyCap(event.xpDelta, signalType, today, updatedDailyCaps);

    updatedDailyCaps = updatedCaps;
    effectiveXpDelta = grantedXp;

    if (capExceeded) {
      // Emit a signal.rejected event for the capped-off XP
      sideEffects.push({
        id: ulid(),
        type: "signal.rejected",
        ts: now,
        petId: pet.id,
        source: "xp-engine",
        payload: {
          reason: "cap.daily",
          signal: event.type,
          origEventId: event.id,
          requestedXp,
          grantedXp,
        },
      });
    }

    // If the cap grants zero XP, the pet doesn't change (but side effects
    // including the rejection event are still returned).
    if (effectiveXpDelta <= 0) {
      const updatedPet: Pet = {
        ...pet,
        dailyCaps: updatedDailyCaps,
      };
      return { pet: updatedPet, sideEffects };
    }
  }

  // Step 3: add XP
  const newXp = pet.xp + effectiveXpDelta;

  // Step 4: derive new level (caps at LEVEL_CAP)
  const newLevel = levelFromCumXp(newXp);

  // Step 5: emit level.up if level changed
  if (newLevel > pet.level) {
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

    // Step 8: level 1024 ascension
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

  // Step 6: clamp displayed level at 1024; XP continues to accumulate (vanity)
  const clampedLevel = Math.min(newLevel, LEVEL_CAP);

  // Step 9: update pet with new XP, level, and pruned+updated dailyCaps
  const updatedPet: Pet = {
    ...pet,
    xp: newXp,
    level: clampedLevel,
    dailyCaps: updatedDailyCaps,
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
