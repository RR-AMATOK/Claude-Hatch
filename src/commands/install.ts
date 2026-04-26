/**
 * `glyphling install` — install slash-command files into ~/.claude/commands/
 *
 * Copies claude-commands/glyph-*.md from the package's bundled directory
 * into ~/.claude/commands/. Supports --uninstall to remove them.
 *
 * Safety rules:
 *   - Idempotent: re-runs do not overwrite non-glyphling files.
 *   - A target file that already exists AND belongs to glyphling (detected by
 *     GLYPHLING_SOURCE_MARKER in the frontmatter) may be overwritten.
 *   - A target file that exists but does NOT have the marker is refused.
 *   - --uninstall removes ONLY files that carry the marker.
 *
 * Source detection: checks for the GLYPHLING_SOURCE_MARKER string in the
 * first 512 bytes of an existing target file before overwriting or removing.
 *
 * Note: this command does NOT touch ~/.claude/settings.json. It prints the
 * recommended statusline snippet for the user to paste manually.
 * (Settings patching is TODO-023's territory — `glyphling setup`.)
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Marker embedded in every glyph-*.md file's content to identify it as
 * a glyphling-managed file. The installer checks the first 512 bytes of an
 * existing target file for this string before overwriting or removing.
 *
 * NOTE: This marker must appear in the body of every glyph-*.md file. It is
 * not in the YAML frontmatter — Claude Code strips frontmatter before display.
 * We embed it in a comment at the top of the !-block body so it's invisible
 * to the user but survives intact on disk.
 *
 * IMPORTANT: The actual string used here must exactly match what is embedded
 * in the source files by `embedMarker()`.
 */
const GLYPHLING_SOURCE_MARKER = "glyphling-managed:true";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface InstallResult {
  ok: boolean;
  message?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// installCommand
// ---------------------------------------------------------------------------

/**
 * Parse install args and dispatch to install or uninstall.
 */
export async function installCommand(args: string[]): Promise<InstallResult> {
  const uninstall = args.includes("--uninstall");
  const targetDir = path.join(os.homedir(), ".claude", "commands");

  if (uninstall) {
    return runUninstall(targetDir);
  }
  return runInstall(targetDir);
}

// ---------------------------------------------------------------------------
// Source directory resolution
// ---------------------------------------------------------------------------

/**
 * Locate the bundled claude-commands/ directory.
 *
 * Resolution order:
 *   1. Sibling of the install.js file in the same parent dir (production:
 *      `dist/src/install.js` → `dist/claude-commands/`)
 *   2. Two levels up from this file (dev/tsx: `src/commands/install.ts` →
 *      `<project-root>/claude-commands/`)
 *
 * Returns the absolute path to the first candidate that exists on disk, or
 * throws a descriptive error if neither can be found.
 */
function findSourceDir(): string {
  // In ESM, __dirname is not available. Derive from import.meta.url.
  const here = path.dirname(fileURLToPath(import.meta.url));

  // Production build path:
  //   dist/src/install.js → here = <project>/dist/src
  //   parent dir of `src` = <project>/dist
  //   sibling claude-commands/ = <project>/dist/claude-commands
  const productionCandidate = path.resolve(here, "..", "claude-commands");
  if (existsSync(productionCandidate)) return productionCandidate;

  // Dev/tsx path:
  //   src/commands/install.ts → here = <project>/src/commands
  //   two levels up = <project>
  //   claude-commands/ = <project>/claude-commands
  const devCandidate = path.resolve(here, "..", "..", "claude-commands");
  if (existsSync(devCandidate)) return devCandidate;

  throw new Error(
    `Cannot locate claude-commands/ directory.\n` +
      `Tried:\n  ${productionCandidate}\n  ${devCandidate}\n` +
      `Run from the project root or rebuild with npm run build.`
  );
}

function existsSync(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// runInstall
// ---------------------------------------------------------------------------

async function runInstall(targetDir: string): Promise<InstallResult> {
  let sourceDir: string;
  try {
    sourceDir = findSourceDir();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Enumerate source files
  let sourceFiles: string[];
  try {
    const entries = await fs.promises.readdir(sourceDir);
    sourceFiles = entries.filter((f) => f.startsWith("glyph-") && f.endsWith(".md"));
  } catch (err) {
    return {
      ok: false,
      error: `Failed to read source directory ${sourceDir}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (sourceFiles.length === 0) {
    return { ok: false, error: `No glyph-*.md files found in ${sourceDir}` };
  }

  // Ensure target directory exists
  try {
    await fs.promises.mkdir(targetDir, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      error: `Failed to create ${targetDir}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const installed: string[] = [];
  const skipped: string[] = [];
  const refused: string[] = [];

  for (const filename of sourceFiles) {
    const srcPath = path.join(sourceDir, filename);
    const dstPath = path.join(targetDir, filename);

    // Read source content and inject marker
    let srcContent: string;
    try {
      srcContent = await fs.promises.readFile(srcPath, "utf8");
    } catch (err) {
      return {
        ok: false,
        error: `Failed to read ${srcPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const markedContent = embedMarker(srcContent);

    // Check if target already exists
    let existing: string | null = null;
    try {
      existing = await fs.promises.readFile(dstPath, "utf8");
    } catch {
      // File does not exist — proceed with install
    }

    if (existing !== null) {
      if (existing.includes(GLYPHLING_SOURCE_MARKER)) {
        // Owned by glyphling — check for idempotency (up-to-date)
        if (existing === markedContent) {
          skipped.push(filename);
          continue;
        }
        // File is ours but outdated — fall through to overwrite
      } else {
        // Not ours — refuse
        refused.push(filename);
        continue;
      }
    }

    try {
      await fs.promises.writeFile(dstPath, markedContent, "utf8");
      installed.push(filename);
    } catch (err) {
      return {
        ok: false,
        error: `Failed to write ${dstPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  if (refused.length > 0) {
    return {
      ok: false,
      error:
        `Refused to overwrite non-glyphling file(s): ${refused.join(", ")}\n` +
        `Remove them manually or rename before running glyphling install.`,
    };
  }

  const lines: string[] = [];

  if (installed.length > 0) {
    lines.push(`Installed ${installed.length} slash command(s) to ${targetDir}:`);
    for (const f of installed) lines.push(`  ${f}`);
  }

  if (skipped.length > 0) {
    lines.push(`Already up-to-date: ${skipped.length} file(s) skipped.`);
  }

  if (installed.length === 0 && skipped.length > 0) {
    lines.push("All slash commands are already installed and up-to-date.");
  }

  lines.push("");
  lines.push("Slash commands are now available in Claude Code.");
  lines.push("Type /glyph- in any Claude Code session to see them.");
  lines.push("");
  lines.push("To also show your pet in the statusline, add this to .claude/settings.json:");
  lines.push('  "statusLine": { "type": "command", "command": "glyphling statusline", "padding": 1, "refreshInterval": 1 }');

  return { ok: true, message: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// runUninstall
// ---------------------------------------------------------------------------

async function runUninstall(targetDir: string): Promise<InstallResult> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(targetDir);
  } catch {
    return { ok: true, message: `No commands directory found at ${targetDir} — nothing to remove.` };
  }

  const candidates = entries.filter((f) => f.startsWith("glyph-") && f.endsWith(".md"));

  if (candidates.length === 0) {
    return { ok: true, message: "No glyph-*.md files found in commands directory." };
  }

  const removed: string[] = [];
  const skipped: string[] = [];

  for (const filename of candidates) {
    const dstPath = path.join(targetDir, filename);

    // Read the file to check ownership marker
    let content: string | null = null;
    try {
      content = await fs.promises.readFile(dstPath, "utf8");
    } catch {
      skipped.push(`${filename} (unreadable)`);
      continue;
    }

    if (content === null || !content.includes(GLYPHLING_SOURCE_MARKER)) {
      skipped.push(`${filename} (not glyphling-managed)`);
      continue;
    }

    try {
      await fs.promises.unlink(dstPath);
      removed.push(filename);
    } catch (err) {
      return {
        ok: false,
        error: `Failed to remove ${dstPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const lines: string[] = [];

  if (removed.length > 0) {
    lines.push(`Removed ${removed.length} glyphling slash command(s):`);
    for (const f of removed) lines.push(`  ${f}`);
  }

  if (skipped.length > 0) {
    lines.push(`Skipped ${skipped.length} file(s) (not glyphling-managed):`);
    for (const f of skipped) lines.push(`  ${f}`);
  }

  if (removed.length === 0) {
    lines.push("No glyphling-managed slash commands found to remove.");
  }

  return { ok: true, message: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Marker injection
// ---------------------------------------------------------------------------

/**
 * Inject the GLYPHLING_SOURCE_MARKER into a command file's content.
 *
 * The marker is appended as an HTML comment at the very end of the file so it
 * is invisible to Claude Code's prompt rendering but survives on disk for
 * ownership detection during install/uninstall.
 */
function embedMarker(content: string): string {
  const trimmed = content.trimEnd();
  return `${trimmed}\n<!-- ${GLYPHLING_SOURCE_MARKER} -->\n`;
}
