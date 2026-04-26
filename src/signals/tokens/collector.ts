/**
 * Token signal collector (architecture §6.3)
 *
 * Consumes a TokenSignalSource, accumulates deltas across all sessions, and
 * emits a `tokens.delta` GlyphlingEvent when either:
 *   (a) accumulated tokens ≥ EMIT_TOKEN_THRESHOLD (5000), OR
 *   (b) EMIT_INTERVAL_MS (60s) have elapsed since the last emit AND
 *       accumulated > 0
 *
 * XP formula (DEC-020, engine.ts): floor(tokens / 1000) → 1 XP per 1000 tokens.
 *
 * DEC-020: No daily caps. The collector computes xpDelta; the XPEngine applies it
 * in full when folding the event into state.
 *
 * The collector holds no lockfile of its own. It delegates all persistence
 * to appendEvent() from src/state/persistence.ts, which holds the state lock
 * internally. This satisfies DEC-018 (all mutations via appendEvent).
 *
 * SINGLE-FLIGHT EMIT (TODO-033)
 * ──────────────────────────────
 * At most one appendEvent is in-flight at any time. Subsequent maybeEmit calls
 * that arrive during the flight fold their tokens into `pendingDelta`; a trailing
 * emit picks them up when the in-flight call settles. This prevents lock-contention
 * races (multiple concurrent appendEvent calls from a chokidar burst) while
 * guaranteeing no tokens are dropped.
 *
 * CURSOR SAFETY (TODO-033)
 * ─────────────────────────
 * - LockTimeoutError from appendEvent is retried with exponential backoff
 *   (up to MAX_EMIT_RETRIES attempts). Lock contention during chokidar startup
 *   bursts is transient; generous retries absorb it.
 * - Hard errors (non-LockTimeoutError) cause the accumulated tokens to be
 *   re-added to `this.accumulated` so the next emit attempt picks them up.
 *   The caller receives a rejected promise so it knows NOT to advance its cursor.
 *
 * RETURN VALUE OF maybeEmit
 * ─────────────────────────
 *   "persisted" — appendEvent completed; cursor may advance.
 *   "deferred"  — another emit is already in-flight; tokens folded into
 *                 pendingDelta and will be flushed by the trailing emit.
 *                 Cursor is safe to advance (tokens are accounted for).
 *   rejects     — hard error; cursor must NOT advance (tokens re-accumulated).
 */

import { ulid } from "ulid";
import type { TokenSignalSource, TokenDelta } from "./adapter.js";
import type { Config } from "../../config/env.js";
import { appendEvent } from "../../state/persistence.js";
import { LockTimeoutError } from "../../state/lockfile.js";
import { xpForTokens, makeXpFold } from "../../xp/engine.js";
import type { GlyphlingEvent, StateFileV1 } from "../../state/schema.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Emit a tokens.delta event after this many accumulated tokens (architecture §6.3). */
export const EMIT_TOKEN_THRESHOLD = 5_000;

/** Also emit if this many ms have elapsed since the last emit (architecture §6.3). */
export const EMIT_INTERVAL_MS = 60_000;

/**
 * Maximum retries on LockTimeoutError before giving up and re-accumulating.
 * Retries use exponential backoff starting at RETRY_BASE_MS, doubling each
 * attempt up to RETRY_MAX_MS. Total wall-clock for 10 retries with 50ms base
 * and 500ms cap: 50+100+200+400+500+500+500+500+500+500 = 3750ms.
 */
export const MAX_EMIT_RETRIES = 10;

/** Base delay (ms) for the first retry backoff step. */
const RETRY_BASE_MS = 50;

/** Maximum per-attempt backoff (ms) — caps the exponential growth. */
const RETRY_MAX_MS = 500;

// ---------------------------------------------------------------------------
// TokenCollector
// ---------------------------------------------------------------------------

export type EmitResult = "persisted" | "deferred";

export class TokenCollector {
  private accumulated = 0;
  private lastEmitAt = 0; // ms since epoch
  private petId: string | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private stopSource: (() => Promise<void>) | null = null;

  // Single-flight state (TODO-033)
  private inFlight: Promise<EmitResult> | null = null;
  private pendingDelta = 0;

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
      // Drain: wait for any in-flight emit (and any trailing emits it triggers)
      // to settle before flushing the final accumulator.
      // The loop handles the trailing-emit case: the .then() callback that
      // follows an in-flight emit may synchronously start a new inFlight; we
      // drain those too before declaring the queue empty.
      while (this.inFlight !== null) {
        await this.inFlight.catch(() => undefined);
      }
      // Any remaining accumulated tokens (below threshold, not yet emitted)
      // are flushed now as a final drain. The drain is best-effort — if it
      // fails (LockTimeoutError after retry exhaustion, or hard error), the
      // tokens stay in `accumulated` and will be picked up on the next
      // session. Don't let a drain failure crash the stop() call.
      if (this.accumulated > 0 || this.pendingDelta > 0) {
        this.accumulated += this.pendingDelta;
        this.pendingDelta = 0;
        await this.doEmit().catch((err: unknown) => {
          process.stderr.write(
            `[glyphling/collector] drain failed during stop(); ` +
              `${this.accumulated} tokens deferred to next session: ` +
              `${err instanceof Error ? err.message : String(err)}\n`
          );
        });
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

  /**
   * Decide whether to emit now, and if so, enforce single-flight.
   *
   * Returns:
   *   "persisted" — appendEvent completed.
   *   "deferred"  — folded into in-flight emit's trailing accumulator.
   *   rejects     — hard error (non-LockTimeoutError); tokens re-accumulated.
   */
  async maybeEmit(timeTriggered: boolean): Promise<EmitResult> {
    const overThreshold = this.accumulated >= EMIT_TOKEN_THRESHOLD;
    const timePassed = Date.now() - this.lastEmitAt >= EMIT_INTERVAL_MS;

    // Nothing to emit yet
    if (!(overThreshold || (timeTriggered && timePassed && this.accumulated > 0))) {
      return "deferred";
    }

    // Another emit is already in-flight — fold current accumulated into pendingDelta
    // so it gets picked up by the trailing emit when the in-flight one settles.
    if (this.inFlight !== null) {
      this.pendingDelta += this.accumulated;
      this.accumulated = 0;
      return "deferred";
    }

    // Start a new in-flight emit.
    const flight = this.doEmit().then(
      () => {
        this.inFlight = null;
        // Trailing emit: if tokens arrived while we were in-flight, flush them.
        if (this.pendingDelta > 0 || this.accumulated >= EMIT_TOKEN_THRESHOLD) {
          this.accumulated += this.pendingDelta;
          this.pendingDelta = 0;
          void this.maybeEmit(false);
        }
        return "persisted" as const;
      },
      (err: unknown) => {
        this.inFlight = null;
        // Re-absorb any pending delta that wasn't yet flushed
        this.accumulated += this.pendingDelta;
        this.pendingDelta = 0;
        throw err;
      }
    );
    // Observe the rejection eagerly so Node/vitest don't see an unhandled
    // rejection if the caller doesn't await (most callers use `void
    // maybeEmit(...)` fire-and-forget). The original `flight` still rejects
    // for callers that DO await — they get their own catch.
    flight.catch(() => undefined);
    this.inFlight = flight;

    return this.inFlight;
  }

  /**
   * Attempt the actual appendEvent with retry on LockTimeoutError.
   * On hard error (non-LockTimeoutError): re-accumulates tokens and rethrows.
   */
  private async doEmit(): Promise<void> {
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

    let attempt = 0;
    while (true) {
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
        return; // success
      } catch (err) {
        if (err instanceof LockTimeoutError && attempt < MAX_EMIT_RETRIES) {
          // Transient lock contention — retry with capped exponential backoff.
          attempt += 1;
          const delayMs = Math.min(
            RETRY_BASE_MS * Math.pow(2, attempt - 1),
            RETRY_MAX_MS
          );
          process.stderr.write(
            `[glyphling/collector] LockTimeoutError on attempt ${attempt}/${MAX_EMIT_RETRIES}; ` +
              `retrying in ${delayMs}ms\n`
          );
          await sleep(delayMs);
          continue;
        }

        // Hard error or retries exhausted: re-accumulate tokens so the next emit
        // picks them up. Log to stderr so the caller can see what happened.
        process.stderr.write(
          `[glyphling/collector] Failed to append tokens.delta event: ${String(err)}\n`
        );
        this.accumulated += tokensToReport;
        throw err;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
