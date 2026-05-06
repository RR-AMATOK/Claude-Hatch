/**
 * Tests for src/render/useWander.ts — TODO-045 Phase 1
 *
 * Covers:
 *   - stepWander: initial rightward step
 *   - stepWander: continues rightward through the middle of the arena
 *   - stepWander: right-edge clamp and pausedAtEdge flag
 *   - stepWander: tick after right-edge pause flips facing without moving
 *   - stepWander: subsequent tick moves leftward after flip
 *   - stepWander: left-edge clamp and pausedAtEdge flag
 *   - stepWander: tick after left-edge pause flips to +1
 *   - stepWander: x is always a finite integer in [0, maxX] across 25 steps
 *   - stepWander: full bounce loop covers [0, maxX] and changes direction at both edges
 *   - stepWander: does not mutate input state (pure reducer)
 *
 * SKIP: useWander hook tests (env-flag gating, interval behavior)
 *   Reason: the hook drives a setInterval and calls React's useState/useEffect.
 *   Exercising it correctly requires either react-test-renderer (not installed)
 *   or @testing-library/react (prohibited by task rules and not a project dep).
 *   The pure stepWander reducer covers all branching logic that matters for
 *   correctness. Hook-level env-flag tests should be added in a follow-up PR
 *   once a minimal React test harness is agreed on.
 */

import { describe, it, expect } from "vitest";
import { stepWander, ARENA_COLS, STEP_INTERVAL_MS } from "./useWander.js";
import type { WanderState } from "./useWander.js";

// ---------------------------------------------------------------------------
// Derived constants (mirrors the unexported PET_WIDTH=20 in useWander.ts)
// ---------------------------------------------------------------------------

/** Mirrors the unexported PET_WIDTH constant: ARENA_COLS - PET_WIDTH = 40 - 20. */
const MAX_X = ARENA_COLS - 20; // 20

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convenience wrapper: calls stepWander with the canonical dt. */
function step(state: WanderState): WanderState {
  return stepWander(state, STEP_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// stepWander — basic motion
// ---------------------------------------------------------------------------

describe("stepWander — basic motion", () => {
  it("initial step rightward: x:0 facing:+1 → x:1 facing:+1 not paused", () => {
    const input: WanderState = { x: 0, facing: 1, pausedAtEdge: false };
    const output = step(input);
    expect(output).toEqual({ x: 1, facing: 1, pausedAtEdge: false });
  });

  it("continues rightward through the middle: x:5 facing:+1 → x:6 facing:+1 not paused", () => {
    const input: WanderState = { x: 5, facing: 1, pausedAtEdge: false };
    const output = step(input);
    expect(output).toEqual({ x: 6, facing: 1, pausedAtEdge: false });
  });

  it("moves leftward from a mid-arena position: x:15 facing:-1 → x:14 facing:-1 not paused", () => {
    const input: WanderState = { x: 15, facing: -1, pausedAtEdge: false };
    const output = step(input);
    expect(output).toEqual({ x: 14, facing: -1, pausedAtEdge: false });
  });
});

// ---------------------------------------------------------------------------
// stepWander — right-edge bounce (3-tick sequence)
// ---------------------------------------------------------------------------

describe("stepWander — right-edge bounce", () => {
  it("clamps x at the right edge and sets pausedAtEdge when facing:+1 at maxX", () => {
    // From maxX, nextX = maxX + 1 which exceeds maxX → clamp and pause.
    const input: WanderState = { x: MAX_X, facing: 1, pausedAtEdge: false };
    const output = step(input);
    expect(output).toEqual({ x: MAX_X, facing: 1, pausedAtEdge: true });
  });

  it("tick after right-edge pause flips facing to -1 without moving x", () => {
    const input: WanderState = { x: MAX_X, facing: 1, pausedAtEdge: true };
    const output = step(input);
    expect(output).toEqual({ x: MAX_X, facing: -1, pausedAtEdge: false });
  });

  it("subsequent tick after right-edge flip moves x leftward", () => {
    const input: WanderState = { x: MAX_X, facing: -1, pausedAtEdge: false };
    const output = step(input);
    expect(output).toEqual({ x: MAX_X - 1, facing: -1, pausedAtEdge: false });
  });
});

// ---------------------------------------------------------------------------
// stepWander — left-edge bounce (3-tick sequence)
// ---------------------------------------------------------------------------

describe("stepWander — left-edge bounce", () => {
  it("clamps x at the left edge and sets pausedAtEdge when facing:-1 at x:0", () => {
    // From x=0, nextX = -1 which is < 0 → clamp and pause.
    const input: WanderState = { x: 0, facing: -1, pausedAtEdge: false };
    const output = step(input);
    expect(output).toEqual({ x: 0, facing: -1, pausedAtEdge: true });
  });

  it("tick after left-edge pause flips facing to +1 without moving x", () => {
    const input: WanderState = { x: 0, facing: -1, pausedAtEdge: true };
    const output = step(input);
    expect(output).toEqual({ x: 0, facing: 1, pausedAtEdge: false });
  });

  it("subsequent tick after left-edge flip moves x rightward", () => {
    const input: WanderState = { x: 0, facing: 1, pausedAtEdge: false };
    const output = step(input);
    expect(output).toEqual({ x: 1, facing: 1, pausedAtEdge: false });
  });
});

// ---------------------------------------------------------------------------
// stepWander — invariants over a sweep of steps
// ---------------------------------------------------------------------------

describe("stepWander — integer x invariant over 25 steps", () => {
  it("x is always a finite integer in [0, maxX] across 25 successive steps", () => {
    let state: WanderState = { x: 0, facing: 1, pausedAtEdge: false };
    for (let i = 0; i < 25; i++) {
      state = step(state);
      expect(Number.isInteger(state.x)).toBe(true);
      expect(Number.isFinite(state.x)).toBe(true);
      expect(state.x).toBeGreaterThanOrEqual(0);
      expect(state.x).toBeLessThanOrEqual(MAX_X);
    }
  });
});

// ---------------------------------------------------------------------------
// stepWander — full bounce loop
// ---------------------------------------------------------------------------

describe("stepWander — full bounce loop covers both edges", () => {
  it("runs ~50 ticks, bounces left↔right at least twice, and x covers [0, maxX]", () => {
    let state: WanderState = { x: 0, facing: 1, pausedAtEdge: false };

    const visitedX = new Set<number>();
    // Track direction-changes at the edges.
    // A direction change is detected when, after a pause-clear tick,
    // we see facing flip from +1 → -1 at MAX_X, or -1 → +1 at 0.
    const bounceEvents: Array<{ x: number; from: -1 | 1; to: -1 | 1 }> = [];
    let prevState = state;

    for (let tick = 0; tick < 50; tick++) {
      state = step(prevState);
      visitedX.add(state.x);

      // Detect a completed bounce: pausedAtEdge just cleared and facing changed.
      if (
        prevState.pausedAtEdge &&
        !state.pausedAtEdge &&
        state.facing !== prevState.facing
      ) {
        bounceEvents.push({
          x: state.x,
          from: prevState.facing,
          to: state.facing,
        });
      }

      prevState = state;
    }

    // Must have bounced at least twice (once at each wall).
    expect(bounceEvents.length).toBeGreaterThanOrEqual(2);

    // Must have visited both x=0 and x=MAX_X.
    expect(visitedX.has(0)).toBe(true);
    expect(visitedX.has(MAX_X)).toBe(true);

    // Right-edge bounce: from +1 → -1 at x = MAX_X.
    const rightBounce = bounceEvents.find((b) => b.x === MAX_X && b.from === 1 && b.to === -1);
    expect(rightBounce).toBeDefined();

    // Left-edge bounce: from -1 → +1 at x = 0.
    const leftBounce = bounceEvents.find((b) => b.x === 0 && b.from === -1 && b.to === 1);
    expect(leftBounce).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// stepWander — purity (no mutation)
// ---------------------------------------------------------------------------

describe("stepWander — purity", () => {
  it("does not mutate the input state object", () => {
    const input: WanderState = Object.freeze({ x: 10, facing: 1, pausedAtEdge: false });
    // If stepWander mutates input, Object.freeze will throw in strict mode.
    // We also verify reference inequality as a belt-and-suspenders check.
    const output = step(input);
    expect(output).not.toBe(input);
    // Original values are unchanged (freeze would have already thrown, but verify anyway).
    expect(input.x).toBe(10);
    expect(input.facing).toBe(1);
    expect(input.pausedAtEdge).toBe(false);
  });

  it("does not mutate the input state when pausedAtEdge is true (flip branch)", () => {
    const input: WanderState = Object.freeze({ x: MAX_X, facing: 1, pausedAtEdge: true });
    const output = step(input);
    expect(output).not.toBe(input);
    expect(input.facing).toBe(1);
    expect(input.pausedAtEdge).toBe(true);
  });

  it("does not mutate the input state when hitting the left edge", () => {
    const input: WanderState = Object.freeze({ x: 0, facing: -1, pausedAtEdge: false });
    const output = step(input);
    expect(output).not.toBe(input);
    expect(input.x).toBe(0);
    expect(input.facing).toBe(-1);
    expect(input.pausedAtEdge).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stepWander — edge-case: already-paused state is never double-paused
// ---------------------------------------------------------------------------

describe("stepWander — pausedAtEdge invariant", () => {
  it("a paused state always yields pausedAtEdge:false on the next tick", () => {
    const rightPaused: WanderState = { x: MAX_X, facing: 1, pausedAtEdge: true };
    expect(step(rightPaused).pausedAtEdge).toBe(false);

    const leftPaused: WanderState = { x: 0, facing: -1, pausedAtEdge: true };
    expect(step(leftPaused).pausedAtEdge).toBe(false);
  });

  it("facing after pause-clear tick is always the opposite of the paused facing", () => {
    const rightPaused: WanderState = { x: MAX_X, facing: 1, pausedAtEdge: true };
    expect(step(rightPaused).facing).toBe(-1);

    const leftPaused: WanderState = { x: 0, facing: -1, pausedAtEdge: true };
    expect(step(leftPaused).facing).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// stepWander — ARENA_COLS and STEP_INTERVAL_MS are exported constants
// ---------------------------------------------------------------------------

describe("exported constants", () => {
  it("ARENA_COLS is 40", () => {
    expect(ARENA_COLS).toBe(40);
  });

  it("STEP_INTERVAL_MS is a positive integer", () => {
    expect(STEP_INTERVAL_MS).toBeGreaterThan(0);
    expect(Number.isInteger(STEP_INTERVAL_MS)).toBe(true);
  });

  it("MAX_X (ARENA_COLS - PET_WIDTH) is 20", () => {
    // ARENA_COLS=40, PET_WIDTH=20 (per module docstring and Frame spec).
    expect(MAX_X).toBe(20);
  });
});
