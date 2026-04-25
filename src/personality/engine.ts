/**
 * PersonalityEngine — Module #18 (architecture §2.2)
 *
 * Implements the hatch-time personality roll (§5.3) and the rolling 7-day
 * refresh (§5.4). Pure functions — no randomness; same inputs always yield
 * same personality vector (§5.5).
 */

import type {
  PersonalityVector,
  PersonalityTrait,
  EggType,
  LanguageId,
  ISO8601,
  Pet,
} from "../state/schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HatchInputs {
  eggType: EggType;
  timeOfDay: "night" | "morning" | "afternoon" | "evening";
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  cwdLanguage: LanguageId;
  dialogueAnswers?: Record<string, string>;
  /** Optional salt for variance across plays; does not affect determinism for the same salt value. */
  salt?: number;
}

// ---------------------------------------------------------------------------
// Bias tables (architecture §5.3)
// ---------------------------------------------------------------------------

const ALL_TRAITS: PersonalityTrait[] = [
  "Stoic",
  "Friendly",
  "Pragmatic",
  "Energetic",
  "Gruff",
  "Philosophical",
  "Paranoid",
  "Curious",
];

type BiasVector = Partial<Record<PersonalityTrait, number>>;

/** Egg-type biases — each egg nudges two traits ±0.4 and two more ±0.1. */
const EGG_TYPE_BIAS: Record<EggType, BiasVector> = {
  circuit:  { Pragmatic: 0.4, Stoic: 0.4, Paranoid: 0.1, Gruff: 0.1 },
  rune:     { Philosophical: 0.4, Curious: 0.4, Stoic: 0.1, Friendly: 0.1 },
  shard:    { Energetic: 0.4, Gruff: 0.4, Pragmatic: 0.1, Paranoid: 0.1 },
  bloom:    { Friendly: 0.4, Curious: 0.4, Energetic: 0.1, Philosophical: 0.1 },
};

/** Time-of-day biases. */
const TIME_OF_DAY_BIAS: Record<HatchInputs["timeOfDay"], BiasVector> = {
  night:     { Philosophical: 0.2, Paranoid: 0.2 },
  morning:   { Energetic: 0.2, Friendly: 0.1 },
  afternoon: { Pragmatic: 0.2 },
  evening:   { Curious: 0.2, Stoic: 0.1 },
};

/** Day-of-week biases (0=Sunday). */
const DAY_OF_WEEK_BIAS: Record<number, BiasVector> = {
  0: { Friendly: 0.1, Energetic: 0.1 },   // Sunday — weekend
  1: { Gruff: 0.1 },                       // Monday
  2: { Pragmatic: 0.1 },                   // Tuesday — midweek
  3: { Pragmatic: 0.1 },                   // Wednesday
  4: { Pragmatic: 0.1 },                   // Thursday
  5: { Friendly: 0.1, Energetic: 0.1 },   // Friday — weekend start
  6: { Friendly: 0.1, Energetic: 0.1 },   // Saturday — weekend
};

/** CWD language biases. */
const LANGUAGE_BIAS: Record<string, BiasVector> = {
  typescript: { Pragmatic: 0.2 },
  javascript: { Pragmatic: 0.2 },
  rust:       { Paranoid: 0.2, Stoic: 0.1 },
  python:     { Friendly: 0.2 },
  go:         { Pragmatic: 0.2, Gruff: 0.1 },
  haskell:    { Philosophical: 0.3 },
  ocaml:      { Philosophical: 0.3 },
  shell:      { Gruff: 0.2 },
  bash:       { Gruff: 0.2 },
  ruby:       { Friendly: 0.2, Curious: 0.1 },
};

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

function applyBias(
  raw: Record<PersonalityTrait, number>,
  bias: BiasVector
): void {
  for (const [trait, delta] of Object.entries(bias) as [PersonalityTrait, number][]) {
    raw[trait] += delta;
  }
}

function normalise(
  raw: Record<PersonalityTrait, number>
): Record<PersonalityTrait, number> {
  // Clamp to floor of 0.1 so no trait is strictly zero
  const clamped = {} as Record<PersonalityTrait, number>;
  for (const t of ALL_TRAITS) {
    clamped[t] = Math.max(0.1, raw[t] ?? 1.0);
  }
  const total = Object.values(clamped).reduce((a, b) => a + b, 0);
  const weights = {} as Record<PersonalityTrait, number>;
  for (const t of ALL_TRAITS) {
    weights[t] = clamped[t]! / total;
  }
  return weights;
}

function argmax(weights: Record<PersonalityTrait, number>): PersonalityTrait {
  let best: PersonalityTrait = ALL_TRAITS[0]!;
  let bestW = -Infinity;
  for (const t of ALL_TRAITS) {
    if (weights[t]! > bestW) {
      bestW = weights[t]!;
      best = t;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute an initial personality vector from hatch-time inputs.
 * Pure function — deterministic for the same inputs (§5.5).
 * Implements the bias-table algorithm from architecture §5.3.
 */
export function rollAt(inputs: HatchInputs, nowIso?: ISO8601): PersonalityVector {
  // Start at 1.0 per trait (uniform baseline per §5.3)
  const raw = {} as Record<PersonalityTrait, number>;
  for (const t of ALL_TRAITS) {
    raw[t] = 1.0;
  }

  // Apply each input bias
  applyBias(raw, EGG_TYPE_BIAS[inputs.eggType]);
  applyBias(raw, TIME_OF_DAY_BIAS[inputs.timeOfDay]);
  applyBias(raw, DAY_OF_WEEK_BIAS[inputs.dayOfWeek] ?? {});
  if (inputs.cwdLanguage && inputs.cwdLanguage !== "unknown") {
    applyBias(raw, LANGUAGE_BIAS[inputs.cwdLanguage] ?? {});
  }

  // salt adds a small per-trait nudge to create variance across plays
  // without requiring real randomness (deterministic for the same salt)
  if (inputs.salt !== undefined && inputs.salt !== 0) {
    for (let i = 0; i < ALL_TRAITS.length; i++) {
      const t = ALL_TRAITS[i]!;
      // Deterministic per-trait nudge derived from salt + trait index
      const nudge = (((inputs.salt * (i + 1)) % 100) / 100) * 0.05;
      raw[t] += nudge;
    }
  }

  const weights = normalise(raw);
  const dominant = argmax(weights);
  const ts = nowIso ?? new Date().toISOString();

  return { dominant, weights, lockedAt: ts, lastRefreshAt: ts };
}

/**
 * Apply the rolling 7-day language refresh to a pet's personality.
 * Called once per day by LifecycleClock on personality:refresh event (§5.4).
 * 90% current vector + 10% new language-bias component.
 */
export function refresh(
  pet: Pet,
  langSample: Record<LanguageId, number>
): PersonalityVector {
  const totalExposure = Object.values(langSample).reduce((a, b) => a + b, 0);
  if (totalExposure === 0) {
    return {
      ...pet.personality,
      lastRefreshAt: new Date().toISOString(),
    };
  }

  // Compute language-bias weighted vector
  const langRaw = {} as Record<PersonalityTrait, number>;
  for (const t of ALL_TRAITS) {
    langRaw[t] = 1.0; // baseline
  }

  for (const [lang, count] of Object.entries(langSample)) {
    const weight = count / totalExposure;
    const bias = LANGUAGE_BIAS[lang];
    if (!bias) continue;
    for (const [trait, delta] of Object.entries(bias) as [PersonalityTrait, number][]) {
      langRaw[trait] += delta * weight;
    }
  }

  const langWeights = normalise(langRaw);

  // 90% current + 10% language-derived
  const blended = {} as Record<PersonalityTrait, number>;
  for (const t of ALL_TRAITS) {
    blended[t] = 0.9 * (pet.personality.weights[t] ?? 0) + 0.1 * (langWeights[t] ?? 0);
  }

  // Re-normalise to ensure sum == 1.0
  const blendedNorm = normalise(blended);
  const dominant = argmax(blendedNorm);

  return {
    dominant,
    weights: blendedNorm,
    lockedAt: pet.personality.lockedAt,
    lastRefreshAt: new Date().toISOString(),
  };
}

/**
 * Snap a Date to a time-of-day bucket used in HatchInputs.
 */
export function timeOfDayBucket(
  date: Date
): HatchInputs["timeOfDay"] {
  const h = date.getHours();
  if (h < 6) return "night";
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

/**
 * Build HatchInputs from the current environment (real-clock + cwd).
 */
export function buildHatchInputs(now: Date, cwdLanguage: LanguageId): HatchInputs {
  return {
    eggType: "circuit", // placeholder; caller provides real egg type
    timeOfDay: timeOfDayBucket(now),
    dayOfWeek: now.getDay() as HatchInputs["dayOfWeek"],
    cwdLanguage,
  };
}
