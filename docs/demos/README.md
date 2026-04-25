# Demo GIF authoring

Every GIF under `docs/assets/` must be produced by `scripts/record-demo.sh`.
Nothing else. The wrapper scrubs the host environment so the recording
cannot leak `$HOME`, `$USER`, hostname, or the project path.

## Why this exists

The pre-v0.1.0 GIF batch was recorded with an un-sandboxed `vhs` run and
captured the author's macOS home path (`/Users/<name>/…/Claude-Tamagotchi`)
in the terminal's working-directory indicator. Those assets were purged
from git history. This policy prevents a repeat.

## The rules

1. **One recording path.** Use `npm run demo:record -- <tape>`. The wrapper
   runs `vhs` under `env -i` with a synthetic `HOME=$TMPDIR/...`,
   `USER=glyphling`, `HOSTNAME=glyphling-demo`, and `PS1='$ '`.
2. **Tapes are linted.** `scripts/check-tapes.sh` rejects absolute home
   paths, `$HOME`/`$USER` references, and the iCloud prefix. The wrapper
   runs it first; CI runs it on every PR via `npm run demo:lint`.
3. **No trust in the host shell.** Tapes must not rely on the user's
   `.zshrc`/`.bashrc`. The sandbox starts with no profile loaded. If you
   need a shell primitive, write it into the tape's `Type` directive.
4. **Output lands where we say.** Tapes use a cwd-relative
   `Output <name>.gif`. The wrapper copies the result to
   `docs/assets/<tape-basename>.gif` (or `--out <path>`).

## House style (fixes the "boxed / zoomed-in" look)

Every tape MUST begin with this header. Deviations need a reason in the
PR description.

```
# --- glyphling house style ---
Set Shell "sh"
Set WindowBar ""           # no title-bar chrome
Set Margin 0
Set Padding 20
Set Theme "GruvboxDark"    # consistent palette across all demos
Set FontSize 14            # README-readable, not magnified
Set TypingSpeed 50ms
Set PlaybackSpeed 1.0
Set Framerate 24
# --- per-tier dimensions (choose one) -----------------------------------
# statusline tier:  Set Width 960  Set Height 80
# standard tier:    Set Width 960  Set Height 240
# wide / TUI tier:  Set Width 1280 Set Height 360
```

Notes on each directive:

- `WindowBar ""` — removes the decorative title-bar that made the old
  GIFs look "boxed". The pet is the product; the chrome is noise.
- `FontSize 14` — default is 22, which magnifies a 3-row TUI to the
  point of cartoonish. 14 keeps the art crisp at README embedding widths.
- `Theme "GruvboxDark"` — deliberately neutral. Dracula's purple clashed
  with the species accents (rune is purple).
- `Shell "sh"` — no zsh/bash profile loading. The sandbox has neither
  installed anyway; declaring it makes the tape portable.

## Running a recording

```
brew install vhs
npm run build
npm run demo:record -- docs/demos/tapes/hero-idle.tape
# → writes docs/assets/hero-idle.gif
```

To lint every tape in the repo:

```
npm run demo:lint
```

## What the wrapper guarantees

- The `vhs` process sees a scrubbed `PATH` (only the dirs hosting `vhs`
  and `node`, plus `/usr/bin:/bin`). No `~/.local/bin`, no Homebrew-site
  helpers that might print the host user in their banners.
- `GLYPHLING_HOME` points at a throwaway tmpdir — the recording never
  reads or writes `~/.claude/`.
- `HOME` is a fresh tmpdir. The sandbox shell cannot `cd ~` into the
  author's real home and accidentally render its path.
- The sandbox is `rm -rf`'d on exit. Nothing about the recording run
  persists outside the final `.gif`.

## What the wrapper does NOT guarantee

- It does **not** OCR the final GIF. A tape that explicitly `Type`s the
  string `/Users/whoever/...` will still render that string — the
  lint catches it in the tape source, not in pixels. Keep tape text
  relative or sandbox-absolute (`$HOME` expands to the sandbox).
- It does **not** validate the house-style header. Reviewers enforce it
  in PR review. (Future: add to `check-tapes.sh` if drift becomes real.)
