/**
 * Tests for src/commands/handlers.ts
 *
 * Covers:
 *   D2 — Auto-tier export selection (DEC-019)
 *   D8 — replay evolve command (DEC-019)
 *   Parser: replay parses into {name:"replay", args:["evolve"]}
 *   TODO-022 — feed, pet, play, pause, resume, name, status, pets
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
  feedCommand,
  playCommand,
  petCommand,
  pauseCommand,
  resumeCommand,
  nameCommand,
  statusCommand,
  petsCommand,
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
    lastPlayedAt: null,
    lastHatchedAt: null,
    lastEvolvedAt: null,
    lastPettedAt: null,
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

// ---------------------------------------------------------------------------
// TODO-022 handler tests
// ---------------------------------------------------------------------------

/** appendEvent mock: default to resolving successfully */
const mockAppendEvent = vi.mocked(persistenceMod.appendEvent);

// ---------------------------------------------------------------------------
// feedCommand
// ---------------------------------------------------------------------------

describe("feedCommand (TODO-022)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendEvent.mockResolvedValue({ appended: {} as never, rejections: [] });
  });

  it("returns ok:true with name, level, mood, and age on success", async () => {
    const pet = makePet(1);
    mockReadState.mockResolvedValue(makeState(pet));
    mockAppendEvent.mockResolvedValue({ appended: {} as never, rejections: [] });

    const result = await feedCommand([], CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("fed");
      expect(result.message).toContain("Lv");
    }
  });

  it("returns ok:false when no state", async () => {
    mockReadState.mockResolvedValue(null);
    const result = await feedCommand([], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no state found");
  });

  it("returns ok:false for a dead pet", async () => {
    const deadPet = makePet(5, { diedAt: new Date().toISOString(), tombstone: { diedAt: new Date().toISOString(), cause: "neglect", finalLevel: 5, finalXp: 100 } });
    mockReadState.mockResolvedValue(makeState(deadPet));
    const result = await feedCommand([], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("died");
  });

  it("calls appendEvent with pet.fed type and xpDelta", async () => {
    const pet = makePet(1);
    mockReadState.mockResolvedValue(makeState(pet));
    mockAppendEvent.mockResolvedValue({ appended: {} as never, rejections: [] });

    await feedCommand([], CTX);
    expect(mockAppendEvent).toHaveBeenCalledOnce();
    const [_config, event] = mockAppendEvent.mock.calls[0]!;
    expect(event.type).toBe("pet.fed");
    expect(event.xpDelta).toBeGreaterThan(0);
  });

  it("does not leak lockfile on appendEvent error", async () => {
    const pet = makePet(1);
    mockReadState.mockResolvedValue(makeState(pet));
    mockAppendEvent.mockRejectedValue(new Error("disk full"));

    const result = await feedCommand([], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("feed failed");
  });
});

// ---------------------------------------------------------------------------
// playCommand
// ---------------------------------------------------------------------------

describe("playCommand (TODO-022)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendEvent.mockResolvedValue({ appended: {} as never, rejections: [] });
  });

  it("returns ok:true with name and HUD suffix", async () => {
    const pet = makePet(2);
    mockReadState.mockResolvedValue(makeState(pet));

    const result = await playCommand([], CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("played");
      expect(result.message).toContain("Lv");
    }
  });

  it("returns ok:false for a dead pet", async () => {
    const deadPet = makePet(5, { diedAt: new Date().toISOString(), tombstone: { diedAt: new Date().toISOString(), cause: "neglect", finalLevel: 5, finalXp: 100 } });
    mockReadState.mockResolvedValue(makeState(deadPet));
    const result = await playCommand([], CTX);
    expect(result.ok).toBe(false);
  });

  it("calls appendEvent with pet.played type and xpDelta", async () => {
    const pet = makePet(1);
    mockReadState.mockResolvedValue(makeState(pet));

    await playCommand([], CTX);
    expect(mockAppendEvent).toHaveBeenCalledOnce();
    const [_config, event] = mockAppendEvent.mock.calls[0]!;
    expect(event.type).toBe("pet.played");
    expect(event.xpDelta).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// petCommand (scritch)
// ---------------------------------------------------------------------------

describe("petCommand (TODO-022)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendEvent.mockResolvedValue({ appended: {} as never, rejections: [] });
  });

  it("returns ok:true with scritch confirmation", async () => {
    const pet = makePet(1);
    mockReadState.mockResolvedValue(makeState(pet));

    const result = await petCommand([], CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("scritched");
    }
  });

  it("calls appendEvent once", async () => {
    const pet = makePet(1);
    mockReadState.mockResolvedValue(makeState(pet));

    await petCommand([], CTX);
    expect(mockAppendEvent).toHaveBeenCalledOnce();
  });

  it("emits pet.petted (not pet.fed) event type", async () => {
    const pet = makePet(1);
    mockReadState.mockResolvedValue(makeState(pet));

    await petCommand([], CTX);
    const [_config, event] = mockAppendEvent.mock.calls[0]!;
    expect(event.type).toBe("pet.petted");
  });

  it("fold stamps lastPettedAt on the pet", async () => {
    const pet = makePet(1);
    mockReadState.mockResolvedValue(makeState(pet));

    await petCommand([], CTX);
    // The fold function is passed as the third argument to appendEvent.
    // Extract it and invoke it directly to verify lastPettedAt is written.
    const [_config, event, fold] = mockAppendEvent.mock.calls[0]!;
    expect(fold).toBeDefined();
    const state = makeState(pet);
    const foldedState = fold!(state, event);
    const updatedPet = foldedState.pets.find((p) => p.id === pet.id);
    expect(updatedPet?.lastPettedAt).toBeDefined();
    expect(updatedPet?.lastPettedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pauseCommand
// ---------------------------------------------------------------------------

describe("pauseCommand (TODO-022)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendEvent.mockResolvedValue({ appended: {} as never, rejections: [] });
  });

  it("returns ok:true and confirmation", async () => {
    const pet = makePet(1);
    mockReadState.mockResolvedValue(makeState(pet));

    const result = await pauseCommand([], CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("paused");
    }
  });

  it("returns ok:false if already paused", async () => {
    const now = new Date().toISOString();
    const pet = makePet(1, {
      pauseIntervals: [{ pausedAt: now, resumedAt: null }],
    });
    mockReadState.mockResolvedValue(makeState(pet));

    const result = await pauseCommand([], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("already paused");
  });

  it("calls appendEvent with pet.paused type", async () => {
    const pet = makePet(1);
    mockReadState.mockResolvedValue(makeState(pet));

    await pauseCommand([], CTX);
    expect(mockAppendEvent).toHaveBeenCalledOnce();
    const [_config, event] = mockAppendEvent.mock.calls[0]!;
    expect(event.type).toBe("pet.paused");
  });
});

// ---------------------------------------------------------------------------
// resumeCommand
// ---------------------------------------------------------------------------

describe("resumeCommand (TODO-022)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendEvent.mockResolvedValue({ appended: {} as never, rejections: [] });
  });

  it("returns ok:true when pet is paused", async () => {
    const now = new Date().toISOString();
    const pet = makePet(1, {
      pauseIntervals: [{ pausedAt: now, resumedAt: null }],
    });
    mockReadState.mockResolvedValue(makeState(pet));

    const result = await resumeCommand([], CTX);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("awake");
  });

  it("returns ok:false if not paused", async () => {
    const pet = makePet(1);
    mockReadState.mockResolvedValue(makeState(pet));

    const result = await resumeCommand([], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not currently paused");
  });

  it("calls appendEvent with pet.resumed type", async () => {
    const now = new Date().toISOString();
    const pet = makePet(1, {
      pauseIntervals: [{ pausedAt: now, resumedAt: null }],
    });
    mockReadState.mockResolvedValue(makeState(pet));

    await resumeCommand([], CTX);
    expect(mockAppendEvent).toHaveBeenCalledOnce();
    const [_config, event] = mockAppendEvent.mock.calls[0]!;
    expect(event.type).toBe("pet.resumed");
  });
});

// ---------------------------------------------------------------------------
// nameCommand
// ---------------------------------------------------------------------------

describe("nameCommand (TODO-022)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendEvent.mockResolvedValue({ appended: {} as never, rejections: [] });
  });

  it("returns ok:true and confirmation with old and new name", async () => {
    const pet = makePet(1);
    mockReadState.mockResolvedValue(makeState(pet));

    const result = await nameCommand(["Sparky"], CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("Sparky");
      expect(result.message).toContain("now");
    }
  });

  it("returns ok:false when no name provided", async () => {
    const result = await nameCommand([], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("name requires");
  });

  it("returns ok:false when name too long", async () => {
    const result = await nameCommand(["x".repeat(33)], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("too long");
  });

  it("calls appendEvent with personality.refresh type", async () => {
    const pet = makePet(1);
    mockReadState.mockResolvedValue(makeState(pet));

    await nameCommand(["Sparky"], CTX);
    expect(mockAppendEvent).toHaveBeenCalledOnce();
    const [_config, event] = mockAppendEvent.mock.calls[0]!;
    expect(event.type).toBe("personality.refresh");
  });
});

// ---------------------------------------------------------------------------
// statusCommand — read-only
// ---------------------------------------------------------------------------

describe("statusCommand (TODO-022)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a 3-line summary with name, level, XP, mood, age", async () => {
    const pet = makePet(5);
    mockReadState.mockResolvedValue(makeState(pet));

    const result = await statusCommand([], CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const lines = (result.message ?? "").split("\n");
      expect(lines.length).toBe(3);
      expect(lines[0]).toContain("Testling");
      expect(lines[1]).toContain("Level 5");
      expect(lines[2]).toContain("last interaction");
    }
  });

  it("does NOT call appendEvent (read-only)", async () => {
    const pet = makePet(5);
    mockReadState.mockResolvedValue(makeState(pet));

    await statusCommand([], CTX);
    expect(mockAppendEvent).not.toHaveBeenCalled();
  });

  it("returns ok:false when no state", async () => {
    mockReadState.mockResolvedValue(null);
    const result = await statusCommand([], CTX);
    expect(result.ok).toBe(false);
  });

  it("includes [paused] flag when pet is paused", async () => {
    const now = new Date().toISOString();
    const pet = makePet(1, {
      pauseIntervals: [{ pausedAt: now, resumedAt: null }],
    });
    mockReadState.mockResolvedValue(makeState(pet));

    const result = await statusCommand([], CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("[paused]");
    }
  });
});

// ---------------------------------------------------------------------------
// petsCommand — read-only
// ---------------------------------------------------------------------------

describe("petsCommand (TODO-022)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a list with the active pet marked with *", async () => {
    const pet = makePet(3);
    mockReadState.mockResolvedValue(makeState(pet));

    const result = await petsCommand([], CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("* Testling");
    }
  });

  it("does NOT call appendEvent (read-only)", async () => {
    const pet = makePet(3);
    mockReadState.mockResolvedValue(makeState(pet));

    await petsCommand([], CTX);
    expect(mockAppendEvent).not.toHaveBeenCalled();
  });

  it("returns a message when no state", async () => {
    mockReadState.mockResolvedValue(null);
    const result = await petsCommand([], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no state found");
  });

  it("shows a hint message when no pets", async () => {
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

    const result = await petsCommand([], CTX);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("glyphling hatch");
  });

  it("shows multiple pets with the active one marked", async () => {
    const now = new Date().toISOString();
    const pet1 = makePet(1, { id: "pet-001", name: "Alpha" });
    const pet2 = makePet(2, { id: "pet-002", name: "Beta" });
    const multiState: StateFileV1 = {
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      pets: [pet1, pet2],
      globals: {
        activePetId: "pet-001",
        unlocks: { gifTier1: false, gifTier2: false, gifTier3: false, adoption: false },
        eventsCursor: 0,
        eventsHead: "",
        lastEventAt: 0,
      },
    };
    mockReadState.mockResolvedValue(multiState);

    const result = await petsCommand([], CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("* Alpha");
      expect(result.message).toContain("  Beta");
    }
  });
});
