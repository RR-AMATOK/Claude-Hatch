/**
 * Unit tests for src/config/env.ts
 *
 * Tests the GLYPHLING_HOME resolver and the non-prod startup guard (DEC-008).
 * All tests use injected env + nodeEnv to avoid touching process.env.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, it, expect } from "vitest";
import { resolveStateHome, buildConfig, assertStateNotSymlinked } from "./env.js";

const home = os.homedir();
const claudeGlyphling = path.join(home, ".claude", "glyphling");

let tmpDirs: string[] = [];

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
// resolveStateHome — happy paths
// ---------------------------------------------------------------------------

describe("resolveStateHome — happy paths", () => {
  it("returns production default when NODE_ENV=production and no GLYPHLING_HOME", () => {
    const config = resolveStateHome({}, "production");
    expect(config.stateHome).toBe(path.resolve(claudeGlyphling));
  });

  it("respects an explicit GLYPHLING_HOME in production", () => {
    const config = resolveStateHome(
      { GLYPHLING_HOME: "/tmp/my-glyphling" },
      "production"
    );
    expect(config.stateHome).toBe("/tmp/my-glyphling");
  });

  it("respects an explicit GLYPHLING_HOME in development", () => {
    const config = resolveStateHome(
      { GLYPHLING_HOME: "/tmp/glyphling-dev" },
      "development"
    );
    expect(config.stateHome).toBe("/tmp/glyphling-dev");
  });

  it("resolves relative GLYPHLING_HOME to absolute path", () => {
    const config = resolveStateHome(
      { GLYPHLING_HOME: "./.dev-state/dev" },
      "development"
    );
    expect(path.isAbsolute(config.stateHome)).toBe(true);
    expect(config.stateHome).toContain(".dev-state");
    expect(config.stateHome).toContain("dev");
  });
});

// ---------------------------------------------------------------------------
// resolveStateHome — DEC-008 guard (non-prod + ~/.claude/ path)
// ---------------------------------------------------------------------------

describe("resolveStateHome — DEC-008 guard", () => {
  it("throws when NODE_ENV!=production and no GLYPHLING_HOME is set", () => {
    expect(() => resolveStateHome({}, "development")).toThrow(
      "GLYPHLING_HOME is not set"
    );
  });

  it("throws when NODE_ENV!=production and GLYPHLING_HOME points to ~/.claude/glyphling", () => {
    expect(() =>
      resolveStateHome(
        { GLYPHLING_HOME: claudeGlyphling },
        "development"
      )
    ).toThrow("inside ~/.claude/");
  });

  it("throws when NODE_ENV!=production and GLYPHLING_HOME points to ~/.claude/ root", () => {
    expect(() =>
      resolveStateHome(
        { GLYPHLING_HOME: path.join(home, ".claude") },
        "test"
      )
    ).toThrow("inside ~/.claude/");
  });

  it("throws when NODE_ENV!=production and GLYPHLING_HOME points to a subdirectory of ~/.claude/", () => {
    const subdir = path.join(home, ".claude", "some", "nested", "path");
    expect(() =>
      resolveStateHome({ GLYPHLING_HOME: subdir }, "development")
    ).toThrow("inside ~/.claude/");
  });

  it("does NOT throw for ~/.claude/glyphling in production mode", () => {
    expect(() =>
      resolveStateHome(
        { GLYPHLING_HOME: claudeGlyphling },
        "production"
      )
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildConfig — derived paths
// ---------------------------------------------------------------------------

describe("buildConfig — derived file paths", () => {
  it("derives all expected paths from stateHome", () => {
    const config = buildConfig("/tmp/test-home");
    expect(config.paths.stateFile).toBe("/tmp/test-home/state.json");
    expect(config.paths.lockFile).toBe("/tmp/test-home/state.json.lock");
    expect(config.paths.eventsLog).toBe("/tmp/test-home/events.jsonl");
    expect(config.paths.graveyardDir).toBe("/tmp/test-home/graveyard");
    expect(config.paths.ipcSocket).toBe("/tmp/test-home/ipc.sock");
  });
});

// ---------------------------------------------------------------------------
// SEC-006: Symlink refusal tests
// ---------------------------------------------------------------------------

describe("SEC-006: assertStateNotSymlinked", () => {
  it("does not throw when state files do not exist (first run)", async () => {
    const dir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "glyphling-env-test-")
    );
    tmpDirs.push(dir);
    const config = buildConfig(dir);
    // No files created — assertStateNotSymlinked should be silent
    expect(() => assertStateNotSymlinked(config)).not.toThrow();
  });

  it("throws when state.json is a symlink", async () => {
    const dir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "glyphling-env-test-")
    );
    tmpDirs.push(dir);
    const config = buildConfig(dir);
    await fs.promises.mkdir(dir, { recursive: true });

    // Create the actual target file, then symlink state.json → target
    const target = path.join(dir, "state.json.real");
    await fs.promises.writeFile(target, "{}", "utf8");
    await fs.promises.symlink(target, config.paths.stateFile);

    expect(() => assertStateNotSymlinked(config)).toThrow(/symbolic link/);
  });

  it("does not throw when state.json is a regular file", async () => {
    const dir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "glyphling-env-test-")
    );
    tmpDirs.push(dir);
    const config = buildConfig(dir);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(config.paths.stateFile, "{}", "utf8");

    expect(() => assertStateNotSymlinked(config)).not.toThrow();
  });
});
