/**
 * DEC-020 — No daily caps.
 *
 * Previously (DEC-018 Mechanism 3) these tests verified that daily XP caps
 * were enforced. Under DEC-020 all daily caps are abolished.
 *
 * This file now verifies:
 *   - Any number of tokens.delta events grants XP without cap or rejection.
 *   - Any number of git.commit/test.pass/file.edit events grants XP without cap.
 *   - No `cap.daily` rejection events are emitted.
 *   - A single 100M-token event grants floor(100_000_000 / 1000) = 100_000 XP.
 *
 * All tests are pure — no disk I/O.
 */

import { describe, it, expect } from "vitest";
import {
  applyEvent,
  xpForTokens,
  XP_PER_TOKEN_DENOMINATOR,
} from "./engine.js";
import type { Pet } from "../state/schema.js";
import type { GlyphlingEvent } from "../events/bus.js";
import { ulid } from "ulid";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePet(overrides: Partial<Pet> = {}): Pet {
  const now = "2026-04-24T00:00:00.000Z";
  const weights = {
    Stoic: 0.125,
    Friendly: 0.125,
    Pragmatic: 0.125,
    Energetic: 0.125,
    Gruff: 0.125,
    Philosophical: 0.125,
    Paranoid: 0.125,
    Curious: 0.125,
  };
  return {
    id: "pet-nocap-001",
    schemaVersion: 1,
    eggType: "circuit",
    name: null,
    createdAt: now,
    hatchedAt: now,
    lastFedAt: null,
    lastInteractionAt: now,
    xp: 0,
    level: 1,
    personality: {
      dominant: "Stoic",
      weights,
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

function makeTokensEvent(xpDelta: number, ts = "2026-04-24T12:00:00.000Z"): GlyphlingEvent {
  return {
    id: ulid(),
    type: "tokens.delta",
    ts,
    petId: "pet-nocap-001",
    source: "test",
    payload: { tokens: xpDelta * XP_PER_TOKEN_DENOMINATOR },
    xpDelta,
  };
}

function makeCommitEvent(xpDelta: number, ts = "2026-04-24T12:00:00.000Z"): GlyphlingEvent {
  return {
    id: ulid(),
    type: "git.commit",
    ts,
    petId: "pet-nocap-001",
    source: "test",
    payload: {},
    xpDelta,
  };
}

function makeTestPassEvent(xpDelta: number, ts = "2026-04-24T12:00:00.000Z"): GlyphlingEvent {
  return {
    id: ulid(),
    type: "test.pass",
    ts,
    petId: "pet-nocap-001",
    source: "test",
    payload: {},
    xpDelta,
  };
}

function makeFileEditEvent(xpDelta: number, ts = "2026-04-24T12:00:00.000Z"): GlyphlingEvent {
  return {
    id: ulid(),
    type: "file.edit",
    ts,
    petId: "pet-nocap-001",
    source: "test",
    payload: {},
    xpDelta,
  };
}

function foldEvents(events: GlyphlingEvent[], initialPet: Pet): {
  pet: Pet;
  allSideEffects: GlyphlingEvent[];
} {
  let pet = initialPet;
  const allSideEffects: GlyphlingEvent[] = [];
  for (const event of events) {
    const result = applyEvent(event, pet);
    pet = result.pet;
    allSideEffects.push(...result.sideEffects);
  }
  return { pet, allSideEffects };
}

// ---------------------------------------------------------------------------
// DEC-020: No daily caps for tokens.delta
// ---------------------------------------------------------------------------

describe("DEC-020 no daily cap — tokens.delta", () => {
  it("100M-token event grants floor(100_000_000 / 1000) = 100_000 XP with no rejection", () => {
    const pet = makePet();
    // 100M tokens → floor(100_000_000 / 1000) = 100_000 XP
    const event = makeTokensEvent(100_000);
    const { pet: finalPet, allSideEffects } = foldEvents([event], pet);

    expect(finalPet.xp).toBe(100_000);
    const rejections = allSideEffects.filter((e) => e.type === "signal.rejected");
    expect(rejections).toHaveLength(0);
  });

  it("10 000 tokens.delta events of 1 XP each → 10 000 XP granted, no rejections", () => {
    const pet = makePet();
    const events = Array.from({ length: 10_000 }, () => makeTokensEvent(1));
    const { pet: finalPet, allSideEffects } = foldEvents(events, pet);

    expect(finalPet.xp).toBe(10_000); // All granted — no cap
    const rejections = allSideEffects.filter((e) => e.type === "signal.rejected");
    expect(rejections).toHaveLength(0);
  });

  it("xpForTokens(1_000) = 1 (1 XP per 1000 tokens)", () => {
    expect(xpForTokens(1_000)).toBe(1);
  });

  it("xpForTokens(100_000_000) = 100_000 (DEC-020 denominator = 1000)", () => {
    expect(xpForTokens(100_000_000)).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// DEC-020: No daily caps for git.commit
// ---------------------------------------------------------------------------

describe("DEC-020 no daily cap — git.commit", () => {
  it("30 commit events of 25 XP each → 750 XP, no rejections", () => {
    const pet = makePet();
    const events = Array.from({ length: 30 }, () => makeCommitEvent(25));
    const { pet: finalPet, allSideEffects } = foldEvents(events, pet);

    expect(finalPet.xp).toBe(750); // All 30 × 25 = 750 XP granted
    const rejections = allSideEffects.filter((e) => e.type === "signal.rejected");
    expect(rejections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DEC-020: No daily caps for test.pass
// ---------------------------------------------------------------------------

describe("DEC-020 no daily cap — test.pass", () => {
  it("10 test.pass events of 50 XP each → 500 XP, no rejections", () => {
    const pet = makePet();
    const events = Array.from({ length: 10 }, () => makeTestPassEvent(50));
    const { pet: finalPet, allSideEffects } = foldEvents(events, pet);

    expect(finalPet.xp).toBe(500); // All 10 × 50 = 500 XP granted
    const rejections = allSideEffects.filter((e) => e.type === "signal.rejected");
    expect(rejections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DEC-020: No daily caps for file.edit
// ---------------------------------------------------------------------------

describe("DEC-020 no daily cap — file.edit", () => {
  it("200 file.edit events of 1 XP each → 200 XP, no rejections", () => {
    const pet = makePet();
    const events = Array.from({ length: 200 }, () => makeFileEditEvent(1));
    const { pet: finalPet, allSideEffects } = foldEvents(events, pet);

    expect(finalPet.xp).toBe(200); // All 200 XP granted
    const rejections = allSideEffects.filter((e) => e.type === "signal.rejected");
    expect(rejections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DEC-020: cross-signal — all signals accumulate freely
// ---------------------------------------------------------------------------

describe("DEC-020 no daily cap — cross-signal accumulation", () => {
  it("tokens + commits + tests + edits all accumulate without rejection", () => {
    const pet = makePet();

    // Well beyond old per-signal daily caps for each type
    const allEvents: GlyphlingEvent[] = [
      ...Array.from({ length: 7_000 }, () => makeTokensEvent(1)),   // old cap: 6000 → now 7000 XP
      ...Array.from({ length: 25 }, () => makeCommitEvent(25)),      // old cap: 500  → now 625 XP
      ...Array.from({ length: 6 }, () => makeTestPassEvent(50)),     // old cap: 200  → now 300 XP
      ...Array.from({ length: 150 }, () => makeFileEditEvent(1)),    // old cap: 100  → now 150 XP
    ];

    const { pet: finalPet, allSideEffects } = foldEvents(allEvents, pet);

    expect(finalPet.xp).toBe(7_000 + 625 + 300 + 150); // 8075 XP total
    const rejections = allSideEffects.filter((e) => e.type === "signal.rejected");
    expect(rejections).toHaveLength(0);
  });
});
