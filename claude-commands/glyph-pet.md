---
description: Scritch your glyphling pet (optional flavour text after the verb).
argument-hint: "[note]"
allowed-tools: Bash(glyphling pet:*)
disable-model-invocation: true
---

Run `!glyphling pet $ARGUMENTS` and print the resulting line verbatim.

Do not interpret, summarise, or expand on the output — the CLI already prints
a chat-friendly confirmation (e.g. `You scritched Bramble. ♥`).
If the command exits non-zero, surface its stderr unchanged.
