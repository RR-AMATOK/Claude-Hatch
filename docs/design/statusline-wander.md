# glyphling — Statusline Pet Wander

**Status:** Design spec (revision 2 — user-approved 5-row wide + edge-pause) + consultant research (§10)
**Authors:** @designer (§1–§9), @design-consultant (§10)
**Date:** 2026-05-05
**Applies to:** `glyphling statusline` one-shot renderer — TODO-047
**Related:** DEC-016 (≤30 ms tick budget, 1 Hz floor), `compact-frames.md`, `statusline-wide.md`, `statusline-wide-silhouettes.md`, `architecture.md §12.0` (existing TUI wander at 500 ms / 2 Hz, 40-col arena, PR #60)

---

## §1. Scope

This doc governs **horizontal pet wander in the one-shot statusline renderer only** (`src/render/compact.ts`, dispatched from `src/render/statusline.ts`). It layers on top of the existing tier system (`narrow / standard / wide` per `statusline-wide.md §2`), the existing scene atlas (`compact-frames.md §4`), and the wide silhouette pack (`statusline-wide-silhouettes.md §2`). No scene frames are re-authored. Wander is a *render-time horizontal offset* applied to the silhouette art rows; it is not a new scene.

**Per-tier stdout row count (revision 2):** narrow emits ≤3 rows (unchanged); standard emits 3 rows (HUD on row 1, silhouette rows 2–3, unchanged); **wide now emits 5 rows** (silhouette rows 1–4, HUD on its own row 5) — was 4. See §2 and §5.2.

**Out of scope:**
- Expanded Ink TUI wander. Already shipped in PR #60 as the `useWander` hook (`architecture.md §12.0`, 500 ms cadence, 40-col arena, `pausedAtEdge` 1-tick edge hold). The TUI and the statusline operate in different rendering regimes (the TUI has a React loop; the statusline does not — see DEC-016) and intentionally use different cadences. A statusline-side wander does not refactor the TUI hook and vice-versa.
- **Vertical motion.** Pet stays on its assigned silhouette rows. No hopping.
- **Multi-pet rotation across the wander band.** Active pet (per `globals.activePetId`) wanders alone; sibling pets do not appear in the statusline arena.
- **Narrow-tier wander.** See §2 — narrow ships without wander.
- **Refresh-rate detection / adaptive cadence.** Per user constraint #7, `refreshInterval ≥ 3 s` degrades silently into perceived teleport; the renderer does not try to detect or compensate.
- **New env vars.** Only the existing `NO_MOTION` / `GLYPHLING_REDUCED_MOTION` are honoured (§7).

---

## §2. Per-tier verdict

| Tier | Wander? | Arena width (cols) | Rationale |
|------|---------|--------------------|-----------|
| narrow (`cols < 80`) | **NO** | — | The narrow-tier silhouette occupies cols 0–8 (max — `<^-..-^>` rune-adult = 8 visible cols incl. leading space) on rows 2–3, with the HUD row 1 packed-tight to the same left margin. Free width inside the 60-col working budget is ~50 cols, but adding wander to the narrow safety net spends design risk on the most-constrained surface. The doc's own `compact-frames.md §1.3` ("Width is sacred. 58 is our working width") tells us not to widen the contract on narrow. **Confirms user constraint #1.** |
| standard (`80 ≤ cols < 140`) | **YES** | min(50, cols − 14) | Free width on rows 2–3 (silhouette rows; HUD on row 1 — see §5) is essentially `cols − PET_WIDTH`. We cap arena at 50 cols (user constraint #6) so a full bounce cycle never exceeds ~88 ticks ≈ 1 m 28 s. At 80-col baseline the arena is small but coherent (~64 cols of wander band); at 139 cols it caps at 50 to preserve cycle-time sanity on ultra-wide laptop screens. |
| wide (`cols ≥ 140`) | **YES** | min(50, cols − HUD_RESERVE) | Wide tier emits **5 rows of stdout**: rows 1–4 carry the full wide silhouette art (rows 0–3 of `statusline-wide-silhouettes.md §2`) and **all four wander as a single composed creature**; row 5 is HUD-only (HUD-left + ` · ` + mood, packed-tight at col 0) and is never offset. Cap arena at 50 cols (user constraint #6). At 140 cols the arena is ~50 cols already, so the cap binds immediately at the wide threshold and the cycle stays stable across all wide widths up to 220+. |

**No counter-proposal.** Standard + wide ship; narrow stays still. Standard's 80-col floor gives a small but legible arena (5–6 effective wander columns at 80 cols once `PET_WIDTH ≈ 7` is subtracted) — coherent enough to read as wander, not jitter. If anything, a future iteration could *tighten* standard to a `≥ 90` floor to give a cleaner minimum arena, but that's a v2 call; current doc holds the line at the existing tier breakpoints.

---

## §3. Cadence math

At 1 Hz refresh, the pet hops **1 cell/sec** by default. Cadence is purely time-derived (no in-memory state — the statusline is a one-shot subprocess; see §10.5 ancillary note re: determinism).

```
PET_WIDTH        = visible width of the silhouette on its widest art row (per species × stage × tier)
arenaCols        = min(WANDER_ARENA_CAP, cols - reservedForHud(tier))
maxX             = arenaCols - PET_WIDTH        // furthest left edge before bouncing
stepsPerCycle    = 2 * maxX + 2                 // forward + reverse + 1-tick hold at each edge
step             = floor(Date.now() / 1000) % stepsPerCycle

if      (step <= maxX)               x = step               // moving right
else if (step === maxX + 1)          x = maxX               // pause at right edge
else if (step <= 2 * maxX + 1)       x = 2 * maxX + 1 - step // moving left
else                                 x = 0                  // pause at left edge

// Constants
WANDER_ARENA_CAP = 50          // user constraint #6
```

The wander offset `x` is then applied as a `" ".repeat(x)` left-pad to each silhouette art row (rows 2–3 at standard; rows 1–4 at wide). HUD rows (row 1 at standard, row 5 at wide) are **never** offset.

### §3.0 Why edge-pause

The cadence reserves one tick at each boundary for a stationary hold — the pet sits at `x = maxX` for one tick before reversing direction, and likewise at `x = 0`. This is consultant §10.5 ancillary recommendation 1, now adopted: a 1-tick hold gives the user's perceptual schema a **temporal landmark** for the direction change. Without it, two consecutive ticks at `(maxX, maxX − 1)` look identical to two ticks anywhere else in the arena — the user has no cue that anything special happened at the boundary, and the schema "the pet is wandering and bounced off the wall" never forms. With the pause, the pattern becomes "step, step, step, *pause*, step (other direction)" — the pause distinguishes wander from undirected twitch and matches the existing TUI `useWander` hook's `pausedAtEdge` behaviour, giving the statusline and the TUI a single shared bounce contract.

### §3.1 Why 1 cell/sec wins over 2 cells/sec at 1 Hz

2 cells/sec is mathematically impossible at the 1 Hz refresh floor (Claude Code's `refreshInterval` minimum is 1 second; the renderer cannot emit two distinct positions inside one second — see §10.5 finding 1). But even if the floor relaxed, 1 cell/sec is the right cadence:

- **Maximum-coherence step at discrete 1 Hz.** Each tick the eye sees a 1-col delta. That is the smallest possible non-zero displacement; it reads as "the pet is one column over from where it was." A 2-col delta per frame at 1 Hz reads as a discrete teleport — the eye cannot interpolate the missing position because the inter-stimulus interval (1000 ms) is 5–10× past the apparent-motion ceiling (§10.3). The smaller the displacement, the more the user's *schema* ("the pet is wandering") survives the gap.
- **Clock-tick analogy.** 1 cell/sec at 1 Hz mirrors the mechanical second hand: a discrete, regular, expected jump. Users do not describe a ticking clock as twitching. 2 cells/sec at 1 Hz would be the equivalent of a clock that skipped seconds — the same regularity broken.
- **Cycle-time sanity.** At a 50-col cap and `PET_WIDTH = 7`, `maxX = 43`, `stepsPerCycle = 2 * 43 + 2 = 88` (with the new edge-pause). At 1 cell/sec that is 88 seconds of wall-clock for a full bounce cycle — slow enough that the user notices direction changes only when they happen to glance, not as constant peripheral motion. At 2 cells/sec it would be 44 s, fast enough to keep tugging at peripheral vision.

### §3.2 Cycle-time table (worked)

`stepsPerCycle = 2 * maxX + 2` (the `+ 2` is the 1-tick hold at each boundary — see §3.0).

For `PET_WIDTH = 7` (typical standard-tier circuit-juvenile or rune-juvenile):

| `cols` | `arenaCols` | `maxX` | `stepsPerCycle` | Full cycle @ 1 Hz |
|--------|-------------|--------|-----------------|-------------------|
| 80 | min(50, 66) = 50 | 43 | 88 | 1 m 28 s |
| 100 | 50 | 43 | 88 | 1 m 28 s |
| 140 | 50 | 43 | 88 | 1 m 28 s |
| 220 | 50 | 43 | 88 | 1 m 28 s |

For `PET_WIDTH = 8` (standard-tier circuit-adult — the §5.1 worked-example pet):

| `cols` | `arenaCols` | `maxX` | `stepsPerCycle` | Full cycle @ 1 Hz |
|--------|-------------|--------|-----------------|-------------------|
| 80 | min(50, 66) = 50 | 42 | 86 | 1 m 26 s |
| 100 | 50 | 42 | 86 | 1 m 26 s |
| 140 | 50 | 42 | 86 | 1 m 26 s |
| 220 | 50 | 42 | 86 | 1 m 26 s |

Cap binds at all standard+wide widths in practice; cycle time is constant per `PET_WIDTH`. Predictable, ambient, clock-like.

For `PET_WIDTH = 11` (wide-tier circuit-elder):

| `cols` | `arenaCols` | `maxX` | `stepsPerCycle` | Full cycle @ 1 Hz |
|--------|-------------|--------|-----------------|-------------------|
| 140 | min(50, 140 − 17) = 50 | 39 | 80 | 1 m 20 s |
| 220 | 50 | 39 | 80 | 1 m 20 s |

---

## §4. `COMPACT_PET_WIDTH` per tier × species × stage

Visible widths drawn from the canonical art in `src/render/compact.ts` `SILHOUETTES` (lines 328–456) and `statusline-wide-silhouettes.md §2`. Width is measured as `visibleWidth(row)` of the **widest art row** for that species×stage — leading whitespace (centring padding inside the silhouette string) counts because it is part of the rendered glyph block and the wander offset applies to the whole string uniformly.

Implementation should hard-code these as a `COMPACT_PET_WIDTH[tier][species][stage]` table; values are stable across scene cycles because scene overlays (blink, chew, droop) never grow the silhouette wider than the baseline pose.

| Tier | Species | Stage | Visible width (cols) | Source |
|------|---------|-------|----------------------|--------|
| narrow | * | * | — | (no wander) |
| standard | circuit | hatchling | 5  | narrow art `" [oo]"` (`compact.ts:331`) |
| standard | circuit | juvenile  | 7  | `" /[oo]\"` (`compact.ts:341`) |
| standard | circuit | adult     | 8  | `" /[o-o]\"` (`compact.ts:351`) |
| standard | rune    | hatchling | 5  | `" <..>"` |
| standard | rune    | juvenile  | 7  | `" <^..^>"` |
| standard | rune    | adult     | 9  | `" <^-..-^>"` |
| standard | shard   | hatchling | 5  | `" /oo\"` |
| standard | shard   | juvenile  | 7  | `" /*oo*\"` |
| standard | shard   | adult     | 9  | `" /**oo**\"` |
| standard | bloom   | hatchling | 5  | `" (oo)"` |
| standard | bloom   | juvenile  | 7  | `" (~oo~)"` |
| standard | bloom   | adult     | 9  | `" (~*oo*~)"` |
| wide | circuit | hatchling | 8  | wide row 3 `"   -||-"` widest after row 2 `"   [oo]"` → max = 7; including leading-space alignment per art = 8. (`statusline-wide-silhouettes.md §2.1`) |
| wide | circuit | juvenile  | 9  | wide row 2 `"   /[oo]\"` (max col-index 9) |
| wide | circuit | adult     | 12 | wide row 3 `"  +==|--|==+"` (max col-index 12) |
| wide | rune    | hatchling | 7  | wide row 2 `"   <..>"` |
| wide | rune    | juvenile  | 9  | wide row 2 `"   <^..^>"` |
| wide | rune    | adult     | 11 | wide row 4 `"   .  .  ."` (max col-index 11) |
| wide | shard   | hatchling | 7  | wide row 2 `"   /oo\"` |
| wide | shard   | juvenile  | 9  | wide row 2 `"   /*oo*\"` |
| wide | shard   | adult     | 11 | wide row 1 `"    *   *"` and row 2 `"   /**oo**\"` both ≤ 11 |
| wide | bloom   | hatchling | 7  | wide row 2 `"   (oo)"` |
| wide | bloom   | juvenile  | 9  | wide row 2 `"   (~oo~)"` |
| wide | bloom   | adult     | 11 | wide row 2 `"   (~*oo*~)"` |

**Note on wide tier:** rows 1–4 wander as a unit; row 5 (HUD only) is never offset.

---

## §5. Arena math + HUD pin layout per tier

### §5.1 Standard tier (`80 ≤ cols < 140`)

**Current layout (per `src/render/compact.ts:1214–1255`):**
- Row 1 = HUD (left group + ` · ` + mood glyph, packed-tight at col 0).
- Rows 2–3 = silhouette art.

**Wander band:** rows 2–3, cols `0` through `arenaCols - 1` where `arenaCols = min(50, cols)`. The pet's left edge sweeps from `x = 0` to `x = maxX = arenaCols - PET_WIDTH(species, stage, "standard")`, then bounces.

**HUD pin:** row 1, anchored at col 0 (no change). The HUD does not reflow with the pet — it occupies its own row entirely. Confirms user constraint #5.

**Worked example — 100-col standard, circuit-adult (`PET_WIDTH = 8`), idle-baseline:**

```
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :|                                                       ← row 1 (HUD, fixed)
 /[o-o]\                                                                                            ← row 2 (pet at x=0)
 +=|--|=+                                                                                           ← row 3 (pet at x=0)
```

```
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :|                                                       ← row 1
                      /[o-o]\                                                                       ← row 2 (pet at x=21, mid-arena, arenaCols=50, maxX=42)
                      +=|--|=+                                                                     ← row 3
```

```
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :|                                                       ← row 1
                                            /[o-o]\                                                 ← row 2 (pet at x=42, right edge — about to bounce)
                                            +=|--|=+                                                ← row 3
```

Notes:
- Wander offset is applied as `" ".repeat(x) + sil.narrow[0]` on row 2 and `" ".repeat(x) + sil.narrow[1]` on row 3.
- The narrow silhouette already includes a 1-col leading space (built into the SILHOUETTES strings); wander offset is *added* to that, not replacing it.
- HUD row 1 is unchanged at every tick. Mood glyph stays packed-tight after HUD-left, per the existing pack-tight design (current `buildHudRow` at `compact.ts:1210`). Wander does not move the mood glyph.

### §5.2 Wide tier (`cols ≥ 140`)

**New layout (revision 2 — 5 rows of stdout):**
- Rows 1–4 = wide silhouette art rows 0–3 (the entire wide silhouette, including the ground row). All four rows translate together as one composed creature.
- Row 5 = HUD-only — HUD-left + ` · ` + mood, packed-tight at col 0. No silhouette content. Never offset by wander.

**Wander band:** rows 1–4. Cols `0` through `arenaCols - 1`, where `arenaCols = min(50, cols)` (the previous `cols - WIDE_HUD_START_COL` subtraction is no longer needed since the HUD has its own row). The pet's left edge sweeps from `x = 0` to `x = maxX = arenaCols - PET_WIDTH(species, stage, "wide")`, holds one tick (§3.0 edge-pause), then bounces.

**HUD pin:** row 5, anchored at col 0 (no change to HUD composition itself — same `buildHudRow` output as the old wide-tier row 4, just emitted on a different row index).

**Schema:** "the pet wanders as one composed creature; the HUD is the room it wanders in." The pet — feet, sigils, ground glyphs and all — moves together; the HUD sits below it like a label on a terrarium. Confirms user constraint #5 in its strongest form: pet wanders, HUD stays put, and the pet is no longer split across moving and anchored rows.

**Worked example — 160-col wide, circuit-elder (`PET_WIDTH = 12`), idle-baseline:**

`x = 0` (left edge, immediately after a left-edge pause):
```
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
    .v.                                                                                                                                                        ← row 1 (silhouette art row 0, x=0)
   /[o-o]\                                                                                                                                                     ← row 2 (silhouette art row 1, x=0)
  +==|--|==+                                                                                                                                                   ← row 3 (silhouette art row 2, x=0)
    |_||_|                                                                                                                                                     ← row 4 (silhouette art row 3 — ground, x=0)
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :|                                                                                                                   ← row 5 (HUD, fixed)
```

`x = 19` (mid-arena, `maxX = 38`):
```
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
                       .v.                                                                                                                                      ← row 1 (x=19)
                      /[o-o]\                                                                                                                                   ← row 2 (x=19)
                     +==|--|==+                                                                                                                                 ← row 3 (x=19)
                       |_||_|                                                                                                                                   ← row 4 (x=19) — ground translates with the rest
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :|                                                                                                                   ← row 5 (HUD, fixed)
```

`x = 38` (right edge, holding for the §3.0 edge-pause tick):
```
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
                                          .v.                                                                                                                   ← row 1 (x=38)
                                         /[o-o]\                                                                                                                ← row 2 (x=38)
                                        +==|--|==+                                                                                                              ← row 3 (x=38)
                                          |_||_|                                                                                                                ← row 4 (x=38)
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :|                                                                                                                   ← row 5 (HUD, fixed)
```

Notes:
- All four silhouette rows receive the same `" ".repeat(x)` left-pad. They translate in lockstep — the creature reads as a single coherent unit.
- The silhouette pack from `statusline-wide-silhouettes.md §2` is untouched; revision 2 only changes how many rows of stdout the renderer emits and which row the HUD occupies.
- Sleep particles (currently appended to rows 2–3 at fixed cols 15/17 per `compact.ts:1291–1299`) follow the wander offset — they are appended AFTER the wander pad, so `z`/`Z` track the pet. Same rule as before; the §9 implementation note still applies.

---

## §6. One-shot scene snap behaviour

Per user constraint #3: **center-snap.** During eating / playing / petted / level-up / death scenes, the pet pauses at the arena's centre column for the duration of the scene window. (The compact-tier `SceneKey` namespace does not have separate `hatch` / `evolve` keys — those exist only in the expanded-TUI 22-key `SceneId` atlas. Adjusted from earlier draft per architect review.) After the window expires, wander resumes from where the centre-snap landed (i.e. the next ambient tick computes its position from `floor(Date.now() / 1000)` as normal — there is no "resume from the centre" memory; the deterministic step formula simply takes over again).

**Center column derivation:**
```
centerX = floor((arenaCols - PET_WIDTH) / 2)        // i.e. floor(maxX / 2)
```

For `arenaCols = 50, PET_WIDTH = 8` (standard circuit-adult): `centerX = floor(42 / 2) = 21`. Worked example matches the mid-arena mockup in §5.1 — by design.

### §6.1 Transition tick mockup (standard, 100 cols, circuit-adult)

Wall-clock 12:00:00 — ambient idle, wander tick 17 (pet at `x = 17`, drifting right):
```
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :|                                                       ← row 1 HUD (fixed)
                  /[o-o]\                                                                           ← row 2 (pet at x=17)
                  +=|--|=+                                                                          ← row 3
```

Wall-clock 12:00:01 — `pet.fed` event fires at +0.3 s of this tick → scene flips to `eating`, `EAT_WINDOW_MS = 6000` (`compact.ts:56`):
```
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :)                                                       ← row 1 (mood glyph flips to :) for the window)
                      /[^-^]\                                                                       ← row 2 (pet snapped to centerX=21, eat-frame chew)
                      +=|UU|=+                                                                      ← row 3
```

Wall-clock 12:00:02 through 12:00:06 — pet remains snapped to `centerX = 21`, eat-scene frame cycle plays in place (3 frames × 2 s each = 6 s, matches `EAT_WINDOW_MS`).

Wall-clock 12:00:07 — eat window expires, scene resolves back to `idle-baseline`. Wander resumes deterministically:
```
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :|                                                       ← row 1
                       /[o-o]\                                                                      ← row 2 (pet at x = floor(7/1) % 86 = 7 + accumulated step from clock)
                       +=|--|=+                                                                     ← row 3
```
The exact `x` after resume depends on wall-clock; the formula is unchanged. The point is that wander is *time-derived*, not state-machine-derived, so there is nothing to "reset."

### §6.2 Snap reads as purposeful pause, not teleport bug

My call: **purposeful pause.** Three reasons:

1. **The scene change is the cue.** When `eating` (or `level-up`, etc.) starts, the silhouette glyphs change at the same tick — `[o-o]` becomes `[^-^]`, `+=|--|=+` becomes `+=|UU|=+`. The eye registers "the pet is doing something different now" before it registers "the pet is in a new column." The position snap is subordinate to the scene change; it reads as part of the same act, not as an independent jump.
2. **The mood glyph also changes.** On `eating`, the mood flips to `:)` (happy). The HUD row is changing too. The whole frame is in flux at the transition tick — a centre-snap is the calmest possible position-side response to that flux.
3. **The schema is "the pet pauses to do things."** Real Tamagotchi sprites stop moving when fed; the user's mental model from 30 years of cartoon convention says "creatures stop wandering when they're eating." Aligning the snap with the scene change reinforces that schema rather than violating it.

Counter-evidence: at the 1-tick boundary, the position jump from `x = 17` to `x = 21` is 4 cols. That is well past the apparent-motion ceiling and *will* read as a teleport. The mitigation is the simultaneous scene-change — the brain attributes the position jump to the same event as the eye-shape and mood change. Without the simultaneous scene change (e.g., if we tried to snap-to-centre during a pure-ambient tick), the user would read it as a bug. **The snap rule must therefore fire if-and-only-if the scene transitions to a one-shot.** Implementation guard: `if (sceneKey ∈ {"eating", "playing", "petted", "level-up", "death"}) wanderX = centerX`.

### §6.3 Death is sticky

`death` is a one-shot that does not chain back to ambient (`pet.diedAt != null` permanently). The pet stays at `centerX` forever. This is correct: a wandering tombstone reads as macabre slapstick. Pinning to centre and never resuming is the dignified read. Confirms `compact-frames.md §4.6` ("emotional contract: this is a funeral, not a bug").

---

## §7. Reduced-motion verdict

**Confirmed: pin to `centerX` always.** When `process.env.NO_MOTION === "1"` OR `process.env.GLYPHLING_REDUCED_MOTION === "1"`, the wander offset is forced to `centerX` for every tick — same value as the one-shot scene snap. The pet exists in the arena (so the layout is consistent with motion-enabled users) but does not move. Idle-baseline scene cycling continues at normal cadence per `statusline-wide.md §6`; only the horizontal position is frozen.

Why centre and not `x = 0`: leftmost would visually overlap the existing HUD anchor on standard tier (HUD on row 1, pet on rows 2–3 — overlap is not literal, but they share col 0 vertically, which reads as "pet is hiding under the name"). Centre keeps the pet visible as its own distinct presence at all widths.

This also matches `useWander`'s reduced-motion handling in the TUI (PR #60) — single contract across both rendering surfaces.

---

## §8. Cadence comparison ASCII mockup

Four consecutive ticks (4 s of wall-clock), starting from `step = 0` for legibility. Real wander phase depends on `floor(Date.now() / 1000)` and will not start at 0 in practice, but the *delta-per-tick* is what the user evaluates.

### §8.a Standard tier, 100 cols, circuit-adult (`PET_WIDTH = 8`, `arenaCols = 50`, `maxX = 42`), idle-baseline ambient

```
T+0s:
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :|
 /[o-o]\
 +=|--|=+

T+1s:
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :|
  /[o-o]\
  +=|--|=+

T+2s:
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :|
   /[o-~]\
   +=|--|=+

T+3s:
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :|
    /[o-o]\
    +=|__|=+
```

Per-tick delta on rows 2–3: 1 col right. Idle-baseline scene cycle (`compact.ts:469–474`) advances the eye-blink frame at T+2 (`/[o-~]\`) and the breath frame at T+3 (`+=|__|=+`) — these are independent of wander and add micro-variation that reinforces "this is alive, not stuck."

**Edge-pause (§3.0).** When the pet reaches `x = maxX`, the next tick holds at `x = maxX` (the right-edge pause), then the tick after that begins moving left at `x = maxX − 1`. Same at the left edge: a tick of `x = 0`, another tick still at `x = 0`, then `x = 1` rightward. The mockup above is mid-arena and does not show the pause directly; the user perceives the pause as a brief "the pet stopped at the wall" beat that announces the direction change.

### §8.b Wide tier, 140 cols, rune-adult (`PET_WIDTH = 11`, `arenaCols = 50`, `maxX = 39`), idle-baseline ambient

Pet starts at `x = 15` (mid-arena, drifting right). Each tick all four silhouette rows shift `+1` col together; the HUD on row 5 is constant.

```
T+0s (x=15):
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
                ^^^
               <^-..-^>
                \|||/
                .  .  .
 Mossy · Lv 30 · [███████░░░░░░░] 20000 · :|

T+1s (x=16):
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
                 ^^^
                <^-..-^>
                 \|||/
                 .  .  .
 Mossy · Lv 30 · [███████░░░░░░░] 20000 · :|

T+2s (x=17):
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
                  ^^^
                 <^-..~>
                  \|||/
                  .  .  .
 Mossy · Lv 30 · [███████░░░░░░░] 20000 · :|

T+3s (x=18):
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
                   ^^^
                  <^-..-^>
                   \|||/
                   .  .  .
 Mossy · Lv 30 · [███████░░░░░░░] 20000 · :|
```

Per-tick delta on rows 1–4: 1 col right, all four rows in lockstep — they translate as a unit. Row 5 (HUD `Mossy · Lv 30 · ...`) is identical across all four ticks. The blink at T+2 (`<^-..~>`) is independent of wander.

**Edge-pause (§3.0).** Same behaviour as §8.a — when the pet reaches `x = maxX = 39`, one tick holds at 39, then the next tick steps to `x = 38` leftward; same at the left edge. The mockup above is mid-arena and does not show the pause directly.

### §8.c Standard tier, 100 cols, circuit-adult — eat-feast transition tick

T+0s — ambient idle, wandering, mid-stride at `x = 17`:
```
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :|
                  /[o-o]\
                  +=|--|=+
```

T+1s — `pet.fed` event fired at T+0.3s, this is the first render tick of the eating scene. **Position snaps to `centerX = 21`, scene glyphs change, mood glyph changes:**
```
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :)
                      /[o-o]\ .
                      +=|--|=+ .
```
(Eat scene frame 1 is the "incoming food" pose per `compact-frames.md §4.2`. Snap reads as "the pet stopped to eat" — see §6.2.)

T+2s — eat scene frame 2 (munching), still at `centerX = 21`:
```
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :)
                      /[^-^]\
                      +=|UU|=+
```

T+7s — eat window expired, ambient resumed, wander step computed from current wall-clock:
```
.........|.........|.........|.........|.........|.........|.........|.........|.........|.........
 Pixel · Lv 30 · [███████░░░░░░░] 20000 · :|
                       /[o-o]\
                       +=|--|=+
```
(Exact `x` depends on wall-clock — formula unchanged. The pet may resume close to where it snapped, or far from it, depending on the seconds-of-clock state. Either reading is fine: "the pet finished eating and kept wandering.")

---

## §9. Open questions for implementation

Hand to @architect / @web-developer:

1. **Scene-classification predicate.** Where does `isOneShotScene(sceneKey)` live? The wander code needs to call it once per tick to decide center-snap-vs-wander. Most natural home is `compact.ts` next to `pickCompactFrame` / `selectScene`. Implementation: a small const set `ONE_SHOT_SCENES = new Set(["eating", "playing", "petted", "level-up", "death"])` over the 10-key compact `SceneKey` namespace. Architect review confirmed: do NOT import the 22-key `isAmbientScene` from `src/render/animation.ts` — different namespace. Add a cross-consistency unit test asserting that any `SceneKey` in `ONE_SHOT_SCENES` maps to a `SceneId` that is NOT in `AMBIENT_SCENES` (and vice-versa).

2. **Visible-width source-of-truth.** §4 hard-codes `COMPACT_PET_WIDTH[tier][species][stage]`. Risk: if a future silhouette edit changes a row's visible width, the constant goes stale silently. Two options: (a) compute at module load via `Math.max(...rows.map(visibleWidth))` and freeze; (b) build-time assertion in `assertWideFrameDimensions` / sibling for narrow that recomputes and asserts equality with the hard-coded table. Recommend (a) for simplicity — it's a one-time compute at boot, well within the 30 ms budget. @web-developer call.

3. **Sleep-particle alignment.** Currently sleep particles are appended at hard-coded col 15/17 on rows 2–3 of the wide tier (`compact.ts:1291–1299`). With wander, particles should track the pet (append AFTER wander pad). Confirm this read with @web-developer; the alternative (particles stay anchored, pet moves out from under them) reads as the pet abandoning its `z`'s, which is cute but probably not intended. Sleeping is not a one-shot scene, so wander DOES apply during sleep — but particles tracking the pet is the cleaner read.

4. **Level-up flash row 1 anchoring at wide tier.** `statusline-wide-silhouettes.md §3.4` says level-up peak glyphs replace row 1 centred over the silhouette face. Level-up is a one-shot scene → center-snap fires → row 1 peak glyph stays anchored at the silhouette's centred face cols. No conflict, but worth confirming the implementation order: `if (oneShotScene) { x = centerX; } applyWander(rows, x); applyScene(rows, scene, tick);` — so wander offset is applied BEFORE scene overlay, which means scene overlays must address rows by relative col, not absolute col. Existing code already does this (overlays use string content, not col-positions); flagging for awareness only. **Revision-2 note:** at wide tier the level-up peak glyph still goes on row 1, which now wanders together with rows 2–4 (no longer anchored separately). The overlay logic does not change — row 1 still receives the peak glyph string and the wander pad is applied uniformly to rows 1–4 — but worth a quick re-confirm with @web-developer that the existing overlay implementation does not assume row 1 is at a fixed col.

5. **Right-edge col-budget assertion.** With `arenaCols ≤ 50` capped, the rightmost col the pet can occupy is `maxX + PET_WIDTH - 1 = arenaCols - 1 = 49`. At standard tier, the HUD on row 1 may extend past col 49 (typical HUD is 50–60 cols wide). Rows 1 and rows 2–3 do not collide because they are separate rows. At wide tier (revision 2 — 5 rows), the HUD lives alone on row 5 at cols 0+; the silhouette wanders across rows 1–4 within `[0, maxX]`. Rows 1–4 and row 5 never collide because they are separate rows. **No collisions in the worked layouts.** Add a test that asserts `visibleWidth(rowN) ≤ cols` for all rows after wander is applied, just to lock the contract.

6. **Cycle phase across multiple pets / restart.** The deterministic formula `floor(Date.now() / 1000) % stepsPerCycle` means that two terminals open at the same wall-clock second show the pet at the same `x`. Acceptable (probably even desirable — the pet is "the same pet at the same time"). But `stepsPerCycle` depends on `PET_WIDTH(species, stage)`, so two pets of different stages will have different cycle lengths and drift relative to each other. This is a non-issue for the active pet (only one renders), flagging in case future multi-statusline arrives.

7. **`refreshInterval` user setting > 1 s.** Per user constraint #7 we accept silently. Document this in the user-facing README/CLAUDE.md as "wander looks like teleport when refreshInterval is set above 1 second; lower it to 1 to see smooth wander cadence." Not a code change — a docs note for @technical-writer when this lands.

8. **Wide tier emits 5 rows of stdout (was 4).** Revision 2 splits the HUD onto its own row 5, so any tier-output assertions in `compact.widetier.test.ts` (and any other test files that count wide-tier stdout rows) need to be updated from 4 to 5. Likely also a snapshot or two to refresh. @web-developer / @qa-engineer.

9. **Wide-tier HUD row composition is unchanged.** The HUD on the new row 5 is rendered by exactly the same `buildHudRow` composition that previously rendered the HUD on the old row 4 — same HUD-left + ` · ` + mood, packed-tight at col 0. The only change is the row index it lands on and the fact that no silhouette content shares the row. No new HUD logic, no new packing rule — `buildHudRow` itself is untouched.

---

## §10. Consultant research

**Brief:** Lead designer is specifying horizontal wander for the pet in the Claude Code statusline. The Claude Code statusline has a hardcoded **1 Hz refresh floor** (`refreshInterval` minimum 1 second, per `CLAUDE.md` "Run in Claude Code"), so a wandering pet means **discrete-position updates at full-second granularity** — the renderer cannot produce smooth motion. The user has approved 1 cell/sec as the default cadence. The core question for this research: **at 1 Hz, does a 1-cell-per-tick discrete-position update read as motion, or as twitch?**

This section is parallel input to the lead designer's §1–§9. Any contradictions with the designer's text must be adjudicated by @product-owner; flagged contradictions are listed at the end.

### §10.1 Q1 — Statusline / prompt animation under low-refresh

The honest finding here is that **mainstream shell prompts do not animate position at all.** Powerline, Starship, Oh-My-Posh, p10k, and Spaceship are all *event-driven repaints* — they redraw on prompt re-render (after each command), not on a continuous tick. There is no precedent in the prompt ecosystem for a moving glyph in the prompt line because prompts have no render loop. The closest thing — Starship's transient prompt and `right_format` — is purely positional, never temporal.

Tmux is the only mainstream surface where a statusline genuinely *ticks* on its own. The cadence convention there is the relevant prior art:

- **tmux `status-interval`** — default `15` seconds; common user override is `1`–`5` seconds. Plugins assume this range. ([tmux man page, status-interval](https://man.openbsd.org/tmux))
- **dracula/tmux** — spinner segment at 1-second cadence, single-glyph rotation `⠋⠙⠹⠸…`. The cadence reads as "ticking," not "moving." ([dracula/tmux readme](https://github.com/dracula/tmux))
- **tmux-mem-cpu-load**, **tmux-cpu** — bar-graph segments updated every 1–5 s. The graph *redraws*, it does not *slide*; new samples appear at the right and old ones drop off. ([tmux-mem-cpu-load](https://github.com/thewtex/tmux-mem-cpu-load))
- **kanagawa-tmux CPU graph** — same pattern: per-sample redraw, no inter-sample interpolation.
- **VS Code statusbar** — animated spinners use the [`$(sync~spin)` codicon](https://code.visualstudio.com/api/references/icons-in-labels#animation), which the editor renders via CSS `animation` at ~60 fps inside the spinner cell. The statusbar itself does not tick; only the GPU-rendered icon spins. This is *not transferable* to a terminal subprocess that re-runs at 1 Hz.
- **JetBrains / IntelliJ** indicator — same pattern: CSS-animated icon inside an otherwise-static bar.
- **Oh-My-Posh transient prompt and pomodoro segment** ([OMP docs](https://ohmyposh.dev/docs/configuration/segment)) — segment values change on prompt repaint, not on a timer.

**Takeaway for glyphling:** the only direct prior art for "this thing in my chrome ticks once a second" is tmux. Tmux's design language is **per-tick redraw of a position-stable glyph** (spinner rotates in place, graph redraws in place) — NOT a glyph translating across cells. Translating a glyph at 1 Hz is an unexplored design space in mainstream terminal chrome. This is a mild risk — we have no widely-tested precedent that the pattern reads well. Mitigated by §10.4 below.

### §10.2 Q2 — ASCII pet / desktop-pet prior art

The ASCII-pet ecosystem runs at *much* higher cadences than 1 Hz when given free choice — which is informative as a contrast, not a target.

- **pipes.sh** — default tick `0.05` s (20 fps). It picks a high cadence specifically to read as motion. Below ~10 fps the pipe stops looking like "growing" and starts looking like "stamping." ([pipes.sh source](https://github.com/pipeseroni/pipes.sh))
- **cbonsai (live mode)** — `--time 0.5` s default per growth step. Notably the bonsai *grows* (additive paint) rather than translates — translation would feel jumpy at 0.5 s and they implicitly avoid it.
- **asciiquarium** — 10 fps. Fish translate horizontally one cell per frame. At 10 fps with 1-cell steps the result reads as smooth motion (within phi-phenomenon thresholds; see §10.3). At 1 Hz the same pattern would not.
- **nyancat / bongo-cat-cli** — 10–30 fps full-frame redraws.
- **oneko (X11)** ([oneko src](https://github.com/yoshikaw/oneko)) — cursor-following cat updates every 125 ms (8 Hz). Below this rate the original author noted "it doesn't feel alive." Several modern ports (`oneko.js`, `cattui`) run 5–10 Hz.
- **xroach** — event-driven (moves only when uncovered by window changes). When it does move it translates many cells in a single redraw — a punctuated event, not smooth motion. **This is the most relevant prior art for our 1 Hz constraint:** xroach reads as *creature behaviour* despite never animating smoothly, because each redraw is a *discrete event* the user attends to as such.
- **xeyes** — 50 ms repaint when cursor moves, but only the pupil position changes; the eye-frame is stable. Position-stable + sub-glyph redraw, like a tmux spinner.

**Takeaway:** every ASCII-pet that actually *translates* a sprite picks a cadence ≥ 5 Hz. **No surveyed pet translates at 1 Hz on purpose.** xroach is the closest match to our constraint and it succeeds by *not* trying to read as motion — it reads as "the creature moved while you weren't looking." This is the design frame to lean into for glyphling: each tick is a discrete *act of having moved*, not a frame of motion.

### §10.3 Q3 — HCI literature on perceived motion at discrete-position updates

The relevant body of work is gestalt apparent-motion research, founded by Wertheimer (1912) and refined by Korte, Ternus, and Kolers across the 20th century.

- **Beta movement** (Wertheimer 1912) — the perception of an object moving smoothly between two discrete positions. The classical threshold is an inter-stimulus interval (ISI) of approximately **30–200 ms**, with optimal beta around **60 ms** for small displacements. ([Wertheimer, *Experimentelle Studien über das Sehen von Bewegung*, 1912](https://psycnet.apa.org/record/1913-04201-001))
- **Phi phenomenon** — pure motion perception without a moving object, observed at **shorter** ISIs (~50–100 ms) and small displacements. Distinct from beta but often conflated.
- **Korte's third law** — for apparent motion to be perceived, displacement and ISI must be *coupled*: larger displacements require longer ISIs to read as motion, but only up to a hard ceiling around **300 ms** before the percept collapses to "two separate events."
- **Ternus display** (Ternus 1926, replicated extensively) — at ISI ≤ 50 ms, a pair of dots reads as *element motion* (one dot moves); at ISI ≥ 200 ms, the same display reads as *group motion* or as discrete events. The phase change is sharp.
- Modern reviews (Steinman, Pizlo & Pizlo 2000; [Apparent motion – Scholarpedia](http://www.scholarpedia.org/article/Apparent_motion)) confirm the upper bound: **above ~400 ms ISI the visual system stops integrating successive stimuli into motion** under any displacement.

**At 1 Hz our ISI is 1000 ms — 2.5× to 10× over the apparent-motion ceiling.** The eye *will not* perceive a 1-cell-per-tick statusline pet as motion. This is not a soft preference; it is a hard property of the human visual system. We must design for the regime *above* the apparent-motion ceiling, where the percept is **discrete event**, not motion.

The good news: discrete-event perception has its own design vocabulary, and it works for ambient UI:

- **Change blindness** literature (Rensink 2002) shows that users *do* notice discrete changes in peripheral vision when the change is **structurally meaningful** (a glyph moves to a new column) and **temporally regular** (the user forms an expectation of when to look).
- **Schema-driven perception** (Bartlett, refined in HCI by Norman) — once the user has the schema "the pet wanders," each tick's new position confirms the schema rather than surprising the user. The first 5–10 seconds the user must learn the schema; after that, the discrete jumps read as *the pet wandering*, semantically, even though they are not motion, perceptually.
- This is exactly how analogue clock minute hands work: at 1-minute granularity the hand visibly *jumps* when you happen to look at the right moment, but you read "time passes" not "the hand twitched."

**Bottom line for Q3:** at 1 Hz we are firmly outside motion perception and firmly inside discrete-event perception. The design must lean on schema and regularity, not try to fake motion the eye refuses to see.

### §10.4 Q4 — "Tick-tock" patterns that work design-wise

Designed examples where users happily accept 1-second-or-slower discrete updates:

- **Original Tamagotchi (1996)**, **Digimon V-Pet** — sprite position updates at 1–5 second intervals on the LCD. Reads fine because (a) the sprite is small relative to the screen, (b) the user's expectation is "the pet does its own thing," (c) there is no competing motion in the chrome. **Direct fit for glyphling**: silhouette is 6–10 cols wide in narrow tier, the pet has its own column space, the rest of the HUD is static. The Tamagotchi envelope applies.
- **Analogue clocks with second-hand tick (mechanical)** — the second hand jumps once per second, never smoothly. This is the canonical 1 Hz discrete-event UI; nobody describes a ticking clock as "twitching." The schema is so robust that a smoothly-sweeping second hand actually reads as *more* unusual.
- **Train station departure boards (Solari split-flap)** — characters flip in a temporally regular pattern; the flips themselves are not "motion," they are structured events. Users wait for the flip happily because it is regular and meaningful.
- **Chess clocks** — tick once per second, sometimes once per minute in correspondence chess. The user accepts the clock as a quiet metronome.
- **macOS menu bar clock at second-resolution** (`HH:MM:SS`) — the seconds digit increments at 1 Hz; users register this as ambient pulse, not jitter.
- **GitHub / Slack "X minutes ago" timestamps** — discrete temporal updates, jump from "1 minute ago" to "2 minutes ago" with no animation. Read fine.
- **Twitter / X live counters on viral posts** — increment in chunks (often coarser than 1 Hz). The discreteness is itself a signal of liveness; smooth interpolation would feel fake.

**The shared property of every example that works:** the discrete update is **regular**, **expected**, and **occupies a stable spatial slot** (the clock face, the timestamp position). Discrete updates fail when they appear at irregular intervals or in unexpected locations — *that* reads as twitch, not tick.

**Apply to glyphling:**
- The pet's wander column-range must be a stable spatial slot the user learns once. (The lead designer's "narrow arena, anchor-outside HUD" decision satisfies this.)
- Wander steps must be temporally regular — every 1.0 s on the dot, not jittered. The Claude Code subprocess model gives us this for free as long as we don't introduce per-tick variability.
- Wander steps must be **structurally meaningful** — direction changes at boundaries should be deterministic so the user develops a schema for "the pet just hit the wall and is turning around." Random direction changes mid-arena would break the schema and re-introduce the twitch reading.

### §10.5 Q5 — Final cadence recommendation

**Recommendation: keep the user-approved 1 cell/sec.** Do not slow to 0.5 cells/sec. Do not speed up to 2 cells/sec.

Justification, ranked by weight:

1. **2 cells/sec is impossible at the 1 Hz refresh floor.** Claude Code's `refreshInterval` minimum is 1 second; the renderer cannot emit two distinct positions in one second, period. The expanded TUI's 2 Hz / 500 ms cadence (`architecture.md §12.0`, `STEP_INTERVAL_MS = 500`) is achievable there because the Ink TUI runs its own React render loop. The compact statusline does not have that loop. This eliminates the 2 cells/sec option on the constraint, not on the design.

2. **0.5 cells/sec (a step every 2 seconds) makes the pet feel dead.** From the discrete-event lens (§10.3): a 2-second period puts the inter-event interval at 2000 ms, which is the threshold above which users start *forgetting* the schema between events. The clock-tick analogy breaks — a clock that ticked every two seconds would feel broken. xroach-style "the creature moved while you weren't looking" works because successive events are close enough together that the user can attribute them to the same agent; at 2 s gaps the user starts asking "is this still the same wander, or did something else happen?"

3. **1 cell/sec aligns with the most successful 1 Hz discrete-update precedents.** The mechanical clock second-hand, the macOS menu bar seconds digit, the Solari board flip cadence — all converge on 1 Hz as the natural metronome of "ambient liveness." Glyphling's wander pattern joins a well-trodden cadence convention.

4. **1 cell/sec produces a meaningful arena traversal time.** With a narrow arena (lead designer's decision; arena_cols ≈ 20 expected) the pet crosses the arena in ~20 seconds and reverses — a natural ambient cycle. At 0.5 cells/sec the cycle is 80 seconds, beyond ambient attention. At a hypothetical 2 cells/sec it would be 10 seconds, fast enough to catch focus and pull attention away from code.

5. **Accept that this is "wander," not "motion."** Per §10.3, the visual system *will not* render this as motion at 1 Hz. The design must own this. The user reading is "the pet shifted a column" once a second — a schema-driven discrete event, exactly like the second-hand of a clock. Trying to push toward smooth-motion territory by adding sub-second ticks is impossible at the refresh floor; trying to slow it down to "less twitchy" misreads the regime — the slower you go past 1 Hz, the more each step reads as a *surprise*, not less.

**Ancillary design notes that strengthen the 1 Hz / 1-cell choice:**

- **Pause at edges** (mirror the existing TUI `pausedAtEdge` from `architecture.md §12.0`) — when the pet hits an arena boundary, hold for one tick before flipping facing. This adds a temporal landmark the user's schema can lock onto ("the pet just turned around"), distinguishing wander from twitch.
- **Freeze during one-shot scenes** (eat, level-up, death) — the existing TUI `isAmbientScene` predicate. Translation during a peak moment dilutes the moment.
- **Respect `prefers-reduced-motion`** — under `GLYPHLING_REDUCED_MOTION=1` or `NO_MOTION=1`, hold position at the arena centre. Discrete jumps every second are exactly the kind of repeating motion the W3C reduced-motion guidance targets ([WCAG 2.3.3](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html)). The TUI already follows this contract; the statusline must too.
- **Determinism across ticks** — direction state must be derivable from `floor(now / 1000)` plus a small amount of recoverable arena state (current x, current facing). The compact renderer is a one-shot subprocess and has no in-memory continuity between ticks; either recompute the wander deterministically from wall-clock time, or persist `{x, facing}` in a sidecar file alongside `state.json`. This is an implementation detail for @backend-developer / @web-developer; flagging here because the cadence recommendation assumes regular ticks, and implementation must not introduce skew.

### §10.6 Contradictions with user-approved constraints

None found. The user's approved constraints (narrow arena, centre-snap, anchor-outside HUD, 1 cell/sec default) are all consistent with this section's findings. The 1 cell/sec cadence is not just defensible under the 1 Hz constraint — it is the *correct* cadence given the discrete-event regime we are operating in.

One soft tension to flag for adjudication, not a contradiction:
- The expanded Ink TUI uses 2 Hz / 500 ms wander (`architecture.md §12.0`). Users who switch between the statusline pet and the TUI pet will see two different cadences for ostensibly the same behaviour. This is *not* a recommendation to change either — both cadences are correct in their respective regimes (TUI has a render loop; statusline does not). But it is worth a one-line note in §1–§9 acknowledging the asymmetry, so a future contributor reading both docs does not "fix" the perceived inconsistency.

### §10.7 References

- Wertheimer, M. (1912). *Experimentelle Studien über das Sehen von Bewegung.* Zeitschrift für Psychologie, 61, 161–265.
- Ternus, J. (1926). *Experimentelle Untersuchungen über phänomenale Identität.* Translated and reprinted in Ellis (1938) *Source Book of Gestalt Psychology*.
- Korte, A. (1915). *Kinematoskopische Untersuchungen.* Zeitschrift für Psychologie, 72, 193–296.
- Steinman, R. M., Pizlo, Z., & Pizlo, F. J. (2000). *Phi is not beta, and why Wertheimer's discovery launched the Gestalt revolution.* Vision Research, 40(17), 2257–2264.
- Rensink, R. A. (2002). *Change detection.* Annual Review of Psychology, 53, 245–277.
- Scholarpedia: Apparent motion — http://www.scholarpedia.org/article/Apparent_motion
- W3C WAI: Animation from Interactions (WCAG 2.3.3) — https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html
- tmux man page (`status-interval`) — https://man.openbsd.org/tmux
- dracula/tmux — https://github.com/dracula/tmux
- tmux-mem-cpu-load — https://github.com/thewtex/tmux-mem-cpu-load
- pipes.sh — https://github.com/pipeseroni/pipes.sh
- asciiquarium — https://robobunny.com/projects/asciiquarium/
- oneko (X11) — https://github.com/yoshikaw/oneko
- VS Code codicon animation — https://code.visualstudio.com/api/references/icons-in-labels#animation

*End of §10. §1–§9 will be appended above by @designer.*
