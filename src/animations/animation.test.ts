/**
 * Animation library tests — integrity, parity, type narrowness.
 *
 * Tests per TODO-007 acceptance criteria:
 * - Scene registry exhaustiveness (22 scenes, all SceneIds present)
 * - Compact presence: every scene has compact.length >= 1
 * - Compact size: every compact frame ≤ 3 rows × ≤ 60 cols
 * - Frame presence: every scene has frames.length >= 1
 * - FPS ranges: 1 ≤ fps ≤ 60; reducedMotionFps ≤ fps if set
 * - Species coverage: idle scene resolvable for each species
 * - Personality → idle mapping for representative vectors
 */

import { describe, it, expect } from "vitest";
import {
  ALL_SCENES,
  SCENES,
  assertAllScenesHaveCompact,
  assertSceneRegistryComplete,
} from "../../animations/scenes/index.js";
import { ALL_SCENE_IDS } from "../../animations/types.js";
import type { SceneId } from "../../animations/types.js";
import { pickIdleVariant } from "../render/animation.js";
import type { PersonalityVector } from "../render/animation.js";
import type { PersonalityTrait } from "../state/schema.js";

// ---------------------------------------------------------------------------
// Helper: build a uniform PersonalityVector (all traits equal)
// ---------------------------------------------------------------------------

const ALL_TRAITS: readonly PersonalityTrait[] = [
  "Stoic",
  "Friendly",
  "Pragmatic",
  "Energetic",
  "Gruff",
  "Philosophical",
  "Paranoid",
  "Curious",
];

/**
 * Build a PersonalityVector. Supply `overrides` as exact final weights
 * for the traits you care about; remaining traits get equal shares of
 * the leftover weight so the vector sums to 1.0.
 *
 * Example: makeVector("Stoic", { Stoic: 0.32, Philosophical: 0.20 })
 *   → Stoic=0.32, Philosophical=0.20, remaining 6 traits each get (1-0.52)/6 ≈ 0.08
 */
function makeVector(
  dominant: PersonalityTrait,
  overrides: Partial<Record<PersonalityTrait, number>> = {}
): PersonalityVector {
  const overriddenTraits = new Set(Object.keys(overrides) as PersonalityTrait[]);
  const overrideTotal = Object.values(overrides).reduce((a, b) => a + b, 0);
  const remaining = 1 - overrideTotal;
  const remainingTraits = ALL_TRAITS.filter((t) => !overriddenTraits.has(t));
  const basePerRemaining = remaining / Math.max(remainingTraits.length, 1);

  const weights: Record<PersonalityTrait, number> = Object.fromEntries(
    ALL_TRAITS.map((t) => [
      t,
      overriddenTraits.has(t) ? (overrides[t] ?? 0) : basePerRemaining,
    ])
  ) as Record<PersonalityTrait, number>;

  return { dominant, weights };
}

// ---------------------------------------------------------------------------
// Scene registry exhaustiveness
// ---------------------------------------------------------------------------

describe("Scene registry exhaustiveness", () => {
  it("has exactly 22 scenes in ALL_SCENES", () => {
    expect(ALL_SCENES.length).toBe(22);
  });

  it("SCENES map contains all 22 SceneIds", () => {
    expect(ALL_SCENE_IDS.length).toBe(22);
    for (const id of ALL_SCENE_IDS) {
      expect(SCENES).toHaveProperty(id);
    }
  });

  it("assertSceneRegistryComplete passes without throwing", () => {
    expect(() => assertSceneRegistryComplete(SCENES)).not.toThrow();
  });

  it("ALL_SCENES ids match ALL_SCENE_IDS", () => {
    const registeredIds = new Set(ALL_SCENES.map((s) => s.id));
    for (const id of ALL_SCENE_IDS) {
      expect(registeredIds).toContain(id);
    }
  });
});

// ---------------------------------------------------------------------------
// Compact presence
// ---------------------------------------------------------------------------

describe("Compact presence", () => {
  it("every scene has compact.length >= 1", () => {
    for (const scene of ALL_SCENES) {
      expect(
        scene.compact.length,
        `Scene "${scene.id}" compact[] must not be empty`
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("assertAllScenesHaveCompact passes without throwing", () => {
    expect(() => assertAllScenesHaveCompact(ALL_SCENES)).not.toThrow();
  });

  it("assertAllScenesHaveCompact throws for a scene with empty compact[]", () => {
    const fakeScene = { ...ALL_SCENES[0]!, compact: [] };
    expect(() => assertAllScenesHaveCompact([fakeScene])).toThrow(
      /empty compact\[\]/i
    );
  });
});

// ---------------------------------------------------------------------------
// Compact size (≤3 rows × ≤60 cols)
// ---------------------------------------------------------------------------

describe("Compact size constraints", () => {
  for (const scene of ALL_SCENES) {
    describe(`Scene "${scene.id}"`, () => {
      for (let fi = 0; fi < scene.compact.length; fi++) {
        const cf = scene.compact[fi]!;

        it(`compact[${fi}] has ≤3 rows`, () => {
          expect(
            cf.rows.length,
            `compact[${fi}].rows.length = ${cf.rows.length}`
          ).toBeLessThanOrEqual(3);
        });

        for (let ri = 0; ri < cf.rows.length; ri++) {
          const row = cf.rows[ri]!;
          it(`compact[${fi}].rows[${ri}] width ≤60`, () => {
            const width = Array.from(row).length;
            expect(
              width,
              `Row "${row}" has width ${width} > 60`
            ).toBeLessThanOrEqual(60);
          });
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Frame presence
// ---------------------------------------------------------------------------

describe("Frame presence", () => {
  it("every scene has frames.length >= 1", () => {
    for (const scene of ALL_SCENES) {
      expect(
        scene.frames.length,
        `Scene "${scene.id}" frames[] must not be empty`
      ).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// FPS ranges
// ---------------------------------------------------------------------------

describe("FPS ranges", () => {
  it("every scene fps is 1–60", () => {
    for (const scene of ALL_SCENES) {
      expect(scene.fps, `Scene "${scene.id}" fps = ${scene.fps}`).toBeGreaterThanOrEqual(1);
      expect(scene.fps, `Scene "${scene.id}" fps = ${scene.fps}`).toBeLessThanOrEqual(60);
    }
  });

  it("reducedMotionFps ≤ fps if set", () => {
    for (const scene of ALL_SCENES) {
      if (scene.reducedMotionFps != null) {
        expect(
          scene.reducedMotionFps,
          `Scene "${scene.id}" reducedMotionFps > fps`
        ).toBeLessThanOrEqual(scene.fps);
      }
    }
  });

  it("reducedMotionFrameIndices are valid frame indices when set", () => {
    for (const scene of ALL_SCENES) {
      if (scene.reducedMotionFrameIndices != null) {
        for (const idx of scene.reducedMotionFrameIndices) {
          expect(
            idx,
            `Scene "${scene.id}" reducedMotionFrameIndices[${idx}] out of range`
          ).toBeLessThan(scene.frames.length);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Species coverage
// ---------------------------------------------------------------------------

describe("Species coverage", () => {
  const SPECIES = ["circuit", "rune", "shard", "bloom"] as const;

  it("getCompactSilhouette returns a silhouette for each species × stage", async () => {
    const { getCompactSilhouette } = await import("../../animations/species.js");
    const stages = ["hatchling", "juvenile", "adult"] as const;
    for (const species of SPECIES) {
      for (const stage of stages) {
        const s = getCompactSilhouette(species, stage);
        expect(typeof s.top).toBe("string");
        expect(typeof s.bottom).toBe("string");
        expect(s.top.length).toBeGreaterThan(0);
        expect(s.bottom.length).toBeGreaterThan(0);
      }
    }
  });

  it("at least one idle scene is resolvable per species (via pickIdleVariant)", () => {
    // All species share the same idle scenes (species divergence is silhouette swap, not scene selection).
    // Verify pickIdleVariant returns a valid idle SceneId for a balanced vector.
    const IDLE_SCENE_IDS = new Set<SceneId>([
      "idle-baseline",
      "idle-chipper",
      "idle-stoic",
      "idle-curious",
      "idle-grumpy",
    ]);

    const balanced = makeVector("Pragmatic");
    const result = pickIdleVariant(balanced);
    expect(IDLE_SCENE_IDS).toContain(result);

    // Verify the resolved scene exists in the registry
    expect(SCENES).toHaveProperty(result);
  });
});

// ---------------------------------------------------------------------------
// Personality → idle mapping
// ---------------------------------------------------------------------------

describe("pickIdleVariant", () => {
  const IDLE_SCENE_IDS = new Set<SceneId>([
    "idle-baseline",
    "idle-chipper",
    "idle-stoic",
    "idle-curious",
    "idle-grumpy",
  ]);

  it("balanced / Pragmatic-dominant → idle-baseline", () => {
    const p = makeVector("Pragmatic");
    expect(pickIdleVariant(p)).toBe("idle-baseline");
  });

  it("Gruff-dominant → idle-grumpy", () => {
    const p = makeVector("Gruff", { Gruff: 0.5 });
    expect(pickIdleVariant(p)).toBe("idle-grumpy");
  });

  it("Paranoid-dominant + low Friendly → idle-grumpy", () => {
    const p = makeVector("Paranoid", { Paranoid: 0.45, Friendly: 0.05 });
    expect(pickIdleVariant(p)).toBe("idle-grumpy");
  });

  it("Stoic-dominant + high Philosophical → idle-stoic", () => {
    // Stoic + Philosophical must sum > 0.45; dominant must be Stoic
    const p = makeVector("Stoic", { Stoic: 0.28, Philosophical: 0.22, Friendly: 0.05, Gruff: 0.05 });
    expect(pickIdleVariant(p)).toBe("idle-stoic");
  });

  it("Energetic + Friendly dominant → idle-chipper", () => {
    // Energetic + Friendly must sum > 0.45; dominant must be Energetic
    const p = makeVector("Energetic", { Energetic: 0.28, Friendly: 0.22, Gruff: 0.05, Paranoid: 0.05 });
    expect(pickIdleVariant(p)).toBe("idle-chipper");
  });

  it("Curious-dominant (weight > 0.35) → idle-curious", () => {
    // Curious weight must be > 0.35; Gruff must be ≤ 0.3
    const p = makeVector("Curious", { Curious: 0.40, Gruff: 0.1 });
    expect(pickIdleVariant(p)).toBe("idle-curious");
  });

  it("always returns one of the 5 idle SceneIds", () => {
    const vectors: PersonalityVector[] = [
      makeVector("Stoic"),
      makeVector("Friendly"),
      makeVector("Pragmatic"),
      makeVector("Energetic"),
      makeVector("Gruff"),
      makeVector("Philosophical"),
      makeVector("Paranoid"),
      makeVector("Curious"),
    ];
    for (const v of vectors) {
      const result = pickIdleVariant(v);
      expect(IDLE_SCENE_IDS, `pickIdleVariant returned "${result}"`).toContain(result);
    }
  });
});

// ---------------------------------------------------------------------------
// One-shot chain integrity
// ---------------------------------------------------------------------------

describe("One-shot chain integrity", () => {
  it("chainsTo references a valid SceneId when set", () => {
    const validIds = new Set(ALL_SCENE_IDS);
    for (const scene of ALL_SCENES) {
      if (scene.chainsTo != null) {
        expect(
          validIds,
          `Scene "${scene.id}" chainsTo "${scene.chainsTo}" which is not a valid SceneId`
        ).toContain(scene.chainsTo);
      }
    }
  });

  it("hatch-crack chains to hatch-emerge", () => {
    expect(SCENES["hatch-crack"].chainsTo).toBe("hatch-emerge");
  });

  it("hatch-emerge chains to idle-baseline", () => {
    expect(SCENES["hatch-emerge"].chainsTo).toBe("idle-baseline");
  });

  it("eat-feast chains to happy-sparkle", () => {
    expect(SCENES["eat-feast"].chainsTo).toBe("happy-sparkle");
  });

  it("death-fade has no chainsTo (latches)", () => {
    expect(SCENES["death-fade"].chainsTo).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Reduced-motion variants
// ---------------------------------------------------------------------------

describe("Reduced-motion variants", () => {
  it("levelup-flash has reducedMotionFps and reducedMotionFrameIndices", () => {
    const scene = SCENES["levelup-flash"];
    expect(scene.reducedMotionFps).toBeDefined();
    expect(scene.reducedMotionFrameIndices).toBeDefined();
    expect(scene.reducedMotionFrameIndices!.length).toBe(3); // per spec: 3-frame variant
  });

  it("ascend-1024 has reducedMotionFps and reducedMotionFrameIndices", () => {
    const scene = SCENES["ascend-1024"];
    expect(scene.reducedMotionFps).toBeDefined();
    expect(scene.reducedMotionFrameIndices).toBeDefined();
  });
});
