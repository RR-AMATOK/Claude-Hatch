/**
 * Integration tests for src/commands/setup.ts
 *
 * These tests run the full wizard against a tmp GLYPHLING_HOME (state) and
 * a tmp "home" directory for settings.json — never touching ~/.claude/ (DEC-008).
 *
 * Coverage:
 *   - Non-interactive mode: happy path (global scope)
 *   - Non-interactive mode: happy path (project scope)
 *   - Non-interactive mode: happy path (skip scope)
 *   - Non-interactive mode: missing required flags → error
 *   - Non-interactive mode: invalid species → error
 *   - Non-interactive mode: invalid name → error
 *   - Non-interactive mode: invalid scope → error
 *   - Non-interactive mode: re-run (primary pet already exists) → idempotent
 *   - Non-interactive mode: foreign statusLine → refused without --force
 *   - Non-interactive mode: foreign statusLine → overwritten with --force
 *   - --non-interactive flag: forces non-interactive regardless of ctx.isInteractive
 *   - parseSetupArgs: flag parsing
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { buildConfig } from "../config/env.js";
import { setupCommand, parseSetupArgs } from "./setup.js";
import type { SetupArgs } from "./setup.js";

// ---------------------------------------------------------------------------
// Import the settings-writer module for spying
// ---------------------------------------------------------------------------

import * as settingsWriter from "../config/settings-writer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpStateDir: string;
let tmpHomeDir: string;

/** Config pointing at a fresh tmp state directory. */
function makeTmpConfig() {
  return buildConfig(tmpStateDir);
}

/**
 * Returns the global settings path redirected to tmpHomeDir.
 * We spy on globalSettingsPath during tests so the wizard writes to tmpHomeDir
 * instead of the real ~/.claude/.
 */
function tmpGlobalSettingsPath(): string {
  return path.join(tmpHomeDir, ".claude", "settings.json");
}

/**
 * Returns the project settings path redirected to tmpHomeDir/project.
 */
function tmpProjectSettingsPath(): string {
  return path.join(tmpHomeDir, "project", ".claude", "settings.json");
}

beforeEach(async () => {
  tmpStateDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "glyphling-setup-state-")
  );
  tmpHomeDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "glyphling-setup-home-")
  );
  // Create project dir
  await fs.promises.mkdir(path.join(tmpHomeDir, "project"), { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of [tmpStateDir, tmpHomeDir]) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

// ---------------------------------------------------------------------------
// Non-interactive: happy path (global scope)
// ---------------------------------------------------------------------------

describe("setupCommand — non-interactive, global scope", () => {
  it("hatches a pet and writes global settings.json", async () => {
    vi.spyOn(settingsWriter, "globalSettingsPath").mockReturnValue(tmpGlobalSettingsPath());

    const config = makeTmpConfig();
    const args: SetupArgs = {
      species: "shard",
      name: "Bramble",
      scope: "global",
      force: false,
    };

    const result = await setupCommand(args, { config, isInteractive: false });
    expect(result.ok).toBe(true);

    // Pet state was created
    const rawState = await fs.promises.readFile(config.paths.stateFile, "utf8");
    const state = JSON.parse(rawState) as { pets: Array<{ name: string | null; eggType: string }> };
    expect(state.pets.length).toBe(1);
    expect(state.pets[0]!.eggType).toBe("shard");
    expect(state.pets[0]!.name).toBe("Bramble");

    // settings.json was created
    const settingsFile = tmpGlobalSettingsPath();
    const rawSettings = await fs.promises.readFile(settingsFile, "utf8");
    const settings = JSON.parse(rawSettings) as { statusLine: unknown };
    expect(settings.statusLine).toEqual({
      type: "command",
      command: "glyphling statusline",
      padding: 1,
      refreshInterval: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Non-interactive: project scope
// ---------------------------------------------------------------------------

describe("setupCommand — non-interactive, project scope", () => {
  it("hatches a pet and writes project settings.json", async () => {
    vi.spyOn(settingsWriter, "projectSettingsPath").mockReturnValue(tmpProjectSettingsPath());
    vi.spyOn(process, "cwd").mockReturnValue(path.join(tmpHomeDir, "project"));

    const config = makeTmpConfig();
    const args: SetupArgs = {
      species: "bloom",
      name: "Fern",
      scope: "project",
      force: false,
    };

    const result = await setupCommand(args, { config, isInteractive: false });
    expect(result.ok).toBe(true);

    const settingsFile = tmpProjectSettingsPath();
    const rawSettings = await fs.promises.readFile(settingsFile, "utf8");
    const settings = JSON.parse(rawSettings) as { statusLine: unknown };
    expect(settings.statusLine).toMatchObject({ command: "glyphling statusline" });
  });
});

// ---------------------------------------------------------------------------
// Non-interactive: skip scope
// ---------------------------------------------------------------------------

describe("setupCommand — non-interactive, skip scope", () => {
  it("hatches a pet but does not write any settings.json", async () => {
    const config = makeTmpConfig();
    const args: SetupArgs = {
      species: "circuit",
      name: "Zap",
      scope: "skip",
      force: false,
    };

    const result = await setupCommand(args, { config, isInteractive: false });
    expect(result.ok).toBe(true);

    // No global or project settings.json should have been written under tmpHomeDir
    await expect(
      fs.promises.access(path.join(tmpHomeDir, ".claude", "settings.json"))
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Non-interactive: missing required flags
// ---------------------------------------------------------------------------

describe("setupCommand — non-interactive, missing flags", () => {
  it("returns error when --species is missing", async () => {
    const config = makeTmpConfig();
    const result = await setupCommand(
      { name: "Zap", scope: "global" },
      { config, isInteractive: false }
    );
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toMatch(/--species/);
  });

  it("returns error when --name is missing", async () => {
    const config = makeTmpConfig();
    const result = await setupCommand(
      { species: "circuit", scope: "global" },
      { config, isInteractive: false }
    );
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toMatch(/--name/);
  });

  it("returns error when --scope is missing", async () => {
    const config = makeTmpConfig();
    const result = await setupCommand(
      { species: "circuit", name: "Zap" },
      { config, isInteractive: false }
    );
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toMatch(/--scope/);
  });
});

// ---------------------------------------------------------------------------
// Non-interactive: validation errors
// ---------------------------------------------------------------------------

describe("setupCommand — non-interactive, validation errors", () => {
  it("returns error for invalid --species", async () => {
    const config = makeTmpConfig();
    const result = await setupCommand(
      { species: "dragon", name: "Spike", scope: "global" },
      { config, isInteractive: false }
    );
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toMatch(/species/i);
  });

  it("returns error for empty --name", async () => {
    const config = makeTmpConfig();
    const result = await setupCommand(
      { species: "rune", name: "", scope: "global" },
      { config, isInteractive: false }
    );
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toMatch(/name/i);
  });

  it("returns error when --name is too long (>16 chars)", async () => {
    const config = makeTmpConfig();
    const result = await setupCommand(
      { species: "rune", name: "ThisNameIsWayTooLong", scope: "global" },
      { config, isInteractive: false }
    );
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toMatch(/name/i);
  });

  it("returns error for invalid --scope", async () => {
    const config = makeTmpConfig();
    const result = await setupCommand(
      { species: "rune", name: "Lyra", scope: "universe" },
      { config, isInteractive: false }
    );
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toMatch(/scope/i);
  });
});

// ---------------------------------------------------------------------------
// Idempotent: re-running when primary pet already exists
// ---------------------------------------------------------------------------

describe("setupCommand — idempotent re-run", () => {
  it("does not error when primary pet already exists; re-checks settings.json", async () => {
    vi.spyOn(settingsWriter, "globalSettingsPath").mockReturnValue(tmpGlobalSettingsPath());

    const config = makeTmpConfig();
    const args: SetupArgs = {
      species: "bloom",
      name: "Moss",
      scope: "global",
      force: false,
    };

    // First run
    const r1 = await setupCommand(args, { config, isInteractive: false });
    expect(r1.ok).toBe(true);

    // Second run — should succeed (pet already exists, settings already written)
    const r2 = await setupCommand(args, { config, isInteractive: false });
    expect(r2.ok).toBe(true);

    // Only one pet should exist
    const rawState = await fs.promises.readFile(config.paths.stateFile, "utf8");
    const state = JSON.parse(rawState) as { pets: unknown[] };
    expect(state.pets.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Foreign statusLine: refused without --force
// ---------------------------------------------------------------------------

describe("setupCommand — foreign statusLine", () => {
  it("returns error when foreign statusLine is present and force=false", async () => {
    vi.spyOn(settingsWriter, "globalSettingsPath").mockReturnValue(tmpGlobalSettingsPath());

    const settingsFile = tmpGlobalSettingsPath();
    await fs.promises.mkdir(path.dirname(settingsFile), { recursive: true });
    await fs.promises.writeFile(
      settingsFile,
      JSON.stringify({
        statusLine: { type: "command", command: "other-tool", refreshInterval: 5 },
      }, null, 2),
      "utf8"
    );

    const config = makeTmpConfig();
    const result = await setupCommand(
      { species: "shard", name: "Ice", scope: "global", force: false },
      { config, isInteractive: false }
    );
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toMatch(/foreign|overwrite/i);
  });

  it("succeeds when foreign statusLine is present and force=true", async () => {
    vi.spyOn(settingsWriter, "globalSettingsPath").mockReturnValue(tmpGlobalSettingsPath());

    const settingsFile = tmpGlobalSettingsPath();
    await fs.promises.mkdir(path.dirname(settingsFile), { recursive: true });
    await fs.promises.writeFile(
      settingsFile,
      JSON.stringify({
        statusLine: { type: "command", command: "other-tool", refreshInterval: 5 },
      }, null, 2),
      "utf8"
    );

    const config = makeTmpConfig();
    const result = await setupCommand(
      { species: "shard", name: "Ice", scope: "global", force: true },
      { config, isInteractive: false }
    );
    expect(result.ok).toBe(true);

    const rawSettings = await fs.promises.readFile(settingsFile, "utf8");
    const settings = JSON.parse(rawSettings) as { statusLine: unknown };
    expect(settings.statusLine).toMatchObject({ command: "glyphling statusline" });
  });
});

// ---------------------------------------------------------------------------
// --non-interactive flag forces non-interactive regardless of ctx.isInteractive
// ---------------------------------------------------------------------------

describe("setupCommand — --non-interactive flag", () => {
  it("runs without prompts when nonInteractive=true even if isInteractive=true in ctx", async () => {
    vi.spyOn(settingsWriter, "globalSettingsPath").mockReturnValue(tmpGlobalSettingsPath());

    const config = makeTmpConfig();
    const args: SetupArgs = {
      species: "circuit",
      name: "Byte",
      scope: "global",
      force: false,
      nonInteractive: true,
    };

    // isInteractive: true in context but nonInteractive flag should override
    const result = await setupCommand(args, { config, isInteractive: true });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseSetupArgs
// ---------------------------------------------------------------------------

describe("parseSetupArgs", () => {
  it("parses all flags", () => {
    const args = parseSetupArgs([
      "--species", "rune",
      "--name", "Lyra",
      "--scope", "global",
      "--force",
      "--non-interactive",
    ]);
    expect(args.species).toBe("rune");
    expect(args.name).toBe("Lyra");
    expect(args.scope).toBe("global");
    expect(args.force).toBe(true);
    expect(args.nonInteractive).toBe(true);
  });

  it("returns empty object when no flags given", () => {
    const args = parseSetupArgs([]);
    expect(args.species).toBeUndefined();
    expect(args.name).toBeUndefined();
    expect(args.scope).toBeUndefined();
    expect(args.force).toBeUndefined();
  });

  it("ignores unknown flags", () => {
    const args = parseSetupArgs(["--unknown", "value"]);
    expect(args.species).toBeUndefined();
  });

  it("accepts numeric species via flag (parse defers to setupCommand)", () => {
    const args = parseSetupArgs(["--species", "1"]);
    expect(args.species).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// All four species can be hatched successfully
// ---------------------------------------------------------------------------

describe("setupCommand — all species", () => {
  const SPECIES = ["circuit", "rune", "shard", "bloom"] as const;

  for (const species of SPECIES) {
    it(`hatches a ${species} pet without error`, async () => {
      vi.spyOn(settingsWriter, "globalSettingsPath").mockReturnValue(
        path.join(tmpHomeDir, `${species}.claude`, "settings.json")
      );
      const stateDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), `glyphling-sp-${species}-`)
      );
      const config = buildConfig(stateDir);

      try {
        const result = await setupCommand(
          { species, name: "TestPet", scope: "skip", force: false },
          { config, isInteractive: false }
        );
        expect(result.ok).toBe(true);

        const rawState = await fs.promises.readFile(config.paths.stateFile, "utf8");
        const state = JSON.parse(rawState) as { pets: Array<{ eggType: string }> };
        expect(state.pets[0]?.eggType).toBe(species);
      } finally {
        await fs.promises.rm(stateDir, { recursive: true, force: true });
      }
    });
  }
});
