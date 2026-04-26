---
description: Rename your glyphling pet.
argument-hint: "<new-name>"
allowed-tools: Bash(glyphling name:*)
disable-model-invocation: true
---

Run `!glyphling name $ARGUMENTS` and print the resulting line verbatim.

Do not interpret, summarise, or expand on the output — the CLI already prints
a short confirmation (e.g. `Bramble is now Sparky.`).
If the command exits non-zero, surface its stderr unchanged.
