/**
 * hatch-crack — 18 frames, 10 fps, one-shot → hatch-emerge
 *
 * Phase 1 of hatching (~90s real time). Egg whole → cracks widen → shell splits.
 * Source: expanded-frames.md §4.5 Scene 17 + §8.3 new compact hatch
 *
 * Note: Uses circuit-egg shape as reference; species-specific shells
 * handled via getEggShapes() in species.ts. These frames are the
 * species-agnostic structural template.
 */

import type { Scene } from "../types.js";

export const hatchCrack: Scene = {
  id: "hatch-crack",
  trigger: { kind: "state", when: "hatching" },
  fps: 10,
  loop: false,
  chainsTo: "hatch-emerge",
  frames: [
    {
      // frame 1 — egg whole
      rows: [
        "      .----.     ",
        "     |      |   ",
        "     | .-.  |   ",
        "     | |*|  |   ",
        "     |  -   |   ",
        "      '----'     ",
      ],
    },
    {
      // frame 2 — barely visible hairline
      rows: [
        "      .----.     ",
        "     |  ,   |   ",
        "     | .-.  |   ",
        "     | |*|  |   ",
        "     |  -   |   ",
        "      '----'     ",
      ],
    },
    {
      // frame 3 — hairline clearer
      rows: [
        "      .----.     ",
        "     |  ,   |   ",
        "     | .'.  |   ",
        "     | |*|  |   ",
        "     |  -   |   ",
        "      '----'     ",
      ],
    },
    {
      // frame 4 — crack begins
      rows: [
        "      .----.     ",
        "     | /,   |   ",
        "     | .'.  |   ",
        "     | |*|  |   ",
        "     |  -   |   ",
        "      '----'     ",
      ],
    },
    {
      rows: [
        "      .----.     ",
        "     | /,   |   ",
        "     | .'.  |   ",
        "     | |*|  |   ",
        "     |  x   |   ",
        "      '----'     ",
      ],
    },
    {
      // frame 6 — shudder (slight shift)
      rows: [
        "      .----.     ",
        "     |  /,   |  ",
        "     |  .'.  |  ",
        "     |  |*|  |  ",
        "     |   x   |  ",
        "      '----'     ",
      ],
    },
    {
      // frame 7 — back
      rows: [
        "      .----.     ",
        "     | /,   |   ",
        "     | .'.  |   ",
        "     | |*|  |   ",
        "     |  x   |   ",
        "      '----'     ",
      ],
    },
    {
      // frame 8 — crack widens
      rows: [
        "      .----.     ",
        "     | \\,   |   ",
        "     | ).'  |   ",
        "     | |*|  |   ",
        "     |  x   |   ",
        "      '----'     ",
      ],
    },
    {
      rows: [
        "      .----.     ",
        "     | \\/   |   ",
        "     | )'   |   ",
        "     | |*|  |   ",
        "     |  x   |   ",
        "      '----'     ",
      ],
    },
    {
      rows: [
        "      .--..      ",
        "     | \\/  |    ",
        "     | )(   |   ",
        "     | |*|  |   ",
        "     |  x   |   ",
        "      '-'--'     ",
      ],
    },
    {
      // frame 11 — egg leans
      rows: [
        "      .----.     ",
        "     | \\/   |   ",
        "     | )('  |   ",
        "     | |*|  |   ",
        "     |  x   |   ",
        "      '----'     ",
      ],
    },
    {
      rows: [
        "      .--..      ",
        "     | \\/ |     ",
        "     | )( |     ",
        "     | |*||     ",
        "     |  X ||    ",
        "      '-'-'      ",
      ],
    },
    {
      rows: [
        "      .--..      ",
        "     | //'\\ |   ",
        "     | )(    |  ",
        "     | |**|| |  ",
        "     |  X   |   ",
        "      '-'--'     ",
      ],
    },
    {
      rows: [
        "      .--..      ",
        "     | //'\\ |   ",
        "     | )('l |   ",
        "     | |**|| |  ",
        "     |  X   |   ",
        "      '-'--'     ",
      ],
    },
    {
      // frame 15 — effectRow sparks
      rows: [
        "      .--..      ",
        "     | //'\\ |   ",
        "     | )('l |   ",
        "     | |**|| |  ",
        "     |  X   |   ",
        "      '-'--'     ",
      ],
      effectRow: "     . ' .          ",
    },
    {
      rows: [
        "      .--..      ",
        "     | //'\\ |   ",
        "     | )('l |   ",
        "     | |**|| |  ",
        "     |  X   |   ",
        "      '-'--.     ",
      ],
      effectRow: "    .' * '.         ",
    },
    {
      rows: [
        "      /\\ __ /\\   ",
        "     (  ..  )    ",
        "     / |||| \\    ",
        "     '------'    ",
        "                 ",
        "                 ",
      ],
      effectRow: "    * ' * ' *       ",
    },
    {
      // frame 18 — shell split
      rows: [
        "      /\\ __ /\\   ",
        "     (  ..  )    ",
        "     / |||| \\    ",
        "     '------'    ",
        "                 ",
        "                 ",
      ],
      effectRow: "   * ' . * ' .      ",
    },
  ],
  // New compact hatch scene (expanded-frames.md §8.3)
  compact: [
    {
      // egg whole
      rows: [
        " .----. ",
        " |  * | ",
      ],
    },
    {
      // hairline crack
      rows: [
        " .--,--.",
        " | ,*  |",
      ],
    },
    {
      // crack widens
      rows: [
        " .--\\/--.",
        " | )(* | ",
      ],
    },
    {
      // shell splits / peek
      rows: [
        " /\\__/\\ ",
        "(  ..  )",
      ],
    },
  ],
};
