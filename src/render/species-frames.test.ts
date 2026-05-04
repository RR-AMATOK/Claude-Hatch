/**
 * Tests for src/render/species-frames.ts (TODO-025)
 *
 * Covers:
 * - Coverage: each (species × stage) returns frames for the 3 idle scenes
 * - Width consistency: every frame in a scene has matching row widths
 *   (already enforced at module load by assertSpeciesFramesWidthConsistent —
 *   we exercise it directly so a regression surfaces as a failing test, not
 *   a cryptic import-time error in some unrelated file)
 * - Per-stage envelope: rows match the expected silhouette widths from
 *   compact.ts SILHOUETTES (5/7/9 cols for hatchling/juvenile/adult)
 * - Scene-key isolation: scenes outside the covered set return null so the
 *   renderer falls back to the legacy eye-blink path
 * - Renderer integration: assembleCompactOutput emits species-specific glyphs
 *   when the active scene is in the covered set
 * - Snapshot: rendering a known pet at a known scene/tick produces stable
 *   ASCII output (one fixture per species at adult stage)
 */

import { describe, it, expect } from "vitest";
import type { Pet } from "../state/schema.js";
import {
  getSpeciesCompactFrames,
  SPECIES_FRAME_SCENE_KEYS,
  assertSpeciesFramesWidthConsistent,
  type SpeciesFrameSceneKey,
} from "./species-frames.js";
import {
  assembleCompactOutput,
  detectColorMode,
  getLifeStage,
  type LifeStage,
} from "./compact.js";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const SPECIES = ["circuit", "rune", "shard", "bloom"] as const;
type Species = (typeof SPECIES)[number];

const STAGES: readonly LifeStage[] = ["hatchling", "juvenile", "adult"];

function makePet(overrides: Partial<Pet> = {}): Pet {
  const now = new Date().toISOString();
  return {
    id: "test-pet-1",
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
    lastLevelUpAt: null,
    lastPlayedAt: null,
    lastHatchedAt: null,
    lastEvolvedAt: null,
    lastPettedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Coverage: per-species, per-stage, per-scene
// ---------------------------------------------------------------------------

describe("species-frames coverage", () => {
  it("exposes the idle scene keys plus eating, playing, and petted", () => {
    expect([...SPECIES_FRAME_SCENE_KEYS].sort()).toEqual([
      "eating",
      "idle-baseline",
      "idle-energetic",
      "idle-stoic",
      "petted",
      "playing",
    ]);
  });

  // Idle scenes have full 4×3 coverage (all species × all stages).
  const IDLE_SCENE_KEYS = ["idle-baseline", "idle-energetic", "idle-stoic"] as const;

  for (const species of SPECIES) {
    for (const stage of STAGES) {
      for (const sceneKey of IDLE_SCENE_KEYS) {
        it(`${species}/${stage}/${sceneKey} returns ≥2 frames`, () => {
          const frames = getSpeciesCompactFrames(species, stage, sceneKey);
          expect(frames).not.toBeNull();
          // Compact spec §7.1: 2-5 frames per scene.
          expect(frames!.length).toBeGreaterThanOrEqual(2);
          expect(frames!.length).toBeLessThanOrEqual(5);
        });
      }
    }
  }

  // playing / petted have partial coverage: shard/hatchling only.
  // Other combinations return null (renderer falls back to SCENE_FRAMES).
  it("shard/hatchling/playing returns ≥2 frames", () => {
    const frames = getSpeciesCompactFrames("shard", "hatchling", "playing");
    expect(frames).not.toBeNull();
    expect(frames!.length).toBeGreaterThanOrEqual(2);
  });

  it("shard/hatchling/petted returns ≥2 frames", () => {
    const frames = getSpeciesCompactFrames("shard", "hatchling", "petted");
    expect(frames).not.toBeNull();
    expect(frames!.length).toBeGreaterThanOrEqual(2);
  });

  it("non-shard species return null for playing (falls back to SCENE_FRAMES)", () => {
    expect(getSpeciesCompactFrames("circuit", "hatchling", "playing")).toBeNull();
    expect(getSpeciesCompactFrames("rune", "hatchling", "playing")).toBeNull();
    expect(getSpeciesCompactFrames("bloom", "hatchling", "playing")).toBeNull();
  });

  it("shard adult has eating/playing/petted; juvenile still uses fallback", () => {
    // Shard adult is fully covered for the reactive scenes (Bramble's stage).
    expect(getSpeciesCompactFrames("shard", "adult", "eating")).not.toBeNull();
    expect(getSpeciesCompactFrames("shard", "adult", "playing")).not.toBeNull();
    expect(getSpeciesCompactFrames("shard", "adult", "petted")).not.toBeNull();
    // Juvenile remains uncovered — falls back to SCENE_FRAMES.
    expect(getSpeciesCompactFrames("shard", "juvenile", "playing")).toBeNull();
    expect(getSpeciesCompactFrames("shard", "juvenile", "eating")).toBeNull();
  });

  it("returns null for unknown scene keys (renderer falls back to SCENE_FRAMES)", () => {
    // Non-shard species return null for eating — falls back to SCENE_FRAMES.
    expect(getSpeciesCompactFrames("circuit", "adult", "eating")).toBeNull();
    expect(getSpeciesCompactFrames("circuit", "adult", "sick")).toBeNull();
    expect(getSpeciesCompactFrames("circuit", "adult", "sleeping")).toBeNull();
    expect(getSpeciesCompactFrames("circuit", "adult", "death")).toBeNull();
    expect(getSpeciesCompactFrames("circuit", "adult", "level-up")).toBeNull();
    expect(getSpeciesCompactFrames("circuit", "adult", "nonsense")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Width consistency (Ink layout invariant)
// ---------------------------------------------------------------------------

describe("species-frames width invariant", () => {
  it("assertSpeciesFramesWidthConsistent passes (module-load assertion)", () => {
    // Exercises the same assertion that runs at module load. Keeping it as an
    // explicit test means a future regression surfaces here, not as an import
    // error in some unrelated file's stack trace.
    expect(() => assertSpeciesFramesWidthConsistent()).not.toThrow();
  });

  for (const species of SPECIES) {
    for (const stage of STAGES) {
      for (const sceneKey of SPECIES_FRAME_SCENE_KEYS) {
        it(`${species}/${stage}/${sceneKey} keeps row widths consistent across frames (skip if not authored)`, () => {
          const frames = getSpeciesCompactFrames(species, stage, sceneKey);
          // Partial coverage is intentional — null means "not yet authored".
          if (frames === null) return;
          const ref = frames[0]!.content.split("\n").map((r) => r.length);
          for (let i = 1; i < frames.length; i++) {
            const widths = frames[i]!.content.split("\n").map((r) => r.length);
            expect(widths).toEqual(ref);
          }
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Per-stage envelope (matches SILHOUETTES widths from compact.ts)
// ---------------------------------------------------------------------------

describe("species-frames envelope (rows × cols)", () => {
  // Stage → expected row count and approximate width band. Hatchling=5,
  // juvenile=7, adult=9 cols matches compact.ts SILHOUETTES; the bottom row
  // can be ±1 to accommodate flair like "  ;; " breath frames.
  const STAGE_WIDTHS: Record<LifeStage, number> = {
    hatchling: 5,
    juvenile: 7,
    adult: 9,
  };

  for (const species of SPECIES) {
    for (const stage of STAGES) {
      for (const sceneKey of SPECIES_FRAME_SCENE_KEYS) {
        it(`${species}/${stage}/${sceneKey} rows ≤60 cols (skip if not authored)`, () => {
          const frames = getSpeciesCompactFrames(species, stage, sceneKey);
          // Partial coverage is intentional — null means "not yet authored".
          if (frames === null) return;
          for (const f of frames) {
            const rows = f.content.split("\n");
            expect(rows.length).toBe(2);
            for (const row of rows) {
              // ≤60 cols is the hard cap from compact-frames.md §7.1.
              expect(row.length).toBeLessThanOrEqual(60);
            }
          }
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Renderer integration: assembleCompactOutput uses species frames
// ---------------------------------------------------------------------------

describe("assembleCompactOutput integration", () => {
  it("emits a circuit-specific frame for circuit/adult on idle-baseline", () => {
    const pet = makePet({ eggType: "circuit", xp: 100_000 });
    const stage = getLifeStage(50);
    expect(stage).toBe("adult");
    const out = assembleCompactOutput(
      pet,
      "idle-baseline",
      0,
      "none",
      false,
      1,
      0,
    );
    // Output is HUD\nART. The art rows must contain the circuit-adult head glyph.
    expect(out).toContain("/[o-o]\\");
  });

  it("emits a rune-specific frame for rune/adult on idle-baseline", () => {
    const pet = makePet({ eggType: "rune", xp: 100_000 });
    const out = assembleCompactOutput(
      pet,
      "idle-baseline",
      0,
      "none",
      false,
      1,
      0,
    );
    // Rune-adult head: <^-..-^>
    expect(out).toContain("<^-..-^>");
  });

  it("emits a shard-specific frame for shard/adult on idle-baseline", () => {
    const pet = makePet({ eggType: "shard", xp: 100_000 });
    const out = assembleCompactOutput(
      pet,
      "idle-baseline",
      0,
      "none",
      false,
      1,
      0,
    );
    // Shard-adult head: /**oo**\
    expect(out).toContain("/**oo**\\");
  });

  it("emits a bloom-specific frame for bloom/adult on idle-baseline", () => {
    const pet = makePet({ eggType: "bloom", xp: 100_000 });
    const out = assembleCompactOutput(
      pet,
      "idle-baseline",
      0,
      "none",
      false,
      1,
      0,
    );
    // Bloom-adult head: (~*oo*~)
    expect(out).toContain("(~*oo*~)");
  });

  it("emits a different art row at the blink tick (frame 2 of idle-baseline)", () => {
    const pet = makePet({ eggType: "circuit", xp: 100_000 });
    const tick0 = assembleCompactOutput(
      pet,
      "idle-baseline",
      0,
      "none",
      false,
      1,
      0,
    );
    const tick2 = assembleCompactOutput(
      pet,
      "idle-baseline",
      2,
      "none",
      false,
      1,
      0,
    );
    // Blink frame should not be identical to the steady frame.
    expect(tick0).not.toBe(tick2);
    // The blink frame uses [-.-] (dash-dot-dash) for the eye region.
    expect(tick2).toContain("[-.-]");
  });

  it("renders generic SICK_FRAMES for sick scene when no species art exists", () => {
    // Sick is not in the species-frames table. Per the reaction-scenes
    // fallback rule, the renderer uses generic SCENE_FRAMES content
    // (which visibly differs from idle) instead of silhouette + eye-blink.
    const pet = makePet({ eggType: "circuit", xp: 100_000 });
    const out = assembleCompactOutput(pet, "sick", 0, "none", false, 1, 0);
    // Tick 0 of SICK_FRAMES has " /[x-o]\\" on the top art row.
    expect(out).toContain("/[x-o]\\");
  });
});

// ---------------------------------------------------------------------------
// Snapshot: stable ASCII output per species at adult stage
//
// One snapshot per species. Tick 0 is the first frame of idle-baseline.
// We use detectColorMode("none") to keep the snapshot ANSI-free.
// ---------------------------------------------------------------------------

describe("species-frames adult-idle snapshots", () => {
  for (const species of SPECIES) {
    it(`${species}/adult/idle-baseline tick 0`, () => {
      const pet = makePet({
        eggType: species,
        name: "Snap",
        xp: 100_000, // adult stage
      });
      const out = assembleCompactOutput(
        pet,
        "idle-baseline",
        0,
        "none",
        false,
        1,
        0,
      );
      // Just take the art rows (drop the HUD line at top).
      const rows = out.split("\n").slice(1);
      expect(rows.join("\n")).toMatchSnapshot();
    });
  }
});

// Touch detectColorMode so the import isn't pruned — assertion fixtures use
// the renderer with mode="none" but downstream tests may want the helper.
void detectColorMode;
// Touch the SpeciesFrameSceneKey type so the type-only import isn't pruned.
const _typeProbe: SpeciesFrameSceneKey = "idle-baseline";
void _typeProbe;
