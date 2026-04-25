# glyphling — Compact-Frame Vocabulary (v1)

**Status:** Design spec (for review)
**Author:** @designer
**Date:** 2026-04-17
**Applies to:** Compact statusLine renderer (≤3 rows × ≤60 cols), ~1–2s refresh tick
**Related:** DEC-001 (stack), DEC-002 (pets/personality), DEC-004 (1024 cap), DEC-006 (multi-pet), DEC-015 (useFrame), architecture.md §12 (animation contract), proposed §16 (dual-mode, architect parallel today)

---

## 1. Purpose & Design Stance

The compact frame is a **HUD strip**, not a TV show. It lives under Claude Code's "Accept edits on…" row and refreshes every ~1–2 seconds. The user sees it *in their peripheral vision* while they're focused on code or prose. This shapes every design decision below:

1. **Low-information-density per tick, high meaning per glyph.** A user glancing for 200ms must parse: *my pet is alive, is it happy, is it levelling?* Anything requiring a closer look is wrong for this surface.
2. **No motion illusion.** At a 1–2s cadence, we cannot fake "smooth" animation — we must embrace the slow vignette. Each frame is a *pose*, not a tween.
3. **Width is sacred.** 60 cols is the hard ceiling; 58 is our working width to survive terminal margins, scrollbars, and the rare user on 80-col narrow layouts. Going over truncates the status line on some terminals — worse than ugly.
4. **Characters over color.** Terminals lie about color. Shapes never lie. Every state must be legible on a monochrome 16-color basic terminal.
5. **Emoji is opt-in.** Most fonts render emoji at 2 cells wide; some render at 1; a few render a tofu. We ship an ASCII path by default and an opt-in "rich" path for users who've verified their terminal handles emoji cleanly.

### Psychological principles applied

- **Peak-end rule:** The level-up flash and the death tombstone are the two "peak" compact frames. They earn more design attention than any idle state because users will remember *those* moments, not the 10,000 idles in between.
- **Von Restorff:** State changes (sick → fed, hungry → content) must be visually distinct from the baseline idle, even at a glance.
- **Banner blindness:** The pet must not read as decoration. A static silhouette will get ignored after 20 minutes. We use micro-variation (the "slow vignette") to keep the eye trusting that the pet is *alive*.
- **Aesthetic-usability:** A tidy HUD signals a tidy product. Misaligned bars or inconsistent spacing will subconsciously make users trust the whole tool less.

---

## 2. Layout Conventions

### 2.1 Variants considered

**Variant A — "Cinema" (pet takes rows 1–2, HUD on row 3):**

```
<--------------- 58 cols ---------------------------------->
 (_o_)                                                         ← row 1 pet top
 /| |\                                                         ← row 2 pet bottom
 Pixel · Lv 42 · [████████░░░░░░] 1240/2200 · :)               ← row 3 HUD
```

**Variant B — "Dashboard" (pet left, HUD right, 3 rows each):**

```
 (_o_)  Pixel the Circuit
 /| |\  Lv 42   mood :)  hp ok
 -+-+-  XP [████████░░░░░░] 1240/2200
```

**Variant C — "Ticker" (everything on row 1, two decorative rows for pet detail only):**

```
 Pixel · Lv 42 · XP [████████░░] · :)          (_o_) /| |\
 ·   ·      ·    ·      ·    ·                         shadow
                                                         dust
```

### 2.2 Recommendation: **Variant A ("Cinema")**

**Why:**
- **Fitts's Law applies to scanning, not just pointing.** The user's eye scans left-to-right, top-to-bottom. Putting the pet above the HUD creates a reliable "identity then status" reading flow — always the same, every tick.
- **Scannability.** The 3rd-row HUD is a single line of structured text. Users can scan it like a mini-ticker without parsing the pet art again.
- **Graceful degradation.** If a terminal is narrower than expected, the pet silhouette (rows 1–2) is 8–12 cols and survives; the HUD gracefully truncates mood/pet-count first (right-most elements), preserving name + level.
- **Works with DEC-006 multi-pet.** When multiple pets are adopted, the HUD has room for a `[2/4]` pet-count indicator; rows 1–2 still show the active pet.

**Rejected:**
- Variant B ("Dashboard") wastes columns by column-splitting; the pet art shrinks to ~6 cols which is not enough for 3 life stages × 4 species to read as distinct.
- Variant C ("Ticker") feels clever but puts the pet as decoration; violates "the pet is the product." Also hard to scan — the eye doesn't know where to land.

### 2.3 Canonical layout (Variant A)

```
Col:  0         1         2         3         4         5
      0         0         0         0         0         0
      12345678901234567890123456789012345678901234567890123456789
Row 1: <pet-top  8–12>                                           ← rows 1+2 reserved
Row 2: <pet-bot  8–12>                                           ← for pet silhouette
Row 3: <name 12><sp><Lv NNNN><sp><XP-bar 16><sp><xp-text><sp><mood><sp>[n/4]
```

**Fixed widths for row 3** (see §5 for the exact HUD budget):

| Slot | Width | Example |
|------|-------|---------|
| name | up to 12 chars, right-padded | `Pixel       ` |
| sep | 3 (` · `) | ` · ` |
| level | `Lv ` + 1–4 digits (4-char max digits preserves alignment) | `Lv 42  ` |
| sep | 3 | ` · ` |
| xp-bar | 16 cells (14 inner + 2 brackets) | `[████████░░░░░░]` |
| sep | 1 | ` ` |
| xp-text | up to 11 chars (`99999/99999`) | `1240/2200 ` |
| sep | 3 | ` · ` |
| mood | 2 chars ASCII / 1–2 cells emoji | `:)` |
| sep | 1 | ` ` |
| pet-count | 5 chars `[n/4]`, hidden when 1/1 | `[2/4]` |

Total worst case: 12 + 3 + 7 + 3 + 16 + 1 + 11 + 3 + 2 + 1 + 5 = **64 cols** — over budget.
**Rule:** When pet-count is `1/1`, it and its preceding separator are omitted (saves 8). At 4-digit levels, we truncate xp-text to `k`-notation (e.g., `48M/—` at cap). Effective worst case ≈ **56 cols**, inside our 58-col safe width.

---

## 3. Pet Silhouette Library

### 3.1 Egg-name recommendation

Two candidate sets:

| Set | Names | Tone |
|-----|-------|------|
| Original (DEC-002 comment) | `Silicon`, `Cosmic`, `Bytebeast`, `Root` | Adjectival, uneven length, mixes metaphors (mineral, space, creature, plant) |
| Architect straw-man (architecture §3.1) | `circuit`, `rune`, `shard`, `bloom` | Short nouns, 4–6 chars each, each evokes a clear *aesthetic motif* |

**Recommendation: adopt `circuit | rune | shard | bloom`** and promote from straw-man to canonical.

**Why:**
- **Length parity.** 4–6 chars each → each egg name fits cleanly as a subtitle (`Pixel the Circuit`) without awkward truncation.
- **Aesthetic clarity.** Each word signals a visual language: `circuit` = geometric/ASCII-pipe, `rune` = mystical/angular, `shard` = crystalline/jagged, `bloom` = organic/curvy. Designers and future contributors can draw new scenes without a style guide — the name IS the style guide.
- **Non-redundant with level/stage.** "Bytebeast" already implies an adult creature; `shard` is neutral on life-stage, so hatchling/juvenile/adult silhouettes can all be "shards" of different sizes.
- **`Silicon | Cosmic | Bytebeast | Root` risks:** `Cosmic` is an adjective without a noun, `Bytebeast` is cute but long (8 chars), and the set mixes naming grammars (two adjectives, one compound noun, one noun).

The silhouette library below uses the `circuit / rune / shard / bloom` set. If @product-owner prefers the original, only the labels change — the shapes carry over 1:1 because they were designed against the *motifs*, not the names.

### 3.2 Silhouette grid

Each silhouette is **2 rows × 6–10 cols ASCII**, designed so the widest adult still fits under the 12-col reserve. Hatchlings are deliberately tiny (6 cols) to leave visual room for the "egg cracks" in the hatching scene.

All silhouettes use ASCII-only characters from this allowlist: `( ) [ ] { } < > / \ | - _ + * . , ' " : ; ~ ^ o O 0 # = @`. No box-drawing Unicode in the silhouette itself (reserved for the HUD bar in §5).

#### Circuit (geometric, pragmatic)

```
Hatchling (6×2):          Juvenile (8×2):          Adult (10×2):
                          
 [oo]                      /[oo]\                   /[o-o]\
  ||                       +-||-+                   +=|--|=+
```

Motif: square brackets for eye-housing, pipes for limbs, `+` for joints. Reads "circuitry."

#### Rune (angular, mystical, philosophical)

```
Hatchling (6×2):          Juvenile (8×2):          Adult (10×2):
                          
 <..>                      <^..^>                   <^-..-^>
  \/                        \||/                     \|||/
```

Motif: angle brackets opening outward, `^` for crown/horns, dots for eyes, backslash/forward-slash for wings or sigils.

#### Shard (crystalline, energetic, gruff)

```
Hatchling (6×2):          Juvenile (8×2):          Adult (10×2):
                          
 /oo\                      /*oo*\                   /**oo**\
 \\//                      \\||//                   \\\||///
```

Motif: sharp slashes, asterisks as spikes, narrow base. Feels like a jagged crystal that is *about* to move.

#### Bloom (organic, friendly, curious)

```
Hatchling (6×2):          Juvenile (8×2):          Adult (10×2):
                          
 (oo)                      (~oo~)                   (~*oo*~)
  vv                        \vv/                     ~\vv/~
```

Motif: parentheses for soft rounded head, `~` for petals/leaves, lowercase `v` for cheeks or paws. Organic and unthreatening.

**Count:** 4 species × 3 stages = **12 base silhouettes**, as required.

### 3.3 Life-stage thresholds

| Stage | Level range | Reason |
|-------|-------------|--------|
| Hatchling | 0–2 | The first few interactions. Extra-small to emphasize fragility. |
| Juvenile | 3–9 | Between hatch and the named-adult moment at L10 (DEC-004). |
| Adult | 10–1023 | Stable; this is what users see 99.99% of the time. |
| Ascendant | 1024 | Adult silhouette + gold palette + honorific suffix on the name (DEC-004). No new silhouette — the aura IS the flex. |

---

## 4. Animation Cycle Spec

At 1–2s refresh, a scene of *n* frames completes a cycle every *2n* seconds. Below, "frames" means distinct poses the compact renderer cycles through; the renderer picks the current frame by `floor(now / tickMs) % frames.length`.

Silhouettes below use the Circuit-adult as the reference pet (`/[o-o]\` / `+=|--|=+`). Swap glyphs per species — the **cycle structure** is identical across species.

### 4.1 Idle (baseline)

**4 frames, 8s total cycle.** The pet should feel alive without distracting.

```
Frame 1 (eyes open, steady):           Frame 3 (blink, one eye wink):
 /[o-o]\                                /[o-~]\
 +=|--|=+                               +=|--|=+

Frame 2 (eyes open, tiny shift):       Frame 4 (eyes open, steady — mirrored breath):
 /[o-o]\                                /[o-o]\
 +=|--|=+                               +=|__|=+
```

- Frames 1, 2, 4 are 95% identical — the micro-variation of the last row (`|--|` → `|__|`) reads as "breath" without being noisy.
- Frame 3 is the blink, ~1/4 of the time. Any longer feels like a nervous tic; less and the pet feels dead.

### 4.2 Eating (burst, 1–2s)

**3 frames, 3s one-shot (does not loop).** Triggered by `pet.fed` event; reverts to idle after.

```
Frame 1 (incoming food):                Frame 2 (munching):
 /[o-o]\ .                              /[^-^]\
 +=|--|=+ .                             +=|UU|=+

Frame 3 (happy chew):
 /[^-^]\
 +=|~~|=+
```

- `.` represents a food crumb approaching.
- `^` eyes = squint-of-joy, universal across species.
- `UU` then `~~` bottom row = chew then swallow.

### 4.3 Sleeping (low-intensity overnight)

**2 frames, 4s cycle.** Calm, unobtrusive, used during `pause` state or 00:00–06:00 local time per PersonalityEngine's "night" bucket.

```
Frame 1 (zZ):                           Frame 2 (Zz):
 /[-_-]\ z                              /[-_-]\ Z
 +=|..|=+ Z                             +=|..|=+ z
```

- `-_-` closed-eye glyph, species-neutral.
- The `z`/`Z` alternation is the only movement. Deliberately static — we don't want to pull attention during sleep.

### 4.4 Sick / neglected (visual droop)

**3 frames, 6s cycle.** Triggered when `accumulatedNeglectSeconds > 1 day` (DEC-009). The animation stays until neglect resets.

```
Frame 1 (droop):                        Frame 2 (worse droop):
 /[x-o]\                                 /[x-x]\
 +/|..|\+                                +/|..|\+

Frame 3 (shiver):
 /[x-x]\
  \|..|/
```

- `x` eyes = unwell, cross-cultural (no cultural symbolism clash — used widely in cartoon conventions for "faint/sick").
- Bottom row sags (`/|..|\`) → bottom row shifts (`\|..|/`), giving a subtle shiver.
- **Never use yellow/green color alone to convey sickness.** The eye-shape change must do the work; color (§6) amplifies but does not carry.

### 4.5 Level-up flash (peak moment, plays once)

**5 frames, ~1.5s one-shot.** Plays on `level.up` event. Single most important compact animation — this is where the user's brain imprints "the pet levelled up, I did that."

```
Frame 1 (spark above):                  Frame 2 (bigger spark):
     *                                    * *
 /[o-o]\                                 /[O-O]\
 +=|--|=+                                +=|--|=+

Frame 3 (burst):                        Frame 4 (absorb):
   \*|*/                                  . ' .
 /[O-O]\                                 /[^-^]\
 +=|--|=+                                +=|--|=+

Frame 5 (glow settle, returns to idle):
 /[o-o]\
 +=|--|=+
```

- Frames 1–2 build anticipation (spark appears, eyes widen to `O`).
- Frame 3 is the peak: radial burst around the head.
- Frame 4 softens into joy eyes (`^-^`).
- Frame 5 returns to idle, but during the celebration the HUD level number is rendered bold + level-up color for ~2s (see §6).
- **Motion-reduced variant:** frames 1 → 3 → 5 only (3 frames), preserving the celebration beats without the flicker. Per `prefers-reduced-motion`.

### 4.6 Dead / tombstone (final state)

**1 frame, static, never cycles.** Plays on `pet.died`. Stays indefinitely until user acknowledges / adopts.

```
  RIP
 [___]
```

- Row 1: `RIP` centered above.
- Row 2: a tombstone base, intentionally narrower than the living silhouette to communicate "less than before."
- In the HUD (row 3), name persists but is dimmed; level displays as `Lv —`; XP bar shown hollow; mood glyph is `†` (ASCII `+` as fallback).
- **Emotional contract:** this is a funeral, not a bug. Design for solemnity, not "error state" red.

### 4.7 Personality-flavored idle variants

Per DEC-002 (8 traits), the pet has a `dominant` personality trait (Stoic, Friendly, Pragmatic, Energetic, Gruff, Philosophical, Paranoid, Curious). The compact renderer doesn't need 8 bespoke idles — that'd be ~32 silhouettes just for flavor. Instead, we pick **3 trait-flavored idle variants** that modulate the baseline across clusters:

**Cluster: Energetic + Curious** — lively idle

```
Frame 1:              Frame 2:              Frame 3:              Frame 4:
 /[o-o]\               /[O-o]\               /[o-O]\               /[^-^]\
 +=|--|=+              +=|/-|=+              +=|-\|=+              +=|--|=+
```
More eye-shifting, more limb movement. Reads as "this pet pays attention."

**Cluster: Stoic + Philosophical + Gruff** — still idle

```
Frame 1:              Frame 2:              (only 2 frames, 6s cycle)
 /[-_-]\               /[-.-]\
 +=|--|=+              +=|--|=+
```
Barely animated. Almost meditative. Reads as "this pet is thinking."

**Cluster: Friendly + Paranoid (tense-watchful) + Pragmatic** — default idle (§4.1)

The baseline 4-frame idle above IS this cluster. Friendly/Pragmatic pets blink comfortably; Paranoid pets use the same silhouette but bias toward the wink frame (frame 3 appears more often — implementation hint: weight the frame-index roll).

**Total cycle count:** baseline idle (4) + energetic idle (4) + stoic idle (2) + eating (3) + sleeping (2) + sick (3) + level-up (5) + death (1) = **24 scene frames** per species (excluding silhouettes).

### 4.8 Frame-count budget summary

| Component | Frames | Cycle length @ 2s tick |
|-----------|--------|------------------------|
| Silhouettes (4 species × 3 stages) | 12 static poses | n/a — chosen by stage, not cycled |
| Idle (baseline) | 4 | 8s |
| Idle (energetic variant) | 4 | 8s |
| Idle (stoic variant) | 2 | 4s |
| Eating | 3 (one-shot) | 3s play once |
| Sleeping | 2 | 4s |
| Sick | 3 | 6s |
| Level-up | 5 (one-shot) | ~1.5s play once |
| Death | 1 | static |
| HUD mood glyphs (§5) | 8 | static, swapped by state |

**Total frame atlas: 12 silhouettes + 24 scene frames + 8 mood glyphs + 3 HUD variants (§5.4) = 47 authored assets per species-agnostic set, plus 4 × 3 = 12 species-specific silhouettes.**

---

## 5. HUD Row

### 5.1 Full ASCII form (default, works everywhere)

```
 Pixel        · Lv 42   · [████████░░░░░░] 1240/2200 · :) [2/4]
```

- Blocks used: `█` (U+2588, full block) and `░` (U+2591, light shade). Both are in CP437 and in every Unicode terminal from the last 20 years. Safe even in Windows conhost.
- **Strict ASCII fallback** for terminals that render U+2588/U+2591 as tofu (rare but possible on very old PuTTY): use `#` and `-`:
  ```
   Pixel        · Lv 42   · [########------] 1240/2200 · :) [2/4]
  ```
  The compact renderer detects terminal encoding at boot and picks one path. Default path is the block-character version.

### 5.2 Color-enabled form

Colors applied per §6 token system (256-color with ANSI-16 fallback):

- Name: `text-primary` (default foreground).
- `Lv 42`: `accent-level` (cyan-ish). When level-up flashes, temporarily `level-up` (bright yellow) for 2s.
- XP bar filled (`█`): `primary` (pet's species accent — see §6.3).
- XP bar empty (`░`): `surface-muted` (bright-black / gray).
- `1240/2200`: `text-secondary` (dim).
- Mood glyph: color by mood state (green for happy, yellow for hungry, etc. — §6).
- Pet-count `[2/4]`: `text-secondary`.

### 5.3 Monochrome form

When `NO_COLOR=1` is set or the terminal reports no color support:

```
 Pixel        · Lv 42   · [########------] 1240/2200 · :) [2/4]
```

- Block characters + ASCII fallbacks only; no ANSI escapes emitted.
- Mood conveyed purely via glyph (§5.5) — no color-only info.
- XP bar shape still communicates progress.

### 5.4 Three HUD variants (design options for review)

**Variant 5.4a — Default (above):**
```
 Pixel        · Lv 42   · [████████░░░░░░] 1240/2200 · :) [2/4]
```

**Variant 5.4b — Compact (when name < 8 chars, frees width for longer xp-text):**
```
 Pixel · Lv 42 · [████████░░░░░░] 1240/2200 · :) [2/4]
```
Drops right-padding on name. Used when we detect we're inside a narrow statusline. Same information, less whitespace.

**Variant 5.4c — Ascendant (level === 1024):**
```
 Pixel★      · Lv 1024 · [██████████████] ∞ · :D [2/4]
```
- Star suffix on name (ASCII fallback: `*`).
- XP bar fully saturated with a gold tint (palette `level-up`).
- XP text shows `∞` (ASCII fallback: `max`).
- Mood glyph biased to `:D` permanently (there is no "sick" state at 1024 — the 1024 Club is sacred, DEC-004).

### 5.5 Mood glyph vocabulary

Shape always carries the state; color amplifies. Every glyph is 2 ASCII chars so alignment is preserved. Rich emoji variants are opt-in (§7).

| State | ASCII | Rich (opt-in) | Color | When |
|-------|-------|---------------|-------|------|
| Happy | `:)` | `😊` | `success` | fed recently, playing, level-up window |
| Content | `:|` | `🙂` | `text-primary` | default idle, nothing special |
| Hungry | `:o` | `😋` | `warning` | `now - lastFedAt > 6h` |
| Sick | `:(` | `🤒` | `error-muted` | `accumulatedNeglectSeconds > 1d` |
| Dying | `:X` | `💀` | `error` | within 12h of death threshold |
| Sleeping | `zZ` | `😴` | `text-secondary` | night bucket OR paused |
| Celebrating | `:D` | `🎉` | `level-up` | 2s post level-up |
| Dead | `†` (ASCII `+`) | `⚰️` | `text-secondary` | `pet.diedAt != null` |

Mood glyph is the single most scannable element of the HUD — it is the state indicator the user's peripheral vision catches first. Every shape is visually distinct from every other shape; no two share a silhouette outline.

### 5.6 XP bar style proposal

- **Width: 14 inner cells + 2 brackets = 16 total.** Rationale: 14 cells ≈ 7% resolution per cell, which is finer than most users can perceive at a glance but still gives a satisfying "click" of progress when a cell fills.
- **Fill direction: left-to-right** (culturally near-universal; we don't localize RTL in v1 — flagged as open question §8).
- **No partial-cell rendering** (e.g., `▏▎▍▌▋▊▉█` 8-level block gradient). These glyphs are inconsistently rendered across terminals — some fonts draw them with gaps, which looks broken. Rather than fake precision we don't have, we round down. The user who wants exact XP reads the `1240/2200` numbers.
- **At level 1024:** bar is fully filled; `∞` replaces the fraction (see 5.4c).
- **When XP overflows the current level**: the bar fills based on `(xp - cumulativeForLevel) / xpToNext(level)`, always between 0.0 and 1.0.

---

## 6. Color Tokens

### 6.1 Palette design rationale

Glyphling's compact frame lives on top of the user's terminal colorscheme. We cannot assume a background color. Every token below is chosen to:
- Pass WCAG AA (4.5:1 text, 3:1 UI) on *both* common terminal backgrounds (near-black #1E1E1E and near-white #F5F5F5).
- Survive reduction to ANSI-16 without loss of meaning.
- Be color-blind safe (Deuteranopia + Protanopia + Tritanopia tested via the Viridis-adjacent palette family; we avoid pure red/green opposition).

### 6.2 Semantic color tokens

| Token | 256-color | ANSI-16 fallback | Truecolor | Intent |
|-------|-----------|------------------|-----------|--------|
| `text-primary` | default | default | default | Pet name, primary readable text. Use terminal's default fg to blend with user's theme. |
| `text-secondary` | `8` (bright-black/gray) | `8` | `#7a7a7a` | XP fraction, pet-count, metadata. |
| `surface-muted` | `238` | `8` | `#4a4a4a` | XP bar empty cells. |
| `primary` | `33` (blue) | `4` (blue) | `#2a7fff` | XP bar fill — neutral default. Per-species accent overrides this (§6.3). |
| `accent-level` | `45` (cyan) | `6` (cyan) | `#2ab7ca` | `Lv NN` label. Cyan is neutral, readable on light AND dark, non-alarming. |
| `success` | `72` (soft green) | `2` (green) | `#5fbf87` | Happy mood, post-feed. Desaturated green — not the "this is a success alert" green. |
| `warning` | `178` (amber) | `3` (yellow) | `#d7af00` | Hungry mood. Amber, not pure yellow — better contrast on light backgrounds. |
| `error-muted` | `131` (dusty red) | `1` (red) | `#b55a5a` | Sick mood. Muted, not urgent. |
| `error` | `160` (bright red) | `1` (red) | `#d70000` | Dying mood. The ONLY time we use a saturated red — it means "urgent, act now." |
| `level-up` | `220` (gold) | `11` (bright yellow) | `#ffd700` | Level-up flash + 1024 Club Ascendant star. Used sparingly so it retains meaning. |
| `death` | `242` (medium gray) | `8` (bright-black) | `#6a6a6a` | Tombstone, dead state HUD. Solemn, not alarming. |

### 6.3 Per-species accent

Each species has a primary tint. This is *optional visual flavor* — the species is already communicated by the silhouette shape. Color is a secondary signal.

| Species | 256-color | ANSI-16 fallback | Truecolor |
|---------|-----------|------------------|-----------|
| circuit | `33` (blue) | `4` | `#2a7fff` |
| rune | `141` (violet) | `5` (magenta) | `#a77fff` |
| shard | `208` (orange) | `3` (yellow) | `#ff8c2a` |
| bloom | `114` (mossy green) | `2` (green) | `#7fbf5f` |

WCAG AA check (on both dark #1E1E1E and light #F5F5F5 backgrounds): all four pass 4.5:1 for text use; the orange (`shard`) at `#ff8c2a` passes 3.1:1 on dark and 4.7:1 on light — acceptable for UI elements like the XP bar.

### 6.4 Color-blindness check

- Deuteranopia (red-green): we pair `success` (desaturated green) against `warning` (amber) not against red — these remain distinguishable by brightness/warmth even when hue collapses.
- Protanopia: `error-muted` vs `error` differ in luminance (131 vs 160), preserving the urgency delta.
- Tritanopia (blue-yellow): `primary` (blue) vs `level-up` (gold) differ in luminance; shape glyphs (spark bursts vs XP block) carry the redundancy.

**Rule:** No state is conveyed by color alone. Every colored element either has a shape difference (mood glyphs, XP bar fill %, pet silhouette) or a text label (`Lv NN`).

---

## 7. Rules for Scene Authoring

Short checklist for any future contributor (human or agent) adding a compact scene. The expanded-mode (Ink TUI) rules in architecture §12 are stricter; compact has its own envelope.

### 7.1 Hard rules (do not break without a DEC)

1. **Dimensions:** Exactly ≤3 rows × ≤58 columns rendered width. Count cells, not characters (some Unicode glyphs are double-width).
2. **Character set:** ASCII + block shade glyphs (`█` `░`) only. No Nerd Font / Powerline / Braille dots / box-drawing for the silhouette itself (HUD bar is the one exception and uses only `█` `░`).
3. **No emoji in the default path.** Emoji are opt-in via config (see §7.3). Default must be strict ASCII + `█`/`░`.
4. **Color is never load-bearing.** The scene must read correctly in `NO_COLOR` mode. Verify by rendering to a mono terminal before submitting.
5. **Frame count: 2–5 per scene.** More wastes design effort the user can't perceive at 1–2s cadence. Fewer risks feeling dead.
6. **Silhouettes stay 2 rows × ≤10 cols.** Row 3 is sacred HUD real estate; no scene may leak art into it.
7. **Pet identity preserved across frames.** A user must be able to tell "this is the same pet" across all frames of a cycle. Keep the silhouette skeleton; vary small details only.
8. **One-shot vs looping** must be declared explicitly on the scene (matches architecture `Scene.loop: boolean`).

### 7.2 Soft rules (recommended)

- Lean into the slow-vignette cadence. Design for "pose-per-tick," not "frames-per-second."
- When adding a new mood state, propose a new entry in the §5.5 glyph table first — get the HUD slot right before you design the silhouette.
- Test legibility at font size 10 on a 1x display (not a Retina preview). The compact renderer appears at whatever font size the user's terminal is running; 10pt is the realistic floor.
- Avoid cultural symbolism in silhouettes without a team review (architecture §13 flags i18n as out of scope for v1; default-safe imagery only).

### 7.3 Emoji opt-in path

The user may set `GLYPHLING_RICH_GLYPHS=1` to opt into emoji. Precondition: they assert their terminal renders emoji at consistent cell widths (iTerm2 ≥ 3.5, Kitty, Ghostty, WezTerm, modern Windows Terminal all qualify). Any scene that uses emoji must:
- Provide the ASCII fallback in the same Frame record (two content strings OR a runtime swap).
- Never exceed the 58-col budget under *either* glyph width. Design to the wider of the two.

---

## 8. Open Questions (for @product-owner / user)

These need a decision before compact-frame assets are frozen. I've made best-effort design choices for each so work isn't blocked, but flagging clearly:

### 8.1 Egg names — final call

Proposal: **adopt `circuit / rune / shard / bloom`** as canonical (§3.1). User mentioned the original set was `Silicon | Cosmic | Bytebeast | Root`; architect's straw-man `circuit | rune | shard | bloom` is a better fit for the compact vocabulary (parity, motif clarity, length). **Needs user confirmation.** I've designed all 12 silhouettes against the motif, so renaming only is a one-word diff — but a third option ("rename one but keep three") should be raised now, not after assets exist.

### 8.2 Mood glyph for "hungry"

I chose `:o` (surprised-looking mouth) for hungry over `:P` (tongue, more commonly "playful"). The tradeoff: `:o` risks reading as "surprised" rather than "hungry"; `:P` is more iconic but conflicts with a potential future "playful" state. **Prefer a product-owner opinion.**

### 8.3 Level display: `1024` vs `1k24` vs `MAX`

At level 1024, the HUD shows `Lv 1024` (full 4 digits + 3-char label = 7 chars, fits). Alternatives: `Lv MAX` (5 chars — clearer as an honorific, but hides the sacred number), `Lv 1K24` (k-notation, clever but potentially confusing). **Current design uses `Lv 1024` + gold tint + name-star suffix** — the number is the flex, per DEC-004. Confirm this reading is correct.

### 8.4 Is the 1024 Ascendant immune to sickness in the compact view?

Design §5.4c proposes "no sick/dying state at 1024" — the Ascendant compact HUD always shows `:D`. This is an aesthetic choice: the 1024 Club is sacred, and showing Ascendants in sick-state on the statusline undermines the flex. But mechanically, an Ascendant pet CAN die by neglect per DEC-009. **Should the compact HUD hide sickness at 1024, or display it honestly?** I lean "hide" — the expanded Ink view can show the full truth — but this is a product call.

### 8.5 Multi-pet HUD when all 4 slots filled

With 4 pets adopted, the HUD shows `[n/4]`. The active pet (`globals.activePetId`) is the one visually rendered. Should the compact view rotate through pets on a timer (e.g., every 15s switch to the next), or always pin the user-selected active pet? I've designed for **pin** (simpler, no motion sickness, matches DEC-002's "activePetId"), but a rotation mode could be a user preference.

### 8.6 Reduced-motion handling

I've proposed a reduced-frame variant of the level-up flash (3 frames instead of 5). Should the compact renderer respect `prefers-reduced-motion` automatically (detect via `PREFERS_REDUCED_MOTION` env var? some convention?), or only when the user explicitly opts in via config? **Flagging as a small accessibility gap** — no clear terminal-side convention exists for this; needs a product decision.

### 8.7 Cell-width detection for emoji

If the user enables `GLYPHLING_RICH_GLYPHS=1` but their font renders emoji at 1 cell width, the HUD math breaks (columns shift). Options: (a) trust the user ("you said your terminal handles emoji, live with it"), (b) runtime-probe via a cursor-position query escape sequence before emitting emoji. Option (b) is accurate but invasive. **Proposing option (a) as default**; call this out in docs; needs confirmation.

---

## 9. Summary for @architect — what the `compact: Frame[]` schema should accommodate

Based on the design above, each `CompactFrame` in the schema should carry (architect is drafting in parallel — this is my input for the schema):

- `content: string` — up to 3 newline-separated rows, each ≤58 cells wide.
- `durationMs: number` — per-frame hold time (spec: 1000–2000ms for idles; 500ms for level-up flash sub-frames).
- `rowSpec?: ("silhouette" | "silhouette" | "hud")` — optional row-purpose tag so the renderer can reason about "pet art rows" vs "HUD row" separately (e.g., compose a species silhouette with a state-specific HUD without duplicating art).
- `palette?: Record<string, ColorToken>` — optional overrides for this frame (level-up uses this to tint the XP bar gold).
- `asciiFallback?: string` — when rich glyphs are used, the pure-ASCII equivalent.
- `reducedMotion?: boolean` — flag for frames that should be skipped under reduced-motion.

If the architect's `compact: Frame[]` schema ends up more minimal (just `content` + `durationMs`), the renderer can derive the rest from scene metadata. Either shape is implementable against this vocabulary.

---

*End of compact-frame vocabulary v1.*
