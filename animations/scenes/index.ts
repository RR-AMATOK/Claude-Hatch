/**
 * Scene registry — all 22 scenes.
 *
 * DEC-016: every scene ships BOTH frames[] AND compact[]. Empty compact[] fails build.
 * assertAllScenesHaveCompact() runs at module load time and throws on violation.
 *
 * Scene count: 22 (matches designer spec §3 and SceneId union).
 */

import type { Scene, SceneId } from "../types.js";
import { ALL_SCENE_IDS } from "../types.js";

import { idleBaseline } from "./idle-baseline.js";
import { idleChipper } from "./idle-chipper.js";
import { idleStoic } from "./idle-stoic.js";
import { idleCurious } from "./idle-curious.js";
import { idleGrumpy } from "./idle-grumpy.js";
import { eatSmall } from "./eat-small.js";
import { eatFeast } from "./eat-feast.js";
import { sleep } from "./sleep.js";
import { sleepDeep } from "./sleep-deep.js";
import { playBounce } from "./play-bounce.js";
import { playChase } from "./play-chase.js";
import { sick } from "./sick.js";
import { sickWorse } from "./sick-worse.js";
import { happyWag } from "./happy-wag.js";
import { happySparkle } from "./happy-sparkle.js";
import { sad } from "./sad.js";
import { hatchCrack } from "./hatch-crack.js";
import { hatchEmerge } from "./hatch-emerge.js";
import { evolveShimmer } from "./evolve-shimmer.js";
import { deathFade } from "./death-fade.js";
import { levelupFlash } from "./levelup-flash.js";
import { ascend1024 } from "./ascend-1024.js";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const ALL_SCENES: readonly Scene[] = [
  idleBaseline,
  idleChipper,
  idleStoic,
  idleCurious,
  idleGrumpy,
  eatSmall,
  eatFeast,
  sleep,
  sleepDeep,
  playBounce,
  playChase,
  sick,
  sickWorse,
  happyWag,
  happySparkle,
  sad,
  hatchCrack,
  hatchEmerge,
  evolveShimmer,
  deathFade,
  levelupFlash,
  ascend1024,
];

export const SCENES: Readonly<Record<SceneId, Scene>> = Object.fromEntries(
  ALL_SCENES.map((s) => [s.id, s])
) as Record<SceneId, Scene>;

// ---------------------------------------------------------------------------
// Build-time validation — runs at module load (DEC-016, expanded-frames.md §8.4)
// ---------------------------------------------------------------------------

/**
 * Throws if any scene is missing frames or compact frames.
 * Also validates compact frame dimensions: ≤3 rows × ≤60 cols.
 * Called at module top-level so tests catch violations immediately.
 */
export function assertAllScenesHaveCompact(scenes: readonly Scene[]): void {
  for (const scene of scenes) {
    if (scene.frames.length === 0) {
      throw new Error(
        `Scene "${scene.id}" has empty frames[]. Every scene must have at least 1 frame.`
      );
    }
    if (scene.compact.length === 0) {
      throw new Error(
        `Scene "${scene.id}" has empty compact[]. DEC-016: empty compact[] fails build.`
      );
    }
    for (let fi = 0; fi < scene.compact.length; fi++) {
      const cf = scene.compact[fi]!;
      if (cf.rows.length > 3) {
        throw new Error(
          `Scene "${scene.id}" compact[${fi}].rows.length = ${cf.rows.length} > 3 (max 3 rows).`
        );
      }
      for (let ri = 0; ri < cf.rows.length; ri++) {
        const row = cf.rows[ri]!;
        const width = Array.from(row).length;
        if (width > 60) {
          throw new Error(
            `Scene "${scene.id}" compact[${fi}].rows[${ri}] width = ${width} > 60 cols. Row: "${row}"`
          );
        }
      }
    }
  }
}

/**
 * Verifies the SCENES registry has exactly one entry per SceneId.
 */
export function assertSceneRegistryComplete(scenes: Readonly<Record<SceneId, Scene>>): void {
  const missing: SceneId[] = [];
  for (const id of ALL_SCENE_IDS) {
    if (!(id in scenes)) {
      missing.push(id);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Scene registry is missing: ${missing.join(", ")}. All 22 SceneIds must be registered.`
    );
  }
}

// Run assertions at module load — tests catch these as import-time errors.
assertAllScenesHaveCompact(ALL_SCENES);
assertSceneRegistryComplete(SCENES);

// Named re-exports for convenience
export {
  idleBaseline,
  idleChipper,
  idleStoic,
  idleCurious,
  idleGrumpy,
  eatSmall,
  eatFeast,
  sleep,
  sleepDeep,
  playBounce,
  playChase,
  sick,
  sickWorse,
  happyWag,
  happySparkle,
  sad,
  hatchCrack,
  hatchEmerge,
  evolveShimmer,
  deathFade,
  levelupFlash,
  ascend1024,
};
