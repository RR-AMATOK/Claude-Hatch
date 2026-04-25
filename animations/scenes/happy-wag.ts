/**
 * happy-wag — 12 frames, 12 fps, one-shot → idle-baseline
 *
 * Post-feed window (≤15s) or daily-checkin window. Silhouette sways left/right.
 * Source: expanded-frames.md §4.6 happy-wag + §8.3 new compact happy
 */

import type { Scene } from "../types.js";

export const happyWag: Scene = {
  id: "happy-wag",
  trigger: { kind: "event", event: "levelup" },
  fps: 12,
  loop: false,
  chainsTo: "idle-baseline",
  frames: [
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // sway left
      rows: [
        " /---[^-^]---\\  ",
        " |=== |--| ===| ",
        " +====+====+    ",
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
      // sway right
      rows: [
        "   /---[^-^]---\\",
        "   |=== |--| ===",
        "   +====+====+  ",
      ],
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |~~| ===|",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        " /---[^-^]---\\  ",
        " |=== |~~| ===| ",
        " +====+====+    ",
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
        "   /---[^-^]---\\",
        "   |=== |--| ===",
        "   +====+====+  ",
      ],
    },
    {
      rows: [
        "  /---[^-^]---\\ ",
        "  |=== |~~| ===|",
        "  +=====+===+   ",
      ],
    },
    {
      rows: [
        " /---[^-^]---\\  ",
        " |=== |--| ===| ",
        " +====+====+    ",
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
  ],
  // New compact happy scene (expanded-frames.md §8.3)
  compact: [
    {
      rows: [
        " /[^-^]\\ ",
        " +=|--|=+",
      ],
      palette: { "success": true },
    },
    {
      rows: [
        " /[^-^]\\ ",
        " +=|~~|=+",
      ],
      palette: { "success": true },
    },
    {
      rows: [
        " /[^-^]\\ ",
        " +=|--|=+",
      ],
      palette: { "success": true },
    },
  ],
};
