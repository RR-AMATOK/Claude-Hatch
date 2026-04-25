/**
 * levelup-flash — 10 frames, 30 fps, one-shot → idle-baseline
 *
 * Every level.up event. Spark appears, radial burst, settle.
 * Reduced-motion: frames [0, 3, 8] only (3 frames = anticipation/peak/resolution).
 * Source: expanded-frames.md §4.5 Scene 21 + compact-frames.md §4.5
 *
 * Enable reduced-motion via GLYPHLING_REDUCED_MOTION=1.
 */

import type { Scene } from "../types.js";

export const levelupFlash: Scene = {
  id: "levelup-flash",
  trigger: { kind: "event", event: "levelup" },
  fps: 30,
  loop: false,
  chainsTo: "idle-baseline",
  reducedMotionFps: 10,
  reducedMotionFrameIndices: [0, 3, 8],
  frames: [
    {
      // frame 1 — spark appears above
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "          *         ",
    },
    {
      // frame 2 — bigger spark, eyes widen
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "        * *         ",
    },
    {
      // frame 3 — radial burst peak start
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "      \\ * * /       ",
      palette: { "level-up": true },
    },
    {
      // frame 4 — burst wider
      rows: [
        "  /---[O-O]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "     \\* * * */      ",
      palette: { "level-up": true },
    },
    {
      // frame 5 — burst fades, joy eyes
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "       .  ' .       ",
      palette: { "level-up": true },
    },
    {
      // frame 6 — smile
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |~~| ===|",
        "  +====+====+   ",
      ],
      effectRow: "          .         ",
      palette: { "level-up": true },
    },
    {
      // frame 7 — settling
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 8 — nearly idle
      rows: [
        "  /---[o-^]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 9 — return to idle
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 10 — idle settled
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
  ],
  // Compact: from compact-frames.md §4.5
  compact: [
    {
      // frame 1 — spark above
      rows: [
        "      *     ",
        " /[o-o]\\ ",
        " +=|--|=+",
      ],
    },
    {
      // frame 2 — bigger spark, wide eyes
      rows: [
        "    * *     ",
        " /[O-O]\\ ",
        " +=|--|=+",
      ],
    },
    {
      // frame 3 — burst
      rows: [
        "   \\*|*/    ",
        " /[O-O]\\ ",
        " +=|--|=+",
      ],
      palette: { "level-up": true },
    },
    {
      // frame 4 — absorb / joy
      rows: [
        "   . ' .    ",
        " /[^-^]\\ ",
        " +=|--|=+",
      ],
      palette: { "level-up": true },
    },
    {
      // frame 5 — glow settle
      rows: [
        " /[o-o]\\ ",
        " +=|--|=+",
      ],
    },
  ],
};
