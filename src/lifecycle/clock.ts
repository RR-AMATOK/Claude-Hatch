/**
 * LifecycleClock — Module #16 (architecture §2.2)
 *
 * Drives the 60-second neglect/death lifecycle per DEC-009 (hybrid threshold).
 *
 * ## Death rule (DEC-009 hybrid)
 * A pet dies on WHICHEVER comes first:
 *   A) accumulatedNeglectSeconds >= 3 * 86400  (3 accumulated-neglect-days)
 *   B) now - adjustedLastInteractionAt >= 14 * 86400_000 ms (14 wall-clock days)
 *
 * "adjustedLastInteractionAt" = lastInteractionAt + Σ pause-interval durations.
 * This means pause extends the wall-clock ceiling by the total paused duration.
 *
 * ## Tick algorithm
 * Every 60 seconds, for each living non-paused pet:
 *   1. delta = now - lastTickAt (ms)
 *   2. accumulate min(60, delta / 1000) seconds — CLAMP guards clock jumps,
 *      laptop suspend, DST. Also clamp to 0 if delta is negative (clock backward).
 *   3. Update lastTickAt = now.
 *   4. Check health thresholds; emit events if thresholds crossed.
 *   5. Check death thresholds; emit pet:died once and mark pet dead if crossed.
 *
 * ## Health thresholds (tunable)
 *   HUNGRY_THRESHOLD_S  = 12 * 3600  (12h neglect)
 *   SICK_THRESHOLD_S    = 36 * 3600  (36h neglect)
 *   DYING_THRESHOLD_S   = 60 * 3600  (60h neglect ≡ 2.5 days)
 *   WALL_DYING_MS       = 10 * 86400_000 ms (10 wall-clock days → dying warning)
 *
 * These are below the death thresholds so users get advance warnings.
 *
 * ## Pause semantics
 * When a pet has an open PauseInterval (resumedAt === null):
 *   - accumulatedNeglectSeconds is NOT incremented.
 *   - Wall-clock ceiling is extended by the pause duration.
 *
 * ## Interaction reset
 * Any interaction (feed/pet/play) sets accumulatedNeglectSeconds = 0 and
 * updates lastInteractionAt. The clock reads these from state on each tick.
 *
 * ## Time-source injection
 * The clock accepts a `nowMs?: () => number` injectable time-source so tests
 * can control time without vi.useFakeTimers, keeping tests synchronous.
 *
 * @see DEC-009 (hybrid death threshold)
 * @see architecture §7 (lifecycle clock invariants)
 */

import type { Pet, PauseInterval } from "../state/schema.js";
import type { GlyphlingEvent } from "../events/bus.js";
import { ulid } from "ulid";
import { isAscendant } from "./ascendant.js";

// ---------------------------------------------------------------------------
// Constants (DEC-009)
// ---------------------------------------------------------------------------

/** Tick interval in milliseconds. */
export const TICK_INTERVAL_MS = 60_000;

/** Max seconds to add per tick — clamps against clock jumps / suspend. */
export const MAX_TICK_SECONDS = 60;

/** Accumulated neglect threshold for death: 3 days in seconds (DEC-009 axis A). */
export const NEGLECT_DEATH_SECONDS = 3 * 24 * 60 * 60; // 259_200

/** Wall-clock guardrail for death: 14 days in ms (DEC-009 axis B). */
export const WALL_CLOCK_DEATH_MS = 14 * 24 * 60 * 60 * 1000; // 1_209_600_000

// Health warning thresholds (chosen to give users advance notice)
/** pet:hungry fires after 12 h accumulated neglect. */
export const HUNGRY_THRESHOLD_S = 12 * 3600;   // 43_200

/** pet:sick fires after 36 h accumulated neglect. */
export const SICK_THRESHOLD_S = 36 * 3600;     // 129_600

/** pet:dying fires after 60 h accumulated neglect OR 10 wall-clock days. */
export const DYING_THRESHOLD_S = 60 * 3600;    // 216_000
export const DYING_WALL_MS = 10 * 24 * 60 * 60 * 1000; // 864_000_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal pet fields the clock reads from state on each tick. */
export interface ClockPet {
  id: string;
  /** Cumulative XP — used by isAscendant() to determine L1024 immunity (D6). */
  xp: number;
  diedAt: string | null;
  accumulatedNeglectSeconds: number;
  lastTickAt: string;
  lastInteractionAt: string;
  pauseIntervals: PauseInterval[];
}

/** Callback for the clock to apply tick results back to state. */
export type TickCallback = (
  petId: string,
  patch: Partial<Pick<Pet, "accumulatedNeglectSeconds" | "lastTickAt" | "diedAt" | "tombstone">>,
  sideEffects: GlyphlingEvent[]
) => void;

/** Context passed to start(). */
export interface ClockContext {
  /**
   * Returns the list of currently-alive pets to tick.
   * Called on each tick; should be fast (synchronous read from in-memory state).
   */
  getPets: () => ClockPet[];

  /**
   * Apply a tick result: update pet fields + dispatch side-effect events.
   * May be async (e.g. write to disk via StateStore.dispatch), but the clock
   * does not await it — fire-and-forget to keep ticks non-blocking.
   */
  applyTick: TickCallback;

  /**
   * Injectable time source (ms since epoch). Defaults to Date.now.
   * Tests inject a controlled value here.
   */
  nowMs?: () => number;
}

// ---------------------------------------------------------------------------
// Pure tick logic (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Compute the total pause duration (in ms) for a pet's pauseIntervals up to `nowMs`.
 * Open intervals (resumedAt === null) contribute (nowMs - pausedAt) to the ceiling
 * extension — but NOT to the accumulator increment (accumulator is frozen).
 *
 * For the wall-clock ceiling calculation we only count CLOSED intervals
 * (resumedAt !== null), because the open interval is still ticking on the
 * wall-clock side (the pet is currently paused; wall clock doesn't advance
 * against the user during a pause).
 */
export function closedPauseDurationMs(intervals: PauseInterval[]): number {
  let total = 0;
  for (const interval of intervals) {
    if (interval.resumedAt !== null) {
      const start = new Date(interval.pausedAt).getTime();
      const end = new Date(interval.resumedAt).getTime();
      if (end > start) total += end - start;
    }
  }
  return total;
}

/**
 * Check whether the pet is currently paused (last pauseInterval has resumedAt === null).
 */
export function isPaused(intervals: PauseInterval[]): boolean {
  if (intervals.length === 0) return false;
  return intervals[intervals.length - 1]!.resumedAt === null;
}

/**
 * Result of a single tick computation for one pet.
 */
export interface TickResult {
  /** Updated accumulatedNeglectSeconds (or unchanged if paused/dead). */
  newAccumulatedNeglectSeconds: number;
  /** New lastTickAt ISO8601. */
  newLastTickAt: string;
  /** Side-effect events to emit (health warnings, death). */
  sideEffects: GlyphlingEvent[];
  /** True if the pet died this tick. */
  died: boolean;
}

/**
 * Pure tick computation for a single pet.
 *
 * @param pet     Current pet state.
 * @param nowMs   Current time in milliseconds.
 * @returns TickResult — all mutations expressed as data, no I/O.
 */
export function computeTick(pet: ClockPet, nowMs: number): TickResult {
  const now = new Date(nowMs).toISOString();
  const sideEffects: GlyphlingEvent[] = [];

  // Dead pets are never ticked.
  if (pet.diedAt !== null) {
    return {
      newAccumulatedNeglectSeconds: pet.accumulatedNeglectSeconds,
      newLastTickAt: pet.lastTickAt,
      sideEffects: [],
      died: false,
    };
  }

  // Ascendants (L1024) are immune to sickness and death (DEC-019 D6).
  // The clock still fires so lastTickAt stays fresh, but it does not
  // accumulate neglect and emits no health/death events.
  if (isAscendant(pet)) {
    return {
      newAccumulatedNeglectSeconds: pet.accumulatedNeglectSeconds,
      newLastTickAt: now,
      sideEffects: [],
      died: false,
    };
  }

  const lastTickMs = new Date(pet.lastTickAt).getTime();
  const lastInteractionMs = new Date(pet.lastInteractionAt).getTime();

  // Delta in seconds since last tick.
  const rawDeltaMs = nowMs - lastTickMs;
  const rawDeltaSeconds = rawDeltaMs / 1000;

  // Clamp: guard against clock jumps (forward), laptop suspend, and backward clocks.
  // max(0, ...) handles backward clocks; min(MAX_TICK_SECONDS, ...) handles forward jumps.
  const clampedDeltaSeconds = Math.max(
    0,
    Math.min(MAX_TICK_SECONDS, rawDeltaSeconds)
  );

  const paused = isPaused(pet.pauseIntervals);

  // Accumulator only advances when the pet is not paused.
  const prevAccumulated = pet.accumulatedNeglectSeconds;
  const newAccumulated = paused
    ? prevAccumulated
    : prevAccumulated + clampedDeltaSeconds;

  // -------------------------------------------------------------------------
  // Wall-clock elapsed, adjusted for pause intervals (DEC-009 axis B).
  //
  // For the wall-clock ceiling we subtract:
  //   (a) all closed pause intervals' durations, AND
  //   (b) the duration of any currently-open pause interval (pet is paused now)
  //
  // This means both pause axes are protected: accumulator is frozen AND the
  // wall-clock ceiling is extended by the full pause duration.
  // -------------------------------------------------------------------------
  const closedPausedMs = closedPauseDurationMs(pet.pauseIntervals);
  let openPausedMs = 0;
  if (paused) {
    const lastInterval = pet.pauseIntervals[pet.pauseIntervals.length - 1];
    if (lastInterval) {
      openPausedMs = nowMs - new Date(lastInterval.pausedAt).getTime();
      if (openPausedMs < 0) openPausedMs = 0;
    }
  }
  const totalPausedMs = closedPausedMs + openPausedMs;
  const wallClockElapsedMs = Math.max(0, nowMs - lastInteractionMs - totalPausedMs);

  // -------------------------------------------------------------------------
  // Health warning events.
  // Each event fires exactly once: only when the threshold is FIRST crossed
  // (prevAccumulated was strictly below, newAccumulated is at/above).
  // -------------------------------------------------------------------------
  if (prevAccumulated < HUNGRY_THRESHOLD_S && newAccumulated >= HUNGRY_THRESHOLD_S) {
    sideEffects.push(makeLifecycleEvent("pet.hungry", pet.id, now));
  }
  if (prevAccumulated < SICK_THRESHOLD_S && newAccumulated >= SICK_THRESHOLD_S) {
    sideEffects.push(makeLifecycleEvent("pet.sick", pet.id, now));
  }
  if (prevAccumulated < DYING_THRESHOLD_S && newAccumulated >= DYING_THRESHOLD_S) {
    sideEffects.push(makeLifecycleEvent("pet.dying", pet.id, now));
  }

  // -------------------------------------------------------------------------
  // Death check: whichever threshold comes first (DEC-009 hybrid).
  // Emits pet:died exactly once. Emits pet:dying first if not already emitted.
  // -------------------------------------------------------------------------
  const accumulatedDeath = newAccumulated >= NEGLECT_DEATH_SECONDS;
  const wallClockDeath = wallClockElapsedMs >= WALL_CLOCK_DEATH_MS;
  const died = accumulatedDeath || wallClockDeath;

  if (died) {
    // Ensure pet:dying fires before pet:died (de-duplicate in case we crossed
    // both DYING_THRESHOLD_S and NEGLECT_DEATH_SECONDS in the same tick).
    if (!sideEffects.some((e) => e.type === "pet.dying")) {
      sideEffects.push(makeLifecycleEvent("pet.dying", pet.id, now));
    }
    // pet:died fires exactly once regardless of how many thresholds were crossed.
    sideEffects.push({
      id: ulid(),
      type: "pet.died",
      ts: now,
      petId: pet.id,
      source: "lifecycle-clock",
      payload: {
        cause: "neglect",
        accumulatedNeglectSeconds: newAccumulated,
        wallClockElapsedMs,
        accumulatedDeath,
        wallClockDeath,
      },
    });
  }

  return {
    newAccumulatedNeglectSeconds: newAccumulated,
    newLastTickAt: now,
    sideEffects,
    died,
  };
}

// ---------------------------------------------------------------------------
// start — boot the lifecycle clock
// ---------------------------------------------------------------------------

/**
 * Start the 60-second lifecycle clock. Returns a stop/teardown function.
 *
 * On each tick:
 *  1. Calls ctx.getPets() to get the current live pet list.
 *  2. For each alive pet, calls computeTick() to compute the next state.
 *  3. Calls ctx.applyTick() with the patch + side effects.
 *
 * The clock fires once immediately on start (synchronous, before the interval),
 * then every TICK_INTERVAL_MS thereafter.
 *
 * @param ctx   Clock context: getPets, applyTick, optional nowMs time-source.
 * @returns     A teardown function that clears the interval.
 */
export function start(ctx: ClockContext): () => void {
  const now = ctx.nowMs ?? (() => Date.now());

  function tick(): void {
    const nowMs = now();
    const pets = ctx.getPets();

    for (const pet of pets) {
      if (pet.diedAt !== null) continue;

      const result = computeTick(pet, nowMs);

      const patch: Partial<
        Pick<Pet, "accumulatedNeglectSeconds" | "lastTickAt" | "diedAt" | "tombstone">
      > = {
        accumulatedNeglectSeconds: result.newAccumulatedNeglectSeconds,
        lastTickAt: result.newLastTickAt,
      };

      if (result.died) {
        patch.diedAt = result.newLastTickAt;
        patch.tombstone = {
          diedAt: result.newLastTickAt,
          cause: "neglect",
          finalLevel: 0, // caller fills in from actual pet state
          finalXp: 0,    // caller fills in from actual pet state
        };
      }

      ctx.applyTick(pet.id, patch, result.sideEffects);
    }
  }

  // Initial tick fires synchronously on start
  tick();

  const intervalId = setInterval(tick, TICK_INTERVAL_MS);

  return () => {
    clearInterval(intervalId);
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makeLifecycleEvent(
  type: "pet.hungry" | "pet.sick" | "pet.dying" | "pet.died",
  petId: string,
  ts: string
): GlyphlingEvent {
  return {
    id: ulid(),
    type,
    ts,
    petId,
    source: "lifecycle-clock",
    payload: {},
  };
}
