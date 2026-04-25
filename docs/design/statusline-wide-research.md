# Wide-Terminal Statusline — Design Pattern Research

**Status:** Research findings (for @designer)
**Author:** @design-consultant
**Date:** 2026-04-17
**Applies to:** Compact statusLine renderer width-responsiveness (DEC-016)
**Companion to:** [`compact-frames.md`](compact-frames.md)

---

## 1. Width-responsive shell prompts

All four reference prompts treat width as **soft** and lean heavily on **truncation** rather than breakpoint module swaps — hard breakpoints are rare in this space.

- **Starship** ([docs/config/README.md](https://starship.rs/config/)) exposes no "narrow/wide" switch. Width-responsiveness happens two ways:
  - `right_format` aligns modules to the cursor line; the gap between left and right is raw padding, not a filler.
  - The **`fill` module** (`format = 'AA $fill BB $fill CC'` with `[fill] symbol='-'`) stretches a repeating character across leftover columns — this is Starship's canonical way to anchor groups to left + centre + right on a single line. Multiple `$fill` tokens split space evenly.
- **Oh My Posh** ([configuration/block](https://ohmyposh.dev/docs/configuration/block)) is the most explicit: blocks carry `alignment` (`left`/`right`), a `filler` string, and an `overflow` mode (`break` to drop to a new line, `hide` to suppress). The `filler` template can branch on `.Overflow` (`"{{ if .Overflow }} {{ else }}-{{ end }}"`) — i.e. *draw dots only if the right block actually fit on the same line*. This is the cleanest prior-art answer to "don't leave a visual gap that looks broken."
- **Powerlevel10k** ([README §Directory Truncation](https://github.com/romkatv/powerlevel10k)) hard-codes no breakpoints either; instead `POWERLEVEL9K_LEFT_PROMPT_ELEMENTS` and `..._RIGHT_PROMPT_ELEMENTS` split modules across the line. Its philosophy on overflow: "the leftmost segment gets truncated to its shortest unique prefix… important segments are bright and never truncated." Truncated segments are rendered **bleak** so degradation is visible.
- **Spaceship** just adds a conditional newline (`SPACESHIP_PROMPT_ADD_NEWLINE`) and hides optional sections when empty — no width math.

**Takeaway:** No mainstream prompt codifies "narrow/standard/wide" thresholds. They degrade gracefully via (a) right-anchor + filler, (b) prefix-truncation of the most expendable segment, (c) module hide-on-overflow.

## 2. Right-alignment patterns

The convention that emerged from zsh `RPROMPT` → p10k → Starship → OMP is **three-column, one-line**: left = identity/context (model, branch), right = status/metrics (errors, time, exit code), **filler in between**. OMP's [`filler` template](https://ohmyposh.dev/docs/configuration/block#filler) is the canonical trick for avoiding a "broken mid-line gap": leave it blank when the right block got pushed to a new line, fill with `.` or `·` otherwise.

Three-column (left | center | right) is *rare in prompts* because the cursor anchors the right edge, but **very common in tmux status-line** and **lualine** (`lualine_a/b/c` left, `x/y/z` right — see `README` ASCII: `| A | B | C     X | Y | Z |`). Lualine treats the centre as "unused space that collapses gracefully" rather than a third real column — worth copying. Dedicated centre columns (OMP calls this "three blocks") are possible but read as dashboardy; users perceive true three-column layouts as more airplane-cockpit than IDE.

## 3. Multi-line statusline aesthetics

Calm vs. noisy comes down to three decisions: **rules vs. no-rules**, **icons vs. glyphs**, **colour blocks vs. tint-on-text**.

- **Calm (borrow from these):**
  - **GitHub CLI** (`gh`) — spacing and `·` separators, no borders, colour only on state tokens.
  - **Vercel CLI** — leading glyph (`●`, `▲`) + space + text, single accent colour per line, no boxes.
  - **Linear CLI** — keyboard hints at the right edge in dim grey (secondary info leans right).
  - **Starship multiline preset** (`fill` + newline + `character`) — the trailing `❯` on its own line creates a pause.
- **Noisy (avoid):**
  - **Powerline/airline** Vim statuslines — solid background blocks with arrow separators read as dashboard chrome; great for mode awareness at a glance, terrible for ambient/peripheral UI because they pull focus.
  - **lualine `evil` / `cosmicink` presets** — beautiful but very loud; your pet will compete with them.
- **tmux** ([`status.c`](https://github.com/tmux/tmux/blob/master/status.c)) lets users set `status-left`, `status-right`, and `status 2|3|4|5` (up to 5 status rows), each with independent format strings — i.e. the idiomatic multi-line TUI status **keeps each row with a single semantic job**. Don't mix pet art and metrics on the same row.

**Hierarchy tricks used by the calm tools:** (1) a blank row or a faint horizontal `─` rule between semantic groups, (2) the primary info at column 0 and secondary info right-aligned, (3) dim grey (ANSI 8 / 256-colour 240) for anything the user already knows.

## 4. ASCII/TUI art in status context

Tools that render character art in persistent/ambient chrome fall into two groups: **fixed-size** and **breakpoint-stepped**. **Fluid/scaled ASCII is essentially never done well** — sprite art does not downscale via interpolation the way raster does.

- **bongo-cat-cli**, **nyancat**, **pipes.sh** — all fixed-size; they *don't care* about terminal width because they assume a full window. Not useful for a statusline.
- **pokeget-rs** ([README](https://github.com/talwat/pokeget-rs)) supports a `--small` flag that uses Unicode half-block characters (`▀`) to render sprites at **2× vertical density in 1× horizontal cells** — a viable trick for a wider statusline pet that wants more detail without more rows.
- **Pokémon-Terminal**, **pokesay** — pick a sprite size at start; no runtime responsiveness.
- **asciiquarium** / **cbonsai** — full-screen, decorative; precedent for "art breathes when given space" but not for shrinking.

**For a pet-style companion specifically:** the robust pattern is **discrete size tiers** ("poses"), not smooth scaling. Pick three — e.g. `tiny` (2 rows × 9 cols, current), `standard` (3 rows × 14 cols), `roomy` (4–5 rows × 24 cols with ground line, shadow, breath particles) — and snap to the tier that fits. This mirrors how Apple's SF Symbols handle scale (small/medium/large variants rather than vector scaling) and preserves intentional pixel placement.

## 5. Context-window / cost displays in modern AI tooling

- **Claude Code** ([statusline docs](https://docs.anthropic.com/en/docs/claude-code/statusline)) publishes the schema we already consume: `model.display_name`, `context_window.used_percentage`, `context_window.remaining_percentage`, `cost.total_cost_usd`, `cost.total_duration_ms`, `rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.used_percentage`. Its own official example on the docs page: multi-line with **line 1 = git info, line 2 = colour-coded context bar**. Anthropic's house template pairs `[Model]` brackets + dir + `N% context` + a progress bar — minimal.
- **Aider** — status line format is `model · repo · tokens sent/received · $cost`, separated by `·`. Plain text, one line, no colour by default. Legible because of consistent separator.
- **Cursor / Cody** — integrated into IDE chrome; the pattern is **icon + short label + percent** (e.g. `◐ 47k / 200k`), right-aligned.

**Minimal/legible:** `Opus · 8% ctx · $0.12` (3–4 tokens, `·` separators, no boxes).
**Cluttered:** stacking model name + model id + every percent + every cost + duration on one row, with mixed brackets and pipes.

For glyphling specifically: we already show `Opus 4.7 · claude-usage · ctx 80%` — this is on the calm side. Widening gives us room to **add** (e.g. `$cost`, `5h: 23%`) without rearranging.

## 6. The "companion in your terminal" archetype

- **Clippy (1997)** — *lesson: interruption kills trust.* Clippy's failure was not the character; it was that it popped up unsolicited, covering the user's work. Glyphling must **never** redraw loudly; a 1 Hz quiet pose is correct.
- **Duolingo owl (Duo)** — *lesson: peripheral presence + occasional peaks beats constant chatter.* Duo lives in the margin 99% of the time and only performs during milestones. Maps directly to our Peak-end rule commitment in `compact-frames.md` §1.
- **GitHub Copilot ghost text / Cursor Tab** — *lesson: the "companion" can be very small and still feel present.* No face required. Just a reliable, predictable signal.
- **Warp's AI command suggestions**, **Fig's inline autocomplete** — *lesson: companion UI that occupies a consistent spatial slot becomes invisible in the good way (trusted chrome) rather than the bad way (banner blindness).* Pin the pet to a predictable screen region.
- **Backfires:** Microsoft BOB, AOL's "You've got mail!" Jim, Office Assistants generally — all failed where they took screen real estate without offering a matching payoff. A wide-mode glyphling must **earn** every extra column: more personality expression, not just bigger pet.

---

## Recommendations for @designer

Lift any of these directly into the wide-terminal layout spec:

- **Three discrete width tiers, not fluid scaling.** Snap to `narrow` (≤80 cols, current), `standard` (81–140 cols), `wide` (≥141 cols). Document the thresholds in `compact-frames.md` §2 as explicit constants. This matches p10k/Starship's "degrade gracefully" posture while giving us deterministic test fixtures.
- **Use the Oh-My-Posh `overflow` + `filler` model as the mental model.** Pick one: `overflow: hide` for non-critical segments (cost, rate-limit), `overflow: break` never (we have a fixed row budget). Fillers should branch on whether the right group actually landed on the same line — use `·` when it fit, blanks when it wrapped, to avoid broken-looking mid-line gaps.
- **Adopt lualine's six-section model for wide mode:** `A|B|C` left (pet silhouette, name+level, XP bar), `X|Y|Z` right (mood, context %, cost / rate-limit). The centre gap collapses naturally; don't add a real third column.
- **Pet scales by tier, not by columns.** Design a `standard` and a `roomy` silhouette per species (3-tier total incl. current `tiny`). Roomy earns extra rows with a ground line, shadow, or breath particle — *personality expression*, not bigger pixels. This is the Duolingo-owl lesson: peripheral presence earns its space.
- **Right-anchor metrics, left-anchor identity.** On wide mode, model/context/cost shift to the right edge (Linear/Warp convention); pet + name + XP stay anchored to column 0 so the eye can still lock onto the pet at the same screen position it always occupies.
- **Use truncation, not module-hiding, as the primary overflow response.** When the cost string is long, prefix-truncate model name first ("Opus 4.7" → "Opus"), as p10k does ("bleak" dim tint on truncated tokens signals degradation without alarm).
- **Keep row 1 semantic, not decorative.** tmux and Claude Code's own docs model this: one semantic job per row. Row 1 = Claude session context, row 2 = pet HUD (name, level, XP), rows 3–4 = pet art. Don't mix cost metrics into the pet art row even if space exists.
- **No borders, no background blocks, no Powerline arrows.** Ambient-chrome companions (Duo, Copilot ghost text) read as calm because they render as *text with tint*, not *boxes with fill*. Dim grey (ANSI 240) for secondary info; accent colour for state changes (mood shift, level-up); default for baseline.

---

## References (WebFetch sources)

- Starship config: https://starship.rs/config/ (fetched 2026-04-17) — `fill` module, `right_format`.
- Starship advanced: https://raw.githubusercontent.com/starship/starship/master/docs/advanced-config/README.md — "Enable Right Prompt" section.
- Oh My Posh block: https://ohmyposh.dev/docs/configuration/block — `filler`, `overflow: break|hide`, `alignment`, `.Overflow` template branch.
- Powerlevel10k README: https://github.com/romkatv/powerlevel10k — directory truncation + bleak tint + `LEFT/RIGHT_PROMPT_ELEMENTS`.
- Spaceship README: https://github.com/spaceship-prompt/spaceship-prompt.
- Claude Code statusline docs: https://docs.anthropic.com/en/docs/claude-code/statusline — JSON schema, multi-line example (git + context bar), 300ms debounce, workspace trust caveat.
- lualine README: https://github.com/nvim-lualine/lualine.nvim — six-section `A|B|C … X|Y|Z` model, `component_separators`, `globalstatus`.
- pokeget-rs README: https://github.com/talwat/pokeget-rs — half-block `▀` trick for 2× vertical density.
