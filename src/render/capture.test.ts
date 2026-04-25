/**
 * Tests for src/render/capture.ts
 *
 * Verifies:
 *   - runCapture emits approximately fps × duration frames
 *   - ANSI clear sequence (\x1b[H\x1b[2J) is present between frames
 *   - ANSI reset (\x1b[0m) is present after each row
 *   - Unknown scene returns an error (rejected promise)
 *   - captureMain parses --fps and --duration flags correctly
 *   - captureMain returns exit code 1 for unknown scene
 *   - captureMain returns exit code 0 on success
 */

import { describe, it, expect } from "vitest";
import { runCapture, captureMain } from "./capture.js";
import type { SceneId } from "../../animations/types.js";

// ---------------------------------------------------------------------------
// ANSI constants (mirrors capture.ts internals)
// ---------------------------------------------------------------------------

const ANSI_CLEAR = "\x1b[H\x1b[2J";
const ANSI_RESET = "\x1b[0m";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all written output into a string. */
function makeWriter(): { write: (s: string) => void; get: () => string } {
  let buf = "";
  return {
    write: (s: string) => {
      buf += s;
    },
    get: () => buf,
  };
}

// ---------------------------------------------------------------------------
// runCapture — frame count
// ---------------------------------------------------------------------------

describe("runCapture — frame count", () => {
  it("emits approximately fps × durationSecs frames for idle-baseline at 8fps/3s", async () => {
    const writer = makeWriter();
    const result = await runCapture({
      sceneId: "idle-baseline",
      fps: 8,
      durationSecs: 3,
      write: writer.write,
    });

    // Expected: 8 × 3 = 24 frames; allow ±3 for timing jitter
    // First frame emitted immediately; rest via setInterval
    expect(result.framesEmitted).toBeGreaterThanOrEqual(21);
    expect(result.framesEmitted).toBeLessThanOrEqual(27);
  });

  it("emits at least 1 frame even for very short durations", async () => {
    const writer = makeWriter();
    const result = await runCapture({
      sceneId: "idle-baseline",
      fps: 1,
      durationSecs: 0.1,
      write: writer.write,
    });
    // First frame is emitted immediately (before the interval fires)
    expect(result.framesEmitted).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// runCapture — ANSI sequences
// ---------------------------------------------------------------------------

describe("runCapture — ANSI sequences", () => {
  it("includes ANSI clear sequence in output", async () => {
    const writer = makeWriter();
    await runCapture({
      sceneId: "idle-baseline",
      fps: 8,
      durationSecs: 1,
      write: writer.write,
    });
    const output = writer.get();
    expect(output).toContain(ANSI_CLEAR);
  });

  it("includes ANSI reset sequence in output", async () => {
    const writer = makeWriter();
    await runCapture({
      sceneId: "idle-baseline",
      fps: 8,
      durationSecs: 1,
      write: writer.write,
    });
    const output = writer.get();
    expect(output).toContain(ANSI_RESET);
  });

  it("emits ANSI_CLEAR before every frame", async () => {
    const writer = makeWriter();
    const result = await runCapture({
      sceneId: "idle-baseline",
      fps: 4,
      durationSecs: 1,
      write: writer.write,
    });
    const output = writer.get();
    // Count occurrences of ANSI_CLEAR
    const clearCount = output.split(ANSI_CLEAR).length - 1;
    expect(clearCount).toBe(result.framesEmitted);
  });
});

// ---------------------------------------------------------------------------
// runCapture — error on unknown scene
// ---------------------------------------------------------------------------

describe("runCapture — unknown scene", () => {
  it("rejects with an error for an unknown sceneId", async () => {
    const writer = makeWriter();
    await expect(
      runCapture({
        sceneId: "not-a-real-scene" as unknown as SceneId,
        fps: 8,
        durationSecs: 1,
        write: writer.write,
      })
    ).rejects.toThrow(/not-a-real-scene/);
  });
});

// ---------------------------------------------------------------------------
// runCapture — invalid parameters
// ---------------------------------------------------------------------------

describe("runCapture — invalid parameters", () => {
  it("rejects with an error for fps <= 0", async () => {
    const writer = makeWriter();
    await expect(
      runCapture({ sceneId: "idle-baseline", fps: 0, durationSecs: 1, write: writer.write })
    ).rejects.toThrow(/fps/);
  });

  it("rejects with an error for durationSecs <= 0", async () => {
    const writer = makeWriter();
    await expect(
      runCapture({ sceneId: "idle-baseline", fps: 8, durationSecs: 0, write: writer.write })
    ).rejects.toThrow(/duration/);
  });
});

// ---------------------------------------------------------------------------
// captureMain — argument parsing
// ---------------------------------------------------------------------------

describe("captureMain — argument parsing", () => {
  it("returns exit code 1 when no sceneId is provided", async () => {
    const code = await captureMain([]);
    expect(code).toBe(1);
  });

  it("returns exit code 1 for an unknown sceneId", async () => {
    const code = await captureMain(["definitely-not-a-scene"]);
    expect(code).toBe(1);
  });

  it("returns exit code 0 for a valid scene with short duration", async () => {
    // Use a tiny duration to keep the test fast
    const code = await captureMain(["idle-baseline", "--fps", "8", "--duration", "0.2"]);
    expect(code).toBe(0);
  }, 3000);

  it("returns exit code 1 for invalid --fps value", async () => {
    const code = await captureMain(["idle-baseline", "--fps", "banana"]);
    expect(code).toBe(1);
  });

  it("returns exit code 1 for invalid --duration value", async () => {
    const code = await captureMain(["idle-baseline", "--duration", "-1"]);
    expect(code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// captureMain — acceptance criterion 6
//   "glyphling capture idle-baseline --fps 8 --duration 3" prints ~24 frames
// ---------------------------------------------------------------------------

describe("captureMain — acceptance criterion 6", () => {
  it("produces ~24 frames for idle-baseline --fps 8 --duration 3", async () => {
    // We can't easily intercept process.stdout from captureMain,
    // so we test runCapture directly with matching parameters.
    const writer = makeWriter();
    const result = await runCapture({
      sceneId: "idle-baseline",
      fps: 8,
      durationSecs: 3,
      write: writer.write,
    });

    // 8 fps × 3 s = 24 expected frames; allow ±3 for timing jitter
    expect(result.framesEmitted).toBeGreaterThanOrEqual(21);
    expect(result.framesEmitted).toBeLessThanOrEqual(27);
    // elapsed should be at least 2.8 s (allows for slow CI machines)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(2800);
  }, 6000); // 3s test with some margin
});

// ---------------------------------------------------------------------------
// Output content — frame rows are present
// ---------------------------------------------------------------------------

describe("runCapture — frame row content", () => {
  it("includes frame row text from the idle-baseline scene", async () => {
    const writer = makeWriter();
    await runCapture({
      sceneId: "idle-baseline",
      fps: 4,
      durationSecs: 0.5,
      write: writer.write,
    });
    const output = writer.get();
    // idle-baseline frame 1 first row — spot-check a known character
    expect(output).toContain("[o-o]");
  });
});
