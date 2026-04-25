/**
 * ascend-1024 — 30 frames, 30 fps, one-shot, fires ONCE per pet
 *
 * The L1024 mythic one-shot. Silence → gold aura builds → lifts off →
 * peak halo + title → settles with permanent aura.
 * Source: expanded-frames.md §4.5 Scene 22 + §6.2 + §8.3 new compact ascend
 *
 * Reduced-motion: frames [0, 6, 12, 18, 24] only (5 key beats).
 */

import type { Scene } from "../types.js";

export const ascend1024: Scene = {
  id: "ascend-1024",
  trigger: { kind: "event", event: "ascend" },
  fps: 30,
  loop: false,
  chainsTo: "idle-baseline",
  reducedMotionFps: 10,
  reducedMotionFrameIndices: [0, 6, 12, 18, 24],
  frames: [
    // frames 1–6 — silence, silhouette stills (identical neutral pose)
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
    // frames 7–12 — gold aura begins to grow
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "       .            ",
      shadowRow: "    ~~~~~~~~~       ",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "     . . .          ",
      shadowRow: "   ~~~~~~~~~~~~~    ",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "   * . * . *        ",
      shadowRow: "  ~~~~~~~~~~~~~~~   ",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "  * . * . * .       ",
      shadowRow: " ~~~~~~~~~~~~~~~~~  ",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: " * . * . * . *      ",
      shadowRow: "~~~~~~~~~~~~~~~~~   ",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "* . * . * . * .     ",
      shadowRow: "~~~~~~~~~~~~~~~~~~~",
      palette: { "level-up": true },
    },
    // frames 13–18 — silhouette lifts off ground, gold cycle
    {
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: " * · * · * · *      ",
      shadowRow: "~~~~~~~~~~~~~~~~~~~",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "                 ",
      ],
      effectRow: "  * · * · * · *     ",
      shadowRow: "~~~~~~~~~~~~~~~~~~~",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "                 ",
      ],
      effectRow: " * · * · * · * ·    ",
      shadowRow: "~~~~~~~~~~~~~~~~~~~",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "                 ",
      ],
      effectRow: "* · * · * · * · *   ",
      shadowRow: "~~~~~~~~~~~~~~~~~~~",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "                 ",
      ],
      effectRow: " * · * · * · *      ",
      shadowRow: "~~~~~~~~~~~~~~~~~~~",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "                 ",
      ],
      effectRow: "  * · * · * ·       ",
      shadowRow: "~~~~~~~~~~~~~~~~~~~",
      palette: { "level-up": true },
    },
    // frames 19–24 — peak: full gold halo + title moment
    {
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "                 ",
      ],
      effectRow: "  * · * · * · *     ",
      shadowRow: " ~~~~~~~~~~~~~~~~~  ",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "                 ",
      ],
      effectRow: "* · * · * · * · *   ",
      shadowRow: "~~~~~~~~~~~~~~~~~~~",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "                 ",
      ],
      effectRow: " * · * · * · *      ",
      shadowRow: "  ~~~~~~~~~~~~~~~~~  ",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "                 ",
      ],
      effectRow: "  * · * · * · *     ",
      shadowRow: " ~~~~~~~~~~~~~~~~~  ",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "                 ",
      ],
      effectRow: "* · * · * · * · *   ",
      shadowRow: "~~~~~~~~~~~~~~~~~~~",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "                 ",
      ],
      effectRow: " * · * · * · *      ",
      shadowRow: " ~~~~~~~~~~~~~~~~~  ",
      palette: { "level-up": true },
    },
    // frames 25–30 — settles back, aura persists (softer)
    {
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "   · · · · ·        ",
      shadowRow: "   ~~~~~~~~~~~~~    ",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "   · · · · ·        ",
      shadowRow: "   ~~~~~~~~~~~~~    ",
      palette: { "level-up": true },
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "   · · · · ·        ",
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "   · · · · ·        ",
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "   · · · · ·        ",
    },
    {
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "   · · · · ·        ",
    },
  ],
  // New compact ascend scene (expanded-frames.md §8.3)
  compact: [
    {
      // silhouette pre-aura
      rows: [
        " /[o-o]\\ ",
        " +=|--|=+",
      ],
    },
    {
      // gold aura adds
      rows: [
        "   · ·   ",
        " /[O-O]\\ ",
        " +=|--|=+",
      ],
      palette: { "level-up": true },
    },
    {
      // aura peaks
      rows: [
        " * · * · ",
        " /[O-O]\\ ",
        " +=|--|=+",
      ],
      palette: { "level-up": true },
    },
    {
      // settled aura (permanent)
      rows: [
        " · · · · ",
        " /[o-o]\\ ",
        " +=|--|=+",
      ],
      palette: { "level-up": true },
    },
  ],
};
