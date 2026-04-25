#!/usr/bin/env node
/**
 * Thin dispatch shim — primary bin entry point (package.json "glyphling" bin).
 *
 * BUG-001 fix (DEC-016): The original single entry point src/cli.tsx imported
 * React, Ink, chokidar, and the full animation registry unconditionally at
 * module-load time, costing ~230ms even for the one-shot `statusline` path.
 *
 * This shim dispatches via dynamic import BEFORE any heavy module is loaded:
 *   - "statusline" arg → import "./statusline-entry.js" (lean: ~10ms p95)
 *   - everything else  → import "./cli.js" (full TUI, loads Ink/React/etc.)
 *
 * Because Node evaluates top-level `import` statements before any code runs,
 * we must NOT have static imports of Ink/React here. Dynamic `import()` is
 * resolved lazily — the heavy modules are never parsed for the statusline path.
 */

const cmd = process.argv[2];

if (cmd === "statusline") {
  // Fast path: load only persistence + compact renderer.
  // Ink, React, chokidar, and animations are never required.
  await import("./statusline-entry.js");
} else {
  // Full TUI path: Ink + React + chokidar + animations load here.
  await import("./cli.js");
}
