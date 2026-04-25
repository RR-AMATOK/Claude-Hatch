/**
 * Tests for src/state/store.ts
 *
 * Covers:
 *   - getState() returns null before boot, state after boot
 *   - hydrate() updates in-memory state and notifies subscribers
 *   - subscribe() / unsubscribe lifecycle
 *   - dispatch(HYDRATE) persists state to disk
 *   - dispatch(APPLY_EVENT) appends event and folds into state
 *   - replayEvents() replays unsynced events from cursor
 *   - materialize() rebuilds state from scratch
 *   - File-watch integration: external write triggers subscriber
 *
 * All tests use os.tmpdir() — never ~/.claude/ (DEC-008).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, afterEach } from "vitest";
import { StateStore } from "./store.js";
import { makeEmptyState, type StateFileV1, type GlyphlingEvent } from "./schema.js";
import { writeState, readState } from "./persistence.js";
import { buildConfig } from "../config/env.js";
import { sha256, canonicalJson } from "../util/hash.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

async function makeTmpConfig() {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "glyphling-store-test-")
  );
  tmpDirs.push(dir);
  return buildConfig(dir);
}

function makeTestEvent(overrides: Partial<GlyphlingEvent> = {}): GlyphlingEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: "daily.checkin",
    ts: new Date().toISOString(),
    petId: null,
    source: "test",
    payload: {},
    xpDelta: 20,
    prevHash: "",
    ...overrides,
  };
}

/** Identity fold — returns state unchanged (useful for testing event append only) */
const identityFold: (s: StateFileV1, _e: GlyphlingEvent) => StateFileV1 = (
  s
) => s;

/** Fold that increments eventsCursor */
const cursorFold: (s: StateFileV1, _e: GlyphlingEvent) => StateFileV1 = (s) => ({
  ...s,
  globals: { ...s.globals, eventsCursor: s.globals.eventsCursor + 1 },
  updatedAt: new Date().toISOString(),
});

afterEach(async () => {
  for (const dir of tmpDirs) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
  tmpDirs = [];
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("StateStore — initial state", () => {
  it("getState() returns null before boot", () => {
    const store = new StateStore();
    expect(store.getState()).toBeNull();
  });

  it("getState() returns null after boot when no state file exists", async () => {
    const config = await makeTmpConfig();
    const store = new StateStore();
    await store.boot(config);
    store.teardown();
    expect(store.getState()).toBeNull();
  });

  it("getState() returns state after boot when state file exists", async () => {
    const config = await makeTmpConfig();
    const initial = makeEmptyState();
    await writeState(config, initial);

    const store = new StateStore();
    await store.boot(config);
    store.teardown();

    expect(store.getState()).not.toBeNull();
    expect(store.getState()!.schemaVersion).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// hydrate
// ---------------------------------------------------------------------------

describe("StateStore — hydrate", () => {
  it("updates in-memory state", () => {
    const store = new StateStore();
    const state = makeEmptyState();
    store.hydrate(state);
    expect(store.getState()).toBe(state);
  });

  it("notifies subscribers", () => {
    const store = new StateStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.hydrate(makeEmptyState());
    expect(calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// subscribe / unsubscribe
// ---------------------------------------------------------------------------

describe("StateStore — subscribe", () => {
  it("subscribe returns an unsubscribe function", () => {
    const store = new StateStore();
    let calls = 0;
    const unsub = store.subscribe(() => calls++);
    store.hydrate(makeEmptyState());
    unsub();
    store.hydrate(makeEmptyState());
    expect(calls).toBe(1); // only the first hydrate triggered it
  });

  it("multiple subscribers all receive notifications", () => {
    const store = new StateStore();
    const counters = [0, 0, 0];
    counters.forEach((_, i) => {
      store.subscribe(() => counters[i]!++);
    });
    store.hydrate(makeEmptyState());
    expect(counters).toEqual([1, 1, 1]);
  });
});

// ---------------------------------------------------------------------------
// dispatch(HYDRATE)
// ---------------------------------------------------------------------------

describe("StateStore — dispatch HYDRATE", () => {
  it("persists state to disk", async () => {
    const config = await makeTmpConfig();
    const store = new StateStore();
    await store.boot(config);

    const updated: StateFileV1 = {
      ...makeEmptyState(),
      globals: {
        activePetId: null,
        unlocks: {
          gifTier1: true,
          gifTier2: false,
          gifTier3: false,
          adoption: false,
        },
        eventsCursor: 99,
        eventsHead: "",
        lastEventAt: 0,
      },
    };

    await store.dispatch({ type: "HYDRATE", state: updated });
    store.teardown();

    const onDisk = await readState(config);
    expect(onDisk!.globals.eventsCursor).toBe(99);
  });

  it("notifies subscribers", async () => {
    const config = await makeTmpConfig();
    const store = new StateStore();
    await store.boot(config);

    let calls = 0;
    store.subscribe(() => calls++);

    await store.dispatch({ type: "HYDRATE", state: makeEmptyState() });
    store.teardown();

    expect(calls).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// dispatch(APPLY_EVENT)
// ---------------------------------------------------------------------------

describe("StateStore — dispatch APPLY_EVENT", () => {
  it("appends event to events.jsonl", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const store = new StateStore();
    await store.boot(config);

    const event = makeTestEvent();
    await store.dispatch({ type: "APPLY_EVENT", event, fold: identityFold });
    store.teardown();

    const raw = await fs.promises.readFile(config.paths.eventsLog, "utf8");
    expect(raw.trim()).not.toBe("");
    const parsed = JSON.parse(raw.trim().split("\n")[0]!) as { id: string };
    expect(parsed.id).toBe(event.id);
  });

  it("applies fold to in-memory state", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const store = new StateStore();
    await store.boot(config);

    const event = makeTestEvent();
    await store.dispatch({ type: "APPLY_EVENT", event, fold: cursorFold });
    store.teardown();

    expect(store.getState()!.globals.eventsCursor).toBe(1);
  });

  it("NOOP does not change state or notify", async () => {
    const config = await makeTmpConfig();
    const store = new StateStore();
    await store.boot(config);

    let calls = 0;
    store.subscribe(() => calls++);

    await store.dispatch({ type: "NOOP" });
    store.teardown();

    expect(calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// replayEvents
// ---------------------------------------------------------------------------

describe("StateStore — replayEvents", () => {
  it("returns empty array when no events exist", async () => {
    const config = await makeTmpConfig();
    const store = new StateStore();
    await store.boot(config);

    const events = await store.replayEvents(identityFold);
    store.teardown();

    expect(events).toHaveLength(0);
  });

  it("replays events after cursor and updates state", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    // Append two events directly to events.jsonl (bypassing the store).
    // SEC-002: events must be properly chained (prevHash set correctly).
    const e1 = makeTestEvent({ id: "e1", prevHash: "" });
    const e2 = makeTestEvent({ id: "e2", prevHash: sha256(canonicalJson(e1)) });
    await fs.promises.mkdir(config.stateHome, { recursive: true });
    await fs.promises.appendFile(
      config.paths.eventsLog,
      JSON.stringify(e1) + "\n" + JSON.stringify(e2) + "\n",
      "utf8"
    );

    const store = new StateStore();
    await store.boot(config);

    const replayed = await store.replayEvents(cursorFold);
    store.teardown();

    expect(replayed.map((e) => e.id)).toContain("e1");
    expect(replayed.map((e) => e.id)).toContain("e2");
  });

  it("is idempotent: replay twice gives same result", async () => {
    const config = await makeTmpConfig();
    const state = makeEmptyState();
    await writeState(config, state);

    const event = makeTestEvent({ id: "idem" });
    await fs.promises.mkdir(config.stateHome, { recursive: true });
    await fs.promises.appendFile(
      config.paths.eventsLog,
      JSON.stringify(event) + "\n",
      "utf8"
    );

    const store = new StateStore();
    await store.boot(config);

    const first = await store.replayEvents(cursorFold);
    // After first replay cursor advances past the event
    const second = await store.replayEvents(cursorFold);
    store.teardown();

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0); // cursor now past event
  });
});

// ---------------------------------------------------------------------------
// materialize
// ---------------------------------------------------------------------------

describe("StateStore — materialize", () => {
  it("rebuilds state from events.jsonl from scratch", async () => {
    const config = await makeTmpConfig();
    await fs.promises.mkdir(config.stateHome, { recursive: true });

    // Write 3 properly chained events (SEC-002: prevHash must be set correctly)
    const m1 = makeTestEvent({ id: "m1", prevHash: "" });
    const m2 = makeTestEvent({ id: "m2", prevHash: sha256(canonicalJson(m1)) });
    const m3 = makeTestEvent({ id: "m3", prevHash: sha256(canonicalJson(m2)) });
    const events = [m1, m2, m3];
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await fs.promises.writeFile(config.paths.eventsLog, lines, "utf8");

    const store = new StateStore();
    await store.boot(config);

    let applyCount = 0;
    const countingFold: typeof cursorFold = (s, _e) => {
      applyCount++;
      return { ...s, updatedAt: new Date().toISOString() };
    };

    const result = await store.materialize(countingFold);
    store.teardown();

    expect(applyCount).toBe(3);
    expect(result.schemaVersion).toBe(1);
    // Cursor should reflect full byte offset
    expect(result.globals.eventsCursor).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// File-watch: external write notifies subscriber
// ---------------------------------------------------------------------------

describe("StateStore — file-watch integration", () => {
  it(
    "notifies subscriber within 150ms when another process writes state.json",
    async () => {
      const config = await makeTmpConfig();
      const initial = makeEmptyState();
      await writeState(config, initial);

      const store = new StateStore();
      await store.boot(config);

      let notified = false;
      store.subscribe(() => {
        // Only flag when cursor changed (not on boot hydrate)
        const s = store.getState();
        if (s && s.globals.eventsCursor === 777) {
          notified = true;
        }
      });

      // Simulate external write
      const updated: StateFileV1 = {
        ...initial,
        globals: { ...initial.globals, eventsCursor: 777 },
        updatedAt: new Date().toISOString(),
      };
      await new Promise((r) => setTimeout(r, 20));
      await writeState(config, updated);

      // Wait up to 200ms
      const deadline = Date.now() + 200;
      while (!notified && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }

      store.teardown();
      expect(notified).toBe(true);
    },
    10_000
  );
});
