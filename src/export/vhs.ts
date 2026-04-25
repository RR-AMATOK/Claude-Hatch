/**
 * vhs wrapper — DEC-014
 *
 * Thin wrappers around the `vhs` external brew binary.
 * NOT an npm dependency — must be installed separately with `brew install vhs`.
 *
 * Error codes:
 *   VHS_NOT_INSTALLED  — binary not found in PATH
 *   VHS_FAILED         — binary found but exited non-zero
 *
 * @see DEC-014
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VhsError =
  | { ok: false; code: "VHS_NOT_INSTALLED"; message: string }
  | { ok: false; code: "VHS_FAILED"; message: string; stderr?: string };

export type VhsCheckResult = { ok: true } | VhsError;
export type VhsRunResult = { ok: true; outputPath: string } | VhsError;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Probe for the `vhs` binary by running `vhs --version`.
 *
 * Returns `{ ok: true }` if vhs is available, or a structured error if not.
 * Never throws — all error paths are encoded in the return type.
 */
export async function ensureVhsInstalled(): Promise<VhsCheckResult> {
  try {
    await execFileAsync("vhs", ["--version"], { timeout: 5000 });
    return { ok: true };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" || e.code === "EACCES") {
      return {
        ok: false,
        code: "VHS_NOT_INSTALLED",
        message: "vhs binary not found. Install via: brew install vhs",
      };
    }
    // Executable found but --version failed — still treat as installed.
    // (Some older vhs versions exit 1 on --version; that's fine.)
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * Execute `vhs <tapeFile>` and expect the output GIF to be written to `outputPath`.
 *
 * The tape file must already contain the correct `Output <outputPath>` directive.
 * `outputPath` is passed here only for the return value on success.
 *
 * @param tapeFile   Absolute path to the `.tape` file.
 * @param outputPath Absolute path where the GIF will be written (for return value).
 * @param timeoutMs  Execution timeout in ms. Default 120 000 (2 minutes).
 */
export async function runVhs(
  tapeFile: string,
  outputPath: string,
  timeoutMs = 120_000
): Promise<VhsRunResult> {
  // Fast-fail if vhs is not installed.
  const check = await ensureVhsInstalled();
  if (!check.ok) return check;

  try {
    await execFileAsync("vhs", [tapeFile], { timeout: timeoutMs });
    return { ok: true, outputPath };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };

    if (e.code === "ENOENT" || e.code === "EACCES") {
      // Disappeared between the check and the run — very unlikely but defensive.
      return {
        ok: false,
        code: "VHS_NOT_INSTALLED",
        message: "vhs binary not found. Install via: brew install vhs",
      };
    }

    if (e.stderr !== undefined && e.stderr !== "") {
      return {
        ok: false,
        code: "VHS_FAILED",
        message: `vhs exited with error: ${e.message}`,
        stderr: e.stderr,
      };
    }
    return {
      ok: false,
      code: "VHS_FAILED",
      message: `vhs exited with error: ${e.message}`,
    };
  }
}
