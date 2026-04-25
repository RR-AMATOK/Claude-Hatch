/**
 * hatch-emerge — 20 frames, 30 fps, one-shot → idle-baseline
 *
 * Phase 2 of hatch (final ~3s burst). Shell halves dissolve, hatchling rises.
 * Source: expanded-frames.md §4.5 Scene 18 + §8.3 new compact hatch.emerge
 */

import type { Scene } from "../types.js";

export const hatchEmerge: Scene = {
  id: "hatch-emerge",
  trigger: { kind: "state", when: "hatching" },
  fps: 30,
  loop: false,
  chainsTo: "idle-baseline",
  frames: [
    {
      // frame 1 — shell halves open
      rows: [
        "      /\\___/\\    ",
        "     (       )   ",
        "     \\       /   ",
        "      '-----'    ",
      ],
      effectRow: "                    ",
    },
    {
      rows: [
        "      /\\___/\\    ",
        "     ( ' ' ' )   ",
        "     \\   '   /   ",
        "      '-----'    ",
      ],
    },
    {
      rows: [
        "      /\\ __ /\\   ",
        "     (       )   ",
        "     \\ /    \\ /  ",
        "      '-----'    ",
      ],
    },
    {
      // frame 4 — small silhouette peeks out
      rows: [
        "      /\\___/\\    ",
        "     (       )   ",
        "     \\ /[oo]\\ /  ",
        "      '---||'    ",
      ],
      effectRow: "       . . .        ",
    },
    {
      rows: [
        "      /\\___/\\    ",
        "     ( /[oo]\\ )  ",
        "     \\ / || \\ /  ",
        "      '-----'    ",
      ],
      effectRow: "      .  .  .       ",
    },
    {
      rows: [
        "      /\\ [oo] /\\ ",
        "     (  / || \\  )",
        "     \\ /      \\ /",
        "      '-----'    ",
      ],
      effectRow: "     . ' . ' .      ",
    },
    {
      rows: [
        "         /[oo]\\  ",
        "     /\\ ( \\||/ ) /\\",
        "    (   \\      /  )",
        "     '------------'",
      ],
      effectRow: "    . ' * ' .       ",
    },
    {
      // frame 8 — silhouette rises, shell shards
      rows: [
        "          /[oo]\\ ",
        "           \\||/  ",
        "        /\\    /\\ ",
        "       (  \\  /  )",
      ],
      effectRow: "   .  '  *  '  .   ",
    },
    {
      rows: [
        "          /[oo]\\ ",
        "           \\||/  ",
        "         /\\  /\\  ",
        "        (  \\/  ) ",
      ],
      effectRow: "  . .' * '. .       ",
    },
    {
      rows: [
        "          /[oo]\\ ",
        "           \\||/  ",
        "           /\\    ",
        "          /  \\   ",
      ],
      effectRow: " .  *  ' .  *  .    ",
    },
    {
      rows: [
        "          /[oo]\\ ",
        "           \\||/  ",
        "          ----   ",
        "                 ",
      ],
      effectRow: "   * ' . ' *        ",
    },
    {
      // frame 12 — full hatchling stands
      rows: [
        "          /[oo]\\ ",
        "           ||    ",
        "                 ",
        "                 ",
      ],
      effectRow: " . dust . dust .    ",
    },
    {
      rows: [
        "          /[oo]\\ ",
        "           ||    ",
        "                 ",
        "                 ",
      ],
      effectRow: "  .  dust  .        ",
    },
    {
      rows: [
        "          /[oo]\\ ",
        "           ||    ",
        "                 ",
        "                 ",
      ],
      effectRow: "     .  .           ",
    },
    {
      rows: [
        "          /[oo]\\ ",
        "           ||    ",
        "                 ",
        "                 ",
      ],
      effectRow: "       .            ",
    },
    {
      // frame 16 — hatchling settles
      rows: [
        "          /[oo]\\ ",
        "           ||    ",
        "                 ",
        "                 ",
      ],
    },
    {
      rows: [
        "          /[oo]\\ ",
        "           ||    ",
        "                 ",
        "                 ",
      ],
    },
    {
      rows: [
        "          /[oo]\\ ",
        "           ||    ",
        "                 ",
        "                 ",
      ],
    },
    {
      rows: [
        "          /[oo]\\ ",
        "           ||    ",
        "                 ",
        "                 ",
      ],
    },
    {
      // frame 20 — first idle pose
      rows: [
        "          /[oo]\\ ",
        "           ||    ",
        "                 ",
        "                 ",
      ],
    },
  ],
  // New compact hatch.emerge scene (expanded-frames.md §8.3)
  compact: [
    {
      rows: [
        " /\\___/\\ ",
        "(  ..  ) ",
      ],
    },
    {
      rows: [
        " /[oo]\\ ",
        "  \\||/  ",
      ],
    },
    {
      rows: [
        " /[oo]\\ ",
        "   ||   ",
      ],
    },
    {
      rows: [
        " /[oo]\\ ",
        "   ||   ",
      ],
    },
  ],
};
