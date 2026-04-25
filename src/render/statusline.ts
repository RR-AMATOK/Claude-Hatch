/**
 * Statusline renderer — Module #21 (architecture §2.2)
 *
 * One-shot subprocess entry point for `glyphling statusline`.
 * Contract (DEC-016, MEMORY.md §Claude Code Statusline):
 *   - Read JSON from stdin (50ms timeout, tolerant of missing fields)
 *   - Read state.json via readState() — NEVER acquires the lockfile
 *   - Pick compact frame for the active pet's current scene
 *   - Print ≤3 rows × ≤60 cols ANSI to stdout
 *   - Exit 0 always (non-zero = blank statusline)
 *
 * Graceful degradation:
 *   - stdin not piped → fall through to state-only render
 *   - state.json missing → print FALLBACK_OUTPUT, exit 0
 *   - state.json schema-invalid → print FALLBACK_OUTPUT, exit 0
 */

import { readStateOrError } from "../state/reader.js";
import type { Config } from "../config/env.js";
import type { Pet } from "../state/schema.js";
import {
  FALLBACK_OUTPUT,
  STALE_OUTPUT,
  REFRESH_MS,
  detectColorMode,
  pickScene,
  assembleCompactOutput,
  assembleWideOutput,
  classifyTier,
} from "./compact.js";

// ---------------------------------------------------------------------------
// Stdin JSON contract (MEMORY.md §Claude Code Statusline)
// ---------------------------------------------------------------------------

interface StatuslineStdin {
  session_id?: string;
  transcript_path?: string;
  model?: { id?: string; display_name?: string };
  workspace?: {
    current_dir?: string;
    project_dir?: string;
    added_dirs?: string[];
    git_worktree?: string;
  };
  context_window?: {
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | null;
    used_percentage?: number | null;
    remaining_percentage?: number | null;
  };
  cost?: {
    total_cost_usd?: number;
    total_duration_ms?: number;
  };
  rate_limits?: unknown;
  vim?: { mode?: string };
  agent?: { name?: string; type?: string };
  worktree?: unknown;
  // Optional fields that some Claude Code versions inject:
  permission_mode?: string;
  output_style?: { name?: string };
}

// ---------------------------------------------------------------------------
// Stdin reader with timeout
// ---------------------------------------------------------------------------

/**
 * Read all of stdin, resolving after it closes or after `timeoutMs`.
 * Returns empty string if stdin is not piped (TTY) or times out.
 *
 * SEC-011: Accumulate as Buffer with a 64 KB cap to prevent memory exhaustion
 * from a malicious or runaway stdin pipe. Decode to UTF-8 at the end (avoids
 * partial-multibyte-character corruption from incremental toString calls).
 *
 * We MUST NOT block on stdin when running manually without a piped input.
 * The 50ms timeout covers the fast statusline tick budget.
 */
async function readStdin(timeoutMs = 50): Promise<string> {
  // If stdin is a TTY there's nothing to read; skip immediately.
  if (process.stdin.isTTY) return "";

  const MAX_STDIN_BYTES = 64 * 1024; // 64 KB cap

  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let capped = false;
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    }, timeoutMs);

    const onData = (chunk: Buffer | string) => {
      if (capped) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      const remaining = MAX_STDIN_BYTES - totalBytes;
      if (buf.length >= remaining) {
        // Cap reached — take only what fits and stop appending
        chunks.push(buf.slice(0, remaining));
        totalBytes = MAX_STDIN_BYTES;
        capped = true;
      } else {
        chunks.push(buf);
        totalBytes += buf.length;
      }
    };

    const onEnd = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    };

    const onError = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("error", onError);
    };

    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);

    process.stdin.resume();
  });
}

/**
 * Parse the stdin JSON blob tolerantly. Returns empty object on any error.
 */
function parseStdin(raw: string): StatuslineStdin {
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as StatuslineStdin;
    }
    return {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// renderOnce — main entry point
// ---------------------------------------------------------------------------

/**
 * One-shot statusline render. Returns the process exit code (always 0).
 *
 * Steps:
 * 1. Read stdin (with 50ms timeout)
 * 2. Read state.json via readState()
 * 3. Pick scene + frame for active pet
 * 4. Render to stdout
 * 5. Exit 0
 */
export async function renderOnce(config: Config): Promise<number> {
  const env = process.env as Record<string, string | undefined>;

  // Step 1: Read stdin (non-blocking, tolerant) — parsed for future use
  // but not rendered. Session context (model/cwd/ctx%/cost) is owned by the
  // parallel `claude-usage` project; glyphling renders only the pet.
  const stdinRaw = await readStdin(50);
  void parseStdin(stdinRaw);

  // Step 2: Read state.json (lock-free per DEC-010/DEC-016)
  let state;
  try {
    const result = await readStateOrError(config);
    if (result.parseError) {
      // TODO-038: state.json exists but failed schema/parse validation.
      // Emit a distinct fallback so the user can tell it's stale, not missing.
      process.stdout.write(STALE_OUTPUT + "\n");
      return 0;
    }
    state = result.state;
  } catch {
    // Unreadable state — degrade gracefully
    process.stdout.write(FALLBACK_OUTPUT + "\n");
    return 0;
  }

  if (state === null) {
    // Missing state.json (first run or missing file)
    process.stdout.write(FALLBACK_OUTPUT + "\n");
    return 0;
  }

  // Step 3: Find active pet
  const activePetId = state.globals.activePetId;
  let activePet: Pet | null = null;
  let petIndex = 0;

  if (activePetId !== null) {
    const idx = state.pets.findIndex((p) => p.id === activePetId);
    if (idx !== -1) {
      activePet = state.pets[idx] ?? null;
      petIndex = idx;
    }
  }

  // Fall back to first pet if no active pet set
  if (activePet === null && state.pets.length > 0) {
    activePet = state.pets[0] ?? null;
    petIndex = 0;
  }

  if (activePet === null) {
    // No pets yet
    process.stdout.write(FALLBACK_OUTPUT + "\n");
    return 0;
  }

  // Step 4: Determine rendering env
  const colorMode = detectColorMode(env);
  const richGlyphs = env["GLYPHLING_RICH_GLYPHS"] === "1";
  const tick = Math.floor(Date.now() / REFRESH_MS);
  const sceneKey = pickScene(activePet, Date.now());
  const totalPets = state.pets.length;

  // Read terminal width once per tick.
  // Honor COLUMNS env var for manual probing (e.g. COLUMNS=100 node dist/src/bin.js statusline).
  // Fall back to undefined when not a TTY (CI / pipe contexts → narrow tier).
  const colsEnv = env["COLUMNS"] !== undefined ? parseInt(env["COLUMNS"], 10) : NaN;
  const cols: number | undefined = !isNaN(colsEnv) && colsEnv > 0
    ? colsEnv
    : (process.stdout.columns ?? undefined);

  const tier = classifyTier(cols);

  // Step 5: Assemble and print output — dispatch on tier
  let output: string;
  if (tier === "narrow") {
    output = assembleCompactOutput(
      activePet,
      sceneKey,
      tick,
      colorMode,
      richGlyphs,
      totalPets,
      petIndex
    );
  } else {
    output = assembleWideOutput(
      activePet,
      tier,
      sceneKey,
      tick,
      colorMode,
      richGlyphs,
      totalPets,
      petIndex,
      cols!
    );
  }

  process.stdout.write(output + "\n");
  return 0;
}
