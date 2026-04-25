/**
 * Integration tests for src/state/migration.ts — DEC-020 Option A
 *
 * Verifies:
 *   - Bramble fixture: xp=6000 stored at level=17 (old curve) → level=31 after
 *     migration (new golden curve), with exactly one pet.regrade event appended.
 *   - Idempotency: running migration twice produces no second regrade event.
 *   - No-op: pet already at the correct level produces no regrade event and no
 *     state write.
 *   - Multi-pet: only affected pets receive a regrade event.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { buildConfig } from "../config/env.js";
import { applyDec020Migration } from "./migration.js";
import { writeState, readState, appendEvent } from "./persistence.js";
import { levelFromCumXp, cumulativeXpForLevel } from "../xp/engine.js";
import type { StateFileV1, Pet } from "./schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBasePet(id: string, xp: number, storedLevel: number): Pet {
  const now = new Date().toISOString();
  return {
    id,
    schemaVersion: 1,
    eggType: "rune",
    name: null,
    createdAt: now,
    hatchedAt: now,
    lastFedAt: null,
    lastInteractionAt: now,
    xp,
    level: storedLevel,
    personality: {
      dominant: "Pragmatic",
      weights: {
        Stoic: 0.1,
        Friendly: 0.1,
        Pragmatic: 0.3,
        Energetic: 0.1,
        Gruff: 0.1,
        Philosophical: 0.1,
        Paranoid: 0.1,
        Curious: 0.1,
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
  };
}

function makeState(pets: Pet[]): StateFileV1 {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    pets,
    globals: {
      activePetId: pets[0]?.id ?? null,
      unlocks: {
        gifTier1: false,
        gifTier2: false,
        gifTier3: false,
        adoption: false,
      },
      eventsCursor: 0,
      eventsHead: "",
      lastEventAt: 0,
    },
  };
}

/**
 * Read all events from events.jsonl and return them as parsed objects.
 * Returns [] if the file does not exist.
 */
async function readAllEvents(eventsLog: string): Promise<unknown[]> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(eventsLog, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "migration-test-"));
  await fs.promises.mkdir(tmpDir, { recursive: true, mode: 0o700 });
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Bramble fixture — the canonical DEC-020 migration sanity check
// ---------------------------------------------------------------------------

describe("DEC-020 migration — Bramble fixture (xp=6000, storedLevel=17)", () => {
  it("recomputes Bramble's level to 31 under the golden curve", () => {
    // Confirm the formula at test-design time: levelFromCumXp(6000) must be 31.
    expect(levelFromCumXp(6000)).toBe(31);
  });

  it("migrates Bramble from level=17 to level=31 and returns correct RegradeResult", async () => {
    const config = buildConfig(tmpDir);

    // Bramble: stored with xp=6000 and the OLD level=17 (pre-DEC-020 curve).
    const bramble = makeBasePet("bramble-001", 6000, 17);
    const state = makeState([bramble]);
    await writeState(config, state);

    const result = await applyDec020Migration(config, state);

    // 1. Exactly one pet was regraded.
    expect(result.regraded.size).toBe(1);

    // 2. Bramble is in the regraded map with the correct from/to.
    const entry = result.regraded.get("bramble-001");
    expect(entry).toBeDefined();
    expect(entry!.fromLevel).toBe(17);
    expect(entry!.toLevel).toBe(31);

    // 3. The returned state has level=31 stored.
    const updatedPet = result.state.pets.find((p) => p.id === "bramble-001");
    expect(updatedPet).toBeDefined();
    expect(updatedPet!.level).toBe(31);

    // 4. The state file on disk has level=31.
    const onDisk = await readState(config);
    expect(onDisk).not.toBeNull();
    const onDiskPet = onDisk!.pets.find((p) => p.id === "bramble-001");
    expect(onDiskPet!.level).toBe(31);
  });

  it("appends exactly one pet.regrade event for Bramble", async () => {
    const config = buildConfig(tmpDir);

    const bramble = makeBasePet("bramble-001", 6000, 17);
    const state = makeState([bramble]);
    await writeState(config, state);

    await applyDec020Migration(config, state);

    const events = await readAllEvents(config.paths.eventsLog);
    const regradeEvents = events.filter(
      (e) => (e as Record<string, unknown>)["type"] === "pet.regrade"
    );

    // Exactly one pet.regrade event.
    expect(regradeEvents).toHaveLength(1);

    // Event payload must record the level change.
    const ev = regradeEvents[0] as Record<string, unknown>;
    expect(ev["petId"]).toBe("bramble-001");
    const payload = ev["payload"] as Record<string, unknown>;
    expect(payload["fromLevel"]).toBe(17);
    expect(payload["toLevel"]).toBe(31);
    expect(payload["fromCurve"]).toBe("DEC-004");
    expect(payload["toCurve"]).toBe("DEC-020");
  });
});

// ---------------------------------------------------------------------------
// Idempotency — running migration twice must not produce a second event
// ---------------------------------------------------------------------------

describe("DEC-020 migration — idempotency", () => {
  it("second run on already-migrated state produces no new regrade event", async () => {
    const config = buildConfig(tmpDir);

    // Pet already at the correct level for its XP under the new curve.
    const xp = 6000;
    const correctLevel = levelFromCumXp(xp); // 31
    const pet = makeBasePet("idempotent-001", xp, correctLevel);
    const state = makeState([pet]);
    await writeState(config, state);

    // First run on already-correct state.
    const result1 = await applyDec020Migration(config, state);
    expect(result1.regraded.size).toBe(0);

    // Second run.
    const stateAfter1 = await readState(config);
    const result2 = await applyDec020Migration(config, stateAfter1!);
    expect(result2.regraded.size).toBe(0);

    // No events appended at all.
    const events = await readAllEvents(config.paths.eventsLog);
    const regradeEvents = events.filter(
      (e) => (e as Record<string, unknown>)["type"] === "pet.regrade"
    );
    expect(regradeEvents).toHaveLength(0);
  });

  it("second run after migrating Bramble produces no new regrade event", async () => {
    const config = buildConfig(tmpDir);

    const bramble = makeBasePet("bramble-idempotent", 6000, 17);
    const state = makeState([bramble]);
    await writeState(config, state);

    // First migration — should produce 1 regrade event.
    await applyDec020Migration(config, state);

    // Second migration — state is now correct; should produce 0 more regrade events.
    const stateAfter1 = await readState(config);
    expect(stateAfter1).not.toBeNull();
    await applyDec020Migration(config, stateAfter1!);

    const events = await readAllEvents(config.paths.eventsLog);
    const regradeEvents = events.filter(
      (e) => (e as Record<string, unknown>)["type"] === "pet.regrade"
    );
    expect(regradeEvents).toHaveLength(1); // still exactly 1, not 2
  });
});

// ---------------------------------------------------------------------------
// No-op — pet already at correct level
// ---------------------------------------------------------------------------

describe("DEC-020 migration — no-op for up-to-date pet", () => {
  it("returns empty regraded map when stored level matches derived level", async () => {
    const config = buildConfig(tmpDir);

    // Construct a pet whose stored level matches the new curve exactly.
    const level = 50;
    const xp = cumulativeXpForLevel(level);
    const pet = makeBasePet("noop-001", xp, level);
    const state = makeState([pet]);
    await writeState(config, state);

    const result = await applyDec020Migration(config, state);
    expect(result.regraded.size).toBe(0);
    expect(result.state.pets[0]!.level).toBe(level);

    // No events written.
    const events = await readAllEvents(config.paths.eventsLog);
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-pet — only affected pets get a regrade event
// ---------------------------------------------------------------------------

describe("DEC-020 migration — multi-pet", () => {
  it("recomputes only the stale pet when two pets are present", async () => {
    const config = buildConfig(tmpDir);

    // Pet A: xp=6000, storedLevel=17 (stale — should become 31).
    const petA = makeBasePet("multi-A", 6000, 17);

    // Pet B: xp for level 50, storedLevel=50 (already correct — no regrade).
    const xpB = cumulativeXpForLevel(50);
    const petB = makeBasePet("multi-B", xpB, 50);

    const state = makeState([petA, petB]);
    await writeState(config, state);

    const result = await applyDec020Migration(config, state);

    // Only pet A was regraded.
    expect(result.regraded.size).toBe(1);
    expect(result.regraded.has("multi-A")).toBe(true);
    expect(result.regraded.has("multi-B")).toBe(false);

    // Pet A on disk is now 31; Pet B stays 50.
    const onDisk = await readState(config);
    const onDiskA = onDisk!.pets.find((p) => p.id === "multi-A");
    const onDiskB = onDisk!.pets.find((p) => p.id === "multi-B");
    expect(onDiskA!.level).toBe(31);
    expect(onDiskB!.level).toBe(50);

    // Exactly one regrade event (for pet A only).
    const events = await readAllEvents(config.paths.eventsLog);
    const regradeEvents = events.filter(
      (e) => (e as Record<string, unknown>)["type"] === "pet.regrade"
    );
    expect(regradeEvents).toHaveLength(1);
    expect(
      (regradeEvents[0] as Record<string, unknown>)["petId"]
    ).toBe("multi-A");
  });

  it("recomputes both pets when both are stale", async () => {
    const config = buildConfig(tmpDir);

    const petA = makeBasePet("both-A", 6000, 17);  // → 31
    const petB = makeBasePet("both-B", 1000, 5);   // → whatever levelFromCumXp(1000) is

    const expectedLevelB = levelFromCumXp(1000);
    // Ensure petB is actually stale (different from 5).
    expect(expectedLevelB).not.toBe(5);

    const state = makeState([petA, petB]);
    await writeState(config, state);

    const result = await applyDec020Migration(config, state);

    expect(result.regraded.size).toBe(2);
    expect(result.regraded.get("both-A")!.toLevel).toBe(31);
    expect(result.regraded.get("both-B")!.toLevel).toBe(expectedLevelB);

    // Exactly two regrade events.
    const events = await readAllEvents(config.paths.eventsLog);
    const regradeEvents = events.filter(
      (e) => (e as Record<string, unknown>)["type"] === "pet.regrade"
    );
    expect(regradeEvents).toHaveLength(2);
  });
});
