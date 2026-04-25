/**
 * death-fade — 14 frames, 10 fps, one-shot, final
 *
 * DEC-009 hybrid death. Silhouette droops, dissolves, tombstone materializes.
 * "Funeral, not error." Latches on frame 14 indefinitely.
 * Source: expanded-frames.md §4.5 Scene 20
 */

import type { Scene } from "../types.js";

export const deathFade: Scene = {
  id: "death-fade",
  trigger: { kind: "state", when: "dying" },
  fps: 10,
  loop: false,
  // No chainsTo — latches on last frame
  frames: [
    // frames 1–4 — silhouette droops, head lowers
    {
      rows: [
        "  /---[x-x]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[x.x]---\\ ",
        "  |\\== |__| ==/ |",
        "  +====+====+   ",
      ],
      shadowRow: "   -~~~~~~~~~~-     ",
    },
    {
      rows: [
        "  /---[x.x]---\\ ",
        "  |\\-- |__| --/ |",
        "  +====+====+   ",
      ],
      shadowRow: "   -~~~~~~~~~~-     ",
    },
    {
      rows: [
        "  /---[x.x]---\\ ",
        "  |\\-- .  . --/ |",
        "  +====+====+   ",
      ],
      shadowRow: "   -~~~~~~~~~-      ",
    },
    // frames 5–8 — silhouette tilts forward, shadowRow widens
    {
      rows: [
        "  /---[x.x]---\\  ",
        "  |\\-- . . --/ |  ",
        "  +=========+   ",
      ],
      shadowRow: "  -~~~~~~~~~-       ",
    },
    {
      rows: [
        "  /---[x.x]---\\  ",
        "  |\\-- . . --/ |  ",
        "  +=======+     ",
      ],
      shadowRow: "  -~~~~~~~~~~-      ",
    },
    {
      rows: [
        "  /---[x..x]--\\  ",
        "  |\\-- . . . --/ |",
        "  +=======+     ",
      ],
      shadowRow: "  -~~~~~~~~~~~~-    ",
    },
    {
      rows: [
        "  /---[x..x]--\\  ",
        "  |\\-- . . . --/ |",
        "  +====+         ",
      ],
      shadowRow: "  -~~~~~~~~~~~~~-   ",
    },
    // frames 9–12 — characters drop out progressively
    {
      rows: [
        "  /---[x..x]--\\  ",
        "  |\\-- . . --/ |  ",
        "  +===----===  ",
      ],
      shadowRow: "  ~~~~~~~~~~~~~~~~~~",
    },
    {
      rows: [
        "   ---[x  x]---  ",
        "   \\-- . . --/   ",
        "    ===----===   ",
      ],
      shadowRow: "  ~~~~~~~~~~~~~~~~~~",
    },
    {
      rows: [
        "    --[x  x]--   ",
        "     -- . . --   ",
        "     ..........  ",
      ],
      shadowRow: "  ~~~~~~~~~~~~~~~~~~",
    },
    {
      rows: [
        "     .[x  x].    ",
        "      .     .    ",
        "     ..........  ",
      ],
      shadowRow: "  ~~~~~~~~~~~~~~~~~~",
    },
    // frame 13 — tombstone materializes
    {
      rows: [
        "        RIP      ",
        "      [_____]    ",
        "     /       \\   ",
      ],
      shadowRow: "  ~~~~~~~~~~~~~~~~~~",
      palette: { "death": true },
    },
    // frame 14 — final static: tombstone + epitaph (latch here)
    {
      rows: [
        "        RIP      ",
        "      [_____]    ",
        "     /       \\   ",
      ],
      shadowRow: "  ~~~~~~~~~~~~~~~~~~",
      palette: { "death": true },
    },
  ],
  // Compact: 1 static frame (compact-frames.md §4.6)
  compact: [
    {
      rows: [
        "   RIP   ",
        "  [___]  ",
      ],
      palette: { "death": true },
    },
  ],
};
