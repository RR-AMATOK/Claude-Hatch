/**
 * Species silhouette tokens — compact-frames.md §3.2 + expanded-frames.md §4.2
 *
 * Per-species, per-stage ASCII character sets used by scene files.
 * Scenes use these tokens so a single edit here propagates to all scenes.
 * Species: circuit | rune | shard | bloom (DEC-017 lowercase).
 * Stages: hatchling (L0–2) | juvenile (L3–9) | adult (L10–1024).
 */

import type { LifeStage, Species } from "./types.js";

// ---------------------------------------------------------------------------
// Compact silhouette (2 rows × 6–10 cols per compact-frames.md §3.2)
// ---------------------------------------------------------------------------

export interface CompactSilhouette {
  /** Top row of the pet silhouette (eyes, head). */
  top: string;
  /** Bottom row (body, limbs, base). */
  bottom: string;
}

const COMPACT_SILHOUETTES: Record<Species, Record<LifeStage, CompactSilhouette>> = {
  circuit: {
    hatchling: { top: " [oo]  ", bottom: "  ||   " },
    juvenile: { top: " /[oo]\\ ", bottom: " +-||-+ " },
    adult:    { top: " /[o-o]\\ ", bottom: " +=|--|=+" },
  },
  rune: {
    hatchling: { top: " <..>  ", bottom: "  \\/   " },
    juvenile: { top: " <^..^> ", bottom: "  \\||/  " },
    adult:    { top: " <^-..-^>", bottom: "  \\|||/  " },
  },
  shard: {
    hatchling: { top: " /oo\\  ", bottom: " \\\\//  " },
    juvenile: { top: " /*oo*\\ ", bottom: " \\\\||// " },
    adult:    { top: "/**oo**\\", bottom: "\\\\\\||///" },
  },
  bloom: {
    hatchling: { top: " (oo)  ", bottom: "  vv   " },
    juvenile: { top: " (~oo~) ", bottom: "  \\vv/  " },
    adult:    { top: "(~*oo*~)", bottom: " ~\\vv/~ " },
  },
};

export function getCompactSilhouette(species: Species, stage: LifeStage): CompactSilhouette {
  return COMPACT_SILHOUETTES[species][stage];
}

// ---------------------------------------------------------------------------
// Expanded silhouette (3–4 rows × 12–16 cols per expanded-frames.md §4.2)
// ---------------------------------------------------------------------------

export interface ExpandedSilhouette {
  /** Rows making up the full expanded pet body (no effectRow/shadowRow). */
  rows: readonly string[];
  /** Default shadowRow character string for grounded scenes. */
  shadowRow: string;
  /** Aura effectRow for ascended pets (post L1024). */
  ascendAura: string;
}

const EXPANDED_SILHOUETTES: Record<Species, Record<LifeStage, ExpandedSilhouette>> = {
  circuit: {
    hatchling: {
      rows: [
        "     /[oo]\\     ",
        "      \\||/      ",
        "    --+--+--    ",
      ],
      shadowRow: "   ~~~~~~~~~~~   ",
      ascendAura: "   · · · · ·     ",
    },
    juvenile: {
      rows: [
        "   /--[oo]--\\   ",
        "   +=- || -=+   ",
        "   +===++===+   ",
      ],
      shadowRow: "   ~~~~~~~~~~~   ",
      ascendAura: "   · · · · ·     ",
    },
    adult: {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      shadowRow: "   ~~~~~~~~~~~~~ ",
      ascendAura: "   · · · · ·     ",
    },
  },
  rune: {
    hatchling: {
      rows: [
        "     <..>       ",
        "      \\/        ",
        "     ;; ;;      ",
      ],
      shadowRow: "   ~~~~~~~~~~~   ",
      ascendAura: "   · * · * ·     ",
    },
    juvenile: {
      rows: [
        "   <^..^>       ",
        "    \\||/        ",
        "   ;;=;;=;;     ",
      ],
      shadowRow: "   ~~~~~~~~~~~   ",
      ascendAura: "   · * · * ·     ",
    },
    adult: {
      rows: [
        "  <^--.--^>     ",
        "   \\=|||=/      ",
        "  ;;~=~=~;;     ",
      ],
      shadowRow: "   ~~~~~~~~~~~~~  ",
      ascendAura: "   · * · * ·     ",
    },
  },
  shard: {
    hatchling: {
      rows: [
        "     /oo\\       ",
        "     \\\\//       ",
        "    ^^^^^^      ",
      ],
      shadowRow: "   ~~~~~~~~~~~   ",
      ascendAura: "   * · * · *     ",
    },
    juvenile: {
      rows: [
        "   /*oo*\\       ",
        "   \\\\||//       ",
        "   ^^^^^^^^     ",
      ],
      shadowRow: "   ~~~~~~~~~~~   ",
      ascendAura: "   * · * · *     ",
    },
    adult: {
      rows: [
        "  /**oo**\\      ",
        "  \\\\\\||///      ",
        "  ^^^^^^^^^^    ",
      ],
      shadowRow: "   ~~~~~~~~~~~~~  ",
      ascendAura: "   * · * · *     ",
    },
  },
  bloom: {
    hatchling: {
      rows: [
        "     (oo)       ",
        "      vv        ",
        "    ~~vv~~      ",
      ],
      shadowRow: "   ~~~~~~~~~~~   ",
      ascendAura: "   , · * · ,     ",
    },
    juvenile: {
      rows: [
        "   (~oo~)       ",
        "    \\vv/        ",
        "  ~~~\\vv/~~~    ",
      ],
      shadowRow: "   ~~~~~~~~~~~   ",
      ascendAura: "   , · * · ,     ",
    },
    adult: {
      rows: [
        "  (~*oo*~)      ",
        "   ~\\vv/~       ",
        " ~~~*\\vv/*~~~   ",
      ],
      shadowRow: "   ~~~~~~~~~~~~~  ",
      ascendAura: "   , · * · ,     ",
    },
  },
};

export function getExpandedSilhouette(species: Species, stage: LifeStage): ExpandedSilhouette {
  return EXPANDED_SILHOUETTES[species][stage];
}

// ---------------------------------------------------------------------------
// Hatching egg shapes per species (for hatch-crack / hatch-emerge)
// ---------------------------------------------------------------------------

export const EGG_SHAPES: Record<Species, readonly string[]> = {
  circuit: [
    "     .----.     ",
    "    |  []  |    ",
    "    | .-.  |    ",
    "    | |*|  |    ",
    "    |  -   |    ",
    "     '----'     ",
  ],
  rune: [
    "     .----.     ",
    "    |  /\\  |    ",
    "    | .^.  |    ",
    "    | |*|  |    ",
    "    |  -   |    ",
    "     '----'     ",
  ],
  shard: [
    "     /----\\     ",
    "    /  /\\  \\    ",
    "    | .*.  |    ",
    "    | |*|  |    ",
    "    |  -   |    ",
    "     \\----/     ",
  ],
  bloom: [
    "     (----) .   ",
    "    ( ~()~ )    ",
    "    ( .v.  )    ",
    "    ( |*|  )    ",
    "    (  -   )    ",
    "     (----) .   ",
  ],
};

// ---------------------------------------------------------------------------
// Species-specific death dissolve characters (expanded-frames.md §4.5 Scene 20)
// ---------------------------------------------------------------------------

export const DEATH_DISSOLVE: Record<Species, { chars: string; last: string }> = {
  circuit: { chars: "=-.·", last: "+" },
  rune:    { chars: "^·",   last: "." },
  shard:   { chars: "/\\,'", last: "o" },
  bloom:   { chars: "~,",   last: "v" },
};

// ---------------------------------------------------------------------------
// Species-specific effectRow vocabulary (expanded-frames.md §4.2 table)
// ---------------------------------------------------------------------------

export const EFFECT_VOCAB: Record<Species, {
  idle: string;
  action: string;
  sparkle: string;
}> = {
  circuit: {
    idle:    "                    ",
    action:  "      . ' *  '      ",
    sparkle: "    0 1 . ' * 1 0   ",
  },
  rune: {
    idle:    "                    ",
    action:  "     *' . . *'      ",
    sparkle: "    : * ·  · * :    ",
  },
  shard: {
    idle:    "                    ",
    action:  "    *..*  +  *..*   ",
    sparkle: "    /\\ * + * /\\    ",
  },
  bloom: {
    idle:    "                    ",
    action:  "    .,*' . .'*,.    ",
    sparkle: "   · ' , * ' · ,   ",
  },
};
