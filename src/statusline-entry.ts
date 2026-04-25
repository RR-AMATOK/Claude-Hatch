/**
 * Lean statusline entry point — no Ink, no React, no chokidar, no animations.
 *
 * This module is the compiled target for the `glyphling statusline` command path.
 * It imports only three lean modules:
 *   - config/env     (path resolution, no heavy deps)
 *   - state/persistence  (fs + JSON + zod validate — no chokidar at module load)
 *   - render/statusline  (pure data lookup + ANSI SGR string building)
 *
 * Target cold-start budget: <50ms p95 compiled (DEC-016 / TODO-015).
 *
 * The module is loaded via dynamic import from src/bin.ts so that Node does
 * NOT require it during the full TUI path (which uses cli.tsx → React/Ink).
 */

import { resolveStateHome } from "./config/env.js";
import { renderOnce } from "./render/statusline.js";

async function main(): Promise<void> {
  let config;
  try {
    config = resolveStateHome();
  } catch (err) {
    // DEC-008 guard or misconfiguration — degrade gracefully (exit 0 keeps
    // Claude Code's statusLine blank rather than crashing with a red banner).
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[glyphling] ${msg}\n`);
    process.exit(0);
  }

  const code = await renderOnce(config);
  process.exit(code);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[glyphling] statusline error: ${msg}\n`);
  process.exit(0); // exit 0 so Claude Code shows blank, not an error
});
