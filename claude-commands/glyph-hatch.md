---
description: Hatch a new glyphling egg (first-run bootstrap).
argument-hint: "<egg-type> [name]"
allowed-tools: Bash(glyphling hatch:*)
disable-model-invocation: true
---

Run `!glyphling hatch $ARGUMENTS` and print the resulting line verbatim.

Do not interpret, summarise, or expand on the output — the CLI already prints
a confirmation with the egg type and personality (e.g. `hatched Sparky (egg: circuit, ...)`).
If the command exits non-zero, surface its stderr unchanged.
