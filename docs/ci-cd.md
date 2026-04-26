# glyphling CI/CD architecture

**Status:** Design (pending @pipeline-engineer implementation).
**Owner:** @cicd-architect → @pipeline-engineer (impl) → @pipeline-security (publish hardening) → @release-manager (beta channel + DEC ratification).
**Supersedes:** ad-hoc CI in `.github/workflows/{ci,release}.yml`.
**Related:** DEC-021 (proposed below in §11).

---

## 1. Branch topology

```
                         ┌───────────────────────────────────────────────┐
                         │                  npm registry                  │
                         │  glyphling@latest    glyphling@beta            │
                         └────────▲───────────────────────▲───────────────┘
                                  │ tag v*.*.*            │ tag v*.*.*-beta.*
                                  │ (npm publish)         │ (npm publish --tag beta)
                                  │                       │
                  ┌───────────────┴───┐       ┌───────────┴────────────┐
                  │      main         │       │         beta           │
                  │ (protected; src   │       │ (protected; release-   │
                  │  of truth for     │       │  candidate channel)    │
                  │  released code)   │       └───────────▲────────────┘
                  └────────▲──────────┘                   │
                           │ promotion PR (fast-fwd       │ promotion PR
                           │  preferred)                  │ (fast-fwd preferred)
                           │                              │
                  ┌────────┴──────────────────────────────┴────────────┐
                  │                       dev                           │
                  │  (protected-lite; integration trunk; everyday work) │
                  └──┬──────────────────────────────────────────────┬──┘
                     │ PR                                           │ PR
                     │                                              │
              ┌──────┴───────┐                              ┌──────┴───────┐
              │ feature/*    │                              │ fix/*        │
              │ (short-lived,│                              │ (short-lived,│
              │  rebased)    │                              │  rebased)    │
              └──────────────┘                              └──────────────┘

         Hotfix lane (out-of-band, bypasses dev/beta):

         main ◄── PR (CI green) ◄── hotfix/<ticket>
                                          │
                                          └── after merge: cherry-pick into beta and dev,
                                              tag vX.Y.(Z+1), publish @latest.
```

### Lane semantics

| Lane           | Lifetime           | PR target | Force-push? | Squash on merge?       |
|----------------|--------------------|-----------|-------------|------------------------|
| `feature/*`    | hours–days         | `dev`     | OK on own   | **squash** (clean dev) |
| `fix/*`        | hours–days         | `dev`     | OK on own   | **squash**             |
| `dev`          | permanent          | `beta`    | never       | **merge commit** (preserve PR boundaries) |
| `beta`         | permanent          | `main`    | never       | **fast-forward only** |
| `main`         | permanent          | (none — release source) | never | n/a |
| `hotfix/*`     | hours              | `main`    | OK on own   | squash; then cherry-pick into `beta`, `dev` |

**Hotfix bypass justification.** `dev → beta → main` is the safe path for features. A live-prod regression (`glyphling statusline` panicking in a real Claude Code session, say) cannot wait on a beta soak. The hotfix lane PRs straight to `main`, gets the same CI gates as a `main` PR, tags a patch (the diff carries the `package.json` version bump — see §12 follow-ups), and is then **back-ported** into `dev` and `beta` so the lower channels never roll the fix back. No hotfix is ever published without first existing on `main`.

---

## 2. Cleanup of stale `Diagrams` orphan branch

### What's actually true today

Verified 2026-04-26 from the repo root:

```
$ git log --oneline origin/main | head -5
c3f8fd3 feat(render): per-species/per-stage statusline frames (TODO-025) (#28)
2870188 feat(commands): slash commands + glyphling install (TODO-022) (#27)
b97a82a fix(state): harden reader against torn reads + add statusline race tests
9f3b567 fix(tokens): single-flight token collector + capped retry backoff
54c6b61 docs(commands): add glyph-feed.md sample slash command (TODO-021) (#24)

$ git log --oneline origin/Diagrams | head -5
4eb8774 Add MIT License to the project

$ git rev-list --count origin/main      # → 34
$ git rev-list --count origin/Diagrams  # → 1

$ gh repo view RR-AMATOK/Claude-Hatch --json defaultBranchRef -q '.defaultBranchRef.name'
main
```

`main` is the real trunk and GitHub's default branch. `ci.yml`'s `branches: [main]` trigger has been gating PRs correctly all along. `origin/Diagrams` is a 1-commit orphan with disjoint history — just an MIT license commit, no shared ancestry with `main`. **No trunk rename is required.**

### What is broken

1. The local `origin/HEAD` symbolic ref points at `Diagrams` (stale cache from clone-time).
2. The auto-derived gitStatus block prepended to agent sessions surfaces `Main branch (you will usually use this for PRs): Diagrams` because of (1).
3. The orphan `Diagrams` branch on the remote serves no purpose and is a permanent footgun — anyone who clones and runs `git checkout Diagrams` lands on a one-commit repo that looks bizarrely empty.

### Cleanup ritual (one-shot, ~2 min — @release-manager scope)

```bash
# 1. Delete the orphan Diagrams branch on the remote.
gh api --method DELETE repos/RR-AMATOK/Claude-Hatch/git/refs/heads/Diagrams

# 2. Re-point local origin/HEAD at the actual default branch.
git remote set-head origin -a

# 3. Verify.
git symbolic-ref refs/remotes/origin/HEAD          # → refs/remotes/origin/main
git ls-remote origin Diagrams                      # → empty
```

If the canonical body of `CLAUDE.md` (not the auto-prepended gitStatus block) contains any text referencing `Diagrams` as the trunk, fix it. As of 2026-04-26 a `grep -n Diagrams CLAUDE.md` returns no matches in the canonical body — the only mention is in the auto-derived gitStatus, which (1) above resolves.

### Workflow trigger changes from this cleanup

None retargeted — `main` stays the trunk. `@pipeline-engineer` will only **add** `dev` and `beta` to existing `branches: [main]` triggers in `ci.yml`. No retargeting away from `main`.

---

## 3. Trigger matrix

Workflow files (target state — @pipeline-engineer to author):

| Workflow file                          | Purpose                                         | Reusable?    |
|----------------------------------------|-------------------------------------------------|--------------|
| `.github/workflows/ci.yml`             | Per-push lint/typecheck/test/build/pack         | Caller of `_node-test.yml` |
| `.github/workflows/_node-test.yml`     | Reusable test job (matrix Node × OS)            | `workflow_call` only |
| `.github/workflows/promote-gate.yml`   | Heavier checks on PRs targeting `dev`/`beta`/`main` | Self |
| `.github/workflows/release.yml`        | Tag-triggered npm publish (`@latest`)           | Self |
| `.github/workflows/release-beta.yml`   | Tag-triggered npm publish (`@beta`)             | Self |
| `.github/workflows/security.yml`       | `audit-ci` + CodeQL on schedule + on PR         | Self |
| `.github/workflows/smoke-pack.yml`     | Tarball install smoke test on PR to `main`/`beta` | Self |

Trigger / scope matrix:

| Event                                           | ci | promote-gate | security | smoke-pack | release | release-beta |
|-------------------------------------------------|----|--------------|----------|------------|---------|--------------|
| Push to `feature/*` or `fix/*`                  | ✅  | —            | —        | —          | —       | —            |
| Push to `hotfix/*`                              | ✅  | —            | —        | —          | —       | —            |
| PR → `dev`                                      | ✅  | ✅ (light)    | ✅ (audit only) | — | —       | —            |
| Push to `dev` (post-merge)                      | ✅  | —            | —        | —          | —       | —            |
| PR → `beta`                                     | ✅  | ✅ (full)     | ✅        | ✅          | —       | —            |
| Push to `beta` (post-merge)                     | ✅  | —            | —        | —          | —       | —            |
| PR → `main` (incl. promotion + hotfix)          | ✅  | ✅ (full)     | ✅        | ✅          | —       | —            |
| Push to `main` (post-merge)                     | ✅  | —            | —        | —          | —       | —            |
| Tag push `v[0-9]+.[0-9]+.[0-9]+`                | —  | —            | —        | —          | ✅       | —            |
| Tag push `v[0-9]+.[0-9]+.[0-9]+-beta.[0-9]+`    | —  | —            | —        | —          | —       | ✅            |
| Tag push `v[0-9]+.[0-9]+.[0-9]+-rc.[0-9]+`      | —  | —            | —        | —          | ✅ (publishes as `@next`) | — |
| Schedule: `cron: '0 7 * * 1'` (Mon 07:00 UTC)   | —  | —            | ✅        | —          | —       | —            |
| `workflow_dispatch` (manual)                    | ✅ (any branch) | — | ✅       | ✅          | —       | —            |

**Why `ci.yml` runs on every push to every branch and `promote-gate.yml` only on PRs to protected branches:** fast feedback for contributors on `feature/*`, heavy gates only when promotion is on the line. Avoids paying for CodeQL on every WIP push.

**Why CI also runs on push to `main`/`beta`/`dev` after merge:** branch protection prevents skips, and the post-merge run is the artifact source for any environment-deploy step we add later. It's also the run that produces the green badge.

**The dev-trigger addition is purely additive.** Today `ci.yml` triggers on `push: branches: [main]` and `pull_request: branches: [main]`. The implementation step changes those lists to `[main, beta, dev]`. Existing `main` behaviour is unaffected.

---

## 4. Required gates per branch

**Concept:** every push runs a fast PR check. Heavier gates only fire on PRs that promote between protected branches. The strength of the gate scales with blast radius.

### 4.1 Fast PR checks (every push, every branch)

These come from `ci.yml`. Time budget: **≤6 min wall-clock P95** (current pipeline is ~4 min; we have headroom).

| Job                                | Currently in `ci.yml`? | Notes |
|------------------------------------|------------------------|-------|
| `typecheck`                        | ✅                      | `npm run typecheck` |
| `test` (Node 20+22 × Ubuntu+macOS) | ✅                      | matrix; `fail-fast: false` |
| `build`                            | ✅                      | `npm run build` |
| `demo:lint`                        | ✅                      | `npm run demo:lint` |
| `pack` dry-run                     | ✅                      | tarball hygiene assertions |

ESLint/Prettier are deliberately not added here — see §5.6.

### 4.2 Promotion gates

| Promotion        | Gates beyond §4.1                                                                                                                                  |
|------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|
| `feature/*` → `dev` | §4.1 only. **0 reviewers** (CI is the gate). PR template invariants checked. Conversation-resolution required. |
| `dev` → `beta`   | §4.1 + `audit-ci` (with allowlist) + `smoke-pack` on `ubuntu-latest`. |
| `beta` → `main`  | §4.1 + `audit-ci` + CodeQL JS/TS analysis + `smoke-pack` on **both** `ubuntu-latest` and `macos-latest`. **0 reviewers** (CI is the gate). PR template invariants checklist must be ticked. |
| `hotfix/*` → `main` | Same as `beta → main`. CI must be green on its own — no "merge with failing checks" allowed. |

**Light vs full `promote-gate`:**
- **Light** (PR → `dev`): just runs `audit-ci` to surface new high-sev advisories from feature deps. ~30s.
- **Full** (PR → `beta` / `main`): audit + CodeQL + smoke-pack. ~6–8 min.

---

## 5. Suggested gates beyond current set

Each is rated **Recommend / Optional / Overkill** for a solo CLI project.

### 5.1 Coverage threshold — **Optional (lighter alternative adopted)**
- Current state: `package.json` has no `@vitest/coverage-v8` dep; no `vitest.config.*`; coverage is **not currently collected**. So this is greenfield.
- **Heavy version:** add `@vitest/coverage-v8`, set thresholds (e.g. 80% lines / 70% branches), fail CI if regressed.
- **Lighter alternative (adopted):** add coverage collection but **don't fail on it** — upload to job summary via `vitest run --coverage --reporter=html` + `actions/upload-artifact`. Gives visibility without becoming a flaky merge blocker. Tighten later if coverage actually regresses meaningfully.
- Rationale: glyphling's tests today are tightly tied to behavior (lifecycle, XP curve, lockfile races). A blunt 80% line threshold would push contributors to write tests for trivial getters to "make the bar." Visibility > enforcement at this size.

### 5.2 Dependency audit with allowlist — **Recommend (`audit-ci` adopted)**
- Run `audit-ci --high` on PR to `beta`/`main` and on weekly schedule.
- Allowlist via a checked-in `.audit-ci.json` (or `audit-ci` block in `package.json`) — `npm audit` itself doesn't support native allowlists, which is why we use `audit-ci`.
- Each allowlisted advisory must have an expiry date and a one-line reason. Expired entries fail the build — forces revisits.
- One dev-dep added (`audit-ci`).

### 5.3 CodeQL SAST — **Recommend (on at launch)**
- GitHub-native, free for public repos. JS/TS analysis. Catches eval, tainted-input-into-spawn, regex DoS.
- Concern: false-positive rate on a CLI is moderate. If FPs become noisy in the first month, switch to weekly-schedule-only and drop the PR-to-`main` trigger.
- Decision: turn it on in **default config**, schedule weekly, also fire on PR to `main`. Required-blocking on `main` only.

### 5.4 Package smoke-test — **Recommend (high-value)**
- This is the single highest-value addition. The current `pack` job verifies the tarball *contents* but not that the tarball *runs*.
- Job: in a clean `ubuntu-latest` runner (ideally a `node:20-bookworm-slim` container step — see §12 for verification), `npm pack`, `npm install -g ./glyphling-*.tgz`, then:
  - `glyphling --version` exits 0
  - `glyphling statusline` exits 0 within 5s under `GLYPHLING_HOME=$RUNNER_TEMP/smoke`, prints non-empty stdout, no stderr
  - `glyphling statusline` repeated 5× in a row (sanity for the lock-free read path)
- Catches: missing `bin` entry permissions, missing `dist/claude-commands/*.md` files, broken shebang on Linux, ESM/CJS interop blow-ups at install time.
- Cost: ~2 min. Replaces a class of bugs the current pipeline cannot catch.

### 5.5 Action pinning by SHA on publish workflows — **Recommend (cheap)**
- Current workflows use `actions/checkout@v6`, `actions/setup-node@v6` (floating tags). A hijacked tag in the publish workflow could exfiltrate the OIDC-issued npm token at the moment of publish.
- Pin publish workflows (`release.yml`, `release-beta.yml`) to commit SHA with comment for human readability:
  ```
  uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
  ```
- Use Dependabot's `package-ecosystem: github-actions` (already enabled) — it auto-PRs SHA bumps with the latest tag in the comment.
- Non-publish workflows (`ci.yml`, `promote-gate.yml`, `security.yml`, `smoke-pack.yml`) stay on tags initially. Marginally less safe but defensible — they can't mint an npm-publishing token.

### 5.6 Lint (ESLint) — **Optional (deferred)**
- Project has no ESLint config today. Adding one is a separate decision (style/format preferences).
- Not added in this work.

### 5.7 Sigstore/provenance — **already on**
- `release.yml` already passes `--provenance`. Nothing to add. Reaffirmed in §6.

### 5.8 Branch-name lint — **Overkill, skipped**
- With a solo dev + small team, social pressure is enough.

### 5.9 Required signed commits — **off (low-friction default)**
- Solo dev; turning on signed-commits adds setup friction without a corresponding threat-model win. Revisit if collaborators arrive.

---

## 6. npm publish reconciliation (trusted publisher)

### Problem

Current `release.yml` does both:
- `permissions: id-token: write` (OIDC for npm trusted publishing — Sigstore provenance & token-less auth), AND
- `env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` on the `npm publish` step (classic automation token).

These two paths are mutually exclusive in practice. With trusted publishing configured on the npm side, `npm publish` will detect the OIDC token from `ACTIONS_ID_TOKEN_REQUEST_*` env vars and authenticate via that — but if `NODE_AUTH_TOKEN` is set, the npm CLI prefers it and falls back to classic auth, defeating the trusted-publisher integration. Worse, you keep a long-lived secret around that you don't need.

### Target config

1. **On the npm side** (one-time, npm web UI — user has confirmed this is registered):
   - Settings → Trusted Publishers → repository `RR-AMATOK/Claude-Hatch`, workflow filename **`release.yml`** (and **`release-beta.yml`** since we are splitting), environment `release` / `release-beta`.
   - Reference: <https://docs.npmjs.com/trusted-publishers>.
   - **The workflow filename registered with npm must match the file path on disk exactly.** If `@pipeline-engineer` renames the workflow file, the trusted-publisher entry must be updated in lock-step or the OIDC publish step will fail with a 403.
2. **In `release.yml`**:
   - Keep `permissions: { contents: read, id-token: write }`.
   - Keep `environment: release`.
   - Keep `npm publish --provenance --access public`.
   - Keep `registry-url: https://registry.npmjs.org` on `setup-node` (npm ≥ 11.5.1 requires it for OIDC routing).
   - **Remove** `env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` from the publish step.
3. **In `release-beta.yml`** — identical OIDC flow but `npm publish --provenance --access public --tag beta`. `environment: release-beta` (no manual approval — beta is opt-in by definition; see §7).
4. **In repo Settings → Secrets** — once the first OIDC publish succeeds end-to-end, **delete** `NPM_TOKEN`. Keeping it around is the actual risk: if the workflow is ever edited to re-add the env var (by a copy-paste from a tutorial), it'll silently fall back to long-lived auth.

### Verification ritual (post-migration)

`@pipeline-security` performs this once after the YAML lands:

- [ ] Push throwaway tag `v0.0.0-test.1` from a scratch branch. Confirm publish succeeds via OIDC, npm dashboard shows "Provenance: GitHub Actions" and "Auth: Trusted Publisher".
- [ ] Unpublish the test version (within npm's 72h window).
- [ ] Confirm the workflow filename registered with npm matches `release.yml` on disk exactly. If `release-beta.yml` is also split out, confirm its registration too.
- [ ] Delete `NPM_TOKEN` from repo secrets.
- [ ] Push `v0.0.0-test.2` from a scratch branch. Confirm publish still succeeds (proves no fallback to classic auth).
- [ ] Confirm `release.yml` and `release-beta.yml` contain no `NODE_AUTH_TOKEN` reference.
- [ ] Record the verification in `CHANGELOG-DEV.md`.

---

## 7. Beta channel strategy

Tag-triggered, **split** workflow, dist-tag inferred from tag shape.

### Shape

- `release.yml` triggers on `v[0-9]+.[0-9]+.[0-9]+` and `v[0-9]+.[0-9]+.[0-9]+-rc.[0-9]+` (rc → `@next`).
- `release-beta.yml` triggers on `v[0-9]+.[0-9]+.[0-9]+-beta.[0-9]+` only. Publishes with `--tag beta`. Environment `release-beta` — no manual approval gate (beta is opt-in by definition).
- The `gate` job in each workflow verifies `package.json` version matches the tag (already implemented in `release.yml`; mirror into `release-beta.yml`).
- Tag stable releases from `main` only. Tag `-beta.*` from `beta` only. Tag `-rc.*` from `main` only.

### Why tag-triggered, not branch-push-triggered

1. **Auditability.** Every published version is a tag. Reverting a release is `git tag -d` + a new tag. Branch-push publishing makes "what's `@beta` right now?" history-spelunking.
2. **Idempotency.** Reruns of the workflow on the same tag are safe (npm rejects duplicate version). Branch-push triggers can publish twice if someone force-pushes.
3. **Matches the existing pattern.** `release.yml` is already tag-triggered.
4. **Decouples merging from publishing.** Merging into `beta` is integration soak; tagging is the explicit "I want this on the registry" act.

### Why split into two workflow files

- Environment + approval rules diverge: `release` may want a future manual-approval gate; `release-beta` should not.
- npm-side trusted-publisher registrations are per-workflow-filename, so split = one registration per channel = clearer audit trail.
- YAML conditionals on `if: startsWith(github.ref, 'refs/tags/v') && contains(github.ref, '-beta.')` get hairy; one tag-pattern per file is easier to read.

### Beta promotion mechanics

- Soft rule: a change is in `beta` for **at least 24 hours of soak** before promotion to `main`. Encoded as a checkbox in the PR template, **not** enforced by CI — too brittle and too easy to game.
- Beta tags monotonically increment: `v0.2.0-beta.1`, `v0.2.0-beta.2`, …, then stable `v0.2.0`.
- After stable `v0.2.0` is published, leave `@beta` pointing at the last `v0.2.0-beta.N`. Users on `@beta` get the last beta, not silently promoted to stable. Move `@beta` forward only when the next pre-release cycle begins.

---

## 8. Branch protection rules (apply via `gh api`)

`@pipeline-engineer` ships these as a small `scripts/apply-branch-protection.sh`. Manual one-shot during rollout.

### `main`

- [ ] Require pull request before merging
- [ ] Required approvals: **0** (CI status checks are the gate — solo dev, no sock-puppet reviewer)
- [ ] Dismiss stale approvals when new commits are pushed: **on**
- [ ] Require approval of the most recent reviewable push: **on**
- [ ] Require conversation resolution before merging: **on**
- [ ] Require status checks to pass before merging: **on**
  - Required check names (must match job `name:` exactly):
    - `test (node 20.x · ubuntu-latest)`
    - `test (node 22.x · ubuntu-latest)`
    - `test (node 20.x · macos-latest)`
    - `test (node 22.x · macos-latest)`
    - `pack dry-run (tarball hygiene)`
    - `audit-ci (high)`
    - `CodeQL`
    - `smoke-pack (ubuntu-latest)`
    - `smoke-pack (macos-latest)`
- [ ] Require branches to be up to date before merging: **on**
- [ ] Require linear history: **on** (squash + ff merges only; no merge commits)
- [ ] Require signed commits: **off** (low-friction solo default; see §5.9)
- [ ] Require deployments to succeed before merging: off
- [ ] Lock branch: off
- [ ] Do not allow bypassing the above settings: **on** (admin-protected)
- [ ] Restrict who can push to matching branches: only via PR
- [ ] Allow force pushes: **off**
- [ ] Allow deletions: **off**

### `beta`

- All of `main`'s rules **except**:
- Required approvals: **0** (same policy — CI is the gate)
- Required checks: same as `main` minus `CodeQL` (still runs, just not required-blocking)
- Linear history: **on** (fast-fwd from `dev`)

### `dev`

- [ ] Require pull request before merging
- Required approvals: **0**
- Dismiss stale approvals: on
- Require conversation resolution: on
- Required status checks (must pass):
  - `test (node 22.x · ubuntu-latest)` (single fast lane — full matrix runs but isn't blocking)
  - `pack dry-run (tarball hygiene)`
  - `audit-ci (high)` (light variant)
- Require linear history: **off** (preserve PR merge commits for archaeology)
- Require signed commits: **off**
- Allow force pushes: **off**
- Allow deletions: **off**

### Apply-as-code snippet (for the script)

```bash
# Example: applies main's protection. @pipeline-engineer scripts all three.
gh api --method PUT repos/RR-AMATOK/Claude-Hatch/branches/main/protection \
  -f required_status_checks.strict=true \
  -F required_status_checks.contexts='[
    "test (node 20.x · ubuntu-latest)",
    "test (node 22.x · ubuntu-latest)",
    "test (node 20.x · macos-latest)",
    "test (node 22.x · macos-latest)",
    "pack dry-run (tarball hygiene)",
    "audit-ci (high)",
    "CodeQL",
    "smoke-pack (ubuntu-latest)",
    "smoke-pack (macos-latest)"
  ]' \
  -F enforce_admins=true \
  -F required_pull_request_reviews.required_approving_review_count=0 \
  -F required_pull_request_reviews.dismiss_stale_reviews=true \
  -F required_pull_request_reviews.require_last_push_approval=true \
  -F required_linear_history=true \
  -F required_conversation_resolution=true \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```

---

## 9. Concurrency, caching, timeouts (existing conventions to preserve)

The current `ci.yml` does these well; codifying as project rules so new workflows follow:

- **Concurrency group keyed by workflow + ref**, with `cancel-in-progress: true` for non-publish workflows. Publish workflows use `cancel-in-progress: false` (a half-finished publish is worse than a queued one).
- **`actions/setup-node@v6` with `cache: npm`** — uses `package-lock.json` hash as cache key. Don't roll our own cache step; setup-node's is correct.
- **Per-job `timeout-minutes`**: `15` for tests, `10` for pack/publish. CI-killer guard against hung Vitest runs.
- **Matrix `fail-fast: false`** for tests — see every red cell, not just the first.
- **`npm ci` (frozen lockfile), never `npm install`** in CI.
- **Per-job least-privilege `permissions:` block.** Default repo-wide token scope is too broad.

New workflows must inherit these conventions. `@pipeline-engineer` to add a short section to `CONTRIBUTING.md` codifying the rules.

---

## 10. Permissions hardening

### Default for all workflows: `permissions: { contents: read }` at the top of every file.

Per-job overrides only when the job needs more:

| Job                              | Needs                                                  | Permissions block |
|----------------------------------|--------------------------------------------------------|-------------------|
| `ci.yml` test/build/pack         | read repo                                              | `contents: read` |
| `security.yml` CodeQL            | read repo + write security-events                      | `contents: read, security-events: write, actions: read` |
| `security.yml` audit             | read repo                                              | `contents: read` |
| `release.yml` publish            | read repo + OIDC                                       | `contents: read, id-token: write` |
| `release-beta.yml` publish       | same                                                   | `contents: read, id-token: write` |
| `dependabot` auto-merge (future) | write to PR                                            | `contents: write, pull-requests: write` (constrained to dependabot actor) |

**Forbidden:** `permissions: write-all`, top-level `permissions: { contents: write }`, any job using `GITHUB_TOKEN` to push to the same repo without an explicit guard.

**OIDC scope for publish:** `id-token: write` only on the `publish` job, **not** on the `gate` job. The gate job has no business minting an OIDC token.

**Pin actions by SHA in publish workflows.** See §5.5. Non-publish workflows can stay on tags initially.

---

## 11. Proposed DEC entry (paste-ready, do NOT land in `DECISIONS.md` yet)

> **Note on numbering:** `DECISIONS.md` ends at DEC-019. `docs/design/no-cap-economy-and-pi-phi-level-cap.md` reserves DEC-020 (not yet ratified into the canonical log). This CI/CD entry therefore claims **DEC-021** to avoid colliding with the in-flight DEC-020. If DEC-020 is ratified before this lands, no change. If DEC-020 is renumbered or dropped, renumber this to DEC-020.

```markdown
## DEC-021 — CI/CD branch topology and gate strategy
- **Date:** 2026-04-26
- **Status:** Accepted (proposed by @cicd-architect; pending @release-manager ratify)
- **Decided by:** @product-owner (user-confirmed)
- **Context:** Pre-existing `main` is the real trunk (34 commits, GitHub default branch); `Diagrams` is a stale 1-commit orphan with disjoint history that needs deletion. Existing `ci.yml` triggers only on `main`; we want to extend gates to a four-channel topology (`feature/*` → `dev` → `beta` → `main`) with an explicit hotfix lane, npm beta dist-tag publishing, and trusted-publisher (OIDC) auth on releases. Existing `release.yml` mixes OIDC and `NPM_TOKEN` auth — mutually exclusive paths that defeat the trusted-publisher integration.
- **Decision:** Adopt the topology in `docs/ci-cd.md`. Delete the orphan `Diagrams` branch and re-point local `origin/HEAD` at `main`; no trunk rename. Adopt the trigger matrix, promotion gates, and branch-protection rules described in `docs/ci-cd.md`. Adopt tag-triggered npm publishing in two split files: `release.yml` for `vX.Y.Z` (`@latest`) and `vX.Y.Z-rc.N` (`@next`); `release-beta.yml` for `vX.Y.Z-beta.N` (`@beta`). Migrate `release.yml` to OIDC trusted-publisher only and remove `NPM_TOKEN` from repo secrets after first successful OIDC publish. Add three new gates beyond the current set: `smoke-pack` (install built tarball, run `--version` + `statusline`), `audit-ci` with allowlist on PRs to `beta`/`main` (and a lighter variant on `dev`), and CodeQL SAST weekly + on PR to `main`. Coverage is collected as an artifact for visibility but does NOT gate merges. Required reviewers on `main` and `beta` are **0** — CI status checks are the gate. The PR-template `1024` invariant is updated to `1618` (⌊φ × 1000⌋) to align with DEC-020.
- **Consequences:** Two new permanent protected branches (`dev`, `beta`) with required-status-check lists keyed off exact job names; renaming a job becomes a coordinated branch-protection edit. Publish stops working until the npm-side trusted-publisher config is set up (user has confirmed it is registered; verification ritual in `docs/ci-cd.md` §6). Beta releases require a tag push (no auto-publish on merge to `beta`) — adds friction by design as an explicit "I want this published" act. Hotfix lane is documented, bypasses `dev`/`beta`, and requires back-port — discipline-enforced, not CI-enforced. Workflow filenames are now load-bearing for OIDC: any rename to `release.yml` / `release-beta.yml` must be mirrored in the npm trusted-publisher registration in lock-step.
```

---

## 12. Follow-ups for `@pipeline-engineer`

The major design questions are decided. These are the small implementation-time verifications:

1. **Verify `smoke-pack` works inside `node:20-bookworm-slim`** before committing the workflow. Some Ink-based binaries assume a TTY; `glyphling statusline` is the one-shot non-TTY path so it should be fine, but confirm. If the slim image is missing fonts/Unicode that affects `compact.ts` output, fall back to `ubuntu-latest` runner without a container.
2. **Verify the npm trusted-publisher registration matches the workflow filenames after the split.** User has confirmed registration exists; the filename registered with npm must equal `release.yml` exactly (and `release-beta.yml` if/when split). If mismatched, the OIDC publish will 403. This is a one-line check on npm.com → Settings → Trusted Publishers immediately before pushing the first real release tag.
3. **Bundle the PR-template `1024` → `1618` fix into this work.** `.github/pull_request_template.md` line 22 currently reads:
   ```
   - [ ] Level cap remains **1024** (never round, re-cap, or relabel).
   ```
   Change to:
   ```
   - [ ] Level cap remains **1618** (⌊φ × 1000⌋ — never round, re-cap, or relabel).
   ```
   Note in the PR description that this is a stale-text fix to align with DEC-020, not a behavior change.

---

*End of design doc.*
