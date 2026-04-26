<!--
  Don't break the pets. Every box below is optional but the invariants
  section is load-bearing — reviewers check it.
-->

## Summary

<!-- 1-3 sentences on what this PR does and why. -->

## Motivation

<!-- What problem is this solving? Link the TODO/issue/decision if any. -->

## Changes

<!-- Bullet list of meaningful changes. Generated diffs (lockfiles, dist/) don't belong here. -->

## Invariants

These must stay true. Check each before merging.

- [ ] Level cap remains **1618** (⌊φ × 1000⌋ — never round, re-cap, or relabel).
- [ ] Egg species stay lowercase: `circuit`, `rune`, `shard`, `bloom` (DEC-017).
- [ ] `npm run dev` / `demo` / `test` still refuse to write under `~/.claude/` (DEC-008).
- [ ] Death rule is unchanged: 3 accumulated-neglect-days OR 14 wall-clock days (DEC-009).
- [ ] No `Co-Authored-By: Claude ...` trailers in the commits.

## Touched areas (check what applies)

- [ ] **State / schema** — migration path documented, schema version bumped if breaking.
- [ ] **XP / lifecycle** — daily caps (DEC-018) + event chain integrity preserved.
- [ ] **Rendering** — ran `npm run dev` and eyeballed it; statusline still ≤ 30 ms/tick budget.
- [ ] **Security surface** — symlink refusal, file modes (0o600/0o700), safeForLog still applied.
- [ ] **Demo GIFs** — recorded via `npm run demo:record`; `npm run demo:lint` passes.
- [ ] **Public CLI surface** — CHANGELOG.md updated.

## Test plan

<!--
  What did you run? What did you watch break? Include commands + paste outputs
  for anything reviewers can't re-derive from CI.
-->

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Manual: <!-- fill in -->

## Screenshots / GIFs

<!-- Required for any UI / rendering change. Use `npm run demo:record`. -->
