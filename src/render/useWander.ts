/**
 * useWander — horizontal pet drift for the expanded Ink TUI (TODO-045 Phase 1)
 *
 * The pet drifts left and right inside a fixed-width arena. Position is
 * per-render-session only — never persisted, never on disk, never on the
 * Pet schema.
 *
 * Motion is gated by the ambient-scene predicate from animation.ts: when the
 * active scene is a one-shot (eat, play, levelup, hatch, evolve) the interval
 * is frozen and the pet holds position. Wander resumes when the scene returns
 * to an ambient looping state.
 *
 * Edge bounce uses a 1-tick pause: when x would cross the boundary, x is
 * clamped and pausedAtEdge is set. On the next tick the flag is cleared and
 * facing flips. Movement resumes the tick after that.
 *
 * Reduced-motion opt-in: if NO_MOTION=1 or GLYPHLING_REDUCED_MOTION=1 is set
 * at mount time, the hook returns a static position and never starts an
 * interval.
 *
 * DEC-015: does NOT piggyback on useFrame.
 * DEC-016: compact path (statusline.ts) is not touched.
 */

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Total visible columns for the wander arena. */
export const ARENA_COLS = 40;

/** Milliseconds between each wander step. */
export const STEP_INTERVAL_MS = 500;

/**
 * Approximate visible width of the expanded pet frame (20 cols per Frame spec).
 * x is clamped to [0, arenaCols - PET_WIDTH] so the pet never overflows the
 * right edge.
 */
const PET_WIDTH = 20;

// ---------------------------------------------------------------------------
// WanderState — pure, no env reads
// ---------------------------------------------------------------------------

export interface WanderState {
  /** Current left-edge column offset (integer, 0-based). */
  x: number;
  /** Direction of travel: +1 = rightward, -1 = leftward. */
  facing: -1 | 1;
  /**
   * When true, the pet just hit an edge on the previous tick and is pausing
   * for one tick before reversing direction. Movement is suppressed this tick.
   */
  pausedAtEdge: boolean;
}

// ---------------------------------------------------------------------------
// stepWander — pure reducer
// ---------------------------------------------------------------------------

/**
 * Advances the wander state by one logical step.
 *
 * Edge-bounce with 1-tick pause:
 *   tick N  : x would cross boundary → clamp x, set pausedAtEdge=true, DO NOT flip.
 *   tick N+1: clear pausedAtEdge, flip facing, DO NOT move x.
 *   tick N+2: move x normally.
 *
 * @param state  Current WanderState.
 * @param dt     Elapsed ms since last step (unused for motion magnitude — kept
 *               as a parameter for future sub-cell extension; pass STEP_INTERVAL_MS).
 * @returns      Next WanderState (new object unless paused early-return).
 */
export function stepWander(state: WanderState, dt: number): WanderState {
  // dt is reserved for future sub-cell motion; suppress unused-var lint noise.
  void dt;

  const maxX = ARENA_COLS - PET_WIDTH;

  // If paused at edge from the previous tick: clear flag, flip facing, stay put.
  if (state.pausedAtEdge) {
    return {
      x: state.x,
      facing: state.facing === 1 ? -1 : 1,
      pausedAtEdge: false,
    };
  }

  const nextX = state.x + state.facing;

  // Would cross left edge
  if (nextX < 0) {
    return { x: 0, facing: state.facing, pausedAtEdge: true };
  }

  // Would cross right edge
  if (nextX > maxX) {
    return { x: maxX, facing: state.facing, pausedAtEdge: true };
  }

  // Normal move
  return { x: nextX, facing: state.facing, pausedAtEdge: false };
}

// ---------------------------------------------------------------------------
// UseWanderOpts
// ---------------------------------------------------------------------------

export interface UseWanderOpts {
  /**
   * When true the wander interval is effectively frozen: the interval still
   * runs but stepWander is not called, preserving the current x and facing.
   */
  paused: boolean;
  /** Arena width in columns. Defaults to ARENA_COLS when not provided. */
  arenaCols: number;
}

// ---------------------------------------------------------------------------
// useWander — React hook
// ---------------------------------------------------------------------------

/**
 * Returns the current horizontal wander offset and facing direction.
 *
 * Drives its OWN setInterval at STEP_INTERVAL_MS — does NOT piggyback on
 * useFrame (DEC-015 rule 1 applies: useFrame is untouched).
 *
 * Reads NO_MOTION and GLYPHLING_REDUCED_MOTION ONCE on mount. If either is
 * '1', returns { x: 0, facing: 1 } and never starts an interval.
 *
 * @param opts.paused     Freeze wander when the active scene is non-ambient.
 * @param opts.arenaCols  Width of the arena in columns.
 */
export function useWander(opts: UseWanderOpts): { x: number; facing: -1 | 1 } {
  const { paused, arenaCols } = opts;

  // Read env flags once at mount time (captured in the closure below).
  // useRef would also work, but a module-level check per hook call is fine
  // since process.env is static after startup in Node.
  const [wanderState, setWanderState] = useState<WanderState>(() => ({
    x: 0,
    facing: 1,
    pausedAtEdge: false,
  }));

  useEffect(() => {
    // Reduced-motion / no-motion guards — read once on mount.
    const noMotion =
      process.env["NO_MOTION"] === "1" ||
      process.env["GLYPHLING_REDUCED_MOTION"] === "1";

    if (noMotion) {
      // Static position; no interval started.
      return;
    }

    const id = setInterval(() => {
      if (paused) {
        // Hold current state reference — no state update, no rerender.
        return;
      }
      setWanderState((prev) => {
        const next = stepWander(prev, STEP_INTERVAL_MS);
        // Clamp x to the current arenaCols in case it changed (unlikely but safe).
        const maxX = Math.max(0, arenaCols - PET_WIDTH);
        const clampedX = Math.min(next.x, maxX);
        if (next.x === clampedX && next === prev) return prev; // cheap memo
        return clampedX === next.x ? next : { ...next, x: clampedX };
      });
    }, STEP_INTERVAL_MS);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, arenaCols]);

  return { x: wanderState.x, facing: wanderState.facing };
}
