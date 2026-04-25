/**
 * sick-worse — 8 frames, 4 fps, loop
 *
 * Neglect > 2.5 days (pre-death). Same structure as sick but at 4 fps (lethargy).
 * Source: expanded-frames.md §4.6 sick-worse
 */

import type { Scene } from "../types.js";

export const sickWorse: Scene = {
  id: "sick-worse",
  trigger: { kind: "state", when: "sick" },
  fps: 4,
  loop: true,
  frames: [
    {
      rows: [
        "  /---[x-x]---\\ ",
        "  +/== |..| ==\\+",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[x-x]---\\ ",
        "   \\== |..| ==/  ",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[x-x]---\\ ",
        "  +/== |..| ==\\+",
        "   ===========  ",
      ],
    },
    {
      rows: [
        "  /---[x-x]---\\ ",
        "   \\== |..| ==/  ",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[x-x]---\\ ",
        "  +/== |..| ==\\+",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[x-x]---\\ ",
        "   \\== |..| ==/  ",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[x-x]---\\ ",
        "  +/== |..| ==\\+",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[x-x]---\\ ",
        "   \\== |..| ==/  ",
        "   ====+====     ",
      ],
    },
  ],
  // Compact: reuse sick compact with slower feel (expanded-frames.md §8.3)
  compact: [
    {
      rows: [
        " /[x-x]\\ ",
        " +/|..|\\+",
      ],
      palette: { "error": true },
    },
    {
      rows: [
        " /[x-x]\\ ",
        "  \\|..|/ ",
      ],
      palette: { "error": true },
    },
    {
      rows: [
        " /[x-x]\\ ",
        " +/|..|\\+",
      ],
      palette: { "error": true },
    },
  ],
};
