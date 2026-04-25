/**
 * play-bounce — 12 frames, 15 fps, one-shot → idle-baseline
 *
 * Pet play command. Silhouette shifts up/down, effectRow shows object being tossed.
 * Source: expanded-frames.md §4.6 play-bounce
 */

import type { Scene } from "../types.js";

export const playBounce: Scene = {
  id: "play-bounce",
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
      effectRow: "          .         ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +=====+===+   ",
      ],
      effectRow: "        o           ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "      o             ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +=====+===+   ",
      ],
      effectRow: "    .               ",
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
      effectRow: "          .         ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "            o       ",
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +=====+===+   ",
      ],
      effectRow: "              o     ",
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "          .         ",
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
        " +=|--|=+",
      ],
    },
    {
      rows: [
        " /[o-o]\\ .",
        " +=|--|=+  ",
      ],
    },
    {
      rows: [
        " /[^-^]\\ ",
        " +=|--|=+",
      ],
    },
  ],
};
