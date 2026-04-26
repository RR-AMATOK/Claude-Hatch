---
description: Play a round with your glyphling pet.
argument-hint: "[note]"
allowed-tools: Bash(glyphling play:*)
disable-model-invocation: true
---

Run `!glyphling play $ARGUMENTS` and print the resulting line verbatim.

Do not interpret, summarise, or expand on the output — the CLI already prints
a chat-friendly confirmation (e.g. `Bramble played a round. Lv 1 · :3 · 0d`).
If the command exits non-zero, surface its stderr unchanged.
