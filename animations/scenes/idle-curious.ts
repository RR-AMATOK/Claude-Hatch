/**
 * idle-curious — 8 frames, 10 fps, loop
 *
 * Outward-attentive idle for Curious dominant trait.
 * Gaze tracks around frequently, head-tilt on frame 5.
 * Source: expanded-frames.md §5.2 idle-curious
 */

import type { Scene } from "../types.js";

export const idleCurious: Scene = {
  id: "idle-curious",
  trigger: { kind: "idle" },
  fps: 10,
  loop: true,
  frames: [
    {
      // frame 1 — center gaze
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 2 — center hold
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 3 — look right
      rows: [
        "  /---[.-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 4 — re-center
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 5 — look up, head tilt (left bracket shifts)
      rows: [
        "  \\---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "            '       ",
    },
    {
      // frame 6 — look left
      rows: [
        "  /---[o-.]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 7 — re-center
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 8 — blink
      rows: [
        "  /---[-.-]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
  ],
  // Compact: reuse idle-baseline compact (expanded-frames.md §8.3 recommendation b)
  compact: [
    {
      rows: [
        " /[o-o]\\ ",
        " +=|--|=+",
      ],
    },
    {
      rows: [
        " /[.-o]\\ ",
        " +=|--|=+",
      ],
    },
    {
      rows: [
        " /[o-.]\\ ",
        " +=|--|=+",
      ],
    },
    {
      rows: [
        " /[o-~]\\ ",
        " +=|--|=+",
      ],
    },
  ],
};
