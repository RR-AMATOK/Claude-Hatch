---
description: Run glyphling diagnostics (read-only).
---

Run `!glyphling doctor` and print the resulting output verbatim.

Do not interpret, summarise, or expand on the output — the CLI already prints
a diagnostic report covering state path, lock state, last event, and daemon status.
If the command exits non-zero, surface its stderr unchanged.
