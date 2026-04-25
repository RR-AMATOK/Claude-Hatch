/**
 * Tests for DEC-018 Mechanism 3 — Daily XP caps in src/xp/engine.ts
 *
 * Acceptance criterion (DEC-018 §8 / TODOS.md):
 *   Running 10 000 tokens.delta events in a single UTC day caps XP at 6 000;
 *   excess events emit signal.rejected { reason: "cap.daily" }.
 *
 * All tests are pure — no disk I/O.
 */

import { describe, it, expect } from "vitest";
import {
  applyEvent,
  DAILY_CAP_TOKENS,
  DAILY_CAP_TESTS,
  DAILY_CAP_COMMITS,
  DAILY_CAP_EDITS,
  DAILY_CAPS_RETENTION_DAYS,
  xpForTokens,
} from "./engine.js";
import type { Pet } from "../state/schema.js";
import type { GlyphlingEvent } from "../events/bus.js";
import { ulid } from "ulid";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePet(overrides: Partial<Pet> = {}): Pet {
  const now = "2026-04-17T00:00:00.000Z";
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
    id: "pet-caps-001",
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

/**
 * Build a tokens.delta event carrying xpDelta XP on a fixed UTC day.
 * Uses a fresh ULID so each event is unique.
 */
function makeTokensEvent(xpDelta: number, ts = "2026-04-17T12:00:00.000Z"): GlyphlingEvent {
  return {
    id: ulid(),
    type: "tokens.delta",
    ts,
    petId: "pet-caps-001",
    source: "test",
    payload: { tokens: xpDelta * 500 }, // 1 XP per 500 tokens
    xpDelta,
  };
}

function makeCommitEvent(xpDelta: number, ts = "2026-04-17T12:00:00.000Z"): GlyphlingEvent {
  return {
    id: ulid(),
    type: "git.commit",
    ts,
    petId: "pet-caps-001",
    source: "test",
    payload: {},
    xpDelta,
  };
}

function makeTestPassEvent(xpDelta: number, ts = "2026-04-17T12:00:00.000Z"): GlyphlingEvent {
  return {
    id: ulid(),
    type: "test.pass",
    ts,
    petId: "pet-caps-001",
    source: "test",
    payload: {},
    xpDelta,
  };
}

function makeFileEditEvent(xpDelta: number, ts = "2026-04-17T12:00:00.000Z"): GlyphlingEvent {
  return {
    id: ulid(),
    type: "file.edit",
    ts,
    petId: "pet-caps-001",
    source: "test",
    payload: {},
    xpDelta,
  };
}

/**
 * Fold N events through applyEvent sequentially, starting from `initialPet`.
 * Returns the final pet and all side-effect events accumulated.
 */
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
// tokens.delta — 10 000 events, one UTC day
// ---------------------------------------------------------------------------

describe("DEC-018 daily cap — tokens.delta (Mechanism 3 acceptance criterion)", () => {
  it("10 000 tokens.delta events of 1 XP each → exactly 6 000 XP granted", () => {
    const pet = makePet();
    // 10 000 events, each granting 1 XP
    const events = Array.from({ length: 10_000 }, () => makeTokensEvent(1));
    const { pet: finalPet } = foldEvents(events, pet);
    expect(finalPet.xp).toBe(DAILY_CAP_TOKENS); // 6 000
  });

  it("10 000 tokens.delta events of 1 XP each → signal.rejected for each excess event", () => {
    const pet = makePet();
    const events = Array.from({ length: 10_000 }, () => makeTokensEvent(1));
    const { allSideEffects } = foldEvents(events, pet);

    const rejections = allSideEffects.filter(
      (e) =>
        e.type === "signal.rejected" &&
        (e.payload as { reason?: string }).reason === "cap.daily"
    );
    // First 6 000 events are under the cap; 4 000 are rejected.
    expect(rejections).toHaveLength(4_000);
  });

  it("signal.rejected events carry correct payload fields", () => {
    const pet = makePet();
    // Send enough to exceed cap by exactly 1 XP
    const eventsBelowCap = Array.from({ length: DAILY_CAP_TOKENS }, () => makeTokensEvent(1));
    const overflowEvent = makeTokensEvent(1);
    const allEvents = [...eventsBelowCap, overflowEvent];

    const { allSideEffects } = foldEvents(allEvents, pet);

    const rejection = allSideEffects.find(
      (e) =>
        e.type === "signal.rejected" &&
        (e.payload as { reason?: string }).reason === "cap.daily"
    );
    expect(rejection).toBeDefined();

    const payload = rejection!.payload as {
      reason: string;
      signal: string;
      origEventId: string;
      requestedXp: number;
      grantedXp: number;
    };
    expect(payload.reason).toBe("cap.daily");
    expect(payload.signal).toBe("tokens.delta");
    expect(payload.origEventId).toBe(overflowEvent.id);
    expect(payload.requestedXp).toBe(1);
    expect(payload.grantedXp).toBe(0);
  });

  it("partial grant: single large-XP event exceeding remaining budget is partially granted", () => {
    // Pet has accumulated 5 999 tokens XP today
    const pet = makePet({
      dailyCaps: { "2026-04-17": { tokens: 5_999, tests: 0, commits: 0, edits: 0 } },
    });
    // Send an event requesting 100 XP — only 1 XP remains under the cap
    const event = makeTokensEvent(100);
    const { pet: finalPet, allSideEffects } = foldEvents([event], pet);

    expect(finalPet.xp).toBe(1); // only 1 XP granted (cap at 6 000)
    const rejection = allSideEffects.find(
      (e) =>
        e.type === "signal.rejected" &&
        (e.payload as { reason?: string }).reason === "cap.daily"
    );
    expect(rejection).toBeDefined();

    const payload = rejection!.payload as { requestedXp: number; grantedXp: number };
    expect(payload.requestedXp).toBe(100);
    expect(payload.grantedXp).toBe(1);
  });

  it("cap is per-day: events on different UTC days each get a full cap", () => {
    const pet = makePet();

    // Saturate day 1
    const day1Events = Array.from({ length: DAILY_CAP_TOKENS + 100 }, () =>
      makeTokensEvent(1, "2026-04-17T12:00:00.000Z")
    );
    const { pet: petAfterDay1 } = foldEvents(day1Events, pet);
    expect(petAfterDay1.xp).toBe(DAILY_CAP_TOKENS);

    // Day 2: fresh cap
    const day2Events = Array.from({ length: DAILY_CAP_TOKENS + 100 }, () =>
      makeTokensEvent(1, "2026-04-18T12:00:00.000Z")
    );
    const { pet: petAfterDay2 } = foldEvents(day2Events, petAfterDay1);
    expect(petAfterDay2.xp).toBe(DAILY_CAP_TOKENS * 2); // 12 000 total
  });

  it("xpForTokens helper: 10 000 tokens → 20 XP (1 XP per 500)", () => {
    expect(xpForTokens(10_000)).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// git.commit daily cap
// ---------------------------------------------------------------------------

describe("DEC-018 daily cap — git.commit", () => {
  it(`caps commit XP at ${DAILY_CAP_COMMITS} per day`, () => {
    const pet = makePet();
    // Each commit event grants 25 XP; send enough to exceed the 500 XP/day cap
    const events = Array.from({ length: 30 }, () => makeCommitEvent(25));
    const { pet: finalPet } = foldEvents(events, pet);

    // 500 XP cap → only 500 XP total granted (20 events of 25 each)
    expect(finalPet.xp).toBe(DAILY_CAP_COMMITS);
  });

  it("emits signal.rejected for commit events past daily cap", () => {
    const pet = makePet();
    const events = Array.from({ length: 30 }, () => makeCommitEvent(25));
    const { allSideEffects } = foldEvents(events, pet);

    const rejections = allSideEffects.filter(
      (e) =>
        e.type === "signal.rejected" &&
        (e.payload as { signal?: string }).signal === "git.commit"
    );
    // 20 events fit under cap (20 × 25 = 500); remaining 10 are fully rejected
    expect(rejections).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// test.pass daily cap
// ---------------------------------------------------------------------------

describe("DEC-018 daily cap — test.pass", () => {
  it(`caps test XP at ${DAILY_CAP_TESTS} per day`, () => {
    const pet = makePet();
    // Each event grants 50 XP; send enough to exceed the 200 XP/day cap
    const events = Array.from({ length: 10 }, () => makeTestPassEvent(50));
    const { pet: finalPet } = foldEvents(events, pet);

    expect(finalPet.xp).toBe(DAILY_CAP_TESTS); // 200 XP
  });

  it("emits signal.rejected for test.pass events past daily cap", () => {
    const pet = makePet();
    const events = Array.from({ length: 10 }, () => makeTestPassEvent(50));
    const { allSideEffects } = foldEvents(events, pet);

    const rejections = allSideEffects.filter(
      (e) =>
        e.type === "signal.rejected" &&
        (e.payload as { signal?: string }).signal === "test.pass"
    );
    // 4 events fit under cap (4 × 50 = 200); remaining 6 are fully rejected
    expect(rejections).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// file.edit daily cap
// ---------------------------------------------------------------------------

describe("DEC-018 daily cap — file.edit", () => {
  it(`caps file edit XP at ${DAILY_CAP_EDITS} per day`, () => {
    const pet = makePet();
    // Each event grants 1 XP; send 200 to exceed the 100 XP/day cap
    const events = Array.from({ length: 200 }, () => makeFileEditEvent(1));
    const { pet: finalPet } = foldEvents(events, pet);

    expect(finalPet.xp).toBe(DAILY_CAP_EDITS); // 100 XP
  });

  it("emits signal.rejected for file.edit events past daily cap", () => {
    const pet = makePet();
    const events = Array.from({ length: 200 }, () => makeFileEditEvent(1));
    const { allSideEffects } = foldEvents(events, pet);

    const rejections = allSideEffects.filter(
      (e) =>
        e.type === "signal.rejected" &&
        (e.payload as { signal?: string }).signal === "file.edit"
    );
    expect(rejections).toHaveLength(100); // 200 events − 100 under cap
  });
});

// ---------------------------------------------------------------------------
// Uncapped event types
// ---------------------------------------------------------------------------

describe("DEC-018 daily cap — uncapped event types", () => {
  it("daily.checkin is NOT capped and always grants full XP", () => {
    const pet = makePet();
    // Send 100 daily.checkin events of 20 XP each
    const events = Array.from({ length: 100 }, () => ({
      id: ulid(),
      type: "daily.checkin" as const,
      ts: "2026-04-17T12:00:00.000Z",
      petId: "pet-caps-001",
      source: "test",
      payload: {},
      xpDelta: 20 as const,
    }));

    const { pet: finalPet, allSideEffects } = foldEvents(events, pet);

    expect(finalPet.xp).toBe(2_000); // 100 × 20 XP — no cap
    const rejections = allSideEffects.filter((e) => e.type === "signal.rejected");
    expect(rejections).toHaveLength(0);
  });

  it("error.fixed is NOT capped — always grants full XP", () => {
    const pet = makePet();
    const events = Array.from({ length: 50 }, () => ({
      id: ulid(),
      type: "error.fixed" as const,
      ts: "2026-04-17T12:00:00.000Z",
      petId: "pet-caps-001",
      source: "test",
      payload: {},
      xpDelta: 15 as const,
    }));

    const { pet: finalPet, allSideEffects } = foldEvents(events, pet);

    expect(finalPet.xp).toBe(750); // 50 × 15 — no cap
    const rejections = allSideEffects.filter((e) => e.type === "signal.rejected");
    expect(rejections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// dailyCaps persistence across calls
// ---------------------------------------------------------------------------

describe("DEC-018 dailyCaps state persistence", () => {
  it("accumulated XP is tracked in pet.dailyCaps across successive calls", () => {
    const pet = makePet();
    const event1 = makeTokensEvent(200);
    const { pet: pet1 } = foldEvents([event1], pet);

    expect(pet1.dailyCaps["2026-04-17"]).toBeDefined();
    expect(pet1.dailyCaps["2026-04-17"]!["tokens"]).toBe(200);

    const event2 = makeTokensEvent(300);
    const { pet: pet2 } = foldEvents([event2], pet1);
    expect(pet2.dailyCaps["2026-04-17"]!["tokens"]).toBe(500);
  });

  it("dailyCaps is pruned to last 7 days on each applyEvent call", () => {
    const now = "2026-04-17";
    // Build a pet with stale cap entries spanning 10 days back
    const staleCaps: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 10; i++) {
      const d = new Date("2026-04-17");
      d.setUTCDate(d.getUTCDate() - i);
      staleCaps[d.toISOString().slice(0, 10)] = { tokens: 100, tests: 0, commits: 0, edits: 0 };
    }

    const pet = makePet({ dailyCaps: staleCaps as Pet["dailyCaps"] });
    const event = makeTokensEvent(1, `${now}T12:00:00.000Z`);
    const { pet: finalPet } = foldEvents([event], pet);

    // Should retain at most DAILY_CAPS_RETENTION_DAYS (7) day keys
    expect(Object.keys(finalPet.dailyCaps).length).toBeLessThanOrEqual(
      DAILY_CAPS_RETENTION_DAYS
    );
  });

  it("signal.rejected events themselves are no-ops — do not award XP", () => {
    const pet = makePet({ xp: 100 });
    const rejectedEvent: GlyphlingEvent = {
      id: ulid(),
      type: "signal.rejected",
      ts: "2026-04-17T12:00:00.000Z",
      petId: "pet-caps-001",
      source: "xp-engine",
      payload: {
        reason: "cap.daily",
        signal: "tokens.delta",
        origEventId: "01HTEST000000000000000000",
        requestedXp: 50,
        grantedXp: 0,
      },
    };

    const { pet: finalPet, allSideEffects } = foldEvents([rejectedEvent], pet);
    expect(finalPet.xp).toBe(100); // no change
    expect(allSideEffects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-signal independence
// ---------------------------------------------------------------------------

describe("DEC-018 daily cap — cross-signal independence", () => {
  it("each signal type tracks its own cap independently", () => {
    const pet = makePet();

    // Fill the tokens cap
    const tokenEvents = Array.from({ length: DAILY_CAP_TOKENS }, () => makeTokensEvent(1));
    const { pet: petAfterTokens } = foldEvents(tokenEvents, pet);
    expect(petAfterTokens.xp).toBe(DAILY_CAP_TOKENS);

    // Now send commits — should still grant XP (different cap bucket)
    const commitEvent = makeCommitEvent(25);
    const { pet: petAfterCommit } = foldEvents([commitEvent], petAfterTokens);
    expect(petAfterCommit.xp).toBe(DAILY_CAP_TOKENS + 25);

    // And test.pass
    const testEvent = makeTestPassEvent(50);
    const { pet: petAfterTest } = foldEvents([testEvent], petAfterCommit);
    expect(petAfterTest.xp).toBe(DAILY_CAP_TOKENS + 25 + 50);
  });
});
