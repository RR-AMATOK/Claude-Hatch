---
description: Pause your glyphling pet (freezes neglect clock).
allowed-tools: Bash(glyphling pause:*)
disable-model-invocation: true
---

Run `!glyphling pause` and print the resulting line verbatim.

Do not interpret, summarise, or expand on the output — the CLI already prints
a short confirmation (e.g. `Bramble is now paused. Neglect clock frozen.`).
If the command exits non-zero, surface its stderr unchanged.
