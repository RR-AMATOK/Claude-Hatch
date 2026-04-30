/**
 * Per-species, per-stage COMPACT frame data (TODO-025).
 *
 * Why this exists
 * ---------------
 * Today's statusline silhouette is essentially static — `assembleCompactOutput`
 * paints `SILHOUETTES[species][stage].narrow` and overlays an eye-blink each
 * tick. That's the minimum-viable "the pet is alive" signal, but it's the same
 * 4-frame tic across every species and stage, and it ignores the personality-
 * driven scene selection in `pickScene()`.
 *
 * This table closes that gap by authoring real per-species, per-stage frame
 * cycles for the *idle* scenes the statusline picker emits today
 * (idle-baseline / idle-energetic / idle-stoic). Each entry is a fully-
 * formed CompactFrame array: rows are pre-painted with that species'
 * silhouette glyphs, so the renderer is a pure tick-modulo lookup with no
 * substitution work in the hot path (DEC-015 friendly).
 *
 * Approach choice (B over A) — see TODO-025 §2
 * --------------------------------------------
 * (A) Token substitution: scenes carry placeholder tokens like `{HEAD}` /
 *     `{BODY}` and the renderer substitutes per species at render time.
 *     Pros: one source of truth per scene structure.
 *     Cons: more code in the hot path; token regex on every tick; harder to
 *     diff per-species visual differences in review.
 *
 * (B) Direct lookup `frames[species][stage][sceneKey] → readonly Frame[]`.
 *     Pros: zero work at render time (single object access + modulo); each
 *     species' art is grep-able and reviewable as a single block; aligns with
 *     the existing `SILHOUETTES` and `EYE_ANIM` per-species tables already
 *     in `compact.ts`.
 *     Cons: more typing — every species/stage/scene gets its own row data.
 *
 * Approach (B) wins because (i) substitution buys us nothing when the only
 * thing varying across species is the silhouette itself (no reusable scene
 * "skeleton" exists), and (ii) DEC-015 is unforgiving about per-tick work —
 * the renderer must be a table lookup.
 *
 * Width-preserving rule
 * ---------------------
 * Within a single (species, stage, sceneKey) entry, every frame's row[i]
 * MUST have identical visible width. This is enforced at module load by
 * `assertSpeciesFramesWidthConsistent()`. Width jumps between frames break
 * Ink layout and produce visual jitter on the statusline.
 *
 * Coverage
 * --------
 * - 4 species × 3 stages × 3 scenes (idle-baseline + idle-energetic + idle-stoic)
 *   = 36 scene entries (each 2–4 frames)
 *
 * Scenes NOT covered (intentional, per TODO-025 scope):
 * - eat / sick / level-up / hatch / etc. — designer art-direction work for
 *   non-idle scenes is deferred. The renderer falls back to the eye-blink-
 *   on-static-silhouette path when a scene isn't in this table.
 *
 * The renderer must always check `getSpeciesCompactFrames()` and fall through
 * to the legacy eye-blink path when it returns `null`.
 */

import type { CompactFrame, LifeStage } from "./compact.js";
import type { EggType } from "../state/schema.js";

/**
 * The subset of `SceneKey` from `compact.ts` that this module authors.
 * Renamed from `SceneKey` to `SpeciesFrameSceneKey` so importing modules
 * don't accidentally widen the `SceneKey` type — the statusline still emits
 * eat/sleep/sick/level-up/death keys; this table just doesn't cover them yet.
 *
 * `playing` and `petted` added here (partial coverage — shard hatchling first,
 * other species/stages fall through to SCENE_FRAMES fallback in compact.ts).
 */
export type SpeciesFrameSceneKey =
  | "idle-baseline"
  | "idle-energetic"
  | "idle-stoic"
  | "eating"
  | "playing"
  | "petted";

// ---------------------------------------------------------------------------
// Per-species art conventions (recap of compact-frames.md §3.2)
// ---------------------------------------------------------------------------
// circuit  — square brackets, pipes, joints. Geometric / pragmatic.
// rune     — angle brackets, ^ horns, dots eyes. Mystical / philosophical.
// shard    — slashes, * spikes, narrow base. Crystalline / energetic.
// bloom    — parentheses, ~ leaves, v cheeks. Organic / friendly.
//
// All variants below preserve the silhouette's identifying glyphs and only
// vary the eye and a 1-cell mouth/breath detail per frame. This is the
// "pose-per-tick" cadence — the user's eye should read "same pet, slightly
// different pose," never "pet just changed."
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// circuit
// ---------------------------------------------------------------------------

const CIRCUIT_HATCHLING_BASELINE: readonly CompactFrame[] = [
  { content: " [oo]\n  || ", durationMs: 2000 }, // steady
  { content: " [oo]\n  || ", durationMs: 2000 }, // micro-shift (visually identical — breath beat)
  { content: " [--]\n  || ", durationMs: 2000 }, // blink
  { content: " [oo]\n  ;; ", durationMs: 2000 }, // breath (feet shuffle)
];

const CIRCUIT_HATCHLING_ENERGETIC: readonly CompactFrame[] = [
  { content: " [Oo]\n  /| ", durationMs: 2000 },
  { content: " [oO]\n  |\\ ", durationMs: 2000 },
  { content: " [^^]\n  || ", durationMs: 2000 },
  { content: " [oo]\n  || ", durationMs: 2000 },
];

const CIRCUIT_HATCHLING_STOIC: readonly CompactFrame[] = [
  { content: " [-_]\n  || ", durationMs: 3000 },
  { content: " [_-]\n  || ", durationMs: 3000 },
];

const CIRCUIT_JUVENILE_BASELINE: readonly CompactFrame[] = [
  { content: " /[oo]\\\n +-||-+", durationMs: 2000 },
  { content: " /[oo]\\\n +-||-+", durationMs: 2000 },
  { content: " /[--]\\\n +-||-+", durationMs: 2000 },
  { content: " /[oo]\\\n +-;;-+", durationMs: 2000 },
];

const CIRCUIT_JUVENILE_ENERGETIC: readonly CompactFrame[] = [
  { content: " /[Oo]\\\n +/||-+", durationMs: 2000 },
  { content: " /[oO]\\\n +-||\\+", durationMs: 2000 },
  { content: " /[^^]\\\n +-||-+", durationMs: 2000 },
  { content: " /[oo]\\\n +-||-+", durationMs: 2000 },
];

const CIRCUIT_JUVENILE_STOIC: readonly CompactFrame[] = [
  { content: " /[-_]\\\n +-||-+", durationMs: 3000 },
  { content: " /[_-]\\\n +-||-+", durationMs: 3000 },
];

const CIRCUIT_ADULT_BASELINE: readonly CompactFrame[] = [
  { content: " /[o-o]\\\n +=|--|=+", durationMs: 2000 },
  { content: " /[o-o]\\\n +=|--|=+", durationMs: 2000 },
  { content: " /[-.-]\\\n +=|--|=+", durationMs: 2000 },
  { content: " /[o-o]\\\n +=|__|=+", durationMs: 2000 },
];

const CIRCUIT_ADULT_ENERGETIC: readonly CompactFrame[] = [
  { content: " /[O-o]\\\n +=|/-|=+", durationMs: 2000 },
  { content: " /[o-O]\\\n +=|-\\|=+", durationMs: 2000 },
  { content: " /[^-^]\\\n +=|--|=+", durationMs: 2000 },
  { content: " /[o-o]\\\n +=|--|=+", durationMs: 2000 },
];

const CIRCUIT_ADULT_STOIC: readonly CompactFrame[] = [
  { content: " /[-_-]\\\n +=|--|=+", durationMs: 3000 },
  { content: " /[-.-]\\\n +=|--|=+", durationMs: 3000 },
];

// ---------------------------------------------------------------------------
// rune
// ---------------------------------------------------------------------------

const RUNE_HATCHLING_BASELINE: readonly CompactFrame[] = [
  { content: " <..>\n  \\/ ", durationMs: 2000 },
  { content: " <..>\n  \\/ ", durationMs: 2000 },
  { content: " <__>\n  \\/ ", durationMs: 2000 }, // blink
  { content: " <..>\n  /\\ ", durationMs: 2000 }, // sigil flip
];

const RUNE_HATCHLING_ENERGETIC: readonly CompactFrame[] = [
  { content: " <*.>\n  \\/ ", durationMs: 2000 },
  { content: " <.*>\n  \\/ ", durationMs: 2000 },
  { content: " <^^>\n  \\/ ", durationMs: 2000 },
  { content: " <..>\n  \\/ ", durationMs: 2000 },
];

const RUNE_HATCHLING_STOIC: readonly CompactFrame[] = [
  { content: " <-->\n  \\/ ", durationMs: 3000 },
  { content: " <..>\n  \\/ ", durationMs: 3000 },
];

const RUNE_JUVENILE_BASELINE: readonly CompactFrame[] = [
  { content: " <^..^>\n  \\||/ ", durationMs: 2000 },
  { content: " <^..^>\n  \\||/ ", durationMs: 2000 },
  { content: " <^__^>\n  \\||/ ", durationMs: 2000 },
  { content: " <^..^>\n  \\;;/ ", durationMs: 2000 },
];

const RUNE_JUVENILE_ENERGETIC: readonly CompactFrame[] = [
  { content: " <^*.^>\n  \\||/ ", durationMs: 2000 },
  { content: " <^.*^>\n  \\||/ ", durationMs: 2000 },
  { content: " <*..*>\n  \\||/ ", durationMs: 2000 },
  { content: " <^..^>\n  \\||/ ", durationMs: 2000 },
];

const RUNE_JUVENILE_STOIC: readonly CompactFrame[] = [
  { content: " <^--^>\n  \\||/ ", durationMs: 3000 },
  { content: " <^..^>\n  \\||/ ", durationMs: 3000 },
];

const RUNE_ADULT_BASELINE: readonly CompactFrame[] = [
  { content: " <^-..-^>\n  \\|||/ ", durationMs: 2000 },
  { content: " <^-..-^>\n  \\|||/ ", durationMs: 2000 },
  { content: " <^-__-^>\n  \\|||/ ", durationMs: 2000 },
  { content: " <^-..-^>\n  \\;;;/ ", durationMs: 2000 },
];

const RUNE_ADULT_ENERGETIC: readonly CompactFrame[] = [
  { content: " <^-*.-^>\n  \\|||/ ", durationMs: 2000 },
  { content: " <^-.*-^>\n  \\|||/ ", durationMs: 2000 },
  { content: " <*-..-*>\n  \\|||/ ", durationMs: 2000 },
  { content: " <^-..-^>\n  \\|||/ ", durationMs: 2000 },
];

const RUNE_ADULT_STOIC: readonly CompactFrame[] = [
  { content: " <^----^>\n  \\|||/ ", durationMs: 3000 },
  { content: " <^-..-^>\n  \\|||/ ", durationMs: 3000 },
];

// ---------------------------------------------------------------------------
// shard
// ---------------------------------------------------------------------------

const SHARD_HATCHLING_BASELINE: readonly CompactFrame[] = [
  { content: " /oo\\\n \\\\//", durationMs: 2000 },
  { content: " /oo\\\n \\\\//", durationMs: 2000 },
  { content: " /__\\\n \\\\//", durationMs: 2000 },
  { content: " /oo\\\n //\\\\", durationMs: 2000 }, // base flip — crystal lattice shift
];

const SHARD_HATCHLING_ENERGETIC: readonly CompactFrame[] = [
  { content: " /Oo\\\n \\\\//", durationMs: 2000 },
  { content: " /oO\\\n \\\\//", durationMs: 2000 },
  { content: " /^^\\\n \\\\//", durationMs: 2000 },
  { content: " /oo\\\n \\\\//", durationMs: 2000 },
];

const SHARD_HATCHLING_STOIC: readonly CompactFrame[] = [
  { content: " /--\\\n \\\\//", durationMs: 3000 },
  { content: " /oo\\\n \\\\//", durationMs: 3000 },
];

// Shard hatchling playing — 4 frames, ~400ms each.
// Eye tracks an imaginary ball; body wobble on alternating frames.
// row0 width = 5, row1 width = 4. Width-consistent within this scene.
const SHARD_HATCHLING_PLAYING: readonly CompactFrame[] = [
  { content: " /oo\\\n \\\\//", durationMs: 400 }, // steady, ready
  { content: " /Oo\\\n \\\\//", durationMs: 400 }, // eye flicks right — tracking
  { content: " /oO\\\n \\\\//", durationMs: 400 }, // eye flicks left — tracking back
  { content: " /^^\\\n \\\\//", durationMs: 400 }, // excited — caught it!
];

// Shard hatchling petted — 2 frames, slow and gentle.
// Eyes close in contentment then open warm.
// row0 width = 5, row1 width = 5. Width-consistent within this scene.
const SHARD_HATCHLING_PETTED: readonly CompactFrame[] = [
  { content: " /--\\\n \\\\//", durationMs: 1000 }, // eyes close — pure contentment
  { content: " /^^\\\n \\\\//", durationMs: 1000 }, // eyes open warm — happy sigh
];

const SHARD_JUVENILE_BASELINE: readonly CompactFrame[] = [
  { content: " /*oo*\\\n \\\\||//", durationMs: 2000 },
  { content: " /*oo*\\\n \\\\||//", durationMs: 2000 },
  { content: " /*__*\\\n \\\\||//", durationMs: 2000 },
  { content: " /*oo*\\\n //||\\\\", durationMs: 2000 },
];

const SHARD_JUVENILE_ENERGETIC: readonly CompactFrame[] = [
  { content: " /*Oo*\\\n \\\\||//", durationMs: 2000 },
  { content: " /*oO*\\\n \\\\||//", durationMs: 2000 },
  { content: " /^oo^\\\n \\\\||//", durationMs: 2000 },
  { content: " /*oo*\\\n \\\\||//", durationMs: 2000 },
];

const SHARD_JUVENILE_STOIC: readonly CompactFrame[] = [
  { content: " /*--*\\\n \\\\||//", durationMs: 3000 },
  { content: " /*oo*\\\n \\\\||//", durationMs: 3000 },
];

const SHARD_ADULT_BASELINE: readonly CompactFrame[] = [
  { content: " /**oo**\\\n \\\\\\||///", durationMs: 2000 },
  { content: " /**oo**\\\n \\\\\\||///", durationMs: 2000 },
  { content: " /**__**\\\n \\\\\\||///", durationMs: 2000 },
  { content: " /**oo**\\\n ///||\\\\\\", durationMs: 2000 },
];

const SHARD_ADULT_ENERGETIC: readonly CompactFrame[] = [
  { content: " /**Oo**\\\n \\\\\\||///", durationMs: 2000 },
  { content: " /**oO**\\\n \\\\\\||///", durationMs: 2000 },
  { content: " /^^oo^^\\\n \\\\\\||///", durationMs: 2000 },
  { content: " /**oo**\\\n \\\\\\||///", durationMs: 2000 },
];

// Shard adult playing — 4 frames, 400ms each. Eyes track the toy then jump
// (legs flipped on caught). Width = 9 visible cells per row, matching baseline.
const SHARD_ADULT_PLAYING: readonly CompactFrame[] = [
  { content: " /**oo**\\\n \\\\\\||///", durationMs: 400 }, // steady
  { content: " /**Oo**\\\n \\\\\\||///", durationMs: 400 }, // track right
  { content: " /**oO**\\\n \\\\\\||///", durationMs: 400 }, // track left
  { content: " /**^^**\\\n ///||\\\\\\", durationMs: 400 }, // caught + jump (legs flipped)
];

// Shard adult petted — 2 frames, 1000ms each. Eyes close in contentment then
// open warm. Width-consistent at 9 cells per row.
const SHARD_ADULT_PETTED: readonly CompactFrame[] = [
  { content: " /**--**\\\n \\\\\\||///", durationMs: 1000 }, // eyes close
  { content: " /**^^**\\\n \\\\\\||///", durationMs: 1000 }, // content smile
];

// Shard adult eating — 3 frames, 1000ms each. Distinct from idle: row1 shows
// food crumbs in frame 0 (the `..` in place of `||`), then mid-bite squint,
// then satisfied smile. Width-consistent at 9 cells per row.
const SHARD_ADULT_EATING: readonly CompactFrame[] = [
  { content: " /**oo**\\\n \\\\\\..///", durationMs: 1000 }, // food approaches (crumbs)
  { content: " /**xx**\\\n \\\\\\||///", durationMs: 1000 }, // eyes squint, mid-bite
  { content: " /**^^**\\\n \\\\\\||///", durationMs: 1000 }, // satisfied smile
];

const SHARD_ADULT_STOIC: readonly CompactFrame[] = [
  { content: " /**--**\\\n \\\\\\||///", durationMs: 3000 },
  { content: " /**oo**\\\n \\\\\\||///", durationMs: 3000 },
];

// ---------------------------------------------------------------------------
// bloom
// ---------------------------------------------------------------------------

const BLOOM_HATCHLING_BASELINE: readonly CompactFrame[] = [
  { content: " (oo)\n  vv ", durationMs: 2000 },
  { content: " (oo)\n  vv ", durationMs: 2000 },
  { content: " (--)\n  vv ", durationMs: 2000 },
  { content: " (oo)\n  ww ", durationMs: 2000 },
];

const BLOOM_HATCHLING_ENERGETIC: readonly CompactFrame[] = [
  { content: " (Oo)\n  vv ", durationMs: 2000 },
  { content: " (oO)\n  vv ", durationMs: 2000 },
  { content: " (^^)\n  vv ", durationMs: 2000 },
  { content: " (oo)\n  vv ", durationMs: 2000 },
];

const BLOOM_HATCHLING_STOIC: readonly CompactFrame[] = [
  { content: " (--)\n  vv ", durationMs: 3000 },
  { content: " (oo)\n  vv ", durationMs: 3000 },
];

const BLOOM_JUVENILE_BASELINE: readonly CompactFrame[] = [
  { content: " (~oo~)\n  \\vv/ ", durationMs: 2000 },
  { content: " (~oo~)\n  \\vv/ ", durationMs: 2000 },
  { content: " (~--~)\n  \\vv/ ", durationMs: 2000 },
  { content: " (~oo~)\n  \\ww/ ", durationMs: 2000 },
];

const BLOOM_JUVENILE_ENERGETIC: readonly CompactFrame[] = [
  { content: " (~Oo~)\n  \\vv/ ", durationMs: 2000 },
  { content: " (~oO~)\n  \\vv/ ", durationMs: 2000 },
  { content: " (*oo*)\n  \\vv/ ", durationMs: 2000 },
  { content: " (~oo~)\n  \\vv/ ", durationMs: 2000 },
];

const BLOOM_JUVENILE_STOIC: readonly CompactFrame[] = [
  { content: " (~--~)\n  \\vv/ ", durationMs: 3000 },
  { content: " (~oo~)\n  \\vv/ ", durationMs: 3000 },
];

const BLOOM_ADULT_BASELINE: readonly CompactFrame[] = [
  { content: " (~*oo*~)\n  ~\\vv/~ ", durationMs: 2000 },
  { content: " (~*oo*~)\n  ~\\vv/~ ", durationMs: 2000 },
  { content: " (~*--*~)\n  ~\\vv/~ ", durationMs: 2000 },
  { content: " (~*oo*~)\n  ~\\ww/~ ", durationMs: 2000 },
];

const BLOOM_ADULT_ENERGETIC: readonly CompactFrame[] = [
  { content: " (~*Oo*~)\n  ~\\vv/~ ", durationMs: 2000 },
  { content: " (~*oO*~)\n  ~\\vv/~ ", durationMs: 2000 },
  { content: " (~*^^*~)\n  ~\\vv/~ ", durationMs: 2000 },
  { content: " (~*oo*~)\n  ~\\vv/~ ", durationMs: 2000 },
];

const BLOOM_ADULT_STOIC: readonly CompactFrame[] = [
  { content: " (~*--*~)\n  ~\\vv/~ ", durationMs: 3000 },
  { content: " (~*oo*~)\n  ~\\vv/~ ", durationMs: 3000 },
];

// ---------------------------------------------------------------------------
// Lookup table
// ---------------------------------------------------------------------------

type SpeciesFramesTable = Record<
  EggType,
  Record<LifeStage, Partial<Record<SpeciesFrameSceneKey, readonly CompactFrame[]>>>
>;

const SPECIES_FRAMES: SpeciesFramesTable = {
  circuit: {
    hatchling: {
      "idle-baseline": CIRCUIT_HATCHLING_BASELINE,
      "idle-energetic": CIRCUIT_HATCHLING_ENERGETIC,
      "idle-stoic": CIRCUIT_HATCHLING_STOIC,
    },
    juvenile: {
      "idle-baseline": CIRCUIT_JUVENILE_BASELINE,
      "idle-energetic": CIRCUIT_JUVENILE_ENERGETIC,
      "idle-stoic": CIRCUIT_JUVENILE_STOIC,
    },
    adult: {
      "idle-baseline": CIRCUIT_ADULT_BASELINE,
      "idle-energetic": CIRCUIT_ADULT_ENERGETIC,
      "idle-stoic": CIRCUIT_ADULT_STOIC,
    },
  },
  rune: {
    hatchling: {
      "idle-baseline": RUNE_HATCHLING_BASELINE,
      "idle-energetic": RUNE_HATCHLING_ENERGETIC,
      "idle-stoic": RUNE_HATCHLING_STOIC,
    },
    juvenile: {
      "idle-baseline": RUNE_JUVENILE_BASELINE,
      "idle-energetic": RUNE_JUVENILE_ENERGETIC,
      "idle-stoic": RUNE_JUVENILE_STOIC,
    },
    adult: {
      "idle-baseline": RUNE_ADULT_BASELINE,
      "idle-energetic": RUNE_ADULT_ENERGETIC,
      "idle-stoic": RUNE_ADULT_STOIC,
    },
  },
  shard: {
    hatchling: {
      "idle-baseline": SHARD_HATCHLING_BASELINE,
      "idle-energetic": SHARD_HATCHLING_ENERGETIC,
      "idle-stoic": SHARD_HATCHLING_STOIC,
      playing: SHARD_HATCHLING_PLAYING,
      petted: SHARD_HATCHLING_PETTED,
    },
    juvenile: {
      "idle-baseline": SHARD_JUVENILE_BASELINE,
      "idle-energetic": SHARD_JUVENILE_ENERGETIC,
      "idle-stoic": SHARD_JUVENILE_STOIC,
    },
    adult: {
      "idle-baseline": SHARD_ADULT_BASELINE,
      "idle-energetic": SHARD_ADULT_ENERGETIC,
      "idle-stoic": SHARD_ADULT_STOIC,
      eating: SHARD_ADULT_EATING,
      playing: SHARD_ADULT_PLAYING,
      petted: SHARD_ADULT_PETTED,
    },
  },
  bloom: {
    hatchling: {
      "idle-baseline": BLOOM_HATCHLING_BASELINE,
      "idle-energetic": BLOOM_HATCHLING_ENERGETIC,
      "idle-stoic": BLOOM_HATCHLING_STOIC,
    },
    juvenile: {
      "idle-baseline": BLOOM_JUVENILE_BASELINE,
      "idle-energetic": BLOOM_JUVENILE_ENERGETIC,
      "idle-stoic": BLOOM_JUVENILE_STOIC,
    },
    adult: {
      "idle-baseline": BLOOM_ADULT_BASELINE,
      "idle-energetic": BLOOM_ADULT_ENERGETIC,
      "idle-stoic": BLOOM_ADULT_STOIC,
    },
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The set of scene keys this table covers. Used by the renderer to decide
 * whether to dispatch to the species-frames lookup or fall through to the
 * legacy eye-blink-on-static-silhouette path.
 */
export const SPECIES_FRAME_SCENE_KEYS: readonly SpeciesFrameSceneKey[] = [
  "idle-baseline",
  "idle-energetic",
  "idle-stoic",
  "eating",
  "playing",
  "petted",
] as const;

/**
 * Look up the per-species, per-stage frame cycle for a scene.
 *
 * Returns `null` when the scene isn't in the table — the renderer must
 * fall back to the legacy eye-blink-on-static-silhouette path. This keeps
 * the rollout incremental: scenes can be added per species/stage one at a
 * time without touching the renderer.
 *
 * Pure: same inputs → same reference. Safe to call inside a render path
 * (no allocations, no side effects).
 */
export function getSpeciesCompactFrames(
  species: EggType,
  stage: LifeStage,
  sceneKey: string
): readonly CompactFrame[] | null {
  // Narrow the string scene key — anything outside the covered set returns null.
  if (!isSpeciesFrameSceneKey(sceneKey)) return null;
  const stageMap = SPECIES_FRAMES[species]?.[stage];
  if (stageMap === undefined) return null;
  const frames = stageMap[sceneKey];
  if (frames === undefined || frames.length === 0) return null;
  return frames;
}

function isSpeciesFrameSceneKey(s: string): s is SpeciesFrameSceneKey {
  return (SPECIES_FRAME_SCENE_KEYS as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// Build-time width-consistency assertion
// ---------------------------------------------------------------------------

/**
 * For each (species, stage, scene), verify that all frames have rows of
 * matching widths. Mismatched widths shift the silhouette around between
 * frames and break Ink layout in expanded mode (the statusline is more
 * tolerant but still ugly). Throws on the first violation so the failure is
 * easy to diagnose.
 *
 * Runs at module load — see invocation below the function. Tests pick up
 * any violation as an import-time error in the collect phase.
 */
export function assertSpeciesFramesWidthConsistent(): void {
  for (const species of Object.keys(SPECIES_FRAMES) as EggType[]) {
    for (const stage of ["hatchling", "juvenile", "adult"] as LifeStage[]) {
      const stageMap = SPECIES_FRAMES[species][stage];
      for (const sceneKey of SPECIES_FRAME_SCENE_KEYS) {
        const frames = stageMap[sceneKey];
        if (frames === undefined || frames.length === 0) continue;

        // Compute reference row widths from frame 0.
        const refRows = frames[0]!.content.split("\n");
        const refWidths = refRows.map((r) => r.length);

        for (let fi = 1; fi < frames.length; fi++) {
          const rows = frames[fi]!.content.split("\n");
          if (rows.length !== refRows.length) {
            throw new Error(
              `species-frames: ${species}/${stage}/${sceneKey} frame ${fi} ` +
                `has ${rows.length} rows; frame 0 has ${refRows.length}`
            );
          }
          for (let ri = 0; ri < rows.length; ri++) {
            if (rows[ri]!.length !== refWidths[ri]) {
              throw new Error(
                `species-frames: ${species}/${stage}/${sceneKey} ` +
                  `frame ${fi} row ${ri} width = ${rows[ri]!.length}, ` +
                  `frame 0 row ${ri} width = ${refWidths[ri]}. ` +
                  `Within-scene width must be consistent (Ink layout invariant).`
              );
            }
          }
        }

        // Also validate the ≤3 rows × ≤60 cols envelope from compact-frames.md §7.1.
        for (let fi = 0; fi < frames.length; fi++) {
          const rows = frames[fi]!.content.split("\n");
          if (rows.length > 3) {
            throw new Error(
              `species-frames: ${species}/${stage}/${sceneKey} frame ${fi} ` +
                `has ${rows.length} rows (max 3)`
            );
          }
          for (let ri = 0; ri < rows.length; ri++) {
            const w = rows[ri]!.length;
            if (w > 60) {
              throw new Error(
                `species-frames: ${species}/${stage}/${sceneKey} ` +
                  `frame ${fi} row ${ri} has ${w} visible cols (max 60)`
              );
            }
          }
        }
      }
    }
  }
}

// Run at module load — tests catch the throw in the collect phase.
assertSpeciesFramesWidthConsistent();
