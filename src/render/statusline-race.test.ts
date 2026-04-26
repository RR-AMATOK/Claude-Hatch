/**
 * TODO-034: Statusline XP-bar race condition tests.
 *
 * Covers three scenarios:
 *
 * 1. Torn-read simulation — half-written JSON on disk. Verifies that
 *    readStateOrError retries and ultimately either returns valid state or
 *    falls back gracefully (never throws).
 *
 * 2. Monotonic bar — consecutive readStateOrError calls followed by bar
 *    computation at the same level must never show a decreasing fill.
 *
 * 3. Stress writer / reader — a tight loop writes state.json repeatedly
 *    while the reader reads it. Every successful read must produce a bar
 *    value that matches the math computed from the SAME state snapshot.
 *
 * None of these tests write to ~/.claude/ (DEC-008).
 * All filesystem fixtures go to os.tmpdir().
 *
 * @see DEC-016 (statusline is read-only; no lockfile acquisition)
 * @see DEC-020 (XP curve)
 * @see architecture §4.4 (reader protocol — retry on parse error)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { buildConfig } from "../config/env.js";
import { readStateOrError } from "../state/reader.js";
import { cumulativeXpForLevel, levelFromCumXp, LEVEL_CAP } from "../xp/engine.js";
import { renderHudRow } from "./compact.js";
import type { Pet, StateFileV1 } from "../state/schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePet(overrides: Partial<Pet> = {}): Pet {
  const now = new Date().toISOString();
  return {
    id: "race-test-pet-1",
    schemaVersion: 1,
    eggType: "circuit",
    name: "Bramble",
    createdAt: now,
    hatchedAt: now,
    lastFedAt: now,
    lastInteractionAt: now,
    xp: 0,
    level: 1,
    personality: {
      dominant: "Friendly",
      weights: {
        Stoic: 0.1,
        Friendly: 0.3,
        Pragmatic: 0.15,
        Energetic: 0.1,
        Gruff: 0.05,
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
    lastLevelUpAt: null,
    lastPlayedAt: null,
    lastHatchedAt: null,
    lastEvolvedAt: null,
    ...overrides,
  };
}

function makeValidState(pet: Pet): StateFileV1 {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    pets: [pet],
    globals: {
      activePetId: pet.id,
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
 * Compute the expected bar fill from a pet's XP — this is the ground truth.
 * Must match the formula in compact.ts xpBarFill().
 */
function computeExpectedFill(xp: number): number {
  const level = levelFromCumXp(xp);
  if (level >= LEVEL_CAP) return 14;
  const floorXp = cumulativeXpForLevel(level);
  const nextXp = cumulativeXpForLevel(level + 1);
  const span = Math.max(1, nextXp - floorXp);
  const ratio = Math.min(1, Math.max(0, (xp - floorXp) / span));
  return Math.floor(ratio * 14);
}

/** Strip ANSI SGR escape sequences from a string. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Count filled block cells (U+2588 █) inside the first [……] segment.
 * Returns -1 if no bracket segment is found.
 */
function filledCells(s: string): number {
  const match = /\[([^\]]*)\]/.exec(s);
  if (!match) return -1;
  let count = 0;
  for (const ch of match[1]!) {
    if (ch === "█") count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Temp dir lifecycle
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "glyphling-race-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// describe: Torn-read simulation (Hypothesis 2)
// ---------------------------------------------------------------------------

describe("readStateOrError — torn-read simulation", () => {
  /**
   * Test 1: Half-written JSON (truncated mid-object).
   *
   * Simulates the window between when the writer truncates the tmp file and
   * when it finishes writing the full JSON.  readStateOrError should retry
   * and ultimately NOT throw.  It may return { state: null, parseError: true }
   * but must never throw.
   *
   * The state directory must exist for the reader to attempt a read.
   */
  it("does not throw when state.json contains truncated JSON", async () => {
    const config = buildConfig(tmpDir);
    await fs.promises.mkdir(path.dirname(config.paths.stateFile), { recursive: true });

    // Write a half-formed JSON object — truncated mid-string.
    const halfJson = '{"schemaVersion":1,"createdAt":"2026-01-01T00:00:00Z","updatedAt":';
    await fs.promises.writeFile(config.paths.stateFile, halfJson, "utf8");

    let threw = false;
    let result: Awaited<ReturnType<typeof readStateOrError>> | undefined;
    try {
      result = await readStateOrError(config);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result).toBeDefined();
    // Truncated JSON → parse error → state=null, parseError=true after retries
    expect(result?.state).toBeNull();
    expect(result?.parseError).toBe(true);
  });

  /**
   * Test 2: Completely invalid JSON (simulates a write aborted before any
   * valid content was flushed).
   */
  it("does not throw when state.json is garbage bytes", async () => {
    const config = buildConfig(tmpDir);
    await fs.promises.mkdir(path.dirname(config.paths.stateFile), { recursive: true });
    await fs.promises.writeFile(config.paths.stateFile, "\x00\x01\x02garbage{{{{", "utf8");

    let threw = false;
    try {
      await readStateOrError(config);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  /**
   * Test 3: Race window scenario — write truncated JSON then heal it
   * ~8ms later (within the retry window).
   *
   * Since readStateOrError retries on parse failure with 5-15ms jitter,
   * the second attempt should read the valid JSON.
   */
  it("recovers and returns valid state when a torn-read is healed within the retry window", async () => {
    const config = buildConfig(tmpDir);
    await fs.promises.mkdir(path.dirname(config.paths.stateFile), { recursive: true });

    const pet = makePet({ xp: 1000, level: 5 });
    const validJson = JSON.stringify(makeValidState(pet));

    // Write truncated JSON first — simulates the torn-read window.
    const truncated = validJson.slice(0, Math.floor(validJson.length / 2));
    await fs.promises.writeFile(config.paths.stateFile, truncated, "utf8");

    // Heal within the retry window (~8ms — within READ_RETRY_MIN_MS=5 .. READ_RETRY_MAX_MS=15).
    const healer = setTimeout(() => {
      fs.writeFileSync(config.paths.stateFile, validJson, "utf8");
    }, 8);

    let result: Awaited<ReturnType<typeof readStateOrError>> | undefined;
    try {
      result = await readStateOrError(config);
    } finally {
      clearTimeout(healer);
    }

    // After retries, should have read the valid state.
    expect(result?.state).not.toBeNull();
    if (result?.state) {
      expect(result.state.pets[0]?.xp).toBe(1000);
    }
  });

  /**
   * Test 4: ENOENT is handled gracefully — returns null without throwing.
   *
   * Simulates the brief absence of state.json during an atomic rename
   * on a filesystem that unlinks before creating (unlikely on macOS but
   * defensive).
   */
  it("returns null state gracefully when state.json is absent (ENOENT)", async () => {
    const config = buildConfig(tmpDir);
    await fs.promises.mkdir(path.dirname(config.paths.stateFile), { recursive: true });
    // Do NOT create state.json.

    let threw = false;
    let result: Awaited<ReturnType<typeof readStateOrError>> | undefined;
    try {
      result = await readStateOrError(config);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    // ENOENT → state=null, parseError=false (missing = first-run semantics).
    expect(result?.state).toBeNull();
    expect(result?.parseError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describe: Bar-fill math — invariant tests (Hypothesis 2, render guard)
// ---------------------------------------------------------------------------

describe("XP bar fill — render consistency invariants", () => {
  /**
   * Test 5: The bar fill computed from a Pet object matches the formula
   * independently computed from the same xp value.
   *
   * This is the ground-truth test. If compact.ts's xpBarFill() diverges from
   * computeExpectedFill() at any XP value, this test catches it.
   */
  it("bar fill matches independent formula at sample points across levels 1-500", () => {
    const testLevels = [1, 5, 10, 50, 100, 200, 280, 300, 400, 500];
    const PROBES_PER_LEVEL = 5;

    for (const level of testLevels) {
      const cumBase = cumulativeXpForLevel(level);
      const cumNext = cumulativeXpForLevel(level + 1);
      const span = cumNext - cumBase;

      for (let i = 0; i < PROBES_PER_LEVEL; i++) {
        const xp = cumBase + Math.floor((span * i) / PROBES_PER_LEVEL);
        const pet = makePet({ xp, level });

        const raw = renderHudRow(pet, "content", 1, 0, "ansi256", false);
        const plain = stripAnsi(raw);
        const actual = filledCells(plain);
        const expected = computeExpectedFill(xp);

        expect(actual).toBe(expected);
      }
    }
  });

  /**
   * Test 6: The bar never decreases between consecutive XP values within a
   * single level (monotonic fill invariant).
   *
   * This is the primary user-visible invariant violated by the sawtooth bug.
   * Even with torn reads, if the reader retries correctly and returns a valid
   * state, fills must be non-decreasing within a level.
   */
  it("bar fill is monotonically non-decreasing within a level span (level 280)", () => {
    const TEST_LEVEL = 280;
    const cumBase = cumulativeXpForLevel(TEST_LEVEL);
    const cumNext = cumulativeXpForLevel(TEST_LEVEL + 1);
    const span = cumNext - cumBase;
    const STEPS = 20;

    const fills: number[] = [];

    for (let i = 0; i < STEPS; i++) {
      const xp = cumBase + Math.floor((span * i) / STEPS);
      const pet = makePet({ xp, level: TEST_LEVEL });
      const raw = renderHudRow(pet, "content", 1, 0, "ansi256", false);
      const plain = stripAnsi(raw);
      fills.push(filledCells(plain));
    }

    for (let i = 1; i < fills.length; i++) {
      expect(fills[i]).toBeGreaterThanOrEqual(fills[i - 1]!);
    }
  });

  /**
   * Test 7: Two consecutive renders of the same pet snapshot produce the
   * same fill value.
   *
   * Verifies the render is pure and deterministic — no hidden mutable
   * state inside compact.ts that could cause divergence between ticks.
   */
  it("two renders of the same pet snapshot produce the same fill (idempotent render)", () => {
    // Use the exact values from the user's bug report: xp=1,941,826 level=280.
    const xp = 1_941_826;
    const level = levelFromCumXp(xp);
    const pet = makePet({ xp, level });

    const raw1 = renderHudRow(pet, "content", 1, 0, "ansi256", false);
    const raw2 = renderHudRow(pet, "content", 1, 0, "ansi256", false);

    expect(stripAnsi(raw1)).toBe(stripAnsi(raw2));
    expect(filledCells(stripAnsi(raw1))).toBe(filledCells(stripAnsi(raw2)));
  });

  /**
   * Test 8: Verify the exact XP values from the user's bug report.
   *
   * Bramble at xp=1,941,826 and xp=1,948,948, both at level=280.
   * The second value has MORE XP so its fill must be >= the first.
   * This directly exercises the scenario that was intermittently failing.
   */
  it("Bramble bug-report: fill at xp=1948948 >= fill at xp=1941826 (both level 280)", () => {
    const level = 280;
    const xp1 = 1_941_826;
    const xp2 = 1_948_948;

    // Verify both are genuinely at level 280.
    expect(levelFromCumXp(xp1)).toBe(level);
    expect(levelFromCumXp(xp2)).toBe(level);

    const pet1 = makePet({ xp: xp1, level });
    const pet2 = makePet({ xp: xp2, level });

    const fill1 = filledCells(stripAnsi(renderHudRow(pet1, "content", 1, 0, "ansi256", false)));
    const fill2 = filledCells(stripAnsi(renderHudRow(pet2, "content", 1, 0, "ansi256", false)));

    // xp2 > xp1 → fill must be at least as large (not a sawtooth reset).
    expect(fill2).toBeGreaterThanOrEqual(fill1);
    // Additionally, fill values must match the independent formula.
    expect(fill1).toBe(computeExpectedFill(xp1));
    expect(fill2).toBe(computeExpectedFill(xp2));
  });

  /**
   * Test 9: XP at level boundary (start + end) must produce fill = 0 and
   * fill ≥ 13 respectively — confirming no off-by-one in the formula.
   */
  it("fill=0 at level start, fill>=13 at level end (level 280)", () => {
    const TEST_LEVEL = 280;
    const cumBase = cumulativeXpForLevel(TEST_LEVEL);
    const cumNext = cumulativeXpForLevel(TEST_LEVEL + 1);

    const petStart = makePet({ xp: cumBase, level: TEST_LEVEL });
    const petEnd = makePet({ xp: cumNext - 1, level: TEST_LEVEL });

    const fillStart = filledCells(
      stripAnsi(renderHudRow(petStart, "content", 1, 0, "ansi256", false))
    );
    const fillEnd = filledCells(
      stripAnsi(renderHudRow(petEnd, "content", 1, 0, "ansi256", false))
    );

    expect(fillStart).toBe(0);
    expect(fillEnd).toBeGreaterThanOrEqual(13);
  });
});

// ---------------------------------------------------------------------------
// describe: Stress read/write (Hypothesis 2 — concurrent watcher + reader)
// ---------------------------------------------------------------------------

describe("readStateOrError — stress concurrent write/read", () => {
  /**
   * Test 10: In-process stress test — simulate the daemon writing state.json
   * in a tight loop while the statusline reader reads concurrently.
   *
   * For each successful read (non-null state), assert:
   *   - The bar fill matches the formula computed from the SAME pet.xp
   *   - bar fill is within [0, 14]
   *
   * Also asserts the stronger invariant:
   *   - For consecutive reads sharing the same pet.level, fill[N+1] >= fill[N]
   *
   * This test is a probabilistic reproducer: it may not trigger the torn-read
   * on every run (the window is ~1-2ms), but over 100 iterations it will
   * reliably catch absent or broken retry logic.
   */
  it("every valid read produces bar fill matching the formula from the same snapshot", async () => {
    const config = buildConfig(tmpDir);
    await fs.promises.mkdir(path.dirname(config.paths.stateFile), { recursive: true });

    // Starting at level 280 to mirror the bug report.
    const TEST_LEVEL = 280;
    const cumBase = cumulativeXpForLevel(TEST_LEVEL);
    const cumNext = cumulativeXpForLevel(TEST_LEVEL + 1);
    const span = cumNext - cumBase;

    // Write initial valid state.
    let currentXp = cumBase + Math.floor(span * 0.1);
    const initialPet = makePet({ xp: currentXp, level: TEST_LEVEL });
    await fs.promises.writeFile(
      config.paths.stateFile,
      JSON.stringify(makeValidState(initialPet)),
      "utf8"
    );

    // Writer: update XP monotonically in a loop using tmp-then-rename (POSIX atomic).
    // Tests the reader's robustness against the real write pattern.
    let writerRunning = true;
    const writerErrors: string[] = [];

    const writerLoop = (async () => {
      const XP_STEP = Math.floor(span / 50); // ~50 increments per level

      while (writerRunning) {
        currentXp = Math.min(cumNext - 1, currentXp + XP_STEP);
        const updatedPet = makePet({ xp: currentXp, level: TEST_LEVEL });
        const newState = makeValidState(updatedPet);
        const json = JSON.stringify(newState);

        // Simulate atomic rename: write to tmp, then rename.
        const tmpPath = config.paths.stateFile + ".tmp.test";
        try {
          fs.writeFileSync(tmpPath, json, "utf8");
          fs.renameSync(tmpPath, config.paths.stateFile);
        } catch (e) {
          writerErrors.push(String(e));
        }

        // Yield to allow the reader to interleave.
        await new Promise<void>((resolve) => setImmediate(resolve));

        if (currentXp >= cumNext - 1) {
          // Wrap back to start of level.
          currentXp = cumBase;
        }
      }
    })();

    // Reader: read state 100 times, verify formula on every successful read.
    const READS = 100;
    const violations: string[] = [];
    let lastFill = -1;
    let lastLevel = -1;
    let lastXp = -1;

    for (let i = 0; i < READS; i++) {
      const result = await readStateOrError(config);

      if (result.state === null) {
        // Torn read that did not heal within 3 retries — acceptable.
        // Reset monotonic tracker since we lost the snapshot chain.
        lastFill = -1;
        lastLevel = -1;
        lastXp = -1;
        continue;
      }

      const activePet = result.state.pets[0];
      if (!activePet) continue;

      const snapshotXp = activePet.xp;
      const snapshotLevel = levelFromCumXp(snapshotXp);

      // Check fill matches formula for this SNAPSHOT (single source of truth).
      const expectedFill = computeExpectedFill(snapshotXp);
      const raw = renderHudRow(activePet, "content", 1, 0, "none", false);
      const actualFill = filledCells(raw);

      if (actualFill !== expectedFill) {
        violations.push(
          `Read ${i}: xp=${snapshotXp} level=${snapshotLevel} ` +
            `expected fill=${expectedFill} got fill=${actualFill}`
        );
      }

      // Monotonic invariant: fill must not decrease when XP is non-decreasing
      // within the same level. The writer wraps xp back to cumBase legitimately
      // (xp decreases at wrap), so we only assert monotonic when snapshotXp >= lastXp.
      if (
        snapshotLevel === lastLevel &&
        snapshotXp >= lastXp &&
        lastFill !== -1 &&
        actualFill < lastFill
      ) {
        violations.push(
          `Read ${i}: bar decreased within level ${snapshotLevel} while xp increased: ` +
            `was fill=${lastFill} at xp=${lastXp}, now fill=${actualFill} at xp=${snapshotXp}`
        );
      }

      lastFill = actualFill;
      lastLevel = snapshotLevel;
      lastXp = snapshotXp;

      // Yield between reads to allow writer to progress.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    // Stop writer.
    writerRunning = false;
    await writerLoop;

    if (writerErrors.length > 0) {
      console.info(`[race test] writer encountered ${writerErrors.length} non-fatal errors`);
    }

    if (violations.length > 0) {
      throw new Error(
        `Bar fill violations detected (${violations.length}):\n` +
          violations.slice(0, 5).join("\n")
      );
    }
  }, 30_000); // 30s timeout for stress test

  /**
   * Test 11: Verify that when state.json is briefly absent (simulating a
   * crash between write attempts), the reader returns null gracefully rather
   * than throwing.
   */
  it("returns null state gracefully when state.json is briefly absent mid-stress", async () => {
    const config = buildConfig(tmpDir);
    await fs.promises.mkdir(path.dirname(config.paths.stateFile), { recursive: true });

    // Write initial valid state.
    const pet = makePet({ xp: 1000, level: 5 });
    await fs.promises.writeFile(
      config.paths.stateFile,
      JSON.stringify(makeValidState(pet)),
      "utf8"
    );

    // Delete to simulate the brief absence during rename.
    await fs.promises.unlink(config.paths.stateFile);

    let threw = false;
    let result: Awaited<ReturnType<typeof readStateOrError>> | undefined;
    try {
      result = await readStateOrError(config);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    // ENOENT → state=null, parseError=false.
    expect(result?.state).toBeNull();
    expect(result?.parseError).toBe(false);
  });
});
