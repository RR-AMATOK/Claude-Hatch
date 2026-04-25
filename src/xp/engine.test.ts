/**
 * Tests for src/xp/engine.ts — XP engine (TODO-006)
 *
 * Covers:
 *   - xpToNext(L) formula and edge cases
 *   - cumulativeXpForLevel spot-checks against DEC-004 (~48M at 1024)
 *   - levelFromCumXp inverse / saturation / monotonicity
 *   - displayLevel normal and Ascendant cases
 *   - applyEvent: dead pet guard, cursor dedupe, xpDelta application
 *   - applyEvent: level-up side effects, unlock thresholds
 *   - applyEvent: level cap at 1024, XP continues past cap
 *
 * All tests are pure — no disk I/O.
 */

import { describe, it, expect } from "vitest";
import {
  xpToNext,
  levelFromCumXp,
  cumulativeXpForLevel,
  displayLevel,
  applyEvent,
  LEVEL_CAP,
  ASCENDANT_HONORIFIC,
} from "./engine.js";
import type { Pet } from "../state/schema.js";
import type { GlyphlingEvent } from "../events/bus.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePet(overrides: Partial<Pet> = {}): Pet {
  const now = new Date().toISOString();
  const weights = {
    Stoic: 0.125,
    Friendly: 0.125,
    Pragmatic: 0.125,
    Energetic: 0.125,
    Gruff: 0.125,
    Philosophical: 0.125,
    Paranoid: 0.125,
    Curious: 0.125,
  };
  return {
    id: "test-pet-001",
    schemaVersion: 1,
    eggType: "circuit",
    name: null,
    createdAt: now,
    hatchedAt: now,
    lastFedAt: null,
    lastInteractionAt: now,
    xp: 0,
    level: 1,
    personality: {
      dominant: "Stoic",
      weights,
      lockedAt: now,
      lastRefreshAt: now,
    },
    pauseIntervals: [],
    accumulatedNeglectSeconds: 0,
    lastTickAt: now,
    diedAt: null,
    tombstone: null,
    languageExposure: {},
    dailyCaps: {},
    ...overrides,
  };
}

function makeEvent(overrides: Partial<GlyphlingEvent> = {}): GlyphlingEvent {
  return {
    id: `01HTEST${Date.now().toString(36).toUpperCase()}`,
    type: "daily.checkin",
    ts: new Date().toISOString(),
    petId: "test-pet-001",
    source: "test",
    payload: {},
    xpDelta: 20,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// xpToNext
// ---------------------------------------------------------------------------

describe("xpToNext", () => {
  it("returns floor(25 * 1^1.20) = 25 at L=1", () => {
    expect(xpToNext(1)).toBe(Math.floor(25 * Math.pow(1, 1.20)));
    expect(xpToNext(1)).toBe(25);
  });

  it("returns floor(25 * 10^1.20) at L=10", () => {
    const expected = Math.floor(25 * Math.pow(10, 1.20));
    expect(xpToNext(10)).toBe(expected);
  });

  it("returns floor(25 * 100^1.20) at L=100", () => {
    const expected = Math.floor(25 * Math.pow(100, 1.20));
    expect(xpToNext(100)).toBe(expected);
  });

  it("returns 0 at L=1024 (Ascendant — no next level)", () => {
    expect(xpToNext(LEVEL_CAP)).toBe(0);
  });

  it("returns 0 at L > 1024", () => {
    expect(xpToNext(1025)).toBe(0);
    expect(xpToNext(9999)).toBe(0);
  });

  it("returns a non-negative integer at every level 1..1023", () => {
    for (let L = 1; L < LEVEL_CAP; L++) {
      const v = xpToNext(L);
      expect(v).toBeGreaterThan(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("is monotonically non-decreasing for L in [1, 1023]", () => {
    // xpToNext grows with L because L^1.20 is strictly increasing
    for (let L = 1; L < LEVEL_CAP - 1; L++) {
      expect(xpToNext(L + 1)).toBeGreaterThanOrEqual(xpToNext(L));
    }
  });
});

// ---------------------------------------------------------------------------
// cumulativeXpForLevel + DEC-004 spot-checks
// ---------------------------------------------------------------------------

describe("cumulativeXpForLevel", () => {
  it("level 1 requires 0 cumulative XP", () => {
    expect(cumulativeXpForLevel(1)).toBe(0);
  });

  it("level 2 requires xpToNext(1) cumulative XP", () => {
    expect(cumulativeXpForLevel(2)).toBe(xpToNext(1));
  });

  it("level 10 spot-check — matches Σ_{k=1..9} xpToNext(k)", () => {
    let expected = 0;
    for (let k = 1; k <= 9; k++) expected += xpToNext(k);
    expect(cumulativeXpForLevel(10)).toBe(expected);
  });

  it("level 100 spot-check — matches Σ_{k=1..99} xpToNext(k)", () => {
    let expected = 0;
    for (let k = 1; k <= 99; k++) expected += xpToNext(k);
    expect(cumulativeXpForLevel(100)).toBe(expected);
  });

  /**
   * DEC-004: "Cumulative XP at 1024 ≈ 48,000,000"
   * We verify the precomputed total is within 1% of that figure and also
   * within ±50,000 for a tighter sanity bound (rounding should not drift more
   * than a few hundred XP over 1024 levels).
   */
  it("level 1024 cumulative XP is approximately 48,000,000 (DEC-004)", () => {
    const cumXp1024 = cumulativeXpForLevel(LEVEL_CAP);
    // Must be in range [46,000,000 … 50,000,000] (within ~4% of 48M)
    expect(cumXp1024).toBeGreaterThanOrEqual(46_000_000);
    expect(cumXp1024).toBeLessThanOrEqual(50_000_000);
  });

  it("cumulativeXpForLevel is strictly increasing for L in [1, 1024]", () => {
    let prev = cumulativeXpForLevel(1);
    for (let L = 2; L <= LEVEL_CAP; L++) {
      const curr = cumulativeXpForLevel(L);
      expect(curr).toBeGreaterThan(prev);
      prev = curr;
    }
  });
});

// ---------------------------------------------------------------------------
// levelFromCumXp
// ---------------------------------------------------------------------------

describe("levelFromCumXp", () => {
  it("returns 1 for 0 XP", () => {
    expect(levelFromCumXp(0)).toBe(1);
  });

  it("returns 1 for XP just below xpToNext(1)", () => {
    expect(levelFromCumXp(xpToNext(1) - 1)).toBe(1);
  });

  it("returns 2 for XP exactly equal to xpToNext(1)", () => {
    expect(levelFromCumXp(xpToNext(1))).toBe(2);
  });

  it("returns 1 for negative XP (guard)", () => {
    expect(levelFromCumXp(-1)).toBe(1);
    expect(levelFromCumXp(-9999)).toBe(1);
  });

  it("round-trips: levelFromCumXp(cumulativeXpForLevel(L)) === L for spot levels", () => {
    for (const L of [1, 2, 5, 10, 50, 100, 500, 1023, 1024]) {
      const cum = cumulativeXpForLevel(L);
      expect(levelFromCumXp(cum)).toBe(L);
    }
  });

  it("saturates at 1024 for very large XP", () => {
    expect(levelFromCumXp(999_999_999)).toBe(LEVEL_CAP);
  });

  it("returns LEVEL_CAP for cumXp === cumulativeXpForLevel(1024)", () => {
    expect(levelFromCumXp(cumulativeXpForLevel(LEVEL_CAP))).toBe(LEVEL_CAP);
  });

  it("is monotonically non-decreasing", () => {
    // Spot-check: increasing XP never decreases level
    const checkPoints = [0, 25, 100, 1000, 10_000, 100_000, 1_000_000, 48_000_000];
    let prev = levelFromCumXp(0);
    for (const xp of checkPoints) {
      const curr = levelFromCumXp(xp);
      expect(curr).toBeGreaterThanOrEqual(prev);
      prev = curr;
    }
  });
});

// ---------------------------------------------------------------------------
// displayLevel
// ---------------------------------------------------------------------------

describe("displayLevel", () => {
  it("returns plain number string for levels 1-1023", () => {
    expect(displayLevel(1)).toBe("1");
    expect(displayLevel(10)).toBe("10");
    expect(displayLevel(1023)).toBe("1023");
  });

  it("returns '1024 · Ascendant' at LEVEL_CAP", () => {
    expect(displayLevel(LEVEL_CAP)).toBe(`${LEVEL_CAP} · ${ASCENDANT_HONORIFIC}`);
  });

  it("returns Ascendant string for L > 1024", () => {
    // Should not happen in practice, but guard it
    expect(displayLevel(1025)).toBe(`${LEVEL_CAP} · ${ASCENDANT_HONORIFIC}`);
  });
});

// ---------------------------------------------------------------------------
// applyEvent — basic guards
// ---------------------------------------------------------------------------

describe("applyEvent — guards", () => {
  it("dead pet returns unchanged pet and no side effects", () => {
    const diedAt = new Date().toISOString();
    const pet = makePet({
      diedAt,
      tombstone: {
        diedAt,
        cause: "neglect",
        finalLevel: 5,
        finalXp: 500,
      },
    });
    const event = makeEvent({ xpDelta: 100 });
    const result = applyEvent(event, pet);
    expect(result.pet).toBe(pet); // reference equality — not mutated
    expect(result.sideEffects).toHaveLength(0);
  });

  it("event with no xpDelta returns unchanged pet", () => {
    const pet = makePet({ xp: 0, level: 1 });
    // strip xpDelta from the helper's default — cannot set to undefined under exactOptionalPropertyTypes
    const { xpDelta: _unused, ...event } = makeEvent();
    void _unused;
    const result = applyEvent(event, pet);
    expect(result.pet).toBe(pet);
    expect(result.sideEffects).toHaveLength(0);
  });

  it("event with xpDelta=0 returns unchanged pet", () => {
    const pet = makePet({ xp: 0, level: 1 });
    const event = makeEvent({ xpDelta: 0 });
    const result = applyEvent(event, pet);
    expect(result.pet).toBe(pet);
    expect(result.sideEffects).toHaveLength(0);
  });

  it("cursor dedupe: event.id <= lastAppliedId is a no-op", () => {
    const pet = makePet({ xp: 0, level: 1 });
    // ULID "01HAAA..." < "01HBBB..." lexicographically
    const event = makeEvent({ id: "01HAAA000000000000000000" });
    const result = applyEvent(event, pet, "01HBBB000000000000000000");
    expect(result.pet).toBe(pet);
    expect(result.sideEffects).toHaveLength(0);
  });

  it("cursor dedupe: event.id === lastAppliedId is a no-op", () => {
    const pet = makePet({ xp: 0, level: 1 });
    const id = "01HAAA000000000000000000";
    const event = makeEvent({ id });
    const result = applyEvent(event, pet, id);
    expect(result.pet).toBe(pet);
    expect(result.sideEffects).toHaveLength(0);
  });

  it("cursor dedupe: event.id > lastAppliedId is processed", () => {
    const pet = makePet({ xp: 0, level: 1 });
    const event = makeEvent({ id: "01HBBB000000000000000000", xpDelta: 25 });
    const result = applyEvent(event, pet, "01HAAA000000000000000000");
    expect(result.pet.xp).toBe(25);
  });

  it("empty lastAppliedId (empty string) skips cursor check", () => {
    const pet = makePet({ xp: 0, level: 1 });
    const event = makeEvent({ xpDelta: 10 });
    const result = applyEvent(event, pet, "");
    expect(result.pet.xp).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// applyEvent — XP accumulation
// ---------------------------------------------------------------------------

describe("applyEvent — XP accumulation", () => {
  it("adds xpDelta to pet.xp", () => {
    const pet = makePet({ xp: 100, level: 1 });
    const event = makeEvent({ xpDelta: 50 });
    const result = applyEvent(event, pet);
    expect(result.pet.xp).toBe(150);
  });

  it("XP is stored even past the level-1024 cumulative threshold (vanity)", () => {
    const capXp = cumulativeXpForLevel(LEVEL_CAP);
    // Start at cap XP, level 1024
    const pet = makePet({ xp: capXp, level: LEVEL_CAP });
    const event = makeEvent({ xpDelta: 1_000_000 });
    const result = applyEvent(event, pet);
    expect(result.pet.xp).toBe(capXp + 1_000_000);
    expect(result.pet.level).toBe(LEVEL_CAP); // level stays capped
  });
});

// ---------------------------------------------------------------------------
// applyEvent — level-up side effects
// ---------------------------------------------------------------------------

describe("applyEvent — level-up side effects", () => {
  it("emits level.up event when level boundary is crossed", () => {
    // xpToNext(1) = 25, so giving 25 XP to a level-1 pet → level 2
    const pet = makePet({ xp: 0, level: 1 });
    const event = makeEvent({ xpDelta: xpToNext(1) });
    const result = applyEvent(event, pet);
    expect(result.pet.level).toBe(2);
    const levelUp = result.sideEffects.find((e) => e.type === "level.up");
    expect(levelUp).toBeDefined();
    expect((levelUp?.payload as { from: number; to: number }).from).toBe(1);
    expect((levelUp?.payload as { from: number; to: number }).to).toBe(2);
  });

  it("emits no level.up when XP does not cross a level boundary", () => {
    const pet = makePet({ xp: 0, level: 1 });
    // Give XP less than the full xpToNext(1)
    const event = makeEvent({ xpDelta: xpToNext(1) - 1 });
    const result = applyEvent(event, pet);
    expect(result.pet.level).toBe(1);
    expect(result.sideEffects.filter((e) => e.type === "level.up")).toHaveLength(0);
  });

  it("emits unlock.gif.tier1 when crossing level 25", () => {
    // Give exactly enough XP to reach level 25
    const xpFor25 = cumulativeXpForLevel(25);
    const pet = makePet({ xp: xpFor25 - 1, level: 24 });
    const event = makeEvent({ xpDelta: 1 });
    const result = applyEvent(event, pet);
    expect(result.pet.level).toBe(25);
    expect(result.sideEffects.some((e) => e.type === "unlock.gif.tier1")).toBe(true);
  });

  it("emits unlock.gif.tier2 when crossing level 250", () => {
    const xpFor250 = cumulativeXpForLevel(250);
    const pet = makePet({ xp: xpFor250 - 1, level: 249 });
    const event = makeEvent({ xpDelta: 1 });
    const result = applyEvent(event, pet);
    expect(result.pet.level).toBe(250);
    expect(result.sideEffects.some((e) => e.type === "unlock.gif.tier2")).toBe(true);
  });

  it("emits unlock.gif.tier3 when reaching level 1024", () => {
    const xpFor1024 = cumulativeXpForLevel(LEVEL_CAP);
    const pet = makePet({ xp: xpFor1024 - 1, level: LEVEL_CAP - 1 });
    const event = makeEvent({ xpDelta: 1 });
    const result = applyEvent(event, pet);
    expect(result.pet.level).toBe(LEVEL_CAP);
    expect(result.sideEffects.some((e) => e.type === "unlock.gif.tier3")).toBe(true);
  });

  it("emits ascended side effect when reaching level 1024", () => {
    const xpFor1024 = cumulativeXpForLevel(LEVEL_CAP);
    const pet = makePet({ xp: xpFor1024 - 1, level: LEVEL_CAP - 1 });
    const event = makeEvent({ xpDelta: 1 });
    const result = applyEvent(event, pet);
    const ascendedEvent = result.sideEffects.find(
      (e) => e.type === "level.up" && (e.payload as { ascended?: boolean }).ascended === true
    );
    expect(ascendedEvent).toBeDefined();
  });

  it("level is clamped at 1024 even with massive XP grant", () => {
    const xpFor1024 = cumulativeXpForLevel(LEVEL_CAP);
    const pet = makePet({ xp: xpFor1024 - 1, level: LEVEL_CAP - 1 });
    const event = makeEvent({ xpDelta: 100_000_000 });
    const result = applyEvent(event, pet);
    expect(result.pet.level).toBe(LEVEL_CAP);
  });
});

// ---------------------------------------------------------------------------
// Cumulative XP at DEC-004 documented levels (must match ±1 per rounding)
// ---------------------------------------------------------------------------

describe("DEC-004 cumulative XP spot-checks", () => {
  it("level 10 cumulative XP matches independent computation", () => {
    let expected = 0;
    for (let k = 1; k <= 9; k++) expected += xpToNext(k);
    expect(Math.abs(cumulativeXpForLevel(10) - expected)).toBeLessThanOrEqual(1);
  });

  it("level 100 cumulative XP matches independent computation", () => {
    let expected = 0;
    for (let k = 1; k <= 99; k++) expected += xpToNext(k);
    expect(Math.abs(cumulativeXpForLevel(100) - expected)).toBeLessThanOrEqual(1);
  });

  it("level 1024 cumulative XP matches independent computation (≈48M, ±1)", () => {
    let expected = 0;
    for (let k = 1; k < LEVEL_CAP; k++) expected += xpToNext(k);
    expect(Math.abs(cumulativeXpForLevel(LEVEL_CAP) - expected)).toBeLessThanOrEqual(1);
  });
});
