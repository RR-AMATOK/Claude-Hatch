/**
 * animations/index.ts — top-level barrel
 *
 * Re-exports all types, species tokens, and the scene registry.
 * Import from "../../animations/index.js" in src/ code.
 */

// Types
export type {
  SceneId,
  SceneTrigger,
  Species,
  LifeStage,
  ColorToken,
  Frame,
  CompactFrame,
  Scene,
} from "./types.js";

export { ALL_SCENE_IDS, ALL_COLOR_TOKENS, lifeStageFromLevel } from "./types.js";

// Species data
export type { CompactSilhouette, ExpandedSilhouette } from "./species.js";
export {
  getCompactSilhouette,
  getExpandedSilhouette,
  EGG_SHAPES,
  DEATH_DISSOLVE,
  EFFECT_VOCAB,
} from "./species.js";

// Scene registry + assertions
export {
  ALL_SCENES,
  SCENES,
  assertAllScenesHaveCompact,
  assertSceneRegistryComplete,
} from "./scenes/index.js";

// Individual scenes (for direct import by consumers)
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
} from "./scenes/index.js";
