/**
 * evolve-shimmer — 24 frames, 30 fps, one-shot → idle-baseline
 *
 * Life-stage transition (hatchling→juvenile at L3, juvenile→adult at L10).
 * Silhouette pulses, shimmer builds, flash peak, new-stage fades in.
 * Source: expanded-frames.md §4.5 Scene 19 + §8.3 new compact evolve
 */

import type { Scene } from "../types.js";

export const evolveShimmer: Scene = {
  id: "evolve-shimmer",
  trigger: { kind: "state", when: "evolving" },
  fps: 30,
  loop: false,
  chainsTo: "idle-baseline",
  frames: [
    // frames 1–6 — silhouette pulses (size variance)
    {
      rows: [
        "          /[oo]\\ ",
        "           ||    ",
        "                 ",
      ],
    },
    {
      rows: [
        "         /[oo]\\ ",
        "          \\||/  ",
        "                ",
      ],
    },
    {
      rows: [
        "          /[oo]\\ ",
        "           ||    ",
        "                 ",
      ],
      palette: { "accent-level": true },
    },
    {
      rows: [
        "       /--[oo]--\\ ",
        "        +-|| -+   ",
        "                  ",
      ],
      palette: { "accent-level": true },
    },
    {
      rows: [
        "          /[oo]\\ ",
        "           ||    ",
        "                 ",
      ],
    },
    {
      rows: [
        "       /--[oo]--\\ ",
        "        +-||-+    ",
        "                  ",
      ],
      palette: { "accent-level": true },
    },
    // frames 7–12 — shimmer builds, silhouette blurs, gold tint
    {
      rows: [
        "          /[oo]\\ ",
        "           \\||/  ",
        "         +--++   ",
      ],
      effectRow: "      *  .  *       ",
      palette: { "level-up": true },
    },
    {
      rows: [
        "         /[oo]\\ ",
        "          \\||/  ",
        "         +--++  ",
      ],
      effectRow: "    *  .  *  .      ",
      palette: { "level-up": true },
    },
    {
      rows: [
        "          /[oo]\\ ",
        "           \\||/  ",
        "          --++   ",
      ],
      effectRow: "   *  .  *  .  *    ",
      palette: { "level-up": true },
    },
    {
      rows: [
        "         /[oo]\\ ",
        "          \\||/  ",
        "                ",
      ],
      effectRow: "  * .  * .  * .     ",
      palette: { "level-up": true },
    },
    {
      rows: [
        "          /[oo]\\ ",
        "           ||    ",
        "                 ",
      ],
      effectRow: "   * .  *  . *      ",
      palette: { "level-up": true },
    },
    {
      rows: [
        "         /[oo]\\ ",
        "          \\||/  ",
        "                ",
      ],
      effectRow: "    *  .  *  .      ",
      palette: { "level-up": true },
    },
    // frames 13–18 — flash peak (ASCII burst), all cells gold
    {
      rows: [
        "        \\  *  /  ",
        "         \\ * /   ",
        "          \\*/    ",
      ],
      palette: { "level-up": true },
    },
    {
      rows: [
        "        \\  *  /  ",
        "          /*\\    ",
        "         / * \\   ",
      ],
      palette: { "level-up": true },
    },
    {
      rows: [
        "        *  *  *  ",
        "         \\*|*/   ",
        "        *  *  *  ",
      ],
      palette: { "level-up": true },
    },
    {
      rows: [
        "        \\  *  /  ",
        "         \\ * /   ",
        "          \\*/    ",
      ],
      palette: { "level-up": true },
    },
    {
      rows: [
        "        \\  *  /  ",
        "          /*\\    ",
        "         / * \\   ",
      ],
      palette: { "level-up": true },
    },
    {
      rows: [
        "         *   *   ",
        "          \\*/    ",
        "           *     ",
      ],
      palette: { "level-up": true },
    },
    // frames 19–24 — new-stage silhouette fades in
    {
      rows: [
        "   /--[oo]--\\   ",
        "   +=- || -=+   ",
        "   +===++===+   ",
      ],
      palette: { "level-up": true },
    },
    {
      rows: [
        "   /--[oo]--\\   ",
        "   +=- || -=+   ",
        "   +===++===+   ",
      ],
      palette: { "accent-level": true },
    },
    {
      rows: [
        "   /--[oo]--\\   ",
        "   +=- || -=+   ",
        "   +===++===+   ",
      ],
    },
    {
      rows: [
        "   /--[oo]--\\   ",
        "   +=- || -=+   ",
        "   +===++===+   ",
      ],
    },
    {
      rows: [
        "   /--[oo]--\\   ",
        "   +=- || -=+   ",
        "   +===++===+   ",
      ],
    },
    {
      rows: [
        "   /--[oo]--\\   ",
        "   +=- || -=+   ",
        "   +===++===+   ",
      ],
    },
  ],
  // New compact evolve scene (expanded-frames.md §8.3)
  compact: [
    {
      // silhouette pulse
      rows: [
        " /[oo]\\ ",
        "  \\||/  ",
      ],
      palette: { "accent-level": true },
    },
    {
      // shimmer flash
      rows: [
        "  *  *  ",
        "  \\*/   ",
      ],
      palette: { "level-up": true },
    },
    {
      // new-stage silhouette
      rows: [
        " /--[oo]--\\",
        " +=- || -=+",
      ],
    },
  ],
};
