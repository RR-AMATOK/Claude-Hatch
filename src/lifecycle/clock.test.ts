/**
 * Tests for src/lifecycle/clock.ts — LifecycleClock (TODO-011)
 *
 * All 6 hard-requirement test cases from TODOS.md:
 *   1. Forward clock jump (wall now jumps +1 h) — accumulator adds 60 s only
 *   2. Backward clock jump — accumulator does not go negative (clamp to 0)
 *   3. Laptop suspend simulation (tick gap > 60 s) — same as forward-jump clamp
 *   4. Pause/resume — accumulator frozen during pause; wall-clock ceiling extended
 *   5. Both death-threshold paths — accumulated-days path and wall-clock path
 *   6. Guardrail ordering — on a single tick crossing BOTH thresholds simultaneously,
 *      pet:died fires exactly once, not twice
 *
 * Additional coverage:
 *   - isPaused helper
 *   - closedPauseDurationMs helper
 *   - Health warning events (hungry, sick, dying)
 *   - start() boot API with injectable time source
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computeTick,
  isPaused,
  closedPauseDurationMs,
  start,
  NEGLECT_DEATH_SECONDS,
  WALL_CLOCK_DEATH_MS,
  HUNGRY_THRESHOLD_S,
  SICK_THRESHOLD_S,
  DYING_THRESHOLD_S,
  MAX_TICK_SECONDS,
  TICK_INTERVAL_MS,
  type ClockPet,
} from "./clock.js";
import type { PauseInterval } from "../state/schema.js";
import { cumulativeXpForLevel } from "../xp/engine.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_NOW = new Date("2026-04-17T12:00:00.000Z").getTime();

function makePet(overrides: Partial<ClockPet> = {}): ClockPet {
  return {
    id: "pet-001",
    xp: 0, // default: L1 (not an Ascendant)
    diedAt: null,
    accumulatedNeglectSeconds: 0,
    lastTickAt: new Date(BASE_NOW - 60_000).toISOString(), // 60s ago
    lastInteractionAt: new Date(BASE_NOW - 60_000).toISOString(),
    pauseIntervals: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isPaused / closedPauseDurationMs helpers
// ---------------------------------------------------------------------------

describe("isPaused", () => {
  it("returns false for no intervals", () => {
    expect(isPaused([])).toBe(false);
  });

  it("returns false when last interval is closed", () => {
    const intervals: PauseInterval[] = [
      { pausedAt: "2026-01-01T00:00:00Z", resumedAt: "2026-01-01T01:00:00Z" },
    ];
    expect(isPaused(intervals)).toBe(false);
  });

  it("returns true when last interval has resumedAt === null", () => {
    const intervals: PauseInterval[] = [
      { pausedAt: "2026-01-01T00:00:00Z", resumedAt: null },
    ];
    expect(isPaused(intervals)).toBe(true);
  });

  it("returns true when multiple intervals, last is open", () => {
    const intervals: PauseInterval[] = [
      { pausedAt: "2026-01-01T00:00:00Z", resumedAt: "2026-01-01T01:00:00Z" },
      { pausedAt: "2026-01-02T00:00:00Z", resumedAt: null },
    ];
    expect(isPaused(intervals)).toBe(true);
  });
});

describe("closedPauseDurationMs", () => {
  it("returns 0 for no intervals", () => {
    expect(closedPauseDurationMs([])).toBe(0);
  });

  it("returns 0 for a single open interval", () => {
    const intervals: PauseInterval[] = [
      { pausedAt: "2026-01-01T00:00:00Z", resumedAt: null },
    ];
    expect(closedPauseDurationMs(intervals)).toBe(0);
  });

  it("sums closed intervals only", () => {
    const intervals: PauseInterval[] = [
      {
        pausedAt: "2026-01-01T00:00:00Z",
        resumedAt: "2026-01-01T01:00:00Z", // 1 hour = 3_600_000 ms
      },
      {
        pausedAt: "2026-01-02T00:00:00Z",
        resumedAt: "2026-01-02T02:00:00Z", // 2 hours = 7_200_000 ms
      },
    ];
    expect(closedPauseDurationMs(intervals)).toBe(3_600_000 + 7_200_000);
  });

  it("ignores open interval in multi-interval list", () => {
    const intervals: PauseInterval[] = [
      { pausedAt: "2026-01-01T00:00:00Z", resumedAt: "2026-01-01T01:00:00Z" }, // 1h
      { pausedAt: "2026-01-02T00:00:00Z", resumedAt: null }, // open — excluded
    ];
    expect(closedPauseDurationMs(intervals)).toBe(3_600_000);
  });
});

// ---------------------------------------------------------------------------
// TEST 1: Forward clock jump
// Wall now jumps +1 hour, but accumulator should only add 60 s (MAX_TICK_SECONDS).
// ---------------------------------------------------------------------------

describe("TEST 1 — Forward clock jump", () => {
  it("accumulator adds MAX_TICK_SECONDS (60) even if wall gap is 1 hour", () => {
    const pet = makePet({
      accumulatedNeglectSeconds: 0,
      lastTickAt: new Date(BASE_NOW - 3_600_000).toISOString(), // 1 hour ago
      lastInteractionAt: new Date(BASE_NOW - 3_600_000).toISOString(),
    });

    const result = computeTick(pet, BASE_NOW);

    // Must be clamped at 60 seconds, not 3600
    expect(result.newAccumulatedNeglectSeconds).toBe(MAX_TICK_SECONDS);
    expect(result.newAccumulatedNeglectSeconds).not.toBe(3600);
  });

  it("works for extreme clock jumps (24h)", () => {
    const pet = makePet({
      accumulatedNeglectSeconds: 0,
      lastTickAt: new Date(BASE_NOW - 86_400_000).toISOString(), // 24h ago
    });

    const result = computeTick(pet, BASE_NOW);
    expect(result.newAccumulatedNeglectSeconds).toBe(MAX_TICK_SECONDS);
  });
});

// ---------------------------------------------------------------------------
// TEST 2: Backward clock jump
// now < lastTickAt — accumulator must not go negative.
// ---------------------------------------------------------------------------

describe("TEST 2 — Backward clock jump", () => {
  it("accumulator does not go negative when now < lastTickAt", () => {
    const pet = makePet({
      accumulatedNeglectSeconds: 100,
      // lastTickAt is in the FUTURE relative to nowMs
      lastTickAt: new Date(BASE_NOW + 5_000).toISOString(),
    });

    const result = computeTick(pet, BASE_NOW);

    // Delta = nowMs - lastTickMs = BASE_NOW - (BASE_NOW+5000) = -5000ms → negative
    // Clamped to 0 → accumulator stays at 100
    expect(result.newAccumulatedNeglectSeconds).toBe(100);
    expect(result.newAccumulatedNeglectSeconds).toBeGreaterThanOrEqual(0);
  });

  it("accumulator stays at 0 if already 0 and clock runs backward", () => {
    const pet = makePet({
      accumulatedNeglectSeconds: 0,
      lastTickAt: new Date(BASE_NOW + 10_000).toISOString(),
    });

    const result = computeTick(pet, BASE_NOW);
    expect(result.newAccumulatedNeglectSeconds).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TEST 3: Laptop suspend simulation
// Large tick gap (e.g., 2 hours between ticks) — clamp applies identically
// to forward clock jumps.
// ---------------------------------------------------------------------------

describe("TEST 3 — Laptop suspend simulation", () => {
  it("2-hour suspend: accumulator adds only 60 s", () => {
    const pet = makePet({
      accumulatedNeglectSeconds: 50,
      lastTickAt: new Date(BASE_NOW - 7_200_000).toISOString(), // 2h ago
    });

    const result = computeTick(pet, BASE_NOW);
    expect(result.newAccumulatedNeglectSeconds).toBe(50 + MAX_TICK_SECONDS);
  });

  it("48-hour suspend: accumulator adds only 60 s (not 172800)", () => {
    const pet = makePet({
      accumulatedNeglectSeconds: 0,
      lastTickAt: new Date(BASE_NOW - 48 * 3_600_000).toISOString(),
    });

    const result = computeTick(pet, BASE_NOW);
    expect(result.newAccumulatedNeglectSeconds).toBe(MAX_TICK_SECONDS);
    expect(result.newAccumulatedNeglectSeconds).not.toBe(48 * 3600);
  });
});

// ---------------------------------------------------------------------------
// TEST 4: Pause/resume
// During pause: accumulator frozen; wall-clock ceiling extended by pause duration.
// ---------------------------------------------------------------------------

describe("TEST 4 — Pause/resume", () => {
  it("accumulator is frozen while pet is paused", () => {
    const pausedAt = new Date(BASE_NOW - 120_000).toISOString(); // 2 min ago

    const pet = makePet({
      accumulatedNeglectSeconds: 500,
      lastTickAt: new Date(BASE_NOW - 60_000).toISOString(),
      lastInteractionAt: new Date(BASE_NOW - 60_000).toISOString(),
      pauseIntervals: [{ pausedAt, resumedAt: null }], // still paused
    });

    const result = computeTick(pet, BASE_NOW);

    // Accumulator must NOT increase while paused
    expect(result.newAccumulatedNeglectSeconds).toBe(500);
  });

  it("accumulator resumes after resume", () => {
    const pausedAt = new Date(BASE_NOW - 7200_000).toISOString(); // paused 2h ago
    const resumedAt = new Date(BASE_NOW - 60_000).toISOString();  // resumed 60s ago

    const pet = makePet({
      accumulatedNeglectSeconds: 500,
      lastTickAt: new Date(BASE_NOW - 60_000).toISOString(),
      lastInteractionAt: new Date(BASE_NOW - 120_000).toISOString(),
      pauseIntervals: [{ pausedAt, resumedAt }], // closed — resumed
    });

    const result = computeTick(pet, BASE_NOW);
    // 60s normal tick since resumed
    expect(result.newAccumulatedNeglectSeconds).toBe(500 + MAX_TICK_SECONDS);
  });

  it("wall-clock ceiling is extended by pause duration", () => {
    // Scenario:
    //   lastInteractionAt = 15 wall-clock days ago
    //   BUT: pet was paused for 5 days (closed interval)
    //   adjusted wall-clock = 15 - 5 = 10 days → no death yet (ceiling is 14d)

    const fifteenDaysAgo = new Date(BASE_NOW - 15 * 86_400_000);
    const tenDaysAgo = new Date(BASE_NOW - 10 * 86_400_000);
    const fiveDaysAgo = new Date(BASE_NOW - 5 * 86_400_000);

    const pet = makePet({
      accumulatedNeglectSeconds: 0,  // accumulator path not triggered
      lastTickAt: new Date(BASE_NOW - 60_000).toISOString(),
      lastInteractionAt: fifteenDaysAgo.toISOString(),
      pauseIntervals: [
        {
          pausedAt: tenDaysAgo.toISOString(),   // paused 10d ago
          resumedAt: fiveDaysAgo.toISOString(), // resumed 5d ago → 5-day closed interval
        },
      ],
    });

    const result = computeTick(pet, BASE_NOW);

    // Should NOT die: adjusted wall-clock elapsed = 15d - 5d = 10d < 14d
    expect(result.died).toBe(false);
    expect(result.sideEffects.some((e) => e.type === "pet.died")).toBe(false);
  });

  it("wall-clock death still fires when adjusted elapsed >= 14 days", () => {
    // lastInteractionAt = 20 days ago, paused for 3 days = adjusted 17 days > 14d → death
    const twentyDaysAgo = new Date(BASE_NOW - 20 * 86_400_000);
    const fifteenDaysAgo = new Date(BASE_NOW - 15 * 86_400_000);
    const twelveDaysAgo = new Date(BASE_NOW - 12 * 86_400_000);

    const pet = makePet({
      accumulatedNeglectSeconds: 0,
      lastTickAt: new Date(BASE_NOW - 60_000).toISOString(),
      lastInteractionAt: twentyDaysAgo.toISOString(),
      pauseIntervals: [
        {
          pausedAt: fifteenDaysAgo.toISOString(),
          resumedAt: twelveDaysAgo.toISOString(), // 3-day closed interval
        },
      ],
    });

    const result = computeTick(pet, BASE_NOW);

    // adjusted = 20d - 3d = 17d > 14d → should die
    expect(result.died).toBe(true);
    expect(result.sideEffects.some((e) => e.type === "pet.died")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TEST 5: Both death-threshold paths
// ---------------------------------------------------------------------------

describe("TEST 5 — Both death-threshold paths", () => {
  it("accumulated-days path fires pet:died when accumulatedNeglectSeconds reaches 3 days", () => {
    // One tick away from the 3-day threshold
    const nearDeathAccum = NEGLECT_DEATH_SECONDS - MAX_TICK_SECONDS;

    const pet = makePet({
      accumulatedNeglectSeconds: nearDeathAccum,
      lastTickAt: new Date(BASE_NOW - 60_000).toISOString(),
      lastInteractionAt: new Date(BASE_NOW - 60_000).toISOString(), // recently interacted → no wall-clock death
    });

    const result = computeTick(pet, BASE_NOW);

    expect(result.died).toBe(true);
    expect(result.newAccumulatedNeglectSeconds).toBeGreaterThanOrEqual(NEGLECT_DEATH_SECONDS);

    const diedEvent = result.sideEffects.find((e) => e.type === "pet.died");
    expect(diedEvent).toBeDefined();
    expect((diedEvent?.payload as { accumulatedDeath: boolean }).accumulatedDeath).toBe(true);
  });

  it("wall-clock path fires pet:died when 14 adjusted days have elapsed", () => {
    // Pet hasn't been interacted with for 15 days, no pause intervals
    const fifteenDaysAgo = new Date(BASE_NOW - 15 * 86_400_000);

    const pet = makePet({
      accumulatedNeglectSeconds: 0, // accumulator path NOT triggered
      lastTickAt: new Date(BASE_NOW - 60_000).toISOString(),
      lastInteractionAt: fifteenDaysAgo.toISOString(),
      pauseIntervals: [],
    });

    const result = computeTick(pet, BASE_NOW);

    expect(result.died).toBe(true);

    const diedEvent = result.sideEffects.find((e) => e.type === "pet.died");
    expect(diedEvent).toBeDefined();
    expect((diedEvent?.payload as { wallClockDeath: boolean }).wallClockDeath).toBe(true);
  });

  it("accumulated-days path fires BEFORE wall-clock path when accumulator crosses threshold first", () => {
    // Give pet exactly enough accumulated neglect to die, but wall-clock is only 2 days
    const nearDeathAccum = NEGLECT_DEATH_SECONDS - MAX_TICK_SECONDS;

    const pet = makePet({
      accumulatedNeglectSeconds: nearDeathAccum,
      lastTickAt: new Date(BASE_NOW - 60_000).toISOString(),
      lastInteractionAt: new Date(BASE_NOW - 2 * 86_400_000).toISOString(), // 2 days ago
      pauseIntervals: [],
    });

    const result = computeTick(pet, BASE_NOW);

    expect(result.died).toBe(true);
    const diedEvent = result.sideEffects.find((e) => e.type === "pet.died");
    expect(diedEvent).toBeDefined();
    // accumulatedDeath should be true; wallClockDeath might also be checked
    expect((diedEvent?.payload as { accumulatedDeath: boolean }).accumulatedDeath).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TEST 6: Guardrail ordering — pet:died fires exactly once even if both
// thresholds cross simultaneously (very long suspend).
// ---------------------------------------------------------------------------

describe("TEST 6 — Guardrail ordering: pet:died fires exactly once", () => {
  it("pet:died emitted exactly once when both thresholds cross in same tick", () => {
    // Set up a pet where BOTH thresholds would fire:
    //   - accumulated neglect = 3 days (threshold A)
    //   - wall-clock elapsed = 14 days (threshold B)
    const fourteenDaysAgo = new Date(BASE_NOW - 14 * 86_400_000);

    const pet = makePet({
      // Start accumulator just below the 3-day threshold; single tick adds 60s → crosses it
      accumulatedNeglectSeconds: NEGLECT_DEATH_SECONDS - MAX_TICK_SECONDS,
      lastTickAt: new Date(BASE_NOW - 60_000).toISOString(),
      // Last interaction was 14 days ago → wall-clock threshold also crossed
      lastInteractionAt: fourteenDaysAgo.toISOString(),
      pauseIntervals: [],
    });

    const result = computeTick(pet, BASE_NOW);

    // Must die
    expect(result.died).toBe(true);

    // pet:died must appear EXACTLY ONCE — not twice, not zero
    const diedEvents = result.sideEffects.filter((e) => e.type === "pet.died");
    expect(diedEvents).toHaveLength(1);
  });

  it("dead pet is never ticked again (diedAt is set)", () => {
    const pet = makePet({
      diedAt: new Date().toISOString(),
      accumulatedNeglectSeconds: NEGLECT_DEATH_SECONDS,
    });

    const result = computeTick(pet, BASE_NOW);
    expect(result.died).toBe(false);
    expect(result.sideEffects).toHaveLength(0);
    expect(result.newAccumulatedNeglectSeconds).toBe(NEGLECT_DEATH_SECONDS);
  });
});

// ---------------------------------------------------------------------------
// Health warning events
// ---------------------------------------------------------------------------

describe("Health warning events", () => {
  it("emits pet.hungry when accumulated neglect crosses HUNGRY_THRESHOLD_S", () => {
    const pet = makePet({
      accumulatedNeglectSeconds: HUNGRY_THRESHOLD_S - MAX_TICK_SECONDS,
      lastTickAt: new Date(BASE_NOW - 60_000).toISOString(),
      lastInteractionAt: new Date(BASE_NOW - 60_000).toISOString(),
    });

    const result = computeTick(pet, BASE_NOW);
    expect(result.sideEffects.some((e) => e.type === "pet.hungry")).toBe(true);
  });

  it("does not emit pet.hungry when already past threshold (no re-fire)", () => {
    const pet = makePet({
      accumulatedNeglectSeconds: HUNGRY_THRESHOLD_S + 1000, // already past
      lastTickAt: new Date(BASE_NOW - 60_000).toISOString(),
      lastInteractionAt: new Date(BASE_NOW - 60_000).toISOString(),
    });

    const result = computeTick(pet, BASE_NOW);
    // pet.hungry should NOT re-fire because prevAccumulated >= HUNGRY_THRESHOLD_S
    expect(result.sideEffects.some((e) => e.type === "pet.hungry")).toBe(false);
  });

  it("emits pet.sick when accumulated neglect crosses SICK_THRESHOLD_S", () => {
    const pet = makePet({
      accumulatedNeglectSeconds: SICK_THRESHOLD_S - MAX_TICK_SECONDS,
      lastTickAt: new Date(BASE_NOW - 60_000).toISOString(),
      lastInteractionAt: new Date(BASE_NOW - 60_000).toISOString(),
    });

    const result = computeTick(pet, BASE_NOW);
    expect(result.sideEffects.some((e) => e.type === "pet.sick")).toBe(true);
  });

  it("emits pet.dying when accumulated neglect crosses DYING_THRESHOLD_S", () => {
    const pet = makePet({
      accumulatedNeglectSeconds: DYING_THRESHOLD_S - MAX_TICK_SECONDS,
      lastTickAt: new Date(BASE_NOW - 60_000).toISOString(),
      lastInteractionAt: new Date(BASE_NOW - 60_000).toISOString(),
    });

    const result = computeTick(pet, BASE_NOW);
    expect(result.sideEffects.some((e) => e.type === "pet.dying")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Normal tick (no edge cases)
// ---------------------------------------------------------------------------

describe("Normal tick", () => {
  it("adds approximately MAX_TICK_SECONDS to accumulator on a normal 60s tick", () => {
    const pet = makePet({
      accumulatedNeglectSeconds: 0,
      lastTickAt: new Date(BASE_NOW - 60_000).toISOString(), // exactly 60s ago
      lastInteractionAt: new Date(BASE_NOW - 60_000).toISOString(),
    });

    const result = computeTick(pet, BASE_NOW);

    // delta = 60s → clamped to min(60, 60) = 60
    expect(result.newAccumulatedNeglectSeconds).toBe(60);
    expect(result.died).toBe(false);
    expect(result.newLastTickAt).toBe(new Date(BASE_NOW).toISOString());
  });

  it("sets newLastTickAt to current nowMs", () => {
    const pet = makePet({
      lastTickAt: new Date(BASE_NOW - 60_000).toISOString(),
    });

    const result = computeTick(pet, BASE_NOW);
    expect(result.newLastTickAt).toBe(new Date(BASE_NOW).toISOString());
  });
});

// ---------------------------------------------------------------------------
// start() — boot API with injectable time source
// ---------------------------------------------------------------------------

describe("start() boot API", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a teardown function", () => {
    vi.useFakeTimers();

    const teardown = start({
      getPets: () => [],
      applyTick: () => undefined,
    });

    expect(typeof teardown).toBe("function");
    teardown();
  });

  it("calls applyTick for each live pet on first tick", () => {
    vi.useFakeTimers();

    const pet = makePet({
      lastTickAt: new Date(Date.now() - 60_000).toISOString(),
      lastInteractionAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const calls: string[] = [];

    const teardown = start({
      getPets: () => [pet],
      applyTick: (petId) => {
        calls.push(petId);
      },
    });

    // Initial tick fires synchronously
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("pet-001");

    teardown();
  });

  it("calls applyTick again after TICK_INTERVAL_MS", () => {
    vi.useFakeTimers();

    const pet = makePet({
      lastTickAt: new Date(Date.now() - 60_000).toISOString(),
      lastInteractionAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const calls: number[] = [];
    let callCount = 0;

    const teardown = start({
      getPets: () => [{ ...pet, lastTickAt: new Date(Date.now() - 60_000).toISOString() }],
      applyTick: () => {
        callCount++;
        calls.push(callCount);
      },
    });

    // Initial tick
    expect(callCount).toBe(1);

    // Advance time by one interval
    vi.advanceTimersByTime(TICK_INTERVAL_MS);
    expect(callCount).toBe(2);

    teardown();

    // After teardown, no more ticks
    vi.advanceTimersByTime(TICK_INTERVAL_MS * 3);
    expect(callCount).toBe(2);
  });

  it("injectable nowMs time-source is used for tick computations", () => {
    // Use a controlled time source — advance it manually
    let fakeNow = BASE_NOW;

    const pet = makePet({
      accumulatedNeglectSeconds: 0,
      lastTickAt: new Date(BASE_NOW - 60_000).toISOString(),
      lastInteractionAt: new Date(BASE_NOW - 60_000).toISOString(),
    });

    const patches: Array<{ accumulatedNeglectSeconds?: number }> = [];

    // We call start with a nowMs that returns fakeNow
    // The initial tick fires immediately and uses fakeNow = BASE_NOW
    const teardown = start({
      getPets: () => [pet],
      applyTick: (_id, patch) => {
        patches.push(patch);
      },
      nowMs: () => fakeNow,
    });

    // Initial tick should have run; accumulated should be 60 (60s since lastTickAt)
    expect(patches).toHaveLength(1);
    expect(patches[0]!.accumulatedNeglectSeconds).toBe(60);

    teardown();
  });

  it("skips already-dead pets", () => {
    vi.useFakeTimers();

    const deadPet = makePet({
      diedAt: new Date().toISOString(),
    });

    const calls: string[] = [];

    const teardown = start({
      getPets: () => [deadPet],
      applyTick: (petId) => {
        calls.push(petId);
      },
    });

    // Dead pet should not trigger applyTick
    expect(calls).toHaveLength(0);

    teardown();
  });
});

// ---------------------------------------------------------------------------
// D6 — Ascendant immunity (DEC-019)
// ---------------------------------------------------------------------------

describe("computeTick — Ascendant immunity (DEC-019 D6 / DEC-020)", () => {
  const XP_L1024 = cumulativeXpForLevel(1618);
  const XP_L1023 = cumulativeXpForLevel(1617);

  // 5 simulated wall-clock days of 60s ticks at 1-minute intervals
  // = 5 * 24 * 60 = 7200 ticks
  const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
  const TICK_MS = 60_000;
  const FIVE_DAY_TICKS = FIVE_DAYS_MS / TICK_MS; // 7200

  function simulateTicks(pet: ClockPet, tickCount: number): {
    finalPet: ClockPet;
    allSideEffects: ReturnType<typeof computeTick>["sideEffects"];
    died: boolean;
  } {
    let current = { ...pet };
    const allSideEffects: ReturnType<typeof computeTick>["sideEffects"] = [];
    let died = false;

    let nowMs = new Date(pet.lastTickAt).getTime() + TICK_MS;
    for (let i = 0; i < tickCount; i++) {
      const result = computeTick(current, nowMs);
      allSideEffects.push(...result.sideEffects);
      if (result.died) died = true;
      current = {
        ...current,
        accumulatedNeglectSeconds: result.newAccumulatedNeglectSeconds,
        lastTickAt: result.newLastTickAt,
        ...(result.died ? { diedAt: result.newLastTickAt } : {}),
      };
      nowMs += TICK_MS;
    }

    return { finalPet: current, allSideEffects, died };
  }

  it("L1618 pet: 5 simulated days with no interaction → still alive, neglect stays at 0, no health events (DEC-020)", () => {
    const pet = makePet({
      xp: XP_L1024,
      accumulatedNeglectSeconds: 0,
      lastTickAt: new Date(BASE_NOW - TICK_MS).toISOString(),
      lastInteractionAt: new Date(BASE_NOW - TICK_MS).toISOString(),
    });

    const { finalPet, allSideEffects, died } = simulateTicks(pet, FIVE_DAY_TICKS);

    expect(died).toBe(false);
    expect(finalPet.diedAt).toBeNull();
    expect(finalPet.accumulatedNeglectSeconds).toBe(0);

    const healthEventTypes = ["pet.hungry", "pet.sick", "pet.dying", "pet.died"];
    const healthEvents = allSideEffects.filter((e) =>
      healthEventTypes.includes(e.type)
    );
    expect(healthEvents).toHaveLength(0);
  });

  it("L1617 pet: 5 simulated days with no interaction → dies (regression guard — gate is exactly 1618)", () => {
    const pet = makePet({
      xp: XP_L1023,
      accumulatedNeglectSeconds: 0,
      lastTickAt: new Date(BASE_NOW - TICK_MS).toISOString(),
      lastInteractionAt: new Date(BASE_NOW - TICK_MS).toISOString(),
    });

    const { died } = simulateTicks(pet, FIVE_DAY_TICKS);

    // L1023 is NOT an Ascendant — should die after enough neglect
    expect(died).toBe(true);
  });

  it("transition: pet at L1617 with accumulated neglect gains XP to L1618 → subsequent ticks freeze accumulation", () => {
    // Build a pet at L1617 with some existing neglect but not yet dead
    const someNeglect = SICK_THRESHOLD_S; // 36h = 129600s
    const petAtL1023 = makePet({
      xp: XP_L1023,
      accumulatedNeglectSeconds: someNeglect,
      lastTickAt: new Date(BASE_NOW - TICK_MS).toISOString(),
      lastInteractionAt: new Date(BASE_NOW - 2 * TICK_MS).toISOString(),
    });

    // Single tick at L1617: accumulation advances
    const resultBefore = computeTick(petAtL1023, BASE_NOW);
    expect(resultBefore.newAccumulatedNeglectSeconds).toBeGreaterThan(someNeglect);

    // Now promote to L1618 (add just enough XP to cross the threshold)
    const petAtL1024 = {
      ...petAtL1023,
      xp: XP_L1024,
      accumulatedNeglectSeconds: resultBefore.newAccumulatedNeglectSeconds,
      lastTickAt: resultBefore.newLastTickAt,
    };

    // Subsequent ticks should freeze accumulation — no new neglect added
    const snapshotNeglect = petAtL1024.accumulatedNeglectSeconds;
    let current = { ...petAtL1024 };
    let nowMs = BASE_NOW + TICK_MS;

    for (let i = 0; i < 100; i++) {
      const result = computeTick(current, nowMs);
      expect(result.newAccumulatedNeglectSeconds).toBe(snapshotNeglect);
      expect(result.sideEffects).toHaveLength(0);
      current = {
        ...current,
        accumulatedNeglectSeconds: result.newAccumulatedNeglectSeconds,
        lastTickAt: result.newLastTickAt,
      };
      nowMs += TICK_MS;
    }
  });
});
