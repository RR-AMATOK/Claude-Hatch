/**
 * Setup wizard — Module #29 (architecture §2.2)
 *
 * `glyphling setup` — interactive first-run wizard.
 *
 * TTY mode  : 4-prompt interactive flow (species → name → scope → confirm).
 * Non-TTY   : Flag-driven: --species, --name, --scope, --force, --non-interactive.
 *
 * Reuses hatchCommand from handlers.ts for pet creation; does NOT reinvent
 * the hatch logic. Calls patchSettings from settings-writer.ts for the
 * settings.json patch.
 *
 * DEC-008: The wizard writes pet state to config.stateHome (resolved by the
 * caller via resolveStateHome); settings.json is written to the resolved
 * scope path. Tests inject GLYPHLING_HOME pointing at os.tmpdir().
 *
 * DEC-017: Species are lowercase — circuit, rune, shard, bloom.
 * DEC-016: Canonical statusLine block uses `glyphling statusline` + refreshInterval:1.
 */

import readline from "node:readline/promises";
import os from "node:os";
import path from "node:path";
import type { Config } from "../config/env.js";
import type { EggType } from "../state/schema.js";
import { VALID_EGG_TYPES } from "../adoption/manager.js";
import { hatchCommand, type CommandResult } from "./handlers.js";
import {
  patchSettings,
  globalSettingsPath,
  projectSettingsPath,
} from "../config/settings-writer.js";
import {
  SILHOUETTES,
  detectColorMode,
  assembleCompactOutput,
  pickScene,
} from "../render/compact.js";
import { readState } from "../state/persistence.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InstallScope = "global" | "project" | "skip";

export interface SetupArgs {
  /** Parsed from --species <value> */
  species?: string;
  /** Parsed from --name <value> */
  name?: string;
  /** Parsed from --scope <value> */
  scope?: string;
  /** Parsed from --force (overwrite foreign statusLine) */
  force?: boolean;
  /** Parsed from --non-interactive (same as non-TTY mode) */
  nonInteractive?: boolean;
}

export interface SetupContext {
  config: Config;
  /**
   * Override for stdin TTY detection. When undefined, defaults to
   * `process.stdin.isTTY === true`. Pass `false` in tests to force
   * non-interactive mode without mucking with the process object.
   */
  isInteractive?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAME_MIN_LEN = 1;
const NAME_MAX_LEN = 16;

/** Printable ASCII range (0x20–0x7E). */
const PRINTABLE_RE = /^[\x20-\x7E]+$/;

// ---------------------------------------------------------------------------
// Species preview
// ---------------------------------------------------------------------------

/**
 * Render a 2-row silhouette preview string for a species at hatchling stage.
 * Uses narrow silhouette rows 0 and 1.
 */
function speciesPreview(species: EggType): string {
  const sil = SILHOUETTES[species]["hatchling"];
  return sil.narrow[0] + "\n" + sil.narrow[1];
}

/**
 * Build the species selection menu (numbered 1–4).
 * Honors NO_COLOR for the silhouette previews.
 */
function buildSpeciesMenu(): string {
  const lines: string[] = [
    "Choose a species (type 1–4 or the species name):\n",
  ];
  for (let i = 0; i < VALID_EGG_TYPES.length; i++) {
    const sp = VALID_EGG_TYPES[i] as EggType;
    const preview = speciesPreview(sp);
    // Indent preview rows by 4 spaces
    const indented = preview
      .split("\n")
      .map((r) => "    " + r)
      .join("\n");
    lines.push(`  [${i + 1}] ${sp}\n${indented}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * Parse a species answer: accepts "1"–"4" or the species name (case-insensitive).
 * Returns the canonical EggType or null on invalid input.
 */
function parseSpeciesAnswer(input: string): EggType | null {
  const trimmed = input.trim().toLowerCase();
  const idx = parseInt(trimmed, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= VALID_EGG_TYPES.length) {
    return VALID_EGG_TYPES[idx - 1] as EggType;
  }
  if ((VALID_EGG_TYPES as readonly string[]).includes(trimmed)) {
    return trimmed as EggType;
  }
  return null;
}

/**
 * Validate a pet name: 1–16 printable ASCII chars.
 * Returns an error string or null on success.
 */
function validateName(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length < NAME_MIN_LEN) {
    return `Name must be at least ${NAME_MIN_LEN} character.`;
  }
  if (trimmed.length > NAME_MAX_LEN) {
    return `Name must be at most ${NAME_MAX_LEN} characters (got ${trimmed.length}).`;
  }
  if (!PRINTABLE_RE.test(trimmed)) {
    return `Name must contain only printable ASCII characters.`;
  }
  return null;
}

/**
 * Parse an install scope answer: accepts "global", "project", "skip",
 * or the numbers "1", "2", "3".
 * Returns the canonical InstallScope or null on invalid input.
 */
function parseScope(input: string): InstallScope | null {
  const t = input.trim().toLowerCase();
  if (t === "1" || t === "global") return "global";
  if (t === "2" || t === "project") return "project";
  if (t === "3" || t === "skip") return "skip";
  return null;
}

// ---------------------------------------------------------------------------
// Settings patch helper
// ---------------------------------------------------------------------------

async function applySettingsPatch(
  scope: InstallScope,
  force: boolean
): Promise<{ ok: boolean; message: string }> {
  if (scope === "skip") {
    return { ok: true, message: "Skipping settings.json patch." };
  }

  const filePath =
    scope === "global" ? globalSettingsPath() : projectSettingsPath();

  const result = await patchSettings(filePath, {
    force,
    projectScope: scope === "project",
  });

  if (result.ok && result.alreadyInstalled) {
    return {
      ok: true,
      message: `settings.json already has the glyphling statusLine block (${filePath}) — no change needed.`,
    };
  }

  if (result.ok) {
    return {
      ok: true,
      message: `Installed statusLine block in ${filePath}.`,
    };
  }

  // Failure
  switch (result.reason) {
    case "would-overwrite-foreign-statusline":
      return {
        ok: false,
        message:
          `${result.message ?? ""}\n` +
          `Re-run with --force to overwrite the existing statusLine block.`,
      };
    default:
      return {
        ok: false,
        message: result.message ?? `Failed to patch settings.json (reason: ${result.reason ?? "unknown"}).`,
      };
  }
}

// ---------------------------------------------------------------------------
// Post-setup preview
// ---------------------------------------------------------------------------

/**
 * Read back the newly created pet from state and print a one-shot compact
 * preview to stdout. Gracefully skips on any error.
 */
async function printPreview(config: Config): Promise<void> {
  try {
    const state = await readState(config);
    if (state === null) return;
    const activePetId = state.globals.activePetId;
    const pet =
      activePetId !== null
        ? state.pets.find((p) => p.id === activePetId) ?? null
        : (state.pets[0] ?? null);
    if (pet === null) return;

    const env = process.env as Record<string, string | undefined>;
    const colorMode = detectColorMode(env);
    const richGlyphs = env["GLYPHLING_RICH_GLYPHS"] === "1";
    const tick = Math.floor(Date.now() / 1000);
    const sceneKey = pickScene(pet, Date.now());
    const output = assembleCompactOutput(
      pet,
      sceneKey,
      tick,
      colorMode,
      richGlyphs,
      state.pets.length,
      0
    );
    process.stdout.write("\nPet preview:\n" + output + "\n");
  } catch {
    // Non-fatal — preview is cosmetic
  }
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

/**
 * Orchestrates the setup wizard.
 *
 * @param args   Parsed flags (see SetupArgs).
 * @param ctx    Command context containing the resolved Config.
 * @returns      CommandResult — { ok, message } | { ok: false, error }
 */
export async function setupCommand(
  args: SetupArgs,
  ctx: SetupContext
): Promise<CommandResult> {
  const { config } = ctx;
  // Determine interactivity:
  //   - ctx.isInteractive overrides when explicitly set (useful for tests)
  //   - --non-interactive flag always forces non-interactive
  //   - otherwise fall back to process.stdin.isTTY
  const isInteractive =
    args.nonInteractive === true
      ? false
      : ctx.isInteractive !== undefined
      ? ctx.isInteractive
      : (process.stdin.isTTY === true);

  // -------------------------------------------------------------------------
  // Non-TTY / --non-interactive: require all flags
  // -------------------------------------------------------------------------
  if (!isInteractive) {
    return runNonInteractive(args, config);
  }

  // -------------------------------------------------------------------------
  // TTY mode: interactive 4-prompt flow
  // -------------------------------------------------------------------------
  return runInteractive(args, config);
}

// ---------------------------------------------------------------------------
// Non-interactive path
// ---------------------------------------------------------------------------

async function runNonInteractive(
  args: SetupArgs,
  config: Config
): Promise<CommandResult> {
  // Validate --species
  if (!args.species) {
    return {
      ok: false,
      error:
        "Non-interactive mode requires --species <circuit|rune|shard|bloom>.",
    };
  }
  const species = parseSpeciesAnswer(args.species);
  if (species === null) {
    return {
      ok: false,
      error: `Invalid --species "${args.species}". Must be one of: ${VALID_EGG_TYPES.join(", ")}.`,
    };
  }

  // Validate --name
  if (!args.name) {
    return { ok: false, error: "Non-interactive mode requires --name <name>." };
  }
  const nameErr = validateName(args.name);
  if (nameErr !== null) {
    return { ok: false, error: `Invalid --name: ${nameErr}` };
  }
  const name = args.name.trim();

  // Validate --scope
  if (!args.scope) {
    return {
      ok: false,
      error: "Non-interactive mode requires --scope <global|project|skip>.",
    };
  }
  const scope = parseScope(args.scope);
  if (scope === null) {
    return {
      ok: false,
      error: `Invalid --scope "${args.scope}". Must be one of: global, project, skip.`,
    };
  }

  const force = args.force === true;

  return runSetup({ species, name, scope, force, config, interactive: false });
}

// ---------------------------------------------------------------------------
// Interactive path
// ---------------------------------------------------------------------------

async function runInteractive(
  args: SetupArgs,
  config: Config
): Promise<CommandResult> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // ---- Prompt 1: Species -------------------------------------------------
    process.stdout.write(buildSpeciesMenu() + "\n");

    let species: EggType | null = null;
    while (species === null) {
      const answer = await rl.question("Species: ");
      species = parseSpeciesAnswer(answer);
      if (species === null) {
        process.stdout.write(
          `  Invalid choice. Enter 1–${VALID_EGG_TYPES.length} or a species name (${VALID_EGG_TYPES.join(", ")}).\n`
        );
      }
    }

    // ---- Prompt 2: Name ----------------------------------------------------
    process.stdout.write("\n");

    let name: string | null = null;
    while (name === null) {
      const answer = await rl.question("Pet name (1–16 characters): ");
      const err = validateName(answer);
      if (err !== null) {
        process.stdout.write(`  ${err}\n`);
      } else {
        name = answer.trim();
      }
    }

    // ---- Prompt 3: Scope ---------------------------------------------------
    const scopeMenu = [
      "\nInstall scope — where to write the statusLine block:",
      "  [1] global   — ~/.claude/settings.json  (affects all Claude Code workspaces)",
      "  [2] project  — .claude/settings.json    (this directory only)",
      "  [3] skip     — don't touch settings.json (you can add it manually later)",
      "",
    ].join("\n");
    process.stdout.write(scopeMenu);

    let scope: InstallScope | null = null;
    while (scope === null) {
      const answer = await rl.question("Scope: ");
      scope = parseScope(answer);
      if (scope === null) {
        process.stdout.write(
          `  Invalid choice. Enter 1 (global), 2 (project), or 3 (skip).\n`
        );
      }
    }

    // ---- Prompt 4: Confirm -------------------------------------------------
    const settingsTarget =
      scope === "global"
        ? globalSettingsPath()
        : scope === "project"
        ? projectSettingsPath()
        : "(none — skipping)";

    process.stdout.write(
      [
        "\nPlanned changes:",
        `  Species      : ${species}`,
        `  Name         : ${name}`,
        `  Settings file: ${settingsTarget}`,
        "",
      ].join("\n")
    );

    const confirm = await rl.question("Proceed? [y/N] ");
    if (confirm.trim().toLowerCase() !== "y") {
      process.stdout.write("Setup cancelled.\n");
      return { ok: true, message: "Setup cancelled by user." };
    }

    return runSetup({
      species,
      name,
      scope,
      force: args.force === true,
      config,
      interactive: true,
    });
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Core execution (shared between interactive + non-interactive)
// ---------------------------------------------------------------------------

interface SetupParams {
  species: EggType;
  name: string;
  scope: InstallScope;
  force: boolean;
  config: Config;
  interactive: boolean;
}

async function runSetup(params: SetupParams): Promise<CommandResult> {
  const { species, name, scope, force, config, interactive } = params;

  // ---- Step 1: Hatch the pet -----------------------------------------------
  const hatchResult = await hatchCommand([species, name], { config });

  if (!hatchResult.ok) {
    // hatchCommand returns "primary pet already exists" when one is present.
    // We surface this clearly and still check settings.json.
    const existingPet =
      hatchResult.error.includes("primary pet already exists") ||
      hatchResult.error.includes("already exists");

    if (existingPet) {
      const msg =
        "Primary pet already exists — skipping hatch.\n" +
        "Tip: Use `glyphling adopt` to add more pets.";
      if (interactive) {
        process.stdout.write("\n" + msg + "\n");
      }
      // Fall through to settings patch — wizard is re-run, still useful.
    } else {
      return { ok: false, error: `Hatch failed: ${hatchResult.error}` };
    }
  } else {
    const msg = hatchResult.message ?? `Hatched ${name} (${species}).`;
    if (interactive) {
      process.stdout.write("\n" + msg + "\n");
    }
  }

  // ---- Step 2: Patch settings.json ----------------------------------------
  const patchOutcome = await applySettingsPatch(scope, force);
  if (interactive) {
    process.stdout.write(patchOutcome.message + "\n");
  }

  if (!patchOutcome.ok) {
    return { ok: false, error: patchOutcome.message };
  }

  // ---- Step 3: Print preview -----------------------------------------------
  if (interactive) {
    await printPreview(config);
  }

  // ---- Step 4: Hints -------------------------------------------------------
  const hints: string[] = [];
  if (scope !== "skip") {
    hints.push(
      "Restart Claude Code for the statusLine change to take effect."
    );
  }
  hints.push(
    "XP starts accruing only when `glyphling watch &` is running (token watcher daemon)."
  );

  const hintText = hints.map((h) => `  Hint: ${h}`).join("\n");
  if (interactive) {
    process.stdout.write("\n" + hintText + "\n");
  }

  // Build combined success message for non-interactive callers
  const summary = [
    hatchResult.ok
      ? (hatchResult.message ?? `Hatched ${name} (${species}).`)
      : `Pet already existed — skipped hatch.`,
    patchOutcome.message,
    ...hints,
  ].join("\n");

  return { ok: true, message: summary };
}

// ---------------------------------------------------------------------------
// CLI flag parser (called from cli.tsx)
// ---------------------------------------------------------------------------

/**
 * Parse `glyphling setup [flags]` argv slice into SetupArgs.
 * Does NOT throw — returns whatever it can parse.
 */
export function parseSetupArgs(argv: string[]): SetupArgs {
  const result: SetupArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--species":
        result.species = argv[++i] ?? "";
        break;
      case "--name":
        result.name = argv[++i] ?? "";
        break;
      case "--scope":
        result.scope = argv[++i] ?? "";
        break;
      case "--force":
        result.force = true;
        break;
      case "--non-interactive":
        result.nonInteractive = true;
        break;
      default:
        // Ignore unknown flags
        break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Re-export for test convenience
// ---------------------------------------------------------------------------

export { globalSettingsPath, projectSettingsPath } from "../config/settings-writer.js";
export { VALID_EGG_TYPES } from "../adoption/manager.js";
