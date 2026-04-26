/**
 * CLI dispatch tests — focused on argv flags that should run with zero
 * side effects (no state resolution, no Ink boot).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { main, readPackageVersion } from "./cli.js";

describe("readPackageVersion", () => {
  it("resolves the real package.json version (semver shape)", () => {
    const v = readPackageVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
    expect(v).not.toBe("unknown");
  });
});

describe("glyphling --version", () => {
  let writes: string[];
  const originalWrite = process.stdout.write.bind(process.stdout);

  beforeEach(() => {
    writes = [];
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it("prints `glyphling <version>` and exits 0", async () => {
    const code = await main(["--version"]);
    expect(code).toBe(0);
    expect(writes.join("")).toMatch(/^glyphling \d+\.\d+\.\d+/);
  });

  it("accepts -V as a short flag", async () => {
    const code = await main(["-V"]);
    expect(code).toBe(0);
    expect(writes.join("")).toMatch(/^glyphling \d+\.\d+\.\d+/);
  });
});
