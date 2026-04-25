/**
 * idle-baseline — 8 frames, 10 fps, loop
 *
 * Neutral gaze, blink, breath cycle. Default state for balanced personality
 * or Pragmatic/Friendly dominant traits.
 * Source: expanded-frames.md §4.5 Scene 1, compact-frames.md §4.1
 */

import type { Scene } from "../types.js";

export const idleBaseline: Scene = {
  id: "idle-baseline",
  trigger: { kind: "idle" },
  fps: 10,
  loop: true,
  frames: [
    {
      // frame 1 — neutral gaze
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 2 — gaze drift right
      rows: [
        "  /---[.-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 3 — gaze center, body shift
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |/-| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 4 — blink
      rows: [
        "  /---[-.-]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 5 — eyes reopen, look left
      rows: [
        "  /---[o-.]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 6 — neutral gaze, body variant
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |\\-| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 7 — breath-out (bottom shifts)
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |__| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // frame 8 — breath-in (returns)
      rows: [
        "  /---[o-o]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
  ],
  compact: [
    {
      // frame 1 — steady
      rows: [
        " /[o-o]\\ ",
        " +=|--|=+",
      ],
    },
    {
      // frame 2 — micro shift
      rows: [
        " /[o-o]\\ ",
        " +=|--|=+",
      ],
    },
    {
      // frame 3 — blink (wink)
      rows: [
        " /[o-~]\\ ",
        " +=|--|=+",
      ],
    },
    {
      // frame 4 — breath
      rows: [
        " /[o-o]\\ ",
        " +=|__|=+",
      ],
    },
  ],
};
