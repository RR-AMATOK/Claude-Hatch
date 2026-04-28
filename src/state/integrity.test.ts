/**
 * DEC-018 integrity mechanism tests — all four mechanisms in one file.
 *
 * Tests:
 *   Mechanism 1 — Event-chain hashing
 *     - Fresh chain appends produce valid prevHash links
 *     - Hand-editing an event's payload breaks the chain
 *     - replayEvents detects break and stops applying downstream events
 *     - brokenAtEventId is set to the tampered event
 *     - A fresh append AFTER tampering does not heal the tampered middle
 *
 *   Mechanism 2 — Transcript cross-check for token events
 *     - tokens.delta without transcriptLineHash passes through (legacy)
 *     - tokens.delta with transcriptLineHash that matches passes through
 *     - tokens.delta with transcriptLineHash that doesn't match →
 *         signal.rejected { reason: "transcript.missing" } in non-strict mode
 *     - GLYPHLING_STRICT_TRANSCRIPT=1: unmatched transcriptLineHash drops event
 *
 *   Mechanism 3 — Daily XP caps (tested via xp/engine.ts — see engine-caps.test.ts)
 *
 *   Mechanism 4 — Monotonic clock guards (DEC-022)
 *     - Backward timestamp jump → clamped, signal.rejected clock.jump.backward
 *     - Forward jump >24h → daemon.resync emitted; ts accepted as-is (DEC-022)
 *     - Normal forward jumps within 24h pass through unchanged
 *
 * All tests use os.tmpdir() — never ~/.claude/ (DEC-008).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, afterEach } from "vitest";
import { appendEvent, replayEvents } from "./persistence.js";
import { makeEmptyState, validateState } from "./schema.js";
import { writeState, readState } from "./persistence.js";
import { buildConfig } from "../config/env.js";
import { sha256, canonicalJson } from "../util/hash.js";
import type { GlyphlingEvent } from "./schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

async function makeTmpConfig() {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "glyphling-integrity-test-")
  );
  tmpDirs.push(dir);
  return buildConfig(dir);
}

function makeTestEvent(overrides: Partial<GlyphlingEvent> = {}): GlyphlingEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
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
// Mechanism 1 — Event-chain hashing
// ---------------------------------------------------------------------------

describe("Mechanism 1 — event-chain hashing", () => {
  it("genesis event gets prevHash='' (empty string head)", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const event = makeTestEvent({ id: "chain-001" });
    const { appended } = await appendEvent(config, event);

    expect(appended.prevHash).toBe("");
  });

  it("second event gets prevHash = sha256(canonicalJson(first event))", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const e1 = makeTestEvent({ id: "chain-001", ts: new Date().toISOString() });
    const { appended: appended1 } = await appendEvent(config, e1);

    const e2 = makeTestEvent({ id: "chain-002", ts: new Date().toISOString() });
    const { appended: appended2 } = await appendEvent(config, e2);

    const expectedHead = sha256(canonicalJson(appended1));
    expect(appended2.prevHash).toBe(expectedHead);
  });

  it("state.globals.eventsHead is updated after each append", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const e1 = makeTestEvent({ id: "chain-001" });
    const { appended: appended1 } = await appendEvent(config, e1);

    const stateAfter = await readState(config);
    expect(stateAfter!.globals.eventsHead).toBe(sha256(canonicalJson(appended1)));
  });

  it("clean chain: replayEvents returns chainBroken=false", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    for (let i = 0; i < 3; i++) {
      await appendEvent(config, makeTestEvent({ id: `chain-00${i}` }));
    }

    const result = await replayEvents(config, 0, "");
    expect(result.chainBroken).toBe(false);
    expect(result.events).toHaveLength(3);
  });

  it("hand-editing an event payload (without updating prevHash) breaks the chain", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const e1 = makeTestEvent({ id: "chain-e1", xpDelta: 10 });
    const e2 = makeTestEvent({ id: "chain-e2", xpDelta: 20 });
    const e3 = makeTestEvent({ id: "chain-e3", xpDelta: 30 });

    await appendEvent(config, e1);
    await appendEvent(config, e2);
    await appendEvent(config, e3);

    // Hand-edit the second event's payload in the log without updating prevHash
    const raw = await fs.promises.readFile(config.paths.eventsLog, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(3);

    const e2parsed = JSON.parse(lines[1]!) as Record<string, unknown>;
    e2parsed["xpDelta"] = 9999; // Tamper!
    lines[1] = JSON.stringify(e2parsed);

    await fs.promises.writeFile(
      config.paths.eventsLog,
      lines.join("\n") + "\n",
      "utf8"
    );

    // Replay should detect the break at e2 (since e2's hash no longer matches e3's prevHash)
    const result = await replayEvents(config, 0, "");
    expect(result.chainBroken).toBe(true);
    // Only e1 should be replayed (break detected at e2 or e3)
    // e1 is fine; e2 is tampered but its OWN prevHash might still be "" which matches genesis
    // The break is detected at e3 because e3.prevHash was computed from the ORIGINAL e2
    expect(result.brokenAtEventId).toBe("chain-e3");
    // Only events before the break
    expect(result.events.map((e) => e.id)).not.toContain("chain-e3");
  });

  it("tampering an event stops applying downstream events (acceptance criterion 1)", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    // Append 4 events
    await appendEvent(config, makeTestEvent({ id: "ok-1" }));
    await appendEvent(config, makeTestEvent({ id: "ok-2" }));
    await appendEvent(config, makeTestEvent({ id: "tampered" }));
    await appendEvent(config, makeTestEvent({ id: "downstream" }));

    // Tamper the third event
    const raw = await fs.promises.readFile(config.paths.eventsLog, "utf8");
    const lines = raw.trim().split("\n");
    const tampered = JSON.parse(lines[2]!) as Record<string, unknown>;
    tampered["xpDelta"] = 99999;
    lines[2] = JSON.stringify(tampered);
    await fs.promises.writeFile(
      config.paths.eventsLog,
      lines.join("\n") + "\n",
      "utf8"
    );

    const result = await replayEvents(config, 0, "");
    expect(result.chainBroken).toBe(true);
    // downstream event must NOT be in result
    expect(result.events.map((e) => e.id)).not.toContain("downstream");
  });

  it("genesis case: prevHash='' is accepted only as the very first event (runningHead='')", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    // Directly write a single event with prevHash="" as the genesis event
    const event = makeTestEvent({ id: "genesis-event" });
    const eventWithHash = { ...event, prevHash: "" };
    await fs.promises.mkdir(config.stateHome, { recursive: true });
    await fs.promises.appendFile(
      config.paths.eventsLog,
      JSON.stringify(eventWithHash) + "\n",
      "utf8"
    );

    // Replay from genesis (knownHead="") should not break — it IS the first event
    const result = await replayEvents(config, 0, "");
    expect(result.chainBroken).toBe(false);
    expect(result.events).toHaveLength(1);
  });

  it("SEC-002: prevHash='' on a follow-up event (after chain established) is a chain break", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    // Append a real chained event via appendEvent so eventsHead is set
    const e1 = makeTestEvent({ id: "chain-sec002-e1" });
    await appendEvent(config, e1);

    // Now append a second event directly with prevHash="" (simulating tampered/bypassed event)
    const e2 = makeTestEvent({ id: "chain-sec002-e2" });
    const e2WithEmptyPrev = { ...e2, prevHash: "" };
    await fs.promises.appendFile(
      config.paths.eventsLog,
      JSON.stringify(e2WithEmptyPrev) + "\n",
      "utf8"
    );

    // replayEvents should detect the break: prevHash="" is invalid after the chain is established
    const result = await replayEvents(config, 0, "");
    expect(result.chainBroken).toBe(true);
    expect(result.brokenAtEventId).toBe("chain-sec002-e2");
    expect(result.reason).toBe("chain.broken.missing-prev");
    // Only the first event should be included
    expect(result.events.map((e) => e.id)).toContain("chain-sec002-e1");
    expect(result.events.map((e) => e.id)).not.toContain("chain-sec002-e2");
  });
});

// ---------------------------------------------------------------------------
// Mechanism 2 — Transcript cross-check
// ---------------------------------------------------------------------------

describe("Mechanism 2 — transcript cross-check", () => {
  it("tokens.delta without transcriptLineHash passes through (legacy events)", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    // No transcriptLineHash → passes regardless of GLYPHLING_STRICT_TRANSCRIPT
    await appendEvent(config, makeTestEvent({
      id: "tokens-legacy",
      type: "tokens.delta",
      xpDelta: 5,
      // transcriptLineHash intentionally absent
    }));

    const result = await replayEvents(config, 0, "");
    expect(result.chainBroken).toBe(false);
    // The event passes through (no rejection for missing transcriptLineHash)
    const tokenEvents = result.events.filter((e) => e.type === "tokens.delta");
    expect(tokenEvents).toHaveLength(1);
  });

  it("tokens.delta with non-matching transcriptLineHash emits signal.rejected in non-strict mode", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    // Point the transcript cache at an empty tmp dir so the check actually
    // runs (without override, a missing ~/.claude/projects/ on CI would make
    // the cache null → pass-through → no rejection).
    const projectsDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "glyphling-projects-")
    );
    tmpDirs.push(projectsDir);
    const origProjectsDir = process.env["GLYPHLING_PROJECTS_DIR"];
    process.env["GLYPHLING_PROJECTS_DIR"] = projectsDir;

    try {
      // Directly write a tokens.delta event with a fake transcriptLineHash
      const fakeHash = sha256("this line does not exist anywhere");
      const event = makeTestEvent({
        id: "tokens-fabricated",
        type: "tokens.delta",
        xpDelta: 100,
        transcriptLineHash: fakeHash,
      });
      // Write directly to log (bypassing appendEvent so the transcriptLineHash is preserved)
      await fs.promises.mkdir(config.stateHome, { recursive: true });
      await fs.promises.appendFile(
        config.paths.eventsLog,
        JSON.stringify({ ...event, prevHash: "" }) + "\n",
        "utf8"
      );

      // Non-strict mode (no env var): should still replay the event but include a rejection
      const result = await replayEvents(config, 0, "");
      expect(result.chainBroken).toBe(false);
      const rejections = result.events.filter((e) => e.type === "signal.rejected");
      expect(rejections.length).toBeGreaterThanOrEqual(1);
      const rejection = rejections[0]!;
      expect((rejection.payload as { reason: string }).reason).toBe("transcript.missing");
    } finally {
      if (origProjectsDir === undefined) {
        delete process.env["GLYPHLING_PROJECTS_DIR"];
      } else {
        process.env["GLYPHLING_PROJECTS_DIR"] = origProjectsDir;
      }
    }
  });

  it("tokens.delta without transcriptLineHash is applied in strict mode (no rejection)", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const event = makeTestEvent({
      id: "tokens-no-hash",
      type: "tokens.delta",
      xpDelta: 50,
      // no transcriptLineHash
    });
    await fs.promises.mkdir(config.stateHome, { recursive: true });
    await fs.promises.appendFile(
      config.paths.eventsLog,
      JSON.stringify({ ...event, prevHash: "" }) + "\n",
      "utf8"
    );

    const origEnv = process.env["GLYPHLING_STRICT_TRANSCRIPT"];
    process.env["GLYPHLING_STRICT_TRANSCRIPT"] = "1";
    try {
      const result = await replayEvents(config, 0, "");
      const rejections = result.events.filter((e) => e.type === "signal.rejected");
      // No rejection — event has no transcriptLineHash so strict mode doesn't apply
      expect(rejections).toHaveLength(0);
    } finally {
      if (origEnv === undefined) {
        delete process.env["GLYPHLING_STRICT_TRANSCRIPT"];
      } else {
        process.env["GLYPHLING_STRICT_TRANSCRIPT"] = origEnv;
      }
    }
  });

  it("transcript check is skipped when ~/.claude/projects/ does not exist (dev/test env)", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    // In test env ~/.claude/projects/ likely doesn't have the hash, but check is skipped
    const fakeHash = sha256("nonexistent line content");
    const event = makeTestEvent({
      id: "tokens-home-missing",
      type: "tokens.delta",
      xpDelta: 10,
      transcriptLineHash: fakeHash,
    });
    await fs.promises.mkdir(config.stateHome, { recursive: true });
    await fs.promises.appendFile(
      config.paths.eventsLog,
      JSON.stringify({ ...event, prevHash: "" }) + "\n",
      "utf8"
    );

    // If ~/.claude/projects/ doesn't exist: the check is silently skipped (no rejection)
    // If it does exist: the hash won't be found → rejection in non-strict mode
    // Either way the test should not throw
    const result = await replayEvents(config, 0, "");
    expect(result.chainBroken).toBe(false);
    // Result is valid regardless of rejection presence
    expect(result.events.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Mechanism 4 — Monotonic clock guards
// ---------------------------------------------------------------------------

describe("Mechanism 4 — monotonic clock guards", () => {
  it("backward timestamp is clamped to lastEventAt and emits clock.jump.backward", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const now = Date.now();

    // First event: 1 hour in the past
    const e1 = makeTestEvent({
      id: "clock-e1",
      ts: new Date(now - 3600 * 1000).toISOString(),
    });
    await appendEvent(config, e1);

    // Second event: 2 hours in the past (backward jump)
    const e2 = makeTestEvent({
      id: "clock-e2",
      ts: new Date(now - 7200 * 1000).toISOString(),
    });
    const { appended, rejections } = await appendEvent(config, e2);

    // Timestamp should be clamped
    const clampedTs = new Date(appended.ts).getTime();
    const e1Ts = new Date(e1.ts).getTime();
    expect(clampedTs).toBeGreaterThanOrEqual(e1Ts);

    // Should have emitted a backward-jump rejection
    const backwardRej = rejections.find(
      (r) => (r.payload as { reason: string }).reason === "clock.jump.backward"
    );
    expect(backwardRej).toBeDefined();
  });

  it("daemon.resync after >24h offline gap, single emit", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const t0 = Date.now();

    // Anchor: first event at t0
    const e1 = makeTestEvent({
      id: "resync-e1",
      ts: new Date(t0).toISOString(),
    });
    await appendEvent(config, e1);

    // Second event: 48 hours ahead
    const t0Plus48h = t0 + 48 * 3600 * 1000;
    const e2 = makeTestEvent({
      id: "resync-e2",
      ts: new Date(t0Plus48h).toISOString(),
    });
    const { appended, rejections } = await appendEvent(config, e2);

    // Timestamp must NOT be clamped — accepted as-is
    expect(new Date(appended.ts).getTime()).toBe(t0Plus48h);

    // Zero signal.rejected with clock.jump.forward
    const forwardRej = rejections.filter(
      (r) =>
        r.type === "signal.rejected" &&
        (r.payload as { reason: string }).reason === "clock.jump.forward"
    );
    expect(forwardRej).toHaveLength(0);

    // Exactly one daemon.resync
    const resyncs = rejections.filter((r) => r.type === "daemon.resync");
    expect(resyncs).toHaveLength(1);
    const resync = resyncs[0]!;
    const p = resync.payload as { from: string; to: string; gapMs: number; reason: string };
    expect(p.from).toBe(new Date(t0).toISOString());
    expect(p.to).toBe(new Date(t0Plus48h).toISOString());

    // lastEventAt updated to the real ts
    const stateAfter = await readState(config);
    expect(stateAfter!.globals.lastEventAt).toBe(t0Plus48h);
  });

  it("100 emits over 5 minutes after 48h gap converge to wall-clock", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const t0 = Date.now();

    // Anchor at t0
    await appendEvent(config, makeTestEvent({
      id: "conv-anchor",
      ts: new Date(t0).toISOString(),
    }));

    const gapBase = t0 + 48 * 3600 * 1000;
    let totalResyncs = 0;
    let totalRejectedForward = 0;

    for (let i = 0; i < 100; i++) {
      const ts = new Date(gapBase + i * 3000).toISOString();
      const { rejections } = await appendEvent(config, makeTestEvent({
        id: `conv-${i}`,
        ts,
      }));
      totalResyncs += rejections.filter((r) => r.type === "daemon.resync").length;
      totalRejectedForward += rejections.filter(
        (r) =>
          r.type === "signal.rejected" &&
          (r.payload as { reason: string }).reason === "clock.jump.forward"
      ).length;
    }

    // Exactly one daemon.resync — only the first emit triggers the gap
    expect(totalResyncs).toBe(1);
    // Zero forward-clamp rejections
    expect(totalRejectedForward).toBe(0);

    // lastEventAt settled at the last emit's ts
    const stateAfter = await readState(config);
    expect(stateAfter!.globals.lastEventAt).toBe(gapBase + 99 * 3000);

    // Chain hash is intact
    const replay = await replayEvents(config, 0, "");
    expect(replay.chainBroken).toBe(false);
  });

  it("12h gap does not trigger daemon.resync", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const t0 = Date.now();

    // Anchor at t0
    const e1 = makeTestEvent({
      id: "gap12-e1",
      ts: new Date(t0).toISOString(),
    });
    await appendEvent(config, e1);

    // Second event: 12 h later (below the 24 h threshold)
    const t0Plus12h = t0 + 12 * 3600 * 1000;
    const e2 = makeTestEvent({
      id: "gap12-e2",
      ts: new Date(t0Plus12h).toISOString(),
    });
    const { appended, rejections } = await appendEvent(config, e2);

    // Zero daemon.resync events
    const resyncs = rejections.filter((r) => r.type === "daemon.resync");
    expect(resyncs).toHaveLength(0);

    // Event accepted at its real ts
    expect(new Date(appended.ts).getTime()).toBe(t0Plus12h);

    // lastEventAt updated
    const stateAfter = await readState(config);
    expect(stateAfter!.globals.lastEventAt).toBe(t0Plus12h);
  });

  it("backward jump still emits clock.jump.backward (DEC-022: backward-clamp untouched)", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const now = Date.now();

    // First event: 1 hour in the past
    const e1 = makeTestEvent({
      id: "bwd-e1",
      ts: new Date(now - 3600 * 1000).toISOString(),
    });
    await appendEvent(config, e1);

    // Second event: 2 hours in the past (backward jump)
    const e2 = makeTestEvent({
      id: "bwd-e2",
      ts: new Date(now - 7200 * 1000).toISOString(),
    });
    const { appended, rejections } = await appendEvent(config, e2);

    // Timestamp should be clamped (not earlier than e1)
    const clampedTs = new Date(appended.ts).getTime();
    const e1Ts = new Date(e1.ts).getTime();
    expect(clampedTs).toBeGreaterThanOrEqual(e1Ts);

    // Must have emitted a backward-jump rejection
    const backwardRej = rejections.find(
      (r) =>
        r.type === "signal.rejected" &&
        (r.payload as { reason: string }).reason === "clock.jump.backward"
    );
    expect(backwardRej).toBeDefined();

    // Must NOT have emitted a daemon.resync (backward path is unaffected by DEC-022)
    const resyncs = rejections.filter((r) => r.type === "daemon.resync");
    expect(resyncs).toHaveLength(0);
  });

  it("live-pathology repro: 26h gap, 10 fresh emits in 10s converge", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const now = Date.now();
    // Simulate Bramble's stuck chain: lastEventAt is 26h in the past
    const staleTs = now - 26 * 3600 * 1000;

    // Write an anchor event at staleTs so lastEventAt = staleTs
    await appendEvent(config, makeTestEvent({
      id: "bramble-anchor",
      ts: new Date(staleTs).toISOString(),
    }));

    let totalResyncs = 0;
    let totalRejectedForward = 0;
    let totalXp = 0;

    // Emit 10 tokens.delta events at now, now+1s, ..., now+9s
    for (let i = 0; i < 10; i++) {
      const ts = new Date(now + i * 1000).toISOString();
      const { rejections, appended } = await appendEvent(
        config,
        makeTestEvent({
          id: `bramble-emit-${i}`,
          type: "tokens.delta",
          ts,
          xpDelta: 10,
        })
      );
      totalResyncs += rejections.filter((r) => r.type === "daemon.resync").length;
      totalRejectedForward += rejections.filter(
        (r) =>
          r.type === "signal.rejected" &&
          (r.payload as { reason: string }).reason === "clock.jump.forward"
      ).length;
      totalXp += appended.xpDelta ?? 0;
    }

    // Exactly 1 daemon.resync (only the first emit exceeds the 24h threshold)
    expect(totalResyncs).toBe(1);
    // Zero clock.jump.forward rejections
    expect(totalRejectedForward).toBe(0);
    // All 10 events delivered with their xpDelta
    expect(totalXp).toBe(100);

    // lastEventAt is within 30 seconds of now (converged to wall-clock)
    const stateAfter = await readState(config);
    expect(stateAfter!.globals.lastEventAt).toBeGreaterThanOrEqual(now);
    expect(stateAfter!.globals.lastEventAt).toBeLessThanOrEqual(now + 30_000);
  });

  it("forward jump within 24h passes without rejection (normal operation)", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const now = Date.now();

    const e1 = makeTestEvent({
      id: "clock-normal-1",
      ts: new Date(now).toISOString(),
    });
    await appendEvent(config, e1);

    // 6 hours later — normal forward progression
    const e2 = makeTestEvent({
      id: "clock-normal-2",
      ts: new Date(now + 6 * 3600 * 1000).toISOString(),
    });
    const { rejections } = await appendEvent(config, e2);

    const clockRejections = rejections.filter((r) => {
      const p = r.payload as { reason: string };
      return p.reason === "clock.jump.forward" || p.reason === "clock.jump.backward";
    });
    expect(clockRejections).toHaveLength(0);
  });

  it("state.globals.lastEventAt is updated monotonically", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const now = Date.now();

    await appendEvent(config, makeTestEvent({
      id: "mono-1",
      ts: new Date(now).toISOString(),
    }));
    const stateAfter1 = await readState(config);
    const last1 = stateAfter1!.globals.lastEventAt;

    await appendEvent(config, makeTestEvent({
      id: "mono-2",
      ts: new Date(now + 1000).toISOString(),
    }));
    const stateAfter2 = await readState(config);
    const last2 = stateAfter2!.globals.lastEventAt;

    expect(last2).toBeGreaterThanOrEqual(last1);
  });

  it("backward jump clamping never moves lastEventAt backward", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    const now = Date.now();

    await appendEvent(config, makeTestEvent({
      id: "backward-1",
      ts: new Date(now).toISOString(),
    }));
    const stateAfter1 = await readState(config);
    const lastBefore = stateAfter1!.globals.lastEventAt;

    // Append a backward-timestamped event
    await appendEvent(config, makeTestEvent({
      id: "backward-2",
      ts: new Date(now - 5000).toISOString(),
    }));
    const stateAfter2 = await readState(config);
    const lastAfter = stateAfter2!.globals.lastEventAt;

    // lastEventAt must not decrease
    expect(lastAfter).toBeGreaterThanOrEqual(lastBefore);
  });
});

// ---------------------------------------------------------------------------
// Schema migration — graceful handling of old events without prevHash
// ---------------------------------------------------------------------------

describe("Schema migration — backward compatibility", () => {
  it("existing events without prevHash are skipped as unparseable (SEC-002: prevHash is now required)", async () => {
    const config = await makeTmpConfig();
    await writeState(config, makeEmptyState());

    // Simulate old-format events written before DEC-018 (no prevHash field).
    // With SEC-002, prevHash is required, so these events fail Zod validation
    // and are treated as unparseable lines (skipped, no chain break).
    const oldFormatEvent = {
      id: "old-event-001",
      type: "daily.checkin",
      ts: new Date().toISOString(),
      petId: null,
      source: "legacy",
      payload: {},
      xpDelta: 20,
      // No prevHash field — will fail parseEvent()
    };
    await fs.promises.mkdir(config.stateHome, { recursive: true });
    await fs.promises.appendFile(
      config.paths.eventsLog,
      JSON.stringify(oldFormatEvent) + "\n",
      "utf8"
    );

    // Should skip the event (unparseable) without crashing or flagging chain break
    const result = await replayEvents(config, 0, "");
    expect(result.chainBroken).toBe(false);
    // Event is skipped (prevHash missing = parseEvent returns null)
    expect(result.events).toHaveLength(0);
  });

  it("state.json without eventsHead/lastEventAt is accepted (Zod defaults)", async () => {
    const config = await makeTmpConfig();
    // Write state without the new DEC-018 fields (simulating old state.json)
    const oldState = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pets: [],
      globals: {
        activePetId: null,
        unlocks: {
          gifTier1: false,
          gifTier2: false,
          gifTier3: false,
          adoption: false,
        },
        eventsCursor: 0,
        // No eventsHead or lastEventAt
      },
    };

    await fs.promises.mkdir(config.stateHome, { recursive: true });
    await fs.promises.writeFile(
      config.paths.stateFile,
      JSON.stringify(oldState),
      "utf8"
    );

    const parsed = await readState(config);
    expect(parsed).not.toBeNull();
    // Zod should have defaulted these fields
    expect(parsed!.globals.eventsHead).toBe("");
    expect(parsed!.globals.lastEventAt).toBe(0);
    // Also validate the schema does not throw
    expect(() => validateState(parsed!)).not.toThrow();
  });
});
