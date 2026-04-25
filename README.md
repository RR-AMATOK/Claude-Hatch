# glyphling

> A tiny companion that grows with your code.

<p align="center">
  <img src="docs/assets/hero-idle.gif" alt="A small ASCII pet idling in a terminal" width="560">
</p>

```
   /[o-o]\
   +=|--|=+
   Pixel   · Lv 12  · [#######       ] · 420 XP
```

**glyphling** is a CLI companion that lives inside your Claude Code window. Hatch one from four different eggs, then watch it grow as you work — every commit, test, token, and file you touch feeds experience to your pet. It reacts to your streaks, picks up a personality from the languages you use, and is always just one glance away at the bottom of your terminal.

It's a small reward loop for something you already do: write code.

---

## Quick start

```bash
npm install -g glyphling
glyphling
```

<p align="center">
  <img src="docs/assets/hatch.gif" alt="Egg cracks open and a small creature emerges" width="480">
</p>

Pick an egg. Name your pet. That's it — everything after is earned.

---

## Lives in Claude Code

Drop this into `.claude/settings.json` and your pet moves into the Claude Code statusline. One line, two lines when there's something to say, zero configuration.

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

<p align="center">
  <img src="docs/assets/statusline.gif" alt="Pet blinking and breathing beneath the Claude Code prompt" width="620">
</p>

The compact renderer reads state in under 30 milliseconds. No subprocess you'll ever feel.

---

## The four eggs

Each egg hatches into a different lineage. The species you pick shapes your pet's silhouette, its accent colour, and the small effects it throws off while idling.

```
   circuit          rune            shard           bloom

   .--[o.o]--.    .-<o.o>-.        /\o.o/\       (o.o)
   |+|=||=|+|    `=|---|='         \/___\/       \==/
   '--+--+--'      `-'--'           ~  ~         //\\
```

- **circuit** — lattice kin. Reads as built, not born. Throws off sparks when it's pleased.
- **rune** — arcane script made flesh. Speaks in glyphs the moment it hatches.
- **shard** — a little crystalline thing. Catches the light.
- **bloom** — half-creature, half-garden. Grows quieter, stranger.

There's no "best" egg. None of them are rarer than the others. Pick the one that looks right to you.

---

## It cares what you do

Your pet watches the same signals you do — commits land, tests pass, tokens fly — and responds in real time.

<p align="center">
  <img src="docs/assets/coding-eat.gif" alt="Pet happily eating a token crumb" width="320">
  <img src="docs/assets/tests-happy.gif" alt="Pet bouncing when a test suite passes" width="320">
</p>

- **commits** → a small meal
- **tests passing** → a celebration
- **a long streak** → a sparkle trail
- **a fix after an error** → a visible sigh of relief
- **hours on a hard problem** → it falls asleep next to you

Neglect it and it slows down, gets quiet, then sick. The clock is honest: pause when you're away, resume when you're back. No freemium tricks, no gacha, no countdown timers designed to hurt.

---

## Personality from your code

Two pets of the same species are never the same. Your pet's temperament is a blend of eight traits — `Curious`, `Stoic`, `Energetic`, `Friendly`, `Gruff`, `Philosophical`, `Mischievous`, `Paranoid` — and the blend is computed from the real texture of your work: the languages you touch, the hours you keep, the rhythm of your commits, the way you interact with it.

A late-night Rust coder and a weekend Python poet can own the same egg and end up with visibly different pets. You'll see it in the idle animation it picks:

```
   idle-stoic         idle-chipper       idle-grumpy        idle-curious

   /[-_-]\           /[^o^]\            /[>_<]\            /[o.O]\
   +=|--|=+          +=|\/|=+           +=|__|=+            +=|--|=+
```

Your pet drifts. You will too.

---

## Share what you make

<p align="center">
  <img src="docs/assets/tier1-export.gif" alt="A Tier 1 snapshot export being produced" width="480">
</p>

```bash
glyphling export 1
```

Unlocks a short, watermarked snapshot of your pet. Drop it in a README, a tweet, a pull request — wherever.

Higher tiers unlock later: sharper resolution, longer clips, cinematic moments. Something else waits at the top. We're not going to spoil it.

(GIF export shells out to [`vhs`](https://github.com/charmbracelet/vhs) — `brew install vhs` once, then it just works.)

---

## How far does it go?

A very, very long way.

The level cap is deliberately, unreasonably distant — a number that a heavy everyday coder takes years to reach. A normal coder, longer than that. Most people will never see it, and that's fine; the point isn't to beat it. The point is that it's there, and every commit moves you a little closer.

What happens when someone does reach the top is a surprise.

---

## Accessibility & settings

A handful of environment variables let you tune glyphling to your terminal and your preferences.

- `GLYPHLING_REDUCED_MOTION=1` — calmer, shorter animation variants. Level-up flashes and other flourishes are toned down without hiding the moment itself.
- `GLYPHLING_RICH_GLYPHS=1` — opt into emoji mood glyphs instead of ASCII. Off by default because emoji cell width is unreliable across terminals.
- `GLYPHLING_TRUECOLOR=1` — opt into 24-bit colour. 256-colour is the default.
- `NO_256COLOR=1` — fall back to ANSI-16 for legacy terminals.
- `GLYPHLING_HOME=<path>` — override where state lives. Useful for trying glyphling without touching your real pet.

All are optional. The defaults are picked to be safe on the oldest terminals we could find.

---

## Philosophy

Three tenets. No exceptions.

1. **No dark patterns.** No energy meters that expire if you don't pay. No artificial scarcity. No push notifications. Your pet waits.
2. **No leaderboards.** glyphling is a personal companion, not a competitive product. Cheating mostly hurts yourself; we have some cheap integrity checks (hash-chained events, transcript cross-checks, sane daily caps) but we are not running a tournament.
3. **Your state, your machine.** Everything lives in `~/.claude/glyphling/` as plain JSON. No telemetry, no account, no network. If you delete the folder, your pet is gone — that's part of the contract.

---

## What's under the hood

- **Node.js 20+**, TypeScript (strict), Ink + React for the expanded TUI, a lock-free one-shot renderer for the statusline
- **Zero runtime network dependencies.** Everything is local files, an atomic write pattern, and a hybrid death-clock that's robust to clock skew and suspend/resume
- **GIF export** shells out to `vhs` — not an npm dependency; a one-time `brew install`
- **582+ tests** across state, XP, lifecycle, animations, adoption, rendering, and export

For the full architecture, read [`docs/architecture.md`](docs/architecture.md). For the frame vocabulary, [`docs/design/compact-frames.md`](docs/design/compact-frames.md) and [`docs/design/expanded-frames.md`](docs/design/expanded-frames.md).

---

## Install and contribute

```bash
# from source
git clone <repo>
cd hatch
npm install
npm run dev    # launches the Ink TUI against ./.dev-state/dev
npm test       # 582+ tests
```

Contributions welcome once we tag `v0.1.0`. Until then, the shape of the API is still moving. Issues and design feedback are open now.

---

## Support the project

glyphling is free, local-only, and will stay that way. If it makes your terminal a little warmer, you can buy me a coffee:

<p align="center">
  <a href="https://buymeacoffee.com/888t5ggdv6w"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-%E2%98%95-FFDD00?style=for-the-badge" alt="Buy me a coffee"></a>
</p>

[buymeacoffee.com/888t5ggdv6w](https://buymeacoffee.com/888t5ggdv6w)

---

## License

MIT.

---

<p align="center"><sub>glyphling remembers.</sub></p>
