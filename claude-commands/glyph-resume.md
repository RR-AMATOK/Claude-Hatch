---
description: Resume your glyphling pet after a pause.
allowed-tools: Bash(glyphling resume:*)
disable-model-invocation: true
---

Run `!glyphling resume` and print the resulting line verbatim.

Do not interpret, summarise, or expand on the output — the CLI already prints
a short confirmation (e.g. `Bramble is awake again. Neglect clock resumed.`).
If the command exits non-zero, surface its stderr unchanged.
