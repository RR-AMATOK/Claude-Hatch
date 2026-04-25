/**
 * idle-grumpy — 6 frames, 8 fps, loop
 *
 * Closed-off idle for Gruff dominant or Paranoid+low-Friendly.
 * Narrow eye glyphs, downturned mouth row, one "hmph" puff.
 * Source: expanded-frames.md §5.2 idle-grumpy
 */

import type { Scene } from "../types.js";

export const idleGrumpy: Scene = {
  id: "idle-grumpy",
  trigger: { kind: "idle" },
  fps: 8,
  loop: true,
  frames: [
    {
      rows: [
        "  /---[-_-]---\\ ",
        "  |=== |\\__/ ===|",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[·-·]---\\ ",
        "  |=== |\\__/ ===|",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[-_-]---\\ ",
        "  |=== |/--\\ ===|",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[·-·]---\\ ",
        "  |=== |\\__/ ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 5 — "hmph" puff
      rows: [
        "  /---[-_-]---\\ ",
        "  |=== |\\__/ ===|",
        "  +====+====+   ",
      ],
      effectRow: "            ^       ",
    },
    {
      rows: [
        "  /---[·-·]---\\ ",
        "  |=== |/--\\ ===|",
        "  +====+====+   ",
      ],
    },
  ],
  // Compact: reuse idle-stoic compact (expanded-frames.md §8.3 recommendation b)
  compact: [
    {
      rows: [
        " /[-_-]\\ ",
        " +=|\\__/=+",
      ],
    },
    {
      rows: [
        " /[·-·]\\ ",
        " +=|\\__/=+",
      ],
    },
  ],
};
