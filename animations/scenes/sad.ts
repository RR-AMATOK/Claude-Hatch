/**
 * sad — 6 frames, 6 fps, loop (short-duration, ≤30s per spec §9.6)
 *
 * Hungry > 12h AND not sick, or post-failed interaction.
 * Drooped silhouette with u_u eyes (not x — not sick, just sad).
 * Source: expanded-frames.md §4.6 sad + §8.3 new compact sad
 */

import type { Scene } from "../types.js";

export const sad: Scene = {
  id: "sad",
  trigger: { kind: "state", when: "sick" },
  fps: 6,
  loop: true,
  frames: [
    {
      rows: [
        "  /---[u_u]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // droop
      rows: [
        "  /---[u.u]---\\ ",
        "  +/== |--| ==\\+",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[u_u]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[u_u]---\\ ",
        "  +/== |..| ==\\+",
        "  +====+====+   ",
      ],
    },
    {
      rows: [
        "  /---[u.u]---\\ ",
        "  |=== |--| ===|",
        "  +====+====+   ",
      ],
    },
    {
      // shifted shadow — slightly sad
      rows: [
        "  /---[u_u]---\\ ",
        "  +/== |..| ==\\+",
        "  +====+====+   ",
      ],
      shadowRow: "    ~~~~~~~~~~~~    ",
    },
  ],
  // New compact sad scene (expanded-frames.md §8.3)
  compact: [
    {
      rows: [
        " /[u_u]\\ ",
        " +=|--|=+",
      ],
      palette: { "error-muted": true },
    },
    {
      rows: [
        " /[u.u]\\ ",
        " +/|..|\\+",
      ],
      palette: { "error-muted": true },
    },
  ],
};
