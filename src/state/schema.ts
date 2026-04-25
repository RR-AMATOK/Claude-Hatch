/**
 * Schema & invariants — Module #4 (architecture §2.2)
 *
 * TypeScript interfaces for StateFileV1 as defined in architecture §3.1.
 * Runtime validation uses Zod (not specified in §3 but §3.1 directs schema
 * validation on every read+write; Zod gives us parse-time type narrowing and
 * actionable error messages with minimal boilerplate — chosen over hand-rolled
 * validators for maintainability as the schema grows).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitive aliases (TypeScript-only; keep for downstream use as annotations)
// ---------------------------------------------------------------------------

export type ISO8601 = string;
export type PetId = string;
export type EggType = "circuit" | "rune" | "shard" | "bloom";
export type PersonalityTrait =
  | "Stoic"
  | "Friendly"
  | "Pragmatic"
  | "Energetic"
  | "Gruff"
  | "Philosophical"
  | "Paranoid"
  | "Curious";
export type LanguageId = string;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ISO8601Schema = z
  .string()
  .min(1)
  .refine((s) => Number.isFinite(Date.parse(s)), {
    message: "invalid ISO8601 timestamp",
  });
const PetIdSchema = z.string().min(1);

const EggTypeSchema = z.enum(["circuit", "rune", "shard", "bloom"]);

const PersonalityTraitSchema = z.enum([
  "Stoic",
  "Friendly",
  "Pragmatic",
  "Energetic",
  "Gruff",
  "Philosophical",
  "Paranoid",
  "Curious",
]);

export const PauseIntervalSchema = z.object({
  pausedAt: ISO8601Schema,
  resumedAt: ISO8601Schema.nullable(),
  reason: z.string().optional(),
});

export const PersonalityVectorSchema = z
  .object({
    dominant: PersonalityTraitSchema,
    weights: z.record(PersonalityTraitSchema, z.number().min(0).max(1)),
    lockedAt: ISO8601Schema,
    lastRefreshAt: ISO8601Schema,
  })
  .refine(
    (v) => {
      const sum = Object.values(v.weights).reduce((a, b) => a + b, 0);
      return Math.abs(sum - 1.0) < 1e-6;
    },
    { message: "personality.weights must sum to 1.0 ± 1e-6" }
  )
  .refine(
    (v) => {
      const argmax = (
        Object.entries(v.weights) as [PersonalityTrait, number][]
      ).reduce(
        (best, [t, w]) => (w > best[1] ? [t, w] : best),
        ["" as PersonalityTrait, -Infinity]
      )[0];
      return argmax === v.dominant;
    },
    { message: "personality.dominant must equal argmax(weights)" }
  );

export const TombstoneSchema = z.object({
  diedAt: ISO8601Schema,
  cause: z.enum(["neglect", "unknown"]),
  finalLevel: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER / 2),
  finalXp: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER / 2),
  epitaph: z.string().max(256).optional(),
});

/**
 * Signal type strings used in DEC-018 daily-cap tracking.
 * Must match the XP-bearing signal event types.
 */
export const SignalTypeSchema = z.enum([
  "tokens",
  "tests",
  "commits",
  "edits",
]);

export type SignalType = z.infer<typeof SignalTypeSchema>;

/**
 * Per-day XP accumulation for DEC-018 daily caps.
 * Key: YYYY-MM-DD (UTC). Value: { signal → XP accumulated that day }.
 * Pruned to the last 7 days on each tick.
 */
export const DailyCapsSchema = z
  .record(
    z.string(),
    z.record(SignalTypeSchema, z.number().int().min(0).max(Number.MAX_SAFE_INTEGER / 2))
  )
  .refine((obj) => Object.keys(obj).length <= 64, {
    message: "dailyCaps must not exceed 64 day entries",
  });

export type DailyCaps = z.infer<typeof DailyCapsSchema>;

export const PetSchema = z
  .object({
    id: PetIdSchema,
    schemaVersion: z.literal(1),
    eggType: EggTypeSchema,
    name: z.string().max(64).nullable(),
    createdAt: ISO8601Schema,
    hatchedAt: ISO8601Schema.nullable(),
    lastFedAt: ISO8601Schema.nullable(),
    lastInteractionAt: ISO8601Schema,
    xp: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER / 2),
    level: z.number().int().min(0).max(1024),
    personality: PersonalityVectorSchema,
    pauseIntervals: z.array(PauseIntervalSchema).max(1000),
    /** DEC-009: accumulated computer-awake seconds since last interaction. */
    accumulatedNeglectSeconds: z.number().min(0).max(Number.MAX_SAFE_INTEGER / 2),
    /** DEC-009: timestamp of last 60s lifecycle tick. */
    lastTickAt: ISO8601Schema,
    diedAt: ISO8601Schema.nullable(),
    tombstone: TombstoneSchema.nullable(),
    languageExposure: z
      .record(z.string(), z.number().min(0).max(Number.MAX_SAFE_INTEGER / 2))
      .refine((obj) => Object.keys(obj).length <= 64, {
        message: "languageExposure must not exceed 64 keys",
      }),
    /** DEC-018: per-day XP accumulation for daily caps. Pruned to last 7 days. */
    dailyCaps: DailyCapsSchema.default({}),
  })
  .refine(
    (p) => {
      // diedAt and tombstone must be either both null or both non-null
      return (p.diedAt === null) === (p.tombstone === null);
    },
    { message: "Pet.diedAt and Pet.tombstone must both be null or both set" }
  )
  .refine(
    (p) => {
      // Only the last pauseInterval may have resumedAt == null
      const intervals = p.pauseIntervals;
      for (let i = 0; i < intervals.length - 1; i++) {
        if (intervals[i]!.resumedAt === null) return false;
      }
      return true;
    },
    {
      message:
        "Only the last PauseInterval may have resumedAt == null (still paused)",
    }
  );

export const UnlockFlagsSchema = z.object({
  gifTier1: z.boolean(),
  gifTier2: z.boolean(),
  gifTier3: z.boolean(),
  adoption: z.boolean(),
});

export const GlobalsSchema = z.object({
  activePetId: PetIdSchema.nullable(),
  unlocks: UnlockFlagsSchema,
  eventsCursor: z.number().int().min(0),
  /**
   * DEC-018: SHA-256 hex digest of the last appended event's canonical JSON.
   * Empty string at genesis (no events yet).
   */
  eventsHead: z.string().default(""),
  /**
   * DEC-018: Unix ms timestamp of the last appended event.
   * Used for monotonic clock guards. 0 at genesis.
   */
  lastEventAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER / 2).default(0),
});

export const StateFileV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    createdAt: ISO8601Schema,
    updatedAt: ISO8601Schema,
    pets: z.array(PetSchema).max(4),
    globals: GlobalsSchema,
  })
  .refine(
    (s) => {
      // eventsCursor is monotonically non-decreasing — enforced at write time,
      // but we validate it is a non-negative integer here.
      return s.globals.eventsCursor >= 0;
    },
    { message: "globals.eventsCursor must be >= 0" }
  );

// ---------------------------------------------------------------------------
// TypeScript interfaces (inferred from Zod schemas for single-source-of-truth)
// ---------------------------------------------------------------------------

export type PauseInterval = z.infer<typeof PauseIntervalSchema>;
export type PersonalityVector = z.infer<typeof PersonalityVectorSchema>;
export type Tombstone = z.infer<typeof TombstoneSchema>;
export type Pet = z.infer<typeof PetSchema>;
export type UnlockFlags = z.infer<typeof UnlockFlagsSchema>;
export type Globals = z.infer<typeof GlobalsSchema>;
export type StateFileV1 = z.infer<typeof StateFileV1Schema>;

// ---------------------------------------------------------------------------
// Event model (architecture §6.2)
// ---------------------------------------------------------------------------

export const EventTypeSchema = z.enum([
  // Signal events (§6.2)
  "tokens.delta",
  "git.commit",
  "test.pass",
  "file.edit",
  "error.fixed",
  "daily.checkin",
  "pet.fed",
  "pet.played",
  "pet.paused",
  "pet.resumed",
  "level.up",
  "personality.refresh",
  // Unlock events (emitted by XPEngine side effects)
  "unlock.gif.tier1",
  "unlock.gif.tier2",
  "unlock.gif.tier3",
  "unlock.adoption",
  // Lifecycle health/death events (emitted by LifecycleClock)
  "pet.hungry",
  "pet.sick",
  "pet.dying",
  "pet.died",
  // Adoption events (emitted by AdoptionManager)
  "pet.adopted",
  // Export events (emitted by GIFExporter — TODO-008)
  "export.started",
  "export.completed",
  "export.failed",
  // Integrity events (emitted by persistence / XP engine — DEC-018)
  "signal.rejected",
]);

export type EventType = z.infer<typeof EventTypeSchema>;

export const GlyphlingEventSchema = z.object({
  id: z.string().min(1),
  type: EventTypeSchema,
  ts: ISO8601Schema,
  petId: PetIdSchema.nullable(),
  source: z.string(),
  payload: z
    .unknown()
    .refine((v) => JSON.stringify(v).length <= 16384, {
      message: "payload exceeds 16KB",
    }),
  xpDelta: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER / 2).optional(),
  lang: z.string().optional(),
  /**
   * DEC-018: SHA-256 hex digest of the previous event's canonical JSON.
   * Empty string for the genesis event (no prior event).
   * Required — not defaulted so that missing-prevHash events are caught explicitly.
   */
  prevHash: z.string(),
  /**
   * DEC-018 Mechanism 2: hash of the matching Claude Code transcript JSONL line.
   * Only present on `tokens.delta` events when produced by the Stop hook adapter.
   * sha256(trimmedLineBytes). Optional — absent on legacy / non-hook events.
   */
  transcriptLineHash: z.string().optional(),
});

export type GlyphlingEvent = z.infer<typeof GlyphlingEventSchema>;

// ---------------------------------------------------------------------------
// signal.rejected payload (DEC-018)
// ---------------------------------------------------------------------------

/** Reason codes for signal.rejected events (DEC-018). */
export const RejectionReasonSchema = z.enum([
  "chain.broken",
  "chain.broken.missing-prev",
  "cap.daily",
  "clock.jump.forward",
  "clock.jump.backward",
  "transcript.missing",
]);

export type RejectionReason = z.infer<typeof RejectionReasonSchema>;

/**
 * Signal type strings used in signal.rejected payloads.
 * These map to the originating event's `type` field.
 */
export const RejectedSignalSchema = z.enum([
  "tokens.delta",
  "commit.made",
  "test.passed",
  "file.edited",
  "daily.checkin",
  "error.fixed",
  "fed",
  "played",
]);

export type RejectedSignal = z.infer<typeof RejectedSignalSchema>;

/**
 * Payload for `signal.rejected` events (DEC-018).
 */
export const SignalRejectedPayloadSchema = z.object({
  reason: RejectionReasonSchema,
  signal: RejectedSignalSchema.optional(),
  origEventId: z.string().optional(),
  requestedXp: z.number().int().optional(),
  grantedXp: z.number().int().optional(),
});

export type SignalRejectedPayload = z.infer<typeof SignalRejectedPayloadSchema>;

// ---------------------------------------------------------------------------
// Runtime validation
// ---------------------------------------------------------------------------

/**
 * Validates and narrows an unknown value to StateFileV1.
 * Throws a descriptive ZodError on validation failure.
 */
export function validateState(x: unknown): StateFileV1 {
  const result = StateFileV1Schema.safeParse(x);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `[glyphling] state.json failed schema validation:\n${issues}`
    );
  }
  return result.data;
}

/**
 * Validates and narrows an unknown value to GlyphlingEvent.
 * Returns null on failure (used for tolerant event log replay).
 */
export function parseEvent(x: unknown): GlyphlingEvent | null {
  const result = GlyphlingEventSchema.safeParse(x);
  return result.success ? result.data : null;
}

/**
 * Creates a minimal valid StateFileV1 for first-run initialisation.
 */
export function makeEmptyState(): StateFileV1 {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    pets: [],
    globals: {
      activePetId: null,
      unlocks: {
        gifTier1: false,
        gifTier2: false,
        gifTier3: false,
        adoption: false,
      },
      eventsCursor: 0,
      eventsHead: "",
      lastEventAt: 0,
    },
  };
}
