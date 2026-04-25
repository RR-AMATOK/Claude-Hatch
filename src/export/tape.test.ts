/**
 * Unit tests for src/export/tape.ts
 *
 * Verifies:
 *   - Tape contains correct Set Width/Height/Framerate for each tier
 *   - Sleep duration does not exceed tier max + 0.5s margin
 *   - Tier 1 includes watermark comment; Tier 2 does not
 *   - Tier 3 includes golden border comment
 *   - Output path is in the tape
 *   - Capture command includes sceneId, fps, duration
 */

import { describe, it, expect } from "vitest";
import { generateTape } from "./tape.js";
import { TIER_SPECS } from "./tiers.js";
import type { GifTier } from "./tiers.js";
import type { SceneId } from "../../animations/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTape(tier: GifTier, options: { durationSecs?: number; sceneId?: string } = {}): string {
  const spec = TIER_SPECS[tier];
  const durationSecs = options.durationSecs ?? spec.maxDurationSecs;
  const sceneId = (options.sceneId ?? "idle-baseline") as SceneId;

  return generateTape({
    tier,
    spec,
    sceneId,
    durationSecs,
    outputPath: `/tmp/glyphling-test-${tier}.gif`,
    glyphlingBin: "glyphling",
  });
}

// ---------------------------------------------------------------------------
// Output directive
// ---------------------------------------------------------------------------

describe("generateTape — Output directive", () => {
  it("includes Output line with outputPath", () => {
    const tape = makeTape(1);
    expect(tape).toContain('Output "/tmp/glyphling-test-1.gif"');
  });

  it("uses exact provided outputPath", () => {
    const spec = TIER_SPECS[1];
    const tape = generateTape({
      tier: 1,
      spec,
      sceneId: "idle-baseline",
      durationSecs: 3,
      outputPath: "/tmp/my-pet.gif",
    });
    expect(tape).toContain('Output "/tmp/my-pet.gif"');
  });
});

// ---------------------------------------------------------------------------
// Terminal setup
// ---------------------------------------------------------------------------

describe("generateTape — Set Width/Height/Framerate", () => {
  it.each([
    [1 as GifTier, 320, 240, 8],
    [2 as GifTier, 640, 480, 15],
    [3 as GifTier, 1280, 720, 30],
  ])("Tier %i has correct dimensions and fps", (tier, width, height, fps) => {
    const tape = makeTape(tier);
    expect(tape).toContain(`Set Width ${width}`);
    expect(tape).toContain(`Set Height ${height}`);
    expect(tape).toContain(`Set Framerate ${fps}`);
  });
});

// ---------------------------------------------------------------------------
// Sleep duration (acceptance criterion 4)
// ---------------------------------------------------------------------------

describe("generateTape — Sleep directive", () => {
  it("Tier 1 Sleep is ≤ maxDurationSecs + 0.5", () => {
    const spec = TIER_SPECS[1];
    const tape = makeTape(1, { durationSecs: spec.maxDurationSecs });
    // Sleep should be durationSecs + 0.5 margin
    const expectedSleep = (spec.maxDurationSecs + 0.5).toFixed(1);
    expect(tape).toContain(`Sleep ${expectedSleep}s`);
  });

  it("Tier 2 Sleep is ≤ maxDurationSecs + 0.5", () => {
    const spec = TIER_SPECS[2];
    const tape = makeTape(2, { durationSecs: spec.maxDurationSecs });
    const expectedSleep = (spec.maxDurationSecs + 0.5).toFixed(1);
    expect(tape).toContain(`Sleep ${expectedSleep}s`);
  });

  it("Tier 3 Sleep is ≤ maxDurationSecs + 0.5", () => {
    const spec = TIER_SPECS[3];
    const tape = makeTape(3, { durationSecs: spec.maxDurationSecs });
    const expectedSleep = (spec.maxDurationSecs + 0.5).toFixed(1);
    expect(tape).toContain(`Sleep ${expectedSleep}s`);
  });

  it("Sleep uses the provided durationSecs (shorter than max)", () => {
    const tape = makeTape(2, { durationSecs: 5 });
    // 5 + 0.5 = 5.5
    expect(tape).toContain("Sleep 5.5s");
    // Should NOT contain the max (10.5)
    expect(tape).not.toContain("Sleep 10.5s");
  });
});

// ---------------------------------------------------------------------------
// Watermark / golden border (acceptance criterion 5)
// ---------------------------------------------------------------------------

describe("generateTape — decoration markers", () => {
  it("Tier 1 includes watermark comment", () => {
    const tape = makeTape(1);
    expect(tape).toContain("# GLYPHLING_WATERMARK=1");
  });

  it("Tier 2 does NOT include watermark comment", () => {
    const tape = makeTape(2);
    expect(tape).not.toContain("# GLYPHLING_WATERMARK=1");
  });

  it("Tier 3 does NOT include watermark comment", () => {
    const tape = makeTape(3);
    expect(tape).not.toContain("# GLYPHLING_WATERMARK=1");
  });

  it("Tier 3 includes golden border comment", () => {
    const tape = makeTape(3);
    expect(tape).toContain("# GLYPHLING_GOLDEN_BORDER=1");
  });

  it("Tier 3 includes GLYPHLING_TIER=3 comment", () => {
    const tape = makeTape(3);
    expect(tape).toContain("# GLYPHLING_TIER=3");
  });

  it("Tier 1 does NOT include golden border comment", () => {
    const tape = makeTape(1);
    expect(tape).not.toContain("# GLYPHLING_GOLDEN_BORDER=1");
  });

  it("Tier 2 does NOT include golden border comment", () => {
    const tape = makeTape(2);
    expect(tape).not.toContain("# GLYPHLING_GOLDEN_BORDER=1");
  });
});

// ---------------------------------------------------------------------------
// Capture command in Type directive
// ---------------------------------------------------------------------------

describe("generateTape — capture command", () => {
  it("includes the sceneId in the Type command", () => {
    const tape = makeTape(1, { sceneId: "idle-baseline" });
    expect(tape).toContain("idle-baseline");
  });

  it("includes --fps in the capture command", () => {
    const tape = makeTape(2, { sceneId: "play-bounce" });
    expect(tape).toContain("--fps 15");
  });

  it("includes --duration in the capture command", () => {
    const tape = makeTape(2, { durationSecs: 7 });
    expect(tape).toContain("--duration 7");
  });

  it("includes the glyphling binary name", () => {
    const spec = TIER_SPECS[1];
    const tape = generateTape({
      tier: 1,
      spec,
      sceneId: "idle-baseline",
      durationSecs: 3,
      outputPath: "/tmp/out.gif",
      glyphlingBin: "glyphling",
    });
    expect(tape).toContain("glyphling capture");
  });

  it("uses alternative glyphlingBin if provided", () => {
    const spec = TIER_SPECS[1];
    const tape = generateTape({
      tier: 1,
      spec,
      sceneId: "idle-baseline",
      durationSecs: 3,
      outputPath: "/tmp/out.gif",
      glyphlingBin: "tsx src/cli.tsx",
    });
    expect(tape).toContain("tsx src/cli.tsx");
  });

  it("includes capture subcommand", () => {
    const tape = makeTape(1);
    expect(tape).toContain("capture");
    expect(tape).toContain("Enter");
  });
});

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------

describe("generateTape — envVars", () => {
  it("prepends GLYPHLING_HOME env var if provided", () => {
    const spec = TIER_SPECS[1];
    const tape = generateTape({
      tier: 1,
      spec,
      sceneId: "idle-baseline",
      durationSecs: 3,
      outputPath: "/tmp/out.gif",
      envVars: { GLYPHLING_HOME: "/tmp/test-state" },
    });
    expect(tape).toContain("GLYPHLING_HOME");
    expect(tape).toContain("/tmp/test-state");
  });

  it("produces no env prefix when envVars is empty", () => {
    const spec = TIER_SPECS[1];
    const tape = generateTape({
      tier: 1,
      spec,
      sceneId: "idle-baseline",
      durationSecs: 3,
      outputPath: "/tmp/out.gif",
      envVars: {},
    });
    // No KEY= prefix before the command
    expect(tape).not.toMatch(/[A-Z_]+=.+glyphling capture/);
  });
});

// ---------------------------------------------------------------------------
// Tape is a valid string
// ---------------------------------------------------------------------------

describe("generateTape — output format", () => {
  it("returns a non-empty string ending with newline", () => {
    const tape = makeTape(1);
    expect(typeof tape).toBe("string");
    expect(tape.length).toBeGreaterThan(0);
    expect(tape.endsWith("\n")).toBe(true);
  });

  it("all three tiers produce distinct tape content", () => {
    const t1 = makeTape(1);
    const t2 = makeTape(2);
    const t3 = makeTape(3);
    expect(t1).not.toBe(t2);
    expect(t2).not.toBe(t3);
    expect(t1).not.toBe(t3);
  });
});
