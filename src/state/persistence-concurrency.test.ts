/**
 * BUG-002 regression test — TOCTOU race in appendEvent under concurrent writers.
 *
 * Spawns 2 worker processes, each calling appendEvent 25× against the same
 * GLYPHLING_HOME. Replays afterward and asserts:
 *   - Zero chain breaks
 *   - All 50 events are present (or accounted for as clock-clamp rejections)
 *   - state.globals.eventsHead matches sha256(canonicalJson(last appended event))
 *
 * Uses the spawned-process pattern from src/state/lockfile.test.ts.
 * All state is written to os.tmpdir() — never ~/.claude/ (DEC-008).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect, afterEach } from "vitest";
import { replayEvents, readState, writeState } from "./persistence.js";
import { makeEmptyState } from "./schema.js";
import { buildConfig } from "../config/env.js";
import { sha256, canonicalJson } from "../util/hash.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

async function makeTmpConfig() {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "glyphling-concurrency-test-")
  );
  tmpDirs.push(dir);
  return buildConfig(dir);
}

afterEach(async () => {
  for (const dir of tmpDirs) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  tmpDirs = [];
});

// ---------------------------------------------------------------------------
// Concurrency test
// ---------------------------------------------------------------------------

describe("appendEvent — concurrent writers (BUG-002 regression)", () => {
  it(
    "2 workers × 25 events produce zero chain breaks and all events present",
    async () => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);

      const config = await makeTmpConfig();

      // Write initial state so appendEvent can read eventsHead
      await writeState(config, makeEmptyState());

      // Write the worker script to a temp file inside the test dir
      const workerScript = path.join(config.stateHome, "worker.mjs");
      // Resolve paths needed by the worker
      const persistencePath = path.resolve(__dirname, "persistence.ts");
      const envPath = path.resolve(__dirname, "../config/env.ts");
      const schemaPath = path.resolve(__dirname, "schema.ts");

      await fs.promises.writeFile(
        workerScript,
        `
import { appendEvent } from ${JSON.stringify(persistencePath)};
import { buildConfig } from ${JSON.stringify(envPath)};

const stateHome = process.argv[2];
const workerId = process.argv[3];
const eventCount = parseInt(process.argv[4] ?? "25", 10);

const config = buildConfig(stateHome);

// Use a fixed past timestamp for all events.
//
// Clock-guard logic: "if (lastEventAt > 0) { if (ts < lastEventAt) backward;
//   else if (ts > lastEventAt + 24h) forward; }".
// Initial state has lastEventAt=0 → guard is skipped for the first event.
// After the first event commits, lastEventAt = FIXED_TS.  All subsequent
// events from both workers also carry FIXED_TS, so ts === lastEventAt — no
// backward jump, no forward jump.  Zero rejection events are emitted, keeping
// the replay chain contiguous and the assertion clean.
const FIXED_TS = "2024-06-15T12:00:00.000Z";

for (let i = 0; i < eventCount; i++) {
  await appendEvent(config, {
    id: workerId + "-evt-" + i,
    type: "daily.checkin",
    ts: FIXED_TS,
    petId: null,
    source: "test",
    payload: {},
    xpDelta: 1,
    prevHash: "",
  });
}
`,
        "utf8"
      );

      const EVENTS_PER_WORKER = 25;
      const WORKERS = 2;

      // Run two workers concurrently against the same stateHome
      await Promise.all(
        Array.from({ length: WORKERS }, (_, i) =>
          execFileAsync(
            "npx",
            [
              "tsx",
              workerScript,
              config.stateHome,
              `worker-${i}`,
              String(EVENTS_PER_WORKER),
            ],
            { cwd: process.cwd(), timeout: 60_000 }
          )
        )
      );

      // Replay and assert integrity
      const result = await replayEvents(config, 0, "");

      // Zero chain breaks
      expect(result.chainBroken).toBe(false);

      // Count events by type — exclude signal.rejected (integrity side effects)
      const payloadEvents = result.events.filter(
        (e) => e.type !== "signal.rejected"
      );
      const totalExpected = WORKERS * EVENTS_PER_WORKER;
      expect(payloadEvents.length).toBe(totalExpected);

      // state.globals.eventsHead must match the last non-rejection event's hash
      const finalState = await readState(config);
      expect(finalState).not.toBeNull();

      // Find the last event in the JSONL (not just the replayed set, which stops
      // at chain breaks — but here chainBroken=false so result.events is complete)
      const lastEvent = result.events[result.events.length - 1];
      expect(lastEvent).toBeDefined();
      const expectedHead = sha256(canonicalJson(lastEvent!));
      expect(finalState!.globals.eventsHead).toBe(expectedHead);
    },
    90_000 // generous timeout for spawning two tsx processes
  );
});
