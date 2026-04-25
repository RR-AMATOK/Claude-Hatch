/**
 * Token signal collector (architecture §6.3)
 *
 * Consumes a TokenSignalSource, accumulates deltas across all sessions, and
 * emits a `tokens.delta` GlyphlingEvent when either:
 *   (a) accumulated tokens ≥ EMIT_TOKEN_THRESHOLD (5000), OR
 *   (b) EMIT_INTERVAL_MS (60s) have elapsed since the last emit AND
 *       accumulated > 0
 *
 * XP formula (architecture §6.3, engine.ts): floor(tokens / 500) → 1 XP per 500 tokens.
 *
 * Daily cap: DAILY_CAP_TOKENS = 6000 XP/day from tokens.delta events.
 * Cap enforcement is performed by applyEvent() in xp/engine.ts via the fold
 * function passed to appendEvent(). The collector itself does NOT enforce the
 * cap — it only computes xpDelta; the XPEngine applies the cap when folding
 * the event into state.
 *
 * The collector holds no lockfile of its own. It delegates all persistence
 * to appendEvent() from src/state/persistence.ts, which holds the state lock
 * internally. This satisfies DEC-018 (all mutations via appendEvent).
 */

import { ulid } from "ulid";
import type { TokenSignalSource, TokenDelta } from "./adapter.js";
import type { Config } from "../../config/env.js";
import { appendEvent } from "../../state/persistence.js";
import { xpForTokens, makeXpFold } from "../../xp/engine.js";
import type { GlyphlingEvent, StateFileV1 } from "../../state/schema.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Emit a tokens.delta event after this many accumulated tokens (architecture §6.3). */
export const EMIT_TOKEN_THRESHOLD = 5_000;

/** Also emit if this many ms have elapsed since the last emit (architecture §6.3). */
export const EMIT_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// TokenCollector
// ---------------------------------------------------------------------------

export class TokenCollector {
  private accumulated = 0;
  private lastEmitAt = 0; // ms since epoch
  private petId: string | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private stopSource: (() => Promise<void>) | null = null;

  constructor(
    private readonly source: TokenSignalSource,
    private readonly config: Config
  ) {}

  /**
   * Start collecting. Returns an async stop function that drains any
   * accumulated tokens, stops the source, and clears the flush timer.
   */
  start(petId: string | null): () => Promise<void> {
    this.petId = petId;
    this.lastEmitAt = Date.now();

    // Subscribe to the source
    this.stopSource = this.source.start((delta: TokenDelta) => {
      this.onDelta(delta);
    });

    // Periodic flush timer — emits on the 60s boundary even if under threshold.
    // Kept ref'd so it holds the event loop open even when the chokidar watcher
    // does not (observed on macOS + iCloud Drive paths: chokidar's `persistent`
    // flag fails to keep Node alive, so without this ref the daemon exits
    // silently seconds after "Token collector started").
    this.flushTimer = setInterval(() => {
      void this.maybeEmit(true /* timeTriggered */);
    }, EMIT_INTERVAL_MS);

    return async () => {
      // Stop the flush timer
      if (this.flushTimer !== null) {
        clearInterval(this.flushTimer);
        this.flushTimer = null;
      }
      // Flush any remaining accumulated tokens before stopping
      if (this.accumulated > 0) {
        await this.emit();
      }
      // Stop the underlying source
      if (this.stopSource !== null) {
        await this.stopSource();
        this.stopSource = null;
      }
    };
  }

  /** Update the active pet ID (e.g. after state change). */
  updatePetId(petId: string | null): void {
    this.petId = petId;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private onDelta(delta: TokenDelta): void {
    this.accumulated += delta.tokens;
    void this.maybeEmit(false);
  }

  private async maybeEmit(timeTriggered: boolean): Promise<void> {
    const overThreshold = this.accumulated >= EMIT_TOKEN_THRESHOLD;
    const timePassed = Date.now() - this.lastEmitAt >= EMIT_INTERVAL_MS;

    // Emit if: over threshold OR (time-triggered AND any tokens since last emit)
    if (overThreshold || (timeTriggered && timePassed && this.accumulated > 0)) {
      await this.emit();
    }
  }

  private async emit(): Promise<void> {
    if (this.accumulated <= 0) return;

    const tokensToReport = this.accumulated;
    this.accumulated = 0;
    this.lastEmitAt = Date.now();

    const xpDelta = xpForTokens(tokensToReport);
    if (xpDelta <= 0) {
      // Below the minimum for any XP — don't create an event; re-add tokens
      // so they accumulate towards the next threshold.
      this.accumulated += tokensToReport;
      return;
    }

    const event: GlyphlingEvent = {
      id: ulid(),
      type: "tokens.delta",
      ts: new Date().toISOString(),
      petId: this.petId,
      source: "logtail",
      payload: {
        tokens: tokensToReport,
      },
      xpDelta,
      prevHash: "", // Set by appendEvent() — do not pre-fill
    };

    try {
      // makeXpFold() returns a function typed with GlyphlingEvent from events/bus.ts
      // (where prevHash is optional), but appendEvent expects a fold typed with
      // GlyphlingEvent from state/schema.ts (where prevHash is required).
      // We wrap it with an explicit schema-typed signature. The engine function
      // accepts the schema event because the required prevHash is a superset of the
      // optional one at the value level.
      let fold: ((s: StateFileV1, e: GlyphlingEvent) => StateFileV1) | undefined;
      if (this.petId !== null) {
        const innerFold = makeXpFold();
        fold = (s: StateFileV1, e: GlyphlingEvent) =>
          innerFold(s, e as Parameters<typeof innerFold>[1]);
      }
      await appendEvent(this.config, event, fold);
    } catch (err) {
      process.stderr.write(
        `[glyphling/collector] Failed to append tokens.delta event: ${String(err)}\n`
      );
      // Re-accumulate the tokens so we don't lose them permanently
      this.accumulated += tokensToReport;
    }
  }
}
