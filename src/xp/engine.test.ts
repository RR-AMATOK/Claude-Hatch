/**
 * Tests for src/xp/engine.ts — XP engine (DEC-020)
 *
 * Covers:
 *   - PHI constant correctness
 *   - xpToNext(L) formula and edge cases (DEC-020 golden curve)
 *   - cumulativeXpForLevel spot-checks
 *   - levelFromCumXp inverse / saturation / monotonicity
 *   - displayLevel normal and Ascendant cases
 *   - applyEvent: dead pet guard, cursor dedupe, xpDelta application
 *   - applyEvent: level-up side effects, unlock thresholds
 *   - applyEvent: level cap at 1618, XP continues past cap (vanity)
 *   - Boundary cases: L=1, L=1618, L=1619 (unreachable)
 *   - Token denominator: XP_PER_TOKEN_DENOMINATOR=1000
 *
 * All tests are pure — no disk I/O.
 */

import { describe, it, expect } from "vitest";
import {
  PHI,
  xpToNext,
  levelFromCumXp,
  cumulativeXpForLevel,
  displayLevel,
  applyEvent,
  xpForTokens,
  XP_PER_TOKEN_DENOMINATOR,
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
    lastLevelUpAt: null,
    lastPlayedAt: null,
    lastHatchedAt: null,
    lastEvolvedAt: null,
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
// PHI constant
// ---------------------------------------------------------------------------

describe("PHI", () => {
  it("equals (1 + sqrt(5)) / 2 to full float64 precision", () => {
    expect(PHI).toBe((1 + Math.sqrt(5)) / 2);
  });

  it("is approximately 1.6180339887498949", () => {
    expect(Math.abs(PHI - 1.6180339887498949)).toBeLessThan(1e-15);
  });

  it("satisfies the golden ratio identity: PHI^2 === PHI + 1 (within float epsilon)", () => {
    expect(Math.abs(PHI * PHI - (PHI + 1))).toBeLessThan(1e-10);
  });
});

// ---------------------------------------------------------------------------
// LEVEL_CAP
// ---------------------------------------------------------------------------

describe("LEVEL_CAP", () => {
  it("is 1618 — the Golden Level (DEC-020)", () => {
    expect(LEVEL_CAP).toBe(1618);
  });
});

// ---------------------------------------------------------------------------
// XP_PER_TOKEN_DENOMINATOR
// ---------------------------------------------------------------------------

describe("XP_PER_TOKEN_DENOMINATOR", () => {
  it("is 1000 (DEC-020: 1 XP per 1000 tokens)", () => {
    expect(XP_PER_TOKEN_DENOMINATOR).toBe(1000);
  });

  it("xpForTokens(1000) = 1", () => {
    expect(xpForTokens(1_000)).toBe(1);
  });

  it("xpForTokens(999) = 0 (below floor)", () => {
    expect(xpForTokens(999)).toBe(0);
  });

  it("xpForTokens(100_000_000) = 100_000 (DEC-020 acceptance criterion)", () => {
    expect(xpForTokens(100_000_000)).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// xpToNext — DEC-020 golden curve
// ---------------------------------------------------------------------------

describe("xpToNext", () => {
  it("returns floor(2 * 1^PHI) = 2 at L=1", () => {
    const expected = Math.floor(2 * Math.pow(1, PHI));
    expect(xpToNext(1)).toBe(expected);
    expect(xpToNext(1)).toBe(2); // 2 * 1 = 2 exactly
  });

  it("returns floor(2 * 10^PHI) at L=10", () => {
    const expected = Math.floor(2 * Math.pow(10, PHI));
    expect(xpToNext(10)).toBe(expected);
  });

  it("returns floor(2 * 100^PHI) at L=100", () => {
    const expected = Math.floor(2 * Math.pow(100, PHI));
    expect(xpToNext(100)).toBe(expected);
  });

  it("returns 0 at L=1618 (Ascendant — no next level, DEC-020)", () => {
    expect(xpToNext(LEVEL_CAP)).toBe(0);
    expect(xpToNext(1618)).toBe(0);
  });

  it("returns 0 at L=1619 (unreachable — still clamps to 0)", () => {
    expect(xpToNext(1619)).toBe(0);
    expect(xpToNext(9999)).toBe(0);
  });

  it("is a finite non-negative integer at L=1618 boundary", () => {
    const v = xpToNext(1617); // one below cap — last valid formula value
    expect(Number.isFinite(v)).toBe(true);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(2 ** 31 - 1); // fits in 32-bit int
  });

  it("returns a non-negative integer at every level 1..1617", () => {
    for (let L = 1; L < LEVEL_CAP; L++) {
      const v = xpToNext(L);
      expect(v).toBeGreaterThan(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("is monotonically non-decreasing for L in [1, 1617]", () => {
    for (let L = 1; L < LEVEL_CAP - 1; L++) {
      expect(xpToNext(L + 1)).toBeGreaterThanOrEqual(xpToNext(L));
    }
  });
});

// ---------------------------------------------------------------------------
// cumulativeXpForLevel
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

  it("level 1618 cumulative XP is positive and finite", () => {
    const cumXp1618 = cumulativeXpForLevel(LEVEL_CAP);
    expect(cumXp1618).toBeGreaterThan(0);
    expect(Number.isFinite(cumXp1618)).toBe(true);
    expect(Number.isInteger(cumXp1618)).toBe(true);
  });

  it("level 1618 cumulative XP matches independent computation (±1 for rounding)", () => {
    let expected = 0;
    for (let k = 1; k < LEVEL_CAP; k++) expected += xpToNext(k);
    expect(Math.abs(cumulativeXpForLevel(LEVEL_CAP) - expected)).toBeLessThanOrEqual(1);
  });

  it("cumulativeXpForLevel is strictly increasing for L in [1, 1618]", () => {
    let prev = cumulativeXpForLevel(1);
    for (let L = 2; L <= LEVEL_CAP; L++) {
      const curr = cumulativeXpForLevel(L);
      expect(curr).toBeGreaterThan(prev);
      prev = curr;
    }
  });

  it("round-trips: levelFromCumXp(cumulativeXpForLevel(1618)) === 1618", () => {
    const cumXp1618 = cumulativeXpForLevel(LEVEL_CAP);
    expect(levelFromCumXp(cumXp1618)).toBe(LEVEL_CAP);
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
    for (const L of [1, 2, 5, 10, 31, 50, 100, 500, 1617, 1618]) {
      const cum = cumulativeXpForLevel(L);
      expect(levelFromCumXp(cum)).toBe(L);
    }
  });

  it("saturates at 1618 for very large XP (DEC-020)", () => {
    expect(levelFromCumXp(999_999_999_999)).toBe(LEVEL_CAP);
  });

  it("returns LEVEL_CAP for cumXp === cumulativeXpForLevel(1618)", () => {
    expect(levelFromCumXp(cumulativeXpForLevel(LEVEL_CAP))).toBe(LEVEL_CAP);
  });

  it("is monotonically non-decreasing", () => {
    const checkPoints = [0, 2, 10, 100, 1_000, 10_000, 100_000, 1_000_000];
    let prev = levelFromCumXp(0);
    for (const xp of checkPoints) {
      const curr = levelFromCumXp(xp);
      expect(curr).toBeGreaterThanOrEqual(prev);
      prev = curr;
    }
  });

  it("Bramble migration: xp=6000, old level=17 → new level=31 (DEC-020 §6 Option A)", () => {
    // xp=6000 under the DEC-004 curve was level 17.
    // Under the DEC-020 golden curve, level 31 should be the correct level.
    const level = levelFromCumXp(6000);
    expect(level).toBe(31);
  });
});

// ---------------------------------------------------------------------------
// displayLevel
// ---------------------------------------------------------------------------

describe("displayLevel", () => {
  it("returns plain number string for levels 1-1617", () => {
    expect(displayLevel(1)).toBe("1");
    expect(displayLevel(10)).toBe("10");
    expect(displayLevel(1617)).toBe("1617");
  });

  it("returns '1618 · Ascendant' at LEVEL_CAP", () => {
    expect(displayLevel(LEVEL_CAP)).toBe(`${LEVEL_CAP} · ${ASCENDANT_HONORIFIC}`);
    expect(displayLevel(1618)).toBe("1618 · Ascendant");
  });

  it("returns Ascendant string for L > 1618", () => {
    expect(displayLevel(1619)).toBe(`${LEVEL_CAP} · ${ASCENDANT_HONORIFIC}`);
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
    expect(result.pet).toBe(pet);
    expect(result.sideEffects).toHaveLength(0);
  });

  it("event with no xpDelta returns unchanged pet", () => {
    const pet = makePet({ xp: 0, level: 1 });
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
    const event = makeEvent({ id: "01HBBB000000000000000000", xpDelta: 2 });
    const result = applyEvent(event, pet, "01HAAA000000000000000000");
    expect(result.pet.xp).toBe(2);
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

  it("XP is stored even past the level-1618 cumulative threshold (vanity)", () => {
    const capXp = cumulativeXpForLevel(LEVEL_CAP);
    const pet = makePet({ xp: capXp, level: LEVEL_CAP });
    const event = makeEvent({ xpDelta: 1_000_000 });
    const result = applyEvent(event, pet);
    expect(result.pet.xp).toBe(capXp + 1_000_000);
    expect(result.pet.level).toBe(LEVEL_CAP);
  });

  it("DEC-020: no cap.daily rejection — all XP from uncapped events is granted", () => {
    const pet = makePet({ xp: 0, level: 1 });
    const event = makeEvent({ xpDelta: 100_000 }); // would have far exceeded old daily caps
    const result = applyEvent(event, pet);
    expect(result.pet.xp).toBe(100_000);
    const rejections = result.sideEffects.filter((e) => e.type === "signal.rejected");
    expect(rejections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyEvent — level-up side effects
// ---------------------------------------------------------------------------

describe("applyEvent — level-up side effects", () => {
  it("emits level.up event when level boundary is crossed", () => {
    // xpToNext(1) = 2, so giving 2 XP to a level-1 pet → level 2
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
    const event = makeEvent({ xpDelta: xpToNext(1) - 1 });
    const result = applyEvent(event, pet);
    expect(result.pet.level).toBe(1);
    expect(result.sideEffects.filter((e) => e.type === "level.up")).toHaveLength(0);
  });

  it("emits unlock.gif.tier1 when crossing level 25", () => {
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

  it("emits unlock.gif.tier3 when reaching level 1618 (DEC-020)", () => {
    const xpFor1618 = cumulativeXpForLevel(LEVEL_CAP);
    const pet = makePet({ xp: xpFor1618 - 1, level: LEVEL_CAP - 1 });
    const event = makeEvent({ xpDelta: 1 });
    const result = applyEvent(event, pet);
    expect(result.pet.level).toBe(LEVEL_CAP);
    expect(result.sideEffects.some((e) => e.type === "unlock.gif.tier3")).toBe(true);
  });

  it("emits ascended side effect when reaching level 1618 (DEC-020)", () => {
    const xpFor1618 = cumulativeXpForLevel(LEVEL_CAP);
    const pet = makePet({ xp: xpFor1618 - 1, level: LEVEL_CAP - 1 });
    const event = makeEvent({ xpDelta: 1 });
    const result = applyEvent(event, pet);
    const ascendedEvent = result.sideEffects.find(
      (e) => e.type === "level.up" && (e.payload as { ascended?: boolean }).ascended === true
    );
    expect(ascendedEvent).toBeDefined();
  });

  it("level is clamped at 1618 even with massive XP grant (DEC-020)", () => {
    const xpFor1618 = cumulativeXpForLevel(LEVEL_CAP);
    const pet = makePet({ xp: xpFor1618 - 1, level: LEVEL_CAP - 1 });
    const event = makeEvent({ xpDelta: 100_000_000 });
    const result = applyEvent(event, pet);
    expect(result.pet.level).toBe(LEVEL_CAP);
  });
});

// ---------------------------------------------------------------------------
// applyEvent — lastLevelUpAt (Bug C)
// ---------------------------------------------------------------------------

describe("applyEvent — lastLevelUpAt", () => {
  it("sets lastLevelUpAt to a fresh ISO timestamp when level increases", () => {
    const before = Date.now();
    const pet = makePet({ xp: 0, level: 1, lastLevelUpAt: null });
    const event = makeEvent({ xpDelta: xpToNext(1) }); // crosses level 1→2
    const result = applyEvent(event, pet);
    expect(result.pet.level).toBe(2);
    expect(result.pet.lastLevelUpAt).not.toBeNull();
    const ts = Date.parse(result.pet.lastLevelUpAt!);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now() + 100);
  });

  it("leaves lastLevelUpAt unchanged when XP does not cross a level boundary", () => {
    const existingTs = "2026-04-20T00:00:00.000Z";
    const pet = makePet({ xp: 0, level: 1, lastLevelUpAt: existingTs });
    const event = makeEvent({ xpDelta: xpToNext(1) - 1 }); // does not level up
    const result = applyEvent(event, pet);
    expect(result.pet.level).toBe(1);
    expect(result.pet.lastLevelUpAt).toBe(existingTs);
  });

  it("lastLevelUpAt starts null and is set on first level-up", () => {
    const pet = makePet({ xp: 0, level: 1, lastLevelUpAt: null });
    const event = makeEvent({ xpDelta: xpToNext(1) });
    const result = applyEvent(event, pet);
    expect(result.pet.lastLevelUpAt).not.toBeNull();
  });

  it("Bramble XP is not zeroed by applyEvent — raw XP accumulates correctly", () => {
    // Exit criterion 5: Bramble's stored XP must never be zeroed.
    // xp=1_900_000 → levelFromCumXp = 277 (cumXp[278]=1903573, so 1.9M is below 278).
    // Giving 1 XP → new xp=1_900_001, still level 277 (no level-up boundary crossed).
    const bramblePet = makePet({ xp: 1_900_000, level: 277, lastLevelUpAt: null });
    const event = makeEvent({ xpDelta: 1 });
    const result = applyEvent(event, bramblePet);
    expect(result.pet.xp).toBe(1_900_001);
    expect(result.pet.level).toBe(277);
    expect(result.pet.lastLevelUpAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Boundary cases: L=1, L=1618, L=1619
// ---------------------------------------------------------------------------

describe("boundary cases — L=1, L=1618, L=1619", () => {
  it("xpToNext(1) is a finite positive integer", () => {
    const v = xpToNext(1);
    expect(Number.isFinite(v)).toBe(true);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
  });

  it("xpToNext(1618) = 0 (at cap, no next level)", () => {
    expect(xpToNext(1618)).toBe(0);
  });

  it("xpToNext(1619) = 0 (beyond cap, unreachable)", () => {
    expect(xpToNext(1619)).toBe(0);
  });

  it("levelFromCumXp(cumulativeXpForLevel(1618)) = 1618 (round-trip at cap)", () => {
    const cumXp1618 = cumulativeXpForLevel(1618);
    expect(levelFromCumXp(cumXp1618)).toBe(1618);
  });

  it("cumulativeXpForLevel(1618) is a finite non-negative integer", () => {
    const v = cumulativeXpForLevel(1618);
    expect(Number.isFinite(v)).toBe(true);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Cumulative XP spot-checks against independent computation
// ---------------------------------------------------------------------------

describe("cumulative XP spot-checks", () => {
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

  it("level 1618 cumulative XP matches independent computation (±1)", () => {
    let expected = 0;
    for (let k = 1; k < LEVEL_CAP; k++) expected += xpToNext(k);
    expect(Math.abs(cumulativeXpForLevel(LEVEL_CAP) - expected)).toBeLessThanOrEqual(1);
  });
});
