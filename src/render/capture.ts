/**
 * Headless frame printer — `glyphling capture <sceneId> --fps N --duration S`
 *
 * Prints the expanded frames of a scene to stdout at the target fps, using
 * ANSI cursor-control to redraw in place. Exits cleanly after `duration` seconds.
 *
 * This module is designed to be captured by vhs (DEC-014):
 *   - Deterministic output: same inputs always produce the same frame sequence.
 *   - No React / Ink dependency in this path — stdout is driven by plain Node.
 *   - ANSI clear-and-home (`\x1b[H\x1b[2J`) between each frame for clean redraws.
 *
 * Exit codes:
 *   0 — completed normally
 *   1 — scene not found or invalid arguments
 *
 * @see DEC-005 (tier specs drive fps/duration)
 * @see DEC-014 (vhs integration)
 */

import type { SceneId } from "../../animations/types.js";
import { SCENES } from "../../animations/scenes/index.js";

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

/** Clear screen and move cursor to top-left. */
const ANSI_CLEAR = "\x1b[H\x1b[2J";
/** ANSI reset (SGR 0). */
const ANSI_RESET = "\x1b[0m";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CaptureOptions {
  /** Scene to capture. Must exist in SCENES registry. */
  sceneId: SceneId;
  /** Target frame rate in fps (used to compute inter-frame delay). */
  fps: number;
  /** Total capture duration in seconds. */
  durationSecs: number;
  /**
   * Output writer. Defaults to `process.stdout.write.bind(process.stdout)`.
   * Injected in tests to capture output without touching the TTY.
   */
  write?: (s: string) => void;
  /**
   * Optional stderr writer for error messages.
   * Defaults to `process.stderr.write.bind(process.stderr)`.
   */
  writeErr?: (s: string) => void;
}

export interface CaptureResult {
  /** Number of frames actually printed. */
  framesEmitted: number;
  /** Actual duration driven (ms). */
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Core printer
// ---------------------------------------------------------------------------

/**
 * Print frames of the given scene to `write` at `fps` for `durationSecs`.
 *
 * This is synchronous-safe to call; it uses `setInterval` internally and
 * returns a Promise that resolves when the capture is complete.
 *
 * @returns CaptureResult with frame count and elapsed time.
 * @throws if the scene does not exist.
 */
export function runCapture(options: CaptureOptions): Promise<CaptureResult> {
  const {
    sceneId,
    fps,
    durationSecs,
    write = process.stdout.write.bind(process.stdout),
    writeErr = process.stderr.write.bind(process.stderr),
  } = options;

  const scene = SCENES[sceneId];
  if (!scene) {
    writeErr(`[glyphling capture] scene "${sceneId}" not found.\n`);
    return Promise.reject(new Error(`Scene "${sceneId}" not found`));
  }

  if (fps <= 0 || !isFinite(fps)) {
    return Promise.reject(new Error(`fps must be a positive finite number, got: ${fps}`));
  }
  if (durationSecs <= 0 || !isFinite(durationSecs)) {
    return Promise.reject(new Error(`duration must be a positive finite number, got: ${durationSecs}`));
  }

  const frames = scene.frames;
  const totalFrames = frames.length;
  const intervalMs = Math.round(1000 / fps);
  const totalDurationMs = Math.round(durationSecs * 1000);

  return new Promise<CaptureResult>((resolve) => {
    const startMs = Date.now();
    let frameIndex = 0;
    let framesEmitted = 0;

    function emitFrame(idx: number): void {
      const frame = frames[idx % totalFrames];
      if (!frame) return;

      // Clear terminal + move to home
      write(ANSI_CLEAR);

      // Print each row of the expanded frame
      for (const row of frame.rows) {
        write(row + ANSI_RESET + "\n");
      }

      // Print effectRow and shadowRow if present
      if (frame.effectRow !== undefined) {
        write(frame.effectRow + ANSI_RESET + "\n");
      }
      if (frame.shadowRow !== undefined) {
        write(frame.shadowRow + ANSI_RESET + "\n");
      }

      framesEmitted++;
    }

    // Print the first frame immediately
    emitFrame(frameIndex++);

    const intervalId = setInterval(() => {
      const elapsedMs = Date.now() - startMs;

      if (elapsedMs >= totalDurationMs) {
        clearInterval(intervalId);
        resolve({ framesEmitted, elapsedMs });
        return;
      }

      emitFrame(frameIndex++);
    }, intervalMs);
  });
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Parse argv for the `capture` subcommand and run the printer.
 *
 * Expected argv (process.argv.slice(2) style, with "capture" already consumed):
 *   <sceneId> [--fps <n>] [--duration <s>]
 *
 * Returns exit code (0 = ok, 1 = error).
 */
export async function captureMain(argv: string[]): Promise<number> {
  const write = process.stderr.write.bind(process.stderr);

  // First positional = sceneId
  const sceneId = argv[0];
  if (!sceneId) {
    write("[glyphling capture] Usage: glyphling capture <sceneId> [--fps N] [--duration S]\n");
    return 1;
  }

  // Parse --fps and --duration flags
  let fps = 10;
  let durationSecs = 3;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fps" && argv[i + 1] !== undefined) {
      const parsed = Number(argv[i + 1]);
      if (isNaN(parsed) || parsed <= 0) {
        write(`[glyphling capture] --fps must be a positive number, got: ${argv[i + 1]}\n`);
        return 1;
      }
      fps = parsed;
      i++;
    } else if (arg === "--duration" && argv[i + 1] !== undefined) {
      const parsed = Number(argv[i + 1]);
      if (isNaN(parsed) || parsed <= 0) {
        write(`[glyphling capture] --duration must be a positive number, got: ${argv[i + 1]}\n`);
        return 1;
      }
      durationSecs = parsed;
      i++;
    }
  }

  // Validate scene ID
  if (!(sceneId in SCENES)) {
    const available = Object.keys(SCENES).join(", ");
    write(`[glyphling capture] unknown scene "${sceneId}". Available: ${available}\n`);
    return 1;
  }

  try {
    await runCapture({ sceneId: sceneId as SceneId, fps, durationSecs });
    return 0;
  } catch (err) {
    write(`[glyphling capture] error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
