#!/usr/bin/env node
/**
 * Visual smoke for TODO-025 — prints per-species idle cycles to stdout.
 *
 * Usage:
 *   npx tsx scripts/visual-sample-species-frames.mjs
 *
 * Iterates 4 species × 3 stages × 3 idle scenes × 4 ticks. Output is the
 * raw 2-row art block for each frame (no HUD), with no ANSI — designed to
 * compare against docs/design/compact-frames.md art expectations.
 */

import { getSpeciesCompactFrames } from "../src/render/species-frames.js";

const SPECIES = ["circuit", "rune", "shard", "bloom"];
const STAGES = ["hatchling", "juvenile", "adult"];
const SCENES = ["idle-baseline", "idle-energetic", "idle-stoic"];

for (const species of SPECIES) {
  console.log(`\n========= ${species} =========`);
  for (const stage of STAGES) {
    console.log(`\n--- ${stage} ---`);
    for (const scene of SCENES) {
      const frames = getSpeciesCompactFrames(species, stage, scene);
      if (frames === null) {
        console.log(`[${scene}]: <not authored>`);
        continue;
      }
      console.log(`[${scene}] ${frames.length} frames:`);
      for (let i = 0; i < frames.length; i++) {
        console.log(`  frame ${i}:`);
        for (const row of frames[i].content.split("\n")) {
          console.log(`  |${row}|`);
        }
      }
    }
  }
}
