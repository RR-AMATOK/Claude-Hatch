/**
 * CommandHandlers — Module #11 (architecture §2.2)
 *
 * Implementations for: feed, pet, play, pause, resume, adopt, name,
 * export, status, pets, quit, doctor.
 *
 * The `adopt` command is implemented (TODO-010). All others remain stubs.
 */

import type { ParsedCommand } from "./repl.js";
import type { Config } from "../config/env.js";
import type { EggType, Pet } from "../state/schema.js";
import { readState, appendEvent } from "../state/persistence.js";
import { canAdopt, adopt, VALID_EGG_TYPES } from "../adoption/manager.js";
import { exportGif } from "../export/gif.js";
import type { GifTier } from "../export/tiers.js";
import type { SceneId } from "../../animations/types.js";
import { ALL_SCENE_IDS } from "../../animations/types.js";
import { TIER_SPECS } from "../export/tiers.js";
import { levelFromCumXp } from "../xp/engine.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandContext {
  config: Config;
}

export type CommandResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Supported commands
// ---------------------------------------------------------------------------

export type CommandName =
  | "feed"
  | "pet"
  | "play"
  | "pause"
  | "resume"
  | "adopt"
  | "name"
  | "export"
  | "replay"
  | "status"
  | "pets"
  | "quit"
  | "doctor";

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Routes a parsed command to its handler. Returns a result object.
 */
export function dispatchCommand(
  cmd: ParsedCommand,
  _ctx: CommandContext
): CommandResult {
  const name = cmd.name as CommandName;

  switch (name) {
    case "feed":
    case "pet":
    case "play":
    case "pause":
    case "resume":
    case "name":
    case "status":
    case "pets":
    case "doctor":
      return { ok: false, error: `Command "${name}" not yet implemented.` };

    case "export":
      // Handled via exportCommand (async) — sync wrapper not suitable here.
      return {
        ok: false,
        error:
          "Use exportCommand(args, ctx) directly for the export command (it is async).",
      };

    case "replay":
      // Handled via replayCommand (async) — sync wrapper not suitable here.
      return {
        ok: false,
        error:
          "Use replayCommand(args, ctx) directly for the replay command (it is async).",
      };

    case "adopt":
      // Handled via adoptCommand (async) — sync wrapper not suitable here.
      // Callers that need async adopt should call adoptCommand directly.
      return {
        ok: false,
        error:
          "Use adoptCommand(args, ctx) directly for the adopt command (it is async).",
      };

    case "quit":
      process.exit(0);
      // unreachable, but satisfies return type
      return { ok: true };

    default: {
      const _exhaustive: never = name;
      void _exhaustive;
      return { ok: false, error: `Unknown command: "${cmd.name}"` };
    }
  }
}

// ---------------------------------------------------------------------------
// adopt command — async handler
// ---------------------------------------------------------------------------

// appendEventLogOnly removed — handlers now use appendEvent() from persistence.ts
// directly so that DEC-018 prevHash chaining and integrity fields are maintained.

/**
 * Implements `adopt <eggType>`.
 *
 * Flow:
 *   1. Validate eggType argument.
 *   2. Read current state (lock-free read, DEC-010).
 *   3. canAdopt() gate check — reject with reason on failure.
 *   4. adopt() pure function → {state, events, pet}.
 *   5. Append events to events.jsonl (durable; DEC-010 source of truth).
 *   6. writeState() atomically writes new state (acquires lock internally).
 *   7. Print confirmation.
 *
 * NOTE: We do NOT wrap this in a manual withLock() because writeState() already
 * acquires the lock internally. A nested lock on the same file would deadlock
 * with proper-lockfile. The events are appended before the state write so that
 * crash recovery via events.jsonl replay works even if the rename is interrupted.
 */
export async function adoptCommand(
  args: string[],
  ctx: CommandContext
): Promise<CommandResult> {
  const eggType = args[0]?.toLowerCase();

  // Validate positional arg
  if (!eggType) {
    return {
      ok: false,
      error: `adopt requires an egg type: ${VALID_EGG_TYPES.join(" | ")}`,
    };
  }

  if (!(VALID_EGG_TYPES as readonly string[]).includes(eggType)) {
    return {
      ok: false,
      error: `unknown egg type "${eggType}". Valid types: ${VALID_EGG_TYPES.join(", ")}`,
    };
  }

  const { config } = ctx;

  // Read current state (lock-free read per DEC-010)
  const stateBefore = await readState(config);
  if (stateBefore === null) {
    return {
      ok: false,
      error: "no state found — run glyphling first to initialise a pet",
    };
  }

  // Gate check (pre-flight)
  const gateResult = canAdopt(stateBefore);
  if (!gateResult.ok) {
    process.stderr.write(`[glyphling] adopt denied: ${gateResult.reason}\n`);
    return { ok: false, error: gateResult.reason };
  }

  // Compute adoption result (pure — no I/O)
  const result = adopt(gateResult.stateWithUnlock, {
    eggType: eggType as EggType,
  });

  // Durably append events to events.jsonl via appendEvent() (DEC-010 + DEC-018).
  // appendEvent() handles prevHash chaining, clock guards, and eventsHead update.
  // The final event in the list also carries a fold that writes the new state.
  try {
    const lastIdx = result.events.length - 1;
    for (let i = 0; i < result.events.length; i++) {
      const event = result.events[i]!;
      if (i === lastIdx) {
        // Last event: fold in the new state so writeState is only called once.
        await appendEvent(config, event, () => result.state);
      } else {
        // Earlier events: append to log + update integrity fields, no fold.
        await appendEvent(config, event);
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: `adopt failed (event log): ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Determine switch hint
  const petCountBefore = gateResult.stateWithUnlock.pets.length;
  const activePetId = gateResult.stateWithUnlock.globals.activePetId;
  // Only auto-activate if this is the second ever pet (first adoption, was only primary before)
  const shouldActivate = petCountBefore === 1 && activePetId !== null;
  const hint = shouldActivate
    ? ""
    : `\nuse 'switch ${result.pet.id}' to activate it`;

  const displayName = result.pet.name ?? result.pet.id;
  return {
    ok: true,
    message:
      `adopted ${displayName} (egg: ${result.pet.eggType}, personality: ${result.pet.personality.dominant})` +
      hint,
  };
}

// ---------------------------------------------------------------------------
// export tier helpers (DEC-019 D2)
// ---------------------------------------------------------------------------

/**
 * Auto-select the highest GIF tier the pet currently qualifies for (DEC-019 D2).
 *
 * Tier selection:
 *   L >= 1024 → Tier 3
 *   L >= 250  → Tier 2
 *   L >= 25   → Tier 1
 *   L < 25    → null (ineligible)
 *
 * Returns the tier number, or null if the pet does not qualify for any tier.
 */
export function autoPickTier(pet: Pet): GifTier | null {
  const level = levelFromCumXp(pet.xp);
  if (level >= 1024) return 3;
  if (level >= 250) return 2;
  if (level >= 25) return 1;
  return null;
}

// ---------------------------------------------------------------------------
// export command — async handler
// ---------------------------------------------------------------------------

/**
 * Implements `export [tier] [sceneId]` — e.g. `/export 1` or `/export 2 idle-chipper`.
 *
 * Usage:
 *   export 1                — Tier 1 Snapshot (default scene)
 *   export 2 idle-chipper   — Tier 2 Portrait of the chipper idle scene
 *   export 3                — Tier 3 Showcase (default scene, requires L1024)
 *
 * The GLYPHLING_HOME env var is forwarded to the capture subprocess via the
 * tape's env-prefix so it uses the same state directory as the parent process.
 */
export async function exportCommand(
  args: string[],
  ctx: CommandContext
): Promise<CommandResult> {
  const { config } = ctx;

  // Validate the explicit tier arg early (before the state read) if provided.
  // If the arg is absent, we auto-pick after reading state (DEC-019 D2).
  const tierRaw = args[0];
  let explicitTier: GifTier | undefined;

  if (tierRaw !== undefined) {
    const tierNum = parseInt(tierRaw, 10);
    if (isNaN(tierNum) || tierNum < 1 || tierNum > 3) {
      return { ok: false, error: `invalid tier "${tierRaw}" — must be 1, 2, or 3` };
    }
    explicitTier = tierNum as GifTier;
  }

  // Parse optional scene argument (position depends on whether tier was provided)
  const sceneArgIdx = explicitTier !== undefined ? 1 : 0;
  // If no tier arg, there's no scene arg either (the grammar is `export [tier] [scene]`)
  let sceneId: SceneId | undefined;
  if (explicitTier !== undefined) {
    const sceneArg = args[sceneArgIdx];
    if (sceneArg !== undefined) {
      if (!(ALL_SCENE_IDS as readonly string[]).includes(sceneArg)) {
        return {
          ok: false,
          error: `unknown scene "${sceneArg}". Run \`glyphling status\` to see available scenes.`,
        };
      }
      sceneId = sceneArg as SceneId;
    }
  }

  // Read current state (lock-free read per DEC-010)
  const state = await readState(config);
  if (state === null) {
    return {
      ok: false,
      error: "no state found — run glyphling first to initialise a pet",
    };
  }

  const activePetId = state.globals.activePetId;
  if (activePetId === null) {
    return { ok: false, error: "no active pet — adopt a pet first" };
  }

  const pet = state.pets.find((p) => p.id === activePetId);
  if (pet === undefined) {
    return { ok: false, error: `active pet "${activePetId}" not found in state` };
  }

  if (pet.diedAt !== null) {
    return {
      ok: false,
      error: "the active pet has died and cannot export GIFs. Adopt a new pet to continue.",
    };
  }

  // Resolve the tier: explicit arg wins; otherwise auto-pick (DEC-019 D2).
  let tier: GifTier;
  if (explicitTier !== undefined) {
    tier = explicitTier;
  } else {
    const picked = autoPickTier(pet);
    if (picked === null) {
      return {
        ok: false,
        error: `can't export pet at current level (need L25+ for Tier 1)`,
      };
    }
    tier = picked;
    const level = levelFromCumXp(pet.xp);
    process.stderr.write(
      `[glyphling] auto-selected Tier ${tier} (level ${level})\n`
    );
  }

  // Forward GLYPHLING_HOME into the capture subprocess so vhs tapes it
  // against the same state directory as this parent process.
  const envVars: Record<string, string> = {};
  if (config.stateHome) {
    envVars["GLYPHLING_HOME"] = config.stateHome;
  }

  // Determine glyphlingBin: prefer tsx for dev, compiled binary for prod.
  const glyphlingBin = process.env["GLYPHLING_BIN"] ?? "glyphling";

  process.stderr.write(
    `[glyphling] starting Tier ${tier} export for "${pet.name ?? pet.id}"...\n`
  );

  const result = await exportGif({
    tier,
    pet,
    ...(sceneId !== undefined ? { sceneId } : {}),
    envVars,
    glyphlingBin,
  });

  if (!result.ok) {
    if (result.code === "VHS_NOT_INSTALLED") {
      return {
        ok: false,
        error: `${result.message}\nInstall via: brew install vhs`,
      };
    }
    return { ok: false, error: result.message };
  }

  const spec = TIER_SPECS[tier];
  return {
    ok: true,
    message: [
      `GIF exported!`,
      `  Tier    : ${tier} (${spec.width}×${spec.height}, ${spec.fps}fps)`,
      `  Scene   : ${result.sceneId}`,
      `  Duration: ${result.durationSecs}s`,
      `  Output  : ${result.outputPath}`,
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// replay command — async handler (DEC-019 D8)
// ---------------------------------------------------------------------------

/**
 * Supported replay targets.
 * Only "evolve" is implemented for v0.1.0. Other subcommands error with a
 * structured "unknown replay target" message.
 */
const REPLAY_TARGETS = ["evolve"] as const;
type ReplayTarget = (typeof REPLAY_TARGETS)[number];

/**
 * Implements `replay <target>` — e.g. `replay evolve`.
 *
 * For now only "evolve" is supported: re-plays the `evolve-shimmer` scene for
 * the active pet regardless of its current life stage. The scene is triggered
 * by emitting a `level.up` event with `payload.replay = true` via the event
 * bus hook; since the render layer is not yet fully wired in the REPL path,
 * this returns `{ ok: true }` and the scene name for the caller to act on.
 *
 * Constraint (DEC-019 D8): must work for pets at any life stage — the scene
 * plays on-demand, not just at evolution time.
 */
export async function replayCommand(
  args: string[],
  ctx: CommandContext
): Promise<CommandResult & { sceneId?: string }> {
  const { config } = ctx;

  const target = args[0];
  if (target === undefined || target === "") {
    return {
      ok: false,
      error: `replay requires a target. Supported targets: ${REPLAY_TARGETS.join(", ")}`,
    };
  }

  if (!(REPLAY_TARGETS as readonly string[]).includes(target)) {
    return {
      ok: false,
      error: `unknown replay target "${target}"`,
    };
  }

  // target is now narrowed to ReplayTarget
  const replayTarget = target as ReplayTarget;

  // Read current state (lock-free read per DEC-010)
  const state = await readState(config);
  if (state === null) {
    return {
      ok: false,
      error: "no state found — run glyphling first to initialise a pet",
    };
  }

  const activePetId = state.globals.activePetId;
  if (activePetId === null) {
    return { ok: false, error: "no active pet — adopt a pet first" };
  }

  const pet = state.pets.find((p) => p.id === activePetId);
  if (pet === undefined) {
    return { ok: false, error: `active pet "${activePetId}" not found in state` };
  }

  if (pet.diedAt !== null) {
    return { ok: false, error: "the active pet has died and cannot replay scenes." };
  }

  // Dispatch the replay scene. The pattern follows how eat-small is triggered on
  // a feed event: the render layer listens for a well-known event type and uses
  // it to override the current scene for one cycle.
  // Since the REPL + event bus wiring is a Phase 1d task and the render layer
  // is Ink-resident, we return the sceneId in the result so the caller can act.
  const sceneId =
    replayTarget === "evolve" ? "evolve-shimmer" : "idle-baseline";

  return {
    ok: true,
    message: `replaying "${sceneId}" scene for ${pet.name ?? pet.id}`,
    sceneId,
  };
}

