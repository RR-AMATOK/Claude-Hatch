/**
 * eat-small — 10 frames, 15 fps, one-shot → idle-baseline
 *
 * Single feed event. Food crumb approaches, pet munches and swallows.
 * Source: expanded-frames.md §4.5 Scene 6
 */

import type { Scene } from "../types.js";

export const eatSmall: Scene = {
  id: "eat-small",
  trigger: { kind: "command", command: "feed" },
  fps: 15,
  loop: false,
  chainsTo: "idle-baseline",
  frames: [
    {
      // frame 1 — food crumb approaches from right
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "        .           ",
    },
    {
      // frame 2 — crumb closer
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "      .             ",
    },
    {
      // frame 3 — crumb at lip
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "    .               ",
    },
    {
      // frame 4 — mouth opens
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |UU| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 5 — chew (happy eyes)
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |OO| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 6 — chew variation
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |uu| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 7 — swallow
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |~~| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 8 — content pause
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |~~| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 9 — mouth neutral
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 10 — satisfaction bob
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +=====+===+   ",
      ],
    },
  ],
  compact: [
    {
      // food approaching
      rows: [
        " /[o-o]\\ .",
        " +=|--|=+  ",
      ],
    },
    {
      // munching
      rows: [
        " /[^-^]\\ ",
        " +=|UU|=+",
      ],
    },
    {
      // happy chew
      rows: [
        " /[^-^]\\ ",
        " +=|~~|=+",
      ],
    },
  ],
};
