# Per-species animation frames (TODO-025)

**Status:** Design spec (for implementation)
**Author:** @designer
**Date:** 2026-04-24
**Supersedes:** `applyEyeBlink` stop-gap (commit `c969e8c`) for narrow-tier idle/eating/sick scenes
**Pairs with:** `docs/design/compact-frames.md` (palette, mood, HUD), `docs/design/statusline-wide-silhouettes.md` (wide silhouettes), `src/render/compact.ts` (renderer)

---

## 1. Design rationale

### 1.1 Per-species motion language

The four species have distinct silhouettes. Their *motion* must be equally distinct, otherwise the personality cues collapse and every pet feels like the same pet wearing different glyphs. Each species gets a single motion grammar that all of its scenes lean into:

- **circuit** — *pixel-precise, mechanical, CRT.* Motion is binary: a thing is on or off, never tweened. Eyes blink as a hard cut (`o-o` → `_-_`). Bottom-row "circuitry" swaps in discrete dashed segments (`|--|` → `|__|` → `|==|`). Tiny `.` particles tick in fixed cells like a status LED. Reads as: *this pet runs on a clock.*
- **rune** — *mystical, breathing, hovering.* Motion is continuous and small. The diacritic `^` over the head fades to `.` and back, suggesting a wisp rising. Bottom sigils rotate one slash at a time (`\||/` → `\|/.` → `.|/\`). Reads as: *this pet is older than you and waiting.*
- **shard** — *crystalline, sparkling, micro-rotations.* Motion is asymmetric — sparkles flicker on the upper corners while slashes rotate by one tick. Asterisks travel in fixed cells (`*  ` → ` * ` → `  *`). Reads as: *this pet is barely contained, about to chip.*
- **bloom** — *organic, swaying, rustling.* Motion is bilateral and curved. Tildes drift left-then-right around the head; `vv` cheeks alternate with `^^`/`,,` to suggest leaves rustling. Reads as: *this pet grows.*

The species' adjective is also its **easing curve**: circuit is `step`, rune is `ease-in-out` slow, shard is `ease-out` (pop then settle), bloom is `ease-in-out` smooth.

### 1.2 Why N frames per cycle, why these durations

Default tick is **1 Hz** (one frame per second per `REFRESH_MS = 1000` in `src/render/compact.ts`). The renderer cycles `tick % frames.length`. That gives us only one design lever per scene: **how many frames before the loop repeats**.

Heuristic, derived from the four-frame baseline already in code:

| Scene | Frames | Cycle | Why |
|------:|-------:|------:|-----|
| `idle-baseline` | 4 | 4 s | Long enough to feel calm; short enough that a glance always hits a non-resting frame within 2 s. |
| `idle-energetic` | 4 | 4 s | Same period as baseline, but every frame is "non-rest" — the pet is never visually still. |
| `idle-stoic` | 2 | 2 s | Two frames at 1 Hz = a slow exhale. Any more frames is wasted detail at this cadence. |
| `eating` | 3 | 3 s one-shot | Anticipation → bite → swallow. Three beats is the minimum that reads as a sentence. |
| `sick` | 3 | 3 s | Droop → worse → shiver. Same beat-count as eating but loops; the shiver provides Von Restorff distinction from idle. |

All durations are `1000 ms` per frame. This matches the tick floor and keeps `pickCompactFrame` simple — the `durationMs` field is informational only; the renderer uses `tick % frames.length`. Authors who want a slower cycle add another frame; authors who want faster cycling shorten the cycle.

### 1.3 Constraints inherited

From `compact-frames.md` and `assertWideFrameDimensions`:

1. **Character allowlist** (regex `[\s()\[\]{}<>\/\\|\-_+*.,'":;~^oO0#=@vzZ]` plus three additions for this spec — `x`, `X`, `U` — needed for sick eye tokens (`x-x`) and eating mouth tokens (`UU`); see §4.5 for the rationale and the one-line code change). No emoji, no box-drawing, no Unicode arrows.
2. **Width preservation:** every frame in a cycle has identical visible width per row. The renderer composes silhouette + HUD; if rows reflow between frames the HUD jumps. Width-preservation is the single hardest authoring constraint and the one that drives every design choice below.
3. **Narrow silhouette envelope:** ≤2 rows × ≤60 cols visible (in practice ≤10 cols).
4. **Wide silhouette envelope:** exactly 4 rows × ≤18 cols visible.
5. **Palette unchanged:** these frames do not introduce new color tokens. Mood glyphs, level-up gold, and species accents remain as defined in `compact-frames.md` §6.
6. **Pet identity preserved (§7.1 rule 7):** every frame in a cycle keeps the silhouette skeleton recognizable. Variation is in eye tokens, secondary glyphs, and bottom-row segments — never in the parens/brackets/angle-brackets that *are* the species.
7. **Lifestage codes:** `hatchling` (L0–2), `juvenile` (L3–9), `adult` (L10–1023). Ascendant (1024) reuses adult silhouette.

### 1.4 Width-preservation conventions used below

To keep cycles legible, every variation in this spec is a **same-width substring swap**:

| Same width | Tokens used |
|-----------:|-------------|
| 1 char | `o`↔`O`↔`^`↔`_`↔`*`↔`.`↔`-`↔`~`↔`v` |
| 2 chars | `oo`↔`__`↔`OO`↔`^^`↔`--`↔`..`↔`vv`↔`,,`↔`UU`↔`~~`↔`zz` |
| 3 chars | `o-o`↔`_-_`↔`^-^`↔`O-O`↔`-.-`↔`x-x` |
| Slash trio | `\||/`↔`\|/`+space stays 4 chars only by careful padding; we never shorten — we reorder |

Where a frame "shifts" a glyph, the previous cell is filled with a space and the new cell takes the glyph — total cell count never changes. Examples below mark width with a comment row.

---

## 2. Scene-stage matrix

For every (species × stage × scene) triple below, the table columns are:

- **frame** — index in the cycle (0-based).
- **narrow row 1 / row 2** — the 2-row narrow silhouette. Column counts in the caption equal the existing silhouette in `SILHOUETTES`.
- **wide row 1–4** — the 4-row wide silhouette.
- **duration ms** — `1000` for all frames in v1 (see §1.2).
- **notes** — what changes vs. previous frame, and the motion intent.

Captions name the visible width of each row; the renderer's `assertFrameDimensions` and `assertWideFrameDimensions` will enforce these.

> **Reading the tables:** strings are written between backticks and **always include leading spaces.** Visible width = number of cells after the leading backtick and before the trailing backtick.

---

## 2.1 circuit

Motion grammar: hard-cut blink, dashed bottom-row segment swap, ticking `.` particle on the wide tier.

### 2.1.1 circuit — hatchling

Narrow widths: row1 = 5 (` [oo]`), row2 = 5 (`  || `).
Wide widths: r1 = 5, r2 = 7, r3 = 7, r4 = 6.

#### `idle-baseline`  — 4 frames, 4 s cycle

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` [oo]`` | ``  || `` | ``    .`` | ``   [oo]`` | ``   -||-`` | ``    ^^`` | 1000 | rest pose, identical to current static silhouette |
| 1 | `` [oo]`` | ``  || `` | ``    .`` | ``   [oo]`` | ``   -||-`` | ``    ^^`` | 1000 | held — at 1 Hz a held frame reads as breath |
| 2 | `` [__]`` | ``  || `` | ``    .`` | ``   [__]`` | ``   -||-`` | ``    ^^`` | 1000 | hard-cut blink (`oo`→`__`) |
| 3 | `` [oo]`` | ``  || `` | ``    .`` | ``   [oo]`` | ``   _||_`` | ``    ^^`` | 1000 | bottom-row dash slide (`-||-`→`_||_`) — tiny "circuit hum" |

**Caption:** the blink lands on frame 2 (1 in 4 ticks, matching `EYE_ANIM`'s prior cadence). The bottom-row dash slide on frame 3 keeps the eye on the page after the blink.

#### `idle-energetic` — 4 frames, 4 s cycle

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` [oo]`` | ``  || `` | ``    .`` | ``   [oo]`` | ``   -||-`` | ``    ^^`` | 1000 | rest |
| 1 | `` [Oo]`` | ``  || `` | ``    *`` | ``   [Oo]`` | ``   -||-`` | ``    ^^`` | 1000 | left eye widens, particle goes `.`→`*` |
| 2 | `` [oO]`` | ``  || `` | ``    *`` | ``   [oO]`` | ``   -||-`` | ``    ^^`` | 1000 | right eye widens — head "scans" left-to-right |
| 3 | `` [^^]`` | ``  || `` | ``    .`` | ``   [^^]`` | ``   _||_`` | ``    ^^`` | 1000 | satisfied squint, dash hum |

#### `idle-stoic` — 2 frames, 2 s cycle

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` [-_]`` | ``  || `` | ``    .`` | ``   [-_]`` | ``   -||-`` | ``    ^^`` | 1000 | half-mast eyes |
| 1 | `` [_-]`` | ``  || `` | ``    .`` | ``   [_-]`` | ``   -||-`` | ``    ^^`` | 1000 | mirrored — almost imperceptible |

#### `eating` — 3 frames, 3 s one-shot

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` [oo]`` | ``  || `` | ``    .`` | ``   [oo]`` | ``   -||-`` | ``    ^^`` | 1000 | crumb arriving — wide r1 `.` is the crumb |
| 1 | `` [^^]`` | ``  UU `` | ``    .`` | ``   [^^]`` | ``   -UU-`` | ``    ^^`` | 1000 | bite — eyes squint, mouth `||`→`UU` |
| 2 | `` [^^]`` | ``  ~~ `` | ``    .`` | ``   [^^]`` | ``   -~~-`` | ``    ^^`` | 1000 | swallow — `UU`→`~~` |

#### `sick` — 3 frames, 3 s cycle

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` [x_]`` | ``  || `` | ``    ,`` | ``   [x_]`` | ``   /||\`` | ``    ^^`` | 1000 | one eye out, droop — wide r3 corners flare in |
| 1 | `` [xx]`` | ``  || `` | ``    ,`` | ``   [xx]`` | ``   /||\`` | ``    ^^`` | 1000 | both eyes out |
| 2 | `` [xx]`` | ``  ;; `` | ``    ,`` | ``   [xx]`` | ``   \||/`` | ``    ^^`` | 1000 | shiver — bottom flips slashes, mouth `||`→`;;` |

---

### 2.1.2 circuit — juvenile

Narrow widths: row1 = 7 (` /[oo]\`), row2 = 7 (` +-||-+`).
Wide widths: r1 = 5, r2 = 9, r3 = 9, r4 = 8.

#### `idle-baseline` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /[oo]\`` | `` +-||-+`` | ``    |`` | ``   /[oo]\`` | ``   +-||-+`` | ``    ^  ^`` | 1000 | rest |
| 1 | `` /[oo]\`` | `` +-||-+`` | ``    |`` | ``   /[oo]\`` | ``   +-||-+`` | ``    ^  ^`` | 1000 | held |
| 2 | `` /[__]\`` | `` +-||-+`` | ``    |`` | ``   /[__]\`` | ``   +-||-+`` | ``    ^  ^`` | 1000 | blink |
| 3 | `` /[oo]\`` | `` +_||_+`` | ``    |`` | ``   /[oo]\`` | ``   +_||_+`` | ``    ^  ^`` | 1000 | dash slide |

#### `idle-energetic` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /[oo]\`` | `` +-||-+`` | ``    |`` | ``   /[oo]\`` | ``   +-||-+`` | ``    ^  ^`` | 1000 | rest |
| 1 | `` /[Oo]\`` | `` +-||-+`` | ``    *`` | ``   /[Oo]\`` | ``   +-||-+`` | ``    ^  ^`` | 1000 | left eye widens, antenna `|`→`*` |
| 2 | `` /[oO]\`` | `` +-||-+`` | ``    *`` | ``   /[oO]\`` | ``   +-||-+`` | ``    ^  ^`` | 1000 | right eye widens |
| 3 | `` /[^^]\`` | `` +_||_+`` | ``    |`` | ``   /[^^]\`` | ``   +_||_+`` | ``    ^  ^`` | 1000 | satisfied squint + dash slide |

#### `idle-stoic` — 2 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /[-_]\`` | `` +-||-+`` | ``    |`` | ``   /[-_]\`` | ``   +-||-+`` | ``    ^  ^`` | 1000 | half-mast |
| 1 | `` /[_-]\`` | `` +-||-+`` | ``    |`` | ``   /[_-]\`` | ``   +-||-+`` | ``    ^  ^`` | 1000 | mirror |

#### `eating` — 3 frames one-shot

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /[oo]\`` | `` +-||-+`` | ``    .`` | ``   /[oo]\`` | ``   +-||-+`` | ``    ^  ^`` | 1000 | crumb |
| 1 | `` /[^^]\`` | `` +-UU-+`` | ``    |`` | ``   /[^^]\`` | ``   +-UU-+`` | ``    ^  ^`` | 1000 | bite |
| 2 | `` /[^^]\`` | `` +-~~-+`` | ``    |`` | ``   /[^^]\`` | ``   +-~~-+`` | ``    ^  ^`` | 1000 | swallow |

#### `sick` — 3 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /[x_]\`` | `` +-||-+`` | ``    ,`` | ``   /[x_]\`` | ``   +/||\+`` | ``    ^  ^`` | 1000 | one eye out, corners cave in (`-`→`/`/`\`) |
| 1 | `` /[xx]\`` | `` +-||-+`` | ``    ,`` | ``   /[xx]\`` | ``   +/||\+`` | ``    ^  ^`` | 1000 | both eyes out |
| 2 | `` /[xx]\`` | `` +-;;-+`` | ``    ,`` | ``   /[xx]\`` | ``   +\||/+`` | ``    ^  ^`` | 1000 | shiver — slashes flip, `||`→`;;` |

---

### 2.1.3 circuit — adult

Narrow widths: row1 = 8 (` /[o-o]\`), row2 = 9 (` +=|--|=+`).
Wide widths: r1 = 7, r2 = 10, r3 = 12, r4 = 10.

#### `idle-baseline` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /[o-o]\`` | `` +=|--|=+`` | ``    .v.`` | ``   /[o-o]\`` | ``  +==|--|==+`` | ``    |_||_|`` | 1000 | rest |
| 1 | `` /[o-o]\`` | `` +=|--|=+`` | ``    .v.`` | ``   /[o-o]\`` | ``  +==|--|==+`` | ``    |_||_|`` | 1000 | held |
| 2 | `` /[_-_]\`` | `` +=|--|=+`` | ``    .v.`` | ``   /[_-_]\`` | ``  +==|--|==+`` | ``    |_||_|`` | 1000 | blink |
| 3 | `` /[o-o]\`` | `` +=|__|=+`` | ``    .v.`` | ``   /[o-o]\`` | ``  +==|__|==+`` | ``    |_||_|`` | 1000 | breath — bottom dash slide |

#### `idle-energetic` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /[o-o]\`` | `` +=|--|=+`` | ``    .v.`` | ``   /[o-o]\`` | ``  +==|--|==+`` | ``    |_||_|`` | 1000 | rest |
| 1 | `` /[O-o]\`` | `` +=|/-|=+`` | ``    *v*`` | ``   /[O-o]\`` | ``  +==|/-|==+`` | ``    |_||_|`` | 1000 | left scan |
| 2 | `` /[o-O]\`` | `` +=|-\|=+`` | ``    *v*`` | ``   /[o-O]\`` | ``  +==|-\|==+`` | ``    |_||_|`` | 1000 | right scan |
| 3 | `` /[^-^]\`` | `` +=|--|=+`` | ``    .v.`` | ``   /[^-^]\`` | ``  +==|--|==+`` | ``    |_||_|`` | 1000 | settle |

#### `idle-stoic` — 2 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /[-_-]\`` | `` +=|--|=+`` | ``    .v.`` | ``   /[-_-]\`` | ``  +==|--|==+`` | ``    |_||_|`` | 1000 | half-mast |
| 1 | `` /[-.-]\`` | `` +=|--|=+`` | ``    .v.`` | ``   /[-.-]\`` | ``  +==|--|==+`` | ``    |_||_|`` | 1000 | dot — even more closed |

#### `eating` — 3 frames one-shot

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /[o-o]\`` | `` +=|--|=+`` | ``    .v.`` | ``   /[o-o]\`` | ``  +==|--|==+`` | ``    |_||_|`` | 1000 | crumb (use the existing `.v.` antenna as approach particle) |
| 1 | `` /[^-^]\`` | `` +=|UU|=+`` | ``    .v.`` | ``   /[^-^]\`` | ``  +==|UU|==+`` | ``    |_||_|`` | 1000 | bite |
| 2 | `` /[^-^]\`` | `` +=|~~|=+`` | ``    .v.`` | ``   /[^-^]\`` | ``  +==|~~|==+`` | ``    |_||_|`` | 1000 | swallow |

#### `sick` — 3 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /[x-o]\`` | `` +/|--|\+`` | ``    ,v,`` | ``   /[x-o]\`` | ``  +/=|--|=\+`` | ``    |_||_|`` | 1000 | droop — outer brackets cave to `/`/`\` |
| 1 | `` /[x-x]\`` | `` +/|--|\+`` | ``    ,v,`` | ``   /[x-x]\`` | ``  +/=|--|=\+`` | ``    |_||_|`` | 1000 | both out |
| 2 | `` /[x-x]\`` | `` +\|--|/+`` | ``    ,v,`` | ``   /[x-x]\`` | ``  +\=|--|=/+`` | ``    |_||_|`` | 1000 | shiver — slashes flip |

---

## 2.2 rune

Motion grammar: vertical hover via diacritic fade (`^`↔`.`↔` `), wing-sigil rotation, eye dots blink.

### 2.2.1 rune — hatchling

Narrow widths: row1 = 5 (` <..>`), row2 = 5 (`  \/ `).
Wide widths: r1 = 5, r2 = 7, r3 = 6, r4 = 5.

#### `idle-baseline` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` <..>`` | ``  \/ `` | ``    ^`` | ``   <..>`` | ``    \/`` | ``    .`` | 1000 | rest |
| 1 | `` <..>`` | ``  \/ `` | ``    .`` | ``   <..>`` | ``    \/`` | ``    .`` | 1000 | wisp falls (`^`→`.`) — hover descends 1 row |
| 2 | `` <oo>`` | ``  \/ `` | ``    .`` | ``   <oo>`` | ``    \/`` | ``    .`` | 1000 | eyes open round (dots → `oo`) |
| 3 | `` <..>`` | ``  /\ `` | ``    ^`` | ``   <..>`` | ``    /\`` | ``    .`` | 1000 | wisp returns; sigil flips |

#### `idle-energetic` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` <..>`` | ``  \/ `` | ``    ^`` | ``   <..>`` | ``    \/`` | ``    .`` | 1000 | rest |
| 1 | `` <oo>`` | ``  \/ `` | ``    *`` | ``   <oo>`` | ``    \/`` | ``    .`` | 1000 | eyes flare, wisp sparks |
| 2 | `` <OO>`` | ``  /\ `` | ``    *`` | ``   <OO>`` | ``    /\`` | ``    *`` | 1000 | eyes wide, sigil flips, ground-spark |
| 3 | `` <^^>`` | ``  \/ `` | ``    ^`` | ``   <^^>`` | ``    \/`` | ``    .`` | 1000 | content squint |

#### `idle-stoic` — 2 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` <..>`` | ``  \/ `` | ``    ^`` | ``   <..>`` | ``    \/`` | ``    .`` | 1000 | rest |
| 1 | `` <..>`` | ``  \/ `` | ``    .`` | ``   <..>`` | ``    \/`` | ``    .`` | 1000 | wisp descends — only motion is the wisp |

#### `eating` — 3 frames one-shot

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` <..>`` | ``  \/ `` | ``    .`` | ``   <..>`` | ``    \/`` | ``    .`` | 1000 | offering descends from above |
| 1 | `` <oo>`` | ``  vv `` | ``    .`` | ``   <oo>`` | ``    vv`` | ``    .`` | 1000 | bite — sigil becomes `vv` mouth |
| 2 | `` <^^>`` | ``  ~~ `` | ``    ~`` | ``   <^^>`` | ``    ~~`` | ``    .`` | 1000 | swallow — tilde aura |

#### `sick` — 3 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` <x.>`` | ``  \/ `` | ``    ,`` | ``   <x.>`` | ``    \/`` | ``    .`` | 1000 | one eye out, wisp sinks to `,` |
| 1 | `` <xx>`` | ``  \/ `` | ``    ,`` | ``   <xx>`` | ``    \/`` | ``    .`` | 1000 | both out |
| 2 | `` <xx>`` | ``  /\ `` | ``    ,`` | ``   <xx>`` | ``    /\`` | ``    ,`` | 1000 | shiver — sigil flips, ground-dot also `.`→`,` |

---

### 2.2.2 rune — juvenile

Narrow widths: row1 = 7 (` <^..^>`), row2 = 7 (`  \||/ `).
Wide widths: r1 = 6, r2 = 9, r3 = 8, r4 = 7.

#### `idle-baseline` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` <^..^>`` | ``  \||/ `` | ``   ^ ^`` | ``   <^..^>`` | ``    \||/`` | ``    o.o`` | 1000 | rest |
| 1 | `` <^..^>`` | ``  \||/ `` | ``   . .`` | ``   <^..^>`` | ``    \||/`` | ``    o.o`` | 1000 | horns settle (twin-`^`→twin-`.`) |
| 2 | `` <^oo^>`` | ``  \||/ `` | ``   . .`` | ``   <^oo^>`` | ``    \||/`` | ``    o.o`` | 1000 | eyes open round |
| 3 | `` <^..^>`` | ``  /||\ `` | ``   ^ ^`` | ``   <^..^>`` | ``    /||\`` | ``    o.o`` | 1000 | sigil rotates outward |

#### `idle-energetic` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` <^..^>`` | ``  \||/ `` | ``   ^ ^`` | ``   <^..^>`` | ``    \||/`` | ``    o.o`` | 1000 | rest |
| 1 | `` <^oo^>`` | ``  \||/ `` | ``   * *`` | ``   <^oo^>`` | ``    \||/`` | ``    o.o`` | 1000 | eyes flare, horns spark |
| 2 | `` <^OO^>`` | ``  /||\ `` | ``   * *`` | ``   <^OO^>`` | ``    /||\`` | ``    *.*`` | 1000 | wide eyes, sigil flips, base-sparks |
| 3 | `` <^^^^>`` | ``  \||/ `` | ``   ^ ^`` | ``   <^^^^>`` | ``    \||/`` | ``    o.o`` | 1000 | content full-squint |

#### `idle-stoic` — 2 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` <^..^>`` | ``  \||/ `` | ``   ^ ^`` | ``   <^..^>`` | ``    \||/`` | ``    o.o`` | 1000 | rest |
| 1 | `` <^..^>`` | ``  \||/ `` | ``   . .`` | ``   <^..^>`` | ``    \||/`` | ``    o.o`` | 1000 | horns settle — that's it |

#### `eating` — 3 frames one-shot

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` <^..^>`` | ``  \||/ `` | ``   . .`` | ``   <^..^>`` | ``    \||/`` | ``    o.o`` | 1000 | offering descends — twin horns drop to dots |
| 1 | `` <^oo^>`` | ``  \vv/ `` | ``   ^ ^`` | ``   <^oo^>`` | ``    \vv/`` | ``    o.o`` | 1000 | bite — pipes become `vv` |
| 2 | `` <^^^^>`` | ``  \~~/ `` | ``   ~ ~`` | ``   <^^^^>`` | ``    \~~/`` | ``    o.o`` | 1000 | swallow — tilde aura |

#### `sick` — 3 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` <^x.^>`` | ``  \||/ `` | ``   , ,`` | ``   <^x.^>`` | ``    \||/`` | ``    o.o`` | 1000 | droop — horns sag, one eye out |
| 1 | `` <^xx^>`` | ``  \||/ `` | ``   , ,`` | ``   <^xx^>`` | ``    \||/`` | ``    o.o`` | 1000 | both out |
| 2 | `` <^xx^>`` | ``  /||\ `` | ``   , ,`` | ``   <^xx^>`` | ``    /||\`` | ``    ,.,`` | 1000 | shiver — sigil flips, base flares to `,` |

---

### 2.2.3 rune — adult

Narrow widths: row1 = 9 (` <^-..-^>`), row2 = 8 (`  \|||/ `).
Wide widths: r1 = 7, r2 = 11, r3 = 9, r4 = 10.

#### `idle-baseline` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` <^-..-^>`` | ``  \|||/ `` | ``    ^^^`` | ``   <^-..-^>`` | ``    \|||/`` | ``   .  .  .`` | 1000 | rest |
| 1 | `` <^-..-^>`` | ``  \|||/ `` | ``    ...`` | ``   <^-..-^>`` | ``    \|||/`` | ``   .  .  .`` | 1000 | horns descend — diacritic trio fades |
| 2 | `` <^-oo-^>`` | ``  \|||/ `` | ``    ...`` | ``   <^-oo-^>`` | ``    \|||/`` | ``   .  .  .`` | 1000 | eyes open round |
| 3 | `` <^-..-^>`` | ``  /|||\ `` | ``    ^^^`` | ``   <^-..-^>`` | ``    /|||\`` | ``   .  .  .`` | 1000 | sigil flips, horns return |

#### `idle-energetic` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` <^-..-^>`` | ``  \|||/ `` | ``    ^^^`` | ``   <^-..-^>`` | ``    \|||/`` | ``   .  .  .`` | 1000 | rest |
| 1 | `` <^-oo-^>`` | ``  \|||/ `` | ``    ***`` | ``   <^-oo-^>`` | ``    \|||/`` | ``   .  .  .`` | 1000 | flare |
| 2 | `` <^-OO-^>`` | ``  /|||\ `` | ``    ***`` | ``   <^-OO-^>`` | ``    /|||\`` | ``   *  .  *`` | 1000 | wide-eye + sigil flip + base-sparks |
| 3 | `` <^-^^-^>`` | ``  \|||/ `` | ``    ^^^`` | ``   <^-^^-^>`` | ``    \|||/`` | ``   .  .  .`` | 1000 | satisfied |

#### `idle-stoic` — 2 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` <^-..-^>`` | ``  \|||/ `` | ``    ^^^`` | ``   <^-..-^>`` | ``    \|||/`` | ``   .  .  .`` | 1000 | rest |
| 1 | `` <^-..-^>`` | ``  \|||/ `` | ``    ...`` | ``   <^-..-^>`` | ``    \|||/`` | ``   .  .  .`` | 1000 | horns descend |

#### `eating` — 3 frames one-shot

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` <^-..-^>`` | ``  \|||/ `` | ``    ...`` | ``   <^-..-^>`` | ``    \|||/`` | ``   .  .  .`` | 1000 | offering — horns dropped |
| 1 | `` <^-oo-^>`` | ``  \vvv/ `` | ``    ^^^`` | ``   <^-oo-^>`` | ``    \vvv/`` | ``   .  .  .`` | 1000 | bite — pipes become `vvv` |
| 2 | `` <^-^^-^>`` | ``  \~~~/ `` | ``    ~~~`` | ``   <^-^^-^>`` | ``    \~~~/`` | ``   .  .  .`` | 1000 | swallow — tilde aura |

#### `sick` — 3 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` <^-x.-^>`` | ``  \|||/ `` | ``    ,,,`` | ``   <^-x.-^>`` | ``    \|||/`` | ``   .  .  .`` | 1000 | droop — horns sag to commas |
| 1 | `` <^-xx-^>`` | ``  \|||/ `` | ``    ,,,`` | ``   <^-xx-^>`` | ``    \|||/`` | ``   .  .  .`` | 1000 | both out |
| 2 | `` <^-xx-^>`` | ``  /|||\ `` | ``    ,,,`` | ``   <^-xx-^>`` | ``    /|||\`` | ``   ,  ,  ,`` | 1000 | shiver — sigil + ground commas |

---

## 2.3 shard

Motion grammar: sparkle migration in fixed cells, slash-trio rotation by one tick, asterisk-blink.

### 2.3.1 shard — hatchling

Narrow widths: row1 = 5 (` /oo\`), row2 = 5 (` \\//`).
Wide widths: r1 = 5, r2 = 7, r3 = 7, r4 = 6.

#### `idle-baseline` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /oo\`` | `` \\//`` | ``    *`` | ``   /oo\`` | ``   \\//`` | ``   . .`` | 1000 | sparkle dead-center |
| 1 | `` /oo\`` | `` //\\`` | ``    *`` | ``   /oo\`` | ``   //\\`` | ``   . .`` | 1000 | slash flip — crystal "rotates" |
| 2 | `` /__\`` | `` \\//`` | ``    .`` | ``   /__\`` | ``   \\//`` | ``   * *`` | 1000 | blink, sparkle migrates to base |
| 3 | `` /oo\`` | `` \\//`` | ``    *`` | ``   /oo\`` | ``   \\//`` | ``   . .`` | 1000 | recover |

#### `idle-energetic` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /Oo\`` | `` \\//`` | ``    *`` | ``   /Oo\`` | ``   \\//`` | ``   * .`` | 1000 | left dazzle |
| 1 | `` /oO\`` | `` //\\`` | ``    *`` | ``   /oO\`` | ``   //\\`` | ``   . *`` | 1000 | right dazzle, slash flip |
| 2 | `` /**\`` | `` \\//`` | ``    *`` | ``   /**\`` | ``   \\//`` | ``   * *`` | 1000 | full blossom |
| 3 | `` /^^\`` | `` \\//`` | ``    .`` | ``   /^^\`` | ``   \\//`` | ``   . .`` | 1000 | settle |

#### `idle-stoic` — 2 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /oo\`` | `` \\//`` | ``    *`` | ``   /oo\`` | ``   \\//`` | ``   . .`` | 1000 | rest |
| 1 | `` /oo\`` | `` \\//`` | ``    .`` | ``   /oo\`` | ``   \\//`` | ``   * *`` | 1000 | sparkle pulse top→base |

#### `eating` — 3 frames one-shot

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /oo\`` | `` \\//`` | ``    *`` | ``   /oo\`` | ``   \\//`` | ``   . .`` | 1000 | spark approaches as crumb |
| 1 | `` /^^\`` | `` \UU/`` | ``    *`` | ``   /^^\`` | ``   \UU/`` | ``   . .`` | 1000 | bite — `\\//` collapses to `\UU/` |
| 2 | `` /^^\`` | `` \~~/`` | ``    *`` | ``   /^^\`` | ``   \~~/`` | ``   * *`` | 1000 | swallow — sparkles celebrate at base |

#### `sick` — 3 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /xo\`` | `` \\//`` | ``    ,`` | ``   /xo\`` | ``   \\//`` | ``   . .`` | 1000 | crystal dimming — `*`→`,` |
| 1 | `` /xx\`` | `` \\//`` | ``    ,`` | ``   /xx\`` | ``   \\//`` | ``   , ,`` | 1000 | both out, base dots also dim |
| 2 | `` /xx\`` | `` //\\`` | ``    ,`` | ``   /xx\`` | ``   //\\`` | ``   , ,`` | 1000 | shiver — slashes flip |

---

### 2.3.2 shard — juvenile

Narrow widths: row1 = 7 (` /*oo*\`), row2 = 7 (` \\||//`).
Wide widths: r1 = 5, r2 = 9, r3 = 9, r4 = 8.

#### `idle-baseline` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /*oo*\`` | `` \\||//`` | ``    *`` | ``   /*oo*\`` | ``   \\||//`` | ``   .* *.`` | 1000 | rest |
| 1 | `` /.oo.\`` | `` \\||//`` | ``    *`` | ``   /.oo.\`` | ``   \\||//`` | ``   .* *.`` | 1000 | side-stars dim to dots |
| 2 | `` /*__*\`` | `` \\||//`` | ``    .`` | ``   /*__*\`` | ``   \\||//`` | ``   ** **`` | 1000 | blink, base-stars flare |
| 3 | `` /*oo*\`` | `` //||\\`` | ``    *`` | ``   /*oo*\`` | ``   //||\\`` | ``   .* *.`` | 1000 | slash-trio rotates one tick |

#### `idle-energetic` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /*Oo*\`` | `` \\||//`` | ``    *`` | ``   /*Oo*\`` | ``   \\||//`` | ``   ** *.`` | 1000 | dazzle left |
| 1 | `` /*oO*\`` | `` //||\\`` | ``    *`` | ``   /*oO*\`` | ``   //||\\`` | ``   .* **`` | 1000 | dazzle right, slash flip |
| 2 | `` /****\`` | `` \\||//`` | ``    *`` | ``   /****\`` | ``   \\||//`` | ``   ** **`` | 1000 | sparkle storm — eyes briefly hidden behind 4 stars (allowlist-safe) |
| 3 | `` /*^^*\`` | `` \\||//`` | ``    .`` | ``   /*^^*\`` | ``   \\||//`` | ``   .* *.`` | 1000 | settle (eyes squint) |

#### `idle-stoic` — 2 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /*oo*\`` | `` \\||//`` | ``    *`` | ``   /*oo*\`` | ``   \\||//`` | ``   .* *.`` | 1000 | rest |
| 1 | `` /.oo.\`` | `` \\||//`` | ``    .`` | ``   /.oo.\`` | ``   \\||//`` | ``   ** **`` | 1000 | sparkle pulse — top dims, base brightens |

#### `eating` — 3 frames one-shot

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /*oo*\`` | `` \\||//`` | ``    *`` | ``   /*oo*\`` | ``   \\||//`` | ``   .* *.`` | 1000 | crumb falls (top sparkle is the crumb) |
| 1 | `` /*^^*\`` | `` \\UU//`` | ``    *`` | ``   /*^^*\`` | ``   \\UU//`` | ``   .* *.`` | 1000 | bite |
| 2 | `` /*^^*\`` | `` \\~~//`` | ``    *`` | ``   /*^^*\`` | ``   \\~~//`` | ``   ** **`` | 1000 | swallow + base sparkle celebration |

#### `sick` — 3 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /.xo.\`` | `` \\||//`` | ``    ,`` | ``   /.xo.\`` | ``   \\||//`` | ``   ,. .,`` | 1000 | sparkles dim, eye out |
| 1 | `` /.xx.\`` | `` \\||//`` | ``    ,`` | ``   /.xx.\`` | ``   \\||//`` | ``   ,. .,`` | 1000 | both out |
| 2 | `` /.xx.\`` | `` //||\\`` | ``    ,`` | ``   /.xx.\`` | ``   //||\\`` | ``   ., ,.`` | 1000 | shiver — slash flip + comma swap |

---

### 2.3.3 shard — adult

Narrow widths: row1 = 10 (` /**oo**\`), row2 = 10 (` \\\||///`).
Wide widths: r1 = 9, r2 = 11, r3 = 11, r4 = 10.

#### `idle-baseline` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /**oo**\`` | `` \\\||///`` | ``    *   *`` | ``   /**oo**\`` | ``   \\\||///`` | ``   .*. .*.`` | 1000 | rest |
| 1 | `` /.*oo*.\`` | `` \\\||///`` | ``    .   .`` | ``   /.*oo*.\`` | ``   \\\||///`` | ``   .*. .*.`` | 1000 | outer sparkles dim |
| 2 | `` /**__**\`` | `` \\\||///`` | ``    *   *`` | ``   /**__**\`` | ``   \\\||///`` | ``   ***.***`` | 1000 | blink + base sparkle flood |
| 3 | `` /**oo**\`` | `` ///||\\\`` | ``    *   *`` | ``   /**oo**\`` | ``   ///||\\\`` | ``   .*. .*.`` | 1000 | slash-trio inverts |

#### `idle-energetic` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /**Oo**\`` | `` \\\||///`` | ``    *   *`` | ``   /**Oo**\`` | ``   \\\||///`` | ``   *** .*.`` | 1000 | dazzle left |
| 1 | `` /**oO**\`` | `` ///||\\\`` | ``    *   *`` | ``   /**oO**\`` | ``   ///||\\\`` | ``   .*. ***`` | 1000 | dazzle right + flip |
| 2 | `` /******\`` | `` \\\||///`` | ``    * * *`` | ``   /******\`` | ``   \\\||///`` | ``   ***.***`` | 1000 | sparkle storm — eyes hidden behind stars |
| 3 | `` /**^^**\`` | `` \\\||///`` | ``    *   *`` | ``   /**^^**\`` | ``   \\\||///`` | ``   .*. .*.`` | 1000 | settle |

#### `idle-stoic` — 2 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /**oo**\`` | `` \\\||///`` | ``    *   *`` | ``   /**oo**\`` | ``   \\\||///`` | ``   .*. .*.`` | 1000 | rest |
| 1 | `` /.*oo*.\`` | `` \\\||///`` | ``    .   .`` | ``   /.*oo*.\`` | ``   \\\||///`` | ``   ***.***`` | 1000 | sparkle pulse |

#### `eating` — 3 frames one-shot

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /**oo**\`` | `` \\\||///`` | ``    *   *`` | ``   /**oo**\`` | ``   \\\||///`` | ``   .*. .*.`` | 1000 | crumb (use top sparkle) |
| 1 | `` /**^^**\`` | `` \\\UU///`` | ``    *   *`` | ``   /**^^**\`` | ``   \\\UU///`` | ``   .*. .*.`` | 1000 | bite — center pipes become `UU` |
| 2 | `` /**^^**\`` | `` \\\~~///`` | ``    *   *`` | ``   /**^^**\`` | ``   \\\~~///`` | ``   ***.***`` | 1000 | swallow + base flood |

#### `sick` — 3 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` /.*xo*.\`` | `` \\\||///`` | ``    ,   ,`` | ``   /.*xo*.\`` | ``   \\\||///`` | ``   ,*. .*,`` | 1000 | sparkles dim, one eye out |
| 1 | `` /.*xx*.\`` | `` \\\||///`` | ``    ,   ,`` | ``   /.*xx*.\`` | ``   \\\||///`` | ``   ,*. .*,`` | 1000 | both out |
| 2 | `` /.*xx*.\`` | `` ///||\\\`` | ``    ,   ,`` | ``   /.*xx*.\`` | ``   ///||\\\`` | ``   ,., ,.,`` | 1000 | shiver — slash flip + commas |

---

## 2.4 bloom

Motion grammar: tilde sway (left/right drift), `vv`/`^^`/`,,` rustle, organic curve.

### 2.4.1 bloom — hatchling

Narrow widths: row1 = 5 (` (oo)`), row2 = 5 (`  vv `).
Wide widths: r1 = 5, r2 = 7, r3 = 6, r4 = 6.

#### `idle-baseline` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` (oo)`` | ``  vv `` | ``    ~`` | ``   (oo)`` | ``    vv`` | ``    ,.`` | 1000 | rest |
| 1 | `` (oo)`` | ``  vv `` | ``   ~ `` | ``   (oo)`` | ``    vv`` | ``    ,.`` | 1000 | leaf sways left |
| 2 | `` (__)`` | ``  vv `` | ``    ~`` | ``   (__)`` | ``    vv`` | ``    ,.`` | 1000 | blink |
| 3 | `` (oo)`` | ``  ^^ `` | ``    ~`` | ``   (oo)`` | ``    ^^`` | ``    .,`` | 1000 | leaves rustle (`vv`→`^^`), root mirrors |

> Wide r1 frame 1: visible width must equal frame 0's `    ~` (5). The string `   ~ ` is also 5. Confirmed.

#### `idle-energetic` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` (oo)`` | ``  vv `` | ``    ~`` | ``   (oo)`` | ``    vv`` | ``    ,.`` | 1000 | rest |
| 1 | `` (Oo)`` | ``  vv `` | ``   ~ `` | ``   (Oo)`` | ``    vv`` | ``    ,.`` | 1000 | sway left + left eye widens |
| 2 | `` (oO)`` | ``  ^^ `` | ``    ~`` | ``   (oO)`` | ``    ^^`` | ``    .,`` | 1000 | sway right + rustle |
| 3 | `` (^^)`` | ``  vv `` | ``    ~`` | ``   (^^)`` | ``    vv`` | ``    ,.`` | 1000 | settle, content squint |

#### `idle-stoic` — 2 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` (oo)`` | ``  vv `` | ``    ~`` | ``   (oo)`` | ``    vv`` | ``    ,.`` | 1000 | rest |
| 1 | `` (oo)`` | ``  vv `` | ``   ~ `` | ``   (oo)`` | ``    vv`` | ``    ,.`` | 1000 | leaf sways once and back — slow |

#### `eating` — 3 frames one-shot

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` (oo)`` | ``  vv `` | ``    .`` | ``   (oo)`` | ``    vv`` | ``    ,.`` | 1000 | crumb above (`~`→`.`) |
| 1 | `` (^^)`` | ``  UU `` | ``    ~`` | ``   (^^)`` | ``    UU`` | ``    ,.`` | 1000 | bite — `vv`→`UU` |
| 2 | `` (^^)`` | ``  ~~ `` | ``    ~`` | ``   (^^)`` | ``    ~~`` | ``    ,.`` | 1000 | swallow — tilde aura |

#### `sick` — 3 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` (xo)`` | ``  vv `` | ``    ,`` | ``   (xo)`` | ``    vv`` | ``    ,.`` | 1000 | wilt — leaf turns to comma |
| 1 | `` (xx)`` | ``  vv `` | ``    ,`` | ``   (xx)`` | ``    vv`` | ``    ,.`` | 1000 | both out |
| 2 | `` (xx)`` | ``  ,, `` | ``    ,`` | ``   (xx)`` | ``    ,,`` | ``    .,`` | 1000 | shiver — `vv`→`,,` |

---

### 2.4.2 bloom — juvenile

Narrow widths: row1 = 7 (` (~oo~)`), row2 = 7 (`  \vv/ `).
Wide widths: r1 = 7, r2 = 9, r3 = 8, r4 = 7.

#### `idle-baseline` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` (~oo~)`` | ``  \vv/ `` | ``    ~ ~`` | ``   (~oo~)`` | ``    \vv/`` | ``    ,.,`` | 1000 | rest |
| 1 | `` (.oo.)`` | ``  \vv/ `` | ``    . .`` | ``   (.oo.)`` | ``    \vv/`` | ``    ,.,`` | 1000 | leaves settle |
| 2 | `` (~__~)`` | ``  \vv/ `` | ``    ~ ~`` | ``   (~__~)`` | ``    \vv/`` | ``    ,.,`` | 1000 | blink |
| 3 | `` (~oo~)`` | ``  /^^\ `` | ``    ~ ~`` | ``   (~oo~)`` | ``    /^^\`` | ``    .,.`` | 1000 | rustle — `\vv/`→`/^^\`, root mirrors |

#### `idle-energetic` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` (~oo~)`` | ``  \vv/ `` | ``    ~ ~`` | ``   (~oo~)`` | ``    \vv/`` | ``    ,.,`` | 1000 | rest |
| 1 | `` (~Oo~)`` | ``  \vv/ `` | ``    * *`` | ``   (~Oo~)`` | ``    \vv/`` | ``    ,.,`` | 1000 | left dazzle |
| 2 | `` (~oO~)`` | ``  /^^\ `` | ``    * *`` | ``   (~oO~)`` | ``    /^^\`` | ``    .,.`` | 1000 | right dazzle + rustle |
| 3 | `` (~^^~)`` | ``  \vv/ `` | ``    ~ ~`` | ``   (~^^~)`` | ``    \vv/`` | ``    ,.,`` | 1000 | settle |

#### `idle-stoic` — 2 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` (~oo~)`` | ``  \vv/ `` | ``    ~ ~`` | ``   (~oo~)`` | ``    \vv/`` | ``    ,.,`` | 1000 | rest |
| 1 | `` (.oo.)`` | ``  \vv/ `` | ``    . .`` | ``   (.oo.)`` | ``    \vv/`` | ``    ,.,`` | 1000 | leaves settle |

#### `eating` — 3 frames one-shot

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` (.oo.)`` | ``  \vv/ `` | ``    . .`` | ``   (.oo.)`` | ``    \vv/`` | ``    ,.,`` | 1000 | crumb |
| 1 | `` (~^^~)`` | ``  \UU/ `` | ``    ~ ~`` | ``   (~^^~)`` | ``    \UU/`` | ``    ,.,`` | 1000 | bite |
| 2 | `` (~^^~)`` | ``  \~~/ `` | ``    ~ ~`` | ``   (~^^~)`` | ``    \~~/`` | ``    ,.,`` | 1000 | swallow |

#### `sick` — 3 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` (.xo.)`` | ``  \vv/ `` | ``    , ,`` | ``   (.xo.)`` | ``    \vv/`` | ``    ,.,`` | 1000 | wilt — leaves dropped |
| 1 | `` (.xx.)`` | ``  \vv/ `` | ``    , ,`` | ``   (.xx.)`` | ``    \vv/`` | ``    ,.,`` | 1000 | both out |
| 2 | `` (.xx.)`` | ``  /,,\ `` | ``    , ,`` | ``   (.xx.)`` | ``    /,,\`` | ``    .,.`` | 1000 | shiver — `vv`→`,,`, brace flips |

---

### 2.4.3 bloom — adult

Narrow widths: row1 = 10 (` (~*oo*~)`), row2 = 9 (`  ~\vv/~ `).
Wide widths: r1 = 8, r2 = 11, r3 = 10, r4 = 9.

#### `idle-baseline` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` (~*oo*~)`` | ``  ~\vv/~ `` | ``   ~ * ~`` | ``   (~*oo*~)`` | ``    ~\vv/~`` | ``    ,.,.,`` | 1000 | rest |
| 1 | `` (.*oo*.)`` | ``  ~\vv/~ `` | ``   . * .`` | ``   (.*oo*.)`` | ``    ~\vv/~`` | ``    ,.,.,`` | 1000 | tildes settle |
| 2 | `` (~*__*~)`` | ``  ~\vv/~ `` | ``   ~ * ~`` | ``   (~*__*~)`` | ``    ~\vv/~`` | ``    ,.,.,`` | 1000 | blink |
| 3 | `` (~*oo*~)`` | ``  .\^^/. `` | ``   ~ * ~`` | ``   (~*oo*~)`` | ``    .\^^/.`` | ``    .,.,.`` | 1000 | rustle — `vv`→`^^`, outer tildes drop |

#### `idle-energetic` — 4 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` (~*oo*~)`` | ``  ~\vv/~ `` | ``   ~ * ~`` | ``   (~*oo*~)`` | ``    ~\vv/~`` | ``    ,.,.,`` | 1000 | rest |
| 1 | `` (~*Oo*~)`` | ``  ~\vv/~ `` | ``   * * *`` | ``   (~*Oo*~)`` | ``    ~\vv/~`` | ``    ,.,.,`` | 1000 | dazzle left |
| 2 | `` (~*oO*~)`` | ``  .\^^/. `` | ``   * * *`` | ``   (~*oO*~)`` | ``    .\^^/.`` | ``    .,.,.`` | 1000 | dazzle right + rustle |
| 3 | `` (~*^^*~)`` | ``  ~\vv/~ `` | ``   ~ * ~`` | ``   (~*^^*~)`` | ``    ~\vv/~`` | ``    ,.,.,`` | 1000 | settle |

#### `idle-stoic` — 2 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` (~*oo*~)`` | ``  ~\vv/~ `` | ``   ~ * ~`` | ``   (~*oo*~)`` | ``    ~\vv/~`` | ``    ,.,.,`` | 1000 | rest |
| 1 | `` (.*oo*.)`` | ``  ~\vv/~ `` | ``   . * .`` | ``   (.*oo*.)`` | ``    ~\vv/~`` | ``    ,.,.,`` | 1000 | tildes settle |

#### `eating` — 3 frames one-shot

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` (.*oo*.)`` | ``  ~\vv/~ `` | ``   . * .`` | ``   (.*oo*.)`` | ``    ~\vv/~`` | ``    ,.,.,`` | 1000 | crumb (top star is the offering) |
| 1 | `` (~*^^*~)`` | ``  ~\UU/~ `` | ``   ~ * ~`` | ``   (~*^^*~)`` | ``    ~\UU/~`` | ``    ,.,.,`` | 1000 | bite |
| 2 | `` (~*^^*~)`` | ``  ~\~~/~ `` | ``   ~ * ~`` | ``   (~*^^*~)`` | ``    ~\~~/~`` | ``    ,.,.,`` | 1000 | swallow — tilde aura |

#### `sick` — 3 frames

| frame | narrow r1 | narrow r2 | wide r1 | wide r2 | wide r3 | wide r4 | ms | notes |
|-:|-|-|-|-|-|-|-:|-|
| 0 | `` (.*xo*.)`` | ``  ~\vv/~ `` | ``   , * ,`` | ``   (.*xo*.)`` | ``    ~\vv/~`` | ``    ,.,.,`` | 1000 | wilt — outer tildes dropped |
| 1 | `` (.*xx*.)`` | ``  ~\vv/~ `` | ``   , * ,`` | ``   (.*xx*.)`` | ``    ~\vv/~`` | ``    ,.,.,`` | 1000 | both out |
| 2 | `` (.*xx*.)`` | ``  .\,,/. `` | ``   , * ,`` | ``   (.*xx*.)`` | ``    .\,,/.`` | ``    .,.,.`` | 1000 | shiver |

---

## 3. What's left as-is and why

These scenes are **out of scope** for TODO-025 and the renderer should keep its current behavior:

- **`sleeping`** — wide tier already overlays z/Z particles via the dedicated branch in `assembleWideOutput`; narrow tier keeps the static silhouette + `applyEyeBlink`. The closed-eye token (`-_-` / `..` / `oo`-closed) is read via the silhouette + blink overlay, no per-species cycle needed at 1 Hz cadence (sleep is meant to be unobtrusive — see `compact-frames.md` §4.3).
- **`death`** — single tombstone frame `RIP` / `[___]`. Static. No cycle ever.
- **`level-up`** — already authored as a 5-frame one-shot in `compact.ts` (`LEVEL_UP_FRAMES`). It does not use per-species silhouettes — the spark+burst sequence is species-agnostic by design (the celebration belongs to *the user*, not the species). Leave as-is.
- **`applyEyeBlink` helper** — keep as a fallback for any scene the renderer cannot find a per-species frame for. If `SCENE_FRAMES_BY_SPECIES[species]?.[stage]?.[scene]` returns `undefined`, fall through to the old `SILHOUETTES + applyEyeBlink` path. This guarantees no regression and lets future scenes opt in incrementally.

---

## 4. Implementation Handoff

For `@web-developer` (TODO-025).

### 4.1 Files to read first

1. This spec (top to bottom).
2. `docs/design/compact-frames.md` — palette, mood glyphs, life-stage codes, allowlist authority.
3. `src/render/compact.ts` lines ~280–520 — current `SILHOUETTES`, `SCENE_FRAMES`, `assembleCompactOutput`, `assembleWideOutput`, `applyEyeBlink`. The new data replaces the species-agnostic `SCENE_FRAMES` map for narrow-tier rendering and supplies wide-tier per-frame art.
4. `DECISIONS.md` — DEC-016 (statusline subprocess contract), DEC-017 (lowercase species).

### 4.2 Recommended data shape

Extend `SCENE_FRAMES` from `Record<SceneKey, readonly CompactFrame[]>` to a 3-level map keyed by species → stage → scene, with a fallback to the species-agnostic `SCENE_FRAMES`:

```ts
// New types — append to src/render/compact.ts
export interface SilhouetteFrame {
  /** 2 newline-separated rows for narrow/standard tier silhouette. */
  narrow: readonly [string, string];
  /** 4 newline-separated rows for wide tier silhouette. */
  wide: readonly [string, string, string, string];
  durationMs: number;
}

export type AnimatedSceneKey =
  | "idle-baseline"
  | "idle-energetic"
  | "idle-stoic"
  | "eating"
  | "sick";

/**
 * Per-species, per-stage, per-scene animation cycles.
 * Authored from docs/design/per-species-animation-frames.md (TODO-025).
 *
 * Lookup: SCENE_FRAMES_BY_SPECIES[species][stage][scene] → readonly SilhouetteFrame[]
 * Missing scene/stage/species → fall through to legacy SILHOUETTES + applyEyeBlink.
 */
export const SCENE_FRAMES_BY_SPECIES:
  Record<EggType, Record<LifeStage, Partial<Record<AnimatedSceneKey, readonly SilhouetteFrame[]>>>> = {
    circuit: {
      hatchling: {
        "idle-baseline": [
          { narrow: [" [oo]", "  || "], wide: ["    .", "   [oo]", "   -||-", "    ^^"], durationMs: 1000 },
          { narrow: [" [oo]", "  || "], wide: ["    .", "   [oo]", "   -||-", "    ^^"], durationMs: 1000 },
          { narrow: [" [__]", "  || "], wide: ["    .", "   [__]", "   -||-", "    ^^"], durationMs: 1000 },
          { narrow: [" [oo]", "  || "], wide: ["    .", "   [oo]", "   _||_", "    ^^"], durationMs: 1000 },
        ],
        // ...idle-energetic, idle-stoic, eating, sick
      },
      // ...juvenile, adult
    },
    // ...rune, shard, bloom
  };
```

### 4.3 Renderer wiring (pseudo-code)

In `assembleCompactOutput` and `assembleWideOutput`, replace the silhouette pick block with:

```ts
function pickAnimatedFrame(
  species: EggType,
  stage: LifeStage,
  scene: SceneKey,
  tick: number
): SilhouetteFrame | undefined {
  if (!isAnimatedScene(scene)) return undefined;          // death / level-up / sleeping fall through
  const stageMap = SCENE_FRAMES_BY_SPECIES[species]?.[stage];
  const cycle = stageMap?.[scene as AnimatedSceneKey];
  if (cycle === undefined || cycle.length === 0) return undefined;
  return cycle[tick % cycle.length];
}

// In assembleCompactOutput:
const stage = getLifeStage(deriveLevel(pet.xp));
const animated = pickAnimatedFrame(pet.eggType, stage, sceneKey, tick);
let row0: string, row1: string;
if (animated !== undefined) {
  // Use the species-stage-scene-specific frame; eye-blink no longer applied
  // (the cycle's blink frame IS the blink).
  [row0, row1] = animated.narrow;
} else {
  // Fallback: legacy silhouette + tick-driven applyEyeBlink
  const sil = SILHOUETTES[pet.eggType][stage];
  row0 = applyEyeBlink(sil.narrow[0], pet.eggType, stage, tick);
  row1 = sil.narrow[1];
}
```

For `assembleWideOutput` the same pattern applies — read `animated.wide` (4 rows) instead of the legacy `sil.wide`. The eye-blink fallback only runs when `animated === undefined`.

`isAnimatedScene` is a tiny predicate over the union: `(s) => s === "idle-baseline" || s === "idle-energetic" || s === "idle-stoic" || s === "eating" || s === "sick"`.

### 4.4 One-shot vs looping

`eating` is a one-shot (does not loop after frame 2). The current renderer treats every scene as a loop via `tick % frames.length`. To preserve one-shot semantics:

- Track `eatingStartTick` on the pet (or in module-level scene state) when `pet.fed` fires.
- For the next 3 ticks, render frames 0/1/2 of the eating cycle.
- After tick 3, return to the appropriate idle scene.

This is the same pattern `level-up` already uses (it's a one-shot). The simplest implementation: extend the existing one-shot dispatch in `pickScene` to recognize "recently fed" and emit `eating` only for ticks 0–2 since the last feed.

If extending the one-shot dispatcher is out of scope for TODO-025, **ship `eating` as a 3-frame loop** for v1; the visual difference at 1 Hz is small (the chew→swallow→crumb→chew sequence still reads as eating). Flag a follow-up TODO to thread the one-shot timer.

### 4.5 Validation tests to add

In `src/render/compact.test.ts` (new tests):

```ts
describe("SCENE_FRAMES_BY_SPECIES width preservation", () => {
  for (const species of EGG_TYPES) {
    for (const stage of LIFE_STAGES) {
      for (const scene of ANIMATED_SCENES) {
        it(`${species}/${stage}/${scene} preserves row widths`, () => {
          const cycle = SCENE_FRAMES_BY_SPECIES[species]?.[stage]?.[scene];
          if (!cycle) return;
          const [w0, w1] = [visibleWidth(cycle[0].narrow[0]), visibleWidth(cycle[0].narrow[1])];
          for (const f of cycle) {
            expect(visibleWidth(f.narrow[0])).toBe(w0);
            expect(visibleWidth(f.narrow[1])).toBe(w1);
            expect(f.wide).toHaveLength(4);
            for (let r = 0; r < 4; r++) {
              expect(visibleWidth(f.wide[r])).toBe(visibleWidth(cycle[0].wide[r]));
              expect(visibleWidth(f.wide[r])).toBeLessThanOrEqual(WIDE_SILHOUETTE_MAX_COLS);
            }
          }
        });

        it(`${species}/${stage}/${scene} uses only allowed characters`, () => {
          const cycle = SCENE_FRAMES_BY_SPECIES[species]?.[stage]?.[scene];
          if (!cycle) return;
          const ALLOWED = /^[\s()\[\]{}<>\/\\|\-_+*.,'":;~^oO0#=@vzZxXU]*$/;
          for (const f of cycle) {
            for (const row of [...f.narrow, ...f.wide]) {
              expect(row).toMatch(ALLOWED);
            }
          }
        });
      }
    }
  }
});
```

Note the allowlist regex above adds **three letters** to the existing wide-tier allowlist: `x`, `X`, and `U`.

- **`x` / `X`** — sick-scene eye token (`x-x` / `xx`). Already in narrow-tier `SICK_FRAMES` (the narrow-tier `assertFrameDimensions` doesn't enforce a character allowlist, only row/col counts), but never reached `assertWideFrameDimensions`. With per-species sick scenes now appearing on the wide tier, `x` becomes load-bearing.
- **`U`** — eating-scene mouth token (`UU`). Same story — already in narrow-tier `EATING_FRAMES` but never reached the wide-tier allowlist. The wide-tier eating scenes need it.

**Recommendation:** extend the regex in `assertWideFrameDimensions` (in `src/render/compact.ts`) and the `ALLOWED` regex above to add these three characters. The alternative (substituting `x`→`+`, `U`→`o`) loses readability — `x-x` and `UU` are universally legible cross-culturally and worth the 3-character allowlist expansion. Coordinate with `@architect` if this changes any published character contract; in practice it's an internal assertion only.

### 4.6 Pitfalls to respect

- **Don't apply `applyEyeBlink` on top of an animated cycle.** The cycle's frames already encode the blink at the right tick — overlaying the helper would replace the wrong substring or no-op. The fallback path is the only place `applyEyeBlink` should still run.
- **Width preservation is enforced by tests, not eyeballs.** Always run the new vitest spec before submitting; visible-width drift is silent in screenshots and explodes on 80-col terminals.
- **One-shot scenes need a tick-zero anchor.** If you implement `eating` as a real one-shot, the renderer must know "tick 0 of the eating scene" — not "global tick". This is the same plumbing `level-up` needs and the current code does not yet have. Punt to `idle-baseline + 3-frame eating loop` if the timer plumbing isn't in this PR.
- **Ascendants (L1024, DEC-019 D6) are immune to `sick`.** The dispatcher `pickScene` already enforces this — no special casing needed in the new tables; `sick` cycles will simply never be selected for ascendants.
- **Personality-driven scene selection unchanged.** `pickScene` still maps `Energetic`/`Curious`→`idle-energetic`, `Stoic`/`Philosophical`/`Gruff`→`idle-stoic`, default→`idle-baseline`. The new tables just supply better data for each.

### 4.7 Frame count summary

- Idle baseline: 4 frames × 4 species × 3 stages = 48
- Idle energetic: 4 frames × 4 species × 3 stages = 48
- Idle stoic: 2 frames × 4 species × 3 stages = 24
- Eating: 3 frames × 4 species × 3 stages = 36
- Sick: 3 frames × 4 species × 3 stages = 36

**Total authored frames: 192** across **60 scene-stage entries**, replacing the previous ~16 species-agnostic frames + the 12-pet eye-blink fallback.

---

*End of per-species animation frames v1.*
