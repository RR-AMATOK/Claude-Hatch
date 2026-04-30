/**
 * Regression tests for the DEC-020 XP bar fill formula.
 *
 * Root cause: the colored branches of renderHudRow (line ~892) and
 * renderHudLeftGroup (line ~1079) use the legacy stop-gap formula
 *   Math.floor(Math.min(1, (pet.xp % 1000) / 1000) * 14)
 * instead of the correct cumulative-table formula
 *   (pet.xp - cumXp(L)) / (cumXp(L+1) - cumXp(L))
 *
 * At level 280 the span is ~18 222 XP, so xp % 1000 wraps 18 times —
 * producing a sawtooth that fills and resets 18× per level.
 *
 * The plain-text (mode="none") branches are correct and serve as the
 * control in every test here.
 *
 * All XP arithmetic uses cumulativeXpForLevel from src/xp/engine.ts.
 * No constants are hardcoded; 1618 and φ are sacred (DEC-020).
 *
 * @see DEC-020 (golden curve + cap 1618)
 * @see DEC-016 (statusline renderer design)
 */

import { describe, it, expect } from "vitest";
import type { Pet } from "../state/schema.js";
import { cumulativeXpForLevel } from "../xp/engine.js";
import {
  renderHudRow,
  assembleCompactOutput,
  assembleWideOutput,
} from "./compact.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip all ANSI SGR escape sequences from a string. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Count filled block cells (U+2588 █) inside the first bracketed segment
 * [……] in a string. The bar has exactly 14 inner cells.
 */
function filledCells(s: string): number {
  const match = /\[([^\]]*)\]/.exec(s);
  if (!match) return -1;
  // count █ chars inside the brackets
  let count = 0;
  for (const ch of match[1]!) {
    if (ch === "█") count++;
  }
  return count;
}

/**
 * Build a minimal valid Pet fixture. xp and level are the only fields that
 * matter for XP bar rendering; everything else is stable boilerplate.
 */
function makePet(overrides: Partial<Pet> = {}): Pet {
  const now = new Date().toISOString();
  return {
    id: "test-xpbar-1",
    schemaVersion: 1,
    eggType: "circuit",
    name: "Pixel",
    createdAt: now,
    hatchedAt: now,
    lastFedAt: now,
    lastInteractionAt: now,
    xp: 0,
    level: 1,
    personality: {
      dominant: "Friendly",
      weights: {
        Stoic: 0.1,
        Friendly: 0.3,
        Pragmatic: 0.15,
        Energetic: 0.1,
        Gruff: 0.05,
        Philosophical: 0.1,
        Paranoid: 0.1,
        Curious: 0.1,
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
    lastPlayedAt: null,
    lastHatchedAt: null,
    lastEvolvedAt: null,
    lastPettedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// describe: XP bar — intra-level fill (DEC-020)
// ---------------------------------------------------------------------------

describe("XP bar — intra-level fill (DEC-020)", () => {
  // -----------------------------------------------------------------------
  // Constants derived from cumulativeXpForLevel — never hardcoded
  // -----------------------------------------------------------------------

  /** Level under test. High enough that xp%1000 wraps many times per level. */
  const TEST_LEVEL = 280;
  const cumBase = cumulativeXpForLevel(TEST_LEVEL);
  const cumNext = cumulativeXpForLevel(TEST_LEVEL + 1);
  const span = cumNext - cumBase;

  // Midpoint xp: exactly half-way through the level span
  const midXp = cumBase + Math.floor(span / 2);

  // -----------------------------------------------------------------------
  // Sanity: the span is large enough for the bug to manifest
  // -----------------------------------------------------------------------

  it("span for level 280 is > 1000 (bug is detectable at this level)", () => {
    // span ≈ 18 222 — confirms xp%1000 wraps multiple times
    expect(span).toBeGreaterThan(1000);
  });

  // -----------------------------------------------------------------------
  // Test 1: renderHudRow colored mode — mid-level should show 7 filled cells
  // -----------------------------------------------------------------------

  it("renderHudRow colored mode shows correct fill at mid-level", () => {
    // Midpoint of a 14-cell bar: floor(0.5 * 14) = 7.
    // Bug: xp%1000 at midXp is essentially arbitrary, producing a wrong count.
    const pet = makePet({ xp: midXp, level: TEST_LEVEL });
    const raw = renderHudRow(pet, "content", 1, 0, "ansi256", false);
    const plain = stripAnsi(raw);
    const filled = filledCells(plain);
    expect(filled).toBe(7);
  });

  // -----------------------------------------------------------------------
  // Test 2: assembleCompactOutput colored mode — fill is monotonically
  //         non-decreasing across the full level span (15 probe points)
  // -----------------------------------------------------------------------

  it("assembleCompactOutput colored mode shows monotonic fill across a level span", () => {
    const PROBES = 15;
    const fills: number[] = [];

    for (let i = 0; i < PROBES; i++) {
      // Evenly-spaced steps from cumBase to cumNext-1 (avoid the level-up boundary)
      const xp = cumBase + Math.floor((span * i) / PROBES);
      const pet = makePet({ xp, level: TEST_LEVEL });
      const raw = assembleCompactOutput(pet, "idle-baseline", 0, "ansi256", false, 1, 0);
      // assembleCompactOutput returns "hudRow\nartRow0\nartRow1" — hud is row 0
      const hudLine = raw.split("\n")[0] ?? "";
      const plain = stripAnsi(hudLine);
      fills.push(filledCells(plain));
    }

    // Assert non-decreasing (monotonic fill) — sawtooth would violate this
    for (let i = 1; i < fills.length; i++) {
      expect(fills[i]).toBeGreaterThanOrEqual(fills[i - 1]!);
    }
  });

  // -----------------------------------------------------------------------
  // Test 3: assembleWideOutput standard tier colored mode — same monotonic
  //         constraint via the renderHudLeftGroup code path
  // -----------------------------------------------------------------------

  it("assembleWideOutput standard tier colored mode is monotonic", () => {
    // Standard tier: 80 ≤ cols < 140. The HUD row is row 0 of the output.
    const PROBES = 15;
    const fills: number[] = [];

    for (let i = 0; i < PROBES; i++) {
      const xp = cumBase + Math.floor((span * i) / PROBES);
      const pet = makePet({ xp, level: TEST_LEVEL });
      const raw = assembleWideOutput(
        pet,
        "standard",
        "idle-baseline",
        0,
        "ansi256",
        false,
        1,
        0,
        100 // cols in [80,140) → standard tier
      );
      // Standard tier: row 0 is the HUD row
      const hudLine = raw.split("\n")[0] ?? "";
      const plain = stripAnsi(hudLine);
      fills.push(filledCells(plain));
    }

    for (let i = 1; i < fills.length; i++) {
      expect(fills[i]).toBeGreaterThanOrEqual(fills[i - 1]!);
    }
  });

  // -----------------------------------------------------------------------
  // Test 4: Sanity / control — mode="none" (plain-text branch) must already
  //         return 7 filled cells at mid-level on main HEAD.
  //         This test must PASS before and after the Phase 3 fix.
  // -----------------------------------------------------------------------

  it('sanity: mode="none" shows correct fill at mid-level (plain-text branch is correct)', () => {
    const pet = makePet({ xp: midXp, level: TEST_LEVEL });
    const raw = renderHudRow(pet, "content", 1, 0, "none", false);
    // mode="none" returns plain text directly — no stripping needed
    const filled = filledCells(raw);
    expect(filled).toBe(7);
  });

  // -----------------------------------------------------------------------
  // Bonus: confirm the buggy formula's exact wrong value at step 0 to nail
  // the regression precisely. xp%1000 at cumBase(280)=1939702 is 702,
  // so Math.floor((702/1000)*14) = 9. The correct value is 0.
  // -----------------------------------------------------------------------

  it("renderHudRow colored mode shows 0 filled cells at the start of a level (step 0)", () => {
    // At xp = cumXp(L), progress = 0 → filled cells = 0.
    const pet = makePet({ xp: cumBase, level: TEST_LEVEL });
    const raw = renderHudRow(pet, "content", 1, 0, "ansi256", false);
    const plain = stripAnsi(raw);
    const filled = filledCells(plain);
    expect(filled).toBe(0);
  });

  it("renderHudRow colored mode shows 14 filled cells at the end of a level", () => {
    // At xp = cumXp(L+1) - 1, progress ≈ 1 → filled cells = 13 or 14.
    // floor((1 - 1/span) * 14) is 13 for a large span, but at the boundary
    // we clamp at min(1,...) so this is at most 14. For span=18222 the last
    // full step before level-up is floor(((18222-1)/18222)*14) = 13.
    const xpAlmostNext = cumNext - 1;
    const pet = makePet({ xp: xpAlmostNext, level: TEST_LEVEL });
    const raw = renderHudRow(pet, "content", 1, 0, "ansi256", false);
    const plain = stripAnsi(raw);
    const filled = filledCells(plain);
    // Should be 13 (the penultimate cell) — definitely NOT a sawtooth reset to 0-9
    expect(filled).toBeGreaterThanOrEqual(13);
  });

  // -----------------------------------------------------------------------
  // Bonus: truecolor and ansi16 branches share the same buggy formula
  // -----------------------------------------------------------------------

  it("renderHudRow truecolor mode shows correct fill at mid-level", () => {
    const pet = makePet({ xp: midXp, level: TEST_LEVEL });
    const raw = renderHudRow(pet, "content", 1, 0, "truecolor", false);
    const plain = stripAnsi(raw);
    const filled = filledCells(plain);
    expect(filled).toBe(7);
  });

  it("renderHudRow ansi16 mode shows correct fill at mid-level", () => {
    const pet = makePet({ xp: midXp, level: TEST_LEVEL });
    const raw = renderHudRow(pet, "content", 1, 0, "ansi16", false);
    const plain = stripAnsi(raw);
    const filled = filledCells(plain);
    expect(filled).toBe(7);
  });
});
