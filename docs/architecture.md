# glyphling — Architecture (v1)

**Status:** Draft 1 (for review)
**Author:** @architect
**Date:** 2026-04-17
**Scope:** High-level architecture for Phase 1 (pre-code). Implements DEC-001 through DEC-008.
**Audience:** @web-developer, @backend-developer, @designer, @researcher, @qa-engineer, @product-owner.

## 1. Overview

`glyphling` is a single-process, multi-instance-safe, TypeScript + Ink terminal pet that runs alongside Claude Code sessions. It persists a small JSON world model to disk, reacts to coding signals (tokens, commits, tests, file edits, daily check-ins) by awarding XP to a pet, and renders the pet's current state/animation in a TUI. Multiple open terminals sync in real time via file-watch on a shared state file, guarded by a lockfile for writes.

**Design stance.** Optimise for three qualities, in order:
1. **Correctness of the single shared state file** — cross-process writes must never corrupt state.
2. **Low-latency visible feedback** — signals should feel alive (sub-second animation on level-up).
3. **Simplicity** — this is a playful side-binary; operational complexity must stay near zero.

Scale is trivial (one user, ≤4 pets, kilobyte-scale state, ≤ a few writes/minute). Every design choice here reflects that — we will pick the simplest plausible approach at every branch.

**Non-goals (explicitly out of scope for v1).** Network sync, multi-user accounts, cloud backup, plugin API, telemetry, mobile/web views, voice, i18n, accessibility beyond default Ink rendering.

## 2. Module Map

### 2.1 Boxes-and-arrows (text diagram)

```
                       ┌──────────────────────────┐
                       │    CLI entry (bin)       │
                       │  parses argv, boots app  │
                       └────────────┬─────────────┘
                                    │
                     ┌──────────────▼──────────────┐
                     │      AppContainer (Ink)     │
                     │  wires stores, providers    │
                     └──┬───────────┬──────────┬───┘
                        │           │          │
           ┌────────────▼──┐  ┌─────▼─────┐  ┌─▼────────────────┐
           │  StateStore   │  │ Renderer  │  │  CommandParser   │
           │ (in-memory    │  │  (Ink     │  │ (REPL prompt:    │
           │  mirror of    │  │  tree)    │  │  feed/pet/pause  │
           │  state.json)  │  │           │  │  /adopt/export)  │
           └──┬────────────┘  └─────┬─────┘  └──────┬───────────┘
              │                     │               │
              │                     │               ▼
              │                     │       ┌────────────────┐
              │                     │       │ CommandHandler │
              │                     │       └──────┬─────────┘
              │                     │              │
              ▼                     ▼              ▼
        ┌─────────────────────────────────────────────────┐
        │  StatePersistence (atomic write, lockfile,      │
        │  file-watch subscriber, GLYPHLING_HOME resolver) │
        └────────┬──────────────────────────────────┬─────┘
                 │                                  │
                 ▼                                  ▼
          state.json(.lock)               events.jsonl (append only)
                 ▲                                  ▲
                 │                                  │
        ┌────────┴──────────┐         ┌─────────────┴────────────┐
        │ LifecycleClock    │         │        XPEngine          │
        │ (real-clock tick, │◀────────┤  folds events → XP/level │
        │  neglect, death,  │         │  triggers level-up side  │
        │  pause intervals) │         │  effects                 │
        └───────────────────┘         └────────────┬─────────────┘
                                                   │
                                                   ▼
                                         ┌────────────────────┐
                                         │  SignalCollectors  │
                                         │  - TokenSignal*    │
                                         │  - CommitSignal    │
                                         │  - TestSignal      │
                                         │  - EditSignal      │
                                         │  - DailySignal     │
                                         └──┬─────────────────┘
                                            │ each produces events
                                            ▼
                                     EventBus (in-proc)
                                            │
                                            ▼
                                 AdoptionManager, GIFExporter,
                                 PersonalityEngine, AnimationEngine
                                 (all subscribe to state + events)
```

### 2.2 Module table

All modules live under `src/` unless noted. Every module exports a single barrel `index.ts`. "Public interface" shows the minimum surface other modules can use.

| # | Module | Path | Responsibility | Depends on | Public interface |
|---|--------|------|---------------|------------|------------------|
| 1 | **CLI entry** | `src/cli.ts` | Parse `argv`; resolve config; boot AppContainer; install shutdown hooks. Bin target in `package.json`. | Config, AppContainer | `main(argv: string[]): Promise<number>` |
| 2 | **Config / env resolver** | `src/config/index.ts` | Resolve `GLYPHLING_HOME`, assert non-prod guard (DEC-008), expand tildes, compute file paths for state/lock/events/graveyard. | Node `os`/`path` | `resolveConfig(env): Config`; `type Config` |
| 3 | **StateStore** | `src/state/store.ts` | In-memory mirror of `state.json`. Dispatch reducers for domain actions. Emit change events to subscribers. | schema, StatePersistence | `class StateStore`; `getState()`; `dispatch(action)`; `subscribe(fn)` |
| 4 | **Schema & invariants** | `src/state/schema.ts` | TS interfaces + runtime zod-ish validators for `StateFileV1`. | none | `type StateFileV1`; `validateState(x): StateFileV1` |
| 5 | **StatePersistence** | `src/state/persistence.ts` | Atomic write via tmp → rename; lockfile acquire/release; file-watch subscribe; crash recovery. | Config, Schema | `readState()`; `writeState(s)`; `watchState(fn)` |
| 6 | **Lockfile** | `src/state/lockfile.ts` | Protocol 3.3 below. Thin wrapper — prefer a vetted lib (see §13 — researcher task). | `fs`, `process.pid` | `acquire(timeoutMs)`; `release()`; `withLock(fn)` |
| 7 | **Renderer (Ink)** | `src/render/App.tsx`, `src/render/*.tsx` | React/Ink component tree: Pet view, status bar, log panel, prompt. Subscribes to StateStore. | Ink, StateStore | `<App />` |
| 8 | **AnimationEngine** | `src/render/animation.ts` | Select animation by pet state; drive frame timer; expose current frame to Renderer. | Animation library, StateStore | `useAnimation(pet): Frame` hook |
| 9 | **Animation library** | `animations/*.ts` (repo root) | Frame data for 20+ scenes (idle×N, eat, sleep, play, sick, happy, sad, evolving, hatching, death). | none | `export const SCENES: Record<SceneId, Scene>` |
| 10 | **CommandParser + REPL** | `src/commands/repl.ts` | Read prompt input; tokenize; dispatch to handlers. | Ink `useInput` | `<Prompt onCommand={...} />` |
| 11 | **CommandHandlers** | `src/commands/handlers.ts` | `feed`, `pet`, `play`, `pause`, `resume`, `adopt`, `name`, `export`, `status`, `pets`, `quit`. | StateStore, EventBus | `dispatchCommand(cmd, ctx): Result` |
| 12 | **EventBus** | `src/events/bus.ts` | In-proc pub/sub; persists each event by appending to `events.jsonl` before fanning out to in-proc subscribers. | StatePersistence | `emit(e: GlyphlingEvent)`; `on(type, fn)` |
| 13 | **SignalCollectors** | `src/signals/{tokens,commits,tests,edits,daily}.ts` | Observe external sources → emit normalized events. Rate-limit & dedupe. | EventBus, Config | `start(ctx): () => void` each |
| 14 | **TokenSignalSource adapter** | `src/signals/tokens/adapter.ts` (+ `hook.ts`, `logtail.ts`) | Adapter interface with two impls (see §8). | Researcher output (TODO-002-adj) | `interface TokenSignalSource` |
| 15 | **XPEngine** | `src/xp/engine.ts` | Compute `xpToNext(L)`; apply XP from events; emit level-up side-effect events; enforce 1024 cap. | StateStore, EventBus | `applyEvent(e)`; `xpToNext(L)`; `levelFromCumXp(x)` |
| 16 | **LifecycleClock** | `src/lifecycle/clock.ts` | Real-clock tick every 60s; compute neglect age (minus pause intervals); fire `pet:sick`, `pet:dying`, `pet:died`; monitor hatch progress. | StateStore, EventBus | `start(ctx): () => void` |
| 17 | **AdoptionManager** | `src/adoption/manager.ts` | Enforce DEC-006 gate: primary ≥ L73, primary alive ≥ 7 real-clock days, ≤4 pets. Perform hatch-time personality roll. | StateStore, PersonalityEngine | `canAdopt(): Reason`; `adopt(eggType, opts): Pet` |
| 18 | **PersonalityEngine** | `src/personality/engine.ts` | §4 algorithm. Initial roll + 7-day rolling language refresh. | StateStore, language-detect util | `rollAt(hatchInputs): PersonalityVector`; `refresh(pet, langSample)` |
| 19 | **GIFExporter** | `src/export/gif.ts` | Three tiers (DEC-005). Capture terminal frames → GIF. Gated by level. | AnimationEngine, gif encoder lib (TBD) | `export(tier, petId): Promise<Path>` |
| 20 | **LanguageDetect util** | `src/util/lang.ts` | Sniff language of `cwd` from file extensions / package markers. | `fs` | `detectLanguage(dir): LanguageId` |
| 21 | **StatuslineRenderer** | `src/render/statusline.ts` | One-shot compact renderer for Claude Code `statusLine` (DEC-016). Reads `state.json` via a cached read (mtime-keyed); picks a compact frame from the active pet's `Scene.compact[]`; prints one ANSI-styled line (≤3 rows × ≤60 cols) to stdout; exits. No lock acquisition, no long-running process. | Config, Schema, CompactVocab | `renderOnce(cfg): Promise<number>` (exit code) |
| 22 | **CompactVocab** | `src/render/compact.ts` | Compact-frame type definitions, ANSI helpers (256-color safe, truecolor optional), width/height assertions (≤3×≤60), and the dispatch table from `(sceneId, pet state)` → compact frame index. Shared by StatuslineRenderer and the Ink expanded view for parity checks. | Schema | `type CompactFrame`; `pickCompactFrame(pet, scene, tick): CompactFrame`; `renderAnsi(frame): string` |

**Count: 22 modules** (20 inside `src/` + 1 repo-root `animations/` data module + 1 `src/util`). Modules 21/22 are added by DEC-016 (dual-mode rendering); see §14.

## 3. State Schema

**Schema file.** The live state is a single JSON document, `state.json`, validated on read and on write. Append-only mutation log is separate (`events.jsonl`).

**Schema version.** `schemaVersion: 1`. Future migrations bump this integer; the loader has a migration ladder (`1 → 2 → …`) keyed on `schemaVersion`. We refuse to load an unknown future version with a clear error.

### 3.1 TypeScript interface

```ts
// src/state/schema.ts

export type ISO8601 = string;                    // e.g. "2026-04-17T13:22:05.111Z"
export type PetId = string;                      // ULID or UUIDv7
export type EggType = "circuit" | "rune" | "shard" | "bloom";  // 4 starters, DEC-002
export type PersonalityTrait =
  | "Stoic" | "Friendly" | "Pragmatic" | "Energetic"
  | "Gruff" | "Philosophical" | "Paranoid" | "Curious";
export type LanguageId = string;                 // lowercased slug, e.g. "typescript"

export interface PauseInterval {
  pausedAt: ISO8601;
  resumedAt: ISO8601 | null;   // null = still paused
  reason?: string;             // optional user-supplied note
}

export interface PersonalityVector {
  dominant: PersonalityTrait;              // the named trait (what we display)
  weights: Record<PersonalityTrait, number>; // 0..1, sums to 1.0 (normalized)
  lockedAt: ISO8601;                       // when the initial roll happened
  lastRefreshAt: ISO8601;                  // last rolling-7-day refresh
}

export interface Tombstone {
  diedAt: ISO8601;
  cause: "neglect" | "unknown";
  finalLevel: number;
  finalXp: number;
  epitaph?: string;
}

export interface Pet {
  id: PetId;
  schemaVersion: 1;
  eggType: EggType;
  name: string | null;                     // null until user names or auto-name at L10
  createdAt: ISO8601;                      // egg genesis (immutable)
  hatchedAt: ISO8601 | null;               // set when hatching completes
  lastFedAt: ISO8601 | null;
  lastInteractionAt: ISO8601;              // ANY interaction; neglect timer reads this
  xp: number;                              // cumulative XP, monotonic non-decreasing
  level: number;                           // derived from xp, cached; 0 = pre-hatch, 1..1024
  personality: PersonalityVector;
  pauseIntervals: PauseInterval[];         // ordered oldest→newest
  diedAt: ISO8601 | null;
  tombstone: Tombstone | null;             // populated iff diedAt != null
  languageExposure: Record<LanguageId, number>;  // rolling weighted count, last 7d
}

export interface UnlockFlags {
  gifTier1: boolean;                       // unlocks at level 25 (DEC-005)
  gifTier2: boolean;                       // level 250
  gifTier3: boolean;                       // level 1024
  adoption: boolean;                       // primary reached L73 ≥7d (DEC-006)
}

export interface Globals {
  activePetId: PetId | null;               // which pet the UI foregrounds
  unlocks: UnlockFlags;                    // set by XPEngine side-effects
  eventsCursor: number;                    // byte offset of last-applied events.jsonl line
}

export interface StateFileV1 {
  schemaVersion: 1;
  createdAt: ISO8601;                      // file genesis
  updatedAt: ISO8601;                      // last successful write
  pets: Pet[];                             // length 0..4 (DEC-006 cap)
  globals: Globals;
}
```

### 3.2 Invariants

| Field | Rule |
|-------|------|
| `schemaVersion` | Integer, currently `1`. Loader-enforced. |
| `Pet.id` | Immutable after creation. |
| `Pet.createdAt` | Immutable. |
| `Pet.eggType` | Immutable. |
| `Pet.hatchedAt` | Once set non-null, immutable. |
| `Pet.xp` | Monotonically non-decreasing (no XP loss, ever). |
| `Pet.level` | Derived from `xp` via `XPEngine.levelFromCumXp`; stored denormalized for renderer speed; must always match derivation after any mutation. Validator check. |
| `Pet.lastInteractionAt` | Monotonically non-decreasing. Never written backward. |
| `Pet.pauseIntervals` | Append-only; only last element may have `resumedAt == null`. |
| `Pet.diedAt` | Once non-null, immutable. Dead pets are never revived; adoption creates a new pet. |
| `Pet.tombstone` | Iff `diedAt != null`. |
| `Globals.eventsCursor` | Monotonically non-decreasing. Used to ensure idempotent event replay after a crash. |
| `pets.length` | 0..4 (DEC-006). |
| `personality.weights` | Sum to 1.0 ± 1e-6; `dominant = argmax(weights)`. |
| `updatedAt` | Set on every successful atomic write. |

**Derived / not stored.** Neglect age, XP-to-next, age-in-days, "is sick" classification — all computed at read time. Storing them invites drift.

**Note on DEC-016 (dual-mode rendering).** The statusline compact renderer reads only fields already on the schema: `globals.activePetId`, `pet.eggType`, `pet.level`, `pet.xp`, `pet.hatchedAt`, `pet.diedAt`, `pet.personality.dominant`, `pet.pauseIntervals` (to tell paused from active), and `pet.accumulatedNeglectSeconds` (to derive a cheap "sick"-ish indicator). **No new schema field is required** for the initial rollout. A future `globals.statuslineEnabled?: boolean` toggle may be added if we want an in-app user-level on/off switch distinct from the `.claude/settings.json` configuration — deferred to a follow-up DEC, not blocking DEC-016.

## 4. Lockfile Protocol

### 4.1 Goals

- Exactly one writer at a time on `state.json`.
- No orphaned locks after a process crash.
- Readers never block writers meaningfully (readers don't need the lock; they read then validate).
- Bounded wait; contention is rare (seconds of traffic at most).

### 4.2 Files

- `state.json` — the state.
- `state.json.lock` — a directory-style lock file: JSON containing `{ pid: number, hostname: string, acquiredAt: ISO8601, heartbeatAt: ISO8601 }`.
- `state.json.tmp.<pid>.<rand>` — per-writer staging file.

### 4.3 Algorithm

**Acquire (caller: any module wanting to mutate state):**

1. Compute `deadline = now + MAX_WAIT` (default `MAX_WAIT = 5000ms`).
2. Attempt to create `state.json.lock` with `O_EXCL | O_CREAT` (atomic create-if-not-exists on POSIX; equivalent `wx` flag in Node fs).
3. If success → write `{pid, hostname, acquiredAt, heartbeatAt}` to it → return lock handle. Start a heartbeat timer that rewrites `heartbeatAt` every `HEARTBEAT_INTERVAL = 1000ms`.
4. If EEXIST → read existing lock file. Inspect `heartbeatAt`:
   - If `now - heartbeatAt > STALE_MS` (default `STALE_MS = 5000ms`, i.e. 5× heartbeat): **stale**. Attempt recovery: `rename(lock, lock.stale.<rand>)` then `unlink(lock.stale.*)` (two-step to avoid racing another recoverer). Retry from step 2.
   - Else: exponential backoff sleep (`50ms`, `100ms`, `200ms`, capped at `500ms`, jittered ±20%), retry step 2 until `deadline`.
5. If `deadline` passes → throw `LockTimeoutError` with the current lock holder's `{pid, hostname}` for diagnostics.

**Write:**

1. Acquire lock (as above).
2. Validate the in-memory state against the schema (refuse to persist invalid).
3. Write full state JSON to `state.json.tmp.<pid>.<rand>` (same directory — required for atomic rename on same filesystem).
4. `fsync` the tmp file.
5. `rename(tmp, state.json)` — POSIX atomic.
6. `fsync` the directory (best-effort; skipped on Windows).
7. Release lock (step 8).
8. Stop heartbeat; `unlink(state.json.lock)`.

**Crash mid-write.**
- If crash before step 5: stale `.tmp.*` remains; next writer's recovery sweeps tmp files older than `STALE_MS` on startup.
- If crash after step 5 but before 8: state is durable; lock is orphaned; next writer recovers via the stale-lock protocol.

**Release:**
- Idempotent; multiple calls are safe.
- Release is best-effort on SIGTERM/SIGINT via `process.on('exit')` hook, but relying on crash-recovery is the real contract.

### 4.4 Reader protocol

Readers never take the lock for reads. Algorithm:
1. Read `state.json` with `fs.readFile`.
2. Try parse + validate.
3. On parse error, retry once after 20ms jitter (writer might be mid-rename on a pathological FS). If still fails, fall back to the last known good in-memory state + log a warning.

### 4.5 File-watch subscribers (debounce)

`chokidar` or `fs.watch` emits change events for `state.json`. We debounce events with a **trailing-edge debounce of 50ms**: the first event schedules a read 50ms hence; additional events within that window reset the timer. This collapses write bursts (rename fires multiple events on some platforms) and survives the `rename`-then-`unlock` sequence above. If we miss an event (some FSes on network mounts), the next heartbeat-tick read at the minute boundary reconciles.

### 4.6 Library preference

Prefer an existing battle-tested package (`proper-lockfile` or `lockfile`) over bespoke code. **Researcher task** (see §13) — confirm current maintenance status, macOS/Linux/Windows behaviour, and whether it supports the heartbeat/stale semantics above. If not, wrap it with our heartbeat layer.

## 5. Personality Engine

### 5.1 Inputs at hatch time

| Input | Source | How sampled |
|-------|--------|-------------|
| `eggType` | User's chosen starter | 4 discrete values |
| `timeOfDay` | `new Date()` | bucketed: night (00-06), morning (06-12), afternoon (12-18), evening (18-24) |
| `dayOfWeek` | `new Date()` | 0..6 |
| `cwdLanguage` | `detectLanguage(process.cwd())` at hatch | `LanguageId`; `"unknown"` if none |
| `dialogueAnswers` | Optional 3-question mini-prompt at hatch | each multiple-choice; user may skip → treated as "neutral" |

### 5.2 Representation

An 8-dimensional vector `weights: Record<PersonalityTrait, number>` summing to 1.0. `dominant = argmax(weights)` is the displayed trait.

### 5.3 Scoring algorithm

Every input contributes an additive **bias vector** with values in `[-1, +1]` per trait. The final weights are:

```
raw[t]     = 1.0 + Σᵢ biasᵢ[t]       // start at 1 so no trait is strictly zero
clamped[t] = max(0.1, raw[t])         // floor so min weight is ~1% of uniform
weights    = normalize(clamped)       // sum to 1.0
```

Bias tables (to be tuned by @designer in a follow-up; initial values below are deliberate and plausible):

- **Egg type biases.** Each egg nudges two traits ±0.4 and another two ±0.1; the other four get 0. Example:
  - `circuit` → +0.4 Pragmatic, +0.4 Stoic, +0.1 Paranoid, +0.1 Gruff.
  - `rune` → +0.4 Philosophical, +0.4 Curious, +0.1 Stoic, +0.1 Friendly.
  - `shard` → +0.4 Energetic, +0.4 Gruff, +0.1 Pragmatic, +0.1 Paranoid.
  - `bloom` → +0.4 Friendly, +0.4 Curious, +0.1 Energetic, +0.1 Philosophical.
- **Time of day.** night → +0.2 Philosophical, +0.2 Paranoid; morning → +0.2 Energetic, +0.1 Friendly; afternoon → +0.2 Pragmatic; evening → +0.2 Curious, +0.1 Stoic.
- **Day of week.** Weekend → +0.1 Friendly, +0.1 Energetic; Monday → +0.1 Gruff; midweek → +0.1 Pragmatic.
- **cwd language.** `typescript` → +0.2 Pragmatic; `rust` → +0.2 Paranoid, +0.1 Stoic; `python` → +0.2 Friendly; `go` → +0.2 Pragmatic, +0.1 Gruff; `haskell`/`ocaml` → +0.3 Philosophical; `shell` → +0.2 Gruff; `ruby` → +0.2 Friendly, +0.1 Curious; `unknown` → zero.
- **Dialogue answers.** Each answer maps to a small (±0.15) nudge on 1-2 traits. The mapping table lives in `src/personality/dialogue.ts` and is tunable without schema change.

Locked trait and full weights are written to `personality` at hatch. `lockedAt = hatchedAt`.

### 5.4 Rolling 7-day refresh

Purpose: let the pet "grow into" the user's current work pace without erasing the born-personality.

- **Cadence.** Once every 24 hours, at the first interaction after midnight local time, the LifecycleClock emits `personality:refresh`.
- **Sample.** The `Pet.languageExposure` map is a time-windowed count: each signal (commits, edits, tokens) carries the detected `LanguageId` of the file/cwd and increments the counter; old entries older than 7 days are pruned (we store `(LanguageId, timestamp, weight)` entries in a compact array and re-aggregate on refresh).
- **Refresh math.**
  ```
  langBias = Σ (exposure[L] / totalExposure) * LANGUAGE_BIAS[L]
  newWeights = 0.9 * currentWeights + 0.1 * normalize(baseline + langBias)
  ```
  We keep 90% of the current vector — change is slow and visible over weeks, not a whiplash. `dominant` recomputes. If `dominant` changes, emit `personality:drift` event (UI can surface a subtle "your glyphling feels different today" message).

### 5.5 Determinism & testability

The whole engine is a pure function of inputs; no randomness. We do **not** add RNG here — two players with identical hatch inputs get identical personalities, which is a feature (sharable presets, reproducible tests).

## 6. Event Model → XP Pipeline

### 6.1 Pipeline shape

```
[external source] → SignalCollector → EventBus.emit()
                                          │
                             ┌────────────┴────────────┐
                             ▼                         ▼
                 append to events.jsonl         in-proc subscribers
                             │                         │
                             ▼                         ▼
                    (durable, replayable)     XPEngine, PersonalityEngine,
                                              AnimationEngine, UI
```

### 6.2 Event shape

```ts
interface GlyphlingEvent {
  id: string;                 // ULID — monotonic, dedupable
  type: EventType;            // "tokens.delta" | "git.commit" | "test.pass" | "file.edit" | "error.fixed" | "daily.checkin" | "pet.fed" | "pet.played" | "pet.paused" | "pet.resumed" | "level.up" | "personality.refresh"
  ts: ISO8601;
  petId: PetId | null;        // null for global events
  source: string;             // e.g. "hook", "logtail", "manual"
  payload: unknown;           // type-specific
  xpDelta?: number;           // optional — included when source directly proposes XP
  lang?: LanguageId;          // optional — for personality refresh exposure
}
```

Events are appended one-per-line to `events.jsonl` (JSONL: trivially streamable, grep-friendly, easy to rotate).

### 6.3 Per-signal detection, rate limit, dedupe, XP

| Signal | Detector | Rate limit | Dedupe key | Base XP |
|--------|----------|-----------|-----------|---------|
| **tokens.delta** | `TokenSignalSource` adapter (§8) | 1 event per 10s; accumulate `tokensSinceLastEvent`; emit when ≥ 5000 tokens OR 60s elapsed with any tokens | `(petId, ceil(ts/10s))` | `floor(tokens / 500)` — 1 XP per 500 tokens |
| **git.commit** | Watch `.git/logs/HEAD` via chokidar in session cwd (and any `cwd` visited since start) | 1 per 30s per repo | commit SHA | 25 |
| **test.pass** | Parse stdout of `npm test` / `pytest` when invoked via our wrapped runner, OR detect via a toolbelt hook (TBD) | 1 per test file per 5min | `(repo, testFile, passCount)` | 5 per new pass, capped at 50/run |
| **file.edit** | chokidar on `cwd` (debounced; excludes node_modules, .git, build dirs) | 1 per file per 60s | `(absPath, minuteBucket)` | 1 per edited file-minute, cap 100/day |
| **error.fixed** | Manual user command `glyphling fixed` (v1); later: parse test-fail→test-pass transitions | 1 per 60s | ULID only | 15 |
| **daily.checkin** | First interaction of a new local-calendar day | 1/day, trivially | `YYYY-MM-DD` | 20; streak multiplier +10% per consecutive day, cap ×2.0 at 10-day streak |
| **pet.fed / played** | Manual user command | 1 per 30min each | command ULID | 5 |

**Rate limiting** happens inside each collector **before** emit, by maintaining a small per-dedupe-key LRU of `lastEmittedAt`. Dedupe keys exist so a signal replay (from crash recovery) is idempotent: XPEngine tracks `seenEventIds` via a bloom-ish bounded set AND trusts `Globals.eventsCursor` as the replay high-water mark. The cursor is the primary defense; dedupe keys are belt-and-suspenders for live bursts.

### 6.4 XP fold

`XPEngine.applyEvent(e)` for events with `xpDelta`:
1. If `event.id` ≤ `Globals.eventsCursor` position — skip (already applied).
2. If `pet.diedAt != null` — skip (dead pets earn nothing).
3. `pet.xp += xpDelta`.
4. `newLevel = levelFromCumXp(pet.xp)`.
5. If `newLevel > pet.level`: set `pet.level = newLevel`, emit `level.up` event with `{from, to}`.
6. Clamp at 1024. XP beyond the cumulative-1024 threshold is accepted and stored (vanity — "how far past did you grind?") but `level` caps at 1024.
7. Update `eventsCursor`.

**Level-up side effects** (fan-out in EventBus on `level.up`):
- AnimationEngine triggers a one-shot `level_up` scene overlay for 2s.
- Renderer flashes the level number.
- XPEngine checks unlock thresholds:
  - `level ≥ 25 && !unlocks.gifTier1` → set `unlocks.gifTier1 = true`, emit `unlock.gif.tier1`.
  - `level ≥ 250 && !unlocks.gifTier2` → Tier 2.
  - `level ≥ 1024 && !unlocks.gifTier3` → Tier 3.
- AdoptionManager checks: if `level ≥ 73` on primary AND `now - primary.hatchedAt ≥ 7d` AND pet alive → set `unlocks.adoption = true`, emit `unlock.adoption`. If the 7-day condition fails at L73, the unlock check re-runs on the daily lifecycle tick.
- At `level === 10` with `pet.name == null` → prompt user to name (or auto-name from species table).
- At `level === 1024` → stamp honorific "Ascendant" (DEC-004) on display name render (not on stored `name`).

### 6.5 XP curve

Per DEC-004: `xpToNext(L) = floor(25 * L^1.20)`, cap at 1024. (Original spec had `L^1.65`, corrected 2026-04-17 — that exponent yielded ~895M cumulative XP, contradicting the 48M / 66-year / 13-year figures DEC-004 intends.)

`cumulativeXpForLevel(L) = Σ_{k=1..L-1} xpToNext(k)`. Precomputed lookup table at boot (1024 entries, trivial).

`levelFromCumXp(x) = argmax L such that cumulativeXpForLevel(L) ≤ x`, via binary search on the table.

## 7. Claude Code Integration — TokenSignalSource

We do not yet know whether Claude Code exposes a stable hook for token deltas. We design an **adapter** so implementation can swap without touching XPEngine.

### 7.1 Adapter interface

```ts
interface TokenSignalSource {
  /** Human name for status-line display. */
  readonly name: string;

  /** Start delivering token deltas. Returns a stop function. */
  start(onDelta: (delta: TokenDelta) => void): () => Promise<void>;

  /** Report self-health — used by CLI `glyphling doctor`. */
  health(): Promise<AdapterHealth>;
}

interface TokenDelta {
  ts: ISO8601;
  tokens: number;        // delta since last report, ≥ 0
  model?: string;        // optional
  session?: string;      // optional — to correlate with Claude Code session id
  lang?: LanguageId;     // optional — detected at delivery time
}

interface AdapterHealth {
  ok: boolean;
  mode: "hook" | "logtail" | "disabled";
  detail?: string;
}
```

### 7.2 Reference implementation A — Hook-based

If Claude Code provides a post-turn hook (or similar), the adapter registers a small script that calls our local IPC (unix-domain socket at `$GLYPHLING_HOME/ipc.sock`, or a file-append fallback) with a token count. CLI translates inbound messages into `TokenDelta`.

**Pros:** exact, low-latency, cheap.
**Cons:** depends on Claude Code API stability; may require user to enable a hook.

### 7.3 Reference implementation B — Log-tail / scrape fallback

Tail a known Claude Code log file (path TBD — researcher task) and parse token-count lines with a regex. Deltas computed as differences of cumulative counters per session.

**Pros:** zero user setup, works offline, survives API changes in the UI.
**Cons:** fragile to log format changes; adds a dependency on a file we don't own.

### 7.4 Selection

At startup, `CliApp` constructs a `CompositeTokenSignalSource` that tries Hook first, falls back to LogTail, falls back to a `DisabledTokenSignalSource` (health `ok: true, mode: "disabled"` — pet just won't earn token XP). A `glyphling doctor` command reports which mode is active.

**Open decision.** Which log file to tail, and whether Claude Code publishes a hook interface, is TODO-002-adj — an extension of the scoped researcher task. See §13.

## 8. Filesystem Layout

### 8.1 Repository (development) layout

```
/                              (project root — coordination files per DEC-007)
├── HANDOFF.md
├── TODOS.md
├── MEMORY.md
├── DECISIONS.md
├── CHANGELOG-DEV.md
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── .gitignore                 (ignores .dev-state/, node_modules/, dist/)
├── .editorconfig
├── src/
│   ├── cli.ts
│   ├── config/
│   ├── state/                 (schema, store, persistence, lockfile)
│   ├── render/                (Ink components, animation engine)
│   ├── commands/              (repl, handlers)
│   ├── events/                (bus)
│   ├── signals/               (tokens/, commits.ts, tests.ts, edits.ts, daily.ts)
│   ├── xp/                    (engine, curve)
│   ├── lifecycle/             (clock)
│   ├── adoption/              (manager)
│   ├── personality/           (engine, dialogue)
│   ├── export/                (gif + tiers)
│   └── util/                  (lang, time, ids)
├── animations/                (frame data — 20+ scenes; JSON or TS)
├── tests/
│   ├── unit/
│   └── integration/           (tmp-dir GLYPHLING_HOME)
├── docs/
│   ├── architecture.md        (this file)
│   └── adr/                   (optional future ADRs; DECISIONS.md is primary)
├── .dev-state/                (gitignored; DEC-008)
│   ├── dev/
│   ├── demo/
│   └── test/
├── .github/workflows/
└── .claude/
    ├── agent-memory/
    └── settings.local.json
```

### 8.2 Runtime layout (installed pet on user machine)

Per DEC-002 and DEC-008: resolved via `resolveConfig(env)` with precedence:

1. `process.env.GLYPHLING_HOME` if set.
2. Else in production (`NODE_ENV === "production"` OR running from an npm global install): `~/.claude/glyphling/` (macOS/Linux), `%USERPROFILE%\.claude\glyphling\` (Windows).
3. Else (dev without env var) → **hard-fail with an error** (DEC-008 guard). No silent fallback into `~/.claude/`.

```
$GLYPHLING_HOME/
├── state.json
├── state.json.lock              (transient)
├── state.json.tmp.<pid>.<rand>  (transient, swept on startup)
├── events.jsonl                 (append-only; rotated at 50MB → events.jsonl.1)
├── graveyard/
│   └── <petId>.tombstone.json   (immortal)
└── ipc.sock                     (if Hook adapter active)
```

`events.jsonl` rotation: on startup, if size > 50MB, rename to `events.jsonl.N` (next free N) and start fresh. We never delete.

## 9. Failure Modes

| Failure | Impact | Handling | Recovery |
|---------|--------|----------|----------|
| Lockfile holder crashes | Stale lock | Heartbeat + STALE_MS detection; next writer recovers | Automatic on next write attempt |
| `state.json` corrupt (partial write) | Startup fail | Atomic rename prevents this in theory; if it happens, detect via JSON parse fail | Restore from `events.jsonl` replay + last valid in-memory mirror; if neither, back up corrupt file and start fresh with `pets: []` |
| `events.jsonl` corrupt on last line | Replay fail | Skip unparseable trailing lines; warn | Continue with valid prefix; cursor stays at last good byte offset |
| Disk full during write | Write errors | `writeState` throws; CLI surfaces error; no partial write | User frees space; retry |
| File-watch missed event | Other instance sees stale state | 60s minute-tick reconcile read | Automatic |
| Clock skew (user changes wall clock) | Neglect timer reads bogus | Store UTC ISO8601 everywhere; LifecycleClock rejects ticks where `now < lastInteractionAt` (logs a warning, keeps last); the 5-day death threshold remains monotonic via a separate "accumulated neglect seconds" counter that only increments | See §10 — proposed DEC follow-up |
| `GLYPHLING_HOME` points to `~/.claude/` in dev | Data corruption risk | Startup guard refuses | User sets `GLYPHLING_HOME=./.dev-state/dev` |
| `TokenSignalSource` fails | No token XP | CompositeAdapter falls back; `doctor` command diagnoses | User sees disabled mode; other signals still run |
| Schema version > 1 encountered | Unknown future | Refuse to load | User upgrades the binary |
| Multi-terminal race: two writers | Lock prevents overlap | Second writer blocks up to MAX_WAIT | Eventually serializes |
| User `kill -9` mid-write | Stale tmp file + maybe stale lock | Tmp sweep + stale-lock recovery | Next write works |

## 10. Non-Functional Requirements

| Attribute | Target |
|-----------|--------|
| Cold start to first frame | < 500ms on typical laptop |
| State write latency (local disk) | < 50ms p99 |
| State read + validate | < 10ms p99 |
| Lock wait (no contention) | < 5ms |
| Lock wait (contention, 2 instances) | < 200ms p99 |
| Animation frame rate | 10 fps idle, 30 fps during level-up burst |
| `events.jsonl` max file size | 50MB before rotation |
| Max pets | 4 (DEC-006) |
| Level cap | 1024 (DEC-004) |
| Memory footprint | < 100MB resident |

## 11. Implementation Phases

Mapped to existing TODOs where possible.

1. **Phase 1a — skeleton (TODO-004).** Scaffold + `resolveConfig` + guard (DEC-008).
2. **Phase 1b — state core (TODO-005).** Schema, persistence, lockfile, file-watch. Integration tests with 2 processes.
3. **Phase 1c — XP engine (TODO-006).** Curve, level-up, unlock flags.
4. **Phase 1d — renderer + REPL.** Minimal Ink shell, prompt, status line. (New TODO — propose @product-owner add TODO-013.)
5. **Phase 1e — lifecycle clock + death (TODO-011).** Real-clock neglect, pause/resume.
6. **Phase 1f — animations (TODO-007).** 20+ scenes; hatch/death priority.
7. **Phase 1g — signals: commit/edit/daily** (new TODO-014) — everything except tokens.
8. **Phase 1h — token adapter** (new TODO-015) — follows researcher output.
9. **Phase 1i — personality engine** (new TODO-016) — can land any time after 1b; blocks hatch in 1e.
10. **Phase 1j — adoption (TODO-010).** After XP + personality exist.
11. **Phase 1k — GIF export (TODO-008).** After animations stable.
12. **Phase 1l — QA pass (TODO-012).**

## 12. Contracts for Developer Agents

### 12.0 Pet wander — horizontal drift in the expanded TUI (TODO-045 Phase 1)

The pet drifts left and right inside a 40-column arena inside `PetView`. Every 500 ms a `setInterval` advances a pure `stepWander` reducer: x moves one column in the current facing direction; when x would cross a boundary the position is clamped and `pausedAtEdge` is set, producing a 1-tick pause before the facing flips. During one-shot scenes (eat, play, level-up, hatch, evolve, death) the interval still fires but `stepWander` is not called and x is held — the pet slides only while the `isAmbientScene` predicate returns true for the active scene.

**Position is session-local, not persisted.** Wander x lives entirely inside `useWander`'s `useState`; it is not on the `Pet` schema and is never written to `state.json`. The rationale mirrors the existing idle-scene frame-index pattern: position is cosmetic and has no semantic value between sessions. Persisting it would require a schema bump for a non-semantic field and complicate the statusline compact renderer (DEC-016), which has no concept of a wander arena.

**`isAmbientScene` predicate** (`src/render/animation.ts`). Single source of truth for "is the pet drifting right now?" Returns true for the 10 ambient (looping, non-event-triggered) scenes:

| Group | Scene IDs |
|-------|-----------|
| Idle variants | `idle-baseline`, `idle-chipper`, `idle-stoic`, `idle-curious`, `idle-grumpy` |
| Illness / low energy | `sick`, `sick-worse`, `sad` |
| Rest | `sleep`, `sleep-deep` |

Sick, sad, and sleep scenes are **intentionally ambient** — the pet shuffles miserably during illness; the shuffle characterises the mood rather than interrupting it. One-shot scenes (`levelup-flash`, `eat-*`, `play-*`, `hatch-*`, `evolve-shimmer`, `death-fade`) are NOT ambient; wander is frozen during those scenes so their frame content is not obscured by horizontal drift.

**DEC-015 conformance.**

- `useWander` (`src/render/useWander.ts`) owns its own `setInterval` at `STEP_INTERVAL_MS`. It does NOT piggyback on `useFrame` (DEC-015 rule 1).
- Scenes remain static data looked up at render time (DEC-015 rule 2).
- `PetView` stays wrapped in `React.memo` (DEC-015 rule 3).
- The animated `Box` has no `borderStyle` and a fixed `width={ARENA_COLS + 4}` — the arena width never changes so HudBar/LogPanel below do not reflow as x changes (DEC-015 rule 4 + relayout protection). The x offset is applied as leading whitespace prepended to each row string, not as `marginLeft`, to keep Yoga's layout tree stable.

**`useAnimation` return-shape change.** Previously returned `Frame`; now returns `{ frame: Frame; sceneId: SceneId }`. The `sceneId` is consumed by `PetView` to feed `isAmbientScene(sceneId)` into `useWander`. No other callers exist today. The `pickCompactFrame` helper in the same module is unchanged — the compact statusline path (DEC-016) is unaffected.

**Env-var contract.** `NO_MOTION=1` and `GLYPHLING_REDUCED_MOTION=1` are read once at mount time inside `useWander`'s `useEffect`. When either is set the hook returns a static `{ x: 0, facing: 1 }` and never starts the interval.

**Constants** (`src/render/useWander.ts`):

| Constant | Value | Meaning |
|----------|-------|---------|
| `ARENA_COLS` | `40` | Visible columns of the wander arena (exported). |
| `STEP_INTERVAL_MS` | `500` | ms between wander steps (exported). |
| `PET_WIDTH` | `20` | Approximate expanded-frame pet width in columns (internal); matches `docs/design/expanded-frames.md` §1.1. x is clamped to `[0, ARENA_COLS - PET_WIDTH]`. |

**Phase 2 (TODO-046 — deferred).** A new `walk` scene with per-species limb-motion frames will replace the idle scene while the pet is drifting. This requires a new DEC because it expands the 22-scene contract and needs designer-authored frame art for all four species. Phase 1 (this feature) is position-only: the pet slides through idle frames today; it does not yet animate a walking gait.

---

### 12.1 @web-developer (Ink renderer)

- `<App />` receives a `StateStore` via React context; subscribes via `useSyncExternalStore`.
- Pet view consumes `useAnimation(pet)` → `{ frame, sceneId }` (see §12.0 for the return-shape change).
- REPL is an Ink component; command submission dispatches `commandHandlers[cmd](args, ctx)`.
- No direct disk IO from components; all mutation via store actions.

### 12.2 @backend-developer (state, XP, lifecycle, signals, adoption)

- All disk writes go through `StatePersistence.writeState`.
- All state changes go through `StateStore.dispatch(action)`.
- All XP changes go through `XPEngine.applyEvent`.
- Signal collectors call `EventBus.emit`; they never touch StateStore directly.
- Lockfile usage: `withLock(async () => { … })` — no bare acquire/release in product code.

### 12.3 @designer + @web-developer (animations)

- `Scene` type in `animations/types.ts`: `{ id, frames: Frame[], fps, loop: boolean, compact: CompactFrame[] }`.
- Frames (expanded view) are strings (possibly multi-line) + a palette descriptor (optional) — kept simple for v1.
- **`compact: CompactFrame[]`** (added by DEC-016 — dual-mode rendering). Compact frames are the statusline vignette for this scene.
  - **Dimensions.** Each `CompactFrame.text` MUST render to ≤ 3 rows and ≤ 60 visible columns (excluding ANSI escape sequences). Enforced at build-time by a CompactVocab assertion.
  - **Color budget.** ANSI-styled; 256-color (xterm-256) safe. Truecolor (24-bit) is optional — always provide a 256-color fallback in the same `CompactFrame`.
  - **Cadence.** Compact frames form a slow vignette cycle (expect 1–2s per tick from Claude Code's statusline refresh), not smooth animation. `compact.length` is typically 2–6 frames. For scenes where motion matters (e.g. `hatching`, `level-up-flash`), the compact cycle is a stylized abbreviation of the expanded animation, not a down-sampled copy.
  - **Relationship to `frames`.** `frames` drives the Ink expanded view at 10–30 fps (DEC-015). `compact` drives the statusline at ~1 Hz. The two are semantically linked (same scene, same pet mood) but rendered by different modules and sized independently.
- One scene per required state: idle-1..idle-5, eat, sleep, play, sick, happy, sad, evolving, hatching, death, level-up-flash. That's 15 minimum; 20 is the floor — @designer adds variants. Every scene must ship BOTH `frames` and `compact`; a scene with an empty `compact[]` fails build.

### 12.4 @database-engineer

Not applicable in v1 — our "database" is `state.json` + `events.jsonl`. If we ever migrate to SQLite (unlikely), escalate.

### 12.5 @researcher

- TODO-002: npm name availability (already scoped).
- **New ask — TODO-002-adj** (propose new TODO): evaluate Claude Code hook availability, lockfile libraries (`proper-lockfile` vs `lockfile` vs `@npmcli/fs`), terminal→GIF libraries (`asciinema` + `agg`, `terminalizer`, `ttystudio`), Ink animation/frame-rate patterns.

## 13. Risks & Open Questions

Top 6 things that could invalidate parts of this design:

1. **Claude Code token hook may not exist.** The entire `tokens.delta` signal relies on one of (a) a stable hook, (b) a parseable log. If neither holds, token XP either needs a different ingestion path (e.g., user runs a wrapper shim around `claude` that pipes stdout) or we demote tokens to a manual signal. — **Owner:** @researcher (TODO-002-adj). — **Impact if invalidated:** §7 gets replaced; XP economy rebalanced because tokens are meant to be the biggest driver.

2. **File-watch reliability on iCloud / network mounts.** If a contributor clones the repo under an iCloud or network-synced path (e.g., `~/Library/Mobile Documents/...`), `./.dev-state/<mode>` inherits that sync layer and chokidar has known flakes there. **Runtime** is fine (`~/.claude/` is local), but tests and demos may see flapping or missed events on synced volumes. — **Owner:** @backend-developer at TODO-005. — **Mitigation:** add periodic reconciliation read at 60s; contributors on synced filesystems can override `GLYPHLING_HOME` to `/tmp/glyphling-dev`.

3. **Lockfile portability on Windows.** `rename` atomicity and `O_EXCL` semantics differ. `proper-lockfile` claims cross-platform support; needs verification. — **Owner:** @researcher. — **Mitigation:** ship a Windows-specific code path if needed.

4. **XP economy calibration.** DEC-004 assumes "2000 XP/day heavy user". Our per-signal XP table (§6.3) is a first pass and has not been validated against that budget. If a typical user earns 200 XP/day instead, 1024 becomes unreachable in a lifetime — violating the spirit of DEC-004. — **Owner:** @product-owner + @qa-engineer. — **Mitigation:** log XP-per-day in `glyphling doctor` during Phase 1 testing; rebalance the per-signal table before public release.

5. **Clock skew / time zones.** Neglect timer correctness depends on monotonic wall clock. Users who change their system clock (travel, manual adjustment) could either instantly kill a pet or extend a pet's life artificially. §9 proposes accumulated-neglect-seconds, which is a new decision — see Proposed DECs below.

6. **Statusline subprocess budget.** Claude Code invokes the `statusLine` command on every refresh tick (assumed 1–2s cadence; confirm via @researcher TODO-014). If `glyphling statusline` exceeds that budget, Claude Code will either drop frames, visibly stall, or display stale output. **Target:** <50ms P99 wall time per invocation, measured cold (no JIT warm-up, no process reuse). **Owner:** @backend-developer at TODO-015. **Mitigations:** (a) the statusline path reads **only** `state.json` — never `events.jsonl` (which can grow to 50MB before rotation, per §8.2); (b) cache a parsed-state object in-process via `state.json` mtime — but note each subprocess starts fresh, so caching is only useful for repeated reads *within* one invocation, not across ticks; (c) skip schema validation on the hot path — trust the writer, or validate only a small critical-field subset; (d) avoid `require()`ing the full React/Ink tree in the statusline entry point — keep the compact renderer's dependency closure tiny (Config + Schema + CompactVocab only); (e) if Node startup itself exceeds budget on the user's machine, fall back to emitting a pre-rendered cache file written by the Ink app and `cat`-ing it — deferred, only if we measure a problem. **Impact if invalidated:** DEC-016's primary integration mode degrades; users either disable the statusline or see a laggy pet.

### Open questions (smaller, deferred)

- Animation frame data format: structured JSON, TS literal modules, or embedded-string DSL? @designer decides.
- Naming convention for the 4 eggs (`circuit | rune | shard | bloom` above is a straw-man). @designer / @product-owner confirm.
- Do we localise day-boundary for daily check-in to user's local TZ or UTC? Proposed: local.
- Does `adopt` take the new pet's egg type as an argument, or randomise? Proposed: user picks.
- How do we handle a pet that hits L73 after 7d real-time but is currently paused? Proposed: pause time does not count — only unpaused age ≥ 7d satisfies DEC-006. Needs confirmation.

## 14. Dual-mode rendering (DEC-016)

### 14.1 Overview

`glyphling` renders into two surfaces from a **single shared state**:

1. **Statusline compact mode** (primary integration). A one-shot subprocess — `glyphling statusline` — invoked by Claude Code's `statusLine` extension (configured in `.claude/settings.json`). Prints a single ANSI-styled compact frame (≤3 rows × ≤60 cols) to stdout, then exits. Driven by Claude Code's refresh tick (~1–2s assumed, confirm via @researcher TODO-014). No keyboard interaction, no REPL, no mutation.
2. **Standalone Ink expanded mode**. The full TUI — `glyphling` (bare command). Long-running process. Hosts the pet view, status bar, log panel, REPL prompt, animation engine at 10–30 fps (DEC-015), command handlers, GIF capture (DEC-005/014). This is the home for everything that is not a brief status glimpse.

State flow is strictly one-way from the expanded view (the only writer) to the statusline subprocess (a read-only view):

```
┌──────────────────────────────┐             ┌──────────────────────────────┐
│  glyphling  (Ink app)        │             │  glyphling statusline        │
│  - long-running              │             │  - one-shot subprocess       │
│  - REPL, animations, GIF     │             │  - reads state.json only     │
│  - SignalCollectors writing  │             │  - prints 1 compact frame    │
│    to events.jsonl + state   │             │  - exits                     │
└──────────┬───────────────────┘             └──────────┬───────────────────┘
           │ writes (via lockfile)                      │ reads (no lock)
           ▼                                            ▼
     ┌────────────────────────────────────────────────────────┐
     │  $GLYPHLING_HOME/                                       │
     │    state.json           (materialised view, DEC-010)    │
     │    state.json.lock      (write coordination, DEC-013)   │
     │    events.jsonl         (source of truth, DEC-010)      │
     └────────────────────────────────────────────────────────┘
           ▲
           │ hooks append token events (DEC-012)
           │
     ┌────────────────────────────┐
     │  Claude Code Stop hook     │
     └────────────────────────────┘
```

The statusline subprocess NEVER acquires the lockfile. `state.json` being a safe-to-read materialised view is exactly what makes this pattern work (DEC-010). If a compact frame is briefly stale (e.g. renders 1–2s after a level-up), the next tick corrects it — this is acceptable for a 1 Hz vignette.

### 14.2 Entry-point table

| Entry | Long-running? | Writes state? | Purpose |
|-------|---------------|---------------|---------|
| `glyphling` | Yes | Yes (via lockfile) | Open the Ink expanded view. REPL, animations, commands, GIF capture. Default mode. |
| `glyphling statusline` | No (one-shot) | No | Print exactly one compact frame to stdout, exit. Configured as Claude Code's `statusLine`. Budget: <50ms P99. |
| `glyphling feed` / `pet` / `play` / `pause` / `resume` / `adopt` / `name` / `status` / `export` / `pets` / `quit` | No (one-shot) | Yes (brief lock) | CLI command forms — same handlers as the REPL, usable from shells or scripts. Each acquires the lock, mutates, releases, exits. |
| `glyphling doctor` | No (one-shot) | No | Diagnostics — reports adapter mode, config paths, clock health, statusline latency histogram. |

Only `glyphling` (expanded view) runs an Ink tree. Every other entry point is a short-lived Node process.

### 14.3 `.claude/settings.json` configuration

Users paste the snippet below into their project or user `.claude/settings.json` to enable the in-window statusline pet. Key names and tick semantics confirmed by @researcher TODO-014 against Claude Code 2.1.112.

```json
{
  "statusLine": {
    "type": "command",
    "command": "glyphling statusline",
    "padding": 1,
    "refreshInterval": 1
  }
}
```

Confirmed contract (TODO-014):
- Key is `statusLine` (camelCase). Only `"command"` is a valid `type`.
- `command` is a shell string; stdout is rendered verbatim under the chat.
- `refreshInterval` is in **seconds** (not ms), min 1 → 1 Hz floor. Unset = event-driven only (new assistant message / perm-mode change / vim toggle / model change).
- stdout passes ANSI + OSC 8 hyperlinks through verbatim; multi-line supported (split on `\n`, each line = one row). Right edge is truncated at terminal width (no wrap).
- Hardcoded 5 s subprocess timeout, not user-configurable. Target ≤30 ms tick. In-flight runs abort on new trigger.
- Non-zero exit or empty stdout → blank status line (used as graceful-degradation signal).

### 14.4 Consequences for GIF export (DEC-005 / DEC-014)

No change. GIF source remains the **Ink expanded view** at its full resolution and framerate (Tier 1: 320×240@8fps; Tier 2: 640×480@15fps; Tier 3: 1280×720@30fps). The compact statusline is deliberately low-fidelity and is not a capture target. `vhs` (DEC-014) scripts drive the Ink expanded mode; Tier-3 captures should use iTerm2/Kitty/Ghostty per DEC-015 notes.

### 14.5 What the statusline mode does not do

- No keyboard interaction. Commands still go to the expanded view or to `glyphling <cmd>` one-shots.
- No REPL.
- No GIF capture.
- No animation smoothness. The compact cycle is a vignette at Claude Code's refresh rate.
- No output >3 rows. Multi-pet display in the statusline shows only the `activePetId`; switching active pet is a command in the expanded view.
- No mutation. The subprocess reads and prints; it never writes state or emits events.

---

## Proposed DECs — ratified 2026-04-17

All proposals were ratified by @product-owner and recorded in `DECISIONS.md`:

- **DEC-009 (Accepted)** — neglect clock uses accumulated seconds **with a wall-clock guardrail** (hybrid: 3 accumulated-neglect-days OR 14 wall-clock days, whichever first). User chose this harder variant over the architect's original 5-accumulated-days proposal ("people love hard challenges"). Pause freezes the accumulator AND extends the wall-clock ceiling.
- **DEC-010 (Accepted)** — `events.jsonl` is the source of truth; `state.json` is a materialised view. As proposed.
- **DEC-011 (Accepted)** — adoption 7-day age subtracts pause intervals. As proposed.
- **DEC-016 (Accepted)** — dual-mode rendering: statusline compact + Ink expanded. As proposed; ratified with @researcher TODO-014 correction that the settings key is `refreshInterval` (seconds, min 1) not `refreshMs`. Snippet in §14.3 updated.
- **DEC-017 (Accepted)** — egg-type names locked as `circuit | rune | shard | bloom` (designer's recommendation). Used as `Pet.species` enum, CompactVocab silhouette keys, and scene-directory names.

See `DECISIONS.md` for the canonical, final wording.

---

## Superseded DEC-016 draft

The "Proposed" draft of DEC-016 below is kept for historical context only; its ratified, canonical wording lives in `DECISIONS.md`.

### DEC-016 (Proposed — superseded by ratified entry in DECISIONS.md) — Dual-mode rendering: statusline compact + Ink expanded

- **Date:** 2026-04-17
- **Status:** Proposed
- **Proposed by:** @architect (user-requested after confirming Claude Code exposes a `statusLine` extension)
- **Context:** Claude Code's `statusLine` extension (configured in `.claude/settings.json`) runs a user-specified shell command on a refresh tick and renders its stdout directly under the chat. This is a natural home for a small always-visible glyphling — pet lives where the user lives. The existing Ink TUI (DEC-001, §7 Renderer) remains valuable for animations, REPL, and GIF capture, but forcing users into a separate terminal window is friction we can now remove. The state layer (DEC-002, DEC-010) already supports many concurrent readers, and the token ingestion pipeline (DEC-012) already writes via hooks independent of any renderer. The rendering layer is the only part that needs to fork.

- **Decision:** Ship glyphling with **two render modes** that share state and diverge only at the presentation layer.

  **(a) Statusline compact mode — primary integration.**
  - Entry point: `glyphling statusline`.
  - One-shot subprocess. Reads `state.json` (no lock — DEC-010 makes it safe-to-read), picks a compact frame for the active pet's current scene, prints one ANSI-styled block (≤3 rows × ≤60 cols) to stdout, exits.
  - Budget: **<50ms P99** wall time, cold start (see §13 risk #6 for mitigations).
  - Refresh is driven by Claude Code's statusline tick (~1–2s cadence assumed; confirm via TODO-014). Compact output is a slow vignette, not smooth animation.
  - Configured by the user via `.claude/settings.json` (see §14.3 for the placeholder snippet).
  - **Does not:** acquire the lockfile, read `events.jsonl`, run an Ink tree, accept keyboard input, expose a REPL, or mutate state.

  **(b) Standalone Ink expanded mode — existing TUI.**
  - Entry point: `glyphling` (bare command).
  - Long-running Ink process (DEC-001, DEC-015). Hosts the REPL, animations at 10–30 fps, command handlers, GIF capture (DEC-005/014), signal collectors, lifecycle clock.
  - Remains the canonical place for anything interactive or high-fidelity.

  **(c) Shared contract changes.**
  - `Scene` (§12.3) gains a `compact: CompactFrame[]` field. Dimensions ≤3 rows × ≤60 cols, ANSI, 256-color safe (truecolor optional). Every scene ships both `frames` and `compact`; empty `compact[]` fails build.
  - Two new modules (§2.2): `render/statusline.ts` (the one-shot renderer) and `render/compact.ts` (CompactVocab — types, ANSI helpers, dispatch table, build-time size assertions).
  - No state-schema change. All data the compact renderer needs is already on `StateFileV1` (§3.2 note). A future `globals.statuslineEnabled?: boolean` toggle is deferred to a follow-up DEC.

- **Non-goals.** The statusline is NOT a replacement for the full TUI. It does not support keyboard interaction, does not host a REPL, does not drive GIF capture, and does not produce >3 rows of output. Users who want to feed, pet, adopt, rename, or export run either the Ink expanded mode or one-shot CLI commands (`glyphling feed`, etc.).

- **Alternatives considered:**
  - **Single-mode statusline only.** Rejected — too limited. Can't host 30fps Tier-3 GIF captures, can't host a REPL, can't hatch/adopt interactively.
  - **Single-mode Ink only.** Rejected — the user explicitly asked for in-window Claude Code integration. Forcing a second terminal is the friction we set out to remove.
  - **Hook-triggered ephemeral print** (e.g., have the Stop hook print a pet glyph inline on each turn). Rejected — fights Claude Code's redraw cycle, pollutes the chat buffer with escape sequences, and couples pet-visibility to turn completion rather than real-time state.
  - **Menubar app / native GUI.** Rejected — wrong stack (DEC-001 is Node + Ink), wrong scope (cross-platform native UI is a separate project), wrong audience (the user lives in a terminal).

- **Trade-offs:**
  - **Gain:** pet lives where the user lives (primary Claude Code window); zero-config for users who just want ambient presence; full TUI preserved for everything expressive.
  - **Lose:** two renderers to maintain; two frame vocabularies (`frames` + `compact`) — designers must produce both; one more entry point and one more subprocess-budget NFR to monitor.
  - **Risks:** statusline subprocess budget (§13 #6); `.claude/settings.json` contract may shift in a future Claude Code release (mitigated by making the snippet paste-in, not a hardcoded install step); parity drift between `frames` and `compact` for the same scene (mitigated by keeping CompactVocab in a shared module with build-time assertions).

- **Consequences for existing decisions:**
  - DEC-001, DEC-002, DEC-010, DEC-012, DEC-013, DEC-015 — unchanged. Reaffirmed: `state.json` as safe-to-read view is precisely the property that enables a lock-free statusline reader.
  - DEC-005 / DEC-014 (GIF export) — unchanged. GIF source is the Ink expanded view; compact frames are not a capture target.
  - §3.1 schema — no fields added. §3.2 gains a DEC-016 note documenting which fields the statusline reads.
  - §12.3 animation contract — extended with `compact: CompactFrame[]`.
  - §13 risks — new risk #6 (subprocess budget).
  - TODO-007 (animation library) — scope grows to include compact frames. Split into TODO-007 (expanded frames, as-is) + new TODO-016 (compact vocabulary).

- **Follow-up if ratified:**
  - @researcher TODO-014 confirms Claude Code's statusline contract (key names, refresh cadence, multi-line support, ANSI support).
  - @web-developer or @backend-developer owns TODO-015 (statusline renderer module).
  - @designer owns TODO-016 (compact-frame vocabulary).
  - `.claude/settings.json` snippet in §14.3 gets post-research confirmation pass; any assumption that proves wrong triggers an ADR amendment, not a rewrite.

---

*End of architecture v1.*
