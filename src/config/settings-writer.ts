/**
 * SettingsWriter — Module #28 (architecture §2.2)
 *
 * Patches `.claude/settings.json` (global or project-scoped) with the
 * canonical `glyphling statusline` block without disturbing any other
 * top-level keys already present in the file.
 *
 * Design notes:
 *   - The file is treated as plain JSON (not JSONC). Comments are NOT
 *     preserved because Claude Code's settings.json is valid JSON, not
 *     JSON-with-comments. If a user has manually added // comments, they
 *     will be lost on the first write — document this and do not write.
 *   - Atomic write: write to <file>.tmp then rename (POSIX atomic).
 *   - SEC-006: symlink check before opening the target for writing.
 *   - Idempotent: if the exact glyphling block is already present, the
 *     file is not rewritten (preserves modification time + key order).
 *   - Key order is preserved by operating on the parsed object and
 *     serialising back with the same insertion order. JSON.parse in V8
 *     preserves insertion order for string keys, so round-trips are stable.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// The canonical statusLine block (DEC-016)
// ---------------------------------------------------------------------------

/** The exact object installed into settings.json under the `statusLine` key. */
export interface StatusLineBlock {
  type: "command";
  command: string;
  padding: number;
  refreshInterval: number;
}

const GLYPHLING_STATUS_LINE: StatusLineBlock = {
  type: "command",
  command: "glyphling statusline",
  padding: 1,
  refreshInterval: 1,
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PatchFailureReason =
  | "would-overwrite-foreign-statusline"
  | "cwd-is-home"
  | "cwd-is-root"
  | "parse-error"
  | "io-error"
  | "symlink";

export interface PatchResult {
  ok: boolean;
  /** Present when ok === false. */
  reason?: PatchFailureReason;
  /** Human-readable description of the failure. */
  message?: string;
  /** True when the file already had the correct glyphling block (no-op). */
  alreadyInstalled?: boolean;
}

// ---------------------------------------------------------------------------
// Internal: symlink guard (SEC-006)
// ---------------------------------------------------------------------------

/**
 * Throws a PatchResult if `filePath` exists and is a symlink.
 * Returns void when safe to proceed (file absent or a regular file).
 */
function checkNotSymlink(filePath: string): PatchResult | null {
  try {
    const lstat = fs.lstatSync(filePath);
    if (lstat.isSymbolicLink()) {
      return {
        ok: false,
        reason: "symlink",
        message: `"${filePath}" is a symbolic link. Refusing to write through a symlink (SEC-006).`,
      };
    }
  } catch (err) {
    // ENOENT = file doesn't exist yet — safe to proceed.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return {
      ok: false,
      reason: "io-error",
      message: `lstat failed on "${filePath}": ${(err as Error).message}`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Patch `filePath` (a settings.json path) with the canonical glyphling
 * statusLine block.
 *
 * Guarantees:
 *   - Read existing file (or treat as `{}` if missing).
 *   - Parse as JSON; on parse error return `parse-error` (do not write).
 *   - If `statusLine` is already present and NOT a glyphling block →
 *     refuse unless `force === true`. Return `would-overwrite-foreign-statusline`.
 *   - If `statusLine` is already present and IS the exact glyphling block →
 *     no-op (no rewrite). Return `{ ok: true, alreadyInstalled: true }`.
 *   - For project scope: refuse if `cwd === os.homedir()` or `cwd === "/"`.
 *   - Atomic write: tmp file then rename.
 *   - SEC-006: symlink check before opening.
 *   - Comments are NOT preserved (settings.json is plain JSON).
 *
 * @param filePath  Absolute path to the settings.json to patch.
 * @param opts.force       If true, overwrite a foreign statusLine block.
 * @param opts.projectScope  If true, apply cwd-is-home / cwd-is-root guards.
 */
export async function patchSettings(
  filePath: string,
  opts: { force: boolean; projectScope?: boolean }
): Promise<PatchResult> {
  // --- Project-scope guards -------------------------------------------------
  if (opts.projectScope === true) {
    const cwd = process.cwd();
    const homeDir = os.homedir();
    if (cwd === homeDir) {
      return {
        ok: false,
        reason: "cwd-is-home",
        message: `Refusing project-scope install: cwd is $HOME (${homeDir}). Change to a project directory first.`,
      };
    }
    // Normalise to handle trailing slashes on both ends
    if (cwd === "/" || path.resolve(cwd) === "/") {
      return {
        ok: false,
        reason: "cwd-is-root",
        message: `Refusing project-scope install: cwd is the filesystem root ("/").`,
      };
    }
  }

  // --- SEC-006: symlink check -----------------------------------------------
  const symlinkResult = checkNotSymlink(filePath);
  if (symlinkResult !== null) return symlinkResult;

  // --- Read existing file ---------------------------------------------------
  let existing: Record<string, unknown> = {};

  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    if (raw.trim().length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return {
          ok: false,
          reason: "parse-error",
          message: `"${filePath}" contains invalid JSON. Fix or remove the file, then re-run setup.`,
        };
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {
          ok: false,
          reason: "parse-error",
          message: `"${filePath}" does not contain a JSON object at the top level.`,
        };
      }
      existing = parsed as Record<string, unknown>;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      return {
        ok: false,
        reason: "io-error",
        message: `Failed to read "${filePath}": ${(err as Error).message}`,
      };
    }
    // ENOENT — treat as empty object
  }

  // --- Check existing statusLine --------------------------------------------
  if ("statusLine" in existing) {
    const sl = existing["statusLine"];

    // Is it already the exact glyphling block?
    if (isGlyphlingBlock(sl)) {
      return { ok: true, alreadyInstalled: true };
    }

    // It's a foreign block — refuse unless --force
    if (!opts.force) {
      return {
        ok: false,
        reason: "would-overwrite-foreign-statusline",
        message:
          `"${filePath}" already has a statusLine block that isn't glyphling. ` +
          `Run with --force to overwrite it.`,
      };
    }
    // force === true: fall through and overwrite
  }

  // --- Build new content (preserve existing key order) ---------------------
  // By assigning to the existing object we keep all other top-level keys
  // at their original positions, with statusLine appended only when new.
  const patched: Record<string, unknown> = { ...existing, statusLine: GLYPHLING_STATUS_LINE };

  // --- Atomic write: tmp → rename ------------------------------------------
  const dir = path.dirname(filePath);

  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      reason: "io-error",
      message: `Failed to create directory "${dir}": ${(err as Error).message}`,
    };
  }

  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;

  // Re-check symlink on the tmp path just to be safe
  const tmpSymlinkResult = checkNotSymlink(tmpPath);
  if (tmpSymlinkResult !== null) return tmpSymlinkResult;

  try {
    await fs.promises.writeFile(tmpPath, JSON.stringify(patched, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (err) {
    return {
      ok: false,
      reason: "io-error",
      message: `Failed to write tmp file "${tmpPath}": ${(err as Error).message}`,
    };
  }

  try {
    await fs.promises.rename(tmpPath, filePath);
  } catch (err) {
    // Clean up tmp on failure
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      // best-effort
    }
    return {
      ok: false,
      reason: "io-error",
      message: `Failed to rename tmp → target "${filePath}": ${(err as Error).message}`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if `value` is structurally identical to the canonical
 * glyphling statusLine block.
 */
function isGlyphlingBlock(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    v["type"] === GLYPHLING_STATUS_LINE.type &&
    v["command"] === GLYPHLING_STATUS_LINE.command &&
    v["padding"] === GLYPHLING_STATUS_LINE.padding &&
    v["refreshInterval"] === GLYPHLING_STATUS_LINE.refreshInterval
  );
}

/**
 * Returns the path to the global settings.json:
 *   `~/.claude/settings.json`
 */
export function globalSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

/**
 * Returns the path to the project-scoped settings.json:
 *   `<cwd>/.claude/settings.json`
 */
export function projectSettingsPath(): string {
  return path.join(process.cwd(), ".claude", "settings.json");
}
