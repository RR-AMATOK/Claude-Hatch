# glyphling — Wide-Tier Silhouettes (v1)

**Status:** Design spec (for review)
**Author:** @designer
**Date:** 2026-04-17
**Applies to:** `glyphling statusline` wide tier (`cols ≥ 140`) — 12 silhouettes (4 species × 3 stages)
**Companion to:** [`statusline-wide.md`](statusline-wide.md), [`compact-frames.md`](compact-frames.md) (narrow vocabulary — unchanged)
**Related:** DEC-016 (dual-mode, ≤30ms budget), DEC-017 (lowercase species)

---

## 1. Contract

Every wide silhouette is **exactly 4 rows × ≤18 visible columns**, monospace-safe on Terminal.app / iTerm2 / Ghostty / WezTerm.

Character set (same allowlist as narrow silhouettes):

```
( ) [ ] { } < > / \ | - _ + * . , ' " : ; ~ ^ o O 0 # = @ v z Z space
```

No emoji. No wide-grapheme characters. No box-drawing Unicode (the HUD's `█ ░` live on a separate row and are rendered by the HUD composer, not the silhouette). No Nerd Font glyphs. No zero-width joiners.

**Stage labels in this doc** — `juvenile / adult / elder` — align positionally with the existing `LifeStage` enum in `src/render/compact.ts`:

| This doc | Code enum (`LifeStage`) | Level range |
|----------|-------------------------|-------------|
| juvenile | `hatchling` | 0–2 |
| adult | `juvenile` | 3–9 |
| elder | `adult` | 10–1023 (plus 1024 Ascendant reuses elder art + gold palette) |

Stage-vocabulary reconciliation is flagged in `statusline-wide.md §9.2` as a product-owner call.

**Visual-DNA rule.** Every wide silhouette must read as *the same creature* as its narrow-2-row counterpart. The eye-glyph, mouthpart/jaw, and species-signature accent (brackets / horns / spikes / petals) carry forward to rows 2–3 of the wide art. Rows 1 and 4 are *added* rows and express personality:

- **Row 1** — breath / antenna / crown / spark / petal canopy. Animatable across scene cycles.
- **Rows 2–3** — the identity rows. Same skeleton as the narrow silhouette. Change only small details (eye blink, mouth chew).
- **Row 4** — ground / stand / shadow / root. Mostly static across idle cycles; identity anchor.

---

## 2. The 12 silhouettes

Rulers below show visible cols 1–18. Each silhouette is shown as a pre-formatted code block with exactly 4 rows.

### 2.1 circuit — geometric, pragmatic

Narrow-DNA recap: `[oo]` eyes in square brackets, `||` pipe limbs, `+` joints, `=` shoulders.

**juvenile (hatchling, L0–2)** — fragile, just-plugged-in:

```
123456789012345678
    .
   [oo]
   -||-
    ^^
```

Visible cols: 1, 4, 4, 2. Max col-index: 8.

**adult (juvenile, L3–9)** — standing on its own:

```
123456789012345678
    |
   /[oo]\
   +-||-+
    ^  ^
```

Visible cols: 1, 7, 7, 4. Max col-index: 9.

**elder (adult, L10–1023)** — full posture, antenna signalling:

```
123456789012345678
    .v.
   /[o-o]\
  +==|--|==+
    |_||_|
```

Visible cols: 3, 8, 10, 6. Max col-index: 11.

**Design commentary.** The circuit's narrow silhouette is all *joints and brackets* — its identity is "engineered presence." The added rows reinforce that engineering rather than softening it:

- **Row 1 antenna** — `.`, then `|`, then `.v.` across stages. A single dot reads as "powered on," the pipe reads as "antenna extended," and the `.v.` trio reads as a small pennant or signal pulse. No decorative flourish — every glyph is load-bearing.
- **Row 4 stand** — tiny feet (`^^`, `^ ^`, `|_||_|`) that evolve from a fragile hatchling-crouch into a planted elder-stance. The `|_||_|` elder base mirrors the narrow silhouette's row 2 `+=|--|=+` shoulders — symmetry between top and bottom that says "this thing is built to last."
- **Why this reads as circuit and not rune:** square brackets, right-angle joints, no curves. The wide variant preserves all three.

### 2.2 rune — angular, mystical, philosophical

Narrow-DNA recap: `<..>` angle-bracket face, `^` horns/crown, `.` dot eyes, `\/|` sigil-slashes.

**juvenile (hatchling, L0–2)** — a small warded shape:

```
123456789012345678
    ^
   <..>
    \/
    .
```

Visible cols: 1, 4, 2, 1. Max col-index: 7.

**adult (juvenile, L3–9)** — horns emerging, sigil grounded:

```
123456789012345678
   ^ ^
   <^..^>
    \||/
    o.o
```

Visible cols: 3, 6, 4, 5. Max col-index: 9.

**elder (adult, L10–1023)** — full crown, three grounded sigils:

```
123456789012345678
    ^^^
   <^-..-^>
    \|||/
   .  .  .
```

Visible cols: 3, 8, 5, 9. Max col-index: 11.

**Design commentary.** The rune's mystical reading comes from *upward-pointing glyphs* (crown horns) and *downward-pointing glyphs* (sigil slashes). The narrow silhouette compresses both into two rows; the wide version lets them breathe:

- **Row 1 crown** — a single `^` becomes `^ ^` becomes `^^^` as the creature ages. Reads as "horns grew in." No halo, no sparkles — just more of the same structural element.
- **Row 4 sigil-trio** — a single dot grows into `o.o` (a tiny framed rune) and finally three widely-spaced sigils. Reads as "this creature has left marks in the world." The elder's three sigils deliberately exceed the body's width by 1–2 cols on each side, giving a grounded presence without adding new character shapes.
- **Why this reads as rune and not circuit:** no right angles. Angle brackets, slashes, and dots only. The wide variant carries the motif forward untouched.

### 2.3 shard — crystalline, energetic, gruff

Narrow-DNA recap: `/oo\` sharp face, `\\//` double-slash fins, `*` spikes, `||` core.

**juvenile (hatchling, L0–2)** — small crystal with one spark:

```
123456789012345678
    *
   /oo\
   \\//
   . .
```

Visible cols: 1, 4, 4, 3. Max col-index: 7.

**adult (juvenile, L3–9)** — single crest spark, flanked rubble:

```
123456789012345678
    *
   /*oo*\
   \\||//
   .* *.
```

Visible cols: 1, 6, 6, 5. Max col-index: 9.

**elder (adult, L10–1023)** — twin crest sparks, full rubble field:

```
123456789012345678
    *   *
   /**oo**\
   \\\||///
   .*. .*.
```

Visible cols: 5, 8, 8, 7. Max col-index: 11.

**Design commentary.** The shard's narrow silhouette is *jagged symmetry* — the creature reads as a crystal about to vibrate. The wide version pushes the jaggedness outward rather than up:

- **Row 1 crest** — a single `*` spark above the juvenile, splitting into `*   *` twin sparks at elder. The gap between the elder's two sparks deliberately exceeds the narrow width, visually saying "this thing throws off energy at the edges, not the centre."
- **Row 4 rubble/shed-shards** — `. .`, then `.* *.`, then `.*. .*.`. Little chunks of the creature that have fallen to the ground. Reinforces the "energetic" personality without adding a new character: every rubble-glyph is already in the creature's body.
- **Why this reads as shard and not rune:** slashes double or triple up, asterisks not carets, sharp corners not right-angle brackets. The wide variant keeps the signature `\\\ /// ` triple-slash fins.

### 2.4 bloom — organic, friendly, curious

Narrow-DNA recap: `(oo)` round face, `~` petals/leaves, `v` cheek/paws, `*` flower-accents.

**juvenile (hatchling, L0–2)** — a sprout:

```
123456789012345678
    ~
   (oo)
    vv
    ,.
```

Visible cols: 1, 4, 2, 2. Max col-index: 7.

**adult (juvenile, L3–9)** — petals paired, soil visible:

```
123456789012345678
    ~ ~
   (~oo~)
    \vv/
    ,.,
```

Visible cols: 3, 6, 4, 3. Max col-index: 9.

**elder (adult, L10–1023)** — full canopy, rooted soil:

```
123456789012345678
   ~ * ~
   (~*oo*~)
    ~\vv/~
    ,.,.,
```

Visible cols: 5, 8, 6, 5. Max col-index: 11.

**Design commentary.** The bloom's narrow silhouette leans into *curves and softness* — parentheses, tildes, lowercase v's. The wide version grows the plant outward both up (canopy) and down (soil):

- **Row 1 canopy** — a single petal `~` becomes `~ ~` pair, then gains a central flower-accent `*` at elder (`~ * ~`). The elder's centre `*` mirrors the `*` accents inside the narrow adult silhouette — a visual rhyme that says "the creature's personality keeps growing from the inside."
- **Row 4 soil** — `,.`, `,.,`, `,.,.,`. Progressively wider root-patch. Commas and periods only — no new character introductions. Reads as "rooted, grounded, steady."
- **Why this reads as bloom and not shard:** everything curves or rounds. No slashes, no asterisks except as flower-accents (never spikes). The wide variant keeps `( ~ v ,` as its entire vocabulary.

---

## 3. Scene-cycle compatibility

The wide silhouettes must coexist with the existing compact scene cycles (`compact-frames.md §4`). The renderer composes `silhouette + scene-overlay` at render time. Below, "animatable row" means the scene cycle MAY vary the row across frames; "static row" means the row does NOT change across a given scene's frames.

### 3.1 Per-row animation budget

| Row | Animatable in idle? | Animatable in eating? | Animatable in sick? | Animatable in sleep? | Static in level-up? |
|-----|---------------------|-----------------------|---------------------|----------------------|---------------------|
| Row 1 (breath/antenna/crown/canopy) | **Yes** (micro — single-glyph swap) | No (keep static — mouth is the star) | Yes (droops — see §3.3) | No (keep static — pet is still) | Yes (peak spark moves here — §3.4) |
| Row 2 (upper face — eyes) | **Yes** (blinks — matches narrow row 1 cycle) | Yes (squint joy `^-^`) | Yes (`x` eyes) | Yes (`-_-` closed) | Yes (`O-O` widen) |
| Row 3 (lower face — mouth/shoulders) | **Yes** (breath shift — matches narrow row 2 cycle) | Yes (`UU` → `~~` chew) | Yes (sag) | Static | Yes (beam) |
| Row 4 (stand/sigil/rubble/soil) | **Static** across idle | Static | Yes (shiver — shift 1 col L/R) | Static | Static |

Rule of thumb: **the narrow silhouette's 2 rows map to wide rows 2–3**. Wide rows 1 and 4 are *additive* and mostly move in idle baseline only. This keeps the existing scene authoring effort bounded — no new scene frames need to be authored per species; the wide silhouette is a *skin*, not a new scene set.

### 3.2 Idle-baseline wide cycle (circuit-elder, 4 frames, 8s total)

Per-row deltas across the 4 frames — baseline means "use the elder silhouette as authored in §2.1":

| Frame | Row 1 | Row 2 | Row 3 | Row 4 |
|-------|-------|-------|-------|-------|
| 1 (steady) | baseline `    .v.` | baseline `   /[o-o]\` | baseline `  +==|--|==+` | baseline |
| 2 (antenna pulse) | `    . . .` | baseline | baseline | baseline |
| 3 (blink) | baseline | `   /[o-~]\` | baseline | baseline |
| 4 (breath out) | baseline | baseline | `  +==|__|==+` | baseline |

The narrow-tier idle-baseline cycles rows 1–2 (the narrow silhouette). At wide, those same cycles apply to rows 2–3, row 1 gets its own low-intensity cycle, and row 4 stays put.

### 3.3 Sleeping wide cycle — `z`/`Z` particle anchors

Sleep particles attach to the **right of row 2 at col 15** and **right of row 3 at col 17**. The species silhouette does not change shape during sleep (row 1 keeps its static crown/antenna; row 4 keeps its stand).

Bloom-elder sleeping frame 1:
```
123456789012345678
   ~ * ~
   (~*oo*~) z
    ~\vv/~    Z
    ,.,.,
```

Bloom-elder sleeping frame 2 (particles swap `z` ↔ `Z`):
```
123456789012345678
   ~ * ~
   (~*oo*~) Z
    ~\vv/~    z
    ,.,.,
```

This matches the narrow-tier sleep convention (particles next to the silhouette, not overlapping). The extra vertical space at wide tier gives `z`/`Z` more room to breathe — they no longer need to bracket the creature tightly.

### 3.4 Level-up flash anchors

The level-up "peak" glyphs attach to **row 1, centered over the silhouette's face (col 4–6)**. Row 1's baseline content (antenna / crown / canopy / crest) is temporarily replaced by the peak-glyph for ~1.5s, then restored. Row 4 never changes during level-up — the ground stays the same, the celebration is overhead.

Circuit-elder level-up frame 3 (peak burst):
```
123456789012345678
   \*|*/
   /[O-O]\
  +==|--|==+
    |_||_|
```

Circuit-elder level-up frame 5 (settle — row 1 restored):
```
123456789012345678
    .v.
   /[o-o]\
  +==|--|==+
    |_||_|
```

For rune/shard/bloom the same anchor applies — rows 2–3 receive the `O-O` wide-eye treatment and the narrow level-up row-2 treatment (`+=|--|=+` baseline, held); row 1 receives the peak glyph; row 4 holds.

### 3.5 Sick-state wide cycle (shard-elder, 3 frames, 6s cycle)

| Frame | Row 1 | Row 2 | Row 3 | Row 4 |
|-------|-------|-------|-------|-------|
| 1 (droop) | `    .   .` (crest dims to dots) | `   /**xo**\` | baseline | baseline |
| 2 (worse) | `    .   .` | `   /**xx**\` | baseline | baseline |
| 3 (shiver) | `    .   .` | `   /**xx**\` | baseline | `  .*. .*.` (shifts 1 col left) |

Row 1's `*   *` elder-crest downgrades to `.   .` (spark dims to dot) to reinforce the droop — less energetic without introducing new characters. Row 4 shivers by 1-col L/R in the final frame, matching narrow-tier sick convention.

### 3.6 Reduced-motion (`GLYPHLING_REDUCED_MOTION=1`)

Per `statusline-wide.md §6`: drop to 2-frame cycle. Recommended 2-frame idle skeleton for all species:

- Frame A: the "steady" elder-wide silhouette (row 1 baseline, rows 2–3 baseline, row 4 baseline).
- Frame B: row 3 breath-variant only (e.g. `+==|__|==+` for circuit, `~\vv/~ ` for bloom). No row 1 variation, no blink.

This preserves the "alive but not distracting" reading for users who have motion sensitivity enabled.

---

## 4. Validation checklist

Before accepting these 12 silhouettes into `SILHOUETTES[species][stage].wide`:

- [ ] Each entry is exactly 4 rows.
- [ ] Each row is ≤18 visible cells (measured by `visibleWidth()`).
- [ ] Only characters from the allowlist (§1) appear.
- [ ] Row 2 of wide matches the *first glyph-pattern* of the narrow silhouette (same eyes, same framing bracket/paren).
- [ ] Row 3 of wide matches the *second glyph-pattern* of the narrow silhouette (same mouth/shoulder structure).
- [ ] Rows 1 and 4 use only characters already present in rows 2–3 (no net-new character introductions per species).
- [ ] Scene-cycle overlays (blink, chew, droop, sleep-particles, level-up peak) compose onto rows 2–3 without colliding with row 1 or row 4.
- [ ] Under `NO_COLOR=1`, each silhouette reads as the same creature as its narrow counterpart.

If any checkbox fails, the silhouette needs re-authoring — do not paper over with color or motion.

---

## 5. Implementation Handoff

**For @web-developer — integration with `src/render/compact.ts`:**

1. Extend the `SILHOUETTES` constant shape from `SilhouettePair` to `{ narrow: readonly [string, string]; wide: readonly [string, string, string, string] }`. Narrow entries are already present — preserve them verbatim. Wide entries are the 12 blocks in §2 above (copy the literal strings).

2. Add a build-time assertion `assertWideFrameDimensions()`:
   - For each `SILHOUETTES[species][stage].wide`: exactly 4 rows, each `visibleWidth(row) ≤ 18`.
   - Character-set check against the §1 allowlist (regex: `/^[\s()\[\]{}<>\/\\|\-_+*.,'":;~^oO0#=@vzZ]*$/`).

3. Compose wide output in `assembleWideOutput(pet, "wide", sceneKey, tick, claudeCtx)`:
   - Pull `wide` silhouette from `SILHOUETTES[pet.eggType][stage]`.
   - Apply scene overlay to rows 2–3 only — reuse the existing narrow-scene-frame lookup, but target indices 1 and 2 of the 4-row array instead of 0 and 1.
   - Apply row-1 overlay per `§3` (antenna pulse for idle, peak glyph for level-up, etc.) — this is new and species-agnostic (same glyph vocabulary reuses row-1 characters).
   - Keep row 4 static except for sick's 1-col shiver.
   - Append HUD row below? No — the wide tier composes HUD **on row 4 to the right of the silhouette's ground** (see `statusline-wide.md §4.3`), not as a fifth row. The compose step concatenates `row[4] + "  " + renderHudRow(pet) + "  " + padStart(renderRightGroup(...), remaining)`.

4. Hard-code `WIDE_HUD_START_COL = 15` (max across all species×stages of silhouette-rightmost-col + 3-space margin: circuit-elder row 3 `  +==|--|==+` ends at col 12, plus 3 → col 15). Using a constant avoids per-tick width recomputation. The HUD renders at this start col on row 4 regardless of species — all silhouettes fit inside cols 0–12.

5. Sleep particles are appended to rows 2 and 3 (`" z"` and `"  Z"` at cols 15/17) — the silhouette strings themselves do NOT include sleep particles; they're overlaid by the sleep-scene frame. Because sleep particles share the col-15 start with the HUD, **sleep and HUD never coexist on the same row**: during sleep, the right group still renders (ctx% etc) on row 4, but the HUD-left group renders at col 15 on row 4 and the sleep particles attach to rows 2–3 above it — no collision.

**Pitfalls:**
- **Do not mechanically scale** narrow silhouettes into wide. The wide art is authored — copy verbatim.
- **Row 4 is shared real estate.** Anything that wants to render beside the silhouette at wide tier (HUD, right group, sleep particles) starts at col 14 minimum. Respect the constant.
- **Never introduce a row-5.** Wide tier is 4 rows, period. The HUD is on row 4, not row 5.
- **Level-up peak glyph replaces row 1 for the 1.5s duration**, then reverts. The `Scene.loop: false` declaration on level-up handles the revert.

**Test additions (extend `src/render/compact.widetier.test.ts`):**
- Snapshot test for each of 12 species×stage wide silhouettes — assert 4 rows, each ≤18 visible cols, character-set conforms to allowlist.
- Scene-overlay test: given circuit-elder + idle-baseline + tick N, assert rows 2–3 match the narrow scene content and rows 1 and 4 match the wide-specific overlay.
- Sleep-particle test: given bloom-elder + sleeping scene + tick N, assert row 2 ends with `" z"` / `" Z"` at cols 15 (not row 1 or row 4).
- Reduced-motion test: with `GLYPHLING_REDUCED_MOTION=1`, assert the wide output is deterministic across 10 consecutive ticks (frame A and frame B only, alternating).

*End of wide-tier silhouettes spec v1.*
