/**
 * AnimationEngine — Module #8 (architecture §2.2)
 *
 * Bridges scene data → Ink renderer per DEC-015 pattern.
 *
 * -----------------------------------------------------------------------
 * DEC-015 HARD RULES (do not change without a new DEC):
 *
 *  1. useFrame(fps) ONLY calls setFrameIndex(i => i + 1) inside the
 *     setInterval callback. No work, no scene logic, no side effects.
 *
 *  2. Scenes are static data. The render function looks up
 *     frames[frameIdx] at render time — it does NOT compute in the tick.
 *
 *  3. Frame-emitting components (the animated pet cell) MUST be wrapped
 *     in React.memo so Ink's reconciler only repaints the cell that
 *     changed, not the whole app tree.
 *
 *  4. The animated cell lives inside a fixed-size static <Box>.
 *     NEVER use <Box borderStyle> on the animated content itself —
 *     border triggers re-layout on every frame (Ink quirk).
 *
 *  5. At 30 fps on Apple Terminal with long scrollback, flicker is
 *     expected. Recommend iTerm2/Kitty/Ghostty for Tier-3 GIF capture.
 * -----------------------------------------------------------------------
 */

import { useState, useEffect, useRef } from "react";
import type { Pet, PersonalityTrait } from "../state/schema.js";
import type { Scene, SceneId, Frame, CompactFrame } from "../../animations/types.js";
import { SCENES } from "../../animations/scenes/index.js";

// ---------------------------------------------------------------------------
// useFrame(fps) — DEC-015 core hook
// ---------------------------------------------------------------------------

/**
 * Drives a frame index at the given fps.
 * ONLY increments the index inside setInterval — no work in the callback.
 * Returns [frameIndex, reset] where reset() restarts from frame 0.
 *
 * @param fps   Frames per second (1–60). Pass 0 to pause.
 * @param total Total frame count (wraps modulo). Pass Infinity to advance
 *              unboundedly (one-shot use).
 */
export function useFrame(fps: number, total: number): [number, () => void] {
  const [frameIndex, setFrameIndex] = useState(0);
  const resetRef = useRef<() => void>(() => setFrameIndex(0));

  useEffect(() => {
    if (fps <= 0 || total <= 0) return;
    const intervalMs = Math.round(1000 / fps);
    const id = setInterval(() => {
      // DEC-015: ONLY this line inside the interval callback.
      setFrameIndex((i) => (i + 1) % total);
    }, intervalMs);
    return () => clearInterval(id);
  }, [fps, total]);

  const reset = () => setFrameIndex(0);
  resetRef.current = reset;

  return [frameIndex, reset];
}

// ---------------------------------------------------------------------------
// Personality → idle variant mapping (expanded-frames.md §5.4)
// ---------------------------------------------------------------------------

export type PersonalityVector = {
  dominant: PersonalityTrait;
  weights: Record<PersonalityTrait, number>;
};

/**
 * Maps a personality vector to one of the 5 idle scene ids.
 * Precedence: grumpy → stoic → chipper → curious → baseline.
 * Source: expanded-frames.md §5.4 selectIdleVariant pseudocode.
 */
export function pickIdleVariant(p: PersonalityVector): SceneId {
  const w = p.weights;

  // grumpy gate (negative-mood takes precedence)
  const gruff = w["Gruff"] ?? 0;
  const paranoid = w["Paranoid"] ?? 0;
  const friendly = w["Friendly"] ?? 0;
  if (gruff > 0.3 || (paranoid > 0.3 && friendly < 0.2)) {
    return "idle-grumpy";
  }

  // stoic gate (quiet archetypes)
  const stoic = w["Stoic"] ?? 0;
  const philosophical = w["Philosophical"] ?? 0;
  if (
    stoic + philosophical > 0.45 &&
    (p.dominant === "Stoic" || p.dominant === "Philosophical")
  ) {
    return "idle-stoic";
  }

  // chipper gate
  const energetic = w["Energetic"] ?? 0;
  if (
    energetic + friendly > 0.45 &&
    (p.dominant === "Energetic" || p.dominant === "Friendly")
  ) {
    return "idle-chipper";
  }

  // curious gate (subtler — same threshold weight as others)
  const curious = w["Curious"] ?? 0;
  if (curious > 0.35) {
    return "idle-curious";
  }

  return "idle-baseline";
}

// ---------------------------------------------------------------------------
// One-shot scene window durations (ms)
//
// For each one-shot sceneId, the duration (in ms) during which the matching
// pet timestamp counts as "active" and the scene should be shown.
//
// Values are derived from: ceil(frames.length / fps * 1000), rounded up to
// include the chainsTo follow-on duration where applicable.
//
// Source scene data (frames / fps → raw playback duration):
//   levelup-flash   : 10f / 30fps =  333ms → 3000ms (generous window; 3s matches statusline)
//   eat-small       : 10f / 15fps =  667ms → 1500ms
//   eat-feast       : 18f / 15fps = 1200ms + happy-sparkle 14f/15fps = 933ms → 2500ms
//   play-bounce     : 12f / 15fps =  800ms → 1500ms
//   play-chase      : 16f / 15fps = 1067ms → 2000ms
//   hatch-crack     : 18f / 10fps = 1800ms → 2000ms (chains to hatch-emerge)
//   hatch-emerge    : 20f / 30fps =  667ms → 2000ms
//   evolve-shimmer  : 24f / 30fps =  800ms → 3000ms
//   happy-wag       : 12f / 12fps = 1000ms → 1500ms
//   happy-sparkle   : 14f / 15fps =  933ms → 1500ms
// ---------------------------------------------------------------------------

export const SCENE_WINDOWS_MS: Partial<Record<SceneId, number>> = {
  "levelup-flash":  3000,
  "eat-small":      1500,
  "eat-feast":      2500,
  "play-bounce":    1500,
  "play-chase":     2000,
  "hatch-crack":    2000,
  "hatch-emerge":   2000,
  "evolve-shimmer": 3000,
  "happy-wag":      1500,
  "happy-sparkle":  1500,
};

// ---------------------------------------------------------------------------
// Scene selection from Pet state
// ---------------------------------------------------------------------------

/**
 * Resolves which SceneId to play for a pet given its current state.
 *
 * Priority order (highest → lowest):
 *   death-fade > sick-worse > sick
 *   > levelup-flash > hatch-emerge > hatch-crack
 *   > evolve-shimmer > eat-feast > eat-small
 *   > play-chase > play-bounce
 *   > happy-sparkle > happy-wag
 *   > idle-*
 *
 * One-shot scenes are gated by a time window: the pet must have a corresponding
 * lastXAt timestamp within SCENE_WINDOWS_MS[sceneId] ms of `nowMs`.
 * When the window expires the scene falls through to the next priority level.
 *
 * @param pet   Pet whose state drives scene selection.
 * @param nowMs Current wall-clock in ms (defaults to Date.now()).
 */
export function selectScene(pet: Pet, nowMs: number = Date.now()): SceneId {
  // Death (final state — latch forever)
  if (pet.diedAt !== null) {
    return "death-fade";
  }

  // Sick-worse / dying (pre-death — within 12h of threshold)
  const DYING_THRESHOLD_S = (3 * 86400) - (12 * 3600); // 259200 - 43200 = 216000s
  const SICK_WORSE_THRESHOLD_S = 2.5 * 86400; // 216000s
  const SICK_THRESHOLD_S = 86400;

  if (
    pet.accumulatedNeglectSeconds >= DYING_THRESHOLD_S ||
    pet.accumulatedNeglectSeconds >= SICK_WORSE_THRESHOLD_S
  ) {
    return "sick-worse";
  }

  if (pet.accumulatedNeglectSeconds >= SICK_THRESHOLD_S) {
    return "sick";
  }

  // Helper: check if a one-shot timestamp is within its window.
  const inWindow = (ts: string | null | undefined, sceneId: SceneId): boolean => {
    if (ts == null) return false;
    const window = SCENE_WINDOWS_MS[sceneId];
    if (window == null) return false;
    return (nowMs - new Date(ts).getTime()) < window;
  };

  // Level-up flash (highest one-shot priority for healthy pet)
  if (inWindow(pet.lastLevelUpAt, "levelup-flash")) {
    return "levelup-flash";
  }

  // Hatch scenes (hatch-emerge before hatch-crack because emerge is the later phase)
  if (inWindow(pet.lastHatchedAt, "hatch-emerge")) {
    return "hatch-emerge";
  }
  if (inWindow(pet.lastHatchedAt, "hatch-crack")) {
    return "hatch-crack";
  }

  // Evolve shimmer
  if (inWindow(pet.lastEvolvedAt, "evolve-shimmer")) {
    return "evolve-shimmer";
  }

  // Feed scenes — use eat-feast when the window would be long enough for it
  // (eat-feast window > eat-small window, so check feast first).
  if (inWindow(pet.lastFedAt, "eat-feast")) {
    return "eat-feast";
  }
  if (inWindow(pet.lastFedAt, "eat-small")) {
    return "eat-small";
  }

  // Play scenes — chase before bounce (longer scene, higher energy)
  if (inWindow(pet.lastPlayedAt, "play-chase")) {
    return "play-chase";
  }
  if (inWindow(pet.lastPlayedAt, "play-bounce")) {
    return "play-bounce";
  }

  // Happy scenes (post-feed residual window, daily checkin window)
  if (inWindow(pet.lastFedAt, "happy-sparkle")) {
    return "happy-sparkle";
  }
  if (inWindow(pet.lastFedAt, "happy-wag")) {
    return "happy-wag";
  }

  // Default: idle variant by personality
  return pickIdleVariant(pet.personality);
}

// ---------------------------------------------------------------------------
// Animation state machine
// ---------------------------------------------------------------------------

export interface AnimationState {
  sceneId: SceneId;
  frameIndex: number;
}

/**
 * Advances the animation state by one tick.
 * Returns the next AnimationState.
 * Pure function — safe to call in tests without React.
 */
export function tickAnimation(
  state: AnimationState,
  scene: Scene,
  resolveNextScene: () => SceneId
): AnimationState {
  const totalFrames = scene.frames.length;

  if (scene.loop) {
    return {
      sceneId: state.sceneId,
      frameIndex: (state.frameIndex + 1) % totalFrames,
    };
  }

  // One-shot: advance until last frame, then chain or latch
  if (state.frameIndex < totalFrames - 1) {
    return {
      sceneId: state.sceneId,
      frameIndex: state.frameIndex + 1,
    };
  }

  // Last frame reached
  if (scene.chainsTo) {
    return { sceneId: scene.chainsTo, frameIndex: 0 };
  }

  // Latch (e.g., death-fade)
  const nextAmbient = resolveNextScene();
  // If the ambient resolver still returns death-fade, stay latched
  if (nextAmbient === "death-fade") {
    return { sceneId: "death-fade", frameIndex: totalFrames - 1 };
  }

  return { sceneId: nextAmbient, frameIndex: 0 };
}

// ---------------------------------------------------------------------------
// One-shot timestamp resolution helper
// ---------------------------------------------------------------------------

/**
 * Returns the "active" timestamp for a one-shot scene given the current pet.
 * Only one-shot scenes driven by pet timestamps are supported.
 *
 * Returns null for scenes that have no corresponding timestamp (looping
 * ambient scenes fall back to the React-tick path in useAnimation).
 */
function getOneShotTimestamp(pet: Pet, sceneId: SceneId): string | null {
  switch (sceneId) {
    case "levelup-flash":  return pet.lastLevelUpAt ?? null;
    case "eat-small":
    case "eat-feast":
    case "happy-sparkle":
    case "happy-wag":      return pet.lastFedAt ?? null;
    case "play-bounce":
    case "play-chase":     return pet.lastPlayedAt ?? null;
    case "hatch-crack":
    case "hatch-emerge":   return pet.lastHatchedAt ?? null;
    case "evolve-shimmer": return pet.lastEvolvedAt ?? null;
    default:               return null;
  }
}

/**
 * Derives a frame index from wall-clock elapsed time for a one-shot scene.
 * This lets the TUI resume at the correct frame after a relaunch mid-window.
 *
 * Formula: floor(elapsedMs / 1000 * fps), clamped to [0, frames.length - 1].
 *
 * @param timestamp  ISO8601 string when the one-shot event fired.
 * @param fps        Scene fps.
 * @param frameCount Total frames in the scene.
 * @param nowMs      Current wall-clock (defaults to Date.now()).
 */
export function frameFromTime(
  timestamp: string,
  fps: number,
  frameCount: number,
  nowMs: number = Date.now()
): number {
  const elapsedMs = Math.max(0, nowMs - new Date(timestamp).getTime());
  const idx = Math.floor((elapsedMs / 1000) * fps);
  return Math.min(idx, frameCount - 1);
}

// ---------------------------------------------------------------------------
// useAnimation(pet) — primary React hook
// ---------------------------------------------------------------------------

/**
 * Returns the current expanded Frame for the given pet.
 * Drives a setInterval via useFrame(fps) per DEC-015.
 * Handles scene selection, one-shot time-derived frame indices, chains, and
 * reduced-motion opt-in.
 *
 * For one-shot scenes driven by pet timestamps (eat, play, levelup, hatch,
 * evolve), the frame index is derived from elapsed wall-clock time so that
 * the TUI resumes at the correct frame after a relaunch mid-window.
 *
 * Looping ambient scenes (idle-*, sick, sick-worse, death-fade) keep the
 * existing React-tick path (useFrame + tickAnimation state machine).
 *
 * @param pet The pet whose state drives animation selection.
 * @returns   The current Frame to render (use frame.rows, frame.effectRow, etc.)
 */
export function useAnimation(pet: Pet): Frame {
  const reducedMotion =
    typeof process !== "undefined" &&
    process.env["GLYPHLING_REDUCED_MOTION"] === "1";

  const [animState, setAnimState] = useState<AnimationState>(() => ({
    sceneId: selectScene(pet),
    frameIndex: 0,
  }));

  const resolvedSceneId = selectScene(pet);
  const resolvedScene = SCENES[resolvedSceneId];

  // Determine whether the resolved scene is a one-shot with a pet timestamp.
  const oneShotTs = getOneShotTimestamp(pet, resolvedSceneId);
  const isOneShot = !resolvedScene.loop && oneShotTs !== null;

  // For the React-tick path (looping/ambient scenes), use animState's scene.
  // For one-shots, the scene is always the resolved scene (ignores animState).
  const activeScene = isOneShot ? resolvedScene : SCENES[animState.sceneId];

  // Resolve effective fps (reduced-motion opt-in)
  const effectiveFps =
    reducedMotion && activeScene.reducedMotionFps != null
      ? activeScene.reducedMotionFps
      : activeScene.fps;

  // useFrame runs at scene fps for re-render cadence.
  // For one-shots we don't trust its frame index — we derive from elapsed time.
  // For loops we use it as before.
  const [rawFrameIndex, resetFrame] = useFrame(effectiveFps, activeScene.frames.length);

  // Keep animState in sync for the looping-scene path
  useEffect(() => {
    if (isOneShot) return; // one-shots don't use the state machine
    setAnimState((prev) => {
      const currentScene = SCENES[prev.sceneId];
      return tickAnimation(prev, currentScene, () => selectScene(pet));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawFrameIndex, isOneShot]);

  // When the resolved scene changes (e.g., pet becomes sick, one-shot window
  // expires, level-up fires), synchronise the animState so the looping path
  // picks up correctly on the next tick.
  useEffect(() => {
    if (!isOneShot) {
      setAnimState({ sceneId: resolvedSceneId, frameIndex: 0 });
      resetFrame();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedSceneId, isOneShot]);

  // Legacy sick/death transition watcher (kept for safety — the effect above
  // covers these too, but this ensures immediate scene switch on death).
  useEffect(() => {
    if (!isOneShot) {
      const newSceneId = selectScene(pet);
      setAnimState({ sceneId: newSceneId, frameIndex: 0 });
      resetFrame();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pet.accumulatedNeglectSeconds > 86400,
    pet.accumulatedNeglectSeconds > 2.5 * 86400,
    pet.diedAt,
  ]);

  // ---------------------------------------------------------------------------
  // Resolve frame index
  // ---------------------------------------------------------------------------

  let frameIdx: number;

  if (isOneShot && oneShotTs !== null) {
    // Time-derived frame index: resume at correct position after relaunch.
    // If the scene has finished (index hits last frame), let chainsTo handle
    // transition in the next selectScene call (window will have expired, so
    // the scene will resolve to something else on the next render).
    frameIdx = frameFromTime(oneShotTs, effectiveFps, activeScene.frames.length);
  } else {
    frameIdx = animState.frameIndex;
  }

  // Reduced-motion frame filtering (only applies to the looping path for now;
  // one-shots at reduced motion use the reduced-motion fps but full frame set)
  if (!isOneShot && reducedMotion && activeScene.reducedMotionFrameIndices != null) {
    const indices = activeScene.reducedMotionFrameIndices;
    frameIdx = indices[frameIdx % indices.length] ?? 0;
  }

  const frame = activeScene.frames[Math.min(frameIdx, activeScene.frames.length - 1)];

  // Defensive fallback (should never happen if assertions pass)
  return frame ?? activeScene.frames[0] ?? {
    rows: ["(o_o)", " ^v^ "],
    durationMs: 500,
  };
}

/**
 * Returns the current compact CompactFrame for the given pet.
 * Used by the statusline renderer (stateless, driven by clock tick).
 *
 * @param pet      The pet.
 * @param tick     Clock tick (Math.floor(Date.now() / 1000) % frames.length).
 * @param nowMs    Optional wall-clock for scene window checks (defaults to Date.now()).
 * @returns        The CompactFrame to render.
 */
export function pickCompactFrame(pet: Pet, tick: number, nowMs?: number): CompactFrame {
  const sceneId = selectScene(pet, nowMs);
  const scene = SCENES[sceneId];
  const len = scene.compact.length;
  const idx = tick % len;
  return scene.compact[idx] ?? scene.compact[0]!;
}
