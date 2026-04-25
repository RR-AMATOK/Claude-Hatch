# CLAUDE.md

## Project Overview

`glyphling` is a Tamagotchi-like terminal pet companion that lives alongside Claude Code sessions. It persists a small JSON world model to `~/.claude/glyphling/` and awards XP to your pet based on real coding signals (tokens, commits, tests, file edits, daily check-ins). The level cap is **1024** — a rare binary-themed achievement. Glyphling ships two render modes: a one-shot compact statusline subprocess that puts the pet directly in the Claude Code window (DEC-016), and a long-running Ink TUI with full animations, REPL, and GIF export.

See [`docs/architecture.md`](docs/architecture.md) for the full design and [`docs/design/compact-frames.md`](docs/design/compact-frames.md) for the statusline frame vocabulary spec.

## Tech Stack

- **Runtime:** Node.js ≥ 20, TypeScript (strict, es2022, nodenext), distributed as a single npm binary (`glyphling`)
- **TUI:** Ink `^5.1.0` + React 18
- **State:** JSON file + `proper-lockfile@4.1.2` + chokidar file-watch + `ulid`
- **Validation:** zod
- **Testing:** Vitest `^2.1.8`
- **GIF export:** `vhs` (external brew binary — `brew install vhs`; not an npm dep per DEC-014)
- **No Python. No FastAPI. No Postgres. No Redis. No Docker.**

## Agent Team

Start with the orchestrator:

```
claude --agent product-owner
```

Or invoke agents directly:

```
@product-owner   Plan a new feature or triage tasks
@architect       Design or extend the architecture
@designer        Frame vocabulary, animation, and visual design
@backend-developer  State, XP engine, lifecycle, signals, statusline renderer
@web-developer   Ink components, REPL, animation implementation
@qa-engineer     Acceptance criteria verification, integration tests
@technical-writer  Documentation, CLAUDE.md, README
```

### Agent Pipeline

```
User → Product Owner → Architect →
Designer ←→ Design Consultant →
Developers → Code Reviewer → QA →
Technical Writer → Done
```

### Session Protocol

Agents follow this protocol via the `project-state` skill:

**Session start:** Read `HANDOFF.md` → `TODOS.md` → `MEMORY.md` → `DECISIONS.md` → `CHANGELOG-DEV.md`
**Session end:** Update `TODOS.md` → Append `CHANGELOG-DEV.md` → Append `MEMORY.md` → Update `HANDOFF.md`

### Project State Files

**DEC-007 override:** coordination files live at the **project root**, NOT under `.claude/state/`.

| File | Purpose | Who writes |
|------|---------|-----------|
| `HANDOFF.md` | Current session state — first read, last write | Last active agent |
| `TODOS.md` | Task tracker with status and acceptance criteria | Product Owner creates; all agents update |
| `MEMORY.md` | Project invariants, gotchas, accumulated knowledge | Any agent |
| `DECISIONS.md` | Architecture decision log (DEC-001 … DEC-017+) | Architect, Product Owner |
| `CHANGELOG-DEV.md` | Chronological dev log, most recent first | Developer agents after completing work |
| `docs/architecture.md` | Module map, schema, protocols, NFRs | Architect |
| `docs/design/compact-frames.md` | Compact statusline frame vocabulary | Designer |

## Getting Started

```bash
npm install

# Launch Ink TUI (writes to ./.dev-state/dev — never touches ~/.claude/)
npm run dev

# Run all tests (89/89 as of TODO-005; writes to ./.dev-state/test)
npm test

# Type-check without emitting
npm run typecheck

# Compile to dist/
npm run build
```

Future entry points (not yet implemented):

```bash
glyphling               # Long-running Ink TUI (expanded mode)
glyphling statusline    # One-shot compact renderer for Claude Code statusLine (DEC-016)
```

## Run in Claude Code

Add this to `.claude/settings.json` to show the pet in your Claude Code window:

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

`refreshInterval` is in **seconds** (minimum 1; 1 Hz floor). Claude Code enforces a hardcoded **5 s subprocess timeout** — the compact renderer targets ≤30 ms per tick to leave margin on slow hardware.

## Dev / Runtime Path Split (DEC-008)

| Context | State root | Set by |
|---------|-----------|--------|
| `npm run dev` | `./.dev-state/dev` | `package.json` script |
| `npm run demo` | `./.dev-state/demo` | `package.json` script |
| `npm test` | `./.dev-state/test` | `package.json` script |
| Production install | `~/.claude/glyphling/` | default fallback |
| Override | any path | `GLYPHLING_HOME` env var |

The CLI **refuses to start** in non-production mode if the resolved path is under `~/.claude/`. Tests use `os.tmpdir()` for filesystem fixtures. `.dev-state/` is gitignored.

## Key Directories

```
src/
  adoption/       # Adoption gate + multi-pet management
  commands/       # REPL parser + command handlers
  config/         # env.ts — GLYPHLING_HOME resolver + DEC-008 startup guard
  events/         # In-process event bus
  export/         # GIF export (shells out to vhs)
  lifecycle/      # Death timer (DEC-009 hybrid threshold)
  personality/    # 8-trait vector engine
  render/         # App.tsx (Ink), animation hook, statusline.ts (one-shot)
  signals/        # Token, commit, test, edit, daily signal collectors
  state/          # schema.ts, store.ts, persistence.ts, lockfile.ts
  util/           # Shared helpers
  xp/             # XP engine + DEC-004 curve
animations/       # Animation data modules (types.ts + scene data by species)
docs/             # Architecture and design specs
.dev-state/       # Dev/test state (gitignored)
```

Tests are co-located with source as `*.test.ts` files.

## Testing

- **Runner:** Vitest
- **Location:** co-located with source (`src/**/*.test.ts`)
- **Filesystem fixtures:** use `os.tmpdir()` — never write to the project directory or `~/.claude/`
- Follow the `testing-strategy` skill for structure and coverage expectations
- Run `npm test` before submitting any change

## Code Style

- Follow the `code-standards` skill for naming, error handling, and logging
- Follow the `git-workflow` skill for branches, commits, and PRs
- `security-checklist` and `api-design` apply minimally — this is a CLI binary, not an HTTP service

## Environment Variables

```
GLYPHLING_HOME          # Override the state root (required for dev; optional in production)
GLYPHLING_RICH_GLYPHS=1 # Opt-in to emoji mood glyphs (default: ASCII)
```

No `.env` file is needed. The CLI reads these directly from the environment.

## Invariants (never break without a new DEC)

- **1024 is sacred.** The level cap is 1024. Do not round, re-cap, relabel, or soften this number.
- **Death rule is hybrid (DEC-009):** pet dies on 3 accumulated-neglect-days OR 14 wall-clock days since last interaction, whichever comes first. Pause freezes both axes.
- **Dev state stays isolated.** `npm run dev/demo/test` never writes to `~/.claude/`. The CLI enforces this at startup.
- **Egg species are lowercase (DEC-017):** `circuit`, `rune`, `shard`, `bloom`. These are the `Pet.species` enum values, `CompactVocab` silhouette keys, and `animations/<species>/` directory names. Do not use the old straw-man names (`Silicon`, `Cosmic`, `Bytebeast`, `Root`).
- **Never add `Co-Authored-By: Claude ...` trailers to commits.** Omit the trailer entirely on every commit.
