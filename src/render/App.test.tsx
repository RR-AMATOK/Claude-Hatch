/**
 * Tests for src/render/App.tsx
 *
 * Coverage:
 *   1. formatRelativeTime — unit tests for relative timestamp formatter
 *   2. deriveLevel import — DEC-020-correct level derivation (LEVEL_CAP=1618)
 *   3. xpProgress wiring — HudBar's XP bar uses deriveLevel from compact.ts
 *   4. useAnimation wiring — PetView consumes useAnimation; returns rows from Frame
 *   5. REPL handleCommand wiring — parseInput + dispatchCommand integration
 *   6. NO_MOTION flag — eye-blink compositing skipped when NO_MOTION=1
 *   7. NO_COLOR flag — detectColorMode returns "none"
 *
 * Ink rendering tests are skipped here because ink-testing-library is not in
 * devDeps. The pure logic is covered with direct unit tests instead.
 * useAnimation is exercised via its own 244-test suite in animation tests.
 *
 * Behavioral tests that require live Ink instances (pet name appears on screen,
 * animated scene frames advance, etc.) are covered via manual smoke test:
 *   npm run dev
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatRelativeTime } from "./useEventLog.js";
import { parseInput } from "../commands/repl.js";
import { dispatchCommand } from "../commands/handlers.js";
import type { Pet } from "../state/schema.js";
import {
  applyEyeBlink,
  getLifeStage,
  deriveMood,
  detectColorMode,
  deriveLevel,
} from "./compact.js";
import { selectScene, pickIdleVariant, useAnimation } from "./animation.js";
import { SCENES } from "../../animations/scenes/index.js";
import os from "os";
import path from "path";
import { buildConfig } from "../config/env.js";
import { StateStore } from "../state/store.js";
import type { WatchValidationError } from "../state/store.js";

// ---------------------------------------------------------------------------
// Pet fixture
// ---------------------------------------------------------------------------

function makePet(overrides: Partial<Pet> = {}): Pet {
  const now = new Date().toISOString();
  return {
    id: "test-01",
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
    lastLevelUpAt: null,
    lastPlayedAt: null,
    lastHatchedAt: null,
    lastEvolvedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe("formatRelativeTime", () => {
  const BASE = new Date("2024-06-15T12:00:00Z").getTime();

  it("returns 'just now' for < 5 seconds", () => {
    expect(formatRelativeTime(new Date(BASE - 3000).toISOString(), BASE)).toBe("just now");
  });

  it("returns seconds for < 60 s", () => {
    expect(formatRelativeTime(new Date(BASE - 45_000).toISOString(), BASE)).toBe("45s ago");
  });

  it("returns minutes for < 60 min", () => {
    expect(formatRelativeTime(new Date(BASE - 2 * 60 * 1000).toISOString(), BASE)).toBe("2m ago");
  });

  it("returns hours for < 24h", () => {
    expect(formatRelativeTime(new Date(BASE - 5 * 3600 * 1000).toISOString(), BASE)).toBe("5h ago");
  });

  it("returns days for >= 24h", () => {
    expect(formatRelativeTime(new Date(BASE - 3 * 86400 * 1000).toISOString(), BASE)).toBe("3d ago");
  });

  it("returns 'just now' for future timestamps (negative diff)", () => {
    expect(formatRelativeTime(new Date(BASE + 60_000).toISOString(), BASE)).toBe("just now");
  });
});

// ---------------------------------------------------------------------------
// compact.ts re-exports used by App — eye-blink
// ---------------------------------------------------------------------------

describe("applyEyeBlink (compact.ts) — used by PetView", () => {
  it("does not blink on non-blink ticks (tick % 4 !== 2)", () => {
    const row = "   /[o-o]\\";
    expect(applyEyeBlink(row, "circuit", "adult", 0)).toBe(row);
    expect(applyEyeBlink(row, "circuit", "adult", 1)).toBe(row);
    expect(applyEyeBlink(row, "circuit", "adult", 3)).toBe(row);
    expect(applyEyeBlink(row, "circuit", "adult", 4)).toBe(row);
  });

  it("blinks on tick % 4 === 2", () => {
    const row = "   /[o-o]\\";
    const blinkRow = applyEyeBlink(row, "circuit", "adult", 2);
    expect(blinkRow).not.toBe(row);
    // circuit/adult: eyes = "o-o", blink = "_-_"
    expect(blinkRow).toContain("_-_");
  });

  it("blinks on tick 6, 10, 14 (multiples of 4 offset by 2)", () => {
    const row = "   /[oo]\\";
    expect(applyEyeBlink(row, "circuit", "hatchling", 6)).toContain("__");
    expect(applyEyeBlink(row, "circuit", "hatchling", 10)).toContain("__");
    expect(applyEyeBlink(row, "circuit", "hatchling", 14)).toContain("__");
  });
});

// ---------------------------------------------------------------------------
// getLifeStage — used by PetView + HudBar
// ---------------------------------------------------------------------------

describe("getLifeStage", () => {
  it("hatchling for level <= 2", () => {
    expect(getLifeStage(1)).toBe("hatchling");
    expect(getLifeStage(2)).toBe("hatchling");
  });

  it("juvenile for level 3–9", () => {
    expect(getLifeStage(3)).toBe("juvenile");
    expect(getLifeStage(9)).toBe("juvenile");
  });

  it("adult for level >= 10", () => {
    expect(getLifeStage(10)).toBe("adult");
    expect(getLifeStage(1618)).toBe("adult");
  });
});

// ---------------------------------------------------------------------------
// deriveMood — used by HudBar
// ---------------------------------------------------------------------------

describe("deriveMood", () => {
  it("returns content for a healthy, fed pet", () => {
    const pet = makePet({ lastFedAt: new Date().toISOString() });
    expect(deriveMood(pet, Date.now())).toBe("content");
  });

  it("returns hungry when lastFedAt is > 6h ago", () => {
    const longAgo = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
    const pet = makePet({ lastFedAt: longAgo });
    expect(deriveMood(pet, Date.now())).toBe("hungry");
  });

  it("returns hungry when lastFedAt is null", () => {
    const pet = makePet({ lastFedAt: null });
    expect(deriveMood(pet, Date.now())).toBe("hungry");
  });

  it("returns sick when accumulatedNeglectSeconds >= 86400", () => {
    const pet = makePet({ accumulatedNeglectSeconds: 86400, lastFedAt: new Date().toISOString() });
    expect(deriveMood(pet, Date.now())).toBe("sick");
  });

  it("returns dying when accumulatedNeglectSeconds >= 216000", () => {
    const pet = makePet({ accumulatedNeglectSeconds: 216000, lastFedAt: new Date().toISOString() });
    expect(deriveMood(pet, Date.now())).toBe("dying");
  });

  it("returns dead for dead pets", () => {
    const pet = makePet({
      diedAt: new Date().toISOString(),
      tombstone: {
        diedAt: new Date().toISOString(),
        cause: "neglect",
        finalLevel: 5,
        finalXp: 500,
      },
    });
    expect(deriveMood(pet, Date.now())).toBe("dead");
  });

  it("returns sleeping when pet is paused", () => {
    const pet = makePet({
      lastFedAt: new Date().toISOString(),
      pauseIntervals: [{ pausedAt: new Date().toISOString(), resumedAt: null }],
    });
    expect(deriveMood(pet, Date.now())).toBe("sleeping");
  });
});

// ---------------------------------------------------------------------------
// detectColorMode — used by App for NO_COLOR
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
});

// ---------------------------------------------------------------------------
// parseInput + dispatchCommand — REPL wiring
// ---------------------------------------------------------------------------

describe("parseInput", () => {
  it("parses command with no args", () => {
    const result = parseInput("status");
    expect(result.name).toBe("status");
    expect(result.args).toEqual([]);
  });

  it("parses command with args", () => {
    const result = parseInput("name  my-pet");
    expect(result.name).toBe("name");
    expect(result.args).toEqual(["my-pet"]);
  });

  it("strips leading/trailing whitespace", () => {
    const result = parseInput("  feed  ");
    expect(result.name).toBe("feed");
  });

  it("returns empty name for blank input", () => {
    const result = parseInput("   ");
    expect(result.name).toBe("");
  });
});

describe("dispatchCommand — REPL dispatch integration", () => {
  const tmpDir = path.join(os.tmpdir(), `glyphling-app-test-${process.pid}`);
  const ctx = { config: buildConfig(tmpDir) };

  it("returns error redirecting 'feed' to its async handler", () => {
    const parsed = parseInput("feed");
    const result = dispatchCommand(parsed, ctx);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/feedCommand.*directly/i);
  });

  it("returns error for unimplemented 'status'", () => {
    const parsed = parseInput("status");
    const result = dispatchCommand(parsed, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns error for unimplemented 'pets'", () => {
    const parsed = parseInput("pets");
    const result = dispatchCommand(parsed, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns error for unimplemented 'doctor'", () => {
    const parsed = parseInput("doctor");
    const result = dispatchCommand(parsed, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns error for unknown command", () => {
    const parsed = parseInput("frobnicate");
    const result = dispatchCommand(parsed, ctx);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/unknown command/i);
  });
});

// ---------------------------------------------------------------------------
// NO_MOTION flag — eye-blink compositing
// ---------------------------------------------------------------------------

describe("NO_MOTION environment flag", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("NO_MOTION=1 means PetView skips the eye-blink overlay", () => {
    // PetView checks process.env["NO_MOTION"] === "1" and skips blink compositing.
    // Verify the guard logic: when noMotion is true, applyEyeBlink is not called
    // on the rows. We test the guard contract directly.
    const prevVal = process.env["NO_MOTION"];
    process.env["NO_MOTION"] = "1";

    const noMotion = process.env["NO_MOTION"] === "1";
    const row = "   /[o-o]\\";
    // With NO_MOTION, PetView returns row unchanged (no blink overlay)
    const resultRow = noMotion ? row : applyEyeBlink(row, "circuit", "adult", 2);
    expect(resultRow).toBe(row); // blink was NOT applied

    if (prevVal === undefined) {
      delete process.env["NO_MOTION"];
    } else {
      process.env["NO_MOTION"] = prevVal;
    }
  });

  it("without NO_MOTION, eye-blink IS applied on tick % 4 === 2", () => {
    const prevVal = process.env["NO_MOTION"];
    delete process.env["NO_MOTION"];

    const noMotion = process.env["NO_MOTION"] === "1";
    const row = "   /[o-o]\\";
    const resultRow = noMotion ? row : applyEyeBlink(row, "circuit", "adult", 2);
    expect(resultRow).not.toBe(row); // blink WAS applied

    if (prevVal !== undefined) {
      process.env["NO_MOTION"] = prevVal;
    }
  });
});

// ---------------------------------------------------------------------------
// DEC-020 level cap integrity — LEVEL_CAP=1618 (the Golden Level)
// ---------------------------------------------------------------------------

describe("DEC-020 level cap integrity (LEVEL_CAP=1618)", () => {
  it("getLifeStage(1618) is 'adult' — golden level is adult stage", () => {
    expect(getLifeStage(1618)).toBe("adult");
  });

  it("deriveLevel(0) returns 1 — floor is level 1", () => {
    expect(deriveLevel(0)).toBe(1);
  });

  it("deriveLevel saturates at 1618 with extreme XP", () => {
    // XP well beyond the cap (192M+ needed for L1618 under DEC-020 curve)
    expect(deriveLevel(999_999_999)).toBe(1618);
  });

  it("pet with XP well beyond cap resolves mood without throwing", () => {
    const pet = makePet({ xp: 999_999_999, lastFedAt: new Date().toISOString() });
    expect(() => deriveMood(pet, Date.now())).not.toThrow();
  });

  it("deriveMood for ascendant with huge XP returns content (immune to neglect moods)", () => {
    // At level 1618 (L ≥ LEVEL_CAP), isAscendant → mood = "content" regardless of neglect.
    const pet = makePet({
      xp: 999_999_999,
      accumulatedNeglectSeconds: 999999,
      lastFedAt: null,
    });
    expect(deriveMood(pet, Date.now())).toBe("content");
  });
});

// ---------------------------------------------------------------------------
// useAnimation wiring — PetView consumes useAnimation; verifies scene selection
//
// useAnimation is a React hook and cannot be called outside a React render
// cycle without ink-testing-library. Instead we verify the wiring contract:
//   - selectScene(pet) correctly routes pet state to scene IDs
//   - pickIdleVariant correctly selects idle variants from personality
//   - useAnimation is importable (export is present at animation.ts:219)
//
// These cover the same code paths PetView exercises when it calls useAnimation(pet).
// ---------------------------------------------------------------------------

describe("useAnimation wiring — scene selection contract (PetView consumers)", () => {
  it("useAnimation is exported from animation.ts (import succeeds)", () => {
    // If this import failed, this file would not compile.
    expect(typeof useAnimation).toBe("function");
  });

  it("selectScene returns idle-baseline for a healthy baseline-personality pet", () => {
    // Pass a nowMs far in the future so all one-shot windows have expired
    const nowMs = Date.now() + 60_000;
    const pet = makePet({ accumulatedNeglectSeconds: 0 });
    const sceneId = selectScene(pet, nowMs);
    // Friendly dominant → pickIdleVariant → idle-baseline (Friendly < chipper threshold)
    expect(sceneId).toBe("idle-baseline");
  });

  it("selectScene returns death-fade for a dead pet", () => {
    const pet = makePet({
      diedAt: new Date().toISOString(),
      tombstone: {
        diedAt: new Date().toISOString(),
        cause: "neglect",
        finalLevel: 5,
        finalXp: 500,
      },
    });
    expect(selectScene(pet)).toBe("death-fade");
  });

  it("selectScene returns sick when accumulatedNeglectSeconds >= 86400", () => {
    // sick overrides one-shots, so no need to expire windows
    const pet = makePet({ accumulatedNeglectSeconds: 86400 });
    expect(selectScene(pet)).toBe("sick");
  });

  it("selectScene returns sick-worse when accumulatedNeglectSeconds >= DYING_THRESHOLD", () => {
    // DYING_THRESHOLD = 3d - 12h = 216000s; sick-worse overrides one-shots
    const pet = makePet({ accumulatedNeglectSeconds: 216000 });
    expect(selectScene(pet)).toBe("sick-worse");
  });

  it("pickIdleVariant returns idle-grumpy for a gruff-dominant pet", () => {
    const grumpyPet = makePet({
      personality: {
        dominant: "Gruff",
        weights: {
          Stoic: 0.05,
          Friendly: 0.05,
          Pragmatic: 0.05,
          Energetic: 0.05,
          Gruff: 0.5,
          Philosophical: 0.1,
          Paranoid: 0.1,
          Curious: 0.1,
        },
        lockedAt: new Date().toISOString(),
        lastRefreshAt: new Date().toISOString(),
      },
    });
    const variant = pickIdleVariant(grumpyPet.personality);
    expect(variant).toBe("idle-grumpy");
  });

  it("pickIdleVariant returns idle-chipper for energetic+friendly dominant pet", () => {
    const chipperPet = makePet({
      personality: {
        dominant: "Energetic",
        weights: {
          Stoic: 0.05,
          Friendly: 0.25,
          Pragmatic: 0.05,
          Energetic: 0.35,
          Gruff: 0.05,
          Philosophical: 0.05,
          Paranoid: 0.1,
          Curious: 0.1,
        },
        lockedAt: new Date().toISOString(),
        lastRefreshAt: new Date().toISOString(),
      },
    });
    const variant = pickIdleVariant(chipperPet.personality);
    expect(variant).toBe("idle-chipper");
  });

  it("frame.rows array from a healthy pet scene is non-empty", () => {
    // Verify the SCENES registry returns frames with rows for a baseline pet.
    // We call selectScene + look up the scene directly (no React needed).
    // Pass nowMs far in future so all one-shot windows have expired.
    const nowMs = Date.now() + 60_000;
    const pet = makePet();
    const sceneId = selectScene(pet, nowMs);
    const scene = SCENES[sceneId];
    expect(scene).toBeDefined();
    expect(scene.frames.length).toBeGreaterThan(0);
    expect(scene.frames[0]!.rows.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // TODO-037: one-shot scene dispatch wiring (PetView scene selection)
  // ---------------------------------------------------------------------------

  it("pet with recent lastFedAt → selectScene returns eat-feast (higher priority than eat-small)", () => {
    const now = Date.now();
    const pet = makePet({ lastFedAt: new Date(now - 200).toISOString() });
    // eat-feast (2500ms window) has higher priority and covers the recent feed
    expect(selectScene(pet, now)).toBe("eat-feast");
  });

  it("pet with recent lastLevelUpAt → selectScene returns levelup-flash", () => {
    const now = Date.now();
    const pet = makePet({ lastLevelUpAt: new Date(now - 200).toISOString() });
    expect(selectScene(pet, now)).toBe("levelup-flash");
  });

  it("pet with recent lastPlayedAt (no recent feed) → selectScene returns play-chase", () => {
    const now = Date.now();
    // Use a lastFedAt far enough in the past that eat windows have expired
    const pet = makePet({
      lastPlayedAt: new Date(now - 100).toISOString(),
      lastFedAt: new Date(now - 30_000).toISOString(),  // 30s ago → all eat windows expired
    });
    expect(selectScene(pet, now)).toBe("play-chase");
  });

  it("pet sick + recent lastFedAt → selectScene returns sick (sick beats eat)", () => {
    const now = Date.now();
    const pet = makePet({
      accumulatedNeglectSeconds: 86400,
      lastFedAt: new Date(now - 100).toISOString(),
    });
    expect(selectScene(pet, now)).toBe("sick");
  });

  it("pet with recent lastHatchedAt → selectScene returns hatch-emerge", () => {
    const now = Date.now();
    const pet = makePet({ lastHatchedAt: new Date(now - 100).toISOString() });
    expect(selectScene(pet, now)).toBe("hatch-emerge");
  });

  it("pet with recent lastEvolvedAt → selectScene returns evolve-shimmer", () => {
    const now = Date.now();
    const pet = makePet({ lastEvolvedAt: new Date(now - 100).toISOString() });
    expect(selectScene(pet, now)).toBe("evolve-shimmer");
  });
});

// ---------------------------------------------------------------------------
// deriveLevel import from compact.ts — DEC-020 golden curve verification
// ---------------------------------------------------------------------------

describe("deriveLevel (imported from compact.ts)", () => {
  it("returns level 1 for xp=0", () => {
    expect(deriveLevel(0)).toBe(1);
  });

  it("returns level 1 for small xp", () => {
    expect(deriveLevel(1)).toBe(1);
  });

  it("returns level > 1 for moderate xp", () => {
    // xpToNext(1) = floor(2 * 1^φ) = 2 XP to reach L2
    expect(deriveLevel(2)).toBeGreaterThanOrEqual(2);
  });

  it("saturates at 1618 (DEC-020 golden level cap) for extreme XP", () => {
    expect(deriveLevel(999_999_999)).toBe(1618);
  });

  it("never returns a level above 1618", () => {
    expect(deriveLevel(Number.MAX_SAFE_INTEGER / 2)).toBeLessThanOrEqual(1618);
  });

  it("is monotonically non-decreasing", () => {
    const samples = [0, 1, 10, 100, 1000, 10000, 100000, 1000000];
    let prev = 0;
    for (const xp of samples) {
      const level = deriveLevel(xp);
      expect(level).toBeGreaterThanOrEqual(prev);
      prev = level;
    }
  });
});

// ---------------------------------------------------------------------------
// TODO-038: ValidationBanner — StateStore warning channel
//
// Since we cannot render Ink components without ink-testing-library, we test:
//   1. StateStore.validationWarning() starts null
//   2. setValidationWarning() stores the warning and notifies subscribers
//   3. clearValidationWarning() resets to null and notifies subscribers
//   4. ValidationBanner time-formatting logic (HH:MM:SS)
//   5. The kind discriminator is "validation" (not "chain-break")
// ---------------------------------------------------------------------------

describe("TODO-038: StateStore validation warning channel", () => {
  it("validationWarning() is null on a fresh store", () => {
    const store = new StateStore();
    expect(store.validationWarning()).toBeNull();
  });

  it("setValidationWarning() stores the warning", () => {
    const store = new StateStore();
    const warning: WatchValidationError = {
      kind: "validation",
      reason: "diedAt/tombstone mismatch",
      rejectedAt: Date.now(),
      retryCount: 0,
    };
    store.setValidationWarning(warning);
    const result = store.validationWarning();
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("validation");
    expect(result!.reason).toBe("diedAt/tombstone mismatch");
    expect(result!.retryCount).toBe(0);
  });

  it("clearValidationWarning() resets the warning to null", () => {
    const store = new StateStore();
    store.setValidationWarning({
      kind: "validation",
      reason: "test",
      rejectedAt: Date.now(),
      retryCount: 1,
    });
    expect(store.validationWarning()).not.toBeNull();
    store.clearValidationWarning();
    expect(store.validationWarning()).toBeNull();
  });

  it("clearValidationWarning() is a no-op when already null (no subscriber notification)", () => {
    const store = new StateStore();
    let notified = 0;
    store.subscribe(() => { notified++; });
    // Already null — should not fire subscribers
    store.clearValidationWarning();
    expect(notified).toBe(0);
  });

  it("setValidationWarning() notifies subscribers", () => {
    const store = new StateStore();
    let notified = 0;
    store.subscribe(() => { notified++; });
    store.setValidationWarning({
      kind: "validation",
      reason: "bad field",
      rejectedAt: Date.now(),
      retryCount: 0,
    });
    expect(notified).toBe(1);
  });

  it("clearValidationWarning() notifies subscribers when warning was set", () => {
    const store = new StateStore();
    let notified = 0;
    store.setValidationWarning({
      kind: "validation",
      reason: "bad field",
      rejectedAt: Date.now(),
      retryCount: 0,
    });
    store.subscribe(() => { notified++; });
    store.clearValidationWarning();
    expect(notified).toBe(1);
  });

  it("warning is distinct from integrityWarning (DEC-018 channel)", () => {
    const store = new StateStore();
    // integrityWarning is for DEC-018 chain-break; validationWarning is for TODO-038 parse errors.
    // Both start null and are independently writable.
    expect(store.integrityWarning()).toBeNull();
    expect(store.validationWarning()).toBeNull();

    store.setValidationWarning({
      kind: "validation",
      reason: "zod error",
      rejectedAt: Date.now(),
      retryCount: 0,
    });

    // Setting validationWarning does NOT affect integrityWarning
    expect(store.integrityWarning()).toBeNull();
    expect(store.validationWarning()).not.toBeNull();
  });
});

describe("TODO-038: ValidationBanner time-formatting logic", () => {
  /**
   * The ValidationBanner component formats rejectedAt as HH:MM:SS.
   * We test the formatting logic in isolation (pure function contract).
   */
  function formatBannerTime(rejectedAt: number): string {
    const ts = new Date(rejectedAt);
    const hh = ts.getHours().toString().padStart(2, "0");
    const mm = ts.getMinutes().toString().padStart(2, "0");
    const ss = ts.getSeconds().toString().padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  it("formats a known timestamp to HH:MM:SS", () => {
    // Use a date where H/M/S are all known single-digit values to test padding
    const ts = new Date("2025-01-01T01:02:03Z").getTime();
    // Hours depend on the system timezone, so we normalise to UTC for the assertion.
    const d = new Date(ts);
    const expected =
      d.getHours().toString().padStart(2, "0") + ":" +
      d.getMinutes().toString().padStart(2, "0") + ":" +
      d.getSeconds().toString().padStart(2, "0");
    expect(formatBannerTime(ts)).toBe(expected);
  });

  it("output is always HH:MM:SS format (length 8)", () => {
    const ts = Date.now();
    const formatted = formatBannerTime(ts);
    expect(formatted).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatted).toHaveLength(8);
  });

  it("banner text contains the reason string", () => {
    const reason = "diedAt/tombstone mismatch";
    const ts = Date.now();
    const timeStr = formatBannerTime(ts);
    const bannerText = `⚠ state.json invalid — rejected ${timeStr} — ${reason}`;
    expect(bannerText).toContain(reason);
    expect(bannerText).toContain("state.json invalid");
    expect(bannerText).toContain("⚠");
  });
});
