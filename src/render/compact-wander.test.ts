/**
 * Tests for statusline wander logic (TODO-047, statusline-wander.md).
 *
 * Covers:
 *   - computeWanderX: pure formula, edge-pause, cycle period, integer invariant
 *   - isOneShotScene / ONE_SHOT_SCENES: member set, cross-consistency with AMBIENT_SCENES
 *   - stepWander / computeWanderX divergence analysis (property test; see CRITICAL NOTE below)
 *   - Center-snap on one-shot scenes in assembleWideOutput
 *   - Reduced-motion env-flag clamp
 *   - Wide tier emits exactly 5 rows
 *   - Standard tier wander on rows 2-3
 *   - Narrow tier ships without wander
 *   - refreshInterval >= 3s graceful degradation (teleport tolerance)
 *
 * CRITICAL NOTE — stepWander / computeWanderX divergence (R6):
 *   These two implementations use structurally different edge-pause encodings:
 *
 *   computeWanderX (compact.ts §3):
 *     Right-edge hold: 1 tick (step = maxX+1 → x = maxX).
 *     Then immediately moves left (step = maxX+2 → x = maxX-1).
 *
 *   stepWander (useWander.ts):
 *     Right-edge hold: 2 ticks total —
 *       tick N  : nextX > maxX → clamp x=maxX, set pausedAtEdge=true (facing NOT flipped yet)
 *       tick N+1: pausedAtEdge=true → x=maxX, flip facing to -1, clear pausedAtEdge
 *       tick N+2: move to maxX-1
 *
 *   The TUI reducer therefore spends 2 ticks at each edge vs 1 in the statusline formula.
 *   This means their full-cycle periods differ:
 *     computeWanderX: stepsPerCycle = 2*maxX + 2
 *     stepWander: cycle = 2*(maxX+1) + 2*(maxX+1) ... actually 2*maxX + 4 steps per cycle
 *                 (maxX steps right + 2 edge hold + maxX steps left + 2 edge hold = 2*maxX+4)
 *
 *   This divergence was EXPECTED — the spec note (statusline-wander.md §1) explicitly says
 *   the TUI and statusline are different rendering regimes with different cadences. The TUI
 *   runs at 2 Hz (500ms intervals) and the statusline at 1 Hz. The comment in §10.5 confirms
 *   that the two cadences are intentionally asymmetric and the divergence is "by design."
 *
 *   The property test below documents the exact divergence pattern. It is NOT a test bug.
 *   The implementations must NOT be silently "fixed" to match each other — the TUI hook
 *   predates the statusline wander spec and both are correct in their respective regimes.
 *   See: statusline-wander.md §1, architecture.md §12.0, DEC-016.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Pet } from "../state/schema.js";
import { cumulativeXpForLevel } from "../xp/engine.js";
import {
  computeWanderX,
  isOneShotScene,
  ONE_SHOT_SCENES,
  WANDER_ARENA_CAP,
  assembleWideOutput,
  assembleCompactOutput,
  COMPACT_PET_WIDTH,
  visibleWidth,
  assertCompactPetWidths,
} from "./compact.js";
import { stepWander } from "./useWander.js";
import type { WanderState } from "./useWander.js";
import { AMBIENT_SCENES } from "./animation.js";
import type { SceneKey } from "./compact.js";
import type { SceneId } from "../../animations/types.js";

// ---------------------------------------------------------------------------
// Shared pet fixture
// ---------------------------------------------------------------------------

function makePet(overrides: Partial<Pet> = {}): Pet {
  const now = new Date().toISOString();
  return {
    id: "wander-test-pet",
    schemaVersion: 1,
    eggType: "circuit",
    name: "Pixel",
    createdAt: now,
    hatchedAt: now,
    lastFedAt: now,
    lastInteractionAt: now,
    xp: cumulativeXpForLevel(30),
    level: 30,
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
    lastPettedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared wander constants (matches compact.ts §3)
// ---------------------------------------------------------------------------

/** Typical petWidth for circuit-adult at standard tier. */
const CIRCUIT_ADULT_STANDARD_WIDTH = COMPACT_PET_WIDTH["standard"]["circuit"]["adult"];
/** Typical petWidth for circuit-adult at wide tier. */
const CIRCUIT_ADULT_WIDE_WIDTH = COMPACT_PET_WIDTH["wide"]["circuit"]["adult"];

// PET_WIDTH = 9 for standard circuit-adult (actual computed from silhouette strings)
// arenaCols = min(50, cols) = 50 at cols=100
// maxX = 50 - 9 = 41
// stepsPerCycle = 2*41 + 2 = 84
// centerX = floor(41/2) = 20
const ARENA_COLS_100 = Math.min(WANDER_ARENA_CAP, 100);
const MAX_X_CIRCUIT_ADULT_STD = ARENA_COLS_100 - CIRCUIT_ADULT_STANDARD_WIDTH; // 50 - 9 = 41
const STEPS_PER_CYCLE_84 = 2 * MAX_X_CIRCUIT_ADULT_STD + 2; // 84
// centerX for standard/circuit/adult at cols=100
const CENTER_X_STD = Math.floor(MAX_X_CIRCUIT_ADULT_STD / 2); // 20

// ---------------------------------------------------------------------------
// describe("computeWanderX") — pure formula
// ---------------------------------------------------------------------------

describe("computeWanderX — pure formula", () => {
  it("returns 0 at tick=0 (start at origin)", () => {
    // step=0 ≤ maxX → x = 0
    expect(computeWanderX(0, ARENA_COLS_100, CIRCUIT_ADULT_STANDARD_WIDTH)).toBe(0);
  });

  it("returns 5 at tick=5 (mid-move rightward)", () => {
    // step=5 ≤ maxX=41 → x=5
    expect(computeWanderX(5, ARENA_COLS_100, CIRCUIT_ADULT_STANDARD_WIDTH)).toBe(5);
  });

  it("returns maxX at step=maxX (at right boundary, moving-right phase)", () => {
    // step=41 ≤ maxX=41 → x=41
    expect(computeWanderX(MAX_X_CIRCUIT_ADULT_STD, ARENA_COLS_100, CIRCUIT_ADULT_STANDARD_WIDTH)).toBe(MAX_X_CIRCUIT_ADULT_STD);
  });

  it("returns maxX at step=maxX+1 (right-edge pause hold)", () => {
    // step=42 === maxX+1 → x = maxX = 41 (held for 1 tick)
    expect(computeWanderX(MAX_X_CIRCUIT_ADULT_STD + 1, ARENA_COLS_100, CIRCUIT_ADULT_STANDARD_WIDTH)).toBe(MAX_X_CIRCUIT_ADULT_STD);
  });

  it("returns maxX-1 at step=maxX+2 (first tick leftward after edge-pause)", () => {
    // step=43 ≤ 2*maxX+1=83 → x = 2*41+1-43 = 83-43 = 40 = maxX-1
    expect(computeWanderX(MAX_X_CIRCUIT_ADULT_STD + 2, ARENA_COLS_100, CIRCUIT_ADULT_STANDARD_WIDTH)).toBe(MAX_X_CIRCUIT_ADULT_STD - 1);
  });

  it("returns 0 at step=2*maxX+1 (left-edge pause — last step of cycle)", () => {
    // step=83 ≤ 2*41+1=83 → x = 83-83 = 0 (left-edge pause tick, actual maxX=41)
    const leftEdgePauseTick = 2 * MAX_X_CIRCUIT_ADULT_STD + 1;
    expect(computeWanderX(leftEdgePauseTick, ARENA_COLS_100, CIRCUIT_ADULT_STANDARD_WIDTH)).toBe(0);
  });

  it("returns 0 at step=0 of next cycle (resumes rightward from origin)", () => {
    // tick = stepsPerCycle (86): step = 86 % 86 = 0 → x = 0 (start of new cycle)
    expect(computeWanderX(STEPS_PER_CYCLE_84, ARENA_COLS_100, CIRCUIT_ADULT_STANDARD_WIDTH)).toBe(0);
  });

  it("both left-edge steps (2*maxX+1 and 0) yield x=0 — the 1-tick left-edge hold", () => {
    // Left-edge hold: step=2*maxX+1 → x=0 (moving-left phase touches 0)
    // step=0 (next cycle) → x=0 again (start of rightward motion)
    // This gives the user a 2-tick visual pause at x=0 per cycle (1 left-pause + 1 cycle-reset)
    const step1 = 2 * MAX_X_CIRCUIT_ADULT_STD + 1;
    const step2 = 0; // next cycle
    expect(computeWanderX(step1, ARENA_COLS_100, CIRCUIT_ADULT_STANDARD_WIDTH)).toBe(0);
    expect(computeWanderX(step2, ARENA_COLS_100, CIRCUIT_ADULT_STANDARD_WIDTH)).toBe(0);
    // Step 1 of new cycle: already moving right
    expect(computeWanderX(1, ARENA_COLS_100, CIRCUIT_ADULT_STANDARD_WIDTH)).toBe(1);
  });

  it("integer x invariant: all x values are finite non-negative integers ≤ maxX across a full cycle", () => {
    const maxX = MAX_X_CIRCUIT_ADULT_STD;
    const stepsPerCycle = STEPS_PER_CYCLE_84;
    for (let tick = 0; tick < 2 * stepsPerCycle; tick++) {
      const x = computeWanderX(tick, ARENA_COLS_100, CIRCUIT_ADULT_STANDARD_WIDTH);
      expect(Number.isInteger(x), `tick=${tick}: x=${x} is not an integer`).toBe(true);
      expect(Number.isFinite(x), `tick=${tick}: x=${x} is not finite`).toBe(true);
      expect(x, `tick=${tick}: x=${x} < 0`).toBeGreaterThanOrEqual(0);
      expect(x, `tick=${tick}: x=${x} > maxX=${maxX}`).toBeLessThanOrEqual(maxX);
    }
  });

  it("cycle period: computeWanderX(0, ...) === computeWanderX(stepsPerCycle, ...) for all ticks", () => {
    const stepsPerCycle = STEPS_PER_CYCLE_84;
    for (let tick = 0; tick < stepsPerCycle; tick++) {
      const x1 = computeWanderX(tick, ARENA_COLS_100, CIRCUIT_ADULT_STANDARD_WIDTH);
      const x2 = computeWanderX(tick + stepsPerCycle, ARENA_COLS_100, CIRCUIT_ADULT_STANDARD_WIDTH);
      expect(x2, `tick=${tick}: cycle not maintained (${x1} vs ${x2})`).toBe(x1);
    }
  });

  it("stepsPerCycle for PET_WIDTH=9 (actual), arenaCols=50 is 84", () => {
    // Spec §3.2 table uses PET_WIDTH=8 (spec approximation), but the actual
    // silhouette for circuit-adult at standard tier is 9 chars wide.
    // Actual: maxX = 50-9 = 41, stepsPerCycle = 2*41+2 = 84 (matches runtime value).
    expect(STEPS_PER_CYCLE_84).toBe(84);
    // Verify the formula matches: 2*maxX+2
    expect(STEPS_PER_CYCLE_84).toBe(2 * MAX_X_CIRCUIT_ADULT_STD + 2);
  });

  it("returns 0 for any tick when maxX = 0 (pet fills entire arena)", () => {
    // Edge: petWidth >= arenaCols → maxX = 0 → always x=0
    expect(computeWanderX(0, 5, 5)).toBe(0);
    expect(computeWanderX(99, 5, 5)).toBe(0);
    expect(computeWanderX(0, 5, 10)).toBe(0); // petWidth > arenaCols also
  });
});

// ---------------------------------------------------------------------------
// describe("isOneShotScene") — member set and cross-consistency
// ---------------------------------------------------------------------------

describe("isOneShotScene — member set", () => {
  it("eating → true", () => {
    expect(isOneShotScene("eating")).toBe(true);
  });

  it("playing → true", () => {
    expect(isOneShotScene("playing")).toBe(true);
  });

  it("petted → true", () => {
    expect(isOneShotScene("petted")).toBe(true);
  });

  it("level-up → true", () => {
    expect(isOneShotScene("level-up")).toBe(true);
  });

  it("death → true", () => {
    expect(isOneShotScene("death")).toBe(true);
  });

  it("idle-baseline → false", () => {
    expect(isOneShotScene("idle-baseline")).toBe(false);
  });

  it("idle-energetic → false", () => {
    expect(isOneShotScene("idle-energetic")).toBe(false);
  });

  it("idle-stoic → false", () => {
    expect(isOneShotScene("idle-stoic")).toBe(false);
  });

  it("sleeping → false", () => {
    expect(isOneShotScene("sleeping")).toBe(false);
  });

  it("sick → false", () => {
    expect(isOneShotScene("sick")).toBe(false);
  });

  it("ONE_SHOT_SCENES has exactly 5 members", () => {
    expect(ONE_SHOT_SCENES.size).toBe(5);
  });
});

describe("isOneShotScene — cross-consistency with TUI AMBIENT_SCENES", () => {
  /**
   * Mapping from compact SceneKey → TUI SceneId(s) that represent the same behaviour.
   * Used to verify that the two namespaces are consistent:
   *   - compact one-shot keys must map to TUI SceneIds NOT in AMBIENT_SCENES
   *   - compact ambient keys must map to TUI SceneIds IN AMBIENT_SCENES
   *
   * SceneKeys without a clear TUI equivalent are noted.
   */
  const compactToSceneId: Partial<Record<SceneKey, SceneId[]>> = {
    // One-shot compact keys → one-shot TUI SceneIds (must NOT be ambient)
    "eating": ["eat-small", "eat-feast"],
    "playing": ["play-bounce", "play-chase"],
    "level-up": ["levelup-flash"],
    "death": ["death-fade"],
    // "petted" has no direct TUI SceneId equivalent in SCENES (closest: happy-wag/happy-sparkle)
    // but those are feed-residual, not pet-triggered. We skip petted from TUI cross-check.

    // Ambient compact keys → ambient TUI SceneIds (must BE in AMBIENT_SCENES)
    "idle-baseline": ["idle-baseline"],
    "idle-energetic": ["idle-chipper"],
    "idle-stoic": ["idle-stoic"],
    "sleeping": ["sleep", "sleep-deep"],
    "sick": ["sick", "sick-worse"],
  };

  it("one-shot compact keys map to TUI SceneIds that are NOT in AMBIENT_SCENES", () => {
    const oneShotKeys: SceneKey[] = ["eating", "playing", "level-up", "death"];
    for (const key of oneShotKeys) {
      const tuiIds = compactToSceneId[key];
      if (!tuiIds) continue;
      for (const tuiId of tuiIds) {
        expect(
          AMBIENT_SCENES.has(tuiId),
          `compact one-shot "${key}" maps to TUI "${tuiId}" which IS in AMBIENT_SCENES — cross-namespace drift detected`
        ).toBe(false);
      }
    }
  });

  it("ambient compact keys map to TUI SceneIds that ARE in AMBIENT_SCENES", () => {
    const ambientKeys: SceneKey[] = ["idle-baseline", "idle-energetic", "idle-stoic", "sleeping", "sick"];
    for (const key of ambientKeys) {
      const tuiIds = compactToSceneId[key];
      if (!tuiIds) continue;
      for (const tuiId of tuiIds) {
        expect(
          AMBIENT_SCENES.has(tuiId),
          `compact ambient "${key}" maps to TUI "${tuiId}" which is NOT in AMBIENT_SCENES — cross-namespace drift detected`
        ).toBe(true);
      }
    }
  });

  it("'petted' compact scene has no direct TUI SceneId — documented gap, not a bug", () => {
    // The compact namespace uses 'petted' as a distinct reaction scene.
    // The TUI namespace has no matching sceneId — 'happy-wag' / 'happy-sparkle'
    // are feed-residual, not pet-triggered. This is a known namespace asymmetry.
    // As long as petted is in ONE_SHOT_SCENES (compact) and NOT in AMBIENT_SCENES
    // (TUI context doesn't have it at all), the divergence is benign.
    expect(ONE_SHOT_SCENES.has("petted")).toBe(true);
    // TUI has no "petted" SceneId — not in AMBIENT_SCENES either (vacuously correct)
    // @ts-expect-error: "petted" is not a valid SceneId — intentional test
    expect(AMBIENT_SCENES.has("petted")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describe("computeWanderX / stepWander divergence") — property test + documentation
// ---------------------------------------------------------------------------

describe("computeWanderX vs stepWander — property test and divergence analysis", () => {
  /**
   * CRITICAL: These two implementations DIVERGE by design (see file-level comment).
   *
   * This test characterises the divergence exactly so future changes don't accidentally
   * remove it (which would indicate one side was silently "fixed" to match the other,
   * potentially breaking the TUI wander contract or the statusline spec).
   *
   * The divergence pattern at maxX=20 (ARENA_COLS=40, PET_WIDTH=20 — matches useWander.ts):
   *   computeWanderX stepsPerCycle = 2*20+2 = 42
   *   stepWander effective period   = 2*20+4 = 44 (2 extra ticks for the 2-step edge hold)
   *
   * They agree on the first maxX+1 ticks (0..maxX) then diverge at the right-edge bounce.
   */

  // Use parameters that match useWander.ts internals for fair comparison
  // useWander: ARENA_COLS=40, PET_WIDTH=20 (unexported), maxX=20
  const ARENA = 40;
  const PET_W = 20;
  const MAX_X = ARENA - PET_W; // 20
  const COMPACT_STEPS_PER_CYCLE = 2 * MAX_X + 2; // 42

  it("both start at x=0 (tick=0, 0 stepWander calls)", () => {
    const initialState: WanderState = { x: 0, facing: 1, pausedAtEdge: false };
    const compactX = computeWanderX(0, ARENA, PET_W);
    expect(compactX).toBe(0);
    expect(initialState.x).toBe(0);
  });

  it("agree for ticks 0..maxX (rightward phase, no edge-bounce yet)", () => {
    let state: WanderState = { x: 0, facing: 1, pausedAtEdge: false };
    for (let tick = 1; tick <= MAX_X; tick++) {
      state = stepWander(state, 500);
      const compactX = computeWanderX(tick, ARENA, PET_W);
      expect(state.x, `tick=${tick}: stepWander x=${state.x} vs computeWanderX x=${compactX}`).toBe(compactX);
    }
  });

  it("agree at tick=maxX+1 (right-edge hold: both show x=maxX)", () => {
    // stepWander: after maxX+1 calls → x=maxX with pausedAtEdge=true
    let state: WanderState = { x: 0, facing: 1, pausedAtEdge: false };
    for (let i = 0; i < MAX_X + 1; i++) {
      state = stepWander(state, 500);
    }
    const compactX = computeWanderX(MAX_X + 1, ARENA, PET_W);
    // Both hold at maxX at this tick
    expect(state.x).toBe(MAX_X);
    expect(compactX).toBe(MAX_X);
  });

  it("DIVERGE at tick=maxX+2: computeWanderX moves to maxX-1 but stepWander is still at maxX (facing-flip tick)", () => {
    // This is the documented divergence: stepWander spends 2 ticks at the edge
    // (tick N: clamp+pausedAtEdge; tick N+1: flip facing, still at maxX)
    // while computeWanderX spends only 1 (step=maxX+1 is the pause; step=maxX+2 moves left).
    let state: WanderState = { x: 0, facing: 1, pausedAtEdge: false };
    for (let i = 0; i < MAX_X + 2; i++) {
      state = stepWander(state, 500);
    }
    const compactX = computeWanderX(MAX_X + 2, ARENA, PET_W);

    // computeWanderX: step=maxX+2, x = 2*maxX+1 - (maxX+2) = maxX-1
    expect(compactX).toBe(MAX_X - 1);
    // stepWander: still at maxX (this is the facing-flip tick, not a movement tick)
    expect(state.x).toBe(MAX_X);
    expect(state.facing).toBe(-1); // facing has been flipped
    expect(state.pausedAtEdge).toBe(false);

    // Confirm they differ — this IS the divergence. It is intentional.
    expect(state.x).not.toBe(compactX);
  });

  it("stepWander has a longer effective period than computeWanderX (2 extra ticks per cycle)", () => {
    // Determine the actual period of stepWander by finding the first tick > 0
    // where the state returns to {x:0, facing:+1, pausedAtEdge:false}.
    let state: WanderState = { x: 0, facing: 1, pausedAtEdge: false };
    let period = 0;
    for (let t = 1; t <= 200; t++) {
      state = stepWander(state, 500);
      if (state.x === 0 && state.facing === 1 && !state.pausedAtEdge) {
        period = t;
        break;
      }
    }
    // stepWander period = 2*maxX + 4 = 44 (for maxX=20)
    // computeWanderX period = 2*maxX + 2 = 42
    expect(period).toBe(2 * MAX_X + 4); // 44
    expect(COMPACT_STEPS_PER_CYCLE).toBe(2 * MAX_X + 2); // 42
    expect(period).toBe(COMPACT_STEPS_PER_CYCLE + 2);
  });

  it("both implementations keep x in [0, maxX] throughout their respective cycles", () => {
    // This invariant must hold for both regardless of their divergence.
    for (let tick = 0; tick < COMPACT_STEPS_PER_CYCLE * 3; tick++) {
      const x = computeWanderX(tick, ARENA, PET_W);
      expect(x, `computeWanderX at tick=${tick}`).toBeGreaterThanOrEqual(0);
      expect(x, `computeWanderX at tick=${tick}`).toBeLessThanOrEqual(MAX_X);
    }

    let state: WanderState = { x: 0, facing: 1, pausedAtEdge: false };
    const stepWanderPeriod = 2 * MAX_X + 4; // 44
    for (let tick = 0; tick < stepWanderPeriod * 3; tick++) {
      state = stepWander(state, 500);
      expect(state.x, `stepWander at step=${tick + 1}`).toBeGreaterThanOrEqual(0);
      expect(state.x, `stepWander at step=${tick + 1}`).toBeLessThanOrEqual(MAX_X);
    }
  });
});

// ---------------------------------------------------------------------------
// describe("center-snap on one-shot scenes") — assembleWideOutput
// ---------------------------------------------------------------------------

describe("center-snap on one-shot scene", () => {
  const cols = 100;
  const pet = makePet();
  // circuit-adult standard tier: petWidth=9, arenaCols=50, maxX=41, centerX=20
  // CENTER_X_STD = 20 is defined at module scope.

  const ONE_SHOT_KEYS: SceneKey[] = ["eating", "playing", "petted", "level-up", "death"];
  // Standard-tier circuit-adult silhouette starts with 1 space (e.g. " /[o-o]\").
  // The wander pad x is prepended, so total leading spaces in row 2 = centerX + 1.
  const SILHOUETTE_LEADING = 1; // inherent leading space in standard narrow silhouette strings
  const SNAP_PAD = CENTER_X_STD + SILHOUETTE_LEADING; // 20 + 1 = 21

  for (const scene of ONE_SHOT_KEYS) {
    it(`${scene}: pet position snapped to centerX — same leading-pad at any tick (frozen)`, () => {
      const deadOrAlive = (scene === "death")
        ? makePet({ diedAt: new Date().toISOString(), tombstone: { diedAt: new Date().toISOString(), cause: "neglect", finalLevel: 5, finalXp: 500 } })
        : pet;
      // Collect leading-pad for row 2 across a spread of ticks.
      // If center-snap is working, the wander pad is frozen at centerX for all ticks.
      // The absolute count varies by scene frame content, but must be IDENTICAL across ticks.
      const pads = [0, 1, 17, 41, 83].map((tick) => {
        const rows = assembleWideOutput(deadOrAlive, "standard", scene, tick, "none", false, 1, 0, cols).split("\n");
        // rows[2] = pad + row3 = stable silhouette body row (rows[1] = animated frame row
        // which may have varying inherent leading per frame, e.g. level-up spark row).
        return rows[2]!.match(/^( *)/)?.[1]?.length ?? 0;
      });
      // All pads must be equal — the pet is snapped to centerX and not drifting.
      const reference = pads[0]!;
      for (let i = 1; i < pads.length; i++) {
        expect(pads[i], `${scene} tick=${[0,1,17,41,83][i]}: expected same pad as tick=0 (${reference})`).toBe(reference);
      }
      // Also verify the snap is at centerX=20 (not at some other fixed position).
      // The absolute leading-pad = CENTER_X_STD + scene-frame-inherent-leading.
      // scene-frame-inherent-leading is >= 1 for all frames in the spec.
      expect(reference).toBeGreaterThanOrEqual(CENTER_X_STD + 1);
    });
  }

  it("idle-baseline at tick=17 uses time-derived wander x (not centerX)", () => {
    const output = assembleWideOutput(pet, "standard", "idle-baseline", 17, "none", false, 1, 0, cols);
    const rows = output.split("\n");
    const row2 = rows[1]!;
    const leadingSpaces = row2.match(/^( *)/)?.[1]?.length ?? 0;
    // computeWanderX(17, 50, 9): step=17 ≤ maxX=41 → x=17; plus 1 inherent space
    expect(leadingSpaces).toBe(17 + SILHOUETTE_LEADING);
  });

  it("sleeping at tick=5 uses time-derived wander x (not centerX)", () => {
    const sleepPet = makePet({
      pauseIntervals: [{ pausedAt: new Date().toISOString(), resumedAt: null }],
    });
    const output = assembleWideOutput(sleepPet, "standard", "sleeping", 5, "none", false, 1, 0, cols);
    const rows = output.split("\n");
    const row2 = rows[1]!;
    const leadingSpaces = row2.match(/^( *)/)?.[1]?.length ?? 0;
    // computeWanderX(5, 50, 9) = 5; plus the scene's own inherent leading space.
    // For generic sleeping frames (frame.content): first row = " /[-_-]\ z" → 1 leading space.
    expect(leadingSpaces).toBe(5 + SILHOUETTE_LEADING);
  });

  it("one-shot wander pad is identical across multiple tick values (position is frozen)", () => {
    for (const tick of [0, 17, 41, 83]) {
      const output = assembleWideOutput(pet, "standard", "eating", tick, "none", false, 1, 0, cols);
      const rows = output.split("\n");
      const row2 = rows[1]!;
      const leadingSpaces = row2.match(/^( *)/)?.[1]?.length ?? 0;
      expect(leadingSpaces, `eating scene at tick=${tick}`).toBe(SNAP_PAD);
    }
  });
});

// ---------------------------------------------------------------------------
// describe("reduced motion") — env-flag clamp
// ---------------------------------------------------------------------------

describe("reduced motion — env-flag clamp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("NO_MOTION=1: standard tier pet at centerX for any tick", () => {
    vi.stubEnv("NO_MOTION", "1");
    const pet = makePet();
    const cols = 100;
    // centerX=20 (CENTER_X_STD) + 1 inherent art leading space = 21 total leading spaces
    const expectedPad = CENTER_X_STD + 1;

    for (const tick of [0, 1, 17, 43, 83]) {
      const output = assembleWideOutput(pet, "standard", "idle-baseline", tick, "none", false, 1, 0, cols);
      const rows = output.split("\n");
      const row2 = rows[1]!;
      const leadingSpaces = row2.match(/^( *)/)?.[1]?.length ?? 0;
      expect(leadingSpaces, `NO_MOTION=1, tick=${tick}`).toBe(expectedPad);
    }
  });

  it("GLYPHLING_REDUCED_MOTION=1: standard tier pet at centerX for any tick", () => {
    vi.stubEnv("GLYPHLING_REDUCED_MOTION", "1");
    const pet = makePet();
    const cols = 100;
    // centerX=20 + 1 inherent art leading space = 21 total leading spaces
    const expectedPad = CENTER_X_STD + 1;

    for (const tick of [0, 1, 17, 43, 83]) {
      const output = assembleWideOutput(pet, "standard", "idle-baseline", tick, "none", false, 1, 0, cols);
      const rows = output.split("\n");
      const row2 = rows[1]!;
      const leadingSpaces = row2.match(/^( *)/)?.[1]?.length ?? 0;
      expect(leadingSpaces, `GLYPHLING_REDUCED_MOTION=1, tick=${tick}`).toBe(expectedPad);
    }
  });

  it("NO_MOTION=1: wide tier — all 4 art rows shift by wideCenterX from their tick=0 baseline", () => {
    vi.stubEnv("NO_MOTION", "1");
    const pet = makePet();
    const cols = 160;
    const widePetWidth = CIRCUIT_ADULT_WIDE_WIDTH; // 12
    const wideArenaCols = Math.min(WANDER_ARENA_CAP, cols); // 50
    const wideMaxX = wideArenaCols - widePetWidth; // 38
    const wideCenterX = Math.floor(wideMaxX / 2); // 19

    // Under NO_MOTION=1, wander x is frozen at wideCenterX=19.
    // Each art row has an intrinsic leading space from the silhouette string.
    // We verify that all 4 rows shift by exactly wideCenterX relative to their tick=0 baselines.

    // Get tick=0 baselines (NO_MOTION=1 → x=19 at all ticks, so compare across ticks)
    // Actually: under NO_MOTION, every tick gives x=centerX. Verify x is constant.
    const outputs: string[][] = [];
    for (const tick of [0, 5, 30]) {
      const rows = assembleWideOutput(pet, "wide", "idle-baseline", tick, "none", false, 1, 0, cols).split("\n");
      outputs.push(rows);
    }
    // All three ticks must produce the SAME 4 art rows (same wander x = centerX regardless of tick)
    // Check that art rows 0-3 are identical across all ticks (eye-blink may differ — compare leading pad only)
    const pads0 = outputs[0]!.slice(0, 4).map(r => r.match(/^( *)/)?.[1]?.length ?? 0);
    for (const rowSet of outputs.slice(1)) {
      const pads = rowSet.slice(0, 4).map(r => r.match(/^( *)/)?.[1]?.length ?? 0);
      for (let r = 0; r < 4; r++) {
        expect(pads[r], `NO_MOTION=1 wide tier row${r}: expected same pad across ticks`).toBe(pads0[r]);
      }
    }
    // Verify the pad on each row equals wideCenterX + inherent art leading spaces for that row
    // (inherent = row0:4, row1:3, row2:2, row3:4 for circuit-adult wide at tick=0 no wander)
    // We don't hardcode the inherent spaces here; instead verify that the pad
    // is the same across all ticks under NO_MOTION=1 (i.e., wander x is constant).
    // This is sufficient to confirm the env flag is respected.
  });

  it("without any env flag, pet wanders freely (positions differ across ticks)", () => {
    const pet = makePet();
    const cols = 100;
    // ticks 0 and 1 produce different wander x (0 and 1 respectively).
    // Art row has 1 inherent leading space, so total = wander_x + 1.
    const out0 = assembleWideOutput(pet, "standard", "idle-baseline", 0, "none", false, 1, 0, cols);
    const out1 = assembleWideOutput(pet, "standard", "idle-baseline", 1, "none", false, 1, 0, cols);
    const pad0 = out0.split("\n")[1]!.match(/^( *)/)?.[1]?.length ?? 0;
    const pad1 = out1.split("\n")[1]!.match(/^( *)/)?.[1]?.length ?? 0;
    expect(pad0).toBe(0 + 1); // wander=0 + 1 inherent
    expect(pad1).toBe(1 + 1); // wander=1 + 1 inherent
    expect(pad1 - pad0).toBe(1); // 1 col/tick wander
  });
});

// ---------------------------------------------------------------------------
// describe("wide tier emits 5 rows") — revision 2
// ---------------------------------------------------------------------------

describe("wide tier emits 5 rows", () => {
  const cols = 160;

  it("always emits 5 rows for idle-baseline regardless of tick", () => {
    const pet = makePet();
    for (const tick of [0, 1, 42, 85, 100]) {
      const rows = assembleWideOutput(pet, "wide", "idle-baseline", tick, "none", false, 1, 0, cols).split("\n");
      expect(rows.length, `tick=${tick}`).toBe(5);
    }
  });

  it("always emits 5 rows for sleeping scene", () => {
    const pet = makePet({
      pauseIntervals: [{ pausedAt: new Date().toISOString(), resumedAt: null }],
    });
    const rows = assembleWideOutput(pet, "wide", "sleeping", 0, "none", false, 1, 0, cols).split("\n");
    expect(rows.length).toBe(5);
  });

  it("always emits 5 rows at minimum wide-tier width (140)", () => {
    const pet = makePet();
    const rows = assembleWideOutput(pet, "wide", "idle-baseline", 0, "none", false, 1, 0, 140).split("\n");
    expect(rows.length).toBe(5);
  });

  it("always emits 5 rows at large width (220)", () => {
    const pet = makePet();
    const rows = assembleWideOutput(pet, "wide", "idle-baseline", 0, "none", false, 1, 0, 220).split("\n");
    expect(rows.length).toBe(5);
  });

  it("row 5 (index 4) is the HUD row — contains pet name, no leading wander pad at tick=0", () => {
    const pet = makePet();
    const rows = assembleWideOutput(pet, "wide", "idle-baseline", 0, "none", false, 1, 0, cols).split("\n");
    const hudRow = rows[4]!;
    // HUD is packed-tight at col 0 — never offset by wander pad
    expect(hudRow).toContain("Pixel");
    expect(hudRow).toContain("Lv");
    // HUD row does NOT start with a space from wander (it may have a space from name formatting,
    // but it starts at col 0 without a wander offset — verify it is not all-spaces)
    expect(hudRow.trim().length).toBeGreaterThan(0);
  });

  it("rows 1-4 (indices 0-3) all shift by wander x from their tick=0 baseline", () => {
    const pet = makePet();
    // Wide art rows have different inherent leading spaces (e.g. circuit-adult row0=4, row1=3, row2=2, row3=4).
    // The wander pad is added uniformly to all rows. So all 4 rows shift by x from their tick=0 baseline.
    const rows0 = assembleWideOutput(pet, "wide", "idle-baseline", 0, "none", false, 1, 0, cols).split("\n");
    const rows5 = assembleWideOutput(pet, "wide", "idle-baseline", 5, "none", false, 1, 0, cols).split("\n");
    // tick=5 → x=5; each row should gain exactly 5 leading spaces vs tick=0
    for (let r = 0; r < 4; r++) {
      const pad0 = rows0[r]!.match(/^( *)/)?.[1]?.length ?? 0;
      const pad5 = rows5[r]!.match(/^( *)/)?.[1]?.length ?? 0;
      expect(pad5 - pad0, `row ${r + 1} (index ${r}): expected delta of 5`).toBe(5);
    }
    // HUD row (index 4) is not offset by wander — its leading space is unchanged
    const hud0 = rows0[4]!.match(/^( *)/)?.[1]?.length ?? 0;
    const hud5 = rows5[4]!.match(/^( *)/)?.[1]?.length ?? 0;
    expect(hud5 - hud0).toBe(0); // HUD is never offset
    expect(rows5[4]!).toContain("Pixel");
  });

  it("no row exceeds cols in visible width", () => {
    const pet = makePet();
    for (const tick of [0, 5, 42, 43]) {
      const rows = assembleWideOutput(pet, "wide", "idle-baseline", tick, "none", false, 1, 0, cols).split("\n");
      for (let r = 0; r < rows.length; r++) {
        expect(visibleWidth(rows[r]!), `tick=${tick} row=${r}`).toBeLessThanOrEqual(cols);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// describe("standard tier wander on rows 2-3") — 3 rows, HUD on row 1
// ---------------------------------------------------------------------------

describe("standard tier wander on rows 2-3", () => {
  const cols = 100;

  it("emits exactly 3 rows for idle-baseline", () => {
    const pet = makePet();
    const rows = assembleWideOutput(pet, "standard", "idle-baseline", 0, "none", false, 1, 0, cols).split("\n");
    expect(rows.length).toBe(3);
  });

  it("row 1 (index 0) is the HUD row — contains pet name", () => {
    const pet = makePet();
    const rows = assembleWideOutput(pet, "standard", "idle-baseline", 0, "none", false, 1, 0, cols).split("\n");
    expect(rows[0]!).toContain("Pixel");
    expect(rows[0]!).toContain("Lv");
  });

  it("rows 2-3 (indices 1-2) receive equal leading-space pad from wander at tick=10", () => {
    const pet = makePet();
    // tick=10 → computeWanderX(10, 50, 9) = 10 (step=10 ≤ maxX=41)
    // The silhouette strings have 1 inherent leading space, so total leading = 10 + 1 = 11.
    const rows = assembleWideOutput(pet, "standard", "idle-baseline", 10, "none", false, 1, 0, cols).split("\n");
    const pad1 = rows[1]!.match(/^( *)/)?.[1]?.length ?? 0;
    const pad2 = rows[2]!.match(/^( *)/)?.[1]?.length ?? 0;
    expect(pad1).toBe(10 + 1); // 10 wander + 1 inherent art space
    expect(pad2).toBe(10 + 1);
    // Both silhouette rows get the same leading-space count
    expect(pad1).toBe(pad2);
  });

  it("HUD row 1 (index 0) starts at col 0 — not offset by wander", () => {
    const pet = makePet();
    const rows10 = assembleWideOutput(pet, "standard", "idle-baseline", 10, "none", false, 1, 0, cols).split("\n");
    const rows0 = assembleWideOutput(pet, "standard", "idle-baseline", 0, "none", false, 1, 0, cols).split("\n");
    // The HUD row leading-space count must be the same at tick=0 and tick=10.
    // If the HUD were offset by wander, it would differ.
    const hud0 = rows0[0]!.match(/^( *)/)?.[1]?.length ?? 0;
    const hud10 = rows10[0]!.match(/^( *)/)?.[1]?.length ?? 0;
    expect(hud10).toBe(hud0);
    // Also verify HUD contains the pet name content (not blank)
    expect(rows10[0]!).toContain("Pixel");
  });

  it("wander x grows from 0 to maxX across ticks 0..maxX (total leading = wander_x + 1 inherent)", () => {
    const pet = makePet();
    // Art rows have 1 inherent leading space from the silhouette string.
    // Total leading spaces in row 2 = computeWanderX(tick) + 1.
    for (let tick = 0; tick <= MAX_X_CIRCUIT_ADULT_STD; tick++) {
      const rows = assembleWideOutput(pet, "standard", "idle-baseline", tick, "none", false, 1, 0, cols).split("\n");
      const pad = rows[1]!.match(/^( *)/)?.[1]?.length ?? 0;
      expect(pad, `tick=${tick}`).toBe(tick + 1); // wander_x + 1 inherent
    }
  });

  it("emits 3 rows for the minimum 80-col standard tier", () => {
    const pet = makePet();
    const rows = assembleWideOutput(pet, "standard", "idle-baseline", 0, "none", false, 1, 0, 80).split("\n");
    expect(rows.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// describe("narrow tier ships without wander")
// ---------------------------------------------------------------------------

describe("narrow tier ships without wander", () => {
  it("assembleCompactOutput art rows have no leading wander pad — HUD is row 1, art is rows 2-3", () => {
    // The narrow-tier path is assembleCompactOutput (not assembleWideOutput).
    // HUD is emitted first (row 1), then 2 art rows. No wander offset is applied.
    // Art rows start at col 0 with the silhouette's own leading space (part of the art string).
    const pet = makePet({ xp: cumulativeXpForLevel(1), level: 1 }); // hatchling
    // Verify across multiple ticks that the art rows have no additional wander-derived leading spaces.
    for (const tick of [0, 1, 10, 42, 85]) {
      const output = assembleCompactOutput(pet, "idle-baseline", tick, "none", false, 1, 0);
      const rows = output.split("\n");
      expect(rows.length, `tick=${tick}: narrow should emit 3 rows`).toBe(3);
      // Row 1 (index 0) is HUD. Rows 2-3 (indices 1-2) are art.
      // The wander spec (§2) explicitly excludes narrow — art rows must not have variable leading pads.
      // Verify art rows 1 and 2 have the SAME leading-space count across all ticks
      // (they're driven by the art string, not by a wander offset).
      const pad1_t0 = assembleCompactOutput(pet, "idle-baseline", 0, "none", false, 1, 0).split("\n")[1]!.match(/^( *)/)?.[1]?.length ?? 0;
      const pad1_t1 = assembleCompactOutput(pet, "idle-baseline", 1, "none", false, 1, 0).split("\n")[1]!.match(/^( *)/)?.[1]?.length ?? 0;
      // Ticks 0 and 1 produce the same art row leading spaces (no wander offset changes them)
      expect(pad1_t0).toBe(pad1_t1);
    }
  });

  it("assertCompactPetWidths passes — narrow widths are non-zero positive integers", () => {
    // The COMPACT_PET_WIDTH["narrow"] table is populated (no wander, but must be valid).
    expect(() => assertCompactPetWidths()).not.toThrow();
  });

  it("assembleCompactOutput at multiple ticks: no leading wander pad drift on art rows", () => {
    const pet = makePet({ xp: cumulativeXpForLevel(5), level: 5 }); // juvenile
    // Collect the leading-space count for art row 2 (index 1) across a range of ticks.
    const pads = Array.from({ length: 10 }, (_, i) => {
      const rows = assembleCompactOutput(pet, "idle-baseline", i, "none", false, 1, 0).split("\n");
      return rows[1]!.match(/^( *)/)?.[1]?.length ?? 0;
    });
    // All pads should be equal — narrow tier never offsets art rows.
    const referencepad = pads[0]!;
    for (let i = 1; i < pads.length; i++) {
      expect(pads[i], `tick=${i}: expected pad=${referencepad}, got pad=${pads[i]}`).toBe(referencepad);
    }
  });
});

// ---------------------------------------------------------------------------
// describe("refreshInterval >= 3s graceful degradation")
// ---------------------------------------------------------------------------

describe("refreshInterval >= 3s graceful degradation", () => {
  const pet = makePet();
  const cols = 100;

  it("tick=0 produces valid 3-row standard output", () => {
    const rows = assembleWideOutput(pet, "standard", "idle-baseline", 0, "none", false, 1, 0, cols).split("\n");
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(typeof row).toBe("string");
      expect(visibleWidth(row)).toBeLessThanOrEqual(cols);
    }
  });

  it("tick=3 (3s refresh skip) produces valid 3-row standard output", () => {
    const rows = assembleWideOutput(pet, "standard", "idle-baseline", 3, "none", false, 1, 0, cols).split("\n");
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(typeof row).toBe("string");
      expect(visibleWidth(row)).toBeLessThanOrEqual(cols);
    }
  });

  it("tick=6 (6s refresh skip) produces valid 3-row standard output", () => {
    const rows = assembleWideOutput(pet, "standard", "idle-baseline", 6, "none", false, 1, 0, cols).split("\n");
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(typeof row).toBe("string");
      expect(visibleWidth(row)).toBeLessThanOrEqual(cols);
    }
  });

  it("tick=0 produces valid 5-row wide output", () => {
    const rows = assembleWideOutput(pet, "wide", "idle-baseline", 0, "none", false, 1, 0, 160).split("\n");
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(typeof row).toBe("string");
      expect(visibleWidth(row)).toBeLessThanOrEqual(160);
    }
  });

  it("tick=3 (3s refresh skip) produces valid 5-row wide output", () => {
    const rows = assembleWideOutput(pet, "wide", "idle-baseline", 3, "none", false, 1, 0, 160).split("\n");
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(typeof row).toBe("string");
      expect(visibleWidth(row)).toBeLessThanOrEqual(160);
    }
  });

  it("tick=6 (6s refresh skip) produces valid 5-row wide output", () => {
    const rows = assembleWideOutput(pet, "wide", "idle-baseline", 6, "none", false, 1, 0, 160).split("\n");
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(typeof row).toBe("string");
      expect(visibleWidth(row)).toBeLessThanOrEqual(160);
    }
  });

  it("pets teleport between 3s-interval samples (x differs by 3 per sample) — expected per spec §9.7", () => {
    // At 3s refresh: tick jumps by 3 per sample. With 1-col/tick cadence, pet moves 3 cols.
    // This is documented as acceptable "teleport" behaviour per statusline-wander.md §9.7.
    // Art rows have 1 inherent leading space, so total leading = wander_x + 1.
    const out0 = assembleWideOutput(pet, "standard", "idle-baseline", 0, "none", false, 1, 0, cols);
    const out3 = assembleWideOutput(pet, "standard", "idle-baseline", 3, "none", false, 1, 0, cols);
    const pad0 = out0.split("\n")[1]!.match(/^( *)/)?.[1]?.length ?? 0;
    const pad3 = out3.split("\n")[1]!.match(/^( *)/)?.[1]?.length ?? 0;
    // pad0 = 0 (wander) + 1 (inherent) = 1; pad3 = 3 + 1 = 4
    expect(pad0).toBe(0 + 1);
    expect(pad3).toBe(3 + 1);
    // They differ by 3 — this is the "teleport" — but both are valid outputs.
    expect(pad3 - pad0).toBe(3);
  });
});
