/**
 * play-chase — 16 frames, 15 fps, one-shot → idle-baseline
 *
 * High-energy play (arousal > 0.6). Silhouette pivots, effectRow shows fleeing glyph.
 * Source: expanded-frames.md §4.6 play-chase
 */

import type { Scene } from "../types.js";

export const playChase: Scene = {
  id: "play-chase",
  trigger: { kind: "command", command: "play" },
  fps: 15,
  loop: false,
  chainsTo: "idle-baseline",
  frames: [
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "  .                 ",
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |/-| ===|",
        "  +====+====+   ",
      ],
      effectRow: "    .               ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |/-| ===|",
        "  +=====+===+   ",
      ],
      effectRow: "      ·             ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "        *           ",
    },
    {
      rows: [
        "  /---[o-^]---\\ ",
        "  |=== |--| ===|",
        "  +=====+===+   ",
      ],
      effectRow: "          ·         ",
    },
    {
      rows: [
        "  /---[^-o]---\\ ",
        "  |=== |-\\| ===|",
        "  +====+====+   ",
      ],
      effectRow: "            .       ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |-\\| ===|",
        "  +=====+===+   ",
      ],
      effectRow: "              *     ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "                ·   ",
    },
    // Turn around — coming back
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |\\-| ===|",
        "  +====+====+   ",
      ],
      effectRow: "                .   ",
    },
    {
      rows: [
        "  /---[^-o]---\\ ",
        "  |=== |\\-| ===|",
        "  +=====+===+   ",
      ],
      effectRow: "              ·     ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "            *       ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |/-| ===|",
        "  +=====+===+   ",
      ],
      effectRow: "          .         ",
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +=====+===+   ",
      ],
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
  ],
  // Compact: reuse idle-energetic / chipper compact (expanded-frames.md §8.3)
  compact: [
    {
      rows: [
        " /[o-o]\\ .",
        " +=|--|=+  ",
      ],
    },
    {
      rows: [
        " /[^-^]\\ ",
        " +=|/-|=+",
      ],
    },
    {
      rows: [
        " /[^-^]\\ *",
        " +=|--|=+  ",
      ],
    },
    {
      rows: [
        " /[o-o]\\ ",
        " +=|\\-|=+",
      ],
    },
  ],
};
