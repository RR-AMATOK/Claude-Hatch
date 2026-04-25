# glyphling — Expanded-Frame Animation Spec (v1)

**Status:** Design spec (for review)
**Author:** @designer
**Date:** 2026-04-17
**Applies to:** Ink expanded-mode TUI (long-running, `glyphling` bare command). Paired companion to `docs/design/compact-frames.md`.
**Related:** DEC-001 (Ink), DEC-002 (4 eggs + 20+ animations), DEC-004 (1024 cap), DEC-005 (3 GIF tiers), DEC-009 (hybrid death), DEC-015 (`useFrame(fps)` + React.memo + Ink pitfalls), DEC-016 (dual-mode render), DEC-017 (`circuit | rune | shard | bloom`), architecture.md §12.3 (`Scene` contract incl. `compact: CompactFrame[]`).

---

## 1. Overview

The **expanded view** is the long-running Ink TUI — the place where glyphling stops being a status-glyph and starts being a performed thing. It hosts the REPL, the 10–30 fps animation engine, GIF capture (DEC-005/014), the pet foregrounded at a readable size, and every moment that deserves more than a 1 Hz vignette (hatch, evolve, level-up, ascend, death).

**Relationship to the statusline (DEC-016).** Every scene defined here must also ship a `compact: CompactFrame[]` counterpart (sized ≤3×≤60, 1 Hz vignette) — that's the primary-integration path. The expanded view is where the *motion* lives; the compact view is where the *presence* lives. This spec defines the expanded-view half; the compact half is already specified in `compact-frames.md`.

### 1.1 Frame-budget envelope

| Dimension | Value | Rationale |
|-----------|-------|-----------|
| Pet cell width | 20 cols | Adult silhouette can render at ~16 cols with breathing room; leaves margin for particle effects (sparks, petals, food crumbs) that exit the silhouette bounds. |
| Pet cell height | 6 rows | Adult silhouette ~4 rows + 1 row above for effects + 1 row below for shadow/ground. |
| Pet cell total | 6 rows × 20 cols | Fixed-size. DEC-015: no `Box borderStyle` on this cell (re-layout cost). Border lives on the parent zone. |
| Stage wrap (wide-terminal layout) | ~80 cols × ~20 rows | Matches a conservative 80×24 terminal with room for prompt + header; cinematic scenes (hatch / evolve / ascend) may use the full stage. |

### 1.2 FPS targets

| Mode | fps | Scenes |
|------|-----|--------|
| Ambient | **10 fps** baseline | all idles, sleeping, sad, sick, happy loops — the 99% case. Matches architecture §10 NFR. |
| Action | **15 fps** | eat, play, hatch, evolving wind-up — mid-energy. |
| Peak burst | **30 fps** short window (≤2 s) | `levelup-flash`, `hatch-emerge`, `evolve-shimmer`, `death-fade`, `ascend-1024`. Matches architecture §10 NFR + DEC-005 Tier 3. |
| Ascend vignette loop | 10 fps | After the one-shot `ascend-1024` plays, the pet returns to an idle with a gold aura at 10 fps. |

Per-scene FPS is encoded on the Scene as metadata (§4.6) so the `AnimationEngine` and `useFrame(fps)` hook can drive each scene at its authored rate.

### 1.3 DEC-015 Ink pitfalls honored throughout this spec

All scene specifications below respect these implementation constraints (copied to the authoring checklist in §11):

- **Fixed-size parent `<Box>`.** The pet zone is a fixed 6×20 region regardless of frame content. Frames never cause the parent to grow or shrink → no reconciliation thrash on every tick.
- **Animated content lives inside `<Text>`.** Borders live on the *parent* static Box, never on the animated child.
- **No work inside `setInterval` callback.** `useFrame(fps)` only advances an index; the render function looks up `frames[idx]` at render time.
- **React.memo the frame cell.** The expensive reconciliation is the Text node; memoizing on `(sceneId, frameIdx, speciesKey, stageKey, paletteToken)` ensures we only repaint the cell that changed.
- **Apple Terminal flicker warning.** At 30 fps burst, long-scrollback Apple Terminal can flicker; document iTerm2/Kitty/Ghostty as the recommended Tier-3 capture terminals (already in DEC-015 notes).

---

## 2. Layout Zones

The expanded view composes **five zones** inside the Ink tree, matching architecture §2.2 module 7 (`<App />`) + module 10 (`<Prompt>`).

### 2.1 Wireframe (reference 80×24 terminal)

```
┌─ glyphling ──────────────────────────────────────────────────── [1/4] ──┐   ← header
│                                                                          │
│                       . '  *  '  .                                       │   ← stage: effects row
│                        /[o-o]\                                           │   ← stage: pet top
│                        +=|--|=+                                          │   ← stage: pet mid
│                         -~~~~-                                           │   ← stage: shadow row
│                                                                          │
│  Pixel  ·  circuit  ·  Lv 42 Energetic                                  │   ← status bar (1 row)
│  XP  [████████░░░░░░]  1240 / 2200        age 3d12h  · mood :)  · fed  │   ← status bar (1 row)
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤   ← log divider
│ 12:14  level up! 41 → 42                                                 │   ← log panel
│ 12:13  fed pixel (+5 xp)                                                 │   ← (scrollable)
│ 12:09  committed 47a3f (+25 xp)                                          │
│ 12:02  daily check-in (+20 xp · streak ×1.2)                             │
├──────────────────────────────────────────────────────────────────────────┤   ← prompt divider
│ ▸ _                                                                      │   ← REPL prompt
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Zone table

| Zone | Position | Rows | Responsibility | Border |
|------|----------|------|----------------|--------|
| **Header** | row 1 | 1 | Title, active-pet slot (`[n/4]`), global unlock indicators. | Top border of app frame. |
| **Stage (pet cell)** | rows 2–8 | 6–7 rows | Fixed 6×20 pet cell, **horizontally centered**. Scenes may draw particle effects above (row -1) or shadow below (row +1) within the stage bounds. | No border. Static `<Box flexDirection="column" justifyContent="center" alignItems="center">` parent. |
| **Status bar** | rows 9–10 | 2 rows | Line 1: name · species · level + personality trait name. Line 2: XP bar, xp-text, age, mood glyph, last-fed indicator. | No border, subtle dim separator from stage. |
| **Log panel** | rows 11–20 | ~8–10 rows, scrollable | Time-stamped feed of events (level-up, feed, commit, test-pass, etc.). Tail-follow by default; scrollable up with `k`/`j`. | Top + bottom dividers (`─`). |
| **REPL prompt** | rows 21–23 | 1 row + bottom frame | `▸ ` prompt glyph, user input, tab-completion, history via up/down. | Bottom border of app frame. |

**Why this layout.**

- **Fitts's Law + visual hierarchy.** The pet is the largest, most-centered, most-visually-distinct element — it *is* the product. Status is adjacent (sub-glance from pet). Log is below (scan-only when interested). Prompt is anchored at the bottom (where the user's hands live on the keyboard).
- **Von Restorff.** Effect overlays above the pet (sparks, level-up burst) land in an otherwise empty row, so they pop without displacing the pet.
- **Gestalt proximity.** Status bar directly under pet = "this data describes this pet." Log below a horizontal rule = "this is history, separate from the present."
- **DEC-015 fixed sizing.** Every zone has a stable height so animating content inside the stage zone never forces the rest of the app to re-layout.

### 2.3 Narrow-terminal fallback (< 60 cols)

If the terminal is too narrow for the full 80-col layout, the expanded view collapses:

- Log panel hides (press `l` to toggle).
- Status bar compresses to 1 row (same content as compact-frames §5.4b "Compact" variant).
- Pet cell shrinks to 4×12 (juvenile silhouette max size, never smaller).

This is implementation detail for @web-developer; design spec expects the full 80-col layout as the authoring target.

---

## 3. Scene Catalogue

**Count: 22 scenes** — above the 20-scene floor. Covers every bucket the acceptance criteria specify.

| # | Scene id | Trigger | Frames | fps | Loop | Species variance | Stage variance | Paired compact-frame key |
|---|----------|---------|--------|-----|------|------------------|----------------|--------------------------|
| 1 | `idle-baseline` | default state, no strong personality pull | 8 | 10 | loop | per-species (silhouette swap) | per-stage | `idle.baseline` (4f) |
| 2 | `idle-chipper` | `extroversion > 0.6 AND arousal > 0.5` | 10 | 10 | loop | per-species | per-stage | `idle.energetic` (4f) |
| 3 | `idle-stoic` | `extroversion < 0.4 AND neuroticism < 0.4` | 4 | 8 | loop | per-species | per-stage | `idle.stoic` (2f) |
| 4 | `idle-curious` | `openness > 0.6 AND conscientiousness < 0.6` | 8 | 10 | loop | per-species | per-stage | `idle.baseline` (4f) — reused |
| 5 | `idle-grumpy` | `neuroticism > 0.55 OR (agreeableness < 0.35 AND extroversion < 0.5)` | 6 | 8 | loop | per-species | per-stage | `idle.stoic` (2f) — reused |
| 6 | `eat-small` | `pet feed` once or low-value food | 10 | 15 | one-shot → chain to idle | same structure, species glyph swap | per-stage | `eat` (3f) |
| 7 | `eat-feast` | level-up window + `pet feed` OR multi-feed queued | 18 | 15 | one-shot → `happy-sparkle` chain | same structure, species glyph swap | `eat` (3f) — reused |
| 8 | `sleep` | night bucket (00–06 local) OR `pause` | 6 | 6 | loop | same structure | same | `sleep` (2f) |
| 9 | `sleep-deep` | `pause` sustained > 6 hours | 4 | 4 | loop | same structure | same | `sleep` (2f) — reused |
| 10 | `play-bounce` | `pet play` command | 12 | 15 | one-shot → idle | same structure, species glyph swap | per-stage | `idle.energetic` (4f) — reused |
| 11 | `play-chase` | `pet play` at high energy (arousal > 0.6) | 16 | 15 | one-shot → idle | same structure, species glyph swap | per-stage | `idle.energetic` (4f) — reused |
| 12 | `sick` | `accumulatedNeglectSeconds > 1 day AND < 2.5 days` | 8 | 6 | loop | same structure | same | `sick` (3f) |
| 13 | `sick-worse` | `accumulatedNeglectSeconds > 2.5 days` (pre-death) | 8 | 4 | loop | same structure | same | `sick` (3f) — reused with slower tempo |
| 14 | `happy-wag` | post-feed window (≤15s), `daily-checkin` window | 12 | 12 | one-shot → idle | same structure | per-stage | NEW `happy` (3f) — flagged §9 |
| 15 | `happy-sparkle` | end of `eat-feast`, end of `play-chase`, post level-up flourish | 14 | 15 | one-shot → idle | same structure | per-stage | NEW `happy.sparkle` (4f) — flagged §9 |
| 16 | `sad` | `hungry > 12h AND not sick`; post-failed interaction | 6 | 6 | loop (short-duration, ≤30s then decays) | same structure | per-stage | NEW `sad` (2f) — flagged §9 |
| 17 | `hatch-crack` | phase 1 of hatch (first ~90 s real time) | 18 | 10 | one-shot → chain to `hatch-emerge` | per-species (egg shape) | hatchling-only | NEW `hatch.crack` (4f) — flagged §9 |
| 18 | `hatch-emerge` | phase 2 of hatch (final ~3 s, burst) | 20 | 30 | one-shot → chain to first `idle-baseline` | per-species | hatchling-only | NEW `hatch.emerge` (4f) — flagged §9 |
| 19 | `evolve-shimmer` | life-stage transition (hatchling→juvenile at L3, juvenile→adult at L10) | 24 | 30 | one-shot → new-stage idle | per-species | pre- AND post-stage silhouettes | NEW `evolve` (3f) — flagged §9 |
| 20 | `death-fade` | `pet.died` (DEC-009 hybrid) | 14 | 10 | one-shot, final, no loop | per-species (silhouette wilts in species vocabulary) | per-stage (tombstone size scales to reflect "they made it this far") | `death` (1f static) |
| 21 | `levelup-flash` | `level.up` event | 10 | 30 | one-shot → idle | species-agnostic burst, species silhouette underneath | per-stage | `level-up` (5f one-shot; 3f reduced-motion) |
| 22 | `ascend-1024` | `level.up` where `to === 1024` — fires ONCE, ever, per pet | 30 | 30 | one-shot → chain to gold-aura `idle-baseline` | species-agnostic aura, species silhouette underneath | adult-only | NEW `ascend.1024` (4f one-shot) — flagged §9 |

**Scene buckets satisfied:**
- Idle variants: 5 (baseline, chipper, stoic, curious, grumpy) → satisfies "multiple idle variants" criterion.
- eat: 2 (`eat-small`, `eat-feast`)
- sleep: 2 (`sleep`, `sleep-deep`)
- play: 2 (`play-bounce`, `play-chase`)
- sick: 2 (`sick`, `sick-worse`)
- happy: 2 (`happy-wag`, `happy-sparkle`)
- sad: 1 (`sad`)
- hatching: 2 (`hatch-crack`, `hatch-emerge`)
- evolving: 1 (`evolve-shimmer`)
- death: 1 (`death-fade`)
- level-up-flash: 1 (`levelup-flash`)
- ascend (bonus; mythic): 1 (`ascend-1024`)

**Total authored frames (single species, adult stage, counting one-shots at full length):** 8 + 10 + 4 + 8 + 6 + 10 + 18 + 6 + 4 + 12 + 16 + 8 + 8 + 12 + 14 + 6 + 18 + 20 + 24 + 14 + 10 + 30 = **266 frames**.

**Per-species multiplier.** Most scenes share structure and only swap silhouette tokens (the 4 species motifs from `compact-frames.md §3.2`). Scenes marked `per-species` in the variance column are structurally identical, so the authored asset count is 266 × 1 structural × 4 species-glyph-sets = practically **~400–600 concrete render-time frames** once the motif substitution is applied. Exact count depends on how many scenes share a single glyph template — see §4 authoring rules.

**Per-stage multiplier.** The silhouette itself changes shape between hatchling/juvenile/adult (see `compact-frames.md §3.2`). Scenes marked `per-stage` inherit the correct silhouette for the pet's current stage; they are NOT authored as separate scene files.

---

## 4. Per-scene Authoring Rules

### 4.1 Frame record shape (for @web-developer)

The expanded frame extends the existing `Frame` type in `animations/types.ts` with optional metadata:

```ts
export interface Frame {
  content: string;        // multi-line ASCII/emoji string, 6 rows × 20 cols MAX (pet cell)
  durationMs: number;     // inverse of fps; per-scene default applied if omitted
  effectRow?: string;     // OPTIONAL row to render ABOVE the pet (sparks, food, etc.) — 1 row × 20 cols
  shadowRow?: string;     // OPTIONAL row to render BELOW the pet — 1 row × 20 cols
  palette?: Record<string, ColorToken>;  // OPTIONAL per-frame color overrides (level-up tints XP bar, etc.)
}

export interface Scene {
  id: SceneId;
  frames: Frame[];
  compact: CompactFrame[];  // REQUIRED per DEC-016 — empty fails build
  fps: number;              // authoring-time target; AnimationEngine may clamp based on terminal
  loop: boolean;
  chainsTo?: SceneId;       // for one-shots: the scene to transition to when this one ends
}
```

This is a **design recommendation** for the Scene contract. Architecture §12.3 already defines the minimum viable shape (`id, frames, fps, loop, compact`); the additions above are optional niceties that @web-developer may elide if implementation shows they're not needed. The critical additions are `chainsTo` (for the hatch → emerge → idle pipeline) and `effectRow/shadowRow` (for the 6-row stage to be fully expressive).

### 4.2 Silhouette scaling: compact → expanded

The compact vocabulary (`compact-frames.md §3.2`) ships silhouettes at **2 rows × 6–10 cols**. The expanded view scales them up **structurally, not via font magnification**. The scaling rule is:

```
compact adult circuit:              expanded adult circuit (target):
 /[o-o]\                             .  '  *  '  .                    ← effectRow (optional)
 +=|--|=+                            /---[ o - o ]---\
                                     |=== == |--| == ===|
                                     +==========+=========+
                                      ~~~~~~~~~~~~          ← shadowRow (optional)
```

The expanded form:
- Keeps the species motif characters (`/\`, `[]`, `+`, `=` for circuit; `<>`, `^`, `\/` for rune; etc.) from the compact silhouette.
- Widens each limb segment to 3–4 characters, rendering silhouette rows at 12–16 cols.
- Adds a third-row "base" (legs/treads/stem/roots depending on species) that the compact form lacks for space reasons.
- Optionally emits an effect glyph on `effectRow` (the row above) during action scenes.
- Optionally emits a shadow/ground on `shadowRow` (the row below).

**Species-specific scaling tokens:**

| Species | Motif tokens (compact) | Expanded additions | effectRow vocabulary |
|---------|------------------------|---------------------|----------------------|
| circuit | `[ ]`, `+`, `=`, `\|`, `/`, `\` | grid lines `+===+`, treads `====`, bolts `x`, data-glints `·`/`'` | sparks `.*'`, glitchy bits `01`, dots `··· ` drifting |
| rune | `< >`, `^`, `.`, `\`, `/` | triangular skirt `\\///`, sigil base `⌇` ASCII fallback `;;;`, glow ligatures `~=~` | glow tails `*'..`, arcane motes `:`, crescents `)(` |
| shard | `/\`, `\`/`, `*`, `o` | facet glints `*`, prismatic tail `///\\\`, crystalline base `^^^^` | refraction flecks `*..*`, sparkle `+`, facet glints `/\` |
| bloom | `( )`, `~`, `v`, `*` | vines `))((`, petal skirt `~~***~~`, root-system `\v/` | petals `.,'*'`, pollen motes `·'`, drifting leaves `,` |

These tokens are **extensions** of the compact motif vocabulary, not replacements. A bloom-adult that's recognizable at 6 cols in the compact silhouette must still be recognizable at 16 cols in the expanded view. **The silhouette's personality lives in its corners** — keep corner characters identical across scales.

### 4.3 Cycle types

- **Loop.** Frames play in sequence, then restart. `idle-*`, `sleep`, `sick`, `sad`, `sick-worse` all loop. Total cycle duration = `frames.length × (1000 / fps)`.
- **One-shot.** Plays once, then chains to `chainsTo` (or to `idle-baseline` if unspecified). `eat-*`, `play-*`, `hatch-*`, `evolve-*`, `levelup-flash`, `death-fade`, `ascend-1024` are one-shots.
- **One-shot chain.** Multi-scene sequence. Canonical: `hatch-crack` → `hatch-emerge` → `idle-baseline` (first-ever idle, triggers species "born" confetti in the log panel). Also: `eat-feast` → `happy-sparkle` → `idle-baseline`.

### 4.4 Palette reuse

**Reuse the 11-token palette from `compact-frames.md §6.2`.** No new palette tokens introduced in this spec. Species accents (§6.3 compact) carry over 1:1. The only palette additions are **per-frame overrides** for cinematic moments:

- `levelup-flash` → tints the XP bar gold (`level-up` token) for the flash's duration; status-bar level number flashes bold + `level-up` for 2 s.
- `ascend-1024` → tints the pet silhouette `level-up` gold for the 30-frame one-shot, then the post-scene idle renders the silhouette with a gold-aura `effectRow` permanently (palette key `level-up`; aura character is `*` or `·` depending on §9 open-question resolution).
- `death-fade` → fades the silhouette from `text-primary` → `text-secondary` → `death` (medium gray) across the 14 frames. The shadowRow stays `death` on the final static frame.
- `evolve-shimmer` → cycles the silhouette through the species-accent color at 30 fps for the first 18 frames, then settles on the new-stage default.

No per-frame color override should introduce a hue the 11-token palette doesn't already contain.

### 4.5 Frame examples (circuit-adult, reference species)

Below: ASCII exemplars for several scenes using the **circuit adult** silhouette as the reference. The exact glyph choices are indicative — @web-developer may swap individual characters during implementation if something reads clearly better in Ink. The structural beats (number of frames, what happens on each) are binding.

> **Note on width.** The examples below are drawn to fit readably inside a markdown code block. The pet cell is 6 rows × 20 cols **including** the effect/shadow rows; the silhouette itself occupies rows 2–4 of that cell. Leading whitespace in the examples is meaningful (centers the silhouette inside the 20-col cell).

#### Scene 1 — `idle-baseline` (8 frames, 10 fps, loop)

```
frame 1 — neutral gaze                   frame 2 — gaze drift right
                                         
  /---[ o - o ]---\                        /---[ . - o ]---\
  |=== == |--| == ===|                     |=== == |--| == ===|
  +==========+=========+                   +==========+=========+

frame 3 — gaze center, slight shift       frame 4 — blink (both eyes close)
                                         
  /---[ o - o ]---\                        /---[ - - - ]---\
  |=== == |/-| == ===|                     |=== == |--| == ===|
  +==========+=========+                   +==========+=========+

frame 5 — eyes reopen, look left          frame 6 — neutral gaze
                                         
  /---[ o - . ]---\                        /---[ o - o ]---\
  |=== == |--| == ===|                     |=== == |\-| == ===|
  +==========+=========+                   +==========+=========+

frame 7 — breath-out (bottom shifts)     frame 8 — breath-in (bottom shifts back)
                                         
  /---[ o - o ]---\                        /---[ o - o ]---\
  |=== == |__| == ===|                     |=== == |--| == ===|
  +==========+=========+                   +==========+=========+
```

Cycle duration: 800 ms. Blink happens once every 8 frames (~8% of the time — slightly more than compact's 25% because at 10 fps the blink duration is already short).

#### Scene 6 — `eat-small` (10 frames, 15 fps, one-shot → idle-baseline)

```
frame 1 — food crumb approaches           frame 2 — crumb closer
 effectRow: "        .           "        effectRow: "      .             "
                                         
  /---[ o - o ]---\                        /---[ o - o ]---\
  |=== == |--| == ===|                     |=== == |--| == ===|

frame 3 — crumb at lip                    frame 4 — mouth opens
 effectRow: "    .               "        effectRow: "                    "
                                         
  /---[ o - o ]---\                        /---[ ^ - ^ ]---\
  |=== == |--| == ===|                     |=== == |UU| == ===|

frame 5 — chew (happy eyes, chew glyph)   frame 6 — chew variation
                                         
  /---[ ^ - ^ ]---\                        /---[ ^ - ^ ]---\
  |=== == |OO| == ===|                     |=== == |uu| == ===|

frame 7 — swallow (mouth settles)         frame 8 — content pause
                                         
  /---[ ^ - ^ ]---\                        /---[ o - o ]---\
  |=== == |~~| == ===|                     |=== == |~~| == ===|

frame 9 — mouth back to neutral           frame 10 — small satisfaction bob
                                         
  /---[ o - o ]---\                        /---[ o - o ]---\
  |=== == |--| == ===|                     |=== == |--| == ===|
```

Chains to `idle-baseline`. Total one-shot duration: 667 ms.

#### Scene 17 — `hatch-crack` (18 frames, 10 fps, one-shot → hatch-emerge)

```
frame 1 — egg whole                       frame 2–3 — barely visible hairline
                                         
      .----.                                   .----.                .----.
     |      |                                 |  ,   |              |  ,   |
     | .-.  |                                 | .-.  |              | .'.  |
     | |*|  |                                 | |*|  |              | |*|  |
     |  -   |                                 |  -   |              |  -   |
      '----'                                   '----'                '----'

frame 6–8 — crack widens with shudder     frame 12 — deeper crack, egg leans
                                         
      .----.                                   .----.
     | /,   |                                 | \/   |
     | .'.  |   (slight 1-col shake:          | )('  |
     | |*|  |    frame 7 shifts right,        | |*|  |
     |  x   |    frame 8 back)                |  x   |
      '----'                                   '----'

frame 15 — effectRow sparks                frame 18 — final: egg shell split
 effectRow: "     . ' .          "
                                         
      .--..                                     /\ __ /\
     | //'\|                                   (  ..  )    ← shell halves
     | )('l|                                   / |||| \
     | |**||                                   '------'
     |  X  |
      '-'--'
```

Chains immediately to `hatch-emerge`. Total duration: 1.8 s. This is deliberately slow — the user's attention earns the payoff.

#### Scene 18 — `hatch-emerge` (20 frames, 30 fps, one-shot → idle-baseline)

```
frame 1 — shell halves open                frame 4 — small silhouette peeks out
                                         
        /\___/\                                   /\___/\
       (       )                                 (       )
       \   '   /                                 \ /[oo]\ /
        '-----'                                   '---||'

frame 8 — silhouette rises, shell shards   frame 12 — full hatchling stands
 effectRow: "   .  '  *  '  .   "        effectRow: " . .' * '. . "
                                         
          /[oo]\                                    /[oo]\
           \||/                                      ||
         ' shard shard '                          . dust .

frame 16 — hatchling settles                frame 20 — first idle pose
                                         
          /[oo]\                                    /[oo]\
           ||                                        ||
```

The shell characters `/\___/\`, `( )` dissolve gradually (frames 1–8), species-specific "born" effect characters appear in `effectRow` (frames 4–16), and by frame 20 we're on the first idle-baseline pose for a hatchling. Chain target: `idle-baseline`.

**Species variation for `hatch-emerge`:**

| Species | Shell shards | Born effectRow | First hatchling silhouette |
|---------|-------------|----------------|----------------------------|
| circuit | `[ ]` fragments + wires | `'·' binary drizzle 01` | `[oo]` / ` || ` |
| rune | triangular sigil pieces | `*'·` glowing motes | `<..>` / ` \/ ` |
| shard | prismatic facets `/\` | `**` sparkle + refraction | `/oo\` / ` \\// ` |
| bloom | petal halves `()` | `.,'` falling petals | `(oo)` / ` vv ` |

#### Scene 19 — `evolve-shimmer` (24 frames, 30 fps, one-shot → new-stage idle)

This is the **life-stage transition flash** — hatchling→juvenile (triggers at L3) or juvenile→adult (triggers at L10 + auto-name prompt). It's short, punchy, and the visual equivalent of a "you did it" moment.

```
frames 1–6 — silhouette pulses (growing and shrinking)
  (hatchling pose, cycled at increasing size 6 cols → 8 cols → 6 cols)
  palette: silhouette cycles species-accent color at 30 fps

frames 7–12 — shimmer builds, silhouette blurs
  effectRow overlays diagonal shimmer:   *  .  *  '  .  *
  palette: silhouette tinted level-up (gold)

frames 13–18 — flash peak
  the silhouette is briefly replaced by a pure ASCII burst:
        \  *  /
         \ * /
          \*/
          /*\
         / * \
        /  *  \
  (compressed into 3 rows — row 2 holds the diamond, rows 1/3 hold the flares)
  palette: all cells level-up (gold)

frames 19–24 — new-stage silhouette fades in at full size
  juvenile pose (or adult pose, if from juvenile) materializes
  palette: silhouette tint fades from level-up back to text-primary
```

Total duration: 800 ms. Chains to whatever idle-variant the personality vector selects (see §5) at the new stage.

#### Scene 20 — `death-fade` (14 frames, 10 fps, one-shot, final)

The death moment (DEC-009 hybrid threshold). Must feel *earned*, not startling. The design stance for this scene is "funeral, not error."

```
frames 1–4 — silhouette droops, head lowers
                                         
  /---[ x - x ]---\                        /---[ x . x ]---\
  |=== == |~~| == ===|                     |\== == |__| == ==/|
  +==========+=========+                   +==========+=========+

frames 5–8 — silhouette tilts forward, shadowRow widens
 shadowRow: "    -~~~~~~~-       "      shadowRow: "   -~~~~~~~~~-      "
                                         
  /---[ x . x ]---\                        /---[ x .. x ]--\
  |\-- -- |__| -- --/|                     |\-- . |__| . --/|
  +=========++========+                     +=========+=======+

frames 9–12 — silhouette dissolves: characters drop out progressively
 frame 9:     /---[ x .. x ]--\           frame 12:    .-[ x  x ]-.
              |\-- . |__| . --/|                       .          .
              +====-----====-====+                     ..........

frame 13 — tombstone materializes
                                              RIP
                                            [_____]
                                           /       \

frame 14 — final static: tombstone + epitaph (optional)
                                              RIP
                                            [_____]
                                           /       \
                                         (name, Lvl, age)
```

Palette: silhouette fades `text-primary` → `text-secondary` → `death` across frames 1–12. Tombstone (frames 13–14) is rendered in `death` token. No loop — after frame 14, the scene stays static indefinitely until the user acknowledges via command.

**The one-shot plays once, then latches.** AnimationEngine should NOT re-enter `death-fade` on subsequent renders — once latched, the pet's scene is `death-fade-static` which is just frame 14.

**Species variation for death-fade.** The tombstone shape doesn't change across species (universal symbol), but the *dissolve pattern* on frames 9–12 reflects the species motif:

| Species | Dissolve character | Last character to fade |
|---------|--------------------|-------------------------|
| circuit | wires unravel (`=` → `-` → `·` → gone) | center-bolt `+` |
| rune | glow extinguishes (`^` → `·` → gone, sigil crumbles) | central dot `.` |
| shard | facets shatter (`/` / `\` → `,` / `'` → gone) | center eye `o` |
| bloom | petals fall (`~` → `,` → gone, drifting down through shadowRow) | root core `\v/` |

**Emotional contract.** This is where DEC-009's "hard challenge" design pays its dues. The player invested real wall-clock time; the pet's ending deserves more than a shrug. 14 frames at 10 fps = 1.4 s — long enough to *feel*, short enough to not be maudlin.

#### Scene 21 — `levelup-flash` (10 frames, 30 fps, one-shot → idle)

```
frame 1 — spark appears above               frame 2 — bigger spark, eyes widen
 effectRow: "          *         "        effectRow: "        * *         "
                                         
  /---[ o - o ]---\                        /---[ O - O ]---\
  |=== == |--| == ===|                     |=== == |--| == ===|

frames 3–4 — radial burst peak
 effectRow: "      \ * * /       "        effectRow: "     \* * * */      "
                                         
  /---[ O - O ]---\                        /---[ O - O ]---\
  |=== == |--| == ===|                     |=== == |--| == ===|
  palette: silhouette tinted level-up (gold)

frames 5–6 — burst fades, silhouette smiles
 effectRow: "       .  ' .       "        effectRow: "          .         "
                                         
  /---[ ^ - ^ ]---\                        /---[ ^ - ^ ]---\
  |=== == |--| == ===|                     |=== == |~~| == ===|

frames 7–10 — settle back to idle pose
  (silhouette returns to text-primary palette, effectRow empties)
```

Total duration: 333 ms. Chains to whichever idle-variant the personality vector currently selects. In the status bar, the level number flashes **bold + level-up token** for a separate 2 s window; the XP bar glows gold for the same window.

**Reduced-motion variant.** Per `compact-frames.md §4.5`, reduced-motion plays frames 1, 4, and 9 only (3 frames, 100 ms duration) — same emotional beats (anticipation, peak, resolution) with less flicker.

#### Scene 22 — `ascend-1024` (30 frames, 30 fps, one-shot, fires ONCE)

This scene plays exactly once per pet, ever. When `level.up` event has `to === 1024`. The user has spent *years* of real time reaching this moment. It must feel genuinely rare.

```
frames 1–6 — silence, silhouette stills (not breathing, unusual pause)
  (all 6 frames identical: adult silhouette, neutral pose, text-primary)

frames 7–12 — gold aura begins (effectRow + shadowRow both gain content)
 effectRow grows:  "       .           "      → "     . . .         "     → "   * . * . *       "
 shadowRow grows: "    ~~~~~~~~~     "       → "  ~~~~~~~~~~~~~   "       → "~~~~~~~~~~~~~~~~~"

frames 13–18 — silhouette lifts off ground
  (pet cell shifts up 1 row; silhouette now on rows 1-3 of cell; shadow glows wider)
  palette: silhouette cycles level-up gold → white-text → level-up gold → ...

frames 19–24 — peak: full gold halo + title card
 effectRow:    "    * · * · * · *    "
 silhouette:   tinted level-up, 100% brightness
 shadowRow:    "  ~~~~~~~~~~~~~~~~~  "  (same gold as silhouette)
 log panel:    prints "ASCENDANT · the 1024 Club" in level-up color at this exact tick

frames 25–30 — silhouette settles back to ground; aura persists
  (pet returns to its normal cell position; effectRow retains a softer "· · ·" of level-up gold)
  palette: silhouette is text-primary again, but effectRow keeps level-up ornament permanently
```

Total duration: 1 s. **After this scene, the pet's idle renders permanently keep the level-up gold `effectRow` as an aura** (this is the "ascended" visual state — see §6.2 for the idle-with-aura variant).

**Scene-complete side-effects (for @web-developer to wire):**
- AnimationEngine writes a permanent flag on the pet (not a schema change — the rendering layer reads `pet.level === 1024` and applies the aura).
- The status bar's `Lv 1024` text gains an `Ascendant` suffix per DEC-004 honorific.
- The log panel's rendering of the ascent line uses the `level-up` token, bold.
- If @product-owner approves the golden-border GIF capture (DEC-005 Tier 3 — which unlocks at this same moment), the first `glyphling export` call after ascend records THIS scene as the Tier 3 intro.

---

### 4.6 Scenes NOT shown in full detail (reuse structure from examples above)

For brevity, the following scenes reuse the structural patterns already demonstrated above. @web-developer should author them by analogy:

- `idle-chipper`, `idle-stoic`, `idle-curious`, `idle-grumpy` → structural variants of `idle-baseline` (see §5 for per-variant beats).
- `eat-feast` → same structure as `eat-small` but 18 frames, 2 chew-cycles, chains to `happy-sparkle`.
- `sleep` → 6 frames, 6 fps, ZZ animation above head alternating (`z` → `Z` → `z` → etc.), effectRow cycles through ZZZ patterns.
- `sleep-deep` → 4 frames, 4 fps, larger `Z` character, very slow.
- `play-bounce` → 12 frames, silhouette shifts up/down by 1 row alternately, effectRow shows a small object (`.` → `o`) being tossed.
- `play-chase` → 16 frames, silhouette pivots left/right, effectRow shows a fleeing glyph (`.`, `·`, `*` moving across).
- `sick`, `sick-worse` → `sick` is 8 frames at 6 fps (the compact 3-frame is the base; expanded adds breathing micro-variation). `sick-worse` reuses same frames at 4 fps (lethargy).
- `happy-wag` → 12 frames, silhouette sways left/right, mood-eyes `^-^`.
- `happy-sparkle` → 14 frames, effectRow shows sparkle burst (`.·*'*·.`), silhouette has `^-^` eyes, 15 fps.
- `sad` → 6 frames, silhouette droops (similar to `sick` frame 1 but no `x` eyes — instead `u_u` or `-_-`), effectRow empty, shadowRow shifted slightly downward.

---

## 5. Personality → Idle Variant Mapping

DEC-002 + architecture §5 defines an **8-dimensional personality vector**:

```
PersonalityTrait = "Stoic" | "Friendly" | "Pragmatic" | "Energetic"
                 | "Gruff" | "Philosophical" | "Paranoid" | "Curious"
```

Each pet carries `weights: Record<PersonalityTrait, number>` summing to 1.0. We need to pick ONE idle-variant scene per render — we don't blend. The `dominant` trait (`argmax(weights)`) drives primary variant selection; **secondary-trait modulation** (see §5.3) provides nuance.

Architecture §5 uses 8 discrete traits, but architecture §5.4 refresh math implies these are weights in [0,1]. The task brief asks us to map to **5 idle variants** — so we're clustering 8 traits into 5 behavioral archetypes.

### 5.1 Archetype clusters (designer's call, justified below)

| Idle variant | Fires when | Dominant trait candidates | Secondary nudge |
|--------------|-----------|---------------------------|------------------|
| **idle-baseline** | Default / balanced vector | Pragmatic (dominant), Friendly, or no single trait > 0.25 | none — this is the "no strong pull" case |
| **idle-chipper** | High-energy + social | dominant in {Energetic, Friendly} AND `weights.Energetic + weights.Friendly > 0.45` | Curious secondary raises frame-9's "gaze shift" frequency |
| **idle-stoic** | Low-affect, composed | dominant in {Stoic, Philosophical} AND `weights.Stoic + weights.Philosophical > 0.45` | Gruff secondary darkens eye glyph slightly (see §5.2) |
| **idle-curious** | High-openness, attentive | dominant === Curious OR `weights.Curious > 0.35` | Friendly secondary adds a tiny `~` mouth curve on frame 4 |
| **idle-grumpy** | Volatile + unsocial | dominant === Gruff OR (`weights.Paranoid > 0.3` AND `weights.Friendly < 0.2`) | Paranoid secondary biases toward wink frame (eye closed = "side-eye") |

### 5.2 Per-variant visual beats

**`idle-baseline`** — see §4.5 example. 8 frames, one blink. Neutral eye glyph `o`. Settles into the default "breath" rhythm.

**`idle-chipper`** — 10 frames, 10 fps.
- Eye glyph alternates between `o` (neutral) and `^` (joy) on frames 3, 6, 9.
- Body "bobs" — silhouette row 3 alternates `+==========+=========+` (resting) with `+==========+========+` (shifted 1 col, reads as a bouncing foot).
- effectRow occasionally gets a tiny `·` (frame 5) — "paying attention to the world."
- Reads as: paying attention, ready to engage, alive.

**`idle-stoic`** — 4 frames, 8 fps.
- Eye glyph stays closed or half-closed across all frames: `-_-`, `-.-`, `-_-`, `-.-`.
- No body movement at all — all 4 frames are character-level identical in the silhouette rows.
- Only change: effectRow has an occasional single-cell drift of dust `.` (frame 4 only).
- Reads as: still, composed, internal.

**`idle-curious`** — 8 frames, 10 fps.
- Eye glyph shifts frequently: gaze tracks around. Frames 1–2 look center, 3 looks right (`o .`), 4 centers, 5 looks up (effectRow `'` hint), 6 looks left (`. o`), 7 centers, 8 blinks.
- Tiny head-tilt on frame 5 — the left bracket shifts from `[` to `\` briefly.
- Reads as: attentive, exploring, slightly childlike.

**`idle-grumpy`** — 6 frames, 8 fps.
- Eye glyph stays narrow: `-`, `·`, `-`, `·`, `-`, `·`.
- The "mouth" row (center of silhouette row 2) uses `\__/` or `/--\` — a downturn.
- One frame (5 of 6) has a brief `^` above (effectRow) — a "hmph" puff.
- Reads as: closed off, suspicious, quick to judge.

### 5.3 Justification for each mapping

**Baseline as the default.** The 8-trait vector is additive — any pet that doesn't have a single trait exceeding 0.25 is effectively "balanced." A balanced pet has no strong personality to perform, so the default breath-and-blink idle is exactly right. It's also the most visually reliable idle: no risk of misreading.

**Chipper clusters Energetic + Friendly.** These two traits in DEC-002's trait table are the most extroverted. Energetic alone reads as "restless" without Friendly's warmth; Friendly alone can be "mellow" — but their combination is the classic "chipper pet that wants to engage." Mapping both to one variant saves us an animation at no cost to psychological accuracy.

**Stoic clusters Stoic + Philosophical.** These are the internal/contemplative traits. Philosophy without stoicism reads as "dreamy" (which is close enough); stoicism without philosophy reads as "guarded" (close enough). The composed, still idle serves both faithfully — a user will see a thinking pet and project the flavor they want.

**Curious as its own variant.** Curious is singular — not easily clustered. It's not restless (that's Energetic) and not internal (that's Philosophical). It's *outward-attentive*. The gaze-tracking idle is the defining behavior of curiosity in cartoon vocabulary, and giving it its own variant respects how distinct this trait is in the design.

**Grumpy clusters Gruff + high-Paranoid. Gruff is the obvious dominant. The Paranoid + low-Friendly combo qualifies too — a paranoid-and-unfriendly pet is behaviorally "grumpy" even if it's technically a different trait. The variant carries a judgmental/closed-off vibe that reads correctly for both.

**Why not 8 variants?** At ~20 min of user engagement per day, a single idle plays for minutes at a time. 8 micro-distinct idles would (a) blow our animation budget, (b) be unrecognizable at a glance (is this the 0.3-Philosophical idle or the 0.3-Paranoid idle?), and (c) add no emotional signal the user can actually perceive. 5 variants is the sweet spot between "dead sameness" and "indistinguishable noise."

### 5.4 Selection algorithm (pseudocode for @web-developer)

```ts
function selectIdleVariant(p: PersonalityVector): SceneId {
  const w = p.weights;

  // grumpy gate
  if (w.Gruff > 0.3 || (w.Paranoid > 0.3 && w.Friendly < 0.2)) {
    return "idle-grumpy";
  }

  // stoic gate
  if (w.Stoic + w.Philosophical > 0.45 &&
      (p.dominant === "Stoic" || p.dominant === "Philosophical")) {
    return "idle-stoic";
  }

  // chipper gate
  if (w.Energetic + w.Friendly > 0.45 &&
      (p.dominant === "Energetic" || p.dominant === "Friendly")) {
    return "idle-chipper";
  }

  // curious gate
  if (w.Curious > 0.35) {
    return "idle-curious";
  }

  return "idle-baseline";
}
```

**Ordering is deliberate.** We check `grumpy` first (negative-mood takes precedence — a grumpy energetic pet is grumpy first, energetic second). Stoic next (the quiet archetypes). Chipper third. Curious fourth (subtler than chipper, same-strength threshold). Baseline last.

**Rolling-refresh implications (architecture §5.4).** As personality shifts via 7-day language exposure, the idle variant can change week-over-week. This is intentional — the user should subtly feel their pet "grow into" their current work. Architecture §5.4 already emits a `personality:drift` event when the dominant trait changes; the expanded view renders a faint one-time log-panel line ("Pixel feels different today") when this fires.

---

## 6. Level-up and Ascension Moments

### 6.1 `levelup-flash` — every level gate (spec reprise, §4.5)

Fires on every `level.up` event. 10 frames, 30 fps, ~333 ms total one-shot. Already fully specified in §4.5; design-contract summary:

- Timing: 333 ms burst, then 2 s lingering status-bar effects (level number bold + XP bar gold).
- Colors: `level-up` token (gold `#ffd700` truecolor, `220` 256-color, `11` bright-yellow ANSI-16 fallback).
- Sound: none (we don't ship audio in v1; if ever, this is where a short "ding" lives).
- Reduced-motion: 3 frames only (anticipation / peak / resolution).
- Log panel: prints `level up! <prev> → <next>` in `success` token at the same tick.

### 6.2 `ascend-1024` — the once-in-years spectacle (spec reprise, §4.5)

Fires on `level.up where to === 1024`. Per DEC-004, this is intentionally "mythic" — estimated wall-clock reach at ~2,000 XP/day is ~66 years; at ~10,000 XP/day ~13 years. It happens once, ever, per pet. We design for that.

**Frame count:** 30 frames at 30 fps = **1 s total**. Yes, short. Long is not the flex — the *rarity* is the flex. A 1 s moment plays forever in memory; a 10 s moment tests patience.

**Colors:** `level-up` token (gold). Silhouette, effectRow, shadowRow, XP bar, status-bar level text — all gold, all simultaneously for the 1 s of the burst. Only time in the product's lifetime we use this much gold at once.

**What lingers on the status bar afterward (permanent, until death):**

- `Lv 1024` renders bold, in `level-up` token.
- A gold star `★` (ASCII fallback `*`) appended to the pet's name: `Pixel★` in the status bar and compact-frame HUD.
- The `Ascendant` honorific appears as a second-line subtitle on the status bar: `Pixel the Circuit · Ascendant`.
- The idle silhouette gains a permanent gold `effectRow` — a soft aura: `·  ·  ·  ·  ·` in level-up gold. Renders above the pet at all times, including during subsequent scene one-shots (eat/play/sick — though §9 flags whether Ascendants can even get sick).
- XP bar shows `∞` instead of a fraction (compact §5.4c already specified).
- Log panel permanently shows the ascension line at the top, pinned.

**What does NOT linger:**

- The silhouette itself returns to `text-primary`. Gold-tinting the silhouette permanently makes every idle feel like the flash is still playing — it would desensitize the gold token. The *aura above* is enough to say "this pet is special."

**Species-specific ascension flavor.** The aura characters above the silhouette reflect species motif:

| Species | Aura effectRow characters |
|---------|---------------------------|
| circuit | `·  ·  ·  ·  ·` (evenly spaced datapoints, gold) |
| rune | `·  *  ·  *  ·` (sigil stars alternating, gold) |
| shard | `*  ·  *  ·  *` (facets, gold) |
| bloom | `,  ·  *  ·  ,` (drifting pollen, gold) |

**Implementation note for @web-developer.** The permanent aura is NOT a schema change. The renderer reads `pet.level === 1024` at render time and applies the aura `effectRow` override. Same approach used for the `Ascendant` honorific (architecture §6.4 already specifies this as a display-time suffix, not a stored name change).

---

## 7. GIF Capture Implications (DEC-005 3 Tiers)

DEC-005 defines three capture tiers, gated by level. This spec does NOT implement capture — it tells @web-developer which scenes are the best showcase per tier, what framing to use, and the Tier-3 golden-border requirement.

### 7.1 Tier 1 Snapshot — 320×240, 8 fps, ≤3 s, watermarked (unlocks L25)

**Target terminal cell dimensions:** ~40 cols × ~12 rows (at a readable font size producing a 320×240 render). This is a **pet-only** capture — no log panel, no REPL.

**Recommended scenes for Tier 1:**

- `levelup-flash` (10 frames @ 30 fps) — we re-author for 8 fps capture by sampling frames 1/4/7/9 (4 frames at 8 fps = 500 ms, doubled with a 2-frame fade = 750 ms, fits under 3 s with padding).
- `happy-sparkle` (14 frames @ 15 fps) — down-sample to 8 fps (every other frame) → 7 frames = 875 ms.
- `eat-small` (10 frames @ 15 fps) — down-sample to 5 frames at 8 fps → 625 ms.

**Framing:** Pet cell centered in 40×12 output. Header shows only pet name + level + species (no pet-count, no log). Watermark: `glyphling` in `text-secondary` token in the bottom-right corner of the GIF.

**fps down-sampling rule.** Author animations at 15/30 fps; GIF export @ 8 fps picks every Nth frame where `N = authored_fps / 8`. This means `levelup-flash` (30 fps authored) samples every 4th frame; `eat-small` (15 fps authored) samples every 2nd. The animation loses detail but retains the *beats* — which is what a 3 s GIF is for.

### 7.2 Tier 2 Portrait — 640×480, 15 fps, ≤10 s, no watermark, frame selection (unlocks L250)

**Target terminal cell dimensions:** ~80 cols × ~24 rows — the full app layout including log panel.

**Recommended scenes for Tier 2:**

- `idle-chipper` or whichever idle variant is currently active — 10 s loop shows the personality clearly.
- A `eat-feast` one-shot (18 frames @ 15 fps = 1.2 s) followed by the chained `happy-sparkle` (14 frames @ 15 fps = 933 ms) followed by idle — showcases personality AND interaction.
- `evolve-shimmer` — if we can capture the moment of a stage transition, this is the signature Tier 2 capture. Requires the user to trigger capture during the tight window; flag as user-select scene.

**Framing:** Full 80×24 app rendered. Status bar visible. Log panel shows last 4–5 events. REPL prompt visible but empty. No watermark (this is the "portrait" tier — unwatermarked is the flex at L250).

**Frame selection:** Tier 2's "frame selection" per DEC-005 means the user picks which window to record (e.g., "record starting now for 10 s" or "record the last 10 s of buffered idle"). Spec owner for this UI is @web-developer; the animation-design-side requirement is that 10 s of continuous play must remain visually interesting — which the mix of idle variant + one-shot + chain supports.

### 7.3 Tier 3 Showcase — 1280×720, 30 fps, ≤30 s, cinematic, "1024 Club" golden border (unlocks L1024)

**Target terminal cell dimensions:** ~150 cols × ~40 rows at a large readable font. Full cinematic layout.

**Recommended scenes for Tier 3:**

- `ascend-1024` itself — the obvious flagship capture. 30 frames @ 30 fps = 1 s one-shot, extended with pre-roll idle (3 s) + post-roll idle-with-aura (5 s) = 9 s total. Plenty of headroom for a second one-shot if the user wants.
- `evolve-shimmer` at L1024-adjacent transition (last stage transition was L10, so this is less relevant at 1024 — but remains a Tier 3 candidate for any pet that captures Tier 3 earlier on a different milestone).
- The user's favorite idle-variant, 30 s at 30 fps = 900 frames, with a `levelup-flash` mid-capture if they can time it.

**Tier 3 GOLDEN BORDER specification (per DEC-005).**

The Tier 3 capture wraps the rendered app in a **visible gold border** drawn into the GIF itself (not a terminal feature):

- **Border thickness:** 4 pixels at 1280×720 = 0.3% of width. Thick enough to perceive, thin enough to not overwhelm.
- **Border color:** `#ffd700` truecolor — the same `level-up` token that defines ascension. Consistency ties the visual to the achievement.
- **Border style:** Solid fill, no gradient, no corner decoration (clean = luxurious).
- **Interior padding:** 12 px of black fill between the border and the terminal render. Creates a "framed print" effect.
- **1024 Club badge:** Bottom-right corner of the border area gets a small `★ 1024 CLUB` badge in the same gold. Badge height: ~18 px. Non-intrusive but unmistakable.

**Why the border.** The golden border is the visual equivalent of a medallion — it signals "this GIF came from a Tier 3 unlock" to anyone who sees it in a README, a tweet, a chat. The pet inside the border earns the frame; the frame earns the pet a trophy.

**Watermark:** None on the pet itself. The golden border IS the watermark.

### 7.4 Per-tier capture workflow (for @web-developer handoff)

This is the `vhs` (DEC-014) integration point. Brief handoff:

- **Tier 1:** `glyphling export --tier=1 --scene=<sceneId>` → writes a `.tape` script that drives the Ink expanded view at 40×12, triggers the scene, records 3 s at 8 fps. Output via `vhs`.
- **Tier 2:** `glyphling export --tier=2 [--scene=<sceneId>]` → writes a `.tape` at 80×24, records 10 s at 15 fps. No watermark post-processing.
- **Tier 3:** `glyphling export --tier=3 [--scene=ascend-1024]` → writes a `.tape` at 150×40 (or whatever cell math produces 1280×720), records ≤30 s at 30 fps. **Post-processing step:** pipe through `ffmpeg` to wrap the frame with the 4 px gold border and composite the 1024 Club badge. `ffmpeg` is already a `vhs` dependency (per MEMORY.md + DEC-014) so no new tool required.

---

## 8. Compact ↔ Expanded Parity

### 8.1 Parity principle

Every `Scene` in the registry ships BOTH `frames: Frame[]` (expanded view) AND `compact: CompactFrame[]` (statusline). Per architecture §12.3 + DEC-016, **empty `compact[]` fails build**. The two arrays refer to the same scene semantically — they're different renderings of the same moment.

### 8.2 Parity checklist (when authoring or updating a scene)

When adding or modifying an expanded-view scene, verify:

1. **Is there a paired compact-frame key in `compact-frames.md §4`?** Map it in the Scene Catalogue table column (§3). If not:
   - If the scene is expressive only in the expanded view (e.g., `eat-feast`, `hatch-emerge`, `ascend-1024`), the compact pair is a down-sampled abbreviation — pick the closest existing compact key (e.g., `eat-feast` pairs with `eat`) or flag for new compact authoring.
   - If the scene conceptually has no compact analog, reconsider whether the scene should exist at all.
2. **Is the emotional beat preserved?** A scene's compact pair must convey the same mood at a glance. If the expanded `happy-sparkle` reads as joyous but the compact version reads as plain `idle`, the pair is broken.
3. **Are the colors consistent?** Both arrays pull from the same 11-token palette (compact §6.2). A scene that uses `level-up` in expanded must use `level-up` in compact.
4. **Does the trigger map the same?** The scene-selection logic (e.g., `selectIdleVariant` in §5.4) must route the same pet state to the same scene id — whether rendering compact or expanded. `compact.ts` and `animation.ts` (architecture §2.2 modules 8 and 22) share the same dispatch table.
5. **Do both pass the frame budget?** Expanded: ≤6×20 per frame (pet cell). Compact: ≤3×60 per frame (`compact-frames.md §7.1` hard rule).
6. **If the expanded scene adds `chainsTo`, does the compact side have an equivalent?** Compact scenes don't chain (they're stateless per tick) — the statusline renderer picks the frame from the current scene, full stop. So a multi-scene expanded chain (`hatch-crack` → `hatch-emerge`) compresses into a single compact scene (`hatch`) rendered continuously during both phases.

### 8.3 Scenes that currently lack a compact counterpart (flagged for @designer follow-up)

The following expanded scenes in this spec DO NOT have a compact-frame pair in `compact-frames.md`. These need compact-frame authoring **before `animations/*.ts` implementation lands** (otherwise the build-time check fails):

| Expanded scene | Why no compact pair yet | Recommended compact approach |
|-----------------|--------------------------|------------------------------|
| `happy-wag`, `happy-sparkle` | compact-frames.md §4 only defines happy *mood glyph* (`:)`), no dedicated compact happy *scene* | 2-frame compact `happy`: silhouette with `^-^` eyes + mood glyph `:)` pulsing between `success` and default color |
| `sad` | no sad scene or mood glyph in compact spec | 2-frame compact `sad`: silhouette with `u_u` eyes + mood glyph `:(` in `error-muted` (reuse sick token, or flag new token) |
| `hatch-crack`, `hatch-emerge` | compact §4 has no hatching cycle | 4-frame compact `hatch`: egg whole → hairline crack → crack widens → hatchling peek. Fits the 1–2 s refresh cadence since hatch is a multi-minute event anyway. |
| `evolve-shimmer` | compact §4 has no evolution cycle | 3-frame compact `evolve`: silhouette pulse → shimmer flash (single frame with `*` effects) → new-stage silhouette. |
| `ascend-1024` | compact §4 has no ascend cycle (compact §5.4c defines only the post-ascend HUD variant) | 4-frame compact `ascend`: silhouette → gold-aura adds → aura peaks → settled aura (permanent). Handed off to statusline renderer to latch after first play. |
| `idle-curious`, `idle-grumpy` | compact §4 has only 3 idle variants (baseline, energetic, stoic) | Either (a) design 2 new compact idle variants, OR (b) reuse existing: curious → baseline, grumpy → stoic. Recommendation: (b) for v1, ship lean. |
| `eat-feast`, `play-bounce`, `play-chase`, `sleep-deep`, `sick-worse` | variants of existing compact scenes | Reuse: `eat-feast` → `eat`, `play-*` → `idle.energetic`, `sleep-deep` → `sleep`, `sick-worse` → `sick` with slower tempo. All via the Scene Catalogue §3 `compact` column. |

**Total new compact scenes needed: 5** (`happy`, `sad`, `hatch`, `evolve`, `ascend`). A follow-up @designer task (or a sub-bullet of TODO-007) should author these and append to `compact-frames.md §4`. They're small — 2–4 frames each, same vocabulary — so roughly 14 new compact frames to ship parity.

### 8.4 Drift detection (build-time check)

The build-time check @web-developer should enforce (per DEC-016):

- Every scene in the registry has `frames.length > 0` AND `compact.length > 0`.
- The `scenes.compact[]` array renders ≤3 rows × ≤60 visible cols (compact-frames.md §7.1).
- Every `compact` entry uses only the palette tokens defined in compact §6.2.
- If a scene's `id` ends in `-static` (e.g., `death-fade-static`), its `frames.length === 1` and `loop === false`.

A CI step can validate all four cheaply in ~50 ms. Flag drift loud.

---

## 9. Open Questions (for @product-owner)

These need resolution before the implementation half of TODO-007 ships to main:

### 9.1 Ascendant-at-1024 permanent aura: glyph choice

The ascended pet's idle renders a permanent gold `effectRow` above the silhouette (§6.2). I've proposed species-specific aura characters (`·`/`*`/`,` per motif). **Should the aura remain permanent forever, or fade down after 24 hours of gameplay to become "subtle"?** I lean permanent — the flex should be ambient, not ephemeral. But product-owner might prefer a "subtle after a while" approach to avoid desensitization. Related: §6.2 notes the silhouette itself does NOT stay gold; only the aura above.

### 9.2 Multi-pet expanded view layout

With up to 4 pets adopted (DEC-006), how does the expanded view compose them? Options:
- **(a) Single-pet focus:** Only `activePetId` shown at 6×20. A pet-switcher command cycles through others.
- **(b) Tile layout:** Up to 4 pets shown simultaneously, each at 4×12 (smaller cell). Status bar per pet.
- **(c) Carousel:** One pet at full size; small thumbnails of others below, swappable.

I lean **(a)** for v1 — same stance as the compact renderer's "pin" approach (compact §8.5). Tile and carousel are implementable later but add layout complexity and force the pet cell to shrink. **Product-owner confirm.**

### 9.3 Can Ascendants (L1024) get sick?

DEC-009 mechanically can kill any pet including Ascendants. `compact-frames.md §8.4` already flagged: "Should the compact HUD hide sickness at 1024, or display it honestly?" — compact-half defaulted to "hide" but flagged for decision. **The expanded view has more pixel budget and can show sickness honestly** (silhouette droops with aura intact, status bar shows mood `:(`). But should the aura itself suppress — i.e., an Ascendant is literally immune? **Lean honest in expanded, hidden in compact** — but this forces two different truth models for the same pet. Product-owner call.

### 9.4 What drives idle-variant re-selection mid-session?

`selectIdleVariant(p)` (§5.4) is a pure function of the personality vector. If the user's 7-day language exposure shifts the vector mid-session (architecture §5.4 daily refresh), the active idle might change to a different variant. Should the transition be:
- **(a) Immediate:** next tick picks the new variant. Visually jarring if the user notices.
- **(b) Cross-fade:** play the current idle's remaining cycle, then switch. Graceful.
- **(c) Gated on the `personality:drift` event only:** idle stays the same until an explicit drift event, then changes with a small log-panel notification.

I lean **(c)** — ties the visual change to the `personality:drift` log event (architecture §5.4), which is already the "subtle 'your glyphling feels different today' message" moment. **Product-owner confirm.**

### 9.5 Evolving scene: do we replay it manually from a command?

The `evolve-shimmer` scene fires on L3 (hatchling→juvenile) and L10 (juvenile→adult). After it plays once per stage, there's no trigger for it again — the user misses it if they weren't looking. **Should we offer a `glyphling replay evolve` command to re-watch it?** Nostalgic, cheap to implement, no schema change needed. I lean **yes** but product-owner might prefer "some moments only happen once" for emotional weight. Related: DEC-005 Tier 2 "frame selection" could cover replay at capture-time.

### 9.6 Sad scene duration — capped vs indefinite?

The `sad` scene loops but this spec notes "short-duration, ≤30s then decays." Should a sad mood cap at 30 s and automatically return to idle, or stay until a positive interaction resets it? I've designed for **cap** — a perpetually-sad pet feels like an error state; a brief sadness is emotional. **Product-owner confirm the cap semantics.**

### 9.7 Handoff of the 6 open questions from `compact-frames.md` to the expanded half

The compact spec's §8 listed 7 open questions; DEC-017 resolved §8.1 (egg names), leaving 6. This expanded spec's work now answers or re-flags them:

| Compact §8 question | Status after this spec |
|---------------------|--------------------------|
| §8.2 Hungry mood glyph (`:o` vs `:P`) | **Still open** — expanded view uses the same HUD vocabulary as compact; deferred to product-owner. |
| §8.3 Level display at 1024 (`Lv 1024` vs `Lv MAX`) | **Confirmed `Lv 1024`** — this spec §6.2 affirms the sacred number is the flex. |
| §8.4 Ascendant sickness rendering | **Partially resolved** — compact says hide, expanded says honest (§9.3 above); product-owner needs to ratify the split. |
| §8.5 Multi-pet HUD rotation | **Re-flagged as §9.2 here** — both surfaces default to "pin"; tile/carousel deferred. |
| §8.6 Reduced-motion detection | **Still open** — this spec provides reduced-motion variants (§4.5 levelup-flash) but does not resolve the detection mechanism. `PREFERS_REDUCED_MOTION` env var is the strawman. |
| §8.7 Emoji cell-width detection | **Still open** — expanded view mostly avoids emoji (ASCII-first) so this is primarily a compact-side concern; deferred. |

---

## 10. Summary for @web-developer — Implementation Handoff

This spec is design-only. The implementation half of TODO-007 is the next task, and it's @web-developer's to own. Here's what you need:

### 10.1 File layout to generate

```
animations/
├── types.ts                        (already exists — extend per §4.1 recommendations)
├── scenes/
│   ├── index.ts                    (registers all scenes; exports `SCENES` map)
│   ├── idle-baseline.ts
│   ├── idle-chipper.ts
│   ├── idle-stoic.ts
│   ├── idle-curious.ts
│   ├── idle-grumpy.ts
│   ├── eat-small.ts
│   ├── eat-feast.ts
│   ├── sleep.ts
│   ├── sleep-deep.ts
│   ├── play-bounce.ts
│   ├── play-chase.ts
│   ├── sick.ts
│   ├── sick-worse.ts
│   ├── happy-wag.ts
│   ├── happy-sparkle.ts
│   ├── sad.ts
│   ├── hatch-crack.ts
│   ├── hatch-emerge.ts
│   ├── evolve-shimmer.ts
│   ├── death-fade.ts
│   ├── levelup-flash.ts
│   └── ascend-1024.ts
└── species/                        (optional — if you prefer per-species silhouette tokens as data)
    ├── circuit.ts
    ├── rune.ts
    ├── shard.ts
    └── bloom.ts
```

**Alternative layout** per DEC-017: `animations/<species>/<scene>.ts` — use this ONLY if you find scenes diverge enough per-species that shared scene files become unwieldy. The recommended layout above keeps one scene file per scene, with species-swap handled via a `speciesTokens` lookup at render time. Less duplication, one edit to restructure a scene updates all species at once.

### 10.2 Scene type shape to use

Minimum viable (matches architecture §12.3):

```ts
export interface Scene {
  id: SceneId;
  frames: Frame[];           // expanded-view frames (§4)
  compact: CompactFrame[];   // statusline frames (REQUIRED per DEC-016)
  fps: number;               // per-scene (see §1.2 targets)
  loop: boolean;
}
```

Recommended extensions (from §4.1):

```ts
export interface Frame {
  content: string;
  durationMs?: number;
  effectRow?: string;        // 1 row ABOVE the silhouette
  shadowRow?: string;        // 1 row BELOW the silhouette
  palette?: Record<string, ColorToken>;
}

export interface Scene {
  // ...
  chainsTo?: SceneId;        // for one-shot sequences (hatch-crack → hatch-emerge)
}
```

You may elide `chainsTo`, `effectRow`, `shadowRow`, `palette` if you find a simpler shape covers all the scenes. `content` + `durationMs` + `compact[]` is the hard floor.

### 10.3 Where to read the data from

- **This file** (`docs/design/expanded-frames.md`) — narrative specification with ASCII exemplars.
- **`docs/design/compact-frames.md`** — paired compact vocabulary (already authored). Every scene in this spec has a `compact:` key in the Scene Catalogue §3 that maps to a frame set in compact §4.
- **`docs/architecture.md` §12.3** — the formal `Scene` type contract.
- **DECISIONS.md** — DEC-017 species names; DEC-015 Ink animation pattern; DEC-016 dual-mode contract.

Build-time assertions (§8.4) should be implemented as a small test under `tests/unit/animations.test.ts`: load all scenes from `SCENES`, assert `frames.length > 0 && compact.length > 0` per scene, assert `compact` frames fit ≤3×≤60, assert `palette` references only known tokens.

### 10.4 `useFrame(fps)` integration

Per DEC-015: implement a single `useFrame(fps)` hook (shared across all animated components). The animated pet cell is wrapped in `React.memo`. The parent `<Box>` is static (fixed size, bordered), the inner `<Text>` is the animated child.

One subtle thing: when a scene is a one-shot with `chainsTo`, the AnimationEngine must detect end-of-frames and dispatch a scene transition. Cleanest pattern:

```ts
// inside AnimationEngine
function tick() {
  const scene = scenes[state.sceneId];
  if (!scene.loop && state.frameIndex >= scene.frames.length - 1) {
    if (scene.chainsTo) {
      setState({ sceneId: scene.chainsTo, frameIndex: 0 });
    } else {
      // latch on last frame (e.g., death-fade-static)
    }
  } else {
    setState({ frameIndex: (state.frameIndex + 1) % scene.frames.length });
  }
}
```

### 10.5 Handoff checklist for @web-developer

- [ ] Extend `animations/types.ts` per §4.1 — add `compact: CompactFrame[]`, optional `effectRow`/`shadowRow`/`palette`/`chainsTo`.
- [ ] Import `CompactFrame` type from `src/render/compact.ts` (or wherever TODO-015 lands it).
- [ ] Author 22 scene files per §3 catalogue, using §4.5 examples as reference.
- [ ] Wire species-token substitution (lookup table: species × stage → silhouette chars).
- [ ] Implement `selectIdleVariant(personality)` per §5.4.
- [ ] Add build-time validation test (§8.4 + §10.3).
- [ ] For each scene, author the paired `compact: CompactFrame[]` per §8.3 table. Where compact-frames.md doesn't yet have a pair (happy, sad, hatch, evolve, ascend, grumpy-idle, curious-idle), author those new compact frames as part of this work or flag a follow-up @designer task.

---

## 11. Authoring Checklist (hard + soft rules)

Hard rules (do not break without a DEC):

1. **Pet cell:** exactly 6 rows × 20 cols, fixed-size, no `Box borderStyle` on the animated content (DEC-015).
2. **Frame.content** rendering width: ≤20 visible cols per row (trim trailing whitespace at render).
3. **Frame.content** rendering height: ≤6 rows (including effectRow + shadowRow if used).
4. **Palette:** use only the 11 tokens defined in `compact-frames.md §6.2`. No new colors.
5. **Species identifiers:** lowercase `circuit | rune | shard | bloom` (DEC-017). No exceptions.
6. **Every scene ships `compact: CompactFrame[]`.** Empty fails build.
7. **No motion in `setInterval` callback** (DEC-015). Only `setState(i => i + 1)`.
8. **React.memo** the animated component.
9. **Reduced-motion variant** required for any scene at ≥20 fps (levelup-flash and ascend-1024).
10. **One-shot scenes** declare `chainsTo` or `loop: false` + latching behavior.

Soft rules (recommended):

- Prefer authoring at 10 fps baseline; reserve 15–30 fps for action beats and peak moments.
- Silhouette corner characters are identity-defining — keep them stable across all frames of a loop.
- effectRow/shadowRow should be optional — most idle frames don't need them.
- When in doubt, look at the reference circuit-adult examples in §4.5 and mirror the structure.
- Test at least one frame per scene in a 16-color terminal (Apple Terminal default) to confirm palette survives ANSI-16 fallback.

---

*End of expanded-frame animation spec v1.*
