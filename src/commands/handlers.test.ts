/**
 * Tests for src/commands/handlers.ts
 *
 * Covers:
 *   D2 — Auto-tier export selection (DEC-019)
 *   D8 — replay evolve command (DEC-019)
 *   Parser: replay parses into {name:"replay", args:["evolve"]}
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "os";
import path from "path";
import type { Pet, StateFileV1 } from "../state/schema.js";
import { cumulativeXpForLevel } from "../xp/engine.js";
import {
  exportCommand,
  replayCommand,
  autoPickTier,
  type CommandContext,
} from "./handlers.js";
import { parseInput } from "./repl.js";

// ---------------------------------------------------------------------------
// Mock persistence and gif modules
// ---------------------------------------------------------------------------

vi.mock("../state/persistence.js", () => ({
  readState: vi.fn(),
  appendEvent: vi.fn(),
  writeState: vi.fn(),
}));

vi.mock("../export/gif.js", () => ({
  exportGif: vi.fn(),
  TIER_SPECS: {
    1: { requiredLevel: 25, width: 320, height: 240, fps: 8, maxDurationSecs: 3, watermark: true, userScenePick: false, goldenBorder: false },
    2: { requiredLevel: 250, width: 640, height: 480, fps: 15, maxDurationSecs: 10, watermark: false, userScenePick: true, goldenBorder: false },
    3: { requiredLevel: 1618, width: 1280, height: 720, fps: 30, maxDurationSecs: 30, watermark: false, userScenePick: true, goldenBorder: true },
  },
  gateForTier: vi.fn(),
  requiredLevelForTier: vi.fn(),
}));

import * as persistenceMod from "../state/persistence.js";
import * as gifMod from "../export/gif.js";

const mockReadState = vi.mocked(persistenceMod.readState);
const mockExportGif = vi.mocked(gifMod.exportGif);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_STATE_HOME = path.join(os.tmpdir(), "glyphling-handlers-test");

const TEST_CONFIG: CommandContext["config"] = {
  stateHome: TEST_STATE_HOME,
  paths: {
    stateFile: path.join(TEST_STATE_HOME, "state.json"),
    lockFile: path.join(TEST_STATE_HOME, "state.json.lock"),
    eventsLog: path.join(TEST_STATE_HOME, "events.jsonl"),
    graveyardDir: path.join(TEST_STATE_HOME, "graveyard"),
    ipcSocket: path.join(TEST_STATE_HOME, "glyphling.sock"),
  },
};

function makePet(level: number, overrides: Partial<Pet> = {}): Pet {
  const now = new Date().toISOString();
  const xp = cumulativeXpForLevel(level);
  return {
    id: "test-pet-001",
    schemaVersion: 1,
    eggType: "circuit",
    name: "Testling",
    createdAt: now,
    hatchedAt: now,
    lastFedAt: now,
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
    ...overrides,
  };
}

function makeState(pet: Pet): StateFileV1 {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    pets: [pet],
    globals: {
      activePetId: pet.id,
      unlocks: { gifTier1: false, gifTier2: false, gifTier3: false, adoption: false },
      eventsCursor: 0,
      eventsHead: "",
      lastEventAt: 0,
    },
  };
}

const CTX: CommandContext = { config: TEST_CONFIG };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default exportGif to success
  mockExportGif.mockResolvedValue({
    ok: true,
    outputPath: "/tmp/glyphling-tier1-test.gif",
    tier: 1,
    sceneId: "idle-baseline",
    durationSecs: 3,
  });
});

// ---------------------------------------------------------------------------
// D2 — autoPickTier unit tests
// ---------------------------------------------------------------------------

describe("autoPickTier (D2)", () => {
  it("L1618 pet → Tier 3 (Golden Level, DEC-020)", () => {
    const pet = makePet(1618);
    expect(autoPickTier(pet)).toBe(3);
  });

  it("L300 pet → Tier 2", () => {
    const pet = makePet(300);
    expect(autoPickTier(pet)).toBe(2);
  });

  it("L50 pet → Tier 1", () => {
    const pet = makePet(50);
    expect(autoPickTier(pet)).toBe(1);
  });

  it("L10 pet → null (ineligible)", () => {
    const pet = makePet(10);
    expect(autoPickTier(pet)).toBeNull();
  });

  it("exactly L25 → Tier 1 (boundary)", () => {
    const pet = makePet(25);
    expect(autoPickTier(pet)).toBe(1);
  });

  it("exactly L250 → Tier 2 (boundary)", () => {
    const pet = makePet(250);
    expect(autoPickTier(pet)).toBe(2);
  });

  it("L249 → Tier 1 (just below T2 gate)", () => {
    const pet = makePet(249);
    expect(autoPickTier(pet)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// D2 — exportCommand integration: auto-pick path
// ---------------------------------------------------------------------------

describe("exportCommand — auto-tier selection (D2)", () => {
  it("L1618 pet + no arg → picks Tier 3 (Golden Level, DEC-020)", async () => {
    const pet = makePet(1618);
    mockReadState.mockResolvedValue(makeState(pet));
    mockExportGif.mockResolvedValue({
      ok: true,
      outputPath: "/tmp/glyphling-tier3-test.gif",
      tier: 3,
      sceneId: "idle-baseline",
      durationSecs: 30,
    });

    const result = await exportCommand([], CTX);
    expect(result.ok).toBe(true);
    // Verify exportGif was called with tier 3
    expect(mockExportGif).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 3 })
    );
  });

  it("L300 pet + no arg → picks Tier 2", async () => {
    const pet = makePet(300);
    mockReadState.mockResolvedValue(makeState(pet));
    mockExportGif.mockResolvedValue({
      ok: true,
      outputPath: "/tmp/glyphling-tier2-test.gif",
      tier: 2,
      sceneId: "idle-baseline",
      durationSecs: 10,
    });

    const result = await exportCommand([], CTX);
    expect(result.ok).toBe(true);
    expect(mockExportGif).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 2 })
    );
  });

  it("L50 pet + no arg → picks Tier 1", async () => {
    const pet = makePet(50);
    mockReadState.mockResolvedValue(makeState(pet));

    const result = await exportCommand([], CTX);
    expect(result.ok).toBe(true);
    expect(mockExportGif).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 1 })
    );
  });

  it("L10 pet + no arg → returns error (need L25+)", async () => {
    const pet = makePet(10);
    mockReadState.mockResolvedValue(makeState(pet));

    const result = await exportCommand([], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/L25\+/);
    }
    expect(mockExportGif).not.toHaveBeenCalled();
  });

  it("L300 pet + explicit 'export 1' → exports Tier 1 (does not force T2)", async () => {
    const pet = makePet(300);
    mockReadState.mockResolvedValue(makeState(pet));

    const result = await exportCommand(["1"], CTX);
    expect(result.ok).toBe(true);
    expect(mockExportGif).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 1 })
    );
  });

  it("no state found → error", async () => {
    mockReadState.mockResolvedValue(null);

    const result = await exportCommand([], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no state found");
    }
  });
});

// ---------------------------------------------------------------------------
// D8 — replayCommand
// ---------------------------------------------------------------------------

describe("replayCommand (D8)", () => {
  it("replay evolve on a live pet → ok:true + sceneId evolve-shimmer", async () => {
    const pet = makePet(5);
    mockReadState.mockResolvedValue(makeState(pet));

    const result = await replayCommand(["evolve"], CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("evolve-shimmer");
      // sceneId is returned in the extended result type
      expect((result as { sceneId?: string }).sceneId).toBe("evolve-shimmer");
    }
  });

  it("replay evolve works at any life stage (adult pet)", async () => {
    const pet = makePet(100); // adult stage
    mockReadState.mockResolvedValue(makeState(pet));

    const result = await replayCommand(["evolve"], CTX);
    expect(result.ok).toBe(true);
  });

  it("replay evolve with no active pet → ok:false", async () => {
    const now = new Date().toISOString();
    const emptyState: StateFileV1 = {
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      pets: [],
      globals: {
        activePetId: null,
        unlocks: { gifTier1: false, gifTier2: false, gifTier3: false, adoption: false },
        eventsCursor: 0,
        eventsHead: "",
        lastEventAt: 0,
      },
    };
    mockReadState.mockResolvedValue(emptyState);

    const result = await replayCommand(["evolve"], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no active pet");
    }
  });

  it("replay evolve with no state → ok:false", async () => {
    mockReadState.mockResolvedValue(null);

    const result = await replayCommand(["evolve"], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no state found");
    }
  });

  it("replay <unknown> → ok:false with 'unknown replay target' message", async () => {
    const result = await replayCommand(["dance"], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("unknown replay target");
      expect(result.error).toContain("dance");
    }
  });

  it("replay with no subcommand → ok:false", async () => {
    const result = await replayCommand([], CTX);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parser: replay parses correctly
// ---------------------------------------------------------------------------

describe("parseInput — replay command parsing (D8)", () => {
  it("'replay evolve' parses into {name:'replay', args:['evolve']}", () => {
    const parsed = parseInput("replay evolve");
    expect(parsed.name).toBe("replay");
    expect(parsed.args).toEqual(["evolve"]);
  });

  it("'replay' alone parses into {name:'replay', args:[]}", () => {
    const parsed = parseInput("replay");
    expect(parsed.name).toBe("replay");
    expect(parsed.args).toEqual([]);
  });

  it("'replay unknown-target' parses into {name:'replay', args:['unknown-target']}", () => {
    const parsed = parseInput("replay unknown-target");
    expect(parsed.name).toBe("replay");
    expect(parsed.args).toEqual(["unknown-target"]);
  });
});
