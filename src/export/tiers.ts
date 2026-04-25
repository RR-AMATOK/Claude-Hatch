/**
 * GIF export tier specifications — DEC-005
 *
 * Three tiers gated by level:
 *   Tier 1 Snapshot  — L ≥ 25,   320×240,  8fps, ≤3s,  watermarked
 *   Tier 2 Portrait  — L ≥ 250,  640×480,  15fps, ≤10s, no watermark, scene picker
 *   Tier 3 Showcase  — L ≥ 1024, 1280×720, 30fps, ≤30s, cinematic + golden border
 *
 * The gate check reads `pet.xp` → computed level via `levelFromCumXp()`.
 * The `unlock.gif.tierN` flags are a convenience side-effect but are NOT the
 * gate source of truth — the level computation is.
 *
 * @see DEC-005
 */

import { levelFromCumXp } from "../xp/engine.js";
import type { Pet } from "../state/schema.js";
import type { SceneId } from "../../animations/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GifTier = 1 | 2 | 3;

export interface TierSpec {
  /** Minimum level to unlock this tier. */
  readonly requiredLevel: number;
  /** Output width in pixels. */
  readonly width: number;
  /** Output height in pixels. */
  readonly height: number;
  /** Target frame rate (fps). */
  readonly fps: number;
  /** Maximum capture duration in seconds. */
  readonly maxDurationSecs: number;
  /** Tier 1: add "glyphling" watermark in corner. */
  readonly watermark: boolean;
  /** Tier 2+: user may choose a scene. */
  readonly userScenePick: boolean;
  /** Tier 3: cinematic frame + "1024 Club" golden border. */
  readonly goldenBorder: boolean;
}

// ---------------------------------------------------------------------------
// Tier spec table — DEC-005 exact values
// ---------------------------------------------------------------------------

export const TIER_SPECS: Record<GifTier, TierSpec> = {
  1: {
    requiredLevel: 25,
    width: 320,
    height: 240,
    fps: 8,
    maxDurationSecs: 3,
    watermark: true,
    userScenePick: false,
    goldenBorder: false,
  },
  2: {
    requiredLevel: 250,
    width: 640,
    height: 480,
    fps: 15,
    maxDurationSecs: 10,
    watermark: false,
    userScenePick: true,
    goldenBorder: false,
  },
  3: {
    requiredLevel: 1024,
    width: 1280,
    height: 720,
    fps: 30,
    maxDurationSecs: 30,
    watermark: false,
    userScenePick: true,
    goldenBorder: true,
  },
} as const;

// ---------------------------------------------------------------------------
// Level helpers
// ---------------------------------------------------------------------------

/**
 * Returns the minimum level required to use a given tier.
 *
 * @example
 * requiredLevelForTier(1) // 25
 * requiredLevelForTier(2) // 250
 * requiredLevelForTier(3) // 1024
 */
export function requiredLevelForTier(tier: GifTier): number {
  return TIER_SPECS[tier].requiredLevel;
}

/**
 * Derive the current level from a pet's cumulative XP.
 * Thin wrapper so callers don't need to import xp/engine directly.
 */
export function currentLevelForPet(pet: Pet): number {
  return levelFromCumXp(pet.xp);
}

// ---------------------------------------------------------------------------
// Gate check
// ---------------------------------------------------------------------------

export type GateResult =
  | { ok: true; currentLevel: number; spec: TierSpec }
  | { ok: false; code: "TIER_LOCKED"; currentLevel: number; requiredLevel: number; message: string };

/**
 * Check whether `pet` has reached the level required for `tier`.
 *
 * Gate rule: `requiredLevelForTier(tier) <= currentLevel(pet)`.
 * The `unlock.gif.tierN` flags are a convenience hint only — this function
 * re-derives level from `pet.xp` each time (DEC-005 spec intent).
 */
export function gateForTier(tier: GifTier, pet: Pet): GateResult {
  const spec = TIER_SPECS[tier];
  const currentLevel = levelFromCumXp(pet.xp);

  if (currentLevel >= spec.requiredLevel) {
    return { ok: true, currentLevel, spec };
  }

  return {
    ok: false,
    code: "TIER_LOCKED",
    currentLevel,
    requiredLevel: spec.requiredLevel,
    message: `Tier ${tier} export requires level ${spec.requiredLevel}. Current level: ${currentLevel}.`,
  };
}

// ---------------------------------------------------------------------------
// Default scene per tier
// ---------------------------------------------------------------------------

/**
 * Default scene to capture when the user doesn't pick one (Tier 1, or fallback).
 * Uses `idle-baseline` — the safest well-defined scene for all species/stages.
 *
 * NOTE: @designer should validate this default target.
 */
export const DEFAULT_CAPTURE_SCENE: SceneId = "idle-baseline";

/**
 * Clamp a requested duration to the tier's maximum.
 */
export function clampDuration(tier: GifTier, requestedSecs: number): number {
  return Math.min(requestedSecs, TIER_SPECS[tier].maxDurationSecs);
}
