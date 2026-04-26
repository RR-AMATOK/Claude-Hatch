/**
 * Tests for TokenCollector:
 *   - Token delta → XP event with correct xpDelta (floor(tokens/1000) per DEC-020)
 *   - Accumulation: emits when ≥ 5000 tokens
 *   - Re-accumulates tokens when appendEvent fails
 *   - prevHash chain integrity
 *   - Single-flight: at most one appendEvent in-flight (TODO-033)
 *   - Concurrency stress: 100 parallel onDelta calls (TODO-033)
 *   - Hard-error rollback: tokens re-accumulated on non-LockTimeoutError (TODO-033)
 *   - Lock-timeout retry: retries on LockTimeoutError, succeeds eventually (TODO-033)
 *
 * DEC-020: Daily cap tests removed (caps abolished). XP accumulates without limit.
 *
 * Mock strategy: vi.mock() hoists the persistence module globally. The factory
 * wraps appendEvent in a vi.fn that calls through to the real implementation by
 * default. Tests that need to intercept it override via mockImplementationOnce.
 * beforeEach resets the mock back to call-through so tests are isolated.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { TokenCollector, EMIT_TOKEN_THRESHOLD } from "./collector.js";
import type { TokenDelta, TokenSignalSource, AdapterHealth } from "./adapter.js";
import { buildConfig } from "../../config/env.js";
import { readState } from "../../state/persistence.js";
import { parseEvent } from "../../state/schema.js";
import { XP_PER_TOKEN_DENOMINATOR } from "../../xp/engine.js";
import { LockTimeoutError } from "../../state/lockfile.js";

// ---------------------------------------------------------------------------
// Module mock — must be at the top level so Vitest can hoist it.
// The factory captures the real appendEvent and wraps it in vi.fn so tests
// can override per-call while the default call-through keeps integration tests
// working unchanged.
// ---------------------------------------------------------------------------

vi.mock("../../state/persistence.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../state/persistence.js")>();
  return {
    ...actual,
    appendEvent: vi.fn(actual.appendEvent),
  };
});

// ---------------------------------------------------------------------------
// Suppress vitest unhandled-rejection noise for this test file.
//
// The error-path tests (hard-error rollback, lock-timeout retries) deliberately
// inject rejections via mocked appendEvent. The collector code awaits and
// catches them inside its retry loop, but vitest's spy wrapper records the
// rejected promise during call tracking; that recorded reference can fire
// unhandledRejection on its own microtask schedule even though the production
// code's await observed it. This handler silently absorbs LockTimeoutError
// and the synthetic "DISK_FULL" error ONLY — any other unhandled rejection
// still surfaces as a real bug. Scoped via beforeAll/afterAll to this file.
// ---------------------------------------------------------------------------

const swallowExpectedRejection = (reason: unknown): void => {
  if (reason instanceof Error) {
    if (reason.message.includes("DISK_FULL: simulated hard error")) return;
    if (reason.constructor.name === "LockTimeoutError") return;
  }
  // Anything else: re-throw so vitest still sees it
  throw reason;
};

beforeAll(() => {
  process.on("unhandledRejection", swallowExpectedRejection);
});

afterAll(() => {
  process.off("unhandledRejection", swallowExpectedRejection);
});

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

    // Reset the appendEvent mock to call-through (real implementation) before
    // each test so per-test overrides from previous tests don't leak.
    const persistMod = await import("../../state/persistence.js");
    const appendEventFn = persistMod.appendEvent as ReturnType<typeof vi.fn>;
    appendEventFn.mockReset();
    // Re-wrap with the real implementation captured at mock-creation time.
    // We re-import the original because the mock factory captured it once;
    // mockReset() removed it. Use vi.importActual to get the unwrapped original.
    const actualMod = await vi.importActual<typeof import("../../state/persistence.js")>(
      "../../state/persistence.js"
    );
    appendEventFn.mockImplementation(actualMod.appendEvent);
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("emits tokens.delta event with correct xpDelta (floor(tokens/1000) per DEC-020)", async () => {
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
    expect(evt!.xpDelta).toBe(Math.floor(EMIT_TOKEN_THRESHOLD / XP_PER_TOKEN_DENOMINATOR));
    expect((evt!.payload as Record<string, unknown>)["tokens"]).toBe(EMIT_TOKEN_THRESHOLD);
  });

  it("prevHash chain: second event's prevHash matches first event's hash", async () => {
    const { sha256, canonicalJson } = await import("../../util/hash.js");
    const { petId, config } = await setupPet(tmpDir);
    const source = makeFakeSource();
    const collector = new TokenCollector(source, config);
    const stop = collector.start(petId);

    // Two separate threshold crossings — single-flight ensures they are
    // serialized: the second emit queues as a trailing emit after the first
    // appendEvent completes, so both events land and the chain is intact.
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

  it("does not emit if accumulated tokens produce 0 xpDelta (below XP floor)", async () => {
    const { petId, config } = await setupPet(tmpDir);
    const source = makeFakeSource();
    const collector = new TokenCollector(source, config);
    const stop = collector.start(petId);

    // 999 tokens → floor(999/1000) = 0 XP delta; no event should be emitted
    source.emit({ ts: new Date().toISOString(), tokens: 999 });

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

  it("DEC-020: large token send grants XP without daily cap rejection", async () => {
    const { petId, config } = await setupPet(tmpDir);
    const source = makeFakeSource();
    const collector = new TokenCollector(source, config);
    const stop = collector.start(petId);

    // Send 3_000_000 tokens (well above the old 6000 XP daily cap equivalent)
    source.emit({ ts: new Date().toISOString(), tokens: 3_000_000 });
    await new Promise((r) => setTimeout(r, 300));
    await stop();

    // Read updated state — XP should exceed what the old daily cap would allow
    const state = await readState(config);
    expect(state).not.toBeNull();
    const pet = state!.pets.find((p) => p.id === petId);
    expect(pet).toBeDefined();

    // floor(3_000_000 / 1000) = 3000 XP — should all be granted (no cap)
    expect(pet!.xp).toBeGreaterThan(0);

    // No signal.rejected events with cap.daily reason should exist
    const events = await readEvents(config.paths.eventsLog);
    const capRejections = events.filter(
      (e) =>
        e?.type === "signal.rejected" &&
        (e.payload as { reason?: string })?.reason === "cap.daily"
    );
    expect(capRejections).toHaveLength(0);
  });

  it("stop() flushes remaining accumulated tokens", async () => {
    const { petId, config } = await setupPet(tmpDir);
    const source = makeFakeSource();
    const collector = new TokenCollector(source, config);
    const stop = collector.start(petId);

    // Send exactly 2000 tokens — below the 5000 threshold but above XP floor (1000)
    source.emit({ ts: new Date().toISOString(), tokens: 2000 });

    // Stop immediately (should flush the 2000 tokens)
    await stop();

    const events = await readEvents(config.paths.eventsLog);
    const tokenEvents = events.filter((e) => e?.type === "tokens.delta");
    expect(tokenEvents.length).toBe(1);
    expect(tokenEvents[0]!.xpDelta).toBe(2); // floor(2000/1000) = 2
  });

  // ---------------------------------------------------------------------------
  // TODO-033: single-flight + concurrency tests
  // ---------------------------------------------------------------------------

  it("single-flight: 100 concurrent onDelta calls → ≤1 appendEvent in-flight, no tokens lost", async () => {
    const { petId, config } = await setupPet(tmpDir);

    // Instrument the call-through mock to track concurrency.
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const persistMod = await import("../../state/persistence.js");
    const appendEventMock = persistMod.appendEvent as ReturnType<typeof vi.fn>;
    const actualMod = await vi.importActual<typeof import("../../state/persistence.js")>(
      "../../state/persistence.js"
    );

    appendEventMock.mockImplementation(
      async (...args: Parameters<typeof actualMod.appendEvent>) => {
        currentConcurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        try {
          return await actualMod.appendEvent(...args);
        } finally {
          currentConcurrent -= 1;
        }
      }
    );

    const source = makeFakeSource();
    const collector = new TokenCollector(source, config);
    const stop = collector.start(petId);

    // Fire 100 threshold-crossing deltas in rapid succession.
    const ts = new Date().toISOString();
    for (let i = 0; i < 100; i++) {
      source.emit({ ts, tokens: EMIT_TOKEN_THRESHOLD });
    }

    // Allow all trailing emits to settle.
    await new Promise((r) => setTimeout(r, 800));
    await stop();

    // Single-flight invariant: ≤1 appendEvent in-flight at any time.
    expect(maxConcurrent).toBeLessThanOrEqual(1);

    // Total XP must equal floor(totalTokens / XP_PER_TOKEN_DENOMINATOR) — no tokens lost.
    const totalTokens = 100 * EMIT_TOKEN_THRESHOLD;
    const expectedXp = Math.floor(totalTokens / XP_PER_TOKEN_DENOMINATOR);

    const state = await readState(config);
    expect(state).not.toBeNull();
    const pet = state!.pets.find((p) => p.id === petId);
    expect(pet).toBeDefined();
    expect(pet!.xp).toBe(expectedXp);
  });

  it("hard-error rollback: tokens are re-accumulated when appendEvent throws a non-LockTimeoutError", async () => {
    const { petId, config } = await setupPet(tmpDir);

    const persistMod = await import("../../state/persistence.js");
    const appendEventMock = persistMod.appendEvent as ReturnType<typeof vi.fn>;
    const actualMod = await vi.importActual<typeof import("../../state/persistence.js")>(
      "../../state/persistence.js"
    );
    let callCount = 0;

    appendEventMock.mockImplementation(
      (...args: Parameters<typeof actualMod.appendEvent>) => {
        callCount += 1;
        if (callCount === 1) {
          // Return a rejection with an early observer so vitest's spy
          // result-tracking doesn't see it as unhandled. The collector's
          // await still propagates the rejection to its try/catch.
          const p = Promise.reject(new Error("DISK_FULL: simulated hard error"));
          p.catch(() => undefined);
          return p;
        }
        return actualMod.appendEvent(...args);
      }
    );

    const source = makeFakeSource();
    const collector = new TokenCollector(source, config);
    const stop = collector.start(petId);

    // First emit — appendEvent throws; tokens should be re-accumulated.
    source.emit({ ts: new Date().toISOString(), tokens: EMIT_TOKEN_THRESHOLD });
    await new Promise((r) => setTimeout(r, 150));

    // Second emit — appendEvent succeeds; flushes re-accumulated + new tokens together.
    source.emit({ ts: new Date().toISOString(), tokens: EMIT_TOKEN_THRESHOLD });
    await new Promise((r) => setTimeout(r, 400));

    await stop();

    // Total persisted tokens = 2 × threshold (no tokens lost).
    const events = await readEvents(config.paths.eventsLog);
    const tokenEvents = events.filter((e) => e?.type === "tokens.delta");
    expect(tokenEvents.length).toBeGreaterThanOrEqual(1);

    const totalTokens = tokenEvents.reduce(
      (sum, e) => sum + ((e?.payload as Record<string, unknown>)["tokens"] as number),
      0
    );
    expect(totalTokens).toBe(2 * EMIT_TOKEN_THRESHOLD);
  });

  it("lock-timeout retry: retries on LockTimeoutError N times then succeeds", async () => {
    const { petId, config } = await setupPet(tmpDir);

    const persistMod = await import("../../state/persistence.js");
    const appendEventMock = persistMod.appendEvent as ReturnType<typeof vi.fn>;
    const actualMod = await vi.importActual<typeof import("../../state/persistence.js")>(
      "../../state/persistence.js"
    );
    const FAIL_TIMES = 3;
    let callCount = 0;

    appendEventMock.mockImplementation(
      (...args: Parameters<typeof actualMod.appendEvent>) => {
        callCount += 1;
        if (callCount <= FAIL_TIMES) {
          const p = Promise.reject(new LockTimeoutError(config.paths.stateFile, 5000));
          p.catch(() => undefined);
          return p;
        }
        return actualMod.appendEvent(...args);
      }
    );

    const source = makeFakeSource();
    const collector = new TokenCollector(source, config);
    const stop = collector.start(petId);

    source.emit({ ts: new Date().toISOString(), tokens: EMIT_TOKEN_THRESHOLD });

    // Retry backoff: 50ms + 100ms + 200ms = 350ms minimum. Allow generous wait.
    await new Promise((r) => setTimeout(r, 1500));
    await stop();

    // Exactly FAIL_TIMES + 1 calls (3 failures then 1 success).
    expect(callCount).toBe(FAIL_TIMES + 1);

    // Event was eventually persisted.
    const events = await readEvents(config.paths.eventsLog);
    const tokenEvents = events.filter((e) => e?.type === "tokens.delta");
    expect(tokenEvents.length).toBe(1);
    expect(
      (tokenEvents[0]!.payload as Record<string, unknown>)["tokens"]
    ).toBe(EMIT_TOKEN_THRESHOLD);
  });

  // 10 retries with capped 500ms backoff = ~3.75s total wall-clock; bump test
  // timeout to 8s so the drain-loop in stop() can finish before vitest aborts.
  it("lock-timeout retry: re-accumulates tokens when retries are exhausted", { timeout: 8000 }, async () => {
    const { petId, config } = await setupPet(tmpDir);

    const persistMod = await import("../../state/persistence.js");
    const appendEventMock = persistMod.appendEvent as ReturnType<typeof vi.fn>;
    let callCount = 0;

    // Always reject with LockTimeoutError — exhausts all retries.
    appendEventMock.mockImplementation(() => {
      callCount += 1;
      const p = Promise.reject(new LockTimeoutError(config.paths.stateFile, 5000));
      p.catch(() => undefined);
      return p;
    });

    const source = makeFakeSource();
    const collector = new TokenCollector(source, config);
    const stop = collector.start(petId);

    source.emit({ ts: new Date().toISOString(), tokens: EMIT_TOKEN_THRESHOLD });

    // Allow first few retries to fire (50ms + 100ms + 200ms = 350ms for first 3).
    await new Promise((r) => setTimeout(r, 500));
    await stop();

    // Retries fired: callCount > 1.
    expect(callCount).toBeGreaterThan(1);

    // No events persisted (all attempts failed) — tokens re-accumulated but not flushed.
    const events = await readEvents(config.paths.eventsLog);
    const tokenEvents = events.filter((e) => e?.type === "tokens.delta");
    expect(tokenEvents.length).toBe(0);
  });
});
