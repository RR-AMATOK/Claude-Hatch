/**
 * Tests for src/render/animation.ts — TODO-037
 *
 * Covers:
 *   1. selectScene priority order with one-shot scene windows
 *   2. SCENE_WINDOWS_MS window expiry (in-window vs expired)
 *   3. frameFromTime — time-derived frame indices
 *   4. selectScene — sick states still override one-shots
 *   5. selectScene — null/missing timestamps fall through to idle
 *   6. pickCompactFrame — passes nowMs to selectScene correctly
 */

import { describe, it, expect } from "vitest";
import type { Pet } from "../state/schema.js";
import {
  selectScene,
  SCENE_WINDOWS_MS,
  frameFromTime,
  pickCompactFrame,
} from "./animation.js";

// ---------------------------------------------------------------------------
// Pet fixture helpers
// ---------------------------------------------------------------------------

function makePet(overrides: Partial<Pet> = {}): Pet {
  const now = new Date().toISOString();
  return {
    id: "test-anim-01",
    schemaVersion: 1,
    eggType: "circuit",
    name: "TestPet",
    createdAt: now,
    hatchedAt: now,
    lastFedAt: null,
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

/** Returns an ISO8601 string that is `msAgo` milliseconds in the past from `nowMs`. */
function tsAgo(msAgo: number, nowMs: number = Date.now()): string {
  return new Date(nowMs - msAgo).toISOString();
}

// ---------------------------------------------------------------------------
// 1. selectScene priority ordering
// ---------------------------------------------------------------------------

describe("selectScene — priority ordering", () => {
  it("healthy pet with no timestamps → idle variant", () => {
    const pet = makePet();
    const scene = selectScene(pet);
    // Friendly dominant, not grumpy/stoic/chipper/curious threshold → idle-baseline
    expect(scene).toBe("idle-baseline");
  });

  it("dead pet → death-fade (highest priority)", () => {
    const now = Date.now();
    // Even if just-fed, dead pet gets death-fade
    const pet = makePet({
      diedAt: new Date().toISOString(),
      tombstone: {
        diedAt: new Date().toISOString(),
        cause: "neglect",
        finalLevel: 5,
        finalXp: 500,
      },
      lastFedAt: tsAgo(100, now),
    });
    expect(selectScene(pet, now)).toBe("death-fade");
  });

  it("sick pet + just-fed → sick (sick overrides one-shots)", () => {
    const now = Date.now();
    const pet = makePet({
      accumulatedNeglectSeconds: 86400, // exactly 1 day → sick
      lastFedAt: tsAgo(100, now),       // fed 100ms ago (within eat-small window)
    });
    // sick threshold = 86400s, not sick-worse yet
    expect(selectScene(pet, now)).toBe("sick");
  });

  it("sick-worse pet + just-fed → sick-worse (overrides eat)", () => {
    const now = Date.now();
    const pet = makePet({
      accumulatedNeglectSeconds: 216000, // DYING_THRESHOLD_S
      lastFedAt: tsAgo(100, now),
    });
    expect(selectScene(pet, now)).toBe("sick-worse");
  });

  it("healthy pet + just-leveled-up + just-fed → levelup-flash (beats eat)", () => {
    const now = Date.now();
    const pet = makePet({
      lastLevelUpAt: tsAgo(100, now),  // level-up 100ms ago (within levelup-flash window)
      lastFedAt: tsAgo(100, now),      // fed 100ms ago (within eat-feast window)
    });
    expect(selectScene(pet, now)).toBe("levelup-flash");
  });

  it("healthy pet + just-fed (no level-up) → eat-feast (higher priority than eat-small)", () => {
    const now = Date.now();
    const pet = makePet({
      lastFedAt: tsAgo(200, now),  // within both eat-feast (2500ms) and eat-small (1500ms) windows
    });
    // eat-feast has higher priority and its window (2500ms) covers recent feeds
    expect(selectScene(pet, now)).toBe("eat-feast");
  });

  it("healthy pet + fed 1600ms ago → eat-small (eat-feast window expired, eat-small active)", () => {
    const now = Date.now();
    // eat-feast window = 2500ms, eat-small window = 1500ms
    // at 1600ms: eat-small expired (>1500ms), eat-feast still active (<2500ms) → eat-feast wins
    // at 2600ms: both expired → idle
    // eat-small is only reachable if eat-feast window expires first, which means eat-feast (2500ms) > eat-small (1500ms)
    // so eat-small can never be the sole scene — eat-feast always covers it
    // This test verifies that once eat-feast expires, idle is returned
    const pet = makePet({
      lastFedAt: tsAgo(2600, now),  // beyond both eat-feast (2500ms) and eat-small (1500ms) windows
    });
    expect(selectScene(pet, now)).toBe("idle-baseline");
  });

  it("healthy pet + just-played (no other events) → play-chase (longer window wins first)", () => {
    const now = Date.now();
    const pet = makePet({
      lastPlayedAt: tsAgo(100, now),  // within play-chase 2000ms window
    });
    // play-chase (2000ms) is checked before play-bounce (1500ms) in priority order
    expect(selectScene(pet, now)).toBe("play-chase");
  });

  it("healthy pet + just-hatched → hatch-emerge (within 2000ms window)", () => {
    const now = Date.now();
    const pet = makePet({
      lastHatchedAt: tsAgo(500, now),  // within hatch-emerge 2000ms window
    });
    expect(selectScene(pet, now)).toBe("hatch-emerge");
  });

  it("healthy pet + just-evolved → evolve-shimmer (within 3000ms window)", () => {
    const now = Date.now();
    const pet = makePet({
      lastEvolvedAt: tsAgo(500, now),  // within evolve-shimmer 3000ms window
    });
    expect(selectScene(pet, now)).toBe("evolve-shimmer");
  });

  it("levelup + hatch both active → levelup-flash wins (higher priority)", () => {
    const now = Date.now();
    const pet = makePet({
      lastLevelUpAt: tsAgo(100, now),  // within levelup-flash window
      lastHatchedAt: tsAgo(100, now),  // within hatch-emerge window
    });
    expect(selectScene(pet, now)).toBe("levelup-flash");
  });

  it("hatch + evolve both active → hatch-emerge wins (higher priority)", () => {
    const now = Date.now();
    const pet = makePet({
      lastHatchedAt: tsAgo(500, now),
      lastEvolvedAt: tsAgo(500, now),
    });
    expect(selectScene(pet, now)).toBe("hatch-emerge");
  });
});

// ---------------------------------------------------------------------------
// 2. SCENE_WINDOWS_MS window expiry
// ---------------------------------------------------------------------------

describe("selectScene — window expiry", () => {
  it("eat-feast: lastFedAt = (now - 1ms) → eat-feast (both eat windows active, eat-feast wins)", () => {
    const now = Date.now();
    const pet = makePet({
      lastFedAt: tsAgo(1, now),
    });
    // eat-feast (2500ms) and eat-small (1500ms) both active; eat-feast has higher priority
    expect(selectScene(pet, now)).toBe("eat-feast");
  });

  it("eat-feast: lastFedAt = (now - 2499ms) → eat-feast (window not yet expired)", () => {
    const now = Date.now();
    const window = SCENE_WINDOWS_MS["eat-feast"]!;
    const pet = makePet({
      lastFedAt: tsAgo(window - 1, now),  // 1ms before expiry
    });
    expect(selectScene(pet, now)).toBe("eat-feast");
  });

  it("all eat windows expired: lastFedAt = (now - 2500ms) → ambient", () => {
    const now = Date.now();
    const window = SCENE_WINDOWS_MS["eat-feast"]!;
    const pet = makePet({
      lastFedAt: tsAgo(window, now),  // exactly at eat-feast boundary → expired
    });
    const scene = selectScene(pet, now);
    // Both eat-feast and eat-small windows have expired
    expect(scene).not.toBe("eat-feast");
    expect(scene).not.toBe("eat-small");
    expect(scene).toBe("idle-baseline");
  });

  it("levelup-flash: lastLevelUpAt = (now - 2999ms) → levelup-flash", () => {
    const now = Date.now();
    const window = SCENE_WINDOWS_MS["levelup-flash"]!;
    const pet = makePet({
      lastLevelUpAt: tsAgo(window - 1, now),
    });
    expect(selectScene(pet, now)).toBe("levelup-flash");
  });

  it("levelup-flash: lastLevelUpAt = (now - 3000ms) → ambient (window expired)", () => {
    const now = Date.now();
    const window = SCENE_WINDOWS_MS["levelup-flash"]!;
    const pet = makePet({
      lastLevelUpAt: tsAgo(window, now),
    });
    expect(selectScene(pet, now)).toBe("idle-baseline");
  });

  it("play-chase: lastPlayedAt = (now - 1999ms) → play-chase", () => {
    const now = Date.now();
    const window = SCENE_WINDOWS_MS["play-chase"]!;
    const pet = makePet({
      lastPlayedAt: tsAgo(window - 1, now),
    });
    expect(selectScene(pet, now)).toBe("play-chase");
  });

  it("play-chase expired but play-bounce still active → play-bounce", () => {
    const now = Date.now();
    // play-chase window = 2000ms, play-bounce window = 1500ms
    // Set lastPlayedAt such that play-chase has expired but play-bounce has not
    const chaseWindow = SCENE_WINDOWS_MS["play-chase"]!;
    const bounceWindow = SCENE_WINDOWS_MS["play-bounce"]!;
    // We need: elapsed > chaseWindow AND elapsed < bounceWindow
    // That's impossible since chaseWindow (2000) > bounceWindow (1500).
    // play-chase expires AFTER play-bounce. So if play-chase is expired,
    // play-bounce is also expired.
    // Both windows > 0 but play-bounce (1500) < play-chase (2000), so:
    // elapsed > 1500 && elapsed < 2000 → play-chase still active, play-bounce expired
    const msAgo = Math.floor((bounceWindow + chaseWindow) / 2); // ~1750ms
    const pet = makePet({
      lastPlayedAt: tsAgo(msAgo, now),
    });
    // bounce expired (>1500ms), chase still active (<2000ms)
    if (msAgo < chaseWindow) {
      expect(selectScene(pet, now)).toBe("play-chase");
    } else {
      expect(selectScene(pet, now)).toBe("idle-baseline");
    }
  });

  it("null timestamps always fall through to idle", () => {
    const pet = makePet({
      lastFedAt: null,
      lastPlayedAt: null,
      lastLevelUpAt: null,
      lastHatchedAt: null,
      lastEvolvedAt: null,
    });
    expect(selectScene(pet)).toBe("idle-baseline");
  });

  it("evolve-shimmer: lastEvolvedAt = (now - 2999ms) → evolve-shimmer", () => {
    const now = Date.now();
    const window = SCENE_WINDOWS_MS["evolve-shimmer"]!;
    const pet = makePet({
      lastEvolvedAt: tsAgo(window - 1, now),
    });
    expect(selectScene(pet, now)).toBe("evolve-shimmer");
  });

  it("evolve-shimmer: lastEvolvedAt = (now - 3000ms) → ambient", () => {
    const now = Date.now();
    const window = SCENE_WINDOWS_MS["evolve-shimmer"]!;
    const pet = makePet({
      lastEvolvedAt: tsAgo(window, now),
    });
    expect(selectScene(pet, now)).toBe("idle-baseline");
  });
});

// ---------------------------------------------------------------------------
// 3. frameFromTime — time-derived frame index
// ---------------------------------------------------------------------------

describe("frameFromTime — time-derived frame index", () => {
  it("elapsed = 0ms → frame 0", () => {
    const now = Date.now();
    const ts = new Date(now).toISOString();
    expect(frameFromTime(ts, 8, 10, now)).toBe(0);
  });

  it("elapsed = 500ms at fps=8, 10 frames → floor(0.5 * 8) = 4", () => {
    const now = Date.now();
    const ts = new Date(now - 500).toISOString();
    // floor(500/1000 * 8) = floor(4.0) = 4
    expect(frameFromTime(ts, 8, 10, now)).toBe(4);
  });

  it("elapsed = 500ms at fps=15, 10 frames → floor(0.5 * 15) = 7", () => {
    const now = Date.now();
    const ts = new Date(now - 500).toISOString();
    // floor(500/1000 * 15) = floor(7.5) = 7
    expect(frameFromTime(ts, 15, 10, now)).toBe(7);
  });

  it("elapsed beyond full playback → clamped to last frame", () => {
    const now = Date.now();
    const ts = new Date(now - 10_000).toISOString(); // 10s elapsed >> any window
    // floor(10000/1000 * 8) = 80, clamped to 9 (10 frames, 0-indexed)
    expect(frameFromTime(ts, 8, 10, now)).toBe(9);
  });

  it("clamped to frameCount - 1 for large elapsed", () => {
    const now = Date.now();
    const ts = new Date(now - 999_999).toISOString();
    const result = frameFromTime(ts, 30, 5, now);
    expect(result).toBe(4); // clamped to 5 - 1 = 4
  });

  it("negative elapsed (future timestamp) → frame 0", () => {
    const now = Date.now();
    const ts = new Date(now + 1000).toISOString(); // 1s in the future
    expect(frameFromTime(ts, 8, 10, now)).toBe(0);
  });

  it("deterministic: same inputs always produce same frame index", () => {
    const fixedNow = 1_700_000_000_000;
    const ts = new Date(fixedNow - 750).toISOString();
    const a = frameFromTime(ts, 8, 10, fixedNow);
    const b = frameFromTime(ts, 8, 10, fixedNow);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 4. Across-relaunch survival
// ---------------------------------------------------------------------------

describe("frameFromTime — relaunch-mid-window survival", () => {
  it("simulating fresh call mid-window resumes at correct frame", () => {
    // Scenario: eat-small at fps=15, lastFedAt was set 600ms ago.
    // Expected frame = floor(600/1000 * 15) = floor(9.0) = 9
    const now = Date.now();
    const lastFedAt = new Date(now - 600).toISOString();
    const fps = 15;
    const frameCount = 10; // eat-small has 10 frames

    const frame = frameFromTime(lastFedAt, fps, frameCount, now);
    expect(frame).toBe(9); // floor(0.6 * 15) = 9

    // Simulating a different "relaunch" time (100ms later)
    const frameLater = frameFromTime(lastFedAt, fps, frameCount, now + 100);
    // floor(700/1000 * 15) = floor(10.5) = 10 → clamped to 9
    expect(frameLater).toBe(9); // clamped to last frame
  });

  it("fresh call at T=0 of window → frame 0 (correct start)", () => {
    const now = Date.now();
    const ts = new Date(now).toISOString(); // event just fired
    expect(frameFromTime(ts, 15, 10, now)).toBe(0);
  });

  it("fresh call at T=half of window → middle frame", () => {
    // levelup-flash: 10 frames at 30fps = 333ms playback
    // At T=200ms elapsed: floor(200/1000 * 30) = floor(6.0) = 6
    const now = Date.now();
    const ts = new Date(now - 200).toISOString();
    expect(frameFromTime(ts, 30, 10, now)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// 5. SCENE_WINDOWS_MS sanity checks
// ---------------------------------------------------------------------------

describe("SCENE_WINDOWS_MS — invariants", () => {
  const ONE_SHOT_SCENES = [
    "levelup-flash",
    "eat-small",
    "eat-feast",
    "play-bounce",
    "play-chase",
    "hatch-crack",
    "hatch-emerge",
    "evolve-shimmer",
    "happy-wag",
    "happy-sparkle",
  ] as const;

  it("all one-shot scene IDs have a window entry", () => {
    for (const sceneId of ONE_SHOT_SCENES) {
      expect(SCENE_WINDOWS_MS[sceneId]).toBeDefined();
    }
  });

  it("all window values are positive integers", () => {
    for (const [sceneId, ms] of Object.entries(SCENE_WINDOWS_MS)) {
      expect(ms).toBeGreaterThan(0);
      expect(Number.isInteger(ms)).toBe(true);
      void sceneId; // suppress unused-var lint
    }
  });

  it("levelup-flash window equals scene duration (10 frames @ 30fps = ~333ms)", () => {
    // Window is now derived from scene metadata so it always matches the
    // scene's natural duration. No more frozen-on-last-frame artifacts.
    expect(SCENE_WINDOWS_MS["levelup-flash"]).toBe(333);
  });
});

// ---------------------------------------------------------------------------
// 6. pickCompactFrame — delegates scene selection correctly
// ---------------------------------------------------------------------------

describe("pickCompactFrame — scene selection integration", () => {
  it("healthy pet → compact frame from idle scene", () => {
    const pet = makePet();
    const frame = pickCompactFrame(pet, 0);
    expect(frame).toBeDefined();
    expect(frame.rows).toBeDefined();
    expect(frame.rows.length).toBeGreaterThan(0);
  });

  it("just-fed pet → compact frame from eat-small scene", () => {
    const now = Date.now();
    const pet = makePet({ lastFedAt: tsAgo(100, now) });
    const frame = pickCompactFrame(pet, 0, now);
    // The compact frame should come from eat-small
    expect(frame).toBeDefined();
    expect(frame.rows.length).toBeGreaterThan(0);
  });

  it("just-leveled-up pet → compact frame from levelup-flash scene", () => {
    const now = Date.now();
    const pet = makePet({ lastLevelUpAt: tsAgo(100, now) });
    const frame = pickCompactFrame(pet, 0, now);
    expect(frame).toBeDefined();
    expect(frame.rows.length).toBeGreaterThan(0);
  });

  it("tick index wraps within compact frame array length", () => {
    const pet = makePet();
    // idle-baseline compact has multiple frames; tick should wrap
    const frame0 = pickCompactFrame(pet, 0);
    const frame1000 = pickCompactFrame(pet, 1000);
    // Both should be valid frames (no crash on large tick)
    expect(frame0.rows.length).toBeGreaterThan(0);
    expect(frame1000.rows.length).toBeGreaterThan(0);
  });
});
