/**
 * Daemon integration tests:
 *   - Lockfile contention: second watch attempt exits non-zero
 *   - Daemon starts and stops cleanly
 */

import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import lockfile from "proper-lockfile";
import { buildConfig } from "../config/env.js";
import { runWatchDaemon } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAEMON_LOCK_FILENAME = "watch.lock";

async function ensureFile(filePath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const fh = await fs.promises.open(filePath, "a", 0o600);
  await fh.close();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runWatchDaemon", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "daemon-test-"));
    // Point the projects dir to an empty tmp folder so chokidar doesn't scan ~/.claude
    process.env["GLYPHLING_PROJECTS_DIR"] = path.join(tmpDir, "projects");
    await fs.promises.mkdir(process.env["GLYPHLING_PROJECTS_DIR"]!, { recursive: true });
  });

  afterEach(async () => {
    delete process.env["GLYPHLING_PROJECTS_DIR"];
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("exits 1 when daemon lockfile is already held", async () => {
    const config = buildConfig(tmpDir);
    const lockFilePath = path.join(tmpDir, DAEMON_LOCK_FILENAME);

    // Pre-acquire the daemon lockfile to simulate a running watcher
    await ensureFile(lockFilePath);
    const release = await lockfile.lock(lockFilePath, {
      stale: 10_000,
      update: 2_000,
      retries: 0,
      realpath: false,
    });

    try {
      // runWatchDaemon should detect the held lock and return 1
      const exitCode = await runWatchDaemon(config);
      expect(exitCode).toBe(1);
    } finally {
      await release();
    }
  });

  it("acquires lockfile and releases it on stop signal", async () => {
    const config = buildConfig(tmpDir);
    const lockFilePath = path.join(tmpDir, DAEMON_LOCK_FILENAME);

    // We can't easily test the long-running path without process forking,
    // but we can verify: after a simulated run that immediately hits SIGTERM,
    // the lockfile is no longer held.
    //
    // Strategy: run the daemon in the same process with a SIGTERM sent after a
    // short delay. We check that the lockfile (.lock directory) is cleaned up.

    let exitCode: number | null = null;

    // Override process.exit to capture the exit code instead of actually exiting
    const origExit = process.exit.bind(process);
    let exitCalled = false;
    const mockExit = (code?: number | string | null | undefined) => {
      exitCalled = true;
      exitCode = typeof code === "number" ? code : 0;
      // Don't actually exit — just mark it
    };
    // @ts-expect-error — override for test
    process.exit = mockExit;

    // Start the daemon (it blocks internally, but we schedule a SIGTERM)
    const daemonPromise = runWatchDaemon(config);

    // Send SIGTERM after 300ms
    setTimeout(() => {
      process.emit("SIGTERM");
    }, 300);

    // Wait for the daemon to process the signal and call process.exit
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (exitCalled) {
          clearInterval(check);
          resolve();
        }
      }, 50);
      // Timeout safety
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 3_000);
    });

    // Restore process.exit
    process.exit = origExit;

    // The daemon lockfile lock directory should not exist (was released)
    const lockDirPath = lockFilePath + ".lock";
    let lockDirExists = false;
    try {
      await fs.promises.access(lockDirPath);
      lockDirExists = true;
    } catch {
      lockDirExists = false;
    }

    expect(exitCalled).toBe(true);
    expect(exitCode).toBe(0);
    expect(lockDirExists).toBe(false);

    // Void the promise to avoid unhandled rejection warnings
    void daemonPromise.catch(() => undefined);
  });
});
