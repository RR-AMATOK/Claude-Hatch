/**
 * vhs tape DSL generator — DEC-014
 *
 * Produces a `.tape` file string for `vhs` (charmbracelet).
 * The tape drives a `glyphling capture <sceneId> --fps N --duration S`
 * subprocess so that vhs can capture the ANSI output as a GIF.
 *
 * Tape DSL reference: https://github.com/charmbracelet/vhs
 *
 * @see DEC-005 (tier specs)
 * @see DEC-014 (vhs as external tool)
 */

import type { GifTier, TierSpec } from "./tiers.js";
import type { SceneId } from "../../animations/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TapeConfig {
  /** Tier being exported (drives resolution, fps, duration, decorations). */
  tier: GifTier;
  /** Resolved tier spec — caller provides so this module stays pure. */
  spec: TierSpec;
  /** Scene to capture. */
  sceneId: SceneId;
  /** Capture duration in seconds (already clamped to spec.maxDurationSecs). */
  durationSecs: number;
  /** Absolute output path for the GIF (e.g. /tmp/glyphling-export-ULID.gif). */
  outputPath: string;
  /**
   * Command used to invoke the glyphling capture subcommand.
   * Defaults to `glyphling` but can be overridden for dev (e.g. `tsx src/cli.tsx`).
   */
  glyphlingBin?: string;
  /**
   * Extra environment variables to inject into the tape's shell environment.
   * Primarily used to pass GLYPHLING_HOME into the capture subprocess.
   */
  envVars?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Tape generator
// ---------------------------------------------------------------------------

/**
 * Generate a vhs `.tape` DSL string for the given export configuration.
 *
 * The tape:
 *   1. Sets output file and terminal dimensions.
 *   2. Sets framerate to tier spec fps.
 *   3. Optionally sets golden-border / watermark comments (vhs doesn't have
 *      a native golden-border — we encode it as a comment sentinel that a
 *      post-process step can read; the capture command itself draws the border).
 *   4. Launches the headless capture subprocess.
 *   5. Sleeps for the capture duration, then quits.
 *
 * @returns A string ready to write to a `.tape` file.
 */
export function generateTape(config: TapeConfig): string {
  const { tier, spec, sceneId, durationSecs, outputPath, glyphlingBin = "glyphling", envVars = {} } = config;

  const lines: string[] = [];

  // --- Output ---
  lines.push(`Output "${outputPath}"`);
  lines.push("");

  // --- Terminal setup ---
  lines.push(`Set Width ${spec.width}`);
  lines.push(`Set Height ${spec.height}`);
  lines.push(`Set Framerate ${spec.fps}`);
  // Reasonable font size for readability at target resolution
  lines.push(`Set FontSize ${fontSizeForResolution(spec.width)}`);
  lines.push(`Set Theme "Dracula"`);
  lines.push("");

  // --- Decoration markers (parsed post-capture by gifWrapper if needed) ---
  if (spec.watermark) {
    lines.push(`# GLYPHLING_WATERMARK=1`);
  }
  if (spec.goldenBorder) {
    lines.push(`# GLYPHLING_GOLDEN_BORDER=1`);
    lines.push(`# GLYPHLING_TIER=3`);
  }
  if (spec.watermark || spec.goldenBorder) {
    lines.push("");
  }

  // --- Environment setup ---
  const envLine = buildEnvPrefix(envVars);

  // --- Launch the capture subprocess ---
  // The capture command prints ANSI frames to stdout and exits naturally.
  const captureCmd = `${envLine}${glyphlingBin} capture ${sceneId} --fps ${spec.fps} --duration ${durationSecs}`;
  lines.push(`Type "${escapeForTape(captureCmd)}"`);
  lines.push(`Enter`);
  lines.push("");

  // --- Wait for capture to complete ---
  // Add 0.5s margin so vhs doesn't cut the last frame
  const sleepDuration = (durationSecs + 0.5).toFixed(1);
  lines.push(`Sleep ${sleepDuration}s`);

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map resolution width to a readable terminal font size.
 * Smaller resolution = larger font (so the pet fills more of the frame).
 */
function fontSizeForResolution(width: number): number {
  if (width <= 320) return 18;
  if (width <= 640) return 14;
  return 12; // 1280 wide
}

/**
 * Build a VAR=value prefix string for the capture subprocess.
 * Each key=value is shell-escaped with single quotes for safety.
 */
function buildEnvPrefix(envVars: Record<string, string>): string {
  const entries = Object.entries(envVars);
  if (entries.length === 0) return "";
  const parts = entries.map(([k, v]) => `${k}='${v.replace(/'/g, "'\\''")}'`);
  return parts.join(" ") + " ";
}

/**
 * Escape a command string for use inside a vhs `Type "..."` directive.
 * vhs uses Go's `strconv.Unquote` semantics — double-quote and backslash need escaping.
 */
function escapeForTape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
