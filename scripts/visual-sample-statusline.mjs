#!/usr/bin/env node
/**
 * Visual smoke for TODO-025 — exercises the full statusline assembler.
 *
 * Builds a synthetic Pet for each species (adult stage), then prints
 * `assembleCompactOutput` at ticks 0..3 to demonstrate the per-species
 * authored frames cycling through the renderer.
 *
 * Usage:
 *   npx tsx scripts/visual-sample-statusline.mjs
 */

import { assembleCompactOutput } from "../src/render/compact.js";

const SPECIES = ["circuit", "rune", "shard", "bloom"];

function makePet(species) {
  const now = new Date().toISOString();
  return {
    id: "smoke-pet",
    schemaVersion: 1,
    eggType: species,
    name: "Demo",
    createdAt: now,
    hatchedAt: now,
    lastFedAt: now,
    lastInteractionAt: now,
    xp: 100_000, // adult stage
    level: 50,
    personality: {
      dominant: "Friendly",
      weights: {
        Stoic: 0.1,
        Friendly: 0.3,
        Pragmatic: 0.15,
        Energetic: 0.1,
        Gruff: 0.05,
        Philosophical: 0.1,
        Paranoid: 0.1,
        Curious: 0.1,
      },
      lockedAt: now,
      lastRefreshAt: now,
    },
    pauseIntervals: [],
    accumulatedNeglectSeconds: 0,
    lastTickAt: now,
    diedAt: null,
    tombstone: null,
    languageExposure: {},
    dailyCaps: {},
    lastLevelUpAt: null,
    lastPlayedAt: null,
    lastHatchedAt: null,
    lastEvolvedAt: null,
  };
}

for (const species of SPECIES) {
  console.log(`\n========= ${species} (adult, idle-baseline) =========`);
  const pet = makePet(species);
  for (let tick = 0; tick < 4; tick++) {
    console.log(`-- tick ${tick} --`);
    const out = assembleCompactOutput(pet, "idle-baseline", tick, "none", false, 1, 0);
    for (const row of out.split("\n")) {
      console.log(`|${row}|`);
    }
  }
}
