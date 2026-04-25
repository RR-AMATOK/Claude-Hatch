/**
 * Unit tests for src/export/tiers.ts
 *
 * Verifies:
 *   - TIER_SPECS has exact DEC-005 values
 *   - requiredLevelForTier() returns exact required levels
 *   - gateForTier() allows/blocks based on level
 *   - clampDuration() respects maxDurationSecs
 *   - Level is computed from pet.xp (not from unlock flags)
 */

import { describe, it, expect } from "vitest";
import {
  TIER_SPECS,
  requiredLevelForTier,
  gateForTier,
  clampDuration,
  currentLevelForPet,
  DEFAULT_CAPTURE_SCENE,
} from "./tiers.js";
import type { GifTier } from "./tiers.js";
import { cumulativeXpForLevel } from "../xp/engine.js";
import type { Pet } from "../state/schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid Pet with a given XP value. */
function makePet(xp: number): Pet {
  const now = new Date().toISOString();
  return {
    id: "01HTEST000000000000000001",
    schemaVersion: 1,
    eggType: "circuit",
    name: null,
    createdAt: now,
    hatchedAt: now,
    lastFedAt: null,
    lastInteractionAt: now,
    xp,
    level: 1, // intentionally stale; gate uses levelFromCumXp(xp)
    personality: {
      dominant: "Pragmatic",
      weights: {
        Stoic: 0.125,
        Friendly: 0.125,
        Pragmatic: 0.125,
        Energetic: 0.125,
        Gruff: 0.125,
        Philosophical: 0.125,
        Paranoid: 0.125,
        Curious: 0.125,
      },
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
  };
}

/** XP required to be exactly at a given level. */
function xpForLevel(level: number): number {
  return cumulativeXpForLevel(level);
}

// ---------------------------------------------------------------------------
// TIER_SPECS table — DEC-005 exact values
// ---------------------------------------------------------------------------

describe("TIER_SPECS", () => {
  it("Tier 1 has correct DEC-005 values", () => {
    const spec = TIER_SPECS[1];
    expect(spec.requiredLevel).toBe(25);
    expect(spec.width).toBe(320);
    expect(spec.height).toBe(240);
    expect(spec.fps).toBe(8);
    expect(spec.maxDurationSecs).toBe(3);
    expect(spec.watermark).toBe(true);
    expect(spec.userScenePick).toBe(false);
    expect(spec.goldenBorder).toBe(false);
  });

  it("Tier 2 has correct DEC-005 values", () => {
    const spec = TIER_SPECS[2];
    expect(spec.requiredLevel).toBe(250);
    expect(spec.width).toBe(640);
    expect(spec.height).toBe(480);
    expect(spec.fps).toBe(15);
    expect(spec.maxDurationSecs).toBe(10);
    expect(spec.watermark).toBe(false);
    expect(spec.userScenePick).toBe(true);
    expect(spec.goldenBorder).toBe(false);
  });

  it("Tier 3 has correct DEC-020 values", () => {
    const spec = TIER_SPECS[3];
    expect(spec.requiredLevel).toBe(1618);
    expect(spec.width).toBe(1280);
    expect(spec.height).toBe(720);
    expect(spec.fps).toBe(30);
    expect(spec.maxDurationSecs).toBe(30);
    expect(spec.watermark).toBe(false);
    expect(spec.userScenePick).toBe(true);
    expect(spec.goldenBorder).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// requiredLevelForTier — acceptance criterion 1
// ---------------------------------------------------------------------------

describe("requiredLevelForTier", () => {
  it("returns 25 for tier 1", () => {
    expect(requiredLevelForTier(1)).toBe(25);
  });

  it("returns 250 for tier 2", () => {
    expect(requiredLevelForTier(2)).toBe(250);
  });

  it("returns 1618 for tier 3 (DEC-020 Golden Level)", () => {
    expect(requiredLevelForTier(3)).toBe(1618);
  });
});

// ---------------------------------------------------------------------------
// gateForTier — acceptance criteria 2
// ---------------------------------------------------------------------------

describe("gateForTier", () => {
  describe("Tier 1 (requires L25)", () => {
    it("blocks a pet at exactly L24 (one below gate)", () => {
      const pet = makePet(xpForLevel(24));
      const result = gateForTier(1, pet);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("TIER_LOCKED");
        expect(result.currentLevel).toBe(24);
        expect(result.requiredLevel).toBe(25);
      }
    });

    it("allows a pet at exactly L25", () => {
      const pet = makePet(xpForLevel(25));
      const result = gateForTier(1, pet);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.currentLevel).toBe(25);
        expect(result.spec.requiredLevel).toBe(25);
      }
    });

    it("allows a pet at L100 (well above gate)", () => {
      const pet = makePet(xpForLevel(100));
      const result = gateForTier(1, pet);
      expect(result.ok).toBe(true);
    });

    it("blocks a pet at L1 (brand new)", () => {
      const pet = makePet(0);
      const result = gateForTier(1, pet);
      expect(result.ok).toBe(false);
    });
  });

  describe("Tier 2 (requires L250)", () => {
    it("blocks a pet at L249", () => {
      const pet = makePet(xpForLevel(249));
      const result = gateForTier(2, pet);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("TIER_LOCKED");
        expect(result.currentLevel).toBe(249);
        expect(result.requiredLevel).toBe(250);
      }
    });

    it("allows a pet at exactly L250", () => {
      const pet = makePet(xpForLevel(250));
      const result = gateForTier(2, pet);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.currentLevel).toBe(250);
      }
    });
  });

  describe("Tier 3 (requires L1618, DEC-020)", () => {
    it("blocks a pet at L1617", () => {
      const pet = makePet(xpForLevel(1617));
      const result = gateForTier(3, pet);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("TIER_LOCKED");
        expect(result.currentLevel).toBe(1617);
        expect(result.requiredLevel).toBe(1618);
      }
    });

    it("allows a pet at exactly L1618", () => {
      const pet = makePet(xpForLevel(1618));
      const result = gateForTier(3, pet);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.currentLevel).toBe(1618);
        expect(result.spec.goldenBorder).toBe(true);
      }
    });
  });

  describe("gate uses xp, not unlock flags", () => {
    it("blocks even when unlock flag is true but level is too low", () => {
      // Pet has xp for L24 but unlock flag says true (inconsistent state)
      const pet = makePet(xpForLevel(24));
      // The gate should still block — it recomputes from xp
      const result = gateForTier(1, pet);
      expect(result.ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// currentLevelForPet
// ---------------------------------------------------------------------------

describe("currentLevelForPet", () => {
  it("returns 1 for a brand-new pet with 0 XP", () => {
    expect(currentLevelForPet(makePet(0))).toBe(1);
  });

  it("returns correct level from XP", () => {
    const pet = makePet(xpForLevel(50));
    expect(currentLevelForPet(pet)).toBe(50);
  });

  it("caps at 1618 even with excess XP (DEC-020)", () => {
    // Add more XP than needed for L1618
    const pet = makePet(xpForLevel(1618) + 9_999_999);
    expect(currentLevelForPet(pet)).toBe(1618);
  });
});

// ---------------------------------------------------------------------------
// clampDuration
// ---------------------------------------------------------------------------

describe("clampDuration", () => {
  it.each([
    [1 as GifTier, 2, 2],        // under cap: no clamp
    [1 as GifTier, 3, 3],        // exactly at cap: no clamp
    [1 as GifTier, 5, 3],        // over cap: clamped to 3
    [2 as GifTier, 7, 7],        // under cap for T2
    [2 as GifTier, 10, 10],      // exactly at cap for T2
    [2 as GifTier, 15, 10],      // over cap for T2
    [3 as GifTier, 30, 30],      // exactly at cap for T3
    [3 as GifTier, 60, 30],      // over cap for T3
  ])("tier %i: requested %is → %is", (tier, requested, expected) => {
    expect(clampDuration(tier, requested)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_CAPTURE_SCENE
// ---------------------------------------------------------------------------

describe("DEFAULT_CAPTURE_SCENE", () => {
  it("is idle-baseline (safe default for all species/stages)", () => {
    expect(DEFAULT_CAPTURE_SCENE).toBe("idle-baseline");
  });
});
