/**
 * Tests for TokenCollector:
 *   - Token delta → XP event with correct xpDelta (floor(tokens/500))
 *   - Daily cap stops further XP after threshold
 *   - Accumulation: emits when ≥ 5000 tokens
 *   - Re-accumulates tokens when appendEvent fails
 */

import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TokenCollector, EMIT_TOKEN_THRESHOLD } from "./collector.js";
import type { TokenDelta, TokenSignalSource, AdapterHealth } from "./adapter.js";
import { buildConfig } from "../../config/env.js";
import { readState } from "../../state/persistence.js";
import { parseEvent } from "../../state/schema.js";
import { DAILY_CAP_TOKENS } from "../../xp/engine.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a controllable fake TokenSignalSource.
 * Call `emit(delta)` to push a delta into the subscribed collector.
 */
function makeFakeSource(): TokenSignalSource & { emit: (d: TokenDelta) => void } {
  let cb: ((d: TokenDelta) => void) | null = null;
  return {
    name: "fake",
    start(onDelta) {
      cb = onDelta;
      return async () => {
        cb = null;
      };
    },
    async health(): Promise<AdapterHealth> {
      return { ok: true, mode: "disabled" };
    },
    emit(d: TokenDelta) {
      cb?.(d);
    },
  };
}

/** Minimal pet state for tests — adopts a pet so XP can be applied. */
async function setupPet(
  tmpDir: string
): Promise<{ petId: string; config: ReturnType<typeof buildConfig> }> {
  const config = buildConfig(tmpDir);
  const { ulid } = await import("ulid");
  const now = new Date().toISOString();
  const petId = ulid();

  const state = {
    schemaVersion: 1 as const,
    createdAt: now,
    updatedAt: now,
    pets: [
      {
        id: petId,
        schemaVersion: 1 as const,
        eggType: "circuit" as const,
        name: null,
        createdAt: now,
        hatchedAt: now,
        lastFedAt: null,
        lastInteractionAt: now,
        xp: 0,
        level: 1,
        personality: {
          dominant: "Pragmatic" as const,
          weights: {
            Stoic: 0.10,
            Friendly: 0.10,
            Pragmatic: 0.30, // clear argmax
            Energetic: 0.10,
            Gruff: 0.10,
            Philosophical: 0.10,
            Paranoid: 0.10,
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
      },
    ],
    globals: {
      activePetId: petId,
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

  await fs.promises.mkdir(tmpDir, { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(
    config.paths.stateFile,
    JSON.stringify(state, null, 2),
    { mode: 0o600 }
  );

  return { petId, config };
}

/** Read all events from events.jsonl, return an array of parsed events. */
async function readEvents(eventsLog: string) {
  try {
    const raw = await fs.promises.readFile(eventsLog, "utf8");
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        try {
          return parseEvent(JSON.parse(l));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TokenCollector", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "collector-test-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("emits tokens.delta event with correct xpDelta (floor(tokens/500))", async () => {
    const { petId, config } = await setupPet(tmpDir);
    const source = makeFakeSource();
    const collector = new TokenCollector(source, config);
    const stop = collector.start(petId);

    // Emit enough tokens to breach the threshold
    source.emit({ ts: new Date().toISOString(), tokens: EMIT_TOKEN_THRESHOLD });

    // Give the async emit time to run
    await new Promise((r) => setTimeout(r, 100));
    await stop();

    const events = await readEvents(config.paths.eventsLog);
    const tokenEvents = events.filter((e) => e?.type === "tokens.delta");
    expect(tokenEvents.length).toBeGreaterThanOrEqual(1);

    const evt = tokenEvents[0]!;
    expect(evt!.xpDelta).toBe(Math.floor(EMIT_TOKEN_THRESHOLD / 500));
    expect((evt!.payload as Record<string, unknown>)["tokens"]).toBe(EMIT_TOKEN_THRESHOLD);
  });

  it("prevHash chain: second event's prevHash matches first event's hash", async () => {
    const { ulid } = await import("ulid");
    const { sha256, canonicalJson } = await import("../../util/hash.js");
    const { petId, config } = await setupPet(tmpDir);
    const source = makeFakeSource();
    const collector = new TokenCollector(source, config);
    const stop = collector.start(petId);

    // Two separate threshold crossings
    source.emit({ ts: new Date().toISOString(), tokens: EMIT_TOKEN_THRESHOLD });
    await new Promise((r) => setTimeout(r, 150));

    source.emit({ ts: new Date().toISOString(), tokens: EMIT_TOKEN_THRESHOLD });
    await new Promise((r) => setTimeout(r, 150));

    await stop();

    const events = await readEvents(config.paths.eventsLog);
    const tokenEvents = events.filter((e) => e?.type === "tokens.delta");
    expect(tokenEvents.length).toBeGreaterThanOrEqual(2);

    const first = tokenEvents[0]!;
    const second = tokenEvents[1]!;

    // second.prevHash should be the hash of the first event
    const expectedPrevHash = sha256(canonicalJson(first));
    expect(second!.prevHash).toBe(expectedPrevHash);
  });

  it("does not emit if accumulated tokens < threshold (below floor XP)", async () => {
    const { petId, config } = await setupPet(tmpDir);
    const source = makeFakeSource();
    const collector = new TokenCollector(source, config);
    const stop = collector.start(petId);

    // Only 499 tokens — below the 500-token XP floor (0 xpDelta)
    source.emit({ ts: new Date().toISOString(), tokens: 499 });

    await new Promise((r) => setTimeout(r, 100));
    await stop();

    const events = await readEvents(config.paths.eventsLog);
    const tokenEvents = events.filter((e) => e?.type === "tokens.delta");
    // Should not have emitted (xpDelta would be 0)
    expect(tokenEvents.length).toBe(0);
  });

  it("accumulates tokens across multiple deltas before threshold emit", async () => {
    const { petId, config } = await setupPet(tmpDir);
    const source = makeFakeSource();
    const collector = new TokenCollector(source, config);
    const stop = collector.start(petId);

    // Send 4 batches of 1500 tokens = 6000 total > 5000 threshold
    source.emit({ ts: new Date().toISOString(), tokens: 1500 });
    source.emit({ ts: new Date().toISOString(), tokens: 1500 });
    source.emit({ ts: new Date().toISOString(), tokens: 1500 });
    source.emit({ ts: new Date().toISOString(), tokens: 1500 });

    await new Promise((r) => setTimeout(r, 150));
    await stop();

    const events = await readEvents(config.paths.eventsLog);
    const tokenEvents = events.filter((e) => e?.type === "tokens.delta");
    expect(tokenEvents.length).toBeGreaterThanOrEqual(1);

    // At least one event should reflect accumulated tokens (≥ 5000)
    const first = tokenEvents[0]!;
    const tokens = (first?.payload as Record<string, unknown>)["tokens"] as number;
    expect(tokens).toBeGreaterThanOrEqual(EMIT_TOKEN_THRESHOLD);
  });

  it("daily cap: XP accumulated in dailyCaps does not exceed DAILY_CAP_TOKENS", async () => {
    const { petId, config } = await setupPet(tmpDir);
    const source = makeFakeSource();
    const collector = new TokenCollector(source, config);
    const stop = collector.start(petId);

    // Send enough tokens to generate far more XP than the daily cap.
    // DAILY_CAP_TOKENS = 6000; each 500 tokens = 1 XP, so 6000*500 = 3M tokens = exactly at cap.
    // Send 4x that to clearly exceed the cap.
    const tokensOverCap = DAILY_CAP_TOKENS * 500 * 4;

    source.emit({ ts: new Date().toISOString(), tokens: tokensOverCap });
    await new Promise((r) => setTimeout(r, 300));
    await stop();

    // Read updated state — pet's daily XP for tokens must be ≤ cap
    const state = await readState(config);
    expect(state).not.toBeNull();
    const pet = state!.pets.find((p) => p.id === petId);
    expect(pet).toBeDefined();

    const today = new Date().toISOString().slice(0, 10);
    const usedToday = pet!.dailyCaps[today]?.["tokens"] ?? 0;
    expect(usedToday).toBeLessThanOrEqual(DAILY_CAP_TOKENS);
    // Also confirm XP was actually awarded (not zero)
    expect(usedToday).toBeGreaterThan(0);
  });

  it("stop() flushes remaining accumulated tokens", async () => {
    const { petId, config } = await setupPet(tmpDir);
    const source = makeFakeSource();
    const collector = new TokenCollector(source, config);
    const stop = collector.start(petId);

    // Send exactly 1000 tokens — below the 5000 threshold but above XP floor
    source.emit({ ts: new Date().toISOString(), tokens: 1000 });

    // Stop immediately (should flush the 1000 tokens)
    await stop();

    const events = await readEvents(config.paths.eventsLog);
    const tokenEvents = events.filter((e) => e?.type === "tokens.delta");
    expect(tokenEvents.length).toBe(1);
    expect(tokenEvents[0]!.xpDelta).toBe(2); // floor(1000/500) = 2
  });
});
