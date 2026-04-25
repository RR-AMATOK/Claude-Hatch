/**
 * eat-feast — 18 frames, 15 fps, one-shot → happy-sparkle
 *
 * Multi-feed or level-up-window feed. Two chew cycles, chains to happy-sparkle.
 * Source: expanded-frames.md §4.6 eat-feast
 */

import type { Scene } from "../types.js";

export const eatFeast: Scene = {
  id: "eat-feast",
  trigger: { kind: "command", command: "feed" },
  fps: 15,
  loop: false,
  chainsTo: "happy-sparkle",
  frames: [
    // Approach cycle 1
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "        .  *        ",
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "      .  *          ",
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "    .               ",
    },
    // Eat cycle 1
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |UU| ===|",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |OO| ===|",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |uu| ===|",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |~~| ===|",
        "  +====+====+   ",
      ],
    },
    // Second food item approaches
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |~~| ===|",
        "  +====+====+   ",
      ],
      effectRow: "       . *          ",
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "     .              ",
    },
    // Eat cycle 2 — more enthusiastic
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |UU| ===|",
        "  +=====+===+   ",
      ],
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |OO| ===|",
        "  +=====+===+   ",
      ],
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |uu| ===|",
        "  +=====+===+   ",
      ],
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |~~| ===|",
        "  +=====+===+   ",
      ],
    },
    // Post-feast glow
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |~~| ===|",
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
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |~~| ===|",
        "  +=====+===+   ",
      ],
    },
  ],
  // Compact: reuse eat compact (expanded-frames.md §8.3)
  compact: [
    {
      rows: [
        " /[o-o]\\ *",
        " +=|--|=+  ",
      ],
    },
    {
      rows: [
        " /[^-^]\\ ",
        " +=|UU|=+",
      ],
    },
    {
      rows: [
        " /[^-^]\\ ",
        " +=|~~|=+",
      ],
    },
  ],
};
