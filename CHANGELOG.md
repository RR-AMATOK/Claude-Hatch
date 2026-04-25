# Changelog

All notable user-facing changes to glyphling are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

First public preview. Everything listed below is slated for `v0.1.0`.

### Added

- **Hatch a pet from one of four eggs** — `circuit`, `rune`, `shard`, or `bloom`. Each has its own silhouette, accent colour, and idling effects.
- **XP from real coding signals** — commits, test runs, tokens flowing through Claude Code, files you edit, and a daily check-in bonus. Sensible daily caps so a single runaway script can't hijack your progression.
- **Claude Code statusline integration** — `glyphling statusline` is a one-shot renderer under 30 ms per tick. Your pet rides along beneath the prompt, updating every second.
- **Expanded terminal UI** — a full Ink TUI with 22 scenes covering idling, eating, sleeping, playing, levelling up, happy/sad moods, hatching, evolving, and more. Run with `glyphling`.
- **Personality engine** — an eight-trait vector (`Curious`, `Stoic`, `Energetic`, `Friendly`, `Gruff`, `Philosophical`, `Mischievous`, `Paranoid`) that drifts with the languages you use, the hours you keep, and how you treat it. Your pet picks a different idle animation based on who it's becoming.
- **Multi-pet adoption** — once your primary pet has grown up enough, you can adopt additional companions. Up to four can share your shell at once.
- **Lifecycle with teeth** — hunger, sickness, and eventual death are real states on a hybrid accumulated/wall-clock timer that's robust to system sleep, clock skew, and pausing. Pause any time; the clock stops cleanly.
- **GIF export** — `glyphling export 1` produces a short, watermarked snapshot of your pet, perfect for sharing. Higher tiers (longer, sharper, cleaner) unlock as your pet grows.
- **REPL commands** — `feed`, `play`, `rename`, `adopt`, `pause`, `resume`, `export`, and more.
- **Integrity checks** — hash-chained events and transcript cross-verification catch casual state tampering without pretending to be a leaderboard backend. Your pet, your machine; don't cheat yourself.
- **Accessibility** — reduced-motion variants for level-up and other animations via `GLYPHLING_REDUCED_MOTION=1`. Emoji mood glyphs opt-in via `GLYPHLING_RICH_GLYPHS=1`. 256-colour safe by default; truecolour available.
- **Zero telemetry.** No account, no network, no analytics. State lives in `~/.claude/glyphling/` as plain JSON.

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

### Not yet documented

There are a few things deliberately left out of this log. You'll find them yourself.

### Support

If glyphling brightens your terminal, you can [buy me a coffee](https://buymeacoffee.com/888t5ggdv6w). Entirely optional — the project is free and local-only, forever.

---

<!--
  Release format for future versions:

  ## [0.1.0] — YYYY-MM-DD
  ### Added / Changed / Deprecated / Removed / Fixed / Security
-->
