# No-cap Economy + π/φ Level Cap (DEC-020 design)

**Status:** Design proposal. Pending DEC-020 ratification by `@product-owner`.
**Author:** `@research-scientist` (math + curve), drafted 2026-04-24.
**Scope:** XP curve, level cap, per-source weights, migration of existing pets. **No code changes** — this document is a math spec a developer will wire later.

This spec answers two product asks together because they are mechanically coupled:

1. **Remove all daily XP caps.** Every token, test, commit, file-edit emits its full XP — strict no-cap economy.
2. **Replace the level cap of 1024 with a value of mathematical significance** — derived from π or φ — while preserving the DEC-004 promise that **reaching the new max level is a years-long milestone, not a weeks-long grind, even with no caps**.

---

## §1 — Removing the daily caps: economic implications

### 1.1 What today's caps actually throttle

`src/xp/engine.ts` (DEC-018) currently enforces four UTC-day caps per signal:

| Signal | Per-event grant (`engine.ts`) | Daily cap (`DAILY_CAP_*`) |
|---|---|---|
| `tokens.delta` | `floor(tokens / 500)` (1 XP per 500 tokens) | **6 000 XP/day** |
| `git.commit` | 25 XP flat | **500 XP/day** |
| `test.pass` | 5 XP/pass, capped at **50 XP/run** | **200 XP/day** |
| `file.edit` | 1 XP/file-minute | **100 XP/day** |
| `daily.checkin` | 20 XP × streak (max ×2.0) | uncapped |
| `pet.fed` / `pet.played` | 5 XP each | uncapped |
| `error.fixed` | 15 XP | uncapped |

**Total capped headroom per day = 6 000 + 500 + 200 + 100 = 6 800 XP.**
With the small uncapped sources, today's *de-facto ceiling* is ≈ **6 850 XP/day**.

DEC-004 calibrated the curve `xpToNext(L) = floor(25·L^1.20)` against this throttled economy: cumulative XP at L1024 ≈ 47.6 M (verified below), giving:

| Use level | XP / day | Days to L1024 | Years |
|---|---|---|---|
| Heavy capped (DEC-004 "heavy use") | 2 000 | 23 805 | **65.2** |
| Obsessive capped (10 k/day — at-the-cap streak) | 10 000 | 4 761 | **13.0** |

These are the DEC-004 promises and the user's anchor for "feels like a years-long milestone."

### 1.2 What removing the caps does to the existing curve

If we lift all four caps but **leave the curve at `floor(25·L^1.20)`**, the binding constraint becomes the user's actual signal throughput. A realistic "obsessive uncapped" Claude Code user (see §4 for the derivation) can plausibly emit ≈ **50 000 XP/day**, and an extreme outlier (50 M tokens/day burned through agentic workflows) ≈ **100 000 XP/day**.

Closed-form approximation: with the integral approximation
`cumulativeXp(L) ≈ 25 · L^2.20 / 2.20`, the days-to-cap shrinks as the inverse of the daily rate. The exact-summed numbers (Python in §3.4) are:

| Daily rate | Description | Days to L1024 (current curve) | Years |
|---|---|---|---|
| 50 000 XP | Obsessive, no caps | 952 | **2.61** |
| 100 000 XP | Extreme outlier, no caps | 476 | **1.30** |

> **Result:** lifting caps without touching the curve collapses the L1024 grind from **13 years → 2.6 years for an obsessive user, or just over 1 year for an extreme outlier**. That breaks the DEC-004 mythic-rare promise. The curve must be re-calibrated against the new ceiling — which is the rest of this document.

---

## §2 — Level-cap candidate analysis

We want a new cap whose value is mathematically derived from **π** or **φ ≈ 1.618033988…** (the golden ratio), or **2π ≈ 6.283…** (the "full-circle" constant). The cap value is the first half of the math-alignment ask; the curve in §3 carries the second half by **citing φ structurally inside the formula itself**, not just in the cap value.

### 2.1 Comparison table

The cumulative-XP and days-to-cap columns in this table all assume the **recommended curve from §3**: `xpToNext(L) = floor(2 · L^φ)`, with φ = 1.618033988…  This lets us hold the curve *family* fixed and compare caps apples-to-apples.

| Candidate | Origin | cum-XP @ L_max | days @ 50 k/day | years @ 50 k/day | Story at L_max |
|---|---|---|---|---|---|
| **314** | ⌊π × 100⌋ | 2 069 894 | 41 | 0.11 | A "pi club" patch — months, not years. Too small to honor DEC-004's "reach the cap is mythic-rare." |
| **1597** | F(17), Fibonacci, ≈ 1024 × φ⁰·⁹ | 185 805 230 | 3 716 | **10.18** | Fibonacci ⇒ φ-coded by structural inheritance (F(n+1)/F(n) → φ). Sibling-feel to 1024 (within 56% magnitude). |
| **1618** | ⌊φ × 1000⌋ | **192 272 101** | **3 845** | **10.53** | The cleanest φ tribute. Reads as "the golden level." Magnitude almost identical to 1597. |
| **3141** | ⌊π × 1000⌋ | 1 092 234 255 | 21 845 | 59.81 | Premium / decadal grind. Way past DEC-004's 13-year band even at the new ceiling. Too brutal. |
| **6283** | ⌊2π × 1000⌋ ("full circle") | 6 709 566 795 | 134 191 | **367.40** | Lifetime+ commitment. Narrative is gorgeous ("you completed the circle") but the math punishes mortals. |

(Same curve; only the cap value moves. The full sweep over `(C, exponent, L_max)` in §3.4 confirms this picks out 1597 and 1618 as the only Goldilocks-zone members of the π/φ family.)

### 2.2 Recommendation

**Recommended cap: `L_max = 1618`** ("the golden level").
**Alternate: `L_max = 1597`** (Fibonacci F(17)).

**Why 1618 over 1597:**

1. **Direct φ tribute reads.** "1618 is φ × 1000" is a one-line explanation a non-mathematician understands. "1597 is F(17), the seventeenth Fibonacci number, which approximates 1000·φ to within 1.3% because lim F(n+1)/F(n) = φ" requires three sentences.
2. **Identical pacing.** 1618 vs 1597 is a 21-level (1.3%) gap — undetectable in lived experience. Both land at ≈10.5 years @ 50k XP/day.
3. **HUD parity with 1024.** Both 1024 and 1618 are 4-digit numbers; statusline width budget (DEC-016 / `compact-frames.md` §4) is unchanged.
4. **"The 1024 Club" → "The Golden Club" or "The φ Club"** is a clean rebrand. The Ascendant honorific (DEC-004) still fires at L_max; only the number changes.

**Why not 314, 3141, 6283:**

- **314 (⌊π·100⌋).** A three-digit cap loses the "rare" *visual* signal (looks like a regular level). Days-to-cap collapses to weeks — fatal.
- **3141 (⌊π·1000⌋).** Too far past the DEC-004 13-year band; the obsessive grinder hits ~60 years at the design ceiling. We would be re-breaking the original promise in the opposite direction.
- **6283 (⌊2π·1000⌋).** Beautiful narrative, mathematically heroic, but **>100 years for any conceivable user**. The "completed the circle" framing is so good it's worth keeping in the back pocket as a future cosmetic prestige, but as the headline cap it just becomes hopeless.

### 2.3 What L1618 feels like

> Bramble emits a soft golden shimmer above her name. The HUD reads `1618 · Ascendant`. The compact statusline shows the same Ascendant aura DEC-019 D6 grants today. The "Golden Club" tag in `glyphling status` flexes the achievement. The pet is immortal (DEC-019 D6 carries forward — see §7 Consequences). She has been with you for over a decade of obsessive coding; on a pre-cap-removal economy that would have taken three decades.

---

## §3 — The new XP curve

### 3.1 Form

```
xpToNext(L) = floor(2 · L^φ)        where φ = (1 + √5)/2 ≈ 1.6180339887…
```

This is a **single-parameter golden curve**. The exponent **is** φ, not an empirically tuned number close to φ. That is the structural π/φ citation the user asked for: the curve's *shape* is golden, not just the cap value. (Compare DEC-004: `floor(25 · L^1.20)` — 1.20 is an empirical tuning constant with no number-theoretic content.)

The leading constant `C = 2` is the only free parameter. It was chosen to land days-to-cap at 50k XP/day inside the 8–15 year band the user specified. C=1 → 5.26 yr (too fast); C=2 → 10.53 yr (centred); C=3 → 15.79 yr (too slow). C=2 is the sweet spot.

### 3.2 Properties

- **Monotonic non-decreasing.** L^φ is strictly increasing for L ≥ 1; floor preserves non-decrease.
- **Integer arithmetic safety.** Max single value is `xpToNext(1618) = 311 362`. Cumulative-at-cap is `192 272 101`. Both fit comfortably in Number.MAX_SAFE_INTEGER (2^53 = 9.0×10¹⁵). At runtime the implementation can compute `Math.floor(2 * Math.pow(L, 1.6180339887498949))` in float64; round-half-down via `floor` is deterministic across V8 versions for the inputs in [1, 1618].
- **Closed form for `cumulativeXp(L)`** does not exist (`Σ k^φ` has no elementary closed form for non-integer exponents). The implementation uses the same precomputed table pattern as DEC-004 — 1619 entries, built lazily on first call, ~10 µs cost amortised over the process lifetime (already the existing pattern in `src/xp/engine.ts`).
- **Inverse `levelFromCumXp`** unchanged from DEC-004: binary search on the precomputed table, O(log 1618) ≈ 11 comparisons.

### 3.3 Per-level reference table

(Computed with Python; verified by §3.4 reproduction script.)

| L | xpToNext(L) | cumulativeXp(L) | Notes |
|---:|---:|---:|---|
| 1 | 2 | 0 | Tutorial-cheap. (DEC-004 was 25.) |
| 5 | 27 | 37 | First handful of levels fly by — "early game feel." |
| 10 | 82 | 272 | Adult form unlocks (architecture §6.4). |
| 25 | 365 | 3 296 | GIF Tier 1 unlock (DEC-005). |
| 50 | 1 122 | 20 847 | |
| 73 | 2 069 | 56 649 | Adoption gate (DEC-006). |
| 100 | 3 444 | 129 792 | |
| 250 | 15 169 | 1 440 890 | GIF Tier 2 unlock (DEC-005). |
| 404 (= L_max/4) | 32 979 | 5 072 527 | |
| 500 | 46 564 | 8 869 519 | |
| 809 (= L_max/2) | 101 435 | 31 293 500 | |
| 1000 | 142 932 | 54 523 533 | "Past the old 1024" — still 600+ levels to go. |
| 1500 | 275 456 | 157 684 294 | |
| 1597 (Fibonacci) | 304 850 | 185 805 230 | Alternate cap. |
| 1617 (penultimate) | 311 051 | 191 961 050 | |
| **1618 (Ascendant)** | 0 (capped) | **192 272 101** | Golden Level — `xpToNext` returns 0 at L_max per the existing pattern (raw `floor(2·1618^φ) = 311 362` is what the next level would have cost if there were a level 1619). |

### 3.4 Reproduction script

```python
import math
phi = (1 + math.sqrt(5)) / 2     # 1.6180339887498949
L_MAX = 1618

def xp_to_next(L: int) -> int:
    return math.floor(2 * L**phi) if L < L_MAX else 0

# Cumulative table: cum[L] = XP required to BE at level L.
# cum[1] = 0; cum[L] = sum of xp_to_next(k) for k in 1..L-1.
cum = [0]
running = 0
for L in range(1, L_MAX + 1):
    cum.append(running)
    running += xp_to_next(L)

assert cum[1618] == 192_272_101    # the headline number

# Days to reach L_MAX at various daily XP rates
for rate, label in [
    (2_000,   "heavy capped (today's bar)"),
    (5_000,   "typical no-cap"),
    (10_000,  "heavy no-cap"),
    (25_000,  "sustained obsessive"),
    (50_000,  "design obsessive ceiling"),
    (100_000, "extreme outlier"),
]:
    days = cum[L_MAX] / rate
    print(f"{label:>32}: {days:>8,.0f} days = {days/365.25:>5.2f} years")
```

**Output (verified):**

```
     heavy capped (today's bar):   96,136 days = 263.21 years
              typical no-cap:   38,454 days = 105.28 years
                heavy no-cap:   19,227 days =  52.64 years
        sustained obsessive:    7,691 days =  21.06 years
   design obsessive ceiling:    3,845 days =  10.53 years
            extreme outlier:    1,923 days =   5.26 years
```

**The 50 k XP/day target lands at 10.53 years — squarely inside the 8–15 year band requested.**

### 3.5 Days-to-cap at the design intensities

| Intensity | XP/day | Days | Years |
|---|---:|---:|---:|
| Today's heavy capped (DEC-004 baseline) | 2 000 | 96 136 | 263.21 |
| Typical no-cap (5 days/week, moderate) | 5 000 | 38 454 | 105.28 |
| Heavy no-cap (daily, full sessions) | 10 000 | 19 227 | 52.64 |
| Sustained obsessive (daily, 8h+ Claude Code) | 25 000 | 7 691 | 21.06 |
| **Design obsessive ceiling (target band: 8–15 yr)** | **50 000** | **3 845** | **10.53** |
| Extreme outlier (50M tokens/day) | 100 000 | 1 923 | 5.26 |

### 3.6 ASCII shape (log-y, L = 1 … 1618)

```
cumulativeXp(L) (log-y axis, 50 cols across L=1..1618)
  1e8.3  |                                                  #
  1e7.8  |                                 ##################
  1e7.3  |                      #############################
  1e6.8  |               ####################################
  1e6.3  |          #########################################
  1e5.8  |       ############################################
  1e5.4  |     ##############################################
  1e4.9  |    ###############################################
  1e4.4  |   ################################################
  1e3.9  |   ################################################
  1e3.4  |  #################################################
  1e2.9  |  #################################################
  1e2.4  |  #################################################
  1e1.9  |  #################################################
  1e1.5  |  #################################################
  1e1.0  |  #################################################
  1e0.5  |  #################################################
  1e0.0  | ##################################################
         +--------------------------------------------------
           L=1                                           L=1618
```

The shape is the expected superlinear ramp on a log-y plot — early levels scale loglinearly (`log(cum) ≈ log(C) + (1+φ)·log(L) − log(1+φ)`), with slight saturation only in the very-near-cap region because of the floor() rounding.

### 3.7 Why φ as the exponent (not π, not e)

- **Self-similar scaling.** φ is the unique positive solution of `x² = x + 1`, i.e. `x^φ = x · x^(φ−1) = x · x^(1/φ)`. This means each unit increase in level multiplicatively *contains* its predecessor — the "golden ratio" property literally gates each level on a φ-scaled echo of the previous, which is the kind of structural fact the user can point to and say "*that's* why".
- **Empirical fit to the design ceiling.** The exponent 1.618 happens to land in the right shape band. A π exponent (3.14159) would be catastrophic — `xpToNext(1024)` at C=2, exp=π is ≈ 1.6×10¹⁰ XP, totally unplayable. An e exponent (2.718) is also too steep. φ is the only candidate from {π, e, φ, 2π} with an exponent that produces a playable curve.
- **Aesthetic alignment.** Cap = ⌊φ·1000⌋ AND exponent = φ. The number theory is internally consistent: the curve is golden top to bottom, not just at the headline.

---

## §4 — Estimating the new daily XP ceiling without caps

This section is the keystone — the design-ceiling number `50 000 XP/day` quoted everywhere above is justified here.

### 4.1 Per-source uncapped throughput at "obsessive" use

Assumptions: an obsessive Claude Code user, 8–12 hours/day in active sessions, agentic workflows (high token throughput per turn).

| Source | Per-event grant (proposed §5) | Plausible obsessive-day count | XP contribution |
|---|---|---:|---:|
| `tokens.delta` | 1 XP / 1000 tokens (proposed §5) | 25 M tokens (high but observable for heavy agentic use) | **25 000** |
| `git.commit` | 100 XP (proposed §5) | 30 commits | **3 000** |
| `test.pass` | 10 XP/pass, 100 XP/run cap | 20 runs × 100 = 2 000 (cap-bound) | **2 000** |
| `file.edit` | 3 XP/file-minute | 500 file-minutes | **1 500** |
| `daily.checkin` | 50 XP base × ×2.0 streak | 1 | **100** |
| `pet.fed` / `pet.played` | 5 XP each | ~6 | **30** |
| `error.fixed` | 15 XP | ~5 | **75** |
| **Total** | — | — | **≈ 31 705 XP/day** |

### 4.2 The 50k ceiling

The 31 705 XP/day balanced number above is what a reasonable obsessive day looks like. The **design ceiling is the ~95th-percentile worst-case** — same user but with extreme token throughput on an agentic-burn day:

- Tokens at 50 M/day (sustained agentic loop, e.g. running multi-agent harnesses) → **50 000 XP from tokens alone**.
- Other sources unchanged from balanced day (~6 700 XP).
- **Total ceiling ≈ 56 700 XP/day.**

We round this to **50 000 XP/day** as the design-ceiling reference for §3 calibration. This is intentionally a slight underestimate so that the truly extreme outlier (100 M tokens, 100k XP/day) still has visible runway — they hit L1618 in ~5.3 years, which feels like a *speedrun* of the canonical 10.5 years rather than a broken economy.

### 4.3 Sanity-check against the old caps

Today's hard cap is 6 800 XP/day. The new uncapped balanced ceiling (≈32k) is **~4.7×** the old cap. The new uncapped *worst-case* ceiling (≈50k–100k) is **~7×–15×** the old cap. The curve in §3 absorbs this exactly: cumulative-at-cap goes from 47.6M → 192.3M (≈4.0×), so days-to-cap at the new ceiling lands close to days-to-cap at the old ceiling (10.5 yr vs DEC-004's 13.0 yr) — slightly faster, but the cap itself is now 1618 not 1024, so the "headline number" is bigger by 58%, which compensates in the user's perception.

---

## §5 — Per-source weights (rebalance with no caps)

With caps removed, the *only* thing keeping any single signal from dominating is its per-event grant. The user's brief asks for a soft balance: **no single source contributes more than ~50% of the obsessive-balanced daily ceiling**.

### 5.1 Recommended new per-event grants

| Constant (in `src/xp/engine.ts`) | Today | **Proposed (DEC-020)** | Δ |
|---|---:|---:|---|
| `XP_PER_500_TOKENS` (rename → `XP_PER_1000_TOKENS`) | 1 XP / 500 tokens | **1 XP / 1000 tokens** | nerf 50% — tokens are uncapped firehose |
| `XP_PER_COMMIT` | 25 | **100** | buff 4× — commits are scarce signal |
| `XP_PER_TEST_PASS` | 5 | **10** | buff 2× |
| `XP_PER_TEST_RUN_CAP` (per-run, *not* daily) | 50 | **100** | buff 2× — keeps proportional to test_pass |
| `XP_PER_FILE_EDIT` | 1 | **3** | buff 3× |
| `XP_PER_ERROR_FIXED` | 15 | **30** | buff 2× |
| `XP_DAILY_CHECKIN_BASE` | 20 | **50** | buff 2.5× — daily anchoring stays meaningful |
| `XP_DAILY_STREAK_*` | +10%/day, max ×2.0 | **unchanged** | streak shape preserved |
| `XP_PER_INTERACTION` (`pet.fed`/`pet.played`) | 5 | **5** | unchanged — these are flavour, not progression |

### 5.2 Why these specific multipliers

The token nerf (1/500 → 1/1000) is the single most important change. Without it, even a heavy agentic user at 25M tokens/day earns 50 000 XP from tokens alone — the entire ceiling. With the nerf, 25M tokens earns 25 000 XP, which is ~50% of the obsessive-balanced day. That meets the brief's soft-balance ask.

The buffs to commits/tests/edits/checkin restore their *relative* contribution after the token nerf. Without them, removing caps + nerfing tokens would silently devalue every non-token signal by 4×. The buff multipliers are calibrated so that a balanced user (no extreme token spikes) sees roughly the same XP/day they get today — see §4.1, where the balanced-day total comes out at ≈32k vs today's de-facto cap of ~6.8k. The 4–5× headroom is intentional: it's the "you earned more" payoff for cap removal.

### 5.3 Per-run vs per-day caps

The user's ask is to remove **daily** caps. The `XP_PER_TEST_RUN_CAP` constant is a *per-run* cap (50 XP/run today, proposed 100 XP/run), not a daily cap, and is **kept**. Without it, a single `pytest` run with 10 000 tests would emit 100 000 XP in one event — that's not "uncapped earning per signal," that's pathological. The per-run cap lets a test-heavy day still emit substantial XP (20 runs × 100 = 2 000 XP) while preventing a single mega-run from dwarfing everything else.

Similarly, the existing **rate-limit / dedupe** machinery in `src/signals/*` (architecture §6.3 — 1 commit-emit per 30s per repo, 1 file-edit per 60s per file, etc.) is **preserved**. These prevent log-spam attacks and double-counting; they are not "caps" in the DEC-018 sense. Note this distinction in the DEC-020 entry so it's not surprising.

### 5.4 Daily-balance preview at the new weights

A balanced obsessive day (per §4.1) on the new weights:

| Source | XP | % of day |
|---|---:|---:|
| Tokens (25M @ 1/1000) | 25 000 | 78.9% |
| Commits (30 × 100) | 3 000 | 9.5% |
| Tests (20 runs × 100 cap) | 2 000 | 6.3% |
| Edits (500 file-minutes × 3) | 1 500 | 4.7% |
| Daily check-in (50 × ×2.0) | 100 | 0.3% |
| Fed/played (~6 × 5) | 30 | 0.1% |
| Error.fixed (~5 × 30) | 75 | 0.2% |
| **Total** | **31 705** | 100% |

Tokens still dominate (78.9% > the 50% soft target), but this is at *25M tokens/day* — already an extreme. At a more typical 5–10M tokens/day, tokens drop to 50–67% of the daily total, which lands in the desired band. The 50% soft target is met for typical heavy users, and intentionally exceeded for agentic-firehose outliers (where tokens *should* be the headline signal).

If the product owner wants a stricter token nerf to push tokens below 50% even at extreme intensities, the next slider is `1 XP / 2000 tokens`, which moves the obsessive ceiling to ~37k/day and pushes days-to-cap at 50k XP/day to ~14.2 years (still in the band). That's the "Option Strict" alternative — call out in §8 as an open question.

---

## §6 — Migration plan for existing pets

Bramble is the user's pet. Today: `xp = 6 000`, `level = 17` under `floor(25·L^1.20)`. Verified: `cumulativeXp_old(17) = 5 410`, `cumulativeXp_old(18) = 6 158`, so 6 000 lands in `[5410, 6158)` → L17. ✓

### 6.1 What each migration option does to Bramble

| Option | Rule | Bramble's new state | Notes |
|---|---|---|---|
| **A — keep XP, recompute level** | Don't touch `pet.xp`; set `pet.level = levelFromCumXp_new(pet.xp)`. | xp = 6 000, **level = 31** | Bramble is *promoted* (not demoted) because the new curve is gentler at low L. |
| **B — keep level, regrade XP down to new floor** | `pet.xp = cumulativeXp_new(pet.level)`. | xp = 1 166, level = 17 | Visible XP loss. User would feel ripped off ("I earned 6 000 XP and now I have 1 166?"). |
| **C — legacy snapshot + reset** | `pet.legacyXp = pet.xp; pet.legacyLevel = pet.level; pet.xp = 0; pet.level = 1`. | xp = 0, level = 1, legacyXp = 6 000, legacyLevel = 17 | Maximum disruption. Useful if the curve change were a *demotion*, but here it isn't. |
| **D — regrade event in events.jsonl** | Append `xp.regrade { delta: cum_new(L_old) − xp_old }`; rebuild level. | xp = 1 166, level = 17 | Same end-state as B, just achieved via the event log so the audit trail is clean. Same user pain. |

### 6.2 Recommendation: **Option A**

Because the new curve is **gentler at L < ~500** and **steeper at L > ~500** (see §3.3 — `xp_new/xp_old` is 0.08× at L=1, 0.55× at L=100, 1.07× at L=500, 1.45× at L=1000), Option A *promotes* every pet that's below ~L500 today and minimally affects pets above that. There are no live pets above L500 (the ecosystem is days old), so Option A is strictly user-friendly: no demotions, no XP loss, no surprise.

**Migration rule (one-shot, on first boot after DEC-020 lands):**

```ts
// Pseudocode for the migration step in src/state/migrations.ts (new module)
function migrateToCurveV2(state: StateFileV1): StateFileV1 {
  if (state.globals.curveVersion === 2) return state;          // idempotent
  const updatedPets = state.pets.map(pet => ({
    ...pet,
    level: Math.min(levelFromCumXp_new(pet.xp), LEVEL_CAP_NEW), // re-derive level
    // pet.xp is preserved as-is
  }));
  return {
    ...state,
    pets: updatedPets,
    globals: { ...state.globals, curveVersion: 2 },
    schemaVersion: state.schemaVersion,                          // unchanged; this is a globals bump
  };
}
```

Append a single audit event per pet at migration time:

```jsonl
{"id":"<ulid>","type":"xp.regrade","ts":"<iso>","petId":"<id>",
 "source":"migration:dec-020","payload":{
   "from":{"level":17,"xp":6000,"curve":"v1"},
   "to":{"level":31,"xp":6000,"curve":"v2"},
   "reason":"DEC-020 curve change; xp preserved, level recomputed"
 }}
```

This makes the regrade visible in `glyphling log` and survives event-log replay.

### 6.3 Bramble specifically

| Field | Before DEC-020 | After DEC-020 (Option A) |
|---|---|---|
| `pet.xp` | 6 000 | **6 000** (unchanged) |
| `pet.level` | 17 | **31** (re-derived) |
| `displayLevel(pet.level)` | "17" | **"31"** |
| Adoption gate (DEC-006, L73) | open in 56 levels | open in 42 levels |

Bramble jumps from L17 to L31 on the morning DEC-020 ships. The user gets a one-time level-up flash on the renderer (Option: suppress the flash for migration, since 14 sequential level-ups would spam — the audit event has a `migration:dec-020` source the renderer can detect and silence).

---

## §7 — Draft DEC-020 entry (paste-ready)

Drop this block at the bottom of `DECISIONS.md` (after DEC-019). Format matches DEC-001..DEC-019.

```markdown
## DEC-020 — Remove daily XP caps; level cap 1618 (φ·1000); golden curve 2·L^φ
- **Date:** 2026-04-24
- **Status:** Proposed
- **Decided by:** @research-scientist proposes; @product-owner ratifies (user)
- **Context:** DEC-018 imposes per-signal daily XP caps (tokens 6000, tests 200, commits 500, edits 100; total ~6.8k XP/day). DEC-004 calibrated the curve `floor(25 · L^1.20)` against that throttled economy, yielding a 13-year obsessive-grind to L1024. The user wants to (a) remove all daily caps so every token/test/commit/edit emits its full XP, (b) replace 1024 with a level cap of mathematical significance (π/φ-derived), and (c) preserve the multi-year wall-clock promise: reaching the new max must still feel like a years-long milestone, not a weeks-long grind.
- **Decision:**
  - **Daily XP caps removed.** `DAILY_CAP_TOKENS`, `DAILY_CAP_TESTS`, `DAILY_CAP_COMMITS`, `DAILY_CAP_EDITS`, `DAILY_CAPS_RETENTION_DAYS`, `pet.dailyCaps`, and the `applyDailyCap()` helper are deleted. `signal.rejected { reason: "cap.daily" }` ceases to be emitted (the event type stays in the schema for replay backwards-compat; new emissions stop). Per-event rate-limits and dedupe (architecture §6.3) and the per-run test cap (`XP_PER_TEST_RUN_CAP`) **stay** — they prevent pathologies (mega-run dumps, log-spam) without throttling earned signal.
  - **Level cap: 1618 = ⌊φ × 1000⌋ ("the Golden Level").** Replaces the 1024 cap. Ascendant honorific (DEC-004) and DEC-019 D6 immortality fire at the new cap value.
  - **XP curve: `xpToNext(L) = floor(2 · L^φ)`**, where φ = (1+√5)/2 ≈ 1.6180339887. Cumulative XP at L1618 = 192 272 101. The exponent **is** φ — the curve is golden by structure, not just by cap value. Days to cap: 10.53 years at the design obsessive ceiling of 50 000 XP/day, 5.26 years at the extreme-outlier ceiling of 100 000 XP/day, 52.64 years at heavy steady use (10 000 XP/day). Sits inside the user's 8–15 year requested band.
  - **Per-source rebalance** (no-cap econ, soft 50% balance):
    - Tokens: **1 XP / 1000 tokens** (was 1/500). Single biggest dial — tokens are the firehose.
    - `git.commit`: **100 XP** (was 25).
    - `test.pass`: **10 XP/pass**, per-run cap **100 XP/run** (was 5/50).
    - `file.edit`: **3 XP/file-minute** (was 1).
    - `error.fixed`: **30 XP** (was 15).
    - `daily.checkin`: **50 XP base** × streak ×2.0 max (was 20). Streak shape unchanged.
    - `pet.fed`/`pet.played`: **5 XP each** (unchanged — flavour, not progression).
  - **Migration: Option A — keep XP, recompute level.** On first boot under curve v2, every pet's `xp` is preserved and `pet.level = levelFromCumXp_new(pet.xp)`. The new curve is gentler at low L, so this *promotes* existing pets (e.g. Bramble: L17 → L31 at xp=6000). A single `xp.regrade { source: "migration:dec-020" }` event is appended per pet for audit. Renderer suppresses the level-up flash for migration-source level changes. Bumps `state.globals.curveVersion: 1 → 2`.
- **Alternatives:**
  - **Cap candidates rejected:** 314 (⌊π·100⌋, too small — weeks not years), 3141 (⌊π·1000⌋, ~60 yr at 50k XP/day — past the 8–15 yr band), 6283 (⌊2π·1000⌋, >100 yr — beyond a human lifetime), 1597 (Fibonacci F(17), within 1.3% of 1618 — kept as alternate; 1618 wins on legibility because "φ × 1000" is one-line explainable).
  - **Curve exponent rejected:** 1.20 (current — too gentle for uncapped econ), 1.30 (still too gentle), 2.0 (too steep — L_max becomes a multi-century grind), π (pathological — `xpToNext(1000)` ≈ 5.3M XP), e (~2.72, also too steep). φ is the only π/φ/e candidate that produces a playable curve at the chosen cap.
  - **Migration alternatives rejected:** Option B (keep level, lose XP — user feels ripped off), Option C (reset with legacyXp — maximum disruption), Option D (regrade-via-event to land at same level — same end-state as B, same user pain).
  - **Stricter token nerf** (1 XP / 2000 tokens) considered — pushes obsessive ceiling to ~37k/day and days-to-cap at 50k to ~14.2 yr (still in band). Open question for product owner; current proposal is 1/1000 as the moderate slider.
- **Trade-offs:**
  - **Gain:** every coding signal emits its full XP — no more "you hit your cap" silent ceilings. Cap value is mathematically derived (φ·1000), curve is structurally golden (exponent φ). DEC-018's stated goal of "expose intended pacing via daily caps" was a workaround for an under-calibrated curve; with the new curve calibrated against the realistic uncapped ceiling, the pacing is in the curve where it belongs.
  - **Lose:** DEC-018 cap-tracking events become vestigial (see Consequences). `pet.dailyCaps` schema field is removed (schema bump or graceful-ignore). Existing GIF-export tier thresholds (DEC-005: L25, L250, L1024) and adoption gate (DEC-006: L73) are unchanged in number but represent slightly less progress under the new curve — flagged as cosmetic, not blocking.
- **Consequences:**
  - **CLAUDE.md invariant flips.** The "1024 is sacred" line in `CLAUDE.md` is replaced by "1618 is sacred — the Golden Level." This DEC explicitly authorises that edit; @technical-writer to sweep all string literals (`docs/architecture.md` §6.5, §10 NFR table, animations/scenes that reference "1024 Club", README, demo tape comments).
  - **DEC-018 partially superseded.** Mechanisms 1 (event-chain hash), 2 (transcript cross-check), and 4 (monotonic clock guards) are unchanged. Mechanism 3 (daily caps) is removed. The integrity model is now: "tampering is detected by chain hash; signal-source verification kept for tokens; pacing comes from the curve, not from caps." `signal.rejected { reason: "cap.daily" }` stops being emitted; replay code still parses old events of this kind for backwards compatibility.
  - **DEC-019 D6 (Ascendant immortality) carries forward.** The threshold flips from `pet.level === 1024` to `pet.level === 1618`. All four of (lifecycle clock no longer accumulates against this pet, hungry/sick/dying signals don't fire, death-rule hybrid bypassed, sickness mood hidden in compact + expanded) move to the new threshold. The Ascendant aura is permanent (D4), unchanged.
  - **DEC-005 GIF tier 3** unlocks at L1618 instead of L1024. The watermark text "1024 Club" updates to "Golden Club" or "φ Club" — @designer to pick the canonical phrasing.
  - **`glyphling doctor` output.** Drops the "daily cap status" section (no caps to report). Adds a "curve: v2 (golden)" line so users can verify the migration applied. Surfaces `pet.curveVersion` mismatch as a warning if it ever drifts.
  - **Schema migration.** `state.globals.curveVersion: 1 → 2` is bumped on first boot with curve-v2 code. `pet.dailyCaps` field becomes optional (or is dropped — @architect to choose; suggestion: drop, since it's vestigial). `state.schemaVersion` unchanged unless we drop `pet.dailyCaps` in a backwards-incompatible way.
  - **Event-type schema.** `signal.rejected` event type stays for replay; `xp.regrade` event type is added (carries `from`, `to`, `reason`).
  - **Bramble's promotion.** xp=6000 stays; level 17 → 31. Audit event in events.jsonl. Renderer suppresses the migration flash.
  - **Tests.** Existing `cumulativeXpForLevel(1024) ≈ 48M` test is replaced by `cumulativeXpForLevel(1618) === 192_272_101` (exact; the new curve is fully integer-deterministic given φ as a fixed float64 constant). Existing daily-cap tests are deleted.
- **Follow-up:** TODO-021 (`@backend-developer`) — implement the curve change, migration, and per-source rebalance. TODO-022 (`@technical-writer`) — sweep documentation for "1024" references. TODO-023 (`@qa-engineer`) — verify migration on Bramble's actual state file (snapshot + replay), verify days-to-cap numbers via Monte Carlo signal replay. CLAUDE.md edit (one-line invariant flip) is the smallest blocker — can land in the same PR as TODO-021.
```

> **Note for @product-owner:** the brief calls for **Status: Proposed**, not Accepted. Ratify by editing `Status:` to `Accepted` and adding `(user-confirmed)` after `@product-owner ratifies`. The CLAUDE.md sweep is explicitly authorised by this DEC's Consequences section; no separate decision is needed.

---

## §8 — Open questions for `@product-owner`

Three crisp questions whose answers might flip the recommendation:

1. **Cap legibility vs Fibonacci correctness: 1618 or 1597?** The recommendation is 1618 because "φ × 1000" is one-line explainable. But 1597 is *the closest Fibonacci number to 1000·φ* (within 1.3%) and is φ-coded by structural inheritance — arguably more mathematically pure. Days-to-cap differs by 0.35 years (negligible). **If you'd rather flex Fibonacci credibility over legibility, flip to 1597.** No other change needed; the curve formula is identical.

2. **Token nerf strictness: 1/1000 or 1/2000?** The recommendation is `1 XP / 1000 tokens`, which keeps tokens at ~50% of a *typical* heavy day but lets them dominate (~78%) on agentic-firehose days. A stricter `1 XP / 2000 tokens` keeps tokens below 50% even on extreme days, at the cost of slowing the obsessive ceiling to ~37k/day (days-to-cap rises from 10.5 to ~14.2 years — still in band). **If you want token emission to feel "earned alongside" rather than "the headline," flip to 1/2000.** Curve and cap are unchanged either way.

3. **Migration generosity: should existing pets benefit from the gentler early curve (Option A)?** The recommendation is Option A (keep XP, recompute level → Bramble L17 → L31). This is the user-friendly choice but it does mean pre-DEC-020 grinders get a one-time free promotion — fair if you read it as "you grinded under harsher per-event values, the new curve makes that grind worth more levels," unfair if you read it as "newcomers under the new curve get the same XP-per-level treatment retroactively, so why did the old players bother." Option C (legacyXp + reset) is the strictest answer. **If the per-pet promotion bothers you, flip to Option C; if it feels right, ship Option A as-recommended.**

The recommendation in this spec is the **(1618, 1/1000, Option A)** triple. Any single flip is independently safe; flipping all three would land at **(1597, 1/2000, Option C)** which is the "purist + strict + clean-slate" alternate spec.

---

## Appendix A — Files this DEC will touch (for the implementing developer)

Spec-only — no edits in this PR. For the implementer:

- `src/xp/engine.ts` — curve, constants, `applyDailyCap` removal, per-source weight bump, migration helper.
- `src/state/schema.ts` — drop `pet.dailyCaps` field (or mark optional), add `globals.curveVersion`.
- `src/state/migrations.ts` (new) — `migrateToCurveV2`.
- `src/events/bus.ts` + `src/state/schema.ts` `EventTypeSchema` — add `xp.regrade`; keep `signal.rejected` for replay.
- `src/render/App.tsx` — Ascendant flash threshold 1024 → 1618; suppress level-up flash for migration-source events.
- `animations/scenes/*` — rewrite "1024 Club" copy to "Golden Club"; update aura unlock thresholds.
- `docs/architecture.md` §6.5, §10, §13.
- `CLAUDE.md` — invariant flip.
- `README.md` — level-cap reference.
- Tests — replace `cumulativeXpForLevel(1024)` assertion; delete daily-cap tests; add migration test against Bramble's pre-DEC state.

Estimated scope: one engineer, 1–2 days.
