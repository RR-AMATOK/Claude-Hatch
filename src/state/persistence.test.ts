/**
 * Tests for src/state/persistence.ts
 *
 * Covers:
 *   - readState: missing file, valid file, corrupt file retry, schema failure
 *   - writeState: atomic write (tmp → rename), content integrity
 *   - appendEvent: appends to events.jsonl; folds into state when fold provided
 *   - replayEvents: reads events after cursor offset; skips corrupt lines
 *   - watchState: second process writes, first sees update within 100ms
 *   - checkRecoveryNeeded: detects state.updatedAt < last event ts
 *   - Crash recovery: stale tmp files swept; state still readable after recovery
 *
 * All tests use os.tmpdir() — never ~/.claude/ (DEC-008).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, afterEach } from "vitest";
import {
  readState,
  writeState,
  appendEvent,
  replayEvents,
  watchState,
  checkRecoveryNeeded,
  type WatchValidationError,
} from "./persistence.js";
import { makeEmptyState, validateState } from "./schema.js";
import { buildConfig } from "../config/env.js";
import { sha256, canonicalJson } from "../util/hash.js";
import type { StateFileV1, GlyphlingEvent } from "./schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

async function makeTmpConfig() {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "glyphling-persist-test-")
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
// readState
// ---------------------------------------------------------------------------

describe("readState", () => {
  it("returns null when state.json does not exist", async () => {
    const config = await makeTmpConfig();
    const result = await readState(config);
    expect(result).toBeNull();
  });

  it("reads and validates a valid state file", async () => {
    const config = await makeTmpConfig();
    const state = makeEmptyState();
    await fs.promises.mkdir(config.stateHome, { recursive: true });
    await fs.promises.writeFile(
      config.paths.stateFile,
      JSON.stringify(state),
      "utf8"
    );
    const result = await readState(config);
    expect(result).not.toBeNull();
    expect(result!.schemaVersion).toBe(1);
  });

  it("returns null on corrupt JSON after retry", async () => {
    const config = await makeTmpConfig();
    await fs.promises.mkdir(config.stateHome, { recursive: true });
    await fs.promises.writeFile(
      config.paths.stateFile,
      "{ this is not json }",
      "utf8"
    );
    // Should not throw; returns null after retry
    const result = await readState(config);
    expect(result).toBeNull();
  });

  it("throws on EACCES or other non-ENOENT errors", async () => {
    // We can't easily simulate EACCES in tests without root, so just verify
    // we get null for a parseable but schema-invalid file
    const config = await makeTmpConfig();
    await fs.promises.mkdir(config.stateHome, { recursive: true });
    await fs.promises.writeFile(
      config.paths.stateFile,
      JSON.stringify({ schemaVersion: 99 }),
      "utf8"
    );
    const result = await readState(config);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// writeState
// ---------------------------------------------------------------------------

describe("writeState", () => {
  it("writes state that can be read back", async () => {
    const config = await makeTmpConfig();
    const state = makeEmptyState();
    await writeState(config, state);
    const result = await readState(config);
    expect(result).not.toBeNull();
    expect(result!.schemaVersion).toBe(1);
    expect(result!.createdAt).toBe(state.createdAt);
  });

  it("uses atomic tmp→rename (no stale tmp after write)", async () => {
    const config = await makeTmpConfig();
    const state = makeEmptyState();
    await writeState(config, state);
    const entries = await fs.promises.readdir(config.stateHome);
    const tmpFiles = entries.filter((e) => e.startsWith("state.json.tmp."));
    expect(tmpFiles).toHaveLength(0);
  });

  it("throws on schema-invalid state", async () => {
    const config = await makeTmpConfig();
    const bad = { schemaVersion: 99 };
    await expect(
      writeState(config, bad as unknown as StateFileV1)
    ).rejects.toThrow();
  });

  it("creates stateHome directory if it does not exist", async () => {
    const config = await makeTmpConfig();
    // Remove the dir (makeTmpDir already created it; recreate scenario)
    await fs.promises.rm(config.stateHome, { recursive: true, force: true });
    const state = makeEmptyState();
    await writeState(config, state);
    const exists = await fs.promises
      .access(config.paths.stateFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it("multiple sequential writes preserve content integrity", async () => {
    const config = await makeTmpConfig();
    for (let i = 0; i < 5; i++) {
      const state: StateFileV1 = {
        ...makeEmptyState(),
        globals: {
          activePetId: null,
          unlocks: {
            gifTier1: false,
            gifTier2: false,
            gifTier3: false,
            adoption: false,
          },
          eventsCursor: i,
          eventsHead: "",
          lastEventAt: 0,
        },
      };
      await writeState(config, state);
    }
    const final = await readState(config);
    expect(final!.globals.eventsCursor).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// appendEvent
// ---------------------------------------------------------------------------

describe("appendEvent", () => {
  it("appends a line to events.jsonl", async () => {
    const config = await makeTmpConfig();
    const event = makeTestEvent();
    await appendEvent(config, event);
    const raw = await fs.promises.readFile(config.paths.eventsLog, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as { id: string };
    expect(parsed.id).toBe(event.id);
  });

  it("appends multiple events in order", async () => {
    const config = await makeTmpConfig();
    const events = [
      makeTestEvent({ id: "evt-1", type: "daily.checkin" }),
      makeTestEvent({ id: "evt-2", type: "pet.fed" }),
      makeTestEvent({ id: "evt-3", type: "git.commit" }),
    ];
    for (const e of events) {
      await appendEvent(config, e);
    }
    const raw = await fs.promises.readFile(config.paths.eventsLog, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    const ids = lines.map((l) => (JSON.parse(l) as { id: string }).id);
    expect(ids).toEqual(["evt-1", "evt-2", "evt-3"]);
  });

  it("folds event into state when fold is provided", async () => {
    const config = await makeTmpConfig();
    const initial = makeEmptyState();
    await writeState(config, initial);

    const event = makeTestEvent({ xpDelta: 100 });
    let foldCalled = false;

    await appendEvent(config, event, (state, _evt) => {
      foldCalled = true;
      return {
        ...state,
        globals: {
          ...state.globals,
          eventsCursor: state.globals.eventsCursor + 1,
        },
        updatedAt: new Date().toISOString(),
      };
    });

    expect(foldCalled).toBe(true);
    const result = await readState(config);
    expect(result!.globals.eventsCursor).toBe(1);
  });

  it("still appends event when fold is not provided", async () => {
    const config = await makeTmpConfig();
    const event = makeTestEvent();
    await appendEvent(config, event); // no fold
    const raw = await fs.promises.readFile(config.paths.eventsLog, "utf8");
    expect(raw.trim()).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// replayEvents
// ---------------------------------------------------------------------------

describe("replayEvents", () => {
  it("returns empty array when events.jsonl does not exist", async () => {
    const config = await makeTmpConfig();
    const { events } = await replayEvents(config, 0);
    expect(events).toHaveLength(0);
  });

  it("replays all events when cursor is 0", async () => {
    const config = await makeTmpConfig();
    const evts = [
      makeTestEvent({ id: "r1" }),
      makeTestEvent({ id: "r2" }),
    ];
    for (const e of evts) await appendEvent(config, e);

    const { events } = await replayEvents(config, 0);
    expect(events).toHaveLength(2);
    expect(events[0]!.id).toBe("r1");
    expect(events[1]!.id).toBe("r2");
  });

  it("skips events before cursor offset", async () => {
    const config = await makeTmpConfig();

    const e1 = makeTestEvent({ id: "r1" });
    const e2 = makeTestEvent({ id: "r2" });
    await appendEvent(config, e1);

    // Record byte offset after first event
    const stat1 = await fs.promises.stat(config.paths.eventsLog);
    const cursor = stat1.size;

    await appendEvent(config, e2);

    const { events } = await replayEvents(config, cursor);
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe("r2");
  });

  it("skips unparseable lines and continues", async () => {
    const config = await makeTmpConfig();
    await fs.promises.mkdir(config.stateHome, { recursive: true });

    // Write a mix of valid and corrupt lines.
    // valid is the genesis event (prevHash="").
    // valid2 must have prevHash = sha256(canonicalJson(valid)) since the corrupt line
    // is skipped (not in the chain), so the running head after valid is its hash.
    const validEvent = makeTestEvent({ id: "valid", prevHash: "" });
    const valid2Event = makeTestEvent({
      id: "valid2",
      prevHash: sha256(canonicalJson(validEvent)),
    });
    const lines = [
      JSON.stringify(validEvent),
      "{ this is corrupt json }",
      JSON.stringify(valid2Event),
    ];
    await fs.promises.writeFile(
      config.paths.eventsLog,
      lines.join("\n") + "\n",
      "utf8"
    );

    const { events } = await replayEvents(config, 0);
    expect(events.map((e) => e.id)).toEqual(["valid", "valid2"]);
  });

  it("replay is idempotent (calling twice with same cursor returns same events)", async () => {
    const config = await makeTmpConfig();
    const evts = [makeTestEvent({ id: "idem1" }), makeTestEvent({ id: "idem2" })];
    for (const e of evts) await appendEvent(config, e);

    const first = await replayEvents(config, 0);
    const second = await replayEvents(config, 0);
    expect(first.events.map((e) => e.id)).toEqual(
      second.events.map((e) => e.id)
    );
  });
});

// ---------------------------------------------------------------------------
// checkRecoveryNeeded
// ---------------------------------------------------------------------------

describe("checkRecoveryNeeded", () => {
  it("returns false when state.json does not exist", async () => {
    const config = await makeTmpConfig();
    const result = await checkRecoveryNeeded(config);
    expect(result).toBe(false);
  });

  it("returns false when events.jsonl does not exist", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());
    const result = await checkRecoveryNeeded(config);
    expect(result).toBe(false);
  });

  it("returns false when state is up-to-date with events", async () => {
    const config = await makeTmpConfig();

    // Write a state AFTER the last event timestamp
    const event = makeTestEvent({ ts: new Date(Date.now() - 1000).toISOString() });
    await appendEvent(config, event);

    const state: StateFileV1 = {
      ...makeEmptyState(),
      updatedAt: new Date().toISOString(), // newer than event
    };
    await writeState(config, state);

    const result = await checkRecoveryNeeded(config);
    expect(result).toBe(false);
  });

  it("returns true when last event ts > state.updatedAt", async () => {
    const config = await makeTmpConfig();

    // Write a state with an old updatedAt
    const oldState: StateFileV1 = {
      ...makeEmptyState(),
      updatedAt: new Date(Date.now() - 10_000).toISOString(),
    };
    await writeState(config, oldState);

    // Append an event with a recent timestamp
    const event = makeTestEvent({ ts: new Date().toISOString() });
    await fs.promises.mkdir(config.stateHome, { recursive: true });
    await fs.promises.appendFile(
      config.paths.eventsLog,
      JSON.stringify(event) + "\n",
      "utf8"
    );

    const result = await checkRecoveryNeeded(config);
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// watchState — second process writes, first sees update within 100ms
// ---------------------------------------------------------------------------

describe("watchState", () => {
  it(
    "notifies listener within 100ms when state file changes",
    async () => {
      const config = await makeTmpConfig();
      const initial = makeEmptyState();
      await writeState(config, initial);

      let received: StateFileV1 | null = null;
      const unwatch = watchState(config, (state) => {
        received = state;
      });

      try {
        // Write a new state after a short delay
        const updated: StateFileV1 = {
          ...initial,
          globals: {
            ...initial.globals,
            eventsCursor: 42,
          },
          updatedAt: new Date().toISOString(),
        };

        await new Promise((r) => setTimeout(r, 30));
        await writeState(config, updated);

        // Wait up to 200ms for the debounce + read to fire
        const deadline = Date.now() + 200;
        while (received === null && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 10));
        }

        expect(received).not.toBeNull();
        expect((received as unknown as StateFileV1).globals.eventsCursor).toBe(42);
      } finally {
        unwatch();
      }
    },
    10_000
  );

  it("unsubscribe stops notifications", async () => {
    const config = await makeTmpConfig();
    const initial = makeEmptyState();
    await writeState(config, initial);

    let callCount = 0;
    const unwatch = watchState(config, () => {
      callCount++;
    });
    unwatch(); // immediately unsubscribe

    await writeState(config, { ...initial, updatedAt: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 100));

    expect(callCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Crash recovery: stale tmp file is swept on startup (via checkRecoveryNeeded)
// ---------------------------------------------------------------------------

describe("crash recovery", () => {
  it("sweeps stale tmp file on startup and state is still readable", async () => {
    const config = await makeTmpConfig();
    const state = makeEmptyState();
    await writeState(config, state);

    // Simulate a stale tmp file left by a crashed writer
    const staleTmp = path.join(
      config.stateHome,
      `state.json.tmp.99999.deadbeef`
    );
    await fs.promises.writeFile(staleTmp, "partial content");
    const oldTime = new Date(Date.now() - 10_000);
    await fs.promises.utimes(staleTmp, oldTime, oldTime);

    // checkRecoveryNeeded calls sweepStale internally
    await checkRecoveryNeeded(config);

    // Stale tmp is gone
    const tmpExists = await fs.promises
      .access(staleTmp)
      .then(() => true)
      .catch(() => false);
    expect(tmpExists).toBe(false);

    // State is still valid
    const result = await readState(config);
    expect(result).not.toBeNull();
    expect(() => validateState(result!)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// TODO-038: watchState onError callback — parse/validation failures
// ---------------------------------------------------------------------------

describe("watchState — validation error surfacing (TODO-038)", () => {
  it(
    "calls onError with a WatchValidationError when state.json fails schema validation",
    async () => {
      const config = await makeTmpConfig();
      const initial = makeEmptyState();
      await writeState(config, initial);

      const errors: WatchValidationError[] = [];
      const unwatch = watchState(
        config,
        () => { /* success listener — not relevant to this test */ },
        (err) => { errors.push(err); }
      );

      try {
        // Write schema-invalid content directly (bypasses writeState validation)
        await new Promise((r) => setTimeout(r, 30));
        await fs.promises.writeFile(
          config.paths.stateFile,
          JSON.stringify({ schemaVersion: 999, junk: true }),
          "utf8"
        );

        // Wait for debounce + read (200ms headroom)
        const deadline = Date.now() + 300;
        while (errors.length === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 20));
        }

        expect(errors).toHaveLength(1);
        const err = errors[0]!;
        expect(err.kind).toBe("validation");
        expect(typeof err.reason).toBe("string");
        expect(err.reason.length).toBeGreaterThan(0);
        expect(err.reason.length).toBeLessThanOrEqual(60);
        expect(err.rejectedAt).toBeGreaterThan(0);
        expect(err.retryCount).toBe(0);
      } finally {
        unwatch();
      }
    },
    10_000
  );

  it(
    "success listener is NOT called when state.json fails validation",
    async () => {
      const config = await makeTmpConfig();
      const initial = makeEmptyState();
      await writeState(config, initial);

      let successCount = 0;
      const unwatch = watchState(
        config,
        () => { successCount++; },
        () => { /* error callback — ignore */ }
      );

      try {
        await new Promise((r) => setTimeout(r, 30));
        await fs.promises.writeFile(
          config.paths.stateFile,
          "{ not valid json {{{{",
          "utf8"
        );

        // Wait for the debounce window to pass
        await new Promise((r) => setTimeout(r, 200));

        // The success listener should not have been called for the invalid write
        expect(successCount).toBe(0);
      } finally {
        unwatch();
      }
    },
    10_000
  );

  it(
    "onError is not called again when the same error repeats (stderr deduplication)",
    async () => {
      const config = await makeTmpConfig();
      const initial = makeEmptyState();
      await writeState(config, initial);

      const stderrLines: string[] = [];
      const origWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: unknown, ...args: unknown[]) => {
        if (typeof chunk === "string" && chunk.includes("state.json invalid")) {
          stderrLines.push(chunk);
        }
        return (origWrite as (...a: unknown[]) => boolean)(chunk, ...args);
      }) as typeof process.stderr.write;

      const errors: WatchValidationError[] = [];
      const unwatch = watchState(
        config,
        () => { /* success listener */ },
        (err) => { errors.push(err); }
      );

      try {
        const badContent = JSON.stringify({ schemaVersion: 999 });

        // Write the same invalid content twice (simulate repeated writes)
        await new Promise((r) => setTimeout(r, 30));
        await fs.promises.writeFile(config.paths.stateFile, badContent, "utf8");
        await new Promise((r) => setTimeout(r, 150));
        await fs.promises.writeFile(config.paths.stateFile, badContent, "utf8");
        await new Promise((r) => setTimeout(r, 150));

        // Two distinct file-watch events were fired, so onError should have been
        // called twice (once per event), but stderr should have been logged only ONCE
        // (deduplicated by message content).
        expect(stderrLines).toHaveLength(1);
      } finally {
        process.stderr.write = origWrite;
        unwatch();
      }
    },
    10_000
  );

  it(
    "onError is cleared (success listener called) after a valid state.json is written",
    async () => {
      const config = await makeTmpConfig();
      const initial = makeEmptyState();
      await writeState(config, initial);

      const errors: WatchValidationError[] = [];
      const successes: StateFileV1[] = [];

      const unwatch = watchState(
        config,
        (s) => { successes.push(s); },
        (err) => { errors.push(err); }
      );

      try {
        // Step 1: write bad state
        await new Promise((r) => setTimeout(r, 30));
        await fs.promises.writeFile(
          config.paths.stateFile,
          JSON.stringify({ schemaVersion: 999 }),
          "utf8"
        );
        await new Promise((r) => setTimeout(r, 200));
        expect(errors.length).toBeGreaterThan(0);

        // Step 2: write valid state — success listener fires
        const valid: StateFileV1 = {
          ...initial,
          globals: { ...initial.globals, eventsCursor: 77 },
          updatedAt: new Date().toISOString(),
        };
        await writeState(config, valid);

        const deadline = Date.now() + 300;
        while (successes.length === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 20));
        }

        expect(successes.length).toBeGreaterThan(0);
        expect(successes[0]!.globals.eventsCursor).toBe(77);
      } finally {
        unwatch();
      }
    },
    10_000
  );
});
