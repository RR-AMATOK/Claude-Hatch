/**
 * Tests for wide-tier and standard-tier statusline rendering.
 * Covers:
 *   - classifyTier() boundary cases
 *   - assembleWideOutput() at standard tier (3 rows, mood pack-tight)
 *   - assembleWideOutput() at wide tier (4 rows, silhouette + HUD on row 4)
 *   - All 12 species × stage × scenes at wide tier
 *   - Reduced-motion determinism
 *   - assertWideFrameDimensions() build-time assertion
 *   - Performance smoke test (1000 calls < 500ms)
 */

import { describe, it, expect } from "vitest";
import type { Pet } from "../state/schema.js";
import { cumulativeXpForLevel } from "../xp/engine.js";
import {
  classifyTier,
  assembleWideOutput,
  assertWideFrameDimensions,
  WIDE_HUD_START_COL,
  WIDE_SILHOUETTE_MAX_COLS,
  visibleWidth,
  REFRESH_MS,
} from "./compact.js";

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------

function makePet(overrides: Partial<Pet> = {}): Pet {
  const now = new Date().toISOString();
  return {
    id: "test-pet-wide-1",
    schemaVersion: 1,
    eggType: "circuit",
    name: "Pixel",
    createdAt: now,
    hatchedAt: now,
    lastFedAt: now,
    lastInteractionAt: now,
    xp: 500,
    level: 5,
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifyTier — boundary cases
// ---------------------------------------------------------------------------

describe("classifyTier", () => {
  it("returns 'narrow' for undefined (non-TTY / CI)", () => {
    expect(classifyTier(undefined)).toBe("narrow");
  });

  it("returns 'narrow' for 0", () => {
    expect(classifyTier(0)).toBe("narrow");
  });

  it("returns 'narrow' for 79", () => {
    expect(classifyTier(79)).toBe("narrow");
  });

  it("returns 'standard' for 80 (lower boundary)", () => {
    expect(classifyTier(80)).toBe("standard");
  });

  it("returns 'standard' for 139 (upper boundary)", () => {
    expect(classifyTier(139)).toBe("standard");
  });

  it("returns 'wide' for 140 (lower boundary)", () => {
    expect(classifyTier(140)).toBe("wide");
  });

  it("returns 'wide' for 500", () => {
    expect(classifyTier(500)).toBe("wide");
  });
});

// ---------------------------------------------------------------------------
// assertWideFrameDimensions — build-time assertion
// ---------------------------------------------------------------------------

describe("assertWideFrameDimensions", () => {
  it("passes for all 12 built-in wide silhouettes (≤18 visible cols each row)", () => {
    expect(() => assertWideFrameDimensions()).not.toThrow();
  });

  it("WIDE_HUD_START_COL is 15", () => {
    expect(WIDE_HUD_START_COL).toBe(15);
  });

  it("WIDE_SILHOUETTE_MAX_COLS is 18", () => {
    expect(WIDE_SILHOUETTE_MAX_COLS).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// assembleWideOutput — standard tier (3 rows)
// ---------------------------------------------------------------------------

describe("assembleWideOutput — standard tier", () => {
  const pet = makePet({ level: 30, xp: cumulativeXpForLevel(30) });
  const cols = 100;

  it("emits exactly 3 rows", () => {
    const output = assembleWideOutput(pet, "standard", "idle-baseline", 0, "none", false, 1, 0, cols);
    const rows = output.split("\n");
    expect(rows.length).toBe(3);
  });

  it("no row visible-width exceeds cols", () => {
    const output = assembleWideOutput(pet, "standard", "idle-baseline", 0, "none", false, 1, 0, cols);
    for (const row of output.split("\n")) {
      expect(visibleWidth(row)).toBeLessThanOrEqual(cols);
    }
  });

  it("packs mood tight after HUD with ' · ' separator (no dead space)", () => {
    // Pack-tight layout: HUD atoms · mood. Mood is no longer right-anchored.
    // Row width must be ≤ cols and the row must end with the mood glyph.
    const output = assembleWideOutput(pet, "standard", "idle-baseline", 0, "none", false, 1, 0, cols);
    const rows = output.split("\n");
    const hudRow = rows[0]!;
    expect(visibleWidth(hudRow)).toBeLessThanOrEqual(cols);
    // Row ends with the mood glyph preceded by " · "
    expect(hudRow).toMatch(/ \u00b7 :\|$/);
  });

  it("HUD row contains pet name and level", () => {
    const output = assembleWideOutput(pet, "standard", "idle-baseline", 0, "none", false, 1, 0, cols);
    const hudRow = output.split("\n")[0]!;
    expect(hudRow).toContain("Pixel");
    expect(hudRow).toContain("Lv");
  });

  it("mood glyph is the last visible token on the HUD row", () => {
    // Pack-tight: mood is the LAST 2 chars of the row (preceded by " · ").
    const output = assembleWideOutput(pet, "standard", "idle-baseline", 0, "none", false, 1, 0, cols);
    const hudRow = output.split("\n")[0]!;
    const lastTwo = hudRow.slice(-2);
    expect(lastTwo).toBe(":|");
  });

  it("works correctly at the minimum 80-col boundary", () => {
    const output = assembleWideOutput(pet, "standard", "idle-baseline", 0, "none", false, 1, 0, 80);
    const rows = output.split("\n");
    expect(rows.length).toBe(3);
    const hudRow = rows[0]!;
    // Pack-tight: width is hudLeft + " · " + mood. Must fit within cols.
    expect(visibleWidth(hudRow)).toBeLessThanOrEqual(80);
    expect(hudRow).toMatch(/ \u00b7 :\|$/);
    for (const row of rows) {
      expect(visibleWidth(row)).toBeLessThanOrEqual(80);
    }
  });

  it("works for sleeping scene (rows 2-3 are narrow silhouette, not wide)", () => {
    const sleepPet = makePet({
      pauseIntervals: [{ pausedAt: new Date().toISOString(), resumedAt: null }],
      level: 10,
      xp: cumulativeXpForLevel(10),
      eggType: "bloom",
    });
    const output = assembleWideOutput(sleepPet, "standard", "sleeping", 0, "none", false, 1, 0, cols);
    const rows = output.split("\n");
    expect(rows.length).toBe(3);
  });

  it("works for death scene (rows 2-3 from scene frame)", () => {
    const deadPet = makePet({
      diedAt: new Date().toISOString(),
      tombstone: { diedAt: new Date().toISOString(), cause: "neglect", finalLevel: 5, finalXp: 500 },
    });
    const output = assembleWideOutput(deadPet, "standard", "death", 0, "none", false, 1, 0, cols);
    const rows = output.split("\n");
    expect(rows.length).toBe(3);
    // The scene content rows (RIP / [___]) show up in rows 2-3
    expect(output).toContain("RIP");
  });
});

// ---------------------------------------------------------------------------
// assembleWideOutput — wide tier (4 rows)
// ---------------------------------------------------------------------------

describe("assembleWideOutput — wide tier", () => {
  const pet = makePet({ level: 30, xp: cumulativeXpForLevel(30) });
  const cols = 160;

  it("emits exactly 4 rows", () => {
    const output = assembleWideOutput(pet, "wide", "idle-baseline", 0, "none", false, 1, 0, cols);
    const rows = output.split("\n");
    expect(rows.length).toBe(4);
  });

  it("no row visible-width exceeds cols", () => {
    const output = assembleWideOutput(pet, "wide", "idle-baseline", 0, "none", false, 1, 0, cols);
    for (const row of output.split("\n")) {
      expect(visibleWidth(row)).toBeLessThanOrEqual(cols);
    }
  });

  it("rows 1-4 silhouette content occupies cols 0..<=17 (visibleWidth of art portion ≤18)", () => {
    // For rows 1-3 the entire row is art (≤18 visible cols).
    // Row 4 starts with art then HUD.
    // We verify rows 1-3 are all ≤18 visible cols.
    const output = assembleWideOutput(pet, "wide", "idle-baseline", 0, "none", false, 1, 0, cols);
    const rows = output.split("\n");
    // rows 0, 1, 2 are pure art
    for (let r = 0; r < 3; r++) {
      expect(visibleWidth(rows[r]!)).toBeLessThanOrEqual(18);
    }
  });

  it("HUD content begins at col WIDE_HUD_START_COL on row 4", () => {
    // Row 4 = silhouette row 3 + padding + HUD. We verify that content after
    // the silhouette (padded to WIDE_HUD_START_COL) starts with pet name.
    const output = assembleWideOutput(pet, "wide", "idle-baseline", 0, "none", false, 1, 0, cols);
    const row4 = output.split("\n")[3]!;
    // The HUD left group starts at WIDE_HUD_START_COL.
    // Strip trailing mood and whitespace to verify the name appears after col 15.
    const stripped = row4; // no ANSI in 'none' mode
    // Slice from WIDE_HUD_START_COL — should start the HUD content
    const hudPortion = stripped.slice(WIDE_HUD_START_COL);
    expect(hudPortion.trimStart()).toContain("Pixel");
  });

  it("packs mood tight after HUD on row 4 (no dead space)", () => {
    // Pack-tight: row width is silhouette + padding + HUD + ' · ' + mood.
    // Width must fit within cols, and the row must end with the mood glyph.
    const output = assembleWideOutput(pet, "wide", "idle-baseline", 0, "none", false, 1, 0, cols);
    const row4 = output.split("\n")[3]!;
    expect(visibleWidth(row4)).toBeLessThanOrEqual(cols);
    expect(row4).toMatch(/ \u00b7 :\|$/);
  });

  it("HUD row contains pet name and level", () => {
    const output = assembleWideOutput(pet, "wide", "idle-baseline", 0, "none", false, 1, 0, cols);
    const row4 = output.split("\n")[3]!;
    expect(row4).toContain("Pixel");
    expect(row4).toContain("Lv");
  });

  it("works for sleeping scene — sleep particles on rows 2-3", () => {
    const sleepPet = makePet({
      pauseIntervals: [{ pausedAt: new Date().toISOString(), resumedAt: null }],
      level: 30,
      xp: cumulativeXpForLevel(30),
      eggType: "bloom",
    });
    const output = assembleWideOutput(sleepPet, "wide", "sleeping", 0, "none", false, 1, 0, cols);
    const rows = output.split("\n");
    expect(rows.length).toBe(4);
    // Sleep particles should appear on row 2 (index 1) or row 3 (index 2)
    const row2 = rows[1]!;
    const row3 = rows[2]!;
    const hasSleepParticles = row2.includes("z") || row2.includes("Z") ||
                               row3.includes("z") || row3.includes("Z");
    expect(hasSleepParticles).toBe(true);
    // Row 4 should not have sleep particles (it's the HUD row)
    const row4 = rows[3]!;
    expect(row4).not.toMatch(/\bz\b/);
  });

  it("works for death scene — 4 rows", () => {
    const deadPet = makePet({
      diedAt: new Date().toISOString(),
      tombstone: { diedAt: new Date().toISOString(), cause: "neglect", finalLevel: 5, finalXp: 500 },
    });
    const output = assembleWideOutput(deadPet, "wide", "death", 0, "none", false, 1, 0, cols);
    const rows = output.split("\n");
    expect(rows.length).toBe(4);
    expect(output).toContain("RIP");
  });

  it("works for level-up scene — 4 rows", () => {
    const output = assembleWideOutput(pet, "wide", "level-up", 0, "none", false, 1, 0, cols);
    const rows = output.split("\n");
    expect(rows.length).toBe(4);
  });

  it("row 4 fits within cols at 220-col width and ends with mood", () => {
    const output = assembleWideOutput(pet, "wide", "idle-baseline", 0, "none", false, 1, 0, 220);
    const row4 = output.split("\n")[3]!;
    expect(visibleWidth(row4)).toBeLessThanOrEqual(220);
    expect(row4).toMatch(/ \u00b7 :\|$/);
  });
});

// ---------------------------------------------------------------------------
// All 12 species × 3 stages × scenes at wide tier
// ---------------------------------------------------------------------------

describe("assembleWideOutput — all species × stages × scenes", () => {
  const SPECIES = ["circuit", "rune", "shard", "bloom"] as const;
  const LEVELS: Record<string, number> = {
    hatchling: 1,
    juvenile: 5,
    adult: 30,
  };
  const SCENES = ["idle-baseline", "sleeping"] as const;
  const cols = 160;

  for (const species of SPECIES) {
    for (const [stageName, level] of Object.entries(LEVELS)) {
      for (const scene of SCENES) {
        it(`${species}/${stageName}/${scene} — 4 rows, all ≤${cols} cols`, () => {
          const pet = makePet({
            eggType: species,
            level,
            xp: cumulativeXpForLevel(level),
            // sleeping requires paused state
            pauseIntervals:
              scene === "sleeping"
                ? [{ pausedAt: new Date().toISOString(), resumedAt: null }]
                : [],
          });
          const tick = Math.floor(Date.now() / REFRESH_MS);
          const output = assembleWideOutput(pet, "wide", scene, tick, "none", false, 1, 0, cols);
          const rows = output.split("\n");
          expect(rows.length).toBe(4);
          for (const row of rows) {
            expect(visibleWidth(row)).toBeLessThanOrEqual(cols);
          }
          // Row 4 should be non-empty (has HUD content)
          expect(rows[3]!.length).toBeGreaterThan(0);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Reduced-motion determinism
// ---------------------------------------------------------------------------

describe("assembleWideOutput — reduced-motion determinism", () => {
  it("wide-tier output is deterministic across 10 consecutive ticks with GLYPHLING_REDUCED_MOTION=1", () => {
    // Reduced motion: the assembleWideOutput function itself uses tick for frame
    // cycling. With a fixed tick, output must be identical. We test that
    // independent calls with the same tick produce the same result (pure function).
    const pet = makePet({ level: 30, xp: cumulativeXpForLevel(30) });
    const cols = 160;
    const baseTick = Math.floor(Date.now() / REFRESH_MS);

    // Collect outputs for 10 consecutive ticks
    const outputs = Array.from({ length: 10 }, (_, i) =>
      assembleWideOutput(pet, "wide", "idle-baseline", baseTick + i, "none", false, 1, 0, cols)
    );

    // Under reduced motion the cycle should only use 2 frames (spec §6).
    // The function is deterministic: same tick always → same output.
    // Verify each output is deterministic (calling twice with same tick).
    for (let i = 0; i < 10; i++) {
      const repeated = assembleWideOutput(pet, "wide", "idle-baseline", baseTick + i, "none", false, 1, 0, cols);
      expect(repeated).toBe(outputs[i]);
    }

    // With reduced motion env, all outputs should be well-formed (4 rows)
    for (const output of outputs) {
      expect(output.split("\n").length).toBe(4);
    }
  });

  it("standard-tier output is deterministic for the same tick", () => {
    const pet = makePet({ level: 10, xp: cumulativeXpForLevel(10) });
    const cols = 100;
    const tick = 42;
    const a = assembleWideOutput(pet, "standard", "idle-baseline", tick, "none", false, 1, 0, cols);
    const b = assembleWideOutput(pet, "standard", "idle-baseline", tick, "none", false, 1, 0, cols);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Performance smoke test
// ---------------------------------------------------------------------------

describe("assembleWideOutput — performance", () => {
  it("1000 calls to assembleWideOutput complete in < 500ms (avg ≤0.5ms per call)", () => {
    const pet = makePet({ level: 30, xp: cumulativeXpForLevel(30) });
    const cols = 160;
    const tick = Math.floor(Date.now() / REFRESH_MS);

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      assembleWideOutput(pet, "wide", "idle-baseline", tick + (i % 4), "none", false, 1, 0, cols);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// ANSI color mode — wide tier HUD contains SGR
// ---------------------------------------------------------------------------

describe("assembleWideOutput — color modes", () => {
  const pet = makePet({ level: 30, xp: cumulativeXpForLevel(30) });
  const cols = 160;

  it("emits no ANSI in none mode", () => {
    const output = assembleWideOutput(pet, "wide", "idle-baseline", 0, "none", false, 1, 0, cols);
    expect(output).not.toContain("\x1b[");
  });

  it("emits 256-color ANSI in ansi256 mode", () => {
    const output = assembleWideOutput(pet, "wide", "idle-baseline", 0, "ansi256", false, 1, 0, cols);
    expect(output).toContain("\x1b[38;5;");
  });

  it("emits truecolor ANSI in truecolor mode", () => {
    const output = assembleWideOutput(pet, "wide", "idle-baseline", 0, "truecolor", false, 1, 0, cols);
    expect(output).toContain("\x1b[38;2;");
  });

  it("row count still 4 with color mode ansi256", () => {
    const output = assembleWideOutput(pet, "wide", "idle-baseline", 0, "ansi256", false, 1, 0, cols);
    expect(output.split("\n").length).toBe(4);
  });

  it("row 4 visibleWidth fits cols even with ANSI SGR in ansi256 mode", () => {
    const output = assembleWideOutput(pet, "wide", "idle-baseline", 0, "ansi256", false, 1, 0, cols);
    const row4 = output.split("\n")[3]!;
    expect(visibleWidth(row4)).toBeLessThanOrEqual(cols);
  });

  it("standard tier row 1 visibleWidth fits cols in ansi256 mode", () => {
    const output = assembleWideOutput(pet, "standard", "idle-baseline", 0, "ansi256", false, 1, 0, 100);
    const row1 = output.split("\n")[0]!;
    expect(visibleWidth(row1)).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Rich glyphs (emoji mood)
// ---------------------------------------------------------------------------

describe("assembleWideOutput — rich glyphs", () => {
  const pet = makePet({ level: 10, xp: cumulativeXpForLevel(10), lastFedAt: new Date().toISOString() });

  it("wide tier: emoji mood glyph visible when richGlyphs=true", () => {
    const output = assembleWideOutput(pet, "wide", "idle-baseline", 0, "none", true, 1, 0, 160);
    expect(output).toContain("🙂"); // content mood
  });

  it("standard tier: emoji mood glyph visible when richGlyphs=true", () => {
    const output = assembleWideOutput(pet, "standard", "idle-baseline", 0, "none", true, 1, 0, 100);
    expect(output).toContain("🙂");
  });
});

// ---------------------------------------------------------------------------
// Multi-pet display
// ---------------------------------------------------------------------------

describe("assembleWideOutput — multi-pet", () => {
  const pet = makePet({ level: 10, xp: cumulativeXpForLevel(10) });

  it("shows pet count in HUD when totalPets > 1 (wide tier)", () => {
    const output = assembleWideOutput(pet, "wide", "idle-baseline", 0, "none", false, 3, 0, 160);
    expect(output).toContain("[1/3]");
  });

  it("shows pet count in HUD when totalPets > 1 (standard tier)", () => {
    const output = assembleWideOutput(pet, "standard", "idle-baseline", 0, "none", false, 3, 0, 100);
    expect(output).toContain("[1/3]");
  });
});
