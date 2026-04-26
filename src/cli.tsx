/**
 * CLI entry — Module #1 (architecture §2.2)
 *
 * Parses argv, resolves config, boots the Ink AppContainer, and installs
 * shutdown hooks. This is the bin target in package.json.
 *
 * TODO: Implement full argv parsing (minimist or yargs), graceful teardown,
 *       and signal collector startup once downstream modules are ready.
 */

import React from "react";
import { render } from "ink";
import { App } from "./render/App.js";
import { resolveStateHome, assertStateNotSymlinked } from "./config/env.js";
import { renderOnce } from "./render/statusline.js";
import { captureMain } from "./render/capture.js";
import {
  exportCommand,
  hatchCommand,
  feedCommand,
  playCommand,
  petCommand,
  pauseCommand,
  resumeCommand,
  nameCommand,
  statusCommand,
  petsCommand,
} from "./commands/handlers.js";
import { runWatchDaemon } from "./daemon/index.js";
import { runDoctor } from "./commands/doctor.js";
import { setupCommand, parseSetupArgs } from "./commands/setup.js";
import { installCommand } from "./commands/install.js";

export async function main(argv: string[]): Promise<number> {
  // Resolve state home — will throw if DEC-008 guard trips.
  const config = resolveStateHome();

  // DEC-016: one-shot statusline renderer — must dispatch before Ink boots.
  // Statusline is a read-only path; symlink check is not required (DEC-016 §13 risk #6).
  if (argv[0] === "statusline") {
    return renderOnce(config);
  }

  // Headless capture subcommand — used by vhs tapes (DEC-014).
  // Does NOT acquire the state lock; reads scene data only.
  if (argv[0] === "capture") {
    return captureMain(argv.slice(1));
  }

  // `glyphling doctor` — read-only diagnostics, no symlink check needed.
  if (argv[0] === "doctor") {
    return runDoctor(config);
  }

  // `glyphling install [--uninstall]` — no state access; operates on ~/.claude/commands/ only.
  if (argv[0] === "install") {
    const result = await installCommand(argv.slice(1));
    if (result.ok) {
      process.stdout.write((result.message ?? "Done.") + "\n");
      return 0;
    } else {
      process.stderr.write(`[glyphling] ${result.error ?? "unknown error"}\n`);
      return 1;
    }
  }

  // SEC-006: All writer paths check that state files are not symlinks.
  assertStateNotSymlinked(config);

  // `glyphling watch` — long-running token watcher daemon. Writer path
  // (acquires daemon lockfile + appends events), so symlink check runs first.
  if (argv[0] === "watch") {
    return runWatchDaemon(config);
  }

  // One-shot export subcommand — `glyphling export <tier> [sceneId]`
  if (argv[0] === "export") {
    const result = await exportCommand(argv.slice(1), { config });
    if (result.ok) {
      process.stdout.write((result.message ?? "Export complete.") + "\n");
      return 0;
    } else {
      process.stderr.write(`[glyphling] ${result.error}\n`);
      return 1;
    }
  }

  // Interactive setup wizard — `glyphling setup [flags]`
  // Placed after assertStateNotSymlinked because it writes both state and settings.json.
  if (argv[0] === "setup") {
    const setupArgs = parseSetupArgs(argv.slice(1));
    const result = await setupCommand(setupArgs, { config });
    if (result.ok) {
      if (result.message) {
        // In non-interactive mode, print the summary; interactive mode already
        // streamed output directly to stdout during the prompts.
        if (!process.stdin.isTTY || setupArgs.nonInteractive) {
          process.stdout.write(result.message + "\n");
        }
      }
      return 0;
    } else {
      process.stderr.write(`[glyphling] ${result.error}\n`);
      return 1;
    }
  }

  // First-run primary-pet bootstrap — `glyphling hatch <eggType> [name]`
  if (argv[0] === "hatch") {
    const result = await hatchCommand(argv.slice(1), { config });
    if (result.ok) {
      process.stdout.write((result.message ?? "Hatched.") + "\n");
      return 0;
    } else {
      process.stderr.write(`[glyphling] ${result.error}\n`);
      return 1;
    }
  }

  // One-shot interaction commands — `glyphling feed|play|pet|pause|resume|name|status|pets`
  {
    type SimpleAsyncCmd = (
      args: string[],
      ctx: { config: typeof config }
    ) => Promise<{ ok: boolean; message?: string; error?: string }>;
    const simpleCommands: Record<string, SimpleAsyncCmd> = {
      feed: feedCommand,
      play: playCommand,
      pet: petCommand,
      pause: pauseCommand,
      resume: resumeCommand,
      name: nameCommand,
      status: statusCommand,
      pets: petsCommand,
    };

    const sub = argv[0];
    if (sub !== undefined && sub in simpleCommands) {
      const handler = simpleCommands[sub]!;
      const result = await handler(argv.slice(1), { config });
      if (result.ok) {
        process.stdout.write((result.message ?? "") + "\n");
        return 0;
      } else {
        process.stderr.write(`[glyphling] ${result.error ?? "unknown error"}\n`);
        return 1;
      }
    }
  }

  void argv; // TODO: parse --help, --version, subcommands

  const { waitUntilExit, unmount } = render(<App config={config} />);

  // SEC-010: Graceful teardown on SIGINT/SIGTERM.
  // Force-exit safety net at 500 ms ensures we never hang on a stuck unmount;
  // normal path lets `waitUntilExit()` resolve naturally after `unmount()`.
  const gracefulExit = () => {
    const force = setTimeout(() => process.exit(1), 500);
    force.unref();
    try {
      unmount();
    } catch {
      // ignore — Ink already torn down
    }
  };
  process.on("SIGINT", gracefulExit);
  process.on("SIGTERM", gracefulExit);

  await waitUntilExit();
  return 0;
}

// Run when executed directly (tsx src/cli.tsx or dist/cli.js)
main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    // Surface clean error messages for the DEC-008 guard and schema errors.
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(message + "\n");
    process.exit(1);
  }
);
