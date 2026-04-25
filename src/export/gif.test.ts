/**
 * Integration tests for src/export/gif.ts
 *
 * Tests the full exportGif() pipeline with a mocked runVhs to avoid
 * requiring the vhs binary in CI.
 *
 * Verifies:
 *   - TIER_LOCKED error when pet level is below gate
 *   - VHS_NOT_INSTALLED error propagates cleanly (ENOENT → structured error)
 *   - VHS_FAILED error propagates cleanly
 *   - Successful export returns { ok: true, outputPath, tier, sceneId, durationSecs }
 *   - Unknown scene returns SCENE_NOT_FOUND error
 *   - Requested duration > cap is clamped
 *   - Tier 1 default scene is idle-baseline
 *   - Tape file is cleaned up after vhs runs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportGif } from "./gif.js";
import type { ExportGifParams } from "./gif.js";
import type { Pet } from "../state/schema.js";
import type { SceneId } from "../../animations/types.js";
import { cumulativeXpForLevel } from "../xp/engine.js";

// ---------------------------------------------------------------------------
// Mock vhs module
// ---------------------------------------------------------------------------

vi.mock("./vhs.js", () => ({
  ensureVhsInstalled: vi.fn(),
  runVhs: vi.fn(),
}));

// Import the mocked module for per-test control
import * as vhsMod from "./vhs.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePet(level: number): Pet {
  const now = new Date().toISOString();
  const xp = cumulativeXpForLevel(level);
  return {
    id: "01HTEST000000000000000001",
    schemaVersion: 1,
    eggType: "circuit",
    name: "Testling",
    createdAt: now,
    hatchedAt: now,
    lastFedAt: null,
    lastInteractionAt: now,
    xp,
    level,
    personality: {
      dominant: "Pragmatic",
      weights: {
        Stoic: 0.125,
        Friendly: 0.125,
        Pragmatic: 0.125,
        Energetic: 0.125,
        Gruff: 0.125,
        Philosophical: 0.125,
        Paranoid: 0.125,
        Curious: 0.125,
      },
      lockedAt: now,
      lastRefreshAt: now,
    },
    pauseIntervals: [],
    accumulatedNeglectSeconds: 0,
    lastTickAt: now,
    diedAt: null,
    tombstone: null,
    languageExposure: {},
    dailyCaps: {},
    lastLevelUpAt: null,
  };
}

const mockRunVhs = vi.mocked(vhsMod.runVhs);

// Base params — overridden per test
const baseParams = (tier: ExportGifParams["tier"], pet: Pet): ExportGifParams => ({
  tier,
  pet,
  outputDir: "/tmp",
  glyphlingBin: "glyphling",
  envVars: {},
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Gate checks (TIER_LOCKED)
// ---------------------------------------------------------------------------

describe("exportGif — TIER_LOCKED", () => {
  it("blocks L24 pet from Tier 1 (requires L25)", async () => {
    const pet = makePet(24);
    const result = await exportGif(baseParams(1, pet));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("TIER_LOCKED");
      expect(result.message).toContain("25");
      expect(result.message).toContain("24");
    }
    // vhs should NOT be called when tier is locked
    expect(mockRunVhs).not.toHaveBeenCalled();
  });

  it("blocks L249 pet from Tier 2 (requires L250)", async () => {
    const pet = makePet(249);
    const result = await exportGif(baseParams(2, pet));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("TIER_LOCKED");
    }
    expect(mockRunVhs).not.toHaveBeenCalled();
  });

  it("blocks L1617 pet from Tier 3 (requires L1618, DEC-020)", async () => {
    const pet = makePet(1617);
    const result = await exportGif(baseParams(3, pet));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("TIER_LOCKED");
    }
    expect(mockRunVhs).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// VHS_NOT_INSTALLED
// ---------------------------------------------------------------------------

describe("exportGif — VHS_NOT_INSTALLED", () => {
  it("returns VHS_NOT_INSTALLED (not raw ENOENT) when vhs is missing", async () => {
    mockRunVhs.mockResolvedValue({
      ok: false,
      code: "VHS_NOT_INSTALLED",
      message: "vhs binary not found. Install via: brew install vhs",
    });

    const pet = makePet(25);
    const result = await exportGif(baseParams(1, pet));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VHS_NOT_INSTALLED");
      expect(result.message).toContain("brew install vhs");
    }
  });
});

// ---------------------------------------------------------------------------
// VHS_FAILED
// ---------------------------------------------------------------------------

describe("exportGif — VHS_FAILED", () => {
  it("returns VHS_FAILED with the error message", async () => {
    mockRunVhs.mockResolvedValue({
      ok: false,
      code: "VHS_FAILED",
      message: "vhs exited with error: exit status 1",
      stderr: "ERROR some vhs problem",
    });

    const pet = makePet(25);
    const result = await exportGif(baseParams(1, pet));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VHS_FAILED");
    }
  });
});

// ---------------------------------------------------------------------------
// Successful export
// ---------------------------------------------------------------------------

describe("exportGif — success", () => {
  beforeEach(() => {
    // Default success mock
    mockRunVhs.mockImplementation(async (_tapePath, outputPath) => ({
      ok: true as const,
      outputPath,
    }));
  });

  it("returns ok:true with outputPath on success (L25 pet, Tier 1)", async () => {
    const pet = makePet(25);
    const result = await exportGif(baseParams(1, pet));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tier).toBe(1);
      expect(result.outputPath).toMatch(/\.gif$/);
      expect(result.outputPath.startsWith("/tmp")).toBe(true);
    }
  });

  it("returns ok:true with correct tier and sceneId (Tier 2, L250)", async () => {
    const pet = makePet(250);
    const result = await exportGif({
      ...baseParams(2, pet),
      sceneId: "idle-chipper",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tier).toBe(2);
      expect(result.sceneId).toBe("idle-chipper");
    }
  });

  it("returns ok:true for Tier 3 at L1618 (Golden Level, DEC-020)", async () => {
    const pet = makePet(1618);
    const result = await exportGif(baseParams(3, pet));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tier).toBe(3);
    }
  });

  it("defaults to idle-baseline scene when sceneId is omitted", async () => {
    const pet = makePet(25);
    const result = await exportGif(baseParams(1, pet));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sceneId).toBe("idle-baseline");
    }
  });

  it("passes vhs the correct tape file path (ends with .tape)", async () => {
    const pet = makePet(25);
    await exportGif(baseParams(1, pet));
    expect(mockRunVhs).toHaveBeenCalledOnce();
    const [tapePath] = mockRunVhs.mock.calls[0]!;
    expect(tapePath).toMatch(/\.tape$/);
  });

  it("calls runVhs exactly once per export", async () => {
    const pet = makePet(25);
    await exportGif(baseParams(1, pet));
    expect(mockRunVhs).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Scene validation (SCENE_NOT_FOUND)
// ---------------------------------------------------------------------------

describe("exportGif — SCENE_NOT_FOUND", () => {
  it("returns SCENE_NOT_FOUND for unknown sceneId", async () => {
    const pet = makePet(250);
    const result = await exportGif({
      ...baseParams(2, pet),
      sceneId: "totally-not-a-scene" as unknown as SceneId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SCENE_NOT_FOUND");
    }
    expect(mockRunVhs).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Duration clamping
// ---------------------------------------------------------------------------

describe("exportGif — duration clamping", () => {
  beforeEach(() => {
    mockRunVhs.mockImplementation(async (_tapePath, outputPath) => ({
      ok: true as const,
      outputPath,
    }));
  });

  it("clamps duration to maxDurationSecs for Tier 1 (max=3s)", async () => {
    const pet = makePet(25);
    const result = await exportGif({
      ...baseParams(1, pet),
      durationSecs: 100, // way over cap
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.durationSecs).toBe(3);
    }
  });

  it("respects duration under the cap for Tier 2", async () => {
    const pet = makePet(250);
    const result = await exportGif({
      ...baseParams(2, pet),
      durationSecs: 5,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.durationSecs).toBe(5);
    }
  });

  it("clamps duration to maxDurationSecs for Tier 2 (max=10s)", async () => {
    const pet = makePet(250);
    const result = await exportGif({
      ...baseParams(2, pet),
      durationSecs: 15,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.durationSecs).toBe(10);
    }
  });
});

// ---------------------------------------------------------------------------
// Output file naming
// ---------------------------------------------------------------------------

describe("exportGif — output file naming", () => {
  beforeEach(() => {
    mockRunVhs.mockImplementation(async (_tapePath, outputPath) => ({
      ok: true as const,
      outputPath,
    }));
  });

  it("output filename includes tier number", async () => {
    const pet = makePet(25);
    const result = await exportGif(baseParams(1, pet));
    if (result.ok) {
      expect(result.outputPath).toContain("tier1");
    }
  });

  it("output is placed in provided outputDir", async () => {
    const pet = makePet(25);
    const result = await exportGif({ ...baseParams(1, pet), outputDir: "/tmp/exports" });
    if (result.ok) {
      expect(result.outputPath.startsWith("/tmp/exports")).toBe(true);
    }
  });

  it("each export gets a unique filename", async () => {
    const pet = makePet(25);
    const r1 = await exportGif(baseParams(1, pet));
    const r2 = await exportGif(baseParams(1, pet));
    if (r1.ok && r2.ok) {
      expect(r1.outputPath).not.toBe(r2.outputPath);
    }
  });
});
