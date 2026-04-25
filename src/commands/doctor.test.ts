/**
 * Tests for `glyphling doctor`:
 *   - Outputs plausible health diagnostics
 *   - Reports no state when state file is absent
 *   - Reports cap usage from dailyCaps
 *   - Reports last error from watch.log
 */

import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildConfig } from "../config/env.js";
import { runDoctor } from "./doctor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureStdout(): { stop: () => string } {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as NodeJS.WriteStream & { write: (chunk: string | Uint8Array) => boolean }).write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  return {
    stop() {
      (process.stdout as NodeJS.WriteStream & { write: typeof orig }).write = orig;
      return chunks.join("");
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runDoctor", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "doctor-test-"));
    process.env["GLYPHLING_PROJECTS_DIR"] = path.join(tmpDir, "projects");
  });

  afterEach(async () => {
    delete process.env["GLYPHLING_PROJECTS_DIR"];
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 and reports no state when state file is absent", async () => {
    const config = buildConfig(tmpDir);
    const capture = captureStdout();
    const code = await runDoctor(config);
    const output = capture.stop();

    expect(code).toBe(0);
    expect(output).toContain("glyphling doctor");
    expect(output).toContain("no state file found");
  });

  it("reports watcher not running when no lockfile exists", async () => {
    const config = buildConfig(tmpDir);
    const capture = captureStdout();
    await runDoctor(config);
    const output = capture.stop();

    expect(output).toMatch(/not running/i);
  });

  it("reports pet info when state file exists (DEC-020: no token cap display)", async () => {
    const { ulid } = await import("ulid");
    const config = buildConfig(tmpDir);
    const now = new Date().toISOString();
    const petId = ulid();

    const state = {
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      pets: [
        {
          id: petId,
          schemaVersion: 1,
          eggType: "rune",
          name: "Bramble",
          createdAt: now,
          hatchedAt: now,
          lastFedAt: null,
          lastInteractionAt: now,
          xp: 250,
          level: 3,
          personality: {
            dominant: "Philosophical",
            weights: {
              Stoic: 0.10,
              Friendly: 0.10,
              Pragmatic: 0.10,
              Energetic: 0.10,
              Gruff: 0.10,
              Philosophical: 0.30, // clear argmax
              Paranoid: 0.10,
              Curious: 0.10,
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
        },
      ],
      globals: {
        activePetId: petId,
        unlocks: {
          gifTier1: false,
          gifTier2: false,
          gifTier3: false,
          adoption: false,
        },
        eventsCursor: 0,
        eventsHead: "",
        lastEventAt: 0,
      },
    };

    await fs.promises.mkdir(tmpDir, { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(
      config.paths.stateFile,
      JSON.stringify(state, null, 2),
      { mode: 0o600 }
    );

    const capture = captureStdout();
    const code = await runDoctor(config);
    const output = capture.stop();

    expect(code).toBe(0);
    expect(output).toContain("Bramble");
    // DEC-020: daily cap display was removed; no "Token cap:" line
    expect(output).not.toContain("Token cap:");
    expect(output).toContain("250 XP");
  });

  it("reports last tokens.delta event when events log exists", async () => {
    const { ulid } = await import("ulid");
    const config = buildConfig(tmpDir);
    const now = new Date().toISOString();

    const event = {
      id: ulid(),
      type: "tokens.delta",
      ts: now,
      petId: null,
      source: "logtail",
      payload: { tokens: 5000 },
      xpDelta: 10,
      prevHash: "",
    };

    await fs.promises.mkdir(tmpDir, { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(
      config.paths.eventsLog,
      JSON.stringify(event) + "\n",
      { encoding: "utf8", mode: 0o600 }
    );

    const capture = captureStdout();
    await runDoctor(config);
    const output = capture.stop();

    expect(output).toContain("tokens.delta");
    expect(output).toContain("+10 XP");
  });

  it("reports last error from watch.log when present", async () => {
    const config = buildConfig(tmpDir);
    const logFile = path.join(tmpDir, "watch.log");

    await fs.promises.mkdir(tmpDir, { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(
      logFile,
      "[2026-04-24T10:00:00.000Z] [INFO] glyphling watch started\n" +
        "[2026-04-24T10:01:00.000Z] [ERROR] chokidar ENOENT something broke\n",
      { encoding: "utf8", mode: 0o600 }
    );

    const capture = captureStdout();
    await runDoctor(config);
    const output = capture.stop();

    expect(output).toContain("watch.log last error");
    expect(output).toContain("chokidar ENOENT");
  });
});
