/**
 * Unit tests for src/config/settings-writer.ts
 *
 * All filesystem operations use os.tmpdir() — never the project directory or ~/.claude/.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { patchSettings } from "./settings-writer.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "glyphling-sw-test-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const GLYPHLING_BLOCK = {
  type: "command",
  command: "glyphling statusline",
  padding: 1,
  refreshInterval: 1,
};

function settingsPath(): string {
  return path.join(tmpDir, "settings.json");
}

// ---------------------------------------------------------------------------
// Happy path: missing file → creates it
// ---------------------------------------------------------------------------

describe("patchSettings — missing file", () => {
  it("creates the file with the glyphling statusLine block when the file does not exist", async () => {
    const fp = settingsPath();
    const result = await patchSettings(fp, { force: false });

    expect(result.ok).toBe(true);
    expect(result.alreadyInstalled).toBeUndefined();

    const written = JSON.parse(await fs.promises.readFile(fp, "utf8")) as Record<string, unknown>;
    expect(written["statusLine"]).toEqual(GLYPHLING_BLOCK);
  });
});

// ---------------------------------------------------------------------------
// Happy path: existing file with other keys preserved
// ---------------------------------------------------------------------------

describe("patchSettings — preserves other keys", () => {
  it("preserves existing top-level keys when patching", async () => {
    const fp = settingsPath();
    const initial = {
      permissions: { allow: ["Bash"], deny: [] },
      theme: "dark",
    };
    await fs.promises.writeFile(fp, JSON.stringify(initial, null, 2), "utf8");

    const result = await patchSettings(fp, { force: false });
    expect(result.ok).toBe(true);

    const written = JSON.parse(await fs.promises.readFile(fp, "utf8")) as Record<string, unknown>;
    expect(written["permissions"]).toEqual(initial.permissions);
    expect(written["theme"]).toBe("dark");
    expect(written["statusLine"]).toEqual(GLYPHLING_BLOCK);
  });
});

// ---------------------------------------------------------------------------
// Idempotent: glyphling block already present → no-op
// ---------------------------------------------------------------------------

describe("patchSettings — idempotent", () => {
  it("returns alreadyInstalled=true when the exact glyphling block is already present", async () => {
    const fp = settingsPath();
    await fs.promises.writeFile(
      fp,
      JSON.stringify({ statusLine: GLYPHLING_BLOCK, theme: "dark" }, null, 2),
      "utf8"
    );

    // Capture mtime before
    const before = (await fs.promises.stat(fp)).mtimeMs;

    const result = await patchSettings(fp, { force: false });
    expect(result.ok).toBe(true);
    expect(result.alreadyInstalled).toBe(true);

    // File should NOT have been rewritten (mtime unchanged within test precision)
    const after = (await fs.promises.stat(fp)).mtimeMs;
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Foreign statusLine: refuses without --force
// ---------------------------------------------------------------------------

describe("patchSettings — foreign statusLine", () => {
  it("returns would-overwrite-foreign-statusline when statusLine is a different tool's block", async () => {
    const fp = settingsPath();
    const foreign = {
      statusLine: {
        type: "command",
        command: "some-other-tool statusline",
        refreshInterval: 5,
      },
    };
    await fs.promises.writeFile(fp, JSON.stringify(foreign, null, 2), "utf8");

    const result = await patchSettings(fp, { force: false });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("would-overwrite-foreign-statusline");

    // File should be unchanged
    const written = JSON.parse(await fs.promises.readFile(fp, "utf8")) as Record<string, unknown>;
    expect(written["statusLine"]).toEqual(foreign.statusLine);
  });

  it("overwrites foreign statusLine when force === true", async () => {
    const fp = settingsPath();
    const foreign = {
      statusLine: {
        type: "command",
        command: "some-other-tool statusline",
        refreshInterval: 5,
      },
    };
    await fs.promises.writeFile(fp, JSON.stringify(foreign, null, 2), "utf8");

    const result = await patchSettings(fp, { force: true });
    expect(result.ok).toBe(true);

    const written = JSON.parse(await fs.promises.readFile(fp, "utf8")) as Record<string, unknown>;
    expect(written["statusLine"]).toEqual(GLYPHLING_BLOCK);
  });
});

// ---------------------------------------------------------------------------
// Parse error: invalid JSON → refuses to write
// ---------------------------------------------------------------------------

describe("patchSettings — parse error", () => {
  it("returns parse-error when the file contains invalid JSON", async () => {
    const fp = settingsPath();
    await fs.promises.writeFile(fp, "{ this is not json", "utf8");

    const result = await patchSettings(fp, { force: false });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("parse-error");

    // File should remain unchanged (the corrupt data)
    const raw = await fs.promises.readFile(fp, "utf8");
    expect(raw).toBe("{ this is not json");
  });

  it("returns parse-error when the file contains a JSON array (not an object)", async () => {
    const fp = settingsPath();
    await fs.promises.writeFile(fp, "[]", "utf8");

    const result = await patchSettings(fp, { force: false });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("parse-error");
  });
});

// ---------------------------------------------------------------------------
// Symlink refusal (SEC-006)
// ---------------------------------------------------------------------------

describe("patchSettings — symlink refusal", () => {
  it("refuses to write if the target file is a symlink", async () => {
    const realFile = path.join(tmpDir, "real-settings.json");
    const linkPath = path.join(tmpDir, "settings-link.json");

    await fs.promises.writeFile(realFile, "{}", "utf8");
    await fs.promises.symlink(realFile, linkPath);

    const result = await patchSettings(linkPath, { force: false });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("symlink");

    // The real file should be unchanged
    const raw = await fs.promises.readFile(realFile, "utf8");
    expect(raw).toBe("{}");
  });
});

// ---------------------------------------------------------------------------
// Project-scope: cwd guards
// ---------------------------------------------------------------------------

describe("patchSettings — project-scope cwd guards", () => {
  it("returns cwd-is-home when cwd === os.homedir() and projectScope=true", async () => {
    const fp = settingsPath();
    // Spy on process.cwd()
    vi.spyOn(process, "cwd").mockReturnValue(os.homedir());

    const result = await patchSettings(fp, { force: false, projectScope: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("cwd-is-home");
  });

  it("returns cwd-is-root when cwd === '/' and projectScope=true", async () => {
    const fp = settingsPath();
    vi.spyOn(process, "cwd").mockReturnValue("/");

    const result = await patchSettings(fp, { force: false, projectScope: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("cwd-is-root");
  });

  it("succeeds when projectScope=true and cwd is a real project dir", async () => {
    const fp = settingsPath();
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    const result = await patchSettings(fp, { force: false, projectScope: true });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: write then read back produces stable JSON
// ---------------------------------------------------------------------------

describe("patchSettings — round-trip stability", () => {
  it("produces valid, readable JSON that can be parsed and re-patched idempotently", async () => {
    const fp = settingsPath();

    // First write
    const r1 = await patchSettings(fp, { force: false });
    expect(r1.ok).toBe(true);

    // Second call should be idempotent
    const r2 = await patchSettings(fp, { force: false });
    expect(r2.ok).toBe(true);
    expect(r2.alreadyInstalled).toBe(true);

    // Content is valid JSON with correct block
    const raw = await fs.promises.readFile(fp, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["statusLine"]).toEqual(GLYPHLING_BLOCK);
  });

  it("ends with a trailing newline for clean git diffs", async () => {
    const fp = settingsPath();
    await patchSettings(fp, { force: false });
    const raw = await fs.promises.readFile(fp, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Empty file is treated as {}
// ---------------------------------------------------------------------------

describe("patchSettings — empty file", () => {
  it("treats an empty file as an empty object and writes the block", async () => {
    const fp = settingsPath();
    await fs.promises.writeFile(fp, "", "utf8");

    const result = await patchSettings(fp, { force: false });
    expect(result.ok).toBe(true);

    const written = JSON.parse(await fs.promises.readFile(fp, "utf8")) as Record<string, unknown>;
    expect(written["statusLine"]).toEqual(GLYPHLING_BLOCK);
  });
});
