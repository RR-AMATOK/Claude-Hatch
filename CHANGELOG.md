# Changelog

All notable user-facing changes to glyphling are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-05-15

The pet now wanders. In both renderers.

### Added

- **Pet wander in the expanded Ink TUI (`npm run dev` / `glyphling`).** The pet drifts left and right inside a 40-column arena, hopping ~2 cells per second, bouncing off the edges with a brief pause to "notice the wall" before turning around. Drift halts during one-shot scenes (eating, playing, level-up, hatching, evolving, death) so animations don't slide mid-scene; continues through `sick` / `sad` / `sleep` as a "miserable shuffle" that reads as character. Honors `NO_MOTION=1` and `GLYPHLING_REDUCED_MOTION=1` (pet stays put). Position is per-session — never persisted to the pet schema.
- **Pet wander in the Claude Code statusline.** The statusline pet now moves too, at standard tier (≥80 cols) and wide tier (≥140 cols). Cadence is 1 cell/sec at the 1 Hz statusline refresh — a discrete "tick-tock" stroll backed by the same gestalt apparent-motion threshold that makes mechanical clock second-hands feel alive. One-shot scenes (`eating | playing | petted | level-up | death`) and reduced-motion both center-snap the pet so it pauses center-stage to do the action.

### Changed

- **Wide-tier statusline now emits 5 rows instead of 4.** Silhouette rows 1–4 translate together as one composed creature; HUD glyphs (name · level · XP bar · mood) live on a dedicated row 5 that never moves with the pet. The previous 4-row layout shared the silhouette's "ground" row with the HUD, which would have created a visual disconnect once the silhouette began wandering. Narrow (1–2 rows) and standard (3 rows) tiers are unchanged.

### Notes

- Narrow tier (<80 cols) ships without wander by design — too cramped at 1 Hz refresh.
- The wander cadence differs between renderers by regime necessity: 500 ms steps (≈2 Hz) in the TUI's React render loop, 1000 ms steps (1 Hz) in the statusline's one-shot subprocess. Both produce ~1 s of visible pause at edges; same user-perceived behavior, different mechanical encoding.
- Under `refreshInterval ≥ 3` in your Claude Code `statusLine` config the wander degrades to perceived teleport. Keep `refreshInterval: 1` for smooth ambient drift.

## [1.0.0] — 2026-04-30

First stable release. The pet you live with — fed by your real coding work, reacting to your slash commands, persisting across sessions.

### Added since 0.1.0

- **Statusline reactions to slash commands.** `/glyph-feed`, `/glyph-play`, and `/glyph-pet` now produce visible scene transitions in the Claude Code statusline (eating / playing / petted), each guaranteed to play long enough to register at the 1 Hz refresh.
- **`glyphling install`** — copies the bundled `/glyph-*` slash commands into `~/.claude/commands/` so they appear in Claude Code's `/` autocomplete. Idempotent; `--uninstall` removes only what it installed.
- **One-shot scene dispatch from real events.** Feeding, playing, levelling up, hatching, and evolving each emit a windowed scene that survives TUI restarts (frames derived from elapsed wall-clock).
- **`glyphling --version` / `-V`** — fast-path that exits before booting Ink.
- **Per-species statusline frames** for shard at every life stage, plus the three idle variants for all four species across hatchling/juvenile/adult.
- **HUD validation banner** — when `state.json` fails schema validation, the TUI surfaces a dim-red banner instead of silently rendering stale state.
- **Conventional commit slash command pack** — `/glyph-doctor`, `/glyph-status`, `/glyph-pets`, `/glyph-pause`, `/glyph-resume`, `/glyph-name`, `/glyph-hatch` ship alongside feed/play/pet.

### Changed

- **Golden-ratio XP curve.** The level cap is **1618** — the Golden Level (⌊φ × 1000⌋). The XP curve is `xpToNext(L) = floor(2 · L^φ)` — the exponent is φ itself. Daily caps removed; raw XP keeps accumulating past the cap as a vanity counter.
- **Token denominator** — 1 XP per 1000 tokens (was 1 per 500).
- **Single-flight token collector** — at most one `appendEvent` in flight per collector at a time; concurrent emissions fold into a trailing batch. Capped exponential backoff on lock contention.
- **Statusline reader** is hardened against torn reads with a small-jitter retry policy.

### Fixed

- **Daemon-offline chain healing** (DEC-022). Previously, if `glyphling watch` was offline for more than 24 h (laptop sleep, host restart, a crash), the chain entered a permanent loop where every fresh event was clamped 60 s ahead of the stale `lastEventAt` — slower than wall-clock — and reactions silently broke. Now: the first emit after a >24 h gap appends a `daemon.resync` audit event and the chain re-anchors to real-now in one step.
- **XP-bar sawtooth** — the colourised bar now uses the cumulative DEC-020 formula consistently; the bar no longer reaches full and resets several times per level.
- **`/glyph-pet` event semantics** — uses its own `pet.petted` event type instead of misusing `pet.fed`.

### Infrastructure

- Multi-branch CI/CD topology (`feature → dev → beta → main`), tag-driven publishing, OIDC trusted-publisher routing, cross-platform smoke-pack matrix on Node 20/22 × Ubuntu/macOS, audit-ci, and CodeQL.

### Configuration

- `GLYPHLING_HOME` — override the state directory (required for `npm run dev`; optional in production)
- `GLYPHLING_RICH_GLYPHS=1` — use emoji mood glyphs instead of ASCII
- `GLYPHLING_TRUECOLOR=1` — opt in to 24-bit colour
- `GLYPHLING_REDUCED_MOTION=1` — shorter, calmer animation variants
- `NO_256COLOR=1` — fall back to ANSI-16 for legacy terminals

### Requirements

- Node.js 20 or newer
- [`vhs`](https://github.com/charmbracelet/vhs) for GIF export — `brew install vhs` (optional; only needed when you run `glyphling export`)
- macOS and Linux supported. Windows untested — reports welcome.

### Support

If glyphling brightens your terminal, you can [buy me a coffee](https://buymeacoffee.com/888t5ggdv6w). Entirely optional — the project is free and local-only, forever.

---

## [0.1.0] — 2026-04-25

First public preview. Established the core loop: hatch from one of four eggs (`circuit` / `rune` / `shard` / `bloom`), earn XP from real coding signals (commits, tests, tokens, file edits, daily check-ins), live in the Claude Code statusline as a one-shot ≤30 ms renderer, and run alongside the full Ink TUI with 22 scenes.

### Added

- Egg hatching, XP engine, multi-pet adoption (up to four pets), eight-trait personality engine.
- Statusline + expanded TUI render paths.
- Hybrid lifecycle clock — accumulated-neglect days plus wall-clock days, robust to sleep / pause / clock skew.
- GIF export via `vhs`, tier-gated by level.
- Hash-chained events with transcript cross-verification.
- Reduced-motion variant, opt-in emoji glyphs, 256-colour by default with truecolour available.
- Zero telemetry. State in `~/.claude/glyphling/` as plain JSON.

---

<!--
  Release format for future versions:

  ## [X.Y.Z] — YYYY-MM-DD
  ### Added / Changed / Deprecated / Removed / Fixed / Security
-->
