/**
 * CompactVocab — Module #22 (architecture §2.2)
 *
 * Compact-frame vocabulary for the one-shot statusLine renderer.
 * Data source: docs/design/compact-frames.md (authoritative @designer spec).
 *
 * Exports:
 *   - CompactFrame type
 *   - ANSI SGR helpers (256-color default, ANSI-16 fallback, truecolor opt-in)
 *   - SCENES / SILHOUETTES data
 *   - pickCompactFrame(pet, scene, tick) — pure dispatch function
 *   - assertFrameDimensions() — build-time assertion (≤3 rows × ≤60 cols)
 *   - Tier / classifyTier() — responsive breakpoint classification
 *   - WIDE_HUD_START_COL / WIDE_SILHOUETTE_MAX_COLS — wide-tier layout constants
 *   - assembleWideOutput() — standard/wide tier assembler
 *   - assertWideFrameDimensions() — build-time assertion for wide silhouettes
 */

import type { Pet, EggType } from "../state/schema.js";
import { isAscendant } from "../lifecycle/ascendant.js";
import {
  LEVEL_CAP,
  levelFromCumXp,
  cumulativeXpForLevel,
} from "../xp/engine.js";
import { getSpeciesCompactFrames } from "./species-frames.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Clock period for deterministic tick cycling (1 Hz = 1000 ms, DEC-016). */
export const REFRESH_MS = 1000;

/**
 * How long (ms) the level-up animation scene plays after a level boundary
 * is crossed. At 1 Hz statusline refresh this is ~3 ticks of animation.
 * The XP engine writes `pet.lastLevelUpAt` when the level increases;
 * pickScene() checks the elapsed time against this window.
 */
export const LEVEL_UP_WINDOW_MS = 3000;

/**
 * Reaction-scene window constants for eating, playing, and petted.
 *
 * At 1 Hz the statusline polls once per second. Because a trigger can land
 * anywhere within that second (e.g. at X+0.7 s), the first visible tick may
 * only be at X+1 s (0.3 s of window already consumed). To guarantee the
 * user sees at least 4 consecutive ticks of the reaction scene we need:
 *
 *   window ≥ 4 + 1 = 5 s  (worst-case phase offset eats ~1 s)
 *
 * Eat and play use 6 s (5–6 ticks at 1 Hz, comfortable margin).
 * Petted uses 5 s (exactly 4–5 ticks — meets the 4-tick floor).
 */
export const EAT_WINDOW_MS = 6000;
export const PLAY_WINDOW_MS = 6000;
export const PET_WINDOW_MS = 5000;

/** Hard ceiling: columns per row (narrow tier). */
const MAX_COLS = 60;

/** Hard ceiling: rows per compact frame. */
const MAX_ROWS = 3;

// ---------------------------------------------------------------------------
// Responsive tier classification (statusline-wide.md §2)
// ---------------------------------------------------------------------------

/**
 * Responsive breakpoint tiers for the statusline renderer.
 *   narrow   — cols < 80  (or undefined/non-TTY) — status quo layout
 *   standard — 80 ≤ cols < 140 — 3-row with mood packed-tight after HUD
 *   wide     — cols ≥ 140 — 4-row with wide silhouette
 */
export type Tier = "narrow" | "standard" | "wide";

/**
 * Classify the terminal width into a render tier.
 * undefined (non-TTY / CI) → narrow (safe default).
 */
export function classifyTier(cols: number | undefined): Tier {
  if (cols === undefined || cols < 80) return "narrow";
  if (cols < 140) return "standard";
  return "wide";
}

/**
 * HUD start column on row 4 at wide tier.
 * Derived from the widest silhouette (circuit-elder row 3 `  +==|--|==+` ends
 * at visible col 12) + 3-space margin = col 15. Hard-coded to avoid per-tick
 * recomputation (statusline-wide.md §4.3, §5 handoff §4).
 */
export const WIDE_HUD_START_COL = 15;

/**
 * Maximum visible columns a wide silhouette row may occupy.
 * Validated at build time by assertWideFrameDimensions().
 */
export const WIDE_SILHOUETTE_MAX_COLS = 18;

/**
 * Derive level from cumulative XP. Thin re-export of `levelFromCumXp` from
 * `xp/engine.ts` — kept here for backward compatibility with importers that
 * reference `deriveLevel` from `compact.js` (e.g. App.test.tsx).
 *
 * Authoritative over the stored `pet.level` field — any drift between the two
 * resolves in favour of the xp-derived value.
 */
export function deriveLevel(xp: number): number {
  return levelFromCumXp(xp);
}

// ---------------------------------------------------------------------------
// Color token type
// ---------------------------------------------------------------------------

/**
 * A color triple. The renderer picks the right value based on env flags.
 * ansi16 value of -1 means "default" (no SGR color applied).
 */
export interface ColorToken {
  ansi256: number;
  ansi16: number; // -1 = default foreground
  truecolor: readonly [number, number, number];
}

// ---------------------------------------------------------------------------
// 11-token palette (docs/design/compact-frames.md §6.2)
// ---------------------------------------------------------------------------

export const PALETTE = {
  "text-primary": {
    ansi256: -1,
    ansi16: -1,
    truecolor: [-1, -1, -1],
  } satisfies ColorToken,
  "text-secondary": {
    ansi256: 8,
    ansi16: 8,
    truecolor: [122, 122, 122],
  } satisfies ColorToken,
  "surface-muted": {
    ansi256: 238,
    ansi16: 8,
    truecolor: [74, 74, 74],
  } satisfies ColorToken,
  primary: {
    ansi256: 33,
    ansi16: 4,
    truecolor: [42, 127, 255],
  } satisfies ColorToken,
  "accent-level": {
    ansi256: 45,
    ansi16: 6,
    truecolor: [42, 183, 202],
  } satisfies ColorToken,
  success: {
    ansi256: 72,
    ansi16: 2,
    truecolor: [95, 191, 135],
  } satisfies ColorToken,
  warning: {
    ansi256: 178,
    ansi16: 3,
    truecolor: [215, 175, 0],
  } satisfies ColorToken,
  "error-muted": {
    ansi256: 131,
    ansi16: 1,
    truecolor: [181, 90, 90],
  } satisfies ColorToken,
  error: {
    ansi256: 160,
    ansi16: 1,
    truecolor: [215, 0, 0],
  } satisfies ColorToken,
  "level-up": {
    ansi256: 220,
    ansi16: 11,
    truecolor: [255, 215, 0],
  } satisfies ColorToken,
  death: {
    ansi256: 242,
    ansi16: 8,
    truecolor: [106, 106, 106],
  } satisfies ColorToken,
} as const;

export type PaletteKey = keyof typeof PALETTE;

// ---------------------------------------------------------------------------
// Per-species accent (compact-frames.md §6.3)
// ---------------------------------------------------------------------------

const SPECIES_ACCENT: Record<EggType, ColorToken> = {
  circuit: { ansi256: 33, ansi16: 4, truecolor: [42, 127, 255] },
  rune: { ansi256: 141, ansi16: 5, truecolor: [167, 127, 255] },
  shard: { ansi256: 208, ansi16: 3, truecolor: [255, 140, 42] },
  bloom: { ansi256: 114, ansi16: 2, truecolor: [127, 191, 95] },
};

// ---------------------------------------------------------------------------
// ANSI SGR helpers
// ---------------------------------------------------------------------------

/**
 * Color mode determined at render time from env flags.
 * - "none": NO_COLOR=1 or no color support
 * - "ansi16": NO_256COLOR=1
 * - "ansi256": default
 * - "truecolor": GLYPHLING_TRUECOLOR=1
 */
export type ColorMode = "none" | "ansi16" | "ansi256" | "truecolor";

export function detectColorMode(env: Record<string, string | undefined> = process.env): ColorMode {
  if (env["NO_COLOR"]) return "none";
  if (env["GLYPHLING_TRUECOLOR"] === "1") return "truecolor";
  if (env["NO_256COLOR"] === "1") return "ansi16";
  return "ansi256";
}

/** Emit an ANSI foreground SGR string for the given token and mode. */
export function fg(token: ColorToken, mode: ColorMode): string {
  if (mode === "none") return "";
  if (token.ansi256 === -1) return ""; // text-primary = default
  switch (mode) {
    case "truecolor": {
      const [r, g, b] = token.truecolor;
      if (r === -1) return "";
      return `\x1b[38;2;${r};${g};${b}m`;
    }
    case "ansi16": {
      if (token.ansi16 === -1) return "";
      // ANSI-16 codes: 30-37 standard, 90-97 bright
      const code = token.ansi16 < 8 ? 30 + token.ansi16 : 90 + (token.ansi16 - 8);
      return `\x1b[${code}m`;
    }
    case "ansi256":
    default: {
      return `\x1b[38;5;${token.ansi256}m`;
    }
  }
}

/** Reset all SGR attributes. */
export const RESET = "\x1b[0m";

/** Bold. */
export const BOLD = "\x1b[1m";

/** Dim. */
export const DIM = "\x1b[2m";

/**
 * Wrap text with a foreground color, then reset.
 * Returns plain text when mode is "none".
 */
export function colorize(text: string, token: ColorToken, mode: ColorMode): string {
  if (mode === "none") return text;
  const prefix = fg(token, mode);
  if (!prefix) return text;
  return `${prefix}${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// CompactFrame type
// ---------------------------------------------------------------------------

/**
 * A single compact animation frame (architecture §12.3, DEC-016).
 * content: up to 3 newline-separated rows, each ≤58 cells rendered width.
 * durationMs: per-frame hold time (informational for tooling; renderer uses tick).
 * reducedMotion: true = skip this frame in reduced-motion path.
 */
export interface CompactFrame {
  content: string;
  durationMs: number;
  reducedMotion?: boolean;
}

// ---------------------------------------------------------------------------
// Scene key type
// ---------------------------------------------------------------------------

export type SceneKey =
  | "idle-baseline"
  | "idle-energetic"
  | "idle-stoic"
  | "eating"
  | "playing"
  | "petted"
  | "sleeping"
  | "sick"
  | "level-up"
  | "death";

// ---------------------------------------------------------------------------
// Life stage helper
// ---------------------------------------------------------------------------

export type LifeStage = "hatchling" | "juvenile" | "adult";

export function getLifeStage(level: number): LifeStage {
  if (level <= 2) return "hatchling";
  if (level <= 9) return "juvenile";
  return "adult";
}

// ---------------------------------------------------------------------------
// 12 species silhouettes (compact-frames.md §3.2 + statusline-wide-silhouettes.md §2)
// Each entry has:
//   narrow: [row1, row2]  — 2-row compact silhouette (narrow/standard tier)
//   wide:   [row1, row2, row3, row4] — 4-row wide silhouette (wide tier only)
// Wide silhouettes are authored per statusline-wide-silhouettes.md §2.
// Stage mapping (design doc labels → code enum):
//   design "juvenile" → code "hatchling" (L0-2)
//   design "adult"    → code "juvenile"  (L3-9)
//   design "elder"    → code "adult"     (L10-1023)
// ---------------------------------------------------------------------------

interface SilhouetteEntry {
  narrow: readonly [string, string];
  wide: readonly [string, string, string, string];
}

export const SILHOUETTES: Record<EggType, Record<LifeStage, SilhouetteEntry>> = {
  circuit: {
    // design "juvenile" = code hatchling (L0-2)
    hatchling: {
      narrow: [" [oo]", "  || "],
      wide: [
        "    .",
        "   [oo]",
        "   -||-",
        "    ^^",
      ],
    },
    // design "adult" = code juvenile (L3-9)
    juvenile: {
      narrow: [" /[oo]\\", " +-||-+"],
      wide: [
        "    |",
        "   /[oo]\\",
        "   +-||-+",
        "    ^  ^",
      ],
    },
    // design "elder" = code adult (L10-1023)
    adult: {
      narrow: [" /[o-o]\\", " +=|--|=+"],
      wide: [
        "    .v.",
        "   /[o-o]\\",
        "  +==|--|==+",
        "    |_||_|",
      ],
    },
  },
  rune: {
    // design "juvenile" = code hatchling (L0-2)
    hatchling: {
      narrow: [" <..>", "  \\/ "],
      wide: [
        "    ^",
        "   <..>",
        "    \\/",
        "    .",
      ],
    },
    // design "adult" = code juvenile (L3-9)
    juvenile: {
      narrow: [" <^..^>", "  \\||/ "],
      wide: [
        "   ^ ^",
        "   <^..^>",
        "    \\||/",
        "    o.o",
      ],
    },
    // design "elder" = code adult (L10-1023)
    adult: {
      narrow: [" <^-..-^>", "  \\|||/ "],
      wide: [
        "    ^^^",
        "   <^-..-^>",
        "    \\|||/",
        "   .  .  .",
      ],
    },
  },
  shard: {
    // design "juvenile" = code hatchling (L0-2)
    hatchling: {
      narrow: [" /oo\\", " \\\\//"],
      wide: [
        "    *",
        "   /oo\\",
        "   \\\\//",
        "   . .",
      ],
    },
    // design "adult" = code juvenile (L3-9)
    juvenile: {
      narrow: [" /*oo*\\", " \\\\||//"],
      wide: [
        "    *",
        "   /*oo*\\",
        "   \\\\||//",
        "   .* *.",
      ],
    },
    // design "elder" = code adult (L10-1023)
    adult: {
      narrow: [" /**oo**\\", " \\\\\\||///"],
      wide: [
        "    *   *",
        "   /**oo**\\",
        "   \\\\\\||///",
        "   .*. .*.",
      ],
    },
  },
  bloom: {
    // design "juvenile" = code hatchling (L0-2)
    hatchling: {
      narrow: [" (oo)", "  vv "],
      wide: [
        "    ~",
        "   (oo)",
        "    vv",
        "    ,.",
      ],
    },
    // design "adult" = code juvenile (L3-9)
    juvenile: {
      narrow: [" (~oo~)", "  \\vv/ "],
      wide: [
        "    ~ ~",
        "   (~oo~)",
        "    \\vv/",
        "    ,.,",
      ],
    },
    // design "elder" = code adult (L10-1023)
    adult: {
      narrow: [" (~*oo*~)", "  ~\\vv/~ "],
      wide: [
        "   ~ * ~",
        "   (~*oo*~)",
        "    ~\\vv/~",
        "    ,.,.,",
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Scene animation frames (species-agnostic, using Circuit-adult as template)
// Other species substitute glyph shapes at render time via getAnimFrames().
// ---------------------------------------------------------------------------

/**
 * Raw animation cycle definitions (content uses Circuit-adult as reference).
 * Actual content is assembled dynamically in pickCompactFrame via substitution.
 */

// Idle baseline — 4 frames, 8s cycle
const IDLE_BASELINE_FRAMES: readonly CompactFrame[] = [
  { content: " /[o-o]\\\n +=|--|=+", durationMs: 2000 },         // steady
  { content: " /[o-o]\\\n +=|--|=+", durationMs: 2000 },         // tiny shift (same for circuit)
  { content: " /[o-~]\\\n +=|--|=+", durationMs: 2000 },         // blink
  { content: " /[o-o]\\\n +=|__|=+", durationMs: 2000 },         // breath
];

// Idle energetic — 4 frames, 8s cycle
const IDLE_ENERGETIC_FRAMES: readonly CompactFrame[] = [
  { content: " /[o-o]\\\n +=|--|=+", durationMs: 2000 },
  { content: " /[O-o]\\\n +=|/-|=+", durationMs: 2000 },
  { content: " /[o-O]\\\n +=|-\\|=+", durationMs: 2000 },
  { content: " /[^-^]\\\n +=|--|=+", durationMs: 2000 },
];

// Idle stoic — 2 frames, 6s cycle
const IDLE_STOIC_FRAMES: readonly CompactFrame[] = [
  { content: " /[-_-]\\\n +=|--|=+", durationMs: 3000 },
  { content: " /[-.-]\\\n +=|--|=+", durationMs: 3000 },
];

// Eating — 3 frames, one-shot
const EATING_FRAMES: readonly CompactFrame[] = [
  { content: " /[o-o]\\ .\n +=|--|=+ .", durationMs: 1000 },
  { content: " /[^-^]\\\n +=|UU|=+", durationMs: 1000 },
  { content: " /[^-^]\\\n +=|~~|=+", durationMs: 1000 },
];

// Playing — 4 frames, one-shot (~400ms each — quicker, energetic cadence).
// Fallback art used when no per-species entry exists in species-frames.ts.
// Eye tracks a bouncing ball (*) across frames; arm swing on row 2.
// All frames: row0 = 9 chars, row1 = 9 chars.
const PLAYING_FRAMES: readonly CompactFrame[] = [
  { content: " /[o-o]\\ \n +=|--|=+", durationMs: 400 },
  { content: " /[O-o]\\ \n +=|/--|=+", durationMs: 400 },
  { content: " /[o-O]\\ \n +=|--\\|=+", durationMs: 400 },
  { content: " /[^-^]\\ \n +=|--|=+", durationMs: 400 },
];

// Petted — 2 frames, slow and gentle.
// Fallback art used when no per-species entry exists in species-frames.ts.
// Eyes close in contentment (frame 0); warm open eyes + tilde mouth (frame 1).
// All frames: row0 = 8 chars, row1 = 9 chars.
const PETTED_FRAMES: readonly CompactFrame[] = [
  { content: " /[-_-]\\\n +=|~~|=+", durationMs: 1000 },
  { content: " /[^-^]\\\n +=|~~|=+", durationMs: 1000 },
];

// Sleeping — 2 frames, 4s cycle
const SLEEPING_FRAMES: readonly CompactFrame[] = [
  { content: " /[-_-]\\ z\n +=|..|=+ Z", durationMs: 2000 },
  { content: " /[-_-]\\ Z\n +=|..|=+ z", durationMs: 2000 },
];

// Sick — 3 frames, 6s cycle
const SICK_FRAMES: readonly CompactFrame[] = [
  { content: " /[x-o]\\\n +/|..|\\+", durationMs: 2000 },
  { content: " /[x-x]\\\n +/|..|\\+", durationMs: 2000 },
  { content: " /[x-x]\\\n  \\|..|/ ", durationMs: 2000 },
];

// Level-up — 5 frames, one-shot (plus 3-frame reduced-motion variant).
// Content is 2 rows (art): row 1 = particle/spark above pet; row 2 = pet silhouette.
// HUD is added as row 3 by assembleCompactOutput.
const LEVEL_UP_FRAMES: readonly CompactFrame[] = [
  { content: "     *    \n /[o-o]\\", durationMs: 300 },                   // spark appears, eyes open
  { content: "   * *    \n /[O-O]\\", durationMs: 300 },                   // bigger spark, eyes widen
  { content: "  \\*|*/   \n /[O-O]\\", durationMs: 300, reducedMotion: true }, // burst
  { content: "   . ' .  \n /[^-^]\\", durationMs: 300 },                  // absorb, joy eyes
  { content: "          \n /[o-o]\\", durationMs: 300, reducedMotion: true }, // glow settle
];

// Death — 1 static frame
const DEATH_FRAMES: readonly CompactFrame[] = [
  { content: "  RIP\n [___]", durationMs: 0 },
];

// ---------------------------------------------------------------------------
// Scene → frames map
// ---------------------------------------------------------------------------

const SCENE_FRAMES: Record<SceneKey, readonly CompactFrame[]> = {
  "idle-baseline": IDLE_BASELINE_FRAMES,
  "idle-energetic": IDLE_ENERGETIC_FRAMES,
  "idle-stoic": IDLE_STOIC_FRAMES,
  eating: EATING_FRAMES,
  playing: PLAYING_FRAMES,
  petted: PETTED_FRAMES,
  sleeping: SLEEPING_FRAMES,
  sick: SICK_FRAMES,
  "level-up": LEVEL_UP_FRAMES,
  death: DEATH_FRAMES,
};

// ---------------------------------------------------------------------------
// Build-time dimension assertions
// ---------------------------------------------------------------------------

/**
 * Compute the visible (non-ANSI) width of a string.
 * Strips ANSI escape sequences before measuring.
 */
export function visibleWidth(s: string): number {
  // Strip ANSI escape sequences
  // eslint-disable-next-line no-control-regex
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  return stripped.length;
}

/**
 * Assert that all frames across all scenes satisfy ≤3 rows × ≤60 cols.
 * Throws if any frame violates the contract.
 * Call this once at module init to catch data errors early.
 */
export function assertFrameDimensions(): void {
  for (const [sceneKey, frames] of Object.entries(SCENE_FRAMES) as [SceneKey, readonly CompactFrame[]][]) {
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i]!;
      const rows = frame.content.split("\n");
      if (rows.length > MAX_ROWS) {
        throw new Error(
          `CompactVocab: scene "${sceneKey}" frame ${i} has ${rows.length} rows (max ${MAX_ROWS})`
        );
      }
      for (let r = 0; r < rows.length; r++) {
        const w = visibleWidth(rows[r]!);
        if (w > MAX_COLS) {
          throw new Error(
            `CompactVocab: scene "${sceneKey}" frame ${i} row ${r} has ${w} visible cols (max ${MAX_COLS}): "${rows[r]}"`
          );
        }
      }
    }
  }
}

// Run assertions at module load to catch data errors early.
assertFrameDimensions();

// ---------------------------------------------------------------------------
// Mood glyph vocabulary (compact-frames.md §5.5)
// ---------------------------------------------------------------------------

export type MoodKey =
  | "happy"
  | "content"
  | "hungry"
  | "sick"
  | "dying"
  | "sleeping"
  | "celebrating"
  | "dead";

interface MoodGlyph {
  ascii: string;
  emoji: string;
  color: PaletteKey;
}

export const MOOD_GLYPHS: Record<MoodKey, MoodGlyph> = {
  happy: { ascii: ":)", emoji: "😊", color: "success" },
  content: { ascii: ":|", emoji: "🙂", color: "text-primary" },
  hungry: { ascii: ":o", emoji: "😋", color: "warning" },
  sick: { ascii: ":(", emoji: "🤒", color: "error-muted" },
  dying: { ascii: ":X", emoji: "💀", color: "error" },
  sleeping: { ascii: "zZ", emoji: "😴", color: "text-secondary" },
  celebrating: { ascii: ":D", emoji: "🎉", color: "level-up" },
  dead: { ascii: "+ ", emoji: "⚰️ ", color: "death" },
};

// ---------------------------------------------------------------------------
// Mood derivation from pet state
// ---------------------------------------------------------------------------

const HOURS = 3600 * 1000;
const NEGLECT_1D = 86400; // seconds

/**
 * Derive the current mood from a Pet's state.
 * Priority: dead > dying > celebrating-window > sick > hungry > sleeping > happy > content.
 *
 * Ascendants (L1618, DEC-019 D6 / DEC-020) are immune to sick/dying moods. Any legacy
 * `sick` state in the stored Pet is ignored — the renderer treats them as clean.
 */
export function deriveMood(pet: Pet, nowMs: number): MoodKey {
  if (pet.diedAt !== null) return "dead";

  // Ascendants are immune — skip all neglect/sick paths regardless of stored state.
  if (isAscendant(pet)) return "content";

  const neglect = pet.accumulatedNeglectSeconds;
  // Dying = within 12h of 3d threshold (3d - 12h = 2.5d = 216000s)
  if (neglect >= 216000) return "dying";
  if (neglect >= NEGLECT_1D) return "sick";

  // Hungry = lastFedAt > 6h ago
  if (pet.lastFedAt !== null) {
    const hoursSinceFed = (nowMs - new Date(pet.lastFedAt).getTime()) / HOURS;
    if (hoursSinceFed > 6) return "hungry";
  } else {
    // Never fed => hungry
    return "hungry";
  }

  // Sleeping: paused state = last pauseInterval has resumedAt === null
  const lastPause = pet.pauseIntervals[pet.pauseIntervals.length - 1];
  if (lastPause !== undefined && lastPause.resumedAt === null) return "sleeping";

  // Default: content
  return "content";
}

// ---------------------------------------------------------------------------
// Scene selection from pet state
// ---------------------------------------------------------------------------

/**
 * Pick the appropriate scene key given a pet's current state.
 * Falls back to idle-baseline for unrecognized scenes.
 *
 * Ascendants (L1618, DEC-019 D6 / DEC-020) never enter the sick scene.
 *
 * Priority chain (top wins):
 *   death        — if diedAt !== null
 *   level-up     — windowed: within LEVEL_UP_WINDOW_MS of lastLevelUpAt
 *   sick         — neglect ≥ 1 day (non-ascendant only)
 *   eating       — windowed: within EAT_WINDOW_MS of lastFedAt
 *   playing      — windowed: within PLAY_WINDOW_MS of lastPlayedAt
 *   petted       — windowed: within PET_WINDOW_MS of lastPettedAt
 *   sleeping     — currently paused
 *   idle-*       — personality-based fallback
 *
 * Interaction windows are sized so each reaction plays for at least 4 ticks
 * at 1 Hz regardless of where in the polling phase the trigger landed
 * (see EAT_WINDOW_MS / PLAY_WINDOW_MS / PET_WINDOW_MS constants above).
 */
export function pickScene(pet: Pet, nowMs: number): SceneKey {
  if (pet.diedAt !== null) return "death";

  // Level-up animation window: highest priority after death.
  // pet.lastLevelUpAt is set by applyEvent when pet.level increases.
  const lastLevelUpAt = pet.lastLevelUpAt ?? null;
  if (
    lastLevelUpAt !== null &&
    nowMs - Date.parse(lastLevelUpAt) < LEVEL_UP_WINDOW_MS
  ) {
    return "level-up";
  }

  // Ascendants are immune to the sick scene (DEC-019 D6).
  if (isAscendant(pet)) {
    // Fall through to interaction/sleeping/idle selection below.
  } else {
    const neglect = pet.accumulatedNeglectSeconds;
    if (neglect >= NEGLECT_1D) return "sick";
  }

  // Interaction reaction windows — checked in priority order.
  // Each window is wide enough for ≥4 visible 1 Hz ticks (see constant comments).
  const lastFedAt = pet.lastFedAt ?? null;
  if (lastFedAt !== null && nowMs - Date.parse(lastFedAt) < EAT_WINDOW_MS) {
    return "eating";
  }

  const lastPlayedAt = pet.lastPlayedAt ?? null;
  if (lastPlayedAt !== null && nowMs - Date.parse(lastPlayedAt) < PLAY_WINDOW_MS) {
    return "playing";
  }

  const lastPettedAt = pet.lastPettedAt ?? null;
  if (lastPettedAt !== null && nowMs - Date.parse(lastPettedAt) < PET_WINDOW_MS) {
    return "petted";
  }

  // Sleeping: check pause
  const lastPause = pet.pauseIntervals[pet.pauseIntervals.length - 1];
  if (lastPause !== undefined && lastPause.resumedAt === null) return "sleeping";

  // Personality → idle variant
  const dominant = pet.personality.dominant;
  if (dominant === "Energetic" || dominant === "Curious") return "idle-energetic";
  if (dominant === "Stoic" || dominant === "Philosophical" || dominant === "Gruff") return "idle-stoic";

  return "idle-baseline";
}

// ---------------------------------------------------------------------------
// pickCompactFrame — pure dispatch function (DEC-016)
// ---------------------------------------------------------------------------

/**
 * Pure function: returns the compact frame for a given pet, scene, and tick.
 * tick = floor(Date.now() / REFRESH_MS) — deterministic cycling.
 * Same (pet, scene, tick) always returns the same frame.
 */
export function pickCompactFrame(
  pet: Pet,
  scene: SceneKey,
  tick: number
): CompactFrame {
  const frames = SCENE_FRAMES[scene];
  const index = tick % frames.length;
  const frame = frames[index];
  if (frame === undefined) {
    // Fallback: first frame of idle-baseline (invariant: always non-empty)
    return IDLE_BASELINE_FRAMES[0]!;
  }
  return frame;
}

// ---------------------------------------------------------------------------
// Eye-blink animation — minimum-viable life signal for static silhouettes.
// 4-tick cycle: 3 ticks open + 1 tick closed (tick % 4 === 2 = blink frame).
// Blink token MUST match the eye token's visible width so silhouette
// dimensions and the ≤60-col contract are preserved.
// ---------------------------------------------------------------------------

interface EyeAnim {
  /** Literal substring matched in the eye-bearing silhouette row. */
  readonly eyes: string;
  /** Replacement during the blink frame; same length as `eyes`. */
  readonly blink: string;
}

const EYE_ANIM: Record<EggType, Record<LifeStage, EyeAnim>> = {
  circuit: {
    hatchling: { eyes: "oo", blink: "__" },
    juvenile: { eyes: "oo", blink: "__" },
    adult: { eyes: "o-o", blink: "_-_" },
  },
  rune: {
    hatchling: { eyes: "..", blink: "__" },
    juvenile: { eyes: "..", blink: "__" },
    adult: { eyes: "..", blink: "__" },
  },
  shard: {
    hatchling: { eyes: "oo", blink: "__" },
    juvenile: { eyes: "oo", blink: "__" },
    adult: { eyes: "oo", blink: "__" },
  },
  bloom: {
    hatchling: { eyes: "oo", blink: "__" },
    juvenile: { eyes: "oo", blink: "__" },
    adult: { eyes: "oo", blink: "__" },
  },
};

/**
 * Apply the per-tick blink to a silhouette row. Returns `row` unchanged on
 * non-blink ticks (3 of every 4). Pure and deterministic — same (row,
 * species, stage, tick) always returns the same string.
 */
export function applyEyeBlink(
  row: string,
  species: EggType,
  stage: LifeStage,
  tick: number
): string {
  if (tick % 4 !== 2) return row;
  const { eyes, blink } = EYE_ANIM[species][stage];
  return row.replace(eyes, blink);
}

// ---------------------------------------------------------------------------
// XP bar fill helper (DEC-020)
// ---------------------------------------------------------------------------

/**
 * Compute the XP progress bar fill for a pet within their current level.
 *
 * Uses the DEC-020 cumulative XP curve (`xpToNext(L) = floor(2 · L^φ)`).
 * Returns the number of filled cells (0–14) in the 14-cell bar.
 *
 * Special cases:
 *   - Dead pet → 0 filled cells (hollow bar)
 *   - Ascendant (L ≥ LEVEL_CAP) → 14 filled cells (full bar)
 *   - Otherwise → `floor(((xp - floorXp) / span) * 14)`, clamped to [0, 14]
 *
 * Both `renderHudRow` (narrow tier) and `renderHudLeftGroup` (standard/wide
 * tier) use this — keep one source of truth for the bar formula. Do NOT
 * inline the legacy `xp % 1000 / 1000` stop-gap; that is the DEC-020 sawtooth
 * bug fixed in this commit.
 */
function xpBarFill(pet: Pet): { filled: number; empty: number } {
  if (pet.diedAt !== null) return { filled: 0, empty: 14 };
  const derivedLevel = deriveLevel(pet.xp);
  if (derivedLevel >= LEVEL_CAP) return { filled: 14, empty: 0 };

  const floorXp = cumulativeXpForLevel(derivedLevel);
  const nextXp = cumulativeXpForLevel(derivedLevel + 1);
  const span = Math.max(1, nextXp - floorXp);
  const ratio = Math.min(1, Math.max(0, (pet.xp - floorXp) / span));
  const filled = Math.floor(ratio * 14);
  return { filled, empty: 14 - filled };
}

// ---------------------------------------------------------------------------
// HUD row rendering
// ---------------------------------------------------------------------------

/**
 * Render the HUD bar (row 3) for a pet.
 * compact-frames.md §5 — Variant A layout.
 */
export function renderHudRow(
  pet: Pet,
  mood: MoodKey,
  totalPets: number,
  petIndex: number,
  mode: ColorMode,
  richGlyphs: boolean
): string {
  const derivedLevel = deriveLevel(pet.xp);
  const isAscendant = derivedLevel >= LEVEL_CAP;
  const isDead = pet.diedAt !== null;

  // XP bar fill — single source of truth via helper (DEC-020)
  const { filled, empty } = xpBarFill(pet);

  // Name: up to 12 chars
  const rawName = pet.name ?? pet.eggType;
  let nameStr = rawName.slice(0, 12).padEnd(12, " ");
  if (isAscendant) {
    // Replace trailing space with star suffix
    nameStr = nameStr.trimEnd().slice(0, 11).padEnd(11, " ") + "*";
  }

  // Level display
  let levelStr: string;
  if (isDead) {
    levelStr = "Lv \u2014   "; // "Lv —   " (7 chars)
  } else {
    const lvNum = String(derivedLevel).padStart(4, " ");
    levelStr = `Lv ${lvNum} `;
  }

  // XP bar (14 inner cells + 2 brackets = 16 total)
  const xpBarStr =
    "[" +
    "\u2588".repeat(filled) +
    "\u2591".repeat(empty) +
    "]";

  // XP text
  let xpText: string;
  if (isDead) {
    xpText = "         "; // 9 spaces
  } else if (isAscendant) {
    xpText = "\u221e        "; // "∞" + spaces
  } else {
    const xpStr = String(pet.xp);
    xpText = xpStr.slice(0, 9).padEnd(9, " ");
  }

  // Mood glyph
  const moodDef = MOOD_GLYPHS[mood];
  const moodGlyph = richGlyphs ? moodDef.emoji : moodDef.ascii;
  const moodColor = PALETTE[moodDef.color];

  // Pet count (omit when single pet)
  const petCount = totalPets > 1 ? ` [${petIndex + 1}/${totalPets}]` : "";

  // Assemble with colors
  const sep = " \u00b7 "; // " · "
  const speciesAccent = SPECIES_ACCENT[pet.eggType];

  if (mode === "none") {
    // Plain text: no ANSI
    return `${nameStr}${sep}${levelStr}${sep}${xpBarStr} ${xpText}${sep}${moodGlyph}${petCount}`;
  }

  const accentLevelToken = PALETTE["accent-level"];
  const textSecToken = PALETTE["text-secondary"];
  const surfaceMutedToken = PALETTE["surface-muted"];

  // Colorize each segment
  const nameC = nameStr; // text-primary = default, no coloring needed
  const levelC = colorize(levelStr, accentLevelToken, mode);

  // XP bar: filled cells use species accent, empty cells use surface-muted
  const xpBarColored =
    "[" +
    colorize("\u2588".repeat(filled), speciesAccent, mode) +
    colorize("\u2591".repeat(empty), surfaceMutedToken, mode) +
    "]";

  const xpTextC = colorize(xpText, textSecToken, mode);
  const moodC = colorize(moodGlyph, moodColor, mode);
  const petCountC = colorize(petCount, textSecToken, mode);

  return `${nameC}${sep}${levelC}${sep}${xpBarColored} ${xpTextC}${sep}${moodC}${petCountC}`;
}

// ---------------------------------------------------------------------------
// Full frame assembly: silhouette rows + HUD row
// ---------------------------------------------------------------------------

/**
 * Assemble the final 3-row compact output for a pet:
 *   Row 1: silhouette top
 *   Row 2: silhouette bottom
 *   Row 3: HUD row
 *
 * For death and level-up scenes, uses the scene's own content as rows 1-2.
 */
export function assembleCompactOutput(
  pet: Pet,
  sceneKey: SceneKey,
  tick: number,
  mode: ColorMode,
  richGlyphs: boolean,
  totalPets: number,
  petIndex: number
): string {
  const nowMs = Date.now();
  const mood = deriveMood(pet, nowMs);
  const frame = pickCompactFrame(pet, sceneKey, tick);

  // For death and level-up, the frame content already has its own rows.
  // For all other scenes, prefer per-species authored frames (TODO-025).
  // If species art is missing and the scene is a *reactive* one (eating /
  // playing / petted / sick / sleeping), fall back to the generic
  // SCENE_FRAMES content — those frames are explicitly designed to look
  // different from idle, so reusing the species silhouette would defeat
  // the whole point of the reaction. Only idle-* scenes fall through to
  // the silhouette + eye-blink path, since idle's intent is "show the
  // species at rest."
  let artRows: string;
  if (sceneKey === "death" || sceneKey === "level-up") {
    artRows = frame.content;
  } else {
    const stage = getLifeStage(deriveLevel(pet.xp));
    const speciesFrames = getSpeciesCompactFrames(pet.eggType, stage, sceneKey);
    if (speciesFrames !== null) {
      // Per-species authored frames: pure tick-modulo lookup.
      const idx = tick % speciesFrames.length;
      artRows = speciesFrames[idx]!.content;
    } else if (
      sceneKey === "eating" ||
      sceneKey === "playing" ||
      sceneKey === "petted" ||
      sceneKey === "sick" ||
      sceneKey === "sleeping"
    ) {
      // Reactive scene without per-species art: render the generic
      // SCENE_FRAMES content — must visibly differ from idle.
      artRows = frame.content;
    } else {
      // idle-*: silhouette + eye-blink overlay.
      const sil = SILHOUETTES[pet.eggType][stage];
      const row0 = applyEyeBlink(sil.narrow[0], pet.eggType, stage, tick);
      artRows = row0 + "\n" + sil.narrow[1];
    }
  }

  const hudRow = renderHudRow(pet, mood, totalPets, petIndex, mode, richGlyphs);

  return hudRow + "\n" + artRows;
}

// ---------------------------------------------------------------------------
// Wide-tier dimension assertion
// ---------------------------------------------------------------------------

/**
 * Assert that all wide silhouette entries satisfy exactly 4 rows and each row's
 * visibleWidth ≤ WIDE_SILHOUETTE_MAX_COLS (18).
 * Also validates the character-set allowlist from statusline-wide-silhouettes.md §1.
 * Throws if any entry violates the contract.
 */
export function assertWideFrameDimensions(): void {
  // Character-set allowlist for silhouettes (statusline-wide-silhouettes.md §1)
  // Includes space and all listed characters.
  const ALLOWED = /^[\s()\[\]{}<>\/\\|\-_+*.,'":;~^oO0#=@vzZ]*$/;

  for (const species of Object.keys(SILHOUETTES) as EggType[]) {
    for (const stage of ["hatchling", "juvenile", "adult"] as LifeStage[]) {
      const entry = SILHOUETTES[species][stage];
      const wideRows = entry.wide;
      if (wideRows.length !== 4) {
        throw new Error(
          `Wide silhouette ${species}/${stage} has ${wideRows.length} rows (expected 4)`
        );
      }
      for (let r = 0; r < wideRows.length; r++) {
        const row = wideRows[r]!;
        const w = visibleWidth(row);
        if (w > WIDE_SILHOUETTE_MAX_COLS) {
          throw new Error(
            `Wide silhouette ${species}/${stage} row ${r} has ${w} visible cols (max ${WIDE_SILHOUETTE_MAX_COLS}): "${row}"`
          );
        }
        if (!ALLOWED.test(row)) {
          throw new Error(
            `Wide silhouette ${species}/${stage} row ${r} contains disallowed characters: "${row}"`
          );
        }
      }
    }
  }
}

// Run wide assertions at module load.
assertWideFrameDimensions();

// ---------------------------------------------------------------------------
// HUD left-group rendering (standard/wide tiers — mood is right-anchored)
// ---------------------------------------------------------------------------

/**
 * Render the HUD left group WITHOUT the trailing mood glyph.
 * Used at standard/wide tiers where mood is right-anchored.
 * Layout: `name · Lv NN · [bar] xpNum`
 * Uses compact variant (5.4b — no right-padding on name), single-space separators.
 */
function renderHudLeftGroup(
  pet: Pet,
  totalPets: number,
  petIndex: number,
  mode: ColorMode
): string {
  const derivedLevel = deriveLevel(pet.xp);
  const isAsc = derivedLevel >= LEVEL_CAP;
  const isDead = pet.diedAt !== null;

  // XP bar fill — single source of truth via helper (DEC-020)
  const { filled, empty } = xpBarFill(pet);

  // Name: compact variant — no right-padding (spec §5.4b)
  const rawName = pet.name ?? pet.eggType;
  let nameStr = rawName.slice(0, 12);
  if (isAsc) {
    nameStr = nameStr.slice(0, 11) + "*";
  }

  // Level display
  let levelStr: string;
  if (isDead) {
    levelStr = "Lv \u2014";
  } else {
    const lvNum = String(derivedLevel).padStart(2, " ");
    levelStr = `Lv ${lvNum}`;
  }

  // XP bar (14 inner + 2 brackets = 16 total)
  const xpBarStr = "[" + "\u2588".repeat(filled) + "\u2591".repeat(empty) + "]";

  // XP text (compact — just the raw number, no padding)
  let xpText: string;
  if (isDead) {
    xpText = "";
  } else if (isAsc) {
    xpText = "\u221e"; // ∞
  } else {
    xpText = String(pet.xp);
  }

  // Pet count (omit when single pet)
  const petCount = totalPets > 1 ? ` [${petIndex + 1}/${totalPets}]` : "";

  const sep = " \u00b7 "; // " · "
  const speciesAccent = SPECIES_ACCENT[pet.eggType];

  if (mode === "none") {
    return `${nameStr}${sep}${levelStr}${sep}${xpBarStr} ${xpText}${petCount}`;
  }

  const accentLevelToken = PALETTE["accent-level"];
  const textSecToken = PALETTE["text-secondary"];
  const surfaceMutedToken = PALETTE["surface-muted"];

  const nameC = nameStr;
  const levelC = colorize(levelStr, accentLevelToken, mode);

  const xpBarColored =
    "[" +
    colorize("\u2588".repeat(filled), speciesAccent, mode) +
    colorize("\u2591".repeat(empty), surfaceMutedToken, mode) +
    "]";

  const xpTextC = colorize(xpText, textSecToken, mode);
  const petCountC = colorize(petCount, textSecToken, mode);

  return `${nameC}${sep}${levelC}${sep}${xpBarColored} ${xpTextC}${petCountC}`;
}

// ---------------------------------------------------------------------------
// Wide/standard tier assembly (statusline-wide.md §4.2, §4.3)
// ---------------------------------------------------------------------------

/**
 * Assemble standard (3-row) or wide (4-row) output.
 *
 * Standard tier (80 ≤ cols < 140) — 3 rows:
 *   Row 1: HUD left group + " · " + mood glyph (pack-tight, no fill padding)
 *   Row 2: narrow silhouette row 1
 *   Row 3: narrow silhouette row 2
 *
 * Wide tier (cols ≥ 140) — 4 rows:
 *   Row 1: wide silhouette row 0 (art only)
 *   Row 2: wide silhouette row 1 (art only)
 *   Row 3: wide silhouette row 2 (art only)
 *   Row 4: wide silhouette row 3 + padding to WIDE_HUD_START_COL + HUD left group
 *           + " · " + mood glyph (pack-tight, no trailing fill)
 *
 * For death/level-up scenes the scene frame content replaces the silhouette rows
 * (padded with blank rows if the frame has fewer rows than the tier requires).
 *
 * `cols` must be the actual terminal column count (not undefined — caller
 * already classified tier; undefined → narrow → different function).
 */
export function assembleWideOutput(
  pet: Pet,
  tier: Tier,
  sceneKey: SceneKey,
  tick: number,
  mode: ColorMode,
  richGlyphs: boolean,
  totalPets: number,
  petIndex: number,
  _cols: number
): string {
  const nowMs = Date.now();
  const mood = deriveMood(pet, nowMs);
  const frame = pickCompactFrame(pet, sceneKey, tick);

  // Mood glyph (right anchor)
  const moodDef = MOOD_GLYPHS[mood];
  const moodGlyph = richGlyphs ? moodDef.emoji : moodDef.ascii;
  const moodColor = PALETTE[moodDef.color];
  const moodStr = mode === "none" ? moodGlyph : colorize(moodGlyph, moodColor, mode);

  // HUD left group (no mood)
  const hudLeft = renderHudLeftGroup(pet, totalPets, petIndex, mode);

  /**
   * Build a HUD row: pack-tight leftContent + " · " + mood.
   * Mood sits one separator past the last HUD atom — it is no longer
   * right-anchored to col (cols-2). Avoids dead-space gap when the right
   * group has only the mood glyph.
   */
  function buildHudRow(leftContent: string): string {
    return leftContent + " \u00b7 " + moodStr;
  }

  if (tier === "standard") {
    // Standard tier — 3 rows
    // Row 1: HUD row
    const hudRow = buildHudRow(hudLeft);

    // Rows 2-3: per-species authored frames (TODO-025) preferred; reactive
    // scenes (eating/playing/petted/sick/sleeping) fall back to generic
    // SCENE_FRAMES content rather than silhouette+blink so they visibly
    // differ from idle. idle-* and death/level-up keep their existing paths.
    let row2: string;
    let row3: string;
    if (sceneKey === "death" || sceneKey === "level-up") {
      const contentRows = frame.content.split("\n");
      row2 = contentRows[0] ?? "";
      row3 = contentRows[1] ?? "";
    } else {
      const stage = getLifeStage(deriveLevel(pet.xp));
      const speciesFrames = getSpeciesCompactFrames(pet.eggType, stage, sceneKey);
      if (speciesFrames !== null) {
        const idx = tick % speciesFrames.length;
        const contentRows = speciesFrames[idx]!.content.split("\n");
        row2 = contentRows[0] ?? "";
        row3 = contentRows[1] ?? "";
      } else if (
        sceneKey === "eating" ||
        sceneKey === "playing" ||
        sceneKey === "petted" ||
        sceneKey === "sick" ||
        sceneKey === "sleeping"
      ) {
        const contentRows = frame.content.split("\n");
        row2 = contentRows[0] ?? "";
        row3 = contentRows[1] ?? "";
      } else {
        const sil = SILHOUETTES[pet.eggType][stage];
        row2 = applyEyeBlink(sil.narrow[0], pet.eggType, stage, tick);
        row3 = sil.narrow[1];
      }
    }

    return hudRow + "\n" + row2 + "\n" + row3;
  }

  // Wide tier — 4 rows
  // Rows 1-3: wide silhouette rows 0-2 (art only)
  // Row 4: wide silhouette row 3 + HUD content
  let wideRows: readonly [string, string, string, string];

  if (sceneKey === "death" || sceneKey === "level-up") {
    // Scene frame content replaces silhouette; pad to 4 rows with blank rows
    const contentRows = frame.content.split("\n");
    wideRows = [
      contentRows[0] ?? "",
      contentRows[1] ?? "",
      contentRows[2] ?? "",
      contentRows[3] ?? "",
    ];
  } else {
    const stage = getLifeStage(deriveLevel(pet.xp));
    const sil = SILHOUETTES[pet.eggType][stage];
    // Eye-blink lives on row 1 of the wide silhouette (eye-bearing row).
    wideRows = [
      sil.wide[0],
      applyEyeBlink(sil.wide[1], pet.eggType, stage, tick),
      sil.wide[2],
      sil.wide[3],
    ];
  }

  // Handle sleep particles for sleeping scene on wide tier.
  // Spec §3.3: z at col 15 row 2, Z at col 17 row 3 (1-indexed → array idx 1, 2).
  // We overlay them onto wideRows[1] and wideRows[2] if it's the sleeping scene.
  let artRow0 = wideRows[0];
  let artRow1 = wideRows[1];
  let artRow2 = wideRows[2];
  let artRow3 = wideRows[3];

  if (sceneKey === "sleeping") {
    // Alternate z/Z based on tick (frame cycling — 2 frame sleep cycle)
    const sleepFrameIdx = tick % 2;
    const zSmall = sleepFrameIdx === 0 ? " z" : " Z";
    const zBig = sleepFrameIdx === 0 ? "   Z" : "   z";
    // Append sleep particles to art rows 1 and 2 (indices 1 and 2)
    // Only if they don't already end at or beyond col 13 (safe to append)
    artRow1 = wideRows[1] + zSmall;
    artRow2 = wideRows[2] + zBig;
  }

  // Row 4: wide silhouette row 3 + space to WIDE_HUD_START_COL + HUD
  const silRow3Width = visibleWidth(artRow3);
  const padToHud = Math.max(0, WIDE_HUD_START_COL - silRow3Width);
  const row4Left = artRow3 + " ".repeat(padToHud) + hudLeft;
  const row4 = buildHudRow(row4Left);

  return artRow0 + "\n" + artRow1 + "\n" + artRow2 + "\n" + row4;
}

// ---------------------------------------------------------------------------
// Fallback frame (no pet state available)
// ---------------------------------------------------------------------------

/** Single-row neutral fallback when state is missing/invalid (exit 0). */
export const FALLBACK_OUTPUT = "glyphling \u00b7 no pet";

/**
 * TODO-038: Single-row fallback emitted when state.json exists but fails
 * schema/parse validation. Distinct from FALLBACK_OUTPUT so the user can
 * tell the file is present but corrupt, rather than simply not yet created.
 */
export const STALE_OUTPUT = "glyphling \u00b7 state stale";
