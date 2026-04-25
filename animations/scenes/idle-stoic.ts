/**
 * idle-stoic — 4 frames, 8 fps, loop
 *
 * Still, composed idle for Stoic + Philosophical dominant traits.
 * Eyes half-closed, minimal movement, one dust mote on frame 4.
 * Source: expanded-frames.md §5.2 idle-stoic
 */

import type { Scene } from "../types.js";

export const idleStoic: Scene = {
  id: "idle-stoic",
  trigger: { kind: "idle" },
  fps: 8,
  loop: true,
  frames: [
    {
      rows: [
        "  /---[-_-]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[-.-]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[-_-]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 4 — single dust mote
      rows: [
        "  /---[-.-]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
      effectRow: "                .   ",
    },
  ],
  compact: [
    {
      rows: [
        " /[-_-]\\ ",
        " +=|--|=+",
      ],
    },
    {
      rows: [
        " /[-.-]\\ ",
        " +=|--|=+",
      ],
    },
  ],
};
