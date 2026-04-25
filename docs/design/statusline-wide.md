# glyphling — Wide-Terminal Statusline Layout (v2)

**Status:** Design spec (for review)
**Author:** @designer
**Date:** 2026-04-17
**Applies to:** `glyphling statusline` one-shot renderer
**Supersedes:** v1 of this doc (centered-ultra-wide + world-strip approach — both removed per user review). `compact-frames.md` §1.3 ("58 is our working width") remains authoritative for the narrow tier; this spec layers a responsive shell on top.
**Related:** DEC-016 (dual-mode, ≤30ms budget), DEC-017 (lowercase species), `docs/design/compact-frames.md`, `docs/design/statusline-wide-silhouettes.md` (companion — 12 wide silhouettes)

---

## 1. Design stance

The statusline is a **quiet companion**, not a dashboard. It sits above the user's code output every second of every day. Linear, Ghostty's built-in prompt, and Starship's "powerline-lite" presets all teach the same lesson: on a wide terminal, you earn attention by *leaving space*, not by filling it. We add horizontal breathing room and one legible zone of peripheral-vision information — never a second row of chrome.

The problem to solve: the previous 58-col-ceiling design left-anchors 4 rows on a 220-col terminal. The eye reads "broken / demo / unfinished" instead of "this is a companion app." We want to reach cognitive-fluency on wide terminals without sacrificing the 60-col contract.

Psychological principles applied:
- **Gestalt proximity:** name/level/xp/mood remain one visual unit even as columns multiply. We do not scatter HUD atoms across the width.
- **Serial position:** the mood glyph (the state indicator the eye catches first) moves to the right edge at wide widths — it becomes the "ending" of the line, which the peak-end rule says is remembered.
- **Von Restorff:** the pet silhouette earns distinctness by *growing*, not by gaining decoration. A larger but simpler pet reads as confident presence; a same-size pet in a sea of chrome reads as noise.

---

## 2. Breakpoint strategy

Read `process.stdout.columns` once at the start of a tick. Cache defaults for CI/pipe contexts where columns is `undefined` (treat as `narrow`).

Three tiers — no fourth. Beyond 140 cols, extra width is spent as **mid-gap breathing room**, not as additional widgets (see §2.1).

| Tier | Column range | Rows | What changes vs. narrow |
|------|--------------|------|-------------------------|
| **narrow** | `cols < 80` | 3 | Status quo — current `compact-frames.md` layout verbatim. Safety net for vertical splits, tmux panes, laptop-only sessions. |
| **standard** | `80 ≤ cols < 140` | 3 | Narrow silhouette (2 rows) + HUD row (1 row). Mood glyph shifts to the right edge of the HUD row; rest of the HUD stays left-anchored. Centre gap between the two groups collapses naturally. |
| **wide** | `cols ≥ 140` | 4 | Wide 4-row silhouette replaces narrow silhouette. HUD row sits on row 4 beside the silhouette's feet. Mood glyph right-anchors on row 4. Centre gap widens as cols grow — no new widgets beyond 140. |

**Note — glyphling does not render session context.** Model, workspace, context %, cost, and session duration are the responsibility of the parallel `claude-usage` project (`../Claude-Usage/`). glyphling's statusline is the pet, the HUD, and nothing else.

### 2.1 Why no fourth tier — the lualine stretch model

Per @design-consultant's research (§2, §4), we adopt the **lualine six-section layout**: left sections `A | B | C` and right sections `X | Y | Z`, with the middle collapsing naturally as terminal width grows.

```
| A  B  C                                                                                 Z |
    ↑ left group (pet · name+level · xp bar · xp numeric)                    ↑ right anchor (mood)
                                 ↑ collapsible gap (grows with terminal width)
```

At 80 cols, the gap is narrow (~10–15 cols). At 220 cols, the gap is generous (~80+ cols). **Both read as composed** because the left group stays internally tight (Gestalt proximity) and the mood glyph anchors the right edge — the gap between them is nothing but whitespace. Not a filler, not a rule, not a ticker. No ultra-wide tier, no centered-at-160 frame, no content duplication. Whitespace is the feature.

**Why 140 as the wide threshold?** At 120 cols, upgrading to a 4-row silhouette and shifting the mood glyph to the right edge still crams — the HUD and the mood end up ≤10 cols apart. At 140+, we get a comfortable 20-col gap minimum that reads as "composition" rather than "two things beside each other."

---

## 3. Layout atoms (what we reuse vs. what we add)

**Reused from `compact-frames.md` (unchanged):**
- 12 narrow species silhouettes (§3.2), mood glyph table (§5.5), 11-token palette (§6), frame cycling via `tick = floor(Date.now()/REFRESH_MS)`.
- Hard rule: narrow silhouettes remain 2 rows × ≤10 cols at narrow/standard tier.

**New — wide silhouettes (authored, not scaled):**
Each species × stage gets a **4-row × ≤18-col** companion silhouette. Re-authored by hand — mechanical upscaling looks wrong. Only used at `wide` tier. Frame cycles stay 2–5 frames; the added rows express *personality* (breath, stand, shadow, antenna, petals, spikes, crown, spark), not bigger pixels. Full specification in `statusline-wide-silhouettes.md`.

**New — mood glyph right-anchor at standard/wide:**
The mood glyph (the HUD atom the eye catches first as a state indicator) migrates from the inline position after XP-numeric to the right edge of the HUD row. It carries the serial-position / peak-end weight at the end of the line. All other HUD atoms stay left-anchored in their existing order.

**Explicitly dropped from this spec:**
- **Session context (model · cwd · ctx% · cost · duration).** Owned by the parallel `claude-usage` project (`../Claude-Usage/`). glyphling does not duplicate or render any of these — the statusline is the pet and the HUD, full stop.
- **World strip.** No ambient event pips, no weather-of-the-code block, no time-of-day glyph. Session telemetry belongs to `claude-usage`.
- **Ultra-wide tier.** Covered in §2.1 — width beyond 140 cols is spent as mid-gap breathing room, not as new widgets or centered frames.
- **Decorative borders / box-drawing rules.** Tested in mock; they turn the pet from "companion" into "widget." Rejected — confirmed by consultant research §3 ("no borders, no background blocks, no Powerline arrows").
- **Quip/status text line.** Would require content strategy and risks reading as marketing copy. Flagged as v2.

---

## 4. Layouts per tier (ASCII mockups)

Each mockup shows the literal rows the renderer should emit. Column ruler uses `.` every 10 cols, `|` every 50.

### 4.1 Narrow (`cols < 80`) — status quo

Circuit-adult, idle-baseline tick 0:
```
.........|.........|.........|.........|.........|........
 /[o-o]\
 +=|--|=+
 Pixel        · Lv   30 · [███████░░░░░░░] 20000     · :|
```

Bloom-juvenile, sleeping tick 0:
```
.........|.........|.........|.........|.........|........
 (~oo~) z
  \vv/  Z
 Mossy        · Lv    7 · [███░░░░░░░░░░░] 540       · zZ
```

No change from current implementation. This is the safety net.

### 4.2 Standard (`80 ≤ cols < 140`) — mood right-anchor

Layout: **3 rows.** Narrow silhouette occupies rows 1–2 at cols 1–10. Row 3 is the HUD row, carrying the left group (silhouette-space · name · level · xp bar · xp numeric) and the mood glyph right-anchored at `cols - 2`. The centre between them is whitespace — no filler glyph, no rule.

Separators:
- Within the left group: ` · ` (space · space).
- Between the left group's trailing atom and the right-anchored mood glyph: whitespace to `cols - mood_width - 2`.

Circuit-adult, idle-baseline, 100-col terminal:
```
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
 /[o-o]\
 +=|--|=+
 Pixel · Lv 30 · [███████░░░░░░░] 20000                                                         :|
```

Bloom-juvenile, sleeping, 100-col terminal:
```
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
 (~oo~) z
  \vv/  Z
 Mossy · Lv 7 · [███░░░░░░░░░░░] 540                                                            zZ
```

Notes:
- The mood glyph moves to the right edge at standard/wide (see §5 serial-position note). At narrow tier it remains inline per `compact-frames.md` so the safety net is unchanged.
- Left group follows the existing palette from `compact-frames.md §6`.
- HUD left-group collapses to the `compact` variant (`compact-frames.md §5.4b`) — single-space separators, no name right-padding. The padded variant looks lonely next to an empty right side.
- Sleeping `z`/`Z` particles migrate to rows 1–2 beside the pet (exactly as narrow). Row 3 stays clean for the HUD.
- At 80 cols exactly, the gap between left group and mood is minimal (~3 cols) — still readable, never truncated.

### 4.3 Wide (`cols ≥ 140`) — upgraded silhouette + mood right-anchor

Layout: **4 rows.** Wide silhouette occupies rows 1–4 at cols 1–18. Row 4 doubles as the HUD row — the silhouette's ground/feet row aligns horizontally with the name+level+xp run, producing a single composed line where the pet "stands on" the HUD. Mood glyph sits on row 4, right-anchored at `cols - 2`.

Circuit-elder (L30), idle-baseline, 160-col terminal:
```
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
    .v.
   /[o-o]\
  +==|--|==+
    |_||_|    Pixel · Lv 30 · [███████░░░░░░░] 20000                                                                                            :|
```

Bloom-adult (L7), sleeping, 160-col terminal:
```
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
    ~ ~
   (~oo~)    z
    \vv/       Z
    ,.,       Mossy · Lv 7 · [███░░░░░░░░░░░] 540                                                                                               zZ
```

Circuit-elder, idle-baseline, 220-col terminal (same layout, wider gap):
```
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
    .v.
   /[o-o]\
  +==|--|==+
    |_||_|    Pixel · Lv 30 · [███████░░░░░░░] 20000                                                                                                                                                                :|
```

Notes:
- Nothing centers. Nothing stretches. The left group anchors at col 0 and the mood glyph anchors at `cols - 2`. The gap in the middle simply grows as the terminal widens — this is the lualine convention (§2.1).
- Row 4 carries both the silhouette's feet/shadow AND the HUD. This is by design: the silhouette occupies cols 0–12 at its widest (circuit-elder row 3), so the HUD starts at col 15 (silhouette-rightmost + 3 spaces of margin) — see `statusline-wide-silhouettes.md §5` for the `WIDE_HUD_START_COL` derivation.
- Sleeping `z`/`Z` particles sit in rows 2–3 to the right of the silhouette (cols 14–18), at safe distance from the HUD. Level-up flash glyphs attach in row 1 above the silhouette — see silhouettes doc for precise anchor cols.
- No row 1 world strip, no session context on any row. Session telemetry belongs to the parallel `claude-usage` project.

---

## 5. HUD hierarchy rules

Non-negotiable HUD atoms, in render order (left group):
1. **Name** — primary identity. `text-primary` (default fg).
2. **Level** — `Lv NN`, `accent-level` cyan.
3. **XP bar** — 14 cells, species accent + `surface-muted`.
4. **XP numeric** — `text-secondary`, k-notation at 4-digit levels.

Right anchor (standard + wide tiers):
5. **Mood glyph** — 2-cell ASCII, colored per mood state. Right-anchored at `cols - 2`.

At narrow tier, atom 5 stays inline at the tail of the left group per `compact-frames.md` — the safety net keeps its original shape.

The four left-group atoms are **always one visual group** with ` · ` separators. The mood glyph is the sole right-anchor — there is no second textual group. Whitespace between them is the composition device, not a filler character.

---

## 6. Reduced-motion handling

Per `compact-frames.md §7`, reduced-motion skips frames marked `reducedMotion: true`. For wide tier specifically:
- Wide silhouettes: under `GLYPHLING_REDUCED_MOTION=1`, drop to 2-frame cycle even if baseline is 4. The 4-row body's added height carries the presence; extra frames are unnecessary. Per-species static-vs-animated row guidance lives in `statusline-wide-silhouettes.md` §3.

---

## 7. Performance contract (DEC-016, ≤30ms)

- Single stdout width read per tick. Tier classification is a 3-branch compare.
- Wide silhouette pack is a plain frozen object keyed by `[species][stage]` → `{ narrow: [r1, r2], wide: [r1, r2, r3, r4] }` — same lookup shape as existing `SILHOUETTES`, no new code-path hotness.
- Right-anchor composition: single `padEnd` to `cols - mood_width - 2` plus the mood glyph. No string allocation beyond the output row.
- No layout libraries. All alignment is `padEnd`/`padStart` against the cached column count. Zero allocation in the happy path beyond the output string.

---

## 8. Interaction with @design-consultant research

This spec implements two patterns directly from the consultant survey:

1. **Lualine stretch model, adapted (§2 of research, §2.1 here).** Left group (pet · name · level · xp · xp numeric) at col 0; single right anchor (mood glyph) at `cols - 2`; collapsible whitespace centre. Consultant called the six-section pattern "rare in prompts but very common in tmux/lualine"; we adopt the stretch principle with one right-anchor atom rather than a full right group, because glyphling explicitly does not render session context (§3).
2. **Right-anchor state-indicator, left-anchor identity (§2, §5 of research, §4 here).** Mood glyph shifts to the right edge; pet + name + XP stay at col 0. Linear / Warp / zsh RPROMPT convention applied to the single atom that benefits most from peak-end placement.

Deviations from consultant findings:
- Consultant suggested `fill` glyphs for the centre (Starship/OMP filler). We do **not** fill — the gap is genuine whitespace. Reason: filler glyphs read as chrome; a glyphling pet sitting next to a row of `·` characters looks caged. Whitespace reads as breathing room.
- Consultant framed the right group as a multi-atom context cluster. We explicitly do not — session context is owned by the parallel `claude-usage` project (§3); the right anchor carries exactly one atom (mood).

Does NOT depend on consultant findings: palette, silhouette vocabulary, mood glyphs, reduced-motion handling, frame cycling — these are carried forward unchanged from `compact-frames.md`.

---

## 9. Open questions (for @product-owner)

1. **Stage-vocabulary alignment** — the wide-silhouettes doc uses `juvenile / adult / elder` labels per user direction, while the existing code uses `hatchling / juvenile / adult`. The three wide silhouettes map positionally (first-stage = hatchling, second = juvenile, third = adult). This is a labels-only difference and should be reconciled before `compact.ts` lookup keys are touched — either rename the code enum (new DEC) or rename the design-doc labels back. Flagged for product-owner call.

---

## 10. Implementation Handoff

**For @web-developer — files to read before starting:**
- `docs/design/compact-frames.md` (authoritative narrow vocabulary, unchanged)
- `docs/design/statusline-wide-silhouettes.md` (companion — all 12 wide silhouettes + cycle compatibility)
- `src/render/compact.ts` (existing `assembleCompactOutput`, `renderHudRow`, `SILHOUETTES`)
- `src/render/statusline.ts` (one-shot entry point)
- `DECISIONS.md` DEC-016 (perf budget, tick model)

**What to generate / edit:**
1. Add `Tier = "narrow" | "standard" | "wide"` and `classifyTier(cols: number | undefined): Tier` to `src/render/compact.ts`. Treat `undefined` and `cols < 80` as `narrow`; `80 ≤ cols < 140` → `standard`; `cols ≥ 140` → `wide`.
2. Extend `SILHOUETTES` from `Record<EggType, Record<LifeStage, SilhouettePair>>` to `Record<EggType, Record<LifeStage, { narrow: readonly [string, string]; wide: readonly [string, string, string, string] }>>`. Narrow entries already exist — do not change them. Wide entries are specified in `statusline-wide-silhouettes.md`.
3. New `assembleWideOutput(pet, tier, sceneKey, tick, cols): string` that composes the silhouette, the HUD row, and the right-anchored mood glyph. `assembleCompactOutput` stays as the narrow-tier entry point.
4. Right-anchor composition is inline in `assembleWideOutput` — no separate helper needed. Pad the HUD row to `cols - moodWidth - 2`, then append the mood glyph. Reuse existing mood resolution from `compact.ts`.
5. `statusline.ts` dispatches on tier: narrow → existing `assembleCompactOutput`; standard/wide → `assembleWideOutput`. **Remove the stdin Claude-info prepend** (`buildClaudeInfoLine` + the conditional write) added in the earlier patch — glyphling does not render session context.

**Scene/type shape:**
- No changes to `CompactFrame`. Wide tier uses the same scene frames; it's the *silhouette pack* that's tier-dependent, not the scene cycle.
- Per-tier silhouettes consumed by the renderer at compose time — scene frames do NOT carry tier metadata. This keeps the scene atlas single-sourced.

**Pitfalls to respect:**
- Do **not** call `process.stdout.columns` inside frame cycles — read once per tick at the top of the render function.
- Right-alignment math must strip ANSI SGR before measuring width. Reuse `visibleWidth()` already in `compact.ts`.
- Row 4 collision at wide tier: the silhouette's ground row (row 4) ends at varying cols per species/stage — see `statusline-wide-silhouettes.md` §3 for max visible-width per species. HUD start col = `max(species-widths) + 3`. Hard-code this as a constant (`WIDE_HUD_START_COL`) rather than recomputing per tick.
- At the 60-col ceiling assertion in `assertFrameDimensions()`, the wide silhouette pack will exceed the current `MAX_COLS = 60` check. Add a separate `assertWideFrameDimensions()` with `MAX_COLS_WIDE = 18` for the silhouette portion alone, and compose total-width check at the top level. Preserves the narrow-tier invariant.

**Validation test recipe:**
Add `src/render/compact.widetier.test.ts`:
- `classifyTier(undefined) === "narrow"`, `classifyTier(79) === "narrow"`, `classifyTier(80) === "standard"`, `classifyTier(139) === "standard"`, `classifyTier(140) === "wide"`, `classifyTier(500) === "wide"`.
- `assembleWideOutput(pet, "standard", "idle-baseline", 0, 100)` emits exactly 3 rows; no row has visible width > cached `cols`; the mood glyph's last visible col == `cols - 2` on row 3.
- `assembleWideOutput(pet, "wide", ..., 160)` emits exactly 4 rows; silhouette occupies cols 0–17 on rows 1–4; HUD starts at `WIDE_HUD_START_COL` on row 4; the mood glyph's last visible col == `cols - 2` on row 4.
- Reduced-motion (`GLYPHLING_REDUCED_MOTION=1`): wide-tier output is deterministic across 10 consecutive ticks (no frame cycling).
- Perf: running `assembleWideOutput` 1000 times completes in <500ms on the dev box (avg ≤0.5ms per call — well within the 30ms tick budget).

**Flagged missing artifacts:**
- Stage-vocabulary reconciliation (§9.1) — product-owner call.

*End of wide-terminal statusline spec v2.*
