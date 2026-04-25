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
// Scene selection from Pet state
// ---------------------------------------------------------------------------

/**
 * Resolves which SceneId to play for a pet given its current state.
 * Priority order:
 *   dying > dead > hatching > evolving > sick > idle-variant
 * One-shot scenes (eat, play, levelup) are driven by the caller dispatching
 * a scene override — this function is the "ambient state" resolver only.
 */
export function selectScene(pet: Pet): SceneId {
  // Death (final state)
  if (pet.diedAt !== null) {
    return "death-fade";
  }

  // Dying (pre-death — within 12h of threshold)
  const DYING_THRESHOLD_S = (3 * 86400) - (12 * 3600); // 3 days - 12h
  if (pet.accumulatedNeglectSeconds >= DYING_THRESHOLD_S) {
    return "sick-worse";
  }

  // Sick (> 1 accumulated day)
  const SICK_THRESHOLD_S = 86400;
  const SICK_WORSE_THRESHOLD_S = 2.5 * 86400;
  if (pet.accumulatedNeglectSeconds >= SICK_WORSE_THRESHOLD_S) {
    return "sick-worse";
  }
  if (pet.accumulatedNeglectSeconds >= SICK_THRESHOLD_S) {
    return "sick";
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
// useAnimation(pet) — primary React hook
// ---------------------------------------------------------------------------

/**
 * Returns the current expanded Frame for the given pet.
 * Drives a setInterval via useFrame(fps) per DEC-015.
 * Handles scene selection, one-shot chains, and reduced-motion opt-in.
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

  const scene = SCENES[animState.sceneId];

  // Resolve effective fps (reduced-motion opt-in)
  const effectiveFps =
    reducedMotion && scene.reducedMotionFps != null
      ? scene.reducedMotionFps
      : scene.fps;

  const [rawFrameIndex, resetFrame] = useFrame(effectiveFps, scene.frames.length);

  // Keep animState in sync with rawFrameIndex tick
  useEffect(() => {
    setAnimState((prev) => {
      const currentScene = SCENES[prev.sceneId];
      return tickAnimation(prev, currentScene, () => selectScene(pet));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawFrameIndex]);

  // When pet state changes (e.g., becomes sick), switch scene
  const prevPetId = useRef(pet.id);
  useEffect(() => {
    const newSceneId = selectScene(pet);
    prevPetId.current = pet.id;
    setAnimState({ sceneId: newSceneId, frameIndex: 0 });
    resetFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pet.accumulatedNeglectSeconds > 86400,
    pet.accumulatedNeglectSeconds > 2.5 * 86400,
    pet.diedAt,
  ]);

  // Resolve the frame to display
  const currentScene = SCENES[animState.sceneId];

  // Reduced-motion frame filtering
  let frameIdx = animState.frameIndex;
  if (reducedMotion && currentScene.reducedMotionFrameIndices != null) {
    const indices = currentScene.reducedMotionFrameIndices;
    frameIdx = indices[animState.frameIndex % indices.length] ?? 0;
  }

  const frame = currentScene.frames[Math.min(frameIdx, currentScene.frames.length - 1)];

  // Defensive fallback (should never happen if assertions pass)
  return frame ?? currentScene.frames[0] ?? {
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
 * @returns        The CompactFrame to render.
 */
export function pickCompactFrame(pet: Pet, tick: number): CompactFrame {
  const sceneId = selectScene(pet);
  const scene = SCENES[sceneId];
  const len = scene.compact.length;
  const idx = tick % len;
  return scene.compact[idx] ?? scene.compact[0]!;
}
