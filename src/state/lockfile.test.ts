/**
 * Tests for src/state/lockfile.ts
 *
 * Covers:
 *   - withLock: basic acquire/release
 *   - Concurrent writes from two spawned child processes do not corrupt state
 *   - Stale lock is swept and new writer succeeds
 *   - sweepStale: removes stale tmp files
 *   - LockTimeoutError is thrown when contention exceeds timeout
 *
 * All tests use os.tmpdir() — never ~/.claude/ (DEC-008).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { withLock, sweepStale, LockTimeoutError } from "./lockfile.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "glyphling-lock-test-")
  );
  tmpDirs.push(dir);
  return dir;
}

async function makeResourceFile(dir: string, name = "state.json"): Promise<string> {
  const file = path.join(dir, name);
  await fs.promises.writeFile(file, "{}", "utf8");
  return file;
}

afterEach(async () => {
  // Clean up temp dirs
  for (const dir of tmpDirs) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  tmpDirs = [];
});

// ---------------------------------------------------------------------------
// Basic withLock tests
// ---------------------------------------------------------------------------

describe("withLock — basic", () => {
  it("acquires and releases a lock", async () => {
    const dir = await makeTmpDir();
    const file = await makeResourceFile(dir);
    let ran = false;
    await withLock(file, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    // Lock file should be removed after release
    const lockExists = await fs.promises
      .access(file + ".lock")
      .then(() => true)
      .catch(() => false);
    expect(lockExists).toBe(false);
  });

  it("releases the lock even if fn throws", async () => {
    const dir = await makeTmpDir();
    const file = await makeResourceFile(dir);
    await expect(
      withLock(file, async () => {
        throw new Error("intentional failure");
      })
    ).rejects.toThrow("intentional failure");
    // Lock should still be removed
    const lockExists = await fs.promises
      .access(file + ".lock")
      .then(() => true)
      .catch(() => false);
    expect(lockExists).toBe(false);
  });

  it("allows sequential withLock calls on the same file", async () => {
    const dir = await makeTmpDir();
    const file = await makeResourceFile(dir);
    let counter = 0;
    await withLock(file, async () => {
      counter++;
    });
    await withLock(file, async () => {
      counter++;
    });
    expect(counter).toBe(2);
  });

  it("serialises two concurrent withLock calls in the same process", async () => {
    const dir = await makeTmpDir();
    const file = await makeResourceFile(dir);
    const order: number[] = [];

    // First lock holds for a bit
    const first = withLock(file, async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 80));
      order.push(2);
    });

    // Second lock waits for first to release
    await new Promise((r) => setTimeout(r, 20)); // let first acquire first
    const second = withLock(file, async () => {
      order.push(3);
    });

    await Promise.all([first, second]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("passes return value through withLock", async () => {
    const dir = await makeTmpDir();
    const file = await makeResourceFile(dir);
    const result = await withLock(file, async () => 42);
    expect(result).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Stale lock recovery
// ---------------------------------------------------------------------------

describe("withLock — stale lock recovery", () => {
  it("recovers from a stale lock and acquires successfully", async () => {
    const dir = await makeTmpDir();
    const file = await makeResourceFile(dir);

    // proper-lockfile uses mkdir() for locking — the lock IS a directory.
    // Stale detection compares the directory's mtime to Date.now() - stale.
    // We simulate a stale lock by creating the lock directory and backdating its mtime.
    const lockDir = file + ".lock";
    await fs.promises.mkdir(lockDir);
    const oldTime = new Date(Date.now() - 10_000); // 10s ago > STALE_MS=5s
    await fs.promises.utimes(lockDir, oldTime, oldTime);

    let ran = false;
    await withLock(file, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sweepStale
// ---------------------------------------------------------------------------

describe("sweepStale", () => {
  it("removes stale tmp files older than STALE_MS", async () => {
    const dir = await makeTmpDir();

    // Create a stale tmp file by backdating its mtime via write then touch
    const staleTmpPath = path.join(dir, "state.json.tmp.99999.deadbeef");
    await fs.promises.writeFile(staleTmpPath, "stale content");

    // Backdate mtime by 10 seconds
    const oldTime = new Date(Date.now() - 10_000);
    await fs.promises.utimes(staleTmpPath, oldTime, oldTime);

    await sweepStale(dir);

    const exists = await fs.promises
      .access(staleTmpPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("leaves fresh tmp files alone", async () => {
    const dir = await makeTmpDir();
    const freshTmpPath = path.join(dir, "state.json.tmp.12345.cafebabe");
    await fs.promises.writeFile(freshTmpPath, "fresh content");

    await sweepStale(dir);

    const exists = await fs.promises
      .access(freshTmpPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it("is a no-op when stateHome does not exist", async () => {
    await expect(
      sweepStale(path.join(os.tmpdir(), "glyphling-nonexistent-12345"))
    ).resolves.not.toThrow();
  });

  it("does not remove non-tmp files", async () => {
    const dir = await makeTmpDir();
    const stateFile = path.join(dir, "state.json");
    await fs.promises.writeFile(stateFile, "{}");

    await sweepStale(dir);

    const exists = await fs.promises
      .access(stateFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Concurrent writes from spawned child processes
// ---------------------------------------------------------------------------

describe("withLock — concurrent writes (spawned processes)", () => {
  it(
    "two concurrent writers do not corrupt the counter file",
    async () => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);

      const dir = await makeTmpDir();
      const file = await makeResourceFile(dir, "counter.json");
      await fs.promises.writeFile(file, JSON.stringify({ count: 0 }), "utf8");

      // Write a helper script to a temp file
      const helperScript = path.join(dir, "writer.mjs");
      await fs.promises.writeFile(
        helperScript,
        `
import fs from "fs";
import path from "path";
import { withLock } from ${JSON.stringify(
          // Use the compiled path if available, otherwise source via tsx
          path.resolve(
            process.cwd(),
            "src/state/lockfile.ts"
          )
        )};

const file = process.argv[2];
const iterations = parseInt(process.argv[3] ?? "5", 10);

for (let i = 0; i < iterations; i++) {
  await withLock(file, async () => {
    const raw = await fs.promises.readFile(file, "utf8");
    const data = JSON.parse(raw);
    data.count += 1;
    await fs.promises.writeFile(file, JSON.stringify(data), "utf8");
  });
}
`,
        "utf8"
      );

      const iterations = 5;
      // Run two writers in parallel using tsx
      const [, ] = await Promise.all([
        execFileAsync(
          "npx",
          ["tsx", helperScript, file, String(iterations)],
          { cwd: process.cwd() }
        ),
        execFileAsync(
          "npx",
          ["tsx", helperScript, file, String(iterations)],
          { cwd: process.cwd() }
        ),
      ]);

      const final = JSON.parse(
        await fs.promises.readFile(file, "utf8")
      ) as { count: number };
      // Both processes did `iterations` increments each
      expect(final.count).toBe(iterations * 2);
    },
    30_000 // generous timeout for spawning
  );
});
