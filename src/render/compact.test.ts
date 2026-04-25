/**
 * Tests for CompactVocab (src/render/compact.ts)
 *
 * Covers:
 * - pickCompactFrame is a pure function of (pet, scene, tick)
 * - Frame cycling: 4 baseline frames appear in round-robin over 8 ticks
 * - Width/height assertions: every frame ≤3 rows × ≤60 cols (build-time)
 * - colorize/fg emits correct SGR for each mode
 * - deriveMood returns correct mood from pet state
 * - renderHudRow produces non-empty output in all color modes
 * - GLYPHLING_RICH_GLYPHS=1 emits emoji mood glyphs
 */

import { describe, it, expect } from "vitest";
import type { Pet } from "../state/schema.js";
import { cumulativeXpForLevel } from "../xp/engine.js";
import {
  REFRESH_MS,
  pickCompactFrame,
  assertFrameDimensions,
  deriveMood,
  renderHudRow,
  assembleCompactOutput,
  visibleWidth,
  detectColorMode,
  colorize,
  PALETTE,
  FALLBACK_OUTPUT,
  pickScene,
  getLifeStage,
  applyEyeBlink,
} from "./compact.js";

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

function makePet(overrides: Partial<Pet> = {}): Pet {
  const now = new Date().toISOString();
  return {
    id: "test-pet-1",
    schemaVersion: 1,
    eggType: "circuit",
    name: "Pixel",
    createdAt: now,
    hatchedAt: now,
    lastFedAt: now,
    lastInteractionAt: now,
    xp: 500,
    level: 5,
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// pickCompactFrame — pure function
// ---------------------------------------------------------------------------

describe("pickCompactFrame", () => {
  it("returns the same frame for the same (pet, scene, tick) inputs", () => {
    const pet = makePet();
    const frameA = pickCompactFrame(pet, "idle-baseline", 42);
    const frameB = pickCompactFrame(pet, "idle-baseline", 42);
    expect(frameA).toBe(frameB); // Same object reference (same tick → same index)
  });

  it("cycles through baseline frames deterministically over 8 ticks", () => {
    const pet = makePet();
    // tick 4 must equal tick 0 (4-frame cycle wraps)
    const frame0 = pickCompactFrame(pet, "idle-baseline", 0);
    const frame4 = pickCompactFrame(pet, "idle-baseline", 4);
    expect(frame0).toBe(frame4); // Same object — same index
    // tick 2 (blink frame) should differ from tick 0 (steady)
    const frame2 = pickCompactFrame(pet, "idle-baseline", 2);
    expect(frame2.content).not.toBe(frame0.content);
    // tick 3 (breath) should differ from tick 0 (steady)
    const frame3 = pickCompactFrame(pet, "idle-baseline", 3);
    expect(frame3.content).not.toBe(frame0.content);
    // 4-frame cycle: tick 0 == tick 4; tick 1 == tick 5; etc.
    for (let t = 0; t < 4; t++) {
      expect(pickCompactFrame(pet, "idle-baseline", t)).toBe(
        pickCompactFrame(pet, "idle-baseline", t + 4)
      );
    }
  });

  it("baseline idle has exactly 4 frames in the cycle (modulo arithmetic)", () => {
    const pet = makePet();
    // Collecting unique frame *objects* (identity) over 4 ticks
    const frameObjects = new Set(
      Array.from({ length: 4 }, (_, t) => pickCompactFrame(pet, "idle-baseline", t))
    );
    expect(frameObjects.size).toBe(4);
  });

  it("stoic idle has exactly 2 frames cycling", () => {
    const pet = makePet();
    const f0 = pickCompactFrame(pet, "idle-stoic", 0).content;
    const f1 = pickCompactFrame(pet, "idle-stoic", 1).content;
    const f2 = pickCompactFrame(pet, "idle-stoic", 2).content;
    expect(f0).not.toBe(f1); // Different frames
    expect(f0).toBe(f2); // Wraps at tick 2
  });

  it("death scene has 1 static frame that never changes", () => {
    const pet = makePet({ diedAt: new Date().toISOString(), tombstone: { diedAt: new Date().toISOString(), cause: "neglect", finalLevel: 5, finalXp: 500 } });
    const f0 = pickCompactFrame(pet, "death", 0).content;
    const f99 = pickCompactFrame(pet, "death", 99).content;
    expect(f0).toBe(f99);
    expect(f0).toContain("RIP");
  });

  it("is deterministic regardless of pet content (only tick matters for cycling)", () => {
    const petA = makePet({ name: "Pixel", level: 5 });
    const petB = makePet({ name: "Grixx", level: 42 });
    // Both pets use same scene/tick — frame content is scene-dependent, not pet-dependent
    const fA = pickCompactFrame(petA, "idle-baseline", 7);
    const fB = pickCompactFrame(petB, "idle-baseline", 7);
    expect(fA).toBe(fB);
  });
});

// ---------------------------------------------------------------------------
// Frame dimension assertions (build-time check)
// ---------------------------------------------------------------------------

describe("assertFrameDimensions", () => {
  it("passes for all built-in frames (≤3 rows × ≤60 cols)", () => {
    // This is already called at module load — if it threw, import would have failed.
    // Calling explicitly here to ensure coverage.
    expect(() => assertFrameDimensions()).not.toThrow();
  });

  it("correctly measures visibleWidth (strips ANSI escapes)", () => {
    const colored = "\x1b[32mhello\x1b[0m";
    expect(visibleWidth(colored)).toBe(5);
    expect(visibleWidth("plain text")).toBe(10);
    expect(visibleWidth("")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// REFRESH_MS constant
// ---------------------------------------------------------------------------

describe("REFRESH_MS", () => {
  it("is 1000 (1 Hz floor matching DEC-016)", () => {
    expect(REFRESH_MS).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// detectColorMode
// ---------------------------------------------------------------------------

describe("detectColorMode", () => {
  it("returns 'none' when NO_COLOR is set", () => {
    expect(detectColorMode({ NO_COLOR: "1" })).toBe("none");
  });

  it("returns 'truecolor' when GLYPHLING_TRUECOLOR=1", () => {
    expect(detectColorMode({ GLYPHLING_TRUECOLOR: "1" })).toBe("truecolor");
  });

  it("returns 'ansi16' when NO_256COLOR=1", () => {
    expect(detectColorMode({ NO_256COLOR: "1" })).toBe("ansi16");
  });

  it("returns 'ansi256' by default", () => {
    expect(detectColorMode({})).toBe("ansi256");
  });

  it("NO_COLOR takes precedence over GLYPHLING_TRUECOLOR", () => {
    expect(detectColorMode({ NO_COLOR: "1", GLYPHLING_TRUECOLOR: "1" })).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// colorize
// ---------------------------------------------------------------------------

describe("colorize", () => {
  const token = PALETTE["accent-level"];

  it("emits 256-color SGR in ansi256 mode", () => {
    const result = colorize("Lv 5", token, "ansi256");
    expect(result).toContain("\x1b[38;5;");
    expect(result).toContain("Lv 5");
    expect(result).toContain("\x1b[0m");
  });

  it("emits truecolor SGR in truecolor mode", () => {
    const result = colorize("Lv 5", token, "truecolor");
    expect(result).toContain("\x1b[38;2;");
    expect(result).toContain("Lv 5");
  });

  it("emits ANSI-16 SGR in ansi16 mode", () => {
    const result = colorize("Lv 5", token, "ansi16");
    // accent-level ansi16 = 6 (cyan) → code = 36
    expect(result).toContain("\x1b[36m");
    expect(result).toContain("Lv 5");
  });

  it("returns plain text in none mode (NO_COLOR)", () => {
    const result = colorize("Lv 5", token, "none");
    expect(result).toBe("Lv 5");
    expect(result).not.toContain("\x1b[");
  });
});

// ---------------------------------------------------------------------------
// deriveMood
// ---------------------------------------------------------------------------

describe("deriveMood", () => {
  const now = Date.now();

  it("returns 'dead' when pet has diedAt set", () => {
    const pet = makePet({
      diedAt: new Date().toISOString(),
      tombstone: {
        diedAt: new Date().toISOString(),
        cause: "neglect",
        finalLevel: 5,
        finalXp: 0,
      },
    });
    expect(deriveMood(pet, now)).toBe("dead");
  });

  it("returns 'dying' when neglect >= 216000s (2.5 days)", () => {
    const pet = makePet({ accumulatedNeglectSeconds: 216001 });
    expect(deriveMood(pet, now)).toBe("dying");
  });

  it("returns 'sick' when neglect >= 86400s (1 day)", () => {
    const pet = makePet({ accumulatedNeglectSeconds: 86401 });
    expect(deriveMood(pet, now)).toBe("sick");
  });

  it("returns 'hungry' when lastFedAt > 6h ago", () => {
    const eightHoursAgo = new Date(now - 8 * 3600 * 1000).toISOString();
    const pet = makePet({ lastFedAt: eightHoursAgo, accumulatedNeglectSeconds: 0 });
    expect(deriveMood(pet, now)).toBe("hungry");
  });

  it("returns 'hungry' when lastFedAt is null", () => {
    const pet = makePet({ lastFedAt: null, accumulatedNeglectSeconds: 0 });
    expect(deriveMood(pet, now)).toBe("hungry");
  });

  it("returns 'sleeping' when paused (last pauseInterval has null resumedAt)", () => {
    const pet = makePet({
      pauseIntervals: [{ pausedAt: new Date().toISOString(), resumedAt: null }],
      accumulatedNeglectSeconds: 0,
    });
    expect(deriveMood(pet, now)).toBe("sleeping");
  });

  it("returns 'content' for a healthy fed pet", () => {
    const pet = makePet({
      lastFedAt: new Date().toISOString(),
      accumulatedNeglectSeconds: 0,
    });
    expect(deriveMood(pet, now)).toBe("content");
  });
});

// ---------------------------------------------------------------------------
// getLifeStage
// ---------------------------------------------------------------------------

describe("getLifeStage", () => {
  it("returns hatchling for levels 0-2", () => {
    expect(getLifeStage(0)).toBe("hatchling");
    expect(getLifeStage(2)).toBe("hatchling");
  });

  it("returns juvenile for levels 3-9", () => {
    expect(getLifeStage(3)).toBe("juvenile");
    expect(getLifeStage(9)).toBe("juvenile");
  });

  it("returns adult for levels 10+", () => {
    expect(getLifeStage(10)).toBe("adult");
    expect(getLifeStage(1618)).toBe("adult");
  });
});

// ---------------------------------------------------------------------------
// pickScene
// ---------------------------------------------------------------------------

describe("pickScene", () => {
  const now = Date.now();

  it("returns 'death' for a dead pet", () => {
    const pet = makePet({
      diedAt: new Date().toISOString(),
      tombstone: { diedAt: new Date().toISOString(), cause: "neglect", finalLevel: 5, finalXp: 0 },
    });
    expect(pickScene(pet, now)).toBe("death");
  });

  it("returns 'sick' for a neglected pet (>1 day)", () => {
    const pet = makePet({ accumulatedNeglectSeconds: 86401 });
    expect(pickScene(pet, now)).toBe("sick");
  });

  it("returns 'sleeping' for a paused pet", () => {
    const pet = makePet({
      pauseIntervals: [{ pausedAt: new Date().toISOString(), resumedAt: null }],
    });
    expect(pickScene(pet, now)).toBe("sleeping");
  });

  it("returns 'idle-energetic' for Energetic personality", () => {
    const pet = makePet({
      personality: {
        dominant: "Energetic",
        weights: {
          Stoic: 0.05,
          Friendly: 0.05,
          Pragmatic: 0.05,
          Energetic: 0.5,
          Gruff: 0.05,
          Philosophical: 0.05,
          Paranoid: 0.15,
          Curious: 0.1,
        },
        lockedAt: new Date().toISOString(),
        lastRefreshAt: new Date().toISOString(),
      },
    });
    expect(pickScene(pet, now)).toBe("idle-energetic");
  });

  it("returns 'idle-stoic' for Stoic personality", () => {
    const pet = makePet({
      personality: {
        dominant: "Stoic",
        weights: {
          Stoic: 0.5,
          Friendly: 0.05,
          Pragmatic: 0.05,
          Energetic: 0.05,
          Gruff: 0.1,
          Philosophical: 0.1,
          Paranoid: 0.05,
          Curious: 0.1,
        },
        lockedAt: new Date().toISOString(),
        lastRefreshAt: new Date().toISOString(),
      },
    });
    expect(pickScene(pet, now)).toBe("idle-stoic");
  });

  it("returns 'idle-baseline' for Friendly personality", () => {
    const pet = makePet();
    expect(pickScene(pet, now)).toBe("idle-baseline");
  });
});

// ---------------------------------------------------------------------------
// renderHudRow
// ---------------------------------------------------------------------------

describe("renderHudRow", () => {
  const pet = makePet();

  it("produces a non-empty string in all color modes", () => {
    for (const mode of ["none", "ansi16", "ansi256", "truecolor"] as const) {
      const result = renderHudRow(pet, "content", 1, 0, mode, false);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("includes the pet name", () => {
    const result = renderHudRow(pet, "content", 1, 0, "none", false);
    expect(result).toContain("Pixel");
  });

  it("includes the level", () => {
    const result = renderHudRow(pet, "content", 1, 0, "none", false);
    expect(result).toContain("Lv");
  });

  it("includes ASCII mood glyph by default", () => {
    const result = renderHudRow(pet, "happy", 1, 0, "none", false);
    expect(result).toContain(":)");
  });

  it("includes emoji mood glyph when richGlyphs=true", () => {
    const result = renderHudRow(pet, "happy", 1, 0, "none", true);
    expect(result).toContain("😊");
  });

  it("shows pet count when totalPets > 1", () => {
    const result = renderHudRow(pet, "content", 3, 0, "none", false);
    expect(result).toContain("[1/3]");
  });

  it("omits pet count when only 1 pet", () => {
    const result = renderHudRow(pet, "content", 1, 0, "none", false);
    expect(result).not.toContain("[1/1]");
  });

  it("shows Ascendant star suffix at level 1618 (DEC-020)", () => {
    const ascendant = makePet({ xp: cumulativeXpForLevel(1618), level: 1618 });
    const result = renderHudRow(ascendant, "celebrating", 1, 0, "none", false);
    expect(result).toContain("*");
  });

  it("shows dead HUD state for dead pet", () => {
    const deadPet = makePet({
      diedAt: new Date().toISOString(),
      tombstone: { diedAt: new Date().toISOString(), cause: "neglect", finalLevel: 5, finalXp: 500 },
    });
    const result = renderHudRow(deadPet, "dead", 1, 0, "none", false);
    expect(result).toContain("Lv");
    // Dead pet shows "†" or "+" for dead mood glyph
    expect(result).toContain("+");
  });

  it("emits 256-color ANSI in ansi256 mode", () => {
    const result = renderHudRow(pet, "content", 1, 0, "ansi256", false);
    expect(result).toContain("\x1b[38;5;");
  });

  it("emits truecolor SGR in truecolor mode", () => {
    const result = renderHudRow(pet, "content", 1, 0, "truecolor", false);
    expect(result).toContain("\x1b[38;2;");
  });

  it("emits no ANSI escape in none mode", () => {
    const result = renderHudRow(pet, "content", 1, 0, "none", false);
    expect(result).not.toContain("\x1b[");
  });
});

// ---------------------------------------------------------------------------
// assembleCompactOutput
// ---------------------------------------------------------------------------

describe("assembleCompactOutput", () => {
  it("produces exactly 3 newline-separated rows for a healthy adult pet", () => {
    const pet = makePet({ level: 10 });
    const tick = Math.floor(Date.now() / REFRESH_MS);
    const output = assembleCompactOutput(pet, "idle-baseline", tick, "none", false, 1, 0);
    const rows = output.trimEnd().split("\n");
    expect(rows.length).toBe(3);
  });

  it("all rows are within the 60-col ceiling", () => {
    const pet = makePet({ level: 10 });
    const tick = 0;
    for (const scene of ["idle-baseline", "idle-stoic", "sleeping", "sick"] as const) {
      const output = assembleCompactOutput(pet, scene, tick, "none", false, 1, 0);
      for (const row of output.split("\n")) {
        expect(visibleWidth(row)).toBeLessThanOrEqual(60);
      }
    }
  });

  it("death scene shows RIP", () => {
    const pet = makePet({
      diedAt: new Date().toISOString(),
      tombstone: { diedAt: new Date().toISOString(), cause: "neglect", finalLevel: 5, finalXp: 0 },
    });
    const output = assembleCompactOutput(pet, "death", 0, "none", false, 1, 0);
    expect(output).toContain("RIP");
  });

  it("uses silhouette for species in idle scenes", () => {
    // Circuit adult silhouette contains /[o-o]\
    const pet = makePet({ level: 15, eggType: "circuit" });
    const output = assembleCompactOutput(pet, "idle-baseline", 0, "none", false, 1, 0);
    expect(output).toContain("[");
    expect(output).toContain("|");
  });

  it("bloom species uses its own silhouette", () => {
    const pet = makePet({ level: 15, eggType: "bloom" });
    const output = assembleCompactOutput(pet, "idle-baseline", 0, "none", false, 1, 0);
    expect(output).toContain("(");
    expect(output).toContain("v");
  });

  it("eye-blink fires on tick % 4 === 2 and is silent otherwise", () => {
    // Hatchling stage — silhouette is `/oo\` so blink → `/__\`.
    const pet = makePet({ level: 1, xp: 0, eggType: "shard" });
    const open = assembleCompactOutput(pet, "idle-baseline", 0, "none", false, 1, 0);
    const blink = assembleCompactOutput(pet, "idle-baseline", 2, "none", false, 1, 0);
    expect(open).toContain("/oo\\");
    expect(open).not.toContain("/__\\");
    expect(blink).toContain("/__\\");
    expect(blink).not.toContain("/oo\\");
    // Width parity (≤60-col contract) — blink token must match eye-token width.
    for (const row of blink.split("\n")) {
      expect(visibleWidth(row)).toBeLessThanOrEqual(60);
    }
  });
});

// ---------------------------------------------------------------------------
// applyEyeBlink — pure helper
// ---------------------------------------------------------------------------

describe("applyEyeBlink", () => {
  it("returns the row unchanged on non-blink ticks (3 of every 4)", () => {
    const row = " /oo\\";
    expect(applyEyeBlink(row, "shard", "hatchling", 0)).toBe(row);
    expect(applyEyeBlink(row, "shard", "hatchling", 1)).toBe(row);
    expect(applyEyeBlink(row, "shard", "hatchling", 3)).toBe(row);
  });

  it("substitutes the eye token on tick % 4 === 2", () => {
    expect(applyEyeBlink(" /oo\\", "shard", "hatchling", 2)).toBe(" /__\\");
    expect(applyEyeBlink(" /[o-o]\\", "circuit", "adult", 2)).toBe(" /[_-_]\\");
    expect(applyEyeBlink(" <..>", "rune", "hatchling", 2)).toBe(" <__>");
    expect(applyEyeBlink(" (oo)", "bloom", "hatchling", 2)).toBe(" (__)");
  });

  it("preserves visible width on the blink frame", () => {
    const row = " /**oo**\\";
    const blinked = applyEyeBlink(row, "shard", "adult", 2);
    expect(visibleWidth(blinked)).toBe(visibleWidth(row));
  });
});

// ---------------------------------------------------------------------------
// FALLBACK_OUTPUT
// ---------------------------------------------------------------------------

describe("FALLBACK_OUTPUT", () => {
  it("is a non-empty single-row string", () => {
    expect(FALLBACK_OUTPUT.length).toBeGreaterThan(0);
    expect(FALLBACK_OUTPUT).not.toContain("\n");
  });

  it("contains 'glyphling' and 'no pet' per spec", () => {
    expect(FALLBACK_OUTPUT).toContain("glyphling");
    expect(FALLBACK_OUTPUT).toContain("no pet");
  });
});

// ---------------------------------------------------------------------------
// D6 — Ascendant immunity in renderer (DEC-019)
// ---------------------------------------------------------------------------

describe("deriveMood — Ascendant immunity (DEC-019 D6 / DEC-020)", () => {
  const XP_L1618 = cumulativeXpForLevel(1618);
  const now = Date.now();

  it("L1618 pet with heavy neglect → 'content' (not sick/dying)", () => {
    // Massive neglect that would normally trigger dying
    const pet = makePet({
      xp: XP_L1618,
      level: 1618,
      accumulatedNeglectSeconds: 300_000, // 83 hours — well past dying threshold
    });
    expect(deriveMood(pet, now)).toBe("content");
  });

  it("L1618 pet with legacy sick state in stored data → 'content' (renderer ignores it)", () => {
    const pet = makePet({
      xp: XP_L1618,
      level: 1618,
      accumulatedNeglectSeconds: 200_000, // would normally be 'sick'
      lastFedAt: null, // would normally be 'hungry'
    });
    expect(deriveMood(pet, now)).toBe("content");
  });

  it("L1617 pet with same neglect → still shows sick (regression guard — gate is exactly 1618)", () => {
    const XP_L1617 = cumulativeXpForLevel(1617);
    const pet = makePet({
      xp: XP_L1617,
      level: 1617,
      accumulatedNeglectSeconds: 200_000, // 200_000s >= 86400 (sick threshold) but < 216000 (dying)
    });
    // L1617 is NOT an Ascendant — neglect rules apply; 200k seconds → sick
    expect(deriveMood(pet, now)).toBe("sick");
  });
});

describe("pickScene — Ascendant immunity (DEC-019 D6 / DEC-020)", () => {
  const XP_L1618 = cumulativeXpForLevel(1618);
  const now = Date.now();

  it("L1618 pet with heavy neglect → idle scene (not sick)", () => {
    const pet = makePet({
      xp: XP_L1618,
      level: 1618,
      accumulatedNeglectSeconds: 200_000,
    });
    const scene = pickScene(pet, now);
    expect(scene).not.toBe("sick");
    expect(["idle-baseline", "idle-energetic", "idle-stoic"]).toContain(scene);
  });

  it("L1617 pet with same neglect → sick scene (regression guard — gate is exactly 1618)", () => {
    const XP_L1617 = cumulativeXpForLevel(1617);
    const pet = makePet({
      xp: XP_L1617,
      level: 1617,
      accumulatedNeglectSeconds: 200_000,
    });
    expect(pickScene(pet, now)).toBe("sick");
  });
});
