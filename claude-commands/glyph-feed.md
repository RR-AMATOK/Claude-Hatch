---
# `description` (string, optional but recommended)
#   One-line summary shown in the `/` autocomplete picker. Keep it short
#   so it fits on a single row of the dropdown.
description: Feed your glyphling pet (optional flavour text after the verb).

# `argument-hint` (string, optional)
#   Placeholder text rendered after the slash command name as the user types,
#   e.g. shown as `/glyph-feed [note]`. Purely cosmetic.
argument-hint: "[note]"

# `allowed-tools` (string | string[], optional but REQUIRED for `!`-blocks below)
#   Whitelists the tool calls Claude is permitted to make while running this
#   command. Pattern syntax matches Claude Code's permission system
#   (`Bash(<glob>)`). Without this entry the user gets a permission prompt
#   on every run, which defeats the point of a one-keystroke slash command.
allowed-tools: Bash(glyphling feed:*)

# `disable-model-invocation` (boolean, optional)
#   When `true`, the model cannot invoke this command via the Skill tool —
#   only the user typing `/glyph-feed` triggers it. Recommended for
#   anything with side effects (DEC-018: feed is a state-mutating signal).
disable-model-invocation: true

# `model` (string, optional) — leave unset; we want whichever model the
# session is already on. Setting `model: haiku` would force a context switch
# every invocation and cost the user money for no gain.
---

Run `!glyphling feed $ARGUMENTS` and print the resulting line verbatim.

Do not interpret, summarise, or expand on the output — the CLI already prints
a chat-friendly confirmation (e.g. `* fed Bramble — +5 XP, mood: content`).
If the command exits non-zero, surface its stderr unchanged.
