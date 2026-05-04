/**
 * CommandHandlers — Module #11 (architecture §2.2)
 *
 * Implementations for: feed, pet, play, pause, resume, adopt, name,
 * export, status, pets, quit, doctor.
 *
 * The `adopt` command is implemented (TODO-010). All mutation commands
 * (feed, pet, play, pause, resume, name) are implemented in TODO-022.
 * Read-only commands (status, pets) are also implemented in TODO-022.
 * The doctor command is delegated to src/commands/doctor.ts.
 */

import { ulid } from "ulid";
import type { ParsedCommand } from "./repl.js";
import type { Config } from "../config/env.js";
import type { EggType, GlyphlingEvent, Pet, StateFileV1 } from "../state/schema.js";
import { readState, appendEvent } from "../state/persistence.js";
import { canAdopt, adopt, VALID_EGG_TYPES } from "../adoption/manager.js";
import { exportGif } from "../export/gif.js";
import type { GifTier } from "../export/tiers.js";
import type { SceneId } from "../../animations/types.js";
import { ALL_SCENE_IDS } from "../../animations/types.js";
import { TIER_SPECS } from "../export/tiers.js";
import { levelFromCumXp, makeXpFold, XP_PER_INTERACTION } from "../xp/engine.js";
import { safeForLog } from "../util/lang.js";
import { deriveMood, MOOD_GLYPHS } from "../render/compact.js";

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
 *
 * Note: async command handlers (feed, pet, play, pause, resume, name, status,
 * pets) are not callable through this sync dispatch — use them directly.
 * This function handles only synchronous commands and provides typed error
 * messages for callers that try to dispatch async commands.
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
      return {
        ok: false,
        error: `Use ${name}Command(args, ctx) directly — it is async.`,
      };

    case "doctor":
      return {
        ok: false,
        error: "Use runDoctor(config) from src/commands/doctor.ts directly.",
      };

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
// hatch command — async handler (first-run primary-pet bootstrap)
// ---------------------------------------------------------------------------

const NAME_MAX_LEN = 32;

/**
 * Implements `glyphling hatch <eggType> [name]` — primary-pet bootstrap.
 *
 * This is the first-run path that creates state.json + the primary pet.
 * It bypasses canAdopt() (which gates *secondary* adoptions on L73 + 7d) and
 * is only valid when state has zero pets. Subsequent pets must go through
 * the gated `adopt` flow.
 *
 * The created pet is set as activePetId so the statusline picks it up
 * immediately on the next render.
 */
export async function hatchCommand(
  args: string[],
  ctx: CommandContext
): Promise<CommandResult> {
  const { config } = ctx;

  // Pull out --xp <n> flag (may appear anywhere); collect remaining as positional.
  let initialXp: number | null = null;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--xp") {
      const next = args[i + 1];
      if (next === undefined) {
        return { ok: false, error: "--xp requires a number" };
      }
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return { ok: false, error: `--xp must be a non-negative integer, got: ${next}` };
      }
      initialXp = parsed;
      i++; // consume the value
    } else if (arg.startsWith("--xp=")) {
      const valueStr = arg.slice("--xp=".length);
      const parsed = Number(valueStr);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return { ok: false, error: `--xp must be a non-negative integer, got: ${valueStr}` };
      }
      initialXp = parsed;
    } else {
      positional.push(arg);
    }
  }

  const eggType = positional[0]?.toLowerCase();
  const rawName = positional.slice(1).join(" ").trim();

  if (!eggType) {
    return {
      ok: false,
      error: `hatch requires an egg type: ${VALID_EGG_TYPES.join(" | ")}`,
    };
  }

  if (!(VALID_EGG_TYPES as readonly string[]).includes(eggType)) {
    return {
      ok: false,
      error: `unknown egg type "${eggType}". Valid types: ${VALID_EGG_TYPES.join(", ")}`,
    };
  }

  let name: string | null = null;
  if (rawName.length > 0) {
    if (rawName.length > NAME_MAX_LEN) {
      return {
        ok: false,
        error: `name too long (${rawName.length} chars); max ${NAME_MAX_LEN}`,
      };
    }
    name = rawName;
  }

  const stateBefore = await readState(config);

  if (stateBefore !== null && stateBefore.pets.length > 0) {
    return {
      ok: false,
      error: "primary pet already exists. Use 'adopt' for additional pets.",
    };
  }

  const baseState = stateBefore ?? {
    schemaVersion: 1 as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pets: [],
    globals: {
      activePetId: null,
      unlocks: { gifTier1: false, gifTier2: false, gifTier3: false, adoption: false },
      eventsCursor: 0,
      eventsHead: "",
      lastEventAt: 0,
    },
  };

  const result = adopt(baseState, { eggType: eggType as EggType });

  // Apply name, optional --xp override (and derived level), and set as active pet.
  const overrideLevel =
    initialXp !== null ? levelFromCumXp(initialXp) : null;
  const namedPets = result.state.pets.map((p) =>
    p.id === result.pet.id
      ? {
          ...p,
          name,
          ...(initialXp !== null ? { xp: initialXp } : {}),
          ...(overrideLevel !== null ? { level: overrideLevel } : {}),
        }
      : p
  );
  const finalState = {
    ...result.state,
    pets: namedPets,
    globals: { ...result.state.globals, activePetId: result.pet.id },
  };

  try {
    const lastIdx = result.events.length - 1;
    for (let i = 0; i < result.events.length; i++) {
      const event = result.events[i]!;
      if (i === lastIdx) {
        await appendEvent(config, event, () => finalState);
      } else {
        await appendEvent(config, event);
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: `hatch failed (event log): ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const displayName = name ?? result.pet.id;
  const xpSuffix =
    initialXp !== null && overrideLevel !== null
      ? `, xp: ${initialXp}, level: ${overrideLevel}`
      : "";
  return {
    ok: true,
    message: `hatched ${displayName} (egg: ${eggType}, personality: ${result.pet.personality.dominant}${xpSuffix}). Reload Claude Code to see the pet in your statusline.`,
  };
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
    // SEC-008: reason comes from internal logic (not user input), but log safely anyway
    process.stderr.write(`[glyphling] adopt denied: ${safeForLog(gateResult.reason)}\n`);
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
 *   L >= 1618 → Tier 3 (DEC-020 Golden Level)
 *   L >= 250  → Tier 2
 *   L >= 25   → Tier 1
 *   L < 25    → null (ineligible)
 *
 * Returns the tier number, or null if the pet does not qualify for any tier.
 */
export function autoPickTier(pet: Pet): GifTier | null {
  const level = levelFromCumXp(pet.xp);
  if (level >= 1618) return 3;
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
 *   export 3                — Tier 3 Showcase (default scene, requires L1618)
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


  // SEC-007: Validate GLYPHLING_BIN against a safe allowlist of characters.
  // An attacker-controlled GLYPHLING_BIN could inject shell commands into the
  // tape's Type directive. We allow only path-safe chars and reject anything else.
  const rawBin = process.env["GLYPHLING_BIN"];
  const SAFE_BIN_RE = /^[a-zA-Z0-9._/\\-]+$/;
  let glyphlingBin: string;
  if (rawBin === undefined || rawBin === "") {
    glyphlingBin = "glyphling";
  } else if (SAFE_BIN_RE.test(rawBin)) {
    glyphlingBin = rawBin;
  } else {
    return {
      ok: false,
      error: `GLYPHLING_BIN contains unsafe characters: ${JSON.stringify(rawBin)}`,
    };
  }

  // SEC-008: pet.name is user-supplied; use safeForLog to prevent control-char injection
  process.stderr.write(
    `[glyphling] starting Tier ${tier} export for ${safeForLog(pet.name ?? pet.id)}...\n`
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

// ---------------------------------------------------------------------------
// Shared helpers for interaction commands
// ---------------------------------------------------------------------------

/**
 * Derive a compact HUD suffix: "Lv <N> · <mood> · <age>d"
 * Used by feed, play, pet commands for chat-friendly output.
 */
function hudSuffix(pet: Pet, nowMs: number): string {
  const level = pet.level;
  const mood = deriveMood(pet, nowMs);
  const moodGlyph = MOOD_GLYPHS[mood].ascii;
  const ageMs = nowMs - new Date(pet.lastInteractionAt).getTime();
  const ageDays = Math.floor(ageMs / (86400 * 1000));
  return `Lv ${level} · ${moodGlyph} · ${ageDays}d`;
}

/**
 * Resolve the active pet from state, or return an error result.
 */
function resolveActivePet(
  state: StateFileV1 | null
):
  | { ok: true; pet: Pet; state: StateFileV1 }
  | { ok: false; error: string } {
  if (state === null) {
    return {
      ok: false,
      error: "no state found — run glyphling hatch first to create a pet",
    };
  }
  const activePetId = state.globals.activePetId;
  if (activePetId === null) {
    return { ok: false, error: "no active pet — hatch a pet first" };
  }
  const pet = state.pets.find((p) => p.id === activePetId);
  if (pet === undefined) {
    return {
      ok: false,
      error: `active pet "${activePetId}" not found in state`,
    };
  }
  return { ok: true, pet, state };
}

// ---------------------------------------------------------------------------
// Shared interaction fold
// ---------------------------------------------------------------------------

/**
 * Returns a fold function for user-initiated interactions (feed, play).
 *
 * Composes `makeXpFold()` (which handles XP gain, level recompute, lastFedAt
 * / lastPlayedAt timestamps, level.up + unlock side-effects) with the
 * interaction-only state updates: bump lastInteractionAt and reset the
 * accumulated-neglect counter (DEC-009).
 *
 * Using `makeXpFold()` here was a real bug fix: the original per-handler
 * inline folds skipped the level.up emission and unlock-flag propagation,
 * so feeding past a level boundary never triggered the level-up scene or
 * unlocked GIF tiers.
 */
function makeInteractionFold(): (state: StateFileV1, event: GlyphlingEvent) => StateFileV1 {
  const xpFold = makeXpFold();
  return (state: StateFileV1, event: GlyphlingEvent): StateFileV1 => {
    // The engine's GlyphlingEvent (events/bus.ts hand-written interface) and
    // persistence's GlyphlingEvent (state/schema.ts Zod-inferred) describe the
    // same runtime shape but differ in strict-optional typing on xpDelta /
    // prevHash. Bridge at the boundary; structurally identical.
    const next = xpFold(state, event as Parameters<typeof xpFold>[1]);
    if (event.petId === null) return next;
    const idx = next.pets.findIndex((p) => p.id === event.petId);
    if (idx === -1) return next;
    const pet = next.pets[idx]!;
    const updatedPet: Pet = {
      ...pet,
      lastInteractionAt: event.ts,
      accumulatedNeglectSeconds: 0,
    };
    const pets = [...next.pets];
    pets[idx] = updatedPet;
    return { ...next, pets, updatedAt: event.ts };
  };
}

// ---------------------------------------------------------------------------
// feed command — async handler
// ---------------------------------------------------------------------------

/**
 * Implements `glyphling feed [note]`.
 *
 * Emits a `pet.fed` event via appendEvent. The XP engine folds it into
 * lastFedAt + XP gain (and emits level.up + unlock side-effects when
 * crossing thresholds); the interaction-fold layer adds lastInteractionAt
 * and resets accumulatedNeglectSeconds.
 */
export async function feedCommand(
  _args: string[],
  ctx: CommandContext
): Promise<CommandResult> {
  const { config } = ctx;
  const state = await readState(config);
  const resolved = resolveActivePet(state);
  if (!resolved.ok) return resolved;
  const { pet } = resolved;

  if (pet.diedAt !== null) {
    return { ok: false, error: "your pet has died and cannot be fed." };
  }

  const now = new Date().toISOString();
  const nowMs = Date.now();

  const event: GlyphlingEvent = {
    id: ulid(),
    type: "pet.fed",
    ts: now,
    petId: pet.id,
    source: "cli.feed",
    payload: {},
    xpDelta: XP_PER_INTERACTION,
    // prevHash is set by appendEvent (DEC-018 Mechanism 1); empty here.
    prevHash: "",
  };

  try {
    await appendEvent(config, event, makeInteractionFold());
  } catch (err) {
    return {
      ok: false,
      error: `feed failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const displayName = pet.name ?? pet.id;
  const suffix = hudSuffix({ ...pet, lastFedAt: now, lastInteractionAt: now, accumulatedNeglectSeconds: 0 }, nowMs);
  return {
    ok: true,
    message: `Glyphling fed ${displayName}. ${suffix}`,
  };
}

// ---------------------------------------------------------------------------
// play command — async handler
// ---------------------------------------------------------------------------

/**
 * Implements `glyphling play [note]`.
 *
 * Emits a `pet.played` event via appendEvent. Same delegation pattern as
 * feedCommand — the XP engine handles the canonical fold; the interaction
 * layer adds lastInteractionAt + neglect reset.
 */
export async function playCommand(
  _args: string[],
  ctx: CommandContext
): Promise<CommandResult> {
  const { config } = ctx;
  const state = await readState(config);
  const resolved = resolveActivePet(state);
  if (!resolved.ok) return resolved;
  const { pet } = resolved;

  if (pet.diedAt !== null) {
    return { ok: false, error: "your pet has died and cannot play." };
  }

  const now = new Date().toISOString();
  const nowMs = Date.now();

  const event: GlyphlingEvent = {
    id: ulid(),
    type: "pet.played",
    ts: now,
    petId: pet.id,
    source: "cli.play",
    payload: {},
    xpDelta: XP_PER_INTERACTION,
    prevHash: "",
  };

  try {
    await appendEvent(config, event, makeInteractionFold());
  } catch (err) {
    return {
      ok: false,
      error: `play failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const displayName = pet.name ?? pet.id;
  const suffix = hudSuffix({ ...pet, lastPlayedAt: now, lastInteractionAt: now, accumulatedNeglectSeconds: 0 }, nowMs);
  return {
    ok: true,
    message: `${displayName} played a round. ${suffix}`,
  };
}

// ---------------------------------------------------------------------------
// pet command — async handler (scritching/petting)
// ---------------------------------------------------------------------------

/**
 * Implements `glyphling pet [note]`.
 *
 * Emits a `pet.petted` event (scritch/petting interaction) with no XP.
 * Stamps `lastPettedAt` so pickScene() can trigger the petted scene window.
 * Resets neglect counter and updates lastInteractionAt.
 */
export async function petCommand(
  _args: string[],
  ctx: CommandContext
): Promise<CommandResult> {
  const { config } = ctx;
  const state = await readState(config);
  const resolved = resolveActivePet(state);
  if (!resolved.ok) return resolved;
  const { pet } = resolved;

  if (pet.diedAt !== null) {
    return { ok: false, error: "your pet has died." };
  }

  const now = new Date().toISOString();

  // pet (scritch) is a no-XP interaction — stamps lastPettedAt and resets neglect.
  const event: GlyphlingEvent = {
    id: ulid(),
    type: "pet.petted",
    ts: now,
    petId: pet.id,
    source: "cli.pet",
    payload: {},
    prevHash: "",
  };

  const fold = (currentState: StateFileV1): StateFileV1 => {
    const idx = currentState.pets.findIndex((p) => p.id === pet.id);
    if (idx === -1) return currentState;
    const existing = currentState.pets[idx]!;
    const updatedPet: Pet = {
      ...existing,
      lastPettedAt: now,
      lastInteractionAt: now,
      accumulatedNeglectSeconds: 0,
    };
    const updatedPets = [...currentState.pets];
    updatedPets[idx] = updatedPet;
    return {
      ...currentState,
      pets: updatedPets,
      updatedAt: now,
    };
  };

  try {
    await appendEvent(config, event, fold);
  } catch (err) {
    return {
      ok: false,
      error: `pet failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const displayName = pet.name ?? pet.id;
  return {
    ok: true,
    message: `You scritched ${displayName}. ♥`,
  };
}

// ---------------------------------------------------------------------------
// pause command — async handler
// ---------------------------------------------------------------------------

/**
 * Implements `glyphling pause`.
 *
 * Opens a pause interval on the active pet (sets resumedAt = null).
 * Emits a `pet.paused` event via appendEvent.
 */
export async function pauseCommand(
  _args: string[],
  ctx: CommandContext
): Promise<CommandResult> {
  const { config } = ctx;
  const state = await readState(config);
  const resolved = resolveActivePet(state);
  if (!resolved.ok) return resolved;
  const { pet } = resolved;

  if (pet.diedAt !== null) {
    return { ok: false, error: "your pet has died and cannot be paused." };
  }

  // Check if already paused
  const lastPause = pet.pauseIntervals[pet.pauseIntervals.length - 1];
  if (lastPause !== undefined && lastPause.resumedAt === null) {
    return { ok: false, error: "pet is already paused." };
  }

  const now = new Date().toISOString();

  const event = {
    id: ulid(),
    type: "pet.paused" as const,
    ts: now,
    petId: pet.id,
    source: "cli.pause",
    payload: {},
    prevHash: "",
  };

  const fold = (currentState: StateFileV1): StateFileV1 => {
    const idx = currentState.pets.findIndex((p) => p.id === pet.id);
    if (idx === -1) return currentState;
    const existing = currentState.pets[idx]!;
    const updatedPet: Pet = {
      ...existing,
      pauseIntervals: [
        ...existing.pauseIntervals,
        { pausedAt: now, resumedAt: null },
      ],
      lastInteractionAt: now,
    };
    const updatedPets = [...currentState.pets];
    updatedPets[idx] = updatedPet;
    return {
      ...currentState,
      pets: updatedPets,
      updatedAt: now,
    };
  };

  try {
    await appendEvent(config, event, fold);
  } catch (err) {
    return {
      ok: false,
      error: `pause failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const displayName = pet.name ?? pet.id;
  return {
    ok: true,
    message: `${displayName} is now paused. Neglect clock frozen.`,
  };
}

// ---------------------------------------------------------------------------
// resume command — async handler
// ---------------------------------------------------------------------------

/**
 * Implements `glyphling resume`.
 *
 * Closes the open pause interval on the active pet (sets resumedAt = now).
 * Emits a `pet.resumed` event via appendEvent.
 */
export async function resumeCommand(
  _args: string[],
  ctx: CommandContext
): Promise<CommandResult> {
  const { config } = ctx;
  const state = await readState(config);
  const resolved = resolveActivePet(state);
  if (!resolved.ok) return resolved;
  const { pet } = resolved;

  if (pet.diedAt !== null) {
    return { ok: false, error: "your pet has died and cannot be resumed." };
  }

  // Check if currently paused
  const lastPauseIdx = pet.pauseIntervals.length - 1;
  const lastPause = pet.pauseIntervals[lastPauseIdx];
  if (lastPause === undefined || lastPause.resumedAt !== null) {
    return { ok: false, error: "pet is not currently paused." };
  }

  const now = new Date().toISOString();

  const event = {
    id: ulid(),
    type: "pet.resumed" as const,
    ts: now,
    petId: pet.id,
    source: "cli.resume",
    payload: {},
    prevHash: "",
  };

  const fold = (currentState: StateFileV1): StateFileV1 => {
    const idx = currentState.pets.findIndex((p) => p.id === pet.id);
    if (idx === -1) return currentState;
    const existing = currentState.pets[idx]!;
    const pIdx = existing.pauseIntervals.length - 1;
    if (pIdx < 0) return currentState;
    const updatedIntervals = existing.pauseIntervals.map((p, i) =>
      i === pIdx ? { ...p, resumedAt: now } : p
    );
    const updatedPet: Pet = {
      ...existing,
      pauseIntervals: updatedIntervals,
      lastInteractionAt: now,
    };
    const updatedPets = [...currentState.pets];
    updatedPets[idx] = updatedPet;
    return {
      ...currentState,
      pets: updatedPets,
      updatedAt: now,
    };
  };

  try {
    await appendEvent(config, event, fold);
  } catch (err) {
    return {
      ok: false,
      error: `resume failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const displayName = pet.name ?? pet.id;
  return {
    ok: true,
    message: `${displayName} is awake again. Neglect clock resumed.`,
  };
}

// ---------------------------------------------------------------------------
// name command — async handler
// ---------------------------------------------------------------------------

/**
 * Implements `glyphling name <new-name>`.
 *
 * Renames the active pet. Emits a `personality.refresh` event (used as a
 * generic metadata mutation signal) to record the rename in the event log.
 */
export async function nameCommand(
  args: string[],
  ctx: CommandContext
): Promise<CommandResult> {
  const rawName = args.join(" ").trim();

  if (rawName.length === 0) {
    return { ok: false, error: "name requires a new name: glyphling name <new-name>" };
  }
  if (rawName.length > NAME_MAX_LEN) {
    return {
      ok: false,
      error: `name too long (${rawName.length} chars); max ${NAME_MAX_LEN}`,
    };
  }

  const { config } = ctx;
  const state = await readState(config);
  const resolved = resolveActivePet(state);
  if (!resolved.ok) return resolved;
  const { pet } = resolved;

  const oldName = pet.name ?? pet.id;
  const now = new Date().toISOString();

  const event = {
    id: ulid(),
    type: "personality.refresh" as const,
    ts: now,
    petId: pet.id,
    source: "cli.name",
    payload: { rename: { from: oldName, to: rawName } },
    prevHash: "",
  };

  const fold = (currentState: StateFileV1): StateFileV1 => {
    const idx = currentState.pets.findIndex((p) => p.id === pet.id);
    if (idx === -1) return currentState;
    const existing = currentState.pets[idx]!;
    const updatedPet: Pet = {
      ...existing,
      name: rawName,
      lastInteractionAt: now,
    };
    const updatedPets = [...currentState.pets];
    updatedPets[idx] = updatedPet;
    return {
      ...currentState,
      pets: updatedPets,
      updatedAt: now,
    };
  };

  try {
    await appendEvent(config, event, fold);
  } catch (err) {
    return {
      ok: false,
      error: `name failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // SEC-008: safeForLog on user-supplied rawName before logging
  process.stderr.write(
    `[glyphling] renamed ${safeForLog(oldName)} -> ${safeForLog(rawName)}\n`
  );

  return {
    ok: true,
    message: `${oldName} is now ${rawName}.`,
  };
}

// ---------------------------------------------------------------------------
// status command — read-only
// ---------------------------------------------------------------------------

/**
 * Implements `glyphling status`.
 *
 * Read-only 3-line summary: name / level / XP / mood / age.
 * MUST NOT acquire the lockfile (DEC-010 read-only path).
 */
export async function statusCommand(
  _args: string[],
  ctx: CommandContext
): Promise<CommandResult> {
  const { config } = ctx;
  const state = await readState(config);
  const resolved = resolveActivePet(state);
  if (!resolved.ok) return resolved;
  const { pet } = resolved;

  const nowMs = Date.now();
  const mood = deriveMood(pet, nowMs);
  const moodGlyph = MOOD_GLYPHS[mood].ascii;

  // Compute unpaused age (DEC-011)
  const hatchedMs = pet.hatchedAt !== null
    ? new Date(pet.hatchedAt).getTime()
    : new Date(pet.createdAt).getTime();
  const pausedMs = pet.pauseIntervals.reduce((acc, interval) => {
    const start = new Date(interval.pausedAt).getTime();
    const end = interval.resumedAt !== null
      ? new Date(interval.resumedAt).getTime()
      : nowMs;
    return acc + (end - start);
  }, 0);
  const unpausedMs = nowMs - hatchedMs - pausedMs;
  const ageDays = Math.max(0, Math.floor(unpausedMs / (86400 * 1000)));

  const displayName = pet.name ?? pet.id;
  const paused = pet.pauseIntervals.length > 0 &&
    pet.pauseIntervals[pet.pauseIntervals.length - 1]?.resumedAt === null;
  const statusFlag = pet.diedAt !== null ? " [dead]" : paused ? " [paused]" : "";

  const lines = [
    `${displayName}${statusFlag}  [${pet.eggType}]`,
    `Level ${pet.level}  |  ${pet.xp.toLocaleString()} XP  |  mood: ${moodGlyph}`,
    `Age: ${ageDays}d  |  last interaction: ${formatRelative(pet.lastInteractionAt, nowMs)}`,
  ];

  return {
    ok: true,
    message: lines.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// pets command — read-only
// ---------------------------------------------------------------------------

/**
 * Implements `glyphling pets`.
 *
 * Lists all pets with an active marker (*) and brief stats.
 * MUST NOT acquire the lockfile (DEC-010 read-only path).
 */
export async function petsCommand(
  _args: string[],
  ctx: CommandContext
): Promise<CommandResult> {
  const { config } = ctx;
  const state = await readState(config);

  if (state === null) {
    return {
      ok: false,
      error: "no state found — run glyphling hatch first to create a pet",
    };
  }

  if (state.pets.length === 0) {
    return { ok: true, message: "(no pets yet — run glyphling hatch to start)" };
  }

  const nowMs = Date.now();
  const activePetId = state.globals.activePetId;

  const lines = state.pets.map((pet) => {
    const marker = pet.id === activePetId ? "*" : " ";
    const displayName = pet.name ?? pet.id;
    const mood = deriveMood(pet, nowMs);
    const moodGlyph = MOOD_GLYPHS[mood].ascii;
    const status = pet.diedAt !== null ? "[dead]" : `L${pet.level} ${moodGlyph}`;
    return `${marker} ${displayName}  (${pet.eggType})  ${status}`;
  });

  return {
    ok: true,
    message: lines.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format a timestamp as a relative human-readable string. */
function formatRelative(isoTs: string, nowMs: number): string {
  const ms = nowMs - new Date(isoTs).getTime();
  if (ms < 0) return "just now";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

