/**
 * GIFExporter — Module #19 (architecture §2.2)
 *
 * Top-level orchestrator for the three-tier GIF export system (DEC-005).
 *
 * Pipeline:
 *   1. Gate check: verify pet level ≥ required level for tier.
 *   2. Scene selection: use provided sceneId, or fall back to DEFAULT_CAPTURE_SCENE.
 *   3. Validate scene exists in the registry.
 *   4. Generate a vhs .tape file (in system tmp dir).
 *   5. Run vhs to produce the GIF.
 *   6. Cleanup the temp tape file.
 *   7. Return success with outputPath, or a structured error.
 *
 * All error paths return a structured Result — never throws to the caller.
 *
 * @see DEC-005 (tier system)
 * @see DEC-014 (vhs as the external capture tool)
 */

import fs from "fs";
import os from "os";
import path from "path";
import { ulid } from "ulid";

import type { Pet } from "../state/schema.js";
import type { SceneId } from "../../animations/types.js";
import { SCENES } from "../../animations/scenes/index.js";

import {
  type GifTier,
  type TierSpec,
  gateForTier,
  clampDuration,
  DEFAULT_CAPTURE_SCENE,
  TIER_SPECS,
} from "./tiers.js";
import { generateTape } from "./tape.js";
import { runVhs } from "./vhs.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportGifParams {
  /** Target tier (1 | 2 | 3). */
  tier: GifTier;
  /** The pet to export — used for gate check and informational metadata. */
  pet: Pet;
  /**
   * Scene to capture.
   * - Tier 1: if omitted, uses DEFAULT_CAPTURE_SCENE ("idle-baseline").
   * - Tier 2/3: user may pick; if omitted, falls back to DEFAULT_CAPTURE_SCENE.
   */
  sceneId?: SceneId;
  /**
   * Capture duration in seconds.
   * Clamped to spec.maxDurationSecs if exceeded.
   * Defaults to spec.maxDurationSecs.
   */
  durationSecs?: number;
  /**
   * Destination directory for the output GIF.
   * Defaults to os.homedir() (the user's home directory).
   */
  outputDir?: string;
  /**
   * Command used to invoke `glyphling capture`.
   * Defaults to "glyphling" (installed binary).
   * Override to "tsx src/cli.tsx" in dev mode.
   */
  glyphlingBin?: string;
  /**
   * Environment variables to forward to the capture subprocess (via the tape).
   * Used to pass GLYPHLING_HOME in dev/test mode.
   */
  envVars?: Record<string, string>;
}

export type ExportGifResult =
  | {
      ok: true;
      outputPath: string;
      tier: GifTier;
      sceneId: SceneId;
      durationSecs: number;
    }
  | {
      ok: false;
      code: "TIER_LOCKED" | "SCENE_NOT_FOUND" | "DURATION_EXCEEDS_CAP" | "VHS_NOT_INSTALLED" | "VHS_FAILED" | "IO_ERROR";
      message: string;
    };

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Export a GIF for the given pet at the requested tier.
 *
 * Returns a structured `ExportGifResult` — never throws.
 */
export async function exportGif(params: ExportGifParams): Promise<ExportGifResult> {
  const {
    tier,
    pet,
    sceneId: requestedScene,
    durationSecs: requestedDuration,
    outputDir = os.homedir(),
    glyphlingBin = "glyphling",
    envVars = {},
  } = params;

  // ── 1. Gate check ────────────────────────────────────────────────────────
  const gate = gateForTier(tier, pet);
  if (!gate.ok) {
    return { ok: false, code: "TIER_LOCKED", message: gate.message };
  }
  const spec: TierSpec = gate.spec;

  // ── 2. Scene resolution ──────────────────────────────────────────────────
  const sceneId: SceneId = requestedScene ?? DEFAULT_CAPTURE_SCENE;

  // ── 3. Scene validation ──────────────────────────────────────────────────
  if (!(sceneId in SCENES)) {
    return {
      ok: false,
      code: "SCENE_NOT_FOUND",
      message: `Scene "${sceneId}" not found in scene registry.`,
    };
  }

  // ── 4. Duration clamping ─────────────────────────────────────────────────
  const rawDuration = requestedDuration ?? spec.maxDurationSecs;
  const durationSecs = clampDuration(tier, rawDuration);

  // ── 5. Output path ───────────────────────────────────────────────────────
  const exportId = ulid();
  const outputFilename = `glyphling-tier${tier}-${exportId}.gif`;
  const outputPath = path.join(outputDir, outputFilename);

  // ── 6. Generate tape ─────────────────────────────────────────────────────
  const tapeContent = generateTape({
    tier,
    spec,
    sceneId,
    durationSecs,
    outputPath,
    glyphlingBin,
    envVars,
  });

  // Write tape to a temp file
  const tapeId = ulid();
  const tapePath = path.join(os.tmpdir(), `glyphling-tape-${tapeId}.tape`);

  try {
    await fs.promises.writeFile(tapePath, tapeContent, "utf8");
  } catch (err) {
    return {
      ok: false,
      code: "IO_ERROR",
      message: `Failed to write tape file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── 7. Run vhs + cleanup ────────────────────────────────────────────────
  const vhsResult = await runVhs(tapePath, outputPath).finally(async () => {
    // Cleanup tape file (best-effort — non-fatal if it fails)
    try {
      await fs.promises.unlink(tapePath);
    } catch {
      // Intentionally ignored
    }
  });

  if (!vhsResult.ok) {
    if (vhsResult.code === "VHS_NOT_INSTALLED") {
      return { ok: false, code: "VHS_NOT_INSTALLED", message: vhsResult.message };
    }
    return {
      ok: false,
      code: "VHS_FAILED",
      message: vhsResult.message,
    };
  }

  return { ok: true, outputPath, tier, sceneId, durationSecs };
}

// Re-export tier types for convenience
export type { GifTier, TierSpec };
export { TIER_SPECS, gateForTier, requiredLevelForTier } from "./tiers.js";
