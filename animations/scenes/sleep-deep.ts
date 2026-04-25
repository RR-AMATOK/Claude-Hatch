/**
 * sleep-deep — 4 frames, 4 fps, loop
 *
 * Pause sustained > 6 hours. Very slow, large Z characters.
 * Source: expanded-frames.md §4.6 sleep-deep
 */

import type { Scene } from "../types.js";

export const sleepDeep: Scene = {
  id: "sleep-deep",
  trigger: { kind: "command", command: "sleep" },
  fps: 4,
  loop: true,
  frames: [
    {
      rows: [
        "  /---[-_-]---\\ ",
        "  |=== |..| ===|",
        "  +====+====+   ",
      ],
      effectRow: "           Z        ",
      shadowRow: "   ~~~~~~~~~~~~~    ",
    },
    {
      rows: [
        "  /---[-_-]---\\ ",
        "  |=== |..| ===|",
        "  +====+====+   ",
      ],
      effectRow: "         Z Z        ",
      shadowRow: "   ~~~~~~~~~~~~~    ",
    },
    {
      rows: [
        "  /---[-_-]---\\ ",
        "  |=== |..| ===|",
        "  +====+====+   ",
      ],
      effectRow: "           Z        ",
      shadowRow: "   ~~~~~~~~~~~~~    ",
    },
    {
      rows: [
        "  /---[-_-]---\\ ",
        "  |=== |..| ===|",
        "  +====+====+   ",
      ],
      effectRow: "       Z   Z        ",
      shadowRow: "   ~~~~~~~~~~~~~    ",
    },
  ],
  // Compact: reuse sleep compact (expanded-frames.md §8.3)
  compact: [
    {
      rows: [
        " /[-_-]\\ Z",
        " +=|..|=+ Z",
      ],
    },
    {
      rows: [
        " /[-_-]\\ Z",
        " +=|..|=+  Z",
      ],
    },
  ],
};
