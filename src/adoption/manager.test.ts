/**
 * Tests for src/adoption/manager.ts — AdoptionManager (TODO-010)
 *
 * Acceptance-criteria tests (from TODOS.md + DEC-006 + DEC-011):
 *
 *  Gate (canAdopt):
 *    1. Returns reason when primary is dead (before unlock earned)
 *    2. Returns reason when primary level < 73
 *    3. Returns reason when primary unpaused-age < 7 days (wall-clock)
 *    4. DEC-011 pause-aware: hatchedAt = now - 10d, 5d pause → age = 5d → deny
 *    5. Returns reason when 4 pets already exist (cap)
 *    6. Passes once all conditions met; state tagged with adoption=true after first pass
 *    7. Once unlock earned, skip level + age checks on subsequent calls
 *
 *  Adopt (adopt):
 *    8. Returns a pet with schema-valid defaults: level 1, xp 0, fresh personality
 *    9. Rejects unknown eggType at runtime
 *   10. Emits pet.adopted event with the new pet id
 *   11. Concurrent-adoption safety: two adopt() calls against same stateBefore
 *       produce distinct pet ids (ulid uniqueness — serialisation at store layer)
 *
 *  Integration (via tmpdir-backed state):
 *   12. adoptCommand happy-path end-to-end: gate → roll → persist → re-read → 2 pets
 */

import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, afterEach } from "vitest";
import {
  canAdopt,
  adopt,
  computeUnpausedAge,
  findPrimary,
  ADOPTION_LEVEL_GATE,
  ADOPTION_AGE_SECONDS,
  PET_CAP,
} from "./manager.js";
import { adoptCommand } from "../commands/handlers.js";
import {
  makeEmptyState,
  type StateFileV1,
  type Pet,
  type EggType,
  type PauseInterval,
} from "../state/schema.js";
import { writeState, readState } from "../state/persistence.js";
import { buildConfig } from "../config/env.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_NOW_MS = new Date("2026-04-17T12:00:00.000Z").getTime();

/** Build a minimal but schema-valid Pet for test fixtures. */
function makePet(overrides: Partial<Pet> = {}): Pet {
  const now = new Date(BASE_NOW_MS).toISOString();
  return {
    id: `pet-${Math.random().toString(36).slice(2)}`,
    schemaVersion: 1 as const,
    eggType: "circuit",
    name: null,
    createdAt: now,
    hatchedAt: now,
    lastFedAt: null,
    lastInteractionAt: now,
    xp: 0,
    level: 1,
    personality: {
      dominant: "Pragmatic",
      weights: {
        Stoic: 0.15,
        Friendly: 0.10,
        Pragmatic: 0.20,
        Energetic: 0.10,
        Gruff: 0.10,
        Philosophical: 0.10,
        Paranoid: 0.15,
        Curious: 0.10,
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
    ...overrides,
  };
}

/** Build a state with a single primary pet that passes all gate conditions. */
function makeGateworthyState(nowMs: number = BASE_NOW_MS): StateFileV1 {
  const hatchedAt = new Date(nowMs - 8 * 86_400 * 1000).toISOString(); // 8 days ago
  const primary = makePet({
    hatchedAt,
    createdAt: hatchedAt,
    level: ADOPTION_LEVEL_GATE, // exactly 73
    pauseIntervals: [],
  });
  const state = makeEmptyState();
  return {
    ...state,
    pets: [primary],
    globals: {
      ...state.globals,
      activePetId: primary.id,
    },
  };
}

// ---------------------------------------------------------------------------
// Temp dirs for integration tests
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

async function makeTmpConfig() {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "glyphling-adopt-test-")
  );
  tmpDirs.push(dir);
  return buildConfig(dir);
}

// ---------------------------------------------------------------------------
// canAdopt — gate tests
// ---------------------------------------------------------------------------

describe("canAdopt", () => {
  it("1. returns reason when primary is dead (before unlock earned)", () => {
    const state = makeGateworthyState();
    const deadPrimary = makePet({
      ...findPrimary(state)!,
      level: 73,
      diedAt: new Date(BASE_NOW_MS - 1000).toISOString(),
      tombstone: {
        diedAt: new Date(BASE_NOW_MS - 1000).toISOString(),
        cause: "neglect",
        finalLevel: 73,
        finalXp: 0,
      },
    });
    const deadState: StateFileV1 = { ...state, pets: [deadPrimary] };

    const result = canAdopt(deadState, BASE_NOW_MS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("primary pet has died");
    }
  });

  it("2. returns reason when primary level < 73", () => {
    const state = makeGateworthyState();
    const lowLevelPet = makePet({
      ...findPrimary(state)!,
      level: 72,
    });
    const lowState: StateFileV1 = { ...state, pets: [lowLevelPet] };

    const result = canAdopt(lowState, BASE_NOW_MS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("level 72");
      expect(result.reason).toContain("adoption unlocks at 73");
    }
  });

  it("3. returns reason when primary unpaused-age < 7 days (wall-clock, no pauses)", () => {
    // hatchedAt = now - 3 days
    const hatchedAt = new Date(BASE_NOW_MS - 3 * 86_400 * 1000).toISOString();
    const youngPet = makePet({ hatchedAt, createdAt: hatchedAt, level: 73 });
    const state: StateFileV1 = {
      ...makeEmptyState(),
      pets: [youngPet],
      globals: {
        ...makeEmptyState().globals,
        activePetId: youngPet.id,
      },
    };

    const result = canAdopt(state, BASE_NOW_MS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("7d required");
      expect(result.reason).toContain("(unpaused)");
    }
  });

  it("4. DEC-011 pause-aware: 10d wall-clock with 5d pause → unpaused-age = 5d → deny", () => {
    // hatchedAt = now - 10 days; one closed 5-day pause
    const hatchedMs = BASE_NOW_MS - 10 * 86_400 * 1000;
    const hatchedAt = new Date(hatchedMs).toISOString();
    const pauseStart = new Date(hatchedMs + 86_400 * 1000).toISOString(); // 1d after hatch
    const pauseEnd = new Date(hatchedMs + 6 * 86_400 * 1000).toISOString(); // 6d after hatch = 5d pause
    const pauseIntervals: PauseInterval[] = [
      { pausedAt: pauseStart, resumedAt: pauseEnd },
    ];

    const pet = makePet({ hatchedAt, createdAt: hatchedAt, level: 73, pauseIntervals });
    const state: StateFileV1 = {
      ...makeEmptyState(),
      pets: [pet],
      globals: { ...makeEmptyState().globals, activePetId: pet.id },
    };

    // Verify unpaused age is ~5 days
    const unpausedSecs = computeUnpausedAge(pet, BASE_NOW_MS);
    expect(unpausedSecs).toBeCloseTo(5 * 86_400, -1); // within 10 seconds

    const result = canAdopt(state, BASE_NOW_MS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("7d required");
    }
  });

  it("5. returns reason when 4 pets already exist (cap)", () => {
    const state = makeGateworthyState();
    // Already unlock-earned to keep this test focused on the cap
    const capState: StateFileV1 = {
      ...state,
      pets: [
        makePet(),
        makePet(),
        makePet(),
        makePet(), // 4 pets = at cap
      ],
      globals: { ...state.globals, unlocks: { ...state.globals.unlocks, adoption: true } },
    };

    const result = canAdopt(capState, BASE_NOW_MS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("pet cap reached (4)");
    }
  });

  it("6. passes once all conditions met; returns state tagged with adoption=true", () => {
    const state = makeGateworthyState(BASE_NOW_MS);

    const result = canAdopt(state, BASE_NOW_MS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stateWithUnlock.globals.unlocks.adoption).toBe(true);
    }
  });

  it("7. once unlock earned, skips level + age checks on subsequent adoptions", () => {
    const state = makeGateworthyState();
    // Already unlocked
    const unlockedState: StateFileV1 = {
      ...state,
      // Add a second pet so pets.length is 1 (primary) + 1 (adopted) = 2
      pets: [makePet({ level: 1 }), makePet({ level: 1 })], // low level is fine
      globals: { ...state.globals, unlocks: { ...state.globals.unlocks, adoption: true } },
    };

    const result = canAdopt(unlockedState, BASE_NOW_MS);

    expect(result.ok).toBe(true);
  });

  it("7b. once unlock earned, also OK if primary is now dead", () => {
    const state = makeGateworthyState();
    const deadPrimary = makePet({
      level: 73,
      diedAt: new Date(BASE_NOW_MS - 1000).toISOString(),
      tombstone: {
        diedAt: new Date(BASE_NOW_MS - 1000).toISOString(),
        cause: "neglect",
        finalLevel: 73,
        finalXp: 0,
      },
    });
    const unlockedDeadState: StateFileV1 = {
      ...state,
      pets: [deadPrimary],
      globals: { ...state.globals, unlocks: { ...state.globals.unlocks, adoption: true } },
    };

    const result = canAdopt(unlockedDeadState, BASE_NOW_MS);

    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeUnpausedAge
// ---------------------------------------------------------------------------

describe("computeUnpausedAge", () => {
  it("returns 0 for un-hatched pet", () => {
    const pet = makePet({ hatchedAt: null });
    expect(computeUnpausedAge(pet, BASE_NOW_MS)).toBe(0);
  });

  it("returns full wall-clock age when no pauses", () => {
    const hatchedMs = BASE_NOW_MS - 7 * 86_400 * 1000;
    const pet = makePet({ hatchedAt: new Date(hatchedMs).toISOString() });
    const age = computeUnpausedAge(pet, BASE_NOW_MS);
    expect(age).toBeCloseTo(7 * 86_400, 0);
  });

  it("subtracts closed pause intervals", () => {
    const hatchedMs = BASE_NOW_MS - 10 * 86_400 * 1000;
    const hatchedAt = new Date(hatchedMs).toISOString();
    const pauseStart = new Date(hatchedMs + 86_400 * 1000).toISOString();
    const pauseEnd = new Date(hatchedMs + 4 * 86_400 * 1000).toISOString();
    const pet = makePet({
      hatchedAt,
      pauseIntervals: [{ pausedAt: pauseStart, resumedAt: pauseEnd }],
    });
    // 10d total - 3d pause = 7d
    const age = computeUnpausedAge(pet, BASE_NOW_MS);
    expect(age).toBeCloseTo(7 * 86_400, 0);
  });

  it("subtracts ongoing (open) pause intervals", () => {
    const hatchedMs = BASE_NOW_MS - 10 * 86_400 * 1000;
    const hatchedAt = new Date(hatchedMs).toISOString();
    const pauseStart = new Date(BASE_NOW_MS - 5 * 86_400 * 1000).toISOString(); // 5d ago
    const pet = makePet({
      hatchedAt,
      pauseIntervals: [{ pausedAt: pauseStart, resumedAt: null }],
    });
    // 10d total - 5d open pause = 5d
    const age = computeUnpausedAge(pet, BASE_NOW_MS);
    expect(age).toBeCloseTo(5 * 86_400, 0);
  });
});

// ---------------------------------------------------------------------------
// adopt — unit tests
// ---------------------------------------------------------------------------

describe("adopt", () => {
  it("8. returns a pet with schema-valid defaults: level 1, xp 0, fresh personality", () => {
    const state = makeGateworthyState();
    const unlockedState: StateFileV1 = {
      ...state,
      globals: { ...state.globals, unlocks: { ...state.globals.unlocks, adoption: true } },
    };

    const result = adopt(unlockedState, { eggType: "rune", nowMs: BASE_NOW_MS });

    expect(result.pet.level).toBe(1);
    expect(result.pet.xp).toBe(0);
    expect(result.pet.eggType).toBe("rune");
    expect(result.pet.hatchedAt).not.toBeNull();
    expect(result.pet.diedAt).toBeNull();
    expect(result.pet.tombstone).toBeNull();
    expect(result.pet.pauseIntervals).toHaveLength(0);
    expect(result.pet.accumulatedNeglectSeconds).toBe(0);
    expect(result.pet.languageExposure).toEqual({});
    expect(result.pet.schemaVersion).toBe(1);

    // Personality should have a dominant trait and weights summing to 1
    const { personality } = result.pet;
    expect(personality.dominant).toBeTruthy();
    const weightSum = Object.values(personality.weights).reduce(
      (a, b) => a + b,
      0
    );
    expect(Math.abs(weightSum - 1.0)).toBeLessThan(1e-6);
    expect(personality.dominant).toBe(
      // argmax check
      (Object.entries(personality.weights) as [string, number][]).reduce(
        (best, [t, w]) => (w > best[1] ? [t, w] : best),
        ["", -Infinity]
      )[0]
    );
  });

  it("9. rejects unknown eggType at runtime", () => {
    const state = makeGateworthyState();
    const unlockedState: StateFileV1 = {
      ...state,
      globals: { ...state.globals, unlocks: { ...state.globals.unlocks, adoption: true } },
    };

    expect(() =>
      adopt(unlockedState, {
        eggType: "crystal" as EggType,
        nowMs: BASE_NOW_MS,
      })
    ).toThrow(/invalid eggType/i);
  });

  it("10. emits pet.adopted event with the new pet id", () => {
    const state = makeGateworthyState();
    const unlockedState: StateFileV1 = {
      ...state,
      globals: { ...state.globals, unlocks: { ...state.globals.unlocks, adoption: true } },
    };

    const result = adopt(unlockedState, { eggType: "bloom", nowMs: BASE_NOW_MS });

    const adoptedEvent = result.events.find((e) => e.type === "pet.adopted");
    expect(adoptedEvent).toBeDefined();
    expect(adoptedEvent?.petId).toBe(result.pet.id);
    expect((adoptedEvent?.payload as { eggType: string })?.eggType).toBe("bloom");
  });

  it("10b. emits unlock.adoption event only on first adoption", () => {
    const state = makeGateworthyState();

    // First adoption (unlock not yet earned)
    const firstResult = adopt(state, { eggType: "circuit", nowMs: BASE_NOW_MS });
    const unlockEvent = firstResult.events.find((e) => e.type === "unlock.adoption");
    expect(unlockEvent).toBeDefined();

    // Second adoption (unlock already in state)
    const secondResult = adopt(firstResult.state, {
      eggType: "rune",
      nowMs: BASE_NOW_MS,
    });
    const secondUnlockEvent = secondResult.events.find(
      (e) => e.type === "unlock.adoption"
    );
    expect(secondUnlockEvent).toBeUndefined();
  });

  it("11. concurrent adoption safety: two adopt() calls against same stateBefore produce distinct pet ids", () => {
    const state = makeGateworthyState();
    const unlockedState: StateFileV1 = {
      ...state,
      globals: { ...state.globals, unlocks: { ...state.globals.unlocks, adoption: true } },
    };

    // Two parallel calls against the SAME stateBefore
    const result1 = adopt(unlockedState, {
      eggType: "circuit",
      nowMs: BASE_NOW_MS,
    });
    const result2 = adopt(unlockedState, {
      eggType: "bloom",
      nowMs: BASE_NOW_MS + 1, // tiny delta to ensure different ULID timestamps
    });

    // Pet IDs must be distinct (ULID uniqueness)
    expect(result1.pet.id).not.toBe(result2.pet.id);

    // NOTE: Both calls operate on the SAME stateBefore. In production the actual
    // serialisation happens under withLock() at the store layer — the second
    // caller would re-read state and discover the first pet already written.
    // These results represent divergent futures; only one should actually be
    // persisted. This test verifies ulid uniqueness only, not conflict resolution.
  });
});

// ---------------------------------------------------------------------------
// Integration: adoptCommand happy-path end-to-end
// ---------------------------------------------------------------------------

describe("adoptCommand integration", () => {
  it("12. adopt circuit happy-path: gate check → roll → persist → re-read → 2 pets", async () => {
    const config = await makeTmpConfig();

    // Build initial state: one primary pet that passes all gate conditions
    const hatchedAt = new Date(BASE_NOW_MS - 8 * 86_400 * 1000).toISOString();
    const primary = makePet({ hatchedAt, createdAt: hatchedAt, level: 73 });
    const initialState: StateFileV1 = {
      ...makeEmptyState(),
      pets: [primary],
      globals: {
        ...makeEmptyState().globals,
        activePetId: primary.id,
        unlocks: {
          gifTier1: false,
          gifTier2: false,
          gifTier3: false,
          adoption: false,
        },
      },
    };

    await writeState(config, initialState);

    // Run adoptCommand
    const result = await adoptCommand(["circuit"], { config });

    expect(result.ok).toBe(true);
    if (result.ok && result.message) {
      expect(result.message).toContain("adopted");
      expect(result.message).toContain("circuit");
    }

    // Re-read persisted state and verify 2 pets
    const finalState = await readState(config);
    expect(finalState).not.toBeNull();
    expect(finalState!.pets).toHaveLength(2);

    // Second pet should be the newly adopted one
    const adoptedPet = finalState!.pets.find((p) => p.id !== primary.id);
    expect(adoptedPet).toBeDefined();
    expect(adoptedPet!.eggType).toBe("circuit");
    expect(adoptedPet!.level).toBe(1);
    expect(adoptedPet!.xp).toBe(0);

    // adoption unlock should be set
    expect(finalState!.globals.unlocks.adoption).toBe(true);
  });

  it("13. adoptCommand rejects when primary level too low", async () => {
    const config = await makeTmpConfig();

    const hatchedAt = new Date(BASE_NOW_MS - 8 * 86_400 * 1000).toISOString();
    const primary = makePet({ hatchedAt, createdAt: hatchedAt, level: 10 }); // too low
    const initialState: StateFileV1 = {
      ...makeEmptyState(),
      pets: [primary],
      globals: { ...makeEmptyState().globals, activePetId: primary.id },
    };
    await writeState(config, initialState);

    const result = await adoptCommand(["rune"], { config });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("level 10");
    }
  });

  it("14. adoptCommand rejects unknown egg type", async () => {
    const config = await makeTmpConfig();

    const state = makeEmptyState();
    await writeState(config, state);

    const result = await adoptCommand(["crystal"], { config });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("crystal");
    }
  });
});
