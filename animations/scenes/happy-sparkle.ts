/**
 * happy-sparkle — 14 frames, 15 fps, one-shot → idle-baseline
 *
 * End of eat-feast, end of play-chase, post level-up flourish.
 * EffectRow sparkle burst, joy eyes.
 * Source: expanded-frames.md §4.6 happy-sparkle + §8.3 new compact happy.sparkle
 */

import type { Scene } from "../types.js";

export const happySparkle: Scene = {
  id: "happy-sparkle",
  trigger: { kind: "event", event: "levelup" },
  fps: 15,
  loop: false,
  chainsTo: "idle-baseline",
  frames: [
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "        .           ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |~~| ===|",
        "  +====+====+   ",
      ],
      effectRow: "       .·.          ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |~~| ===|",
        "  +=====+===+   ",
      ],
      effectRow: "      *·*·*         ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |~~| ===|",
        "  +====+====+   ",
      ],
      effectRow: "    .*·*·*·*.       ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +=====+===+   ",
      ],
      effectRow: "   .·*·*·*·*.       ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |~~| ===|",
        "  +====+====+   ",
      ],
      effectRow: "     *·*·*·*        ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "       *·*          ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |~~| ===|",
        "  +=====+===+   ",
      ],
      effectRow: "        ·           ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[^-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |~~| ===|",
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
        "  /---[^-^]---\\ ",
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
  // New compact happy.sparkle scene (expanded-frames.md §8.3)
  compact: [
    {
      rows: [
        " /[^-^]\\ ",
        " +=|--|=+",
      ],
      palette: { "success": true },
    },
    {
      rows: [
        " /[^-^]\\ ",
        " +=|~~|=+",
      ],
      palette: { "success": true },
    },
    {
      rows: [
        " /[^-^]\\ ",
        " +=|--|=+",
      ],
      palette: { "success": true },
    },
    {
      rows: [
        " /[o-o]\\ ",
        " +=|--|=+",
      ],
    },
  ],
};
