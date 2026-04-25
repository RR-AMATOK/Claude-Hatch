/**
 * idle-chipper — 10 frames, 10 fps, loop
 *
 * High-energy idle for Energetic + Friendly dominant traits.
 * Eye alternates neutral/joy, body bobs, occasional effectRow dot.
 * Source: expanded-frames.md §5.2 idle-chipper
 */

import type { Scene } from "../types.js";

export const idleChipper: Scene = {
  id: "idle-chipper",
  trigger: { kind: "idle" },
  fps: 10,
  loop: true,
  frames: [
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
        "  |=== |/-| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // joy eyes frame 3
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
      // effectRow dot — paying attention
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "          ·         ",
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // joy eyes frame 7, bob
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +=====+===+   ",
      ],
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |\\-| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // joy eyes frame 9
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
  ],
  compact: [
    {
      rows: [
        " /[O-o]\\ ",
        " +=|/-|=+",
      ],
    },
    {
      rows: [
        " /[o-O]\\ ",
        " +=|-\\|=+",
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
        " /[o-o]\\ ",
        " +=|--|=+",
      ],
    },
  ],
};
