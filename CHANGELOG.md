# Changelog

All notable user-facing changes to glyphling are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1-beta.1] — 2026-05-04

Re-roll of `1.0.1-beta.0` after a release-infrastructure bug. The previous beta tag was created at the wrong commit (always `main`'s HEAD instead of the workflow's actual SHA), so `publish.yml` read `1.0.0` from the tag's checkout and 404'd. This version exists to validate the fix end-to-end.

### Fixed
- `release.yml` now passes `target_commitish: ${{ github.sha }}` to `softprops/action-gh-release`. Without it, the GitHub API defaults to the repository's default branch HEAD when creating a tag — meaning every tag created from a non-default branch (like `beta`) silently landed on `main`'s tip. The bug walked: first attempt landed on the zod-bump commit, second on the softprops-bump commit.

### Validates
- The `target_commitish` fix produces a tag at the correct commit (beta HEAD).
- Downstream `publish.yml` dispatch reads the correct `package.json#version` and publishes to `@beta`.

---

## [1.0.1-beta.0] — 2026-05-04

First beta in the post-1.0.0 cycle. No user-facing changes from `1.0.0` — this version exists to validate the bump-driven release flow on the `beta` branch end-to-end: `release.yml` detects bump → tag + GitHub Release → `publish.yml` dispatched via `gh` CLI → npm publishes via OIDC trusted-publisher to `@beta`.

The `beta` branch is also catching up to `main`'s history in this commit; the previous `0.1.1-beta.X` lineage is superseded.

### Validates
- `release.yml` push trigger fires on `beta` for the first time.
- Explicit `gh workflow run publish.yml` dispatch from `release.yml` (PR #54) bypasses the `GITHUB_TOKEN` event-suppression rule.
- OIDC trusted-publisher routing for `publish.yml` + `publish` environment after the npm-side re-registration with 2FA mode "Require 2FA and disallow tokens."
- `changelog-check.yml` PR gate on the `beta` branch.

---

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
