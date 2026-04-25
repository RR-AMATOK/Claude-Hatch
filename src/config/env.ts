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

import fs from "fs";
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

/**
 * Heuristic: are we running as an installed binary (npm install -g, npx,
 * pnpm/yarn global, or `npm link`) rather than from a source checkout?
 *
 * Two signals, either is sufficient:
 *   1. argv[1] is a bin shim: `<prefix>/bin/glyphling` — covers `npm install
 *      -g`, `npm link`, and most npx invocations where Node sees the shim
 *      path rather than the symlink target.
 *   2. argv[1] resolves to a path under `node_modules/glyphling/` — covers
 *      pnpm / yarn global layouts and direct `node .../bin.js` invocations
 *      from inside an installed package.
 *
 * Dev runs (`npm run dev/demo/test`) set GLYPHLING_HOME explicitly and never
 * reach this branch. Source runs (`node dist/src/bin.js` from the repo)
 * match neither signal and correctly fall through to the DEC-008 guard.
 *
 * Treated as an implicit `NODE_ENV=production` signal so `npm install -g
 * glyphling && glyphling` works out of the box without requiring users to
 * export NODE_ENV themselves.
 */
function isGlobalInstall(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const sep = path.sep;
  // Bin-shim marker: path ends in `<sep>bin<sep>glyphling` (no extension on
  // POSIX; npm adds .cmd on Windows — match both).
  if (
    entry.endsWith(`${sep}bin${sep}glyphling`) ||
    entry.endsWith(`${sep}bin${sep}glyphling.cmd`)
  ) {
    return true;
  }
  // Installed-package marker anywhere in the path (handles pnpm/yarn global
  // + realpath-resolved invocations).
  if (entry.includes(`${sep}node_modules${sep}glyphling${sep}`)) {
    return true;
  }
  // Also check the realpath — symlinks through a user's global prefix bin
  // dir can end up pointing directly at dist/src/bin.js inside an installed
  // package. If realpath resolution fails (missing file / permission), fall
  // through to the source-run behavior.
  try {
    const real = fs.realpathSync(entry);
    if (real.includes(`${sep}node_modules${sep}glyphling${sep}`)) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * Throws when a non-production run would resolve state under ~/.claude/.
 *
 * DEC-008: "Non-production CLI refuses to start if resolved path is under
 * ~/.claude/ when NODE_ENV !== 'production'."
 *
 * SEC-013: On case-insensitive filesystems (darwin/win32), normalise both
 * paths to lowercase before the prefix check so `~/.Claude/glyphling` and
 * `~/.claude/glyphling` are treated as identical.
 */
function assertNonProdGuard(resolvedHome: string, nodeEnv: string): void {
  const isProduction = nodeEnv === "production";
  if (isProduction) return;

  let normalised = path.resolve(resolvedHome);
  let claudeDir = path.resolve(path.join(os.homedir(), ".claude"));

  // SEC-013: Case-insensitive filesystem normalisation (darwin / win32)
  if (process.platform === "darwin" || process.platform === "win32") {
    normalised = normalised.toLowerCase();
    claudeDir = claudeDir.toLowerCase();
  }

  // Check whether resolvedHome is inside ~/.claude/
  const relative = path.relative(claudeDir, normalised);
  const isInsideClaudeDir =
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative));

  if (isInsideClaudeDir) {
    throw new Error(
      `[glyphling] Non-production run detected but GLYPHLING_HOME resolves to ` +
        `"${path.resolve(resolvedHome)}", which is inside ~/.claude/.\n` +
        `Set GLYPHLING_HOME to a repo-local path (e.g. ./.dev-state/dev) ` +
        `before running outside production mode.\n` +
        `This guard exists to prevent dev/demo/test runs from corrupting your ` +
        `real pet state (DEC-008).`
    );
  }
}

/**
 * SEC-006: Throws if `filePath` already exists and is a symlink.
 * Applied to state files on the writer path to prevent symlink-following attacks.
 */
function assertNotSymlink(filePath: string, label: string): void {
  try {
    const lstat = fs.lstatSync(filePath);
    if (lstat.isSymbolicLink()) {
      throw new Error(
        `[glyphling] ${label} at "${filePath}" is a symbolic link. ` +
          `Refusing to write state through a symlink (SEC-006). ` +
          `Remove or replace the symlink before starting glyphling.`
      );
    }
  } catch (err) {
    // ENOENT = file doesn't exist yet — that's fine
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

/**
 * SEC-006: Run symlink checks on the stateHome directory and critical state files.
 * Called on the writer path (TUI / mutating CLI subcommands) only.
 */
export function assertStateNotSymlinked(config: Config): void {
  assertNotSymlink(config.stateHome, "stateHome");
  assertNotSymlink(config.paths.stateFile, "state.json");
  assertNotSymlink(config.paths.eventsLog, "events.jsonl");
  assertNotSymlink(config.paths.lockFile, "state.json.lock");
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
  // Running from an installed binary implies production intent, even when the
  // host shell has no NODE_ENV exported. Without this, `npm install -g
  // glyphling && glyphling` would hit the DEC-008 guard and refuse to start.
  const effectiveEnv =
    nodeEnv === "production" || isGlobalInstall() ? "production" : nodeEnv;

  let stateHome: string;

  if (env["GLYPHLING_HOME"]) {
    // Explicit override — always accepted regardless of NODE_ENV.
    stateHome = path.resolve(env["GLYPHLING_HOME"]);
  } else if (effectiveEnv === "production") {
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
  assertNonProdGuard(stateHome, effectiveEnv);

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
