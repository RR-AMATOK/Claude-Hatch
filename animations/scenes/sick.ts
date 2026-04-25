/**
 * sick — 8 frames, 6 fps, loop
 *
 * Neglect > 1 day < 2.5 days. Drooping silhouette, x-eyes, subtle shiver.
 * Source: expanded-frames.md §4.6 sick + compact-frames.md §4.4
 */

import type { Scene } from "../types.js";

export const sick: Scene = {
  id: "sick",
  trigger: { kind: "state", when: "sick" },
  fps: 6,
  loop: true,
  frames: [
    {
      // droop
      rows: [
        "  /---[x-o]---\\ ",
        "  +/== |..| ==\\+",
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
      // worse droop
      rows: [
        "  /---[x-x]---\\ ",
        "  +/== |..| ==\\+",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[x-o]---\\ ",
        "  +/== |..| ==\\+",
        "  +====+====+   ",
      ],
    },
    {
      // shiver
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
        "  /---[x-o]---\\ ",
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
  ],
  compact: [
    {
      rows: [
        " /[x-o]\\ ",
        " +/|..|\\+",
      ],
      palette: { "error-muted": true },
    },
    {
      rows: [
        " /[x-x]\\ ",
        " +/|..|\\+",
      ],
      palette: { "error-muted": true },
    },
    {
      rows: [
        " /[x-x]\\ ",
        "  \\|..|/ ",
      ],
      palette: { "error-muted": true },
    },
  ],
};
