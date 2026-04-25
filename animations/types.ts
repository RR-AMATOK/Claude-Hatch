/**
 * Animation types — architecture §12.3 + DEC-016
 *
 * Shared type definitions for the animation library.
 * Scene and Frame data live in animations/scenes/*.ts.
 *
 * Species identifiers: lowercase circuit | rune | shard | bloom (DEC-017).
 * Life stages: hatchling (L0–L2) | juvenile (L3–L9) | adult (L10–L1024).
 * ColorTokens: the 11-token palette from compact-frames.md §6.2.
 */

// ---------------------------------------------------------------------------
// Scene identifiers — 22 scenes per designer spec §3
// ---------------------------------------------------------------------------

export type SceneId =
  | "idle-baseline"
  | "idle-chipper"
  | "idle-stoic"
  | "idle-curious"
  | "idle-grumpy"
  | "eat-small"
  | "eat-feast"
  | "sleep"
  | "sleep-deep"
  | "play-bounce"
  | "play-chase"
  | "sick"
  | "sick-worse"
  | "happy-wag"
  | "happy-sparkle"
  | "sad"
  | "hatch-crack"
  | "hatch-emerge"
  | "evolve-shimmer"
  | "death-fade"
  | "levelup-flash"
  | "ascend-1024";

/** All 22 scene IDs as a runtime tuple for exhaustiveness checks. */
export const ALL_SCENE_IDS: readonly SceneId[] = [
  "idle-baseline",
  "idle-chipper",
  "idle-stoic",
  "idle-curious",
  "idle-grumpy",
  "eat-small",
  "eat-feast",
  "sleep",
  "sleep-deep",
  "play-bounce",
  "play-chase",
  "sick",
  "sick-worse",
  "happy-wag",
  "happy-sparkle",
  "sad",
  "hatch-crack",
  "hatch-emerge",
  "evolve-shimmer",
  "death-fade",
  "levelup-flash",
  "ascend-1024",
] as const;

// ---------------------------------------------------------------------------
// Scene trigger discriminated union
// ---------------------------------------------------------------------------

export type SceneTrigger =
  | { kind: "idle" }
  | { kind: "command"; command: "feed" | "pet" | "play" | "sleep" }
  | { kind: "state"; when: "sick" | "hatching" | "evolving" | "dying" }
  | { kind: "event"; event: "levelup" | "ascend" };

// ---------------------------------------------------------------------------
// Species and life stage
// ---------------------------------------------------------------------------

export type Species = "circuit" | "rune" | "shard" | "bloom";
export type LifeStage = "hatchling" | "juvenile" | "adult";

/** Resolve life stage from level per compact-frames.md §3.3 */
export function lifeStageFromLevel(level: number): LifeStage {
  if (level <= 2) return "hatchling";
  if (level <= 9) return "juvenile";
  return "adult";
}

// ---------------------------------------------------------------------------
// Color palette — 11 tokens from compact-frames.md §6.2
// ---------------------------------------------------------------------------

export type ColorToken =
  | "text-primary"
  | "text-secondary"
  | "surface-muted"
  | "primary"
  | "accent-level"
  | "success"
  | "warning"
  | "error-muted"
  | "error"
  | "level-up"
  | "death";

export const ALL_COLOR_TOKENS: readonly ColorToken[] = [
  "text-primary",
  "text-secondary",
  "surface-muted",
  "primary",
  "accent-level",
  "success",
  "warning",
  "error-muted",
  "error",
  "level-up",
  "death",
] as const;

// ---------------------------------------------------------------------------
// Frame types
// ---------------------------------------------------------------------------

/**
 * Expanded-view frame (6 rows × 20 cols pet cell).
 * DEC-015: content is static data; no work at render time.
 */
export interface Frame {
  /**
   * Multi-line ASCII string. Rows 1–4 are the pet silhouette;
   * use effectRow/shadowRow for the rows above/below.
   * Max 4 rows × 20 cols for the silhouette itself.
   */
  readonly rows: readonly string[];
  /** Optional row above the pet (sparks, food crumbs, level-up bursts). 20 cols max. */
  readonly effectRow?: string;
  /** Optional row below the pet (shadow, ground, tombstone base). 20 cols max. */
  readonly shadowRow?: string;
  /** Per-frame color overrides using the 11-token palette. */
  readonly palette?: Readonly<Partial<Record<ColorToken, true>>>;
  /** Per-frame duration override (else 1000/fps applies). */
  readonly durationMs?: number;
}

/**
 * Compact statusline frame (≤3 rows × ≤60 cols per DEC-016 + compact-frames.md §7.1).
 * Boot-time invariant: rows.length ≤ 3 AND every row.length ≤ 60.
 */
export interface CompactFrame {
  /**
   * Up to 3 rows for the statusline. Row 1+2 = pet art; Row 3 = HUD (Cinema layout).
   * Each row MUST be ≤60 visible characters.
   */
  readonly rows: readonly string[];
  /**
   * Optional separate HUD string for the Cinema layout (row 3).
   * When set, renderer emits rows[0..1] then hudRow as the 3rd line.
   */
  readonly hudRow?: string;
  /** Per-frame color overrides. */
  readonly palette?: Readonly<Partial<Record<ColorToken, true>>>;
  /** Per-frame duration override. */
  readonly durationMs?: number;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/**
 * A complete animation scene per architecture §12.3 + DEC-016.
 *
 * Invariants (enforced by assertAllScenesHaveCompact + tests):
 * - frames.length >= 1
 * - compact.length >= 1
 * - every compact frame: rows.length <= 3, every row.length <= 60
 */
export interface Scene {
  readonly id: SceneId;
  readonly trigger: SceneTrigger;
  /** Target fps. Drives useFrame(fps) in the Ink renderer. */
  readonly fps: number;
  /** Whether this scene loops or plays once. */
  readonly loop: boolean;
  /** For one-shots: scene to transition to when this scene ends. */
  readonly chainsTo?: SceneId;
  /**
   * Reduced-motion fps override. When GLYPHLING_REDUCED_MOTION=1 and this
   * is set, the frame rate is clamped to this value.
   */
  readonly reducedMotionFps?: number;
  /**
   * For reduced-motion: indices of frames to keep. When set and
   * GLYPHLING_REDUCED_MOTION=1, only these frame indices are rendered.
   */
  readonly reducedMotionFrameIndices?: readonly number[];
  /** Expanded-view frames (6×20 pet cell). */
  readonly frames: readonly Frame[];
  /** Compact statusline frames (≤3×≤60). REQUIRED — empty fails build. */
  readonly compact: readonly CompactFrame[];
}
