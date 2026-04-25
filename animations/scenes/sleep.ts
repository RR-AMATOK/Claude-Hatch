/**
 * sleep — 6 frames, 6 fps, loop
 *
 * Night bucket (00–06 local) or pause state. ZZ alternation above head.
 * Source: expanded-frames.md §4.6 sleep
 */

import type { Scene } from "../types.js";

export const sleep: Scene = {
  id: "sleep",
  trigger: { kind: "command", command: "sleep" },
  fps: 6,
  loop: true,
  frames: [
    {
      rows: [
        "  /---[-_-]---\\ ",
        "  |=== |..| ===|",
        "  +====+====+   ",
      ],
      effectRow: "          z         ",
    },
    {
      rows: [
        "  /---[-_-]---\\ ",
        "  |=== |..| ===|",
        "  +====+====+   ",
      ],
      effectRow: "          z Z       ",
    },
    {
      rows: [
        "  /---[-_-]---\\ ",
        "  |=== |..| ===|",
        "  +====+====+   ",
      ],
      effectRow: "            Z       ",
    },
    {
      rows: [
        "  /---[-_-]---\\ ",
        "  |=== |..| ===|",
        "  +====+====+   ",
      ],
      effectRow: "          Z         ",
    },
    {
      rows: [
        "  /---[-_-]---\\ ",
        "  |=== |..| ===|",
        "  +====+====+   ",
      ],
      effectRow: "          Z z       ",
    },
    {
      rows: [
        "  /---[-_-]---\\ ",
        "  |=== |..| ===|",
        "  +====+====+   ",
      ],
      effectRow: "            z       ",
    },
  ],
  compact: [
    {
      rows: [
        " /[-_-]\\ z",
        " +=|..|=+ Z",
      ],
    },
    {
      rows: [
        " /[-_-]\\ Z",
        " +=|..|=+ z",
      ],
    },
  ],
};
