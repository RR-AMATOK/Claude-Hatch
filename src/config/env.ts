/**
 * Config / env resolver — Module #2 (architecture §2.2)
 *
 * Resolves GLYPHLING_HOME from the environment, applies the non-prod guard
 * (DEC-008), and exports computed file paths for all runtime artifacts.
 *
 * Precedence (per §8.2):
 *   1. process.env.GLYPHLING_HOME          — explicit override
 *   2. ~/.claude/glyphling/                — production default (NODE_ENV=production
 *                                            or running from an npm global install)
 *   3. Anything else in non-prod           — hard fail (DEC-008 guard)
 */

import os from "os";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Config {
  /** Resolved absolute path to the glyphling state directory. */
  stateHome: string;
  /** Paths for individual files inside stateHome. */
  paths: {
    stateFile: string;
    lockFile: string;
    eventsLog: string;
    graveyardDir: string;
    ipcSocket: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PROD_HOME = path.join(os.homedir(), ".claude", "glyphling");

/**
 * Returns the path that $HOME/.claude/glyphling would resolve to on this
 * machine. Used to detect when a non-prod run accidentally points there.
 */
function prodHome(): string {
  return DEFAULT_PROD_HOME;
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * Throws when a non-production run would resolve state under ~/.claude/.
 *
 * DEC-008: "Non-production CLI refuses to start if resolved path is under
 * ~/.claude/ when NODE_ENV !== 'production'."
 */
function assertNonProdGuard(resolvedHome: string, nodeEnv: string): void {
  const isProduction = nodeEnv === "production";
  if (isProduction) return;

  const normalised = path.resolve(resolvedHome);
  const claudeDir = path.resolve(path.join(os.homedir(), ".claude"));

  // Check whether resolvedHome is inside ~/.claude/
  const relative = path.relative(claudeDir, normalised);
  const isInsideClaudeDir =
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative));

  if (isInsideClaudeDir) {
    throw new Error(
      `[glyphling] Non-production run detected but GLYPHLING_HOME resolves to ` +
        `"${normalised}", which is inside ~/.claude/.\n` +
        `Set GLYPHLING_HOME to a repo-local path (e.g. ./.dev-state/dev) ` +
        `before running outside production mode.\n` +
        `This guard exists to prevent dev/demo/test runs from corrupting your ` +
        `real pet state (DEC-008).`
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves the glyphling state home directory and returns a fully-typed
 * Config object with all derived file paths.
 *
 * @param env   Override for process.env (defaults to process.env). Useful
 *              in tests to inject a controlled environment.
 * @param nodeEnv Override for NODE_ENV. Defaults to process.env.NODE_ENV.
 */
export function resolveStateHome(
  env: Record<string, string | undefined> = process.env,
  nodeEnv: string = process.env["NODE_ENV"] ?? "development"
): Config {
  let stateHome: string;

  if (env["GLYPHLING_HOME"]) {
    // Explicit override — always accepted regardless of NODE_ENV.
    stateHome = path.resolve(env["GLYPHLING_HOME"]);
  } else if (nodeEnv === "production") {
    // Production default: ~/.claude/glyphling/
    stateHome = prodHome();
  } else {
    // Non-prod without an explicit override — hard fail per DEC-008.
    throw new Error(
      `[glyphling] GLYPHLING_HOME is not set and NODE_ENV is "${nodeEnv}" ` +
        `(not "production").\n` +
        `Set GLYPHLING_HOME to a repo-local path before running in dev/demo/test mode.\n` +
        `Example: GLYPHLING_HOME=./.dev-state/dev tsx src/cli.tsx\n` +
        `This guard prevents dev runs from accidentally writing to ~/.claude/glyphling/ (DEC-008).`
    );
  }

  // Apply the non-prod guard even when GLYPHLING_HOME was explicitly set.
  assertNonProdGuard(stateHome, nodeEnv);

  return buildConfig(stateHome);
}

/**
 * Build the Config object from an already-resolved stateHome path.
 * Exported for testing path derivations in isolation.
 */
export function buildConfig(stateHome: string): Config {
  return {
    stateHome,
    paths: {
      stateFile: path.join(stateHome, "state.json"),
      lockFile: path.join(stateHome, "state.json.lock"),
      eventsLog: path.join(stateHome, "events.jsonl"),
      graveyardDir: path.join(stateHome, "graveyard"),
      ipcSocket: path.join(stateHome, "ipc.sock"),
    },
  };
}
