/**
 * TokenSignalSource adapter — Module #14 (architecture §2.2, §7)
 *
 * Adapter interface with two implementations: Hook-based (§7.2) and
 * Log-tail fallback (§7.3). A CompositeTokenSignalSource tries Hook first,
 * falls back to LogTail, falls back to Disabled.
 *
 * TODO: Implement concrete adapters once @researcher TODO-013 reports on
 *       Claude Code hook availability and log file paths.
 */

import type { ISO8601, LanguageId } from "../../state/schema.js";

// ---------------------------------------------------------------------------
// Types (architecture §7.1)
// ---------------------------------------------------------------------------

export interface TokenDelta {
  ts: ISO8601;
  tokens: number;
  model?: string;
  session?: string;
  lang?: LanguageId;
}

export interface AdapterHealth {
  ok: boolean;
  mode: "hook" | "logtail" | "disabled";
  detail?: string;
}

export interface TokenSignalSource {
  readonly name: string;
  start(onDelta: (delta: TokenDelta) => void): () => Promise<void>;
  health(): Promise<AdapterHealth>;
}

// ---------------------------------------------------------------------------
// Disabled adapter (always available; used as final fallback)
// ---------------------------------------------------------------------------

export class DisabledTokenSignalSource implements TokenSignalSource {
  readonly name = "disabled";

  start(_onDelta: (delta: TokenDelta) => void): () => Promise<void> {
    return async () => {
      // no-op
    };
  }

  async health(): Promise<AdapterHealth> {
    return {
      ok: true,
      mode: "disabled",
      detail: "Token signal disabled — awaiting adapter implementation (TODO-013/014).",
    };
  }
}
