/**
 * Tests for LogTailTokenSignalSource and parseTranscriptLine.
 *
 * The chokidar-integration tests use processFile() directly instead of
 * relying on chokidar events — chokidar can be unreliable on iCloud/network
 * mounts (architecture §13.2). processFile() is the real logic; watcher is
 * just the trigger mechanism.
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

  it("sums all four token fields", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-7",
        usage: {
          input_tokens: 100,
          output_tokens: 200,
          cache_creation_input_tokens: 300,
          cache_read_input_tokens: 400,
        },
      },
      timestamp: "2026-04-24T10:00:00.000Z",
      sessionId: "sess-abc",
    });
    const result = parseTranscriptLine(line);
    expect(result).not.toBeNull();
    expect(result!.tokens).toBe(1000);
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

  it("processFile emits a delta for a JSONL file with token data", async () => {
    const jsonlFile = path.join(tmpDir, "session.jsonl");
    const line = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-7",
        usage: { input_tokens: 1000, output_tokens: 500 },
      },
      timestamp: "2026-04-24T10:00:00.000Z",
      sessionId: "sess-abc",
    });
    await fs.promises.writeFile(jsonlFile, line + "\n", "utf8");

    const deltas: TokenDelta[] = [];
    const source = new LogTailTokenSignalSource(signalStateDir);
    await source.processFile(jsonlFile, (d) => deltas.push(d));

    expect(deltas.length).toBe(1);
    expect(deltas[0]!.tokens).toBe(1500);
    expect(deltas[0]!.session).toBe("sess-abc");
  });

  it("does not double-count on second processFile call (cursor persists)", async () => {
    const jsonlFile = path.join(tmpDir, "session2.jsonl");
    const line = JSON.stringify({
      type: "assistant",
      message: { usage: { input_tokens: 2000 } },
      timestamp: "2026-04-24T10:00:00.000Z",
    });
    await fs.promises.writeFile(jsonlFile, line + "\n", "utf8");

    const deltas: TokenDelta[] = [];
    const source = new LogTailTokenSignalSource(signalStateDir);

    // First pass
    await source.processFile(jsonlFile, (d) => deltas.push(d));
    expect(deltas.length).toBe(1);
    expect(deltas[0]!.tokens).toBe(2000);

    // Second pass — cursor should be at end, no new deltas
    await source.processFile(jsonlFile, (d) => deltas.push(d));
    expect(deltas.length).toBe(1); // still just 1 — no double-count
  });

  it("detects new lines appended after cursor", async () => {
    const jsonlFile = path.join(tmpDir, "session3.jsonl");
    const line1 = JSON.stringify({
      type: "assistant",
      message: { usage: { input_tokens: 100 } },
      timestamp: "2026-04-24T10:00:00.000Z",
    });
    await fs.promises.writeFile(jsonlFile, line1 + "\n", "utf8");

    const deltas: TokenDelta[] = [];
    const source = new LogTailTokenSignalSource(signalStateDir);

    // First pass — reads line 1
    await source.processFile(jsonlFile, (d) => deltas.push(d));
    expect(deltas.length).toBe(1);

    // Append new content
    const line2 = JSON.stringify({
      type: "assistant",
      message: { usage: { output_tokens: 300 } },
      timestamp: "2026-04-24T10:05:00.000Z",
    });
    await fs.promises.appendFile(jsonlFile, line2 + "\n", "utf8");

    // Second pass — should only read the new line
    await source.processFile(jsonlFile, (d) => deltas.push(d));
    expect(deltas.length).toBe(2);
    expect(deltas[1]!.tokens).toBe(300);
  });

  it("resets cursor when file is truncated (restart-safe)", async () => {
    const jsonlFile = path.join(tmpDir, "session4.jsonl");

    // First content — make it long enough that the second write is definitely shorter
    const bigPayload = "x".repeat(500); // pad to ensure first write is large
    const line1 =
      JSON.stringify({
        type: "assistant",
        message: {
          usage: { input_tokens: 500 },
          // add padding to make this file larger than the replacement
          _padding: bigPayload,
        },
        timestamp: "2026-04-24T10:00:00.000Z",
      });
    await fs.promises.writeFile(jsonlFile, line1 + "\n", "utf8");

    const deltas: TokenDelta[] = [];
    const source = new LogTailTokenSignalSource(signalStateDir);
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
