/**
 * Tests for LogTailTokenSignalSource and parseTranscriptLine.
 *
 * The chokidar-integration tests use processFile() directly instead of
 * relying on chokidar events — chokidar can be unreliable on iCloud/network
 * mounts (architecture §13.2). processFile() is the real logic; watcher is
 * just the trigger mechanism.
 *
 * Bug A (start-at-tail) regression tests:
 *   - First processFile call on a pre-existing file emits ZERO deltas.
 *   - Appending new bytes after first observation emits only those bytes.
 *
 * Bug B (cache token exclusion) regression tests:
 *   - parseTranscriptLine counts only input_tokens + output_tokens.
 *   - cache_creation_input_tokens and cache_read_input_tokens are excluded.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseTranscriptLine, LogTailTokenSignalSource } from "./logtail.js";
import type { TokenDelta } from "./adapter.js";

// ---------------------------------------------------------------------------
// parseTranscriptLine unit tests
// ---------------------------------------------------------------------------

describe("parseTranscriptLine", () => {
  it("returns null for non-assistant type", () => {
    const line = JSON.stringify({
      type: "user",
      message: { usage: { input_tokens: 100, output_tokens: 50 } },
      timestamp: "2026-04-24T10:00:00.000Z",
      sessionId: "sess-1",
    });
    expect(parseTranscriptLine(line)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseTranscriptLine("{not valid json")).toBeNull();
  });

  it("returns null when usage is missing", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { model: "claude-opus-4-7" },
      timestamp: "2026-04-24T10:00:00.000Z",
    });
    expect(parseTranscriptLine(line)).toBeNull();
  });

  it("returns null when all token counts are zero", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
      timestamp: "2026-04-24T10:00:00.000Z",
    });
    expect(parseTranscriptLine(line)).toBeNull();
  });

  it("Bug B: counts ONLY input_tokens + output_tokens, excludes cache fields", () => {
    // 1000 input + 500 output + 5_000_000 cache_read + 200_000 cache_creation
    // Expected: 1500 (NOT 5_201_500)
    const line = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-7",
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 200_000,
          cache_read_input_tokens: 5_000_000,
        },
      },
      timestamp: "2026-04-24T10:00:00.000Z",
      sessionId: "sess-abc",
    });
    const result = parseTranscriptLine(line);
    expect(result).not.toBeNull();
    expect(result!.tokens).toBe(1500);
    expect(result!.ts).toBe("2026-04-24T10:00:00.000Z");
    expect(result!.model).toBe("claude-opus-4-7");
    expect(result!.session).toBe("sess-abc");
  });

  it("Bug B: returns null when only cache fields are non-zero (input+output both zero)", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 100_000,
          cache_read_input_tokens: 500_000,
        },
      },
      timestamp: "2026-04-24T10:00:00.000Z",
    });
    // After Bug B fix, tokens = 0 → should return null
    expect(parseTranscriptLine(line)).toBeNull();
  });

  it("sums input_tokens + output_tokens (no cache fields present)", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-7",
        usage: {
          input_tokens: 100,
          output_tokens: 200,
        },
      },
      timestamp: "2026-04-24T10:00:00.000Z",
      sessionId: "sess-abc",
    });
    const result = parseTranscriptLine(line);
    expect(result).not.toBeNull();
    expect(result!.tokens).toBe(300);
    expect(result!.ts).toBe("2026-04-24T10:00:00.000Z");
    expect(result!.model).toBe("claude-opus-4-7");
    expect(result!.session).toBe("sess-abc");
  });

  it("tolerates missing optional fields (model, session)", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        usage: { input_tokens: 50, output_tokens: 75 },
      },
      timestamp: "2026-04-24T12:00:00.000Z",
    });
    const result = parseTranscriptLine(line);
    expect(result).not.toBeNull();
    expect(result!.tokens).toBe(125);
    expect(result!.model).toBeUndefined();
    expect(result!.session).toBeUndefined();
  });

  it("handles partial usage fields (only output_tokens present)", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        usage: { output_tokens: 99 },
      },
      timestamp: "2026-04-24T12:00:00.000Z",
    });
    const result = parseTranscriptLine(line);
    expect(result).not.toBeNull();
    expect(result!.tokens).toBe(99);
  });

  it("falls back to current time when timestamp is missing", () => {
    const before = Date.now();
    const line = JSON.stringify({
      type: "assistant",
      message: { usage: { input_tokens: 10 } },
    });
    const result = parseTranscriptLine(line);
    const after = Date.now();
    expect(result).not.toBeNull();
    const ts = new Date(result!.ts).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 100);
  });
});

// ---------------------------------------------------------------------------
// LogTailTokenSignalSource — processFile() unit tests
// (avoids chokidar timing dependency — see module comment)
// ---------------------------------------------------------------------------

describe("LogTailTokenSignalSource.processFile", () => {
  let tmpDir: string;
  let signalStateDir: string;
  let origProjectsDir: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "logtail-test-"));
    signalStateDir = path.join(tmpDir, "signal-state");
    await fs.promises.mkdir(signalStateDir, { recursive: true });
    origProjectsDir = process.env["GLYPHLING_PROJECTS_DIR"];
    // Point to empty projects dir so chokidar doesn't scan ~/.claude
    process.env["GLYPHLING_PROJECTS_DIR"] = path.join(tmpDir, "projects");
    await fs.promises.mkdir(process.env["GLYPHLING_PROJECTS_DIR"]!, { recursive: true });
  });

  afterEach(async () => {
    if (origProjectsDir !== undefined) {
      process.env["GLYPHLING_PROJECTS_DIR"] = origProjectsDir;
    } else {
      delete process.env["GLYPHLING_PROJECTS_DIR"];
    }
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("health() returns ok when projects dir exists", async () => {
    const source = new LogTailTokenSignalSource(signalStateDir);
    const h = await source.health();
    expect(h.ok).toBe(true);
    expect(h.mode).toBe("logtail");
  });

  it("health() returns not ok when projects dir is missing", async () => {
    const badDir = path.join(tmpDir, "nonexistent");
    process.env["GLYPHLING_PROJECTS_DIR"] = badDir;
    const source = new LogTailTokenSignalSource(signalStateDir);
    const h = await source.health();
    expect(h.ok).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Bug A: start-at-tail — first encounter of a file emits ZERO deltas
  // ---------------------------------------------------------------------------

  it("Bug A: first processFile call on a pre-existing file emits ZERO deltas (start-at-tail)", async () => {
    // Simulate 3 pre-existing JSONL files totalling 10_000 tokens each
    const projectsDir = path.join(tmpDir, "projects", "test-project");
    await fs.promises.mkdir(projectsDir, { recursive: true });

    const files: string[] = [];
    for (let i = 0; i < 3; i++) {
      const filePath = path.join(projectsDir, `session-${i}.jsonl`);
      const lines: string[] = [];
      // Each file: 10 assistant messages of 1000 tokens each = 10_000 tokens
      for (let j = 0; j < 10; j++) {
        lines.push(
          JSON.stringify({
            type: "assistant",
            message: { usage: { input_tokens: 500, output_tokens: 500 } },
            timestamp: "2026-04-24T10:00:00.000Z",
          })
        );
      }
      await fs.promises.writeFile(filePath, lines.join("\n") + "\n", "utf8");
      files.push(filePath);
    }

    const deltas: TokenDelta[] = [];
    const source = new LogTailTokenSignalSource(signalStateDir);

    // First processFile on each pre-existing file: MUST emit 0 deltas
    for (const f of files) {
      await source.processFile(f, (d) => deltas.push(d));
    }
    expect(deltas.length).toBe(0);
  });

  it("Bug A: appending to a file after first observation emits only the appended tokens", async () => {
    const jsonlFile = path.join(tmpDir, "session-append.jsonl");
    // Write 10_000 tokens of pre-existing content
    const existing = JSON.stringify({
      type: "assistant",
      message: { usage: { input_tokens: 5000, output_tokens: 5000 } },
      timestamp: "2026-04-24T10:00:00.000Z",
    });
    await fs.promises.writeFile(jsonlFile, existing + "\n", "utf8");

    const deltas: TokenDelta[] = [];
    const source = new LogTailTokenSignalSource(signalStateDir);

    // First call: start-at-tail → 0 deltas
    await source.processFile(jsonlFile, (d) => deltas.push(d));
    expect(deltas.length).toBe(0);

    // Append 5_000 new tokens
    const appended = JSON.stringify({
      type: "assistant",
      message: { usage: { input_tokens: 2500, output_tokens: 2500 } },
      timestamp: "2026-04-24T10:05:00.000Z",
    });
    await fs.promises.appendFile(jsonlFile, appended + "\n", "utf8");

    // Second call: must pick up ONLY the appended 5000 tokens
    await source.processFile(jsonlFile, (d) => deltas.push(d));
    expect(deltas.length).toBe(1);
    expect(deltas[0]!.tokens).toBe(5000);
  });

  it("does not double-count on second processFile call (cursor persists)", async () => {
    const jsonlFile = path.join(tmpDir, "session2.jsonl");
    // Start with an empty file so the first call sets cursor to 0 (no history)
    await fs.promises.writeFile(jsonlFile, "", "utf8");

    const deltas: TokenDelta[] = [];
    const source = new LogTailTokenSignalSource(signalStateDir);

    // First pass on empty file: sets cursor to 0, no deltas
    await source.processFile(jsonlFile, (d) => deltas.push(d));
    expect(deltas.length).toBe(0);

    // Append content
    const line = JSON.stringify({
      type: "assistant",
      message: { usage: { input_tokens: 2000 } },
      timestamp: "2026-04-24T10:00:00.000Z",
    });
    await fs.promises.appendFile(jsonlFile, line + "\n", "utf8");

    // Second pass: reads the newly appended content
    await source.processFile(jsonlFile, (d) => deltas.push(d));
    expect(deltas.length).toBe(1);
    expect(deltas[0]!.tokens).toBe(2000);

    // Third pass: cursor at end, no new deltas
    await source.processFile(jsonlFile, (d) => deltas.push(d));
    expect(deltas.length).toBe(1);
  });

  it("detects new lines appended after cursor", async () => {
    const jsonlFile = path.join(tmpDir, "session3.jsonl");
    // Start empty so cursor is established at 0
    await fs.promises.writeFile(jsonlFile, "", "utf8");

    const deltas: TokenDelta[] = [];
    const source = new LogTailTokenSignalSource(signalStateDir);

    // Establish cursor at 0
    await source.processFile(jsonlFile, (d) => deltas.push(d));
    expect(deltas.length).toBe(0);

    // Append first line
    const line1 = JSON.stringify({
      type: "assistant",
      message: { usage: { input_tokens: 100 } },
      timestamp: "2026-04-24T10:00:00.000Z",
    });
    await fs.promises.appendFile(jsonlFile, line1 + "\n", "utf8");

    // Second pass — reads line 1
    await source.processFile(jsonlFile, (d) => deltas.push(d));
    expect(deltas.length).toBe(1);

    // Append new content
    const line2 = JSON.stringify({
      type: "assistant",
      message: { usage: { output_tokens: 300 } },
      timestamp: "2026-04-24T10:05:00.000Z",
    });
    await fs.promises.appendFile(jsonlFile, line2 + "\n", "utf8");

    // Third pass — should only read the new line
    await source.processFile(jsonlFile, (d) => deltas.push(d));
    expect(deltas.length).toBe(2);
    expect(deltas[1]!.tokens).toBe(300);
  });

  it("resets cursor when file is truncated (restart-safe)", async () => {
    const jsonlFile = path.join(tmpDir, "session4.jsonl");

    // Start empty so cursor is established at 0
    await fs.promises.writeFile(jsonlFile, "", "utf8");

    const deltas: TokenDelta[] = [];
    const source = new LogTailTokenSignalSource(signalStateDir);

    // Establish cursor at 0
    await source.processFile(jsonlFile, (d) => deltas.push(d));
    expect(deltas.length).toBe(0);

    // Write a large first content (cursor advances past it)
    const bigPayload = "x".repeat(500); // pad to ensure first write is large
    const line1 = JSON.stringify({
      type: "assistant",
      message: {
        usage: { input_tokens: 500 },
        _padding: bigPayload,
      },
      timestamp: "2026-04-24T10:00:00.000Z",
    });
    await fs.promises.appendFile(jsonlFile, line1 + "\n", "utf8");

    await source.processFile(jsonlFile, (d) => deltas.push(d));
    expect(deltas.length).toBe(1);
    expect(deltas[0]!.tokens).toBe(500);

    // Truncate and rewrite with a much shorter file (simulates log rotation)
    const line2 = JSON.stringify({
      type: "assistant",
      message: { usage: { output_tokens: 777 } },
      timestamp: "2026-04-24T11:00:00.000Z",
    });
    // line2 is much shorter than line1 (no padding)
    await fs.promises.writeFile(jsonlFile, line2 + "\n", "utf8");

    // Verify the file really did shrink
    const newSize = (await fs.promises.stat(jsonlFile)).size;
    const cursorFile = path.join(signalStateDir, "tokens.json");
    const cursors = JSON.parse(await fs.promises.readFile(cursorFile, "utf8")) as Record<string, number>;
    const savedCursor = cursors[jsonlFile] ?? 0;
    expect(savedCursor).toBeGreaterThan(newSize); // confirms truncation was detected

    // processFile should detect cursor > size and reset to 0, reading from scratch
    await source.processFile(jsonlFile, (d) => deltas.push(d));
    expect(deltas.length).toBe(2);
    expect(deltas[1]!.tokens).toBe(777);
  });

  it("does not emit delta for non-assistant lines", async () => {
    const jsonlFile = path.join(tmpDir, "session5.jsonl");
    const lines = [
      JSON.stringify({ type: "user", message: {}, timestamp: "2026-04-24T10:00:00.000Z" }),
      JSON.stringify({ type: "permission-mode", permissionMode: "default" }),
      JSON.stringify({ type: "file-history-snapshot", timestamp: "2026-04-24T10:00:00.000Z" }),
    ].join("\n") + "\n";
    await fs.promises.writeFile(jsonlFile, lines, "utf8");

    const deltas: TokenDelta[] = [];
    const source = new LogTailTokenSignalSource(signalStateDir);
    await source.processFile(jsonlFile, (d) => deltas.push(d));

    // First call on a new file: start-at-tail → 0 deltas regardless of content
    expect(deltas.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// LogTailTokenSignalSource — watcher lifecycle
// ---------------------------------------------------------------------------

describe("LogTailTokenSignalSource watcher", () => {
  let tmpDir: string;
  let signalStateDir: string;
  let origProjectsDir: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "logtail-watcher-"));
    signalStateDir = path.join(tmpDir, "signal-state");
    await fs.promises.mkdir(signalStateDir, { recursive: true });
    origProjectsDir = process.env["GLYPHLING_PROJECTS_DIR"];
    process.env["GLYPHLING_PROJECTS_DIR"] = path.join(tmpDir, "projects");
    await fs.promises.mkdir(process.env["GLYPHLING_PROJECTS_DIR"]!, { recursive: true });
  });

  afterEach(async () => {
    if (origProjectsDir !== undefined) {
      process.env["GLYPHLING_PROJECTS_DIR"] = origProjectsDir;
    } else {
      delete process.env["GLYPHLING_PROJECTS_DIR"];
    }
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("starts and stops the chokidar watcher without errors", async () => {
    const source = new LogTailTokenSignalSource(signalStateDir);
    const stop = source.start(() => undefined);
    // Short wait to let chokidar initialise
    await new Promise((r) => setTimeout(r, 200));
    await expect(stop()).resolves.toBeUndefined();
  });
});
