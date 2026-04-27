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

> **Amended by DEC-022.** The original DEC-021 design specified two publish workflows (`release.yml` + `release-beta.yml`) with two npm trusted-publisher registrations. We discovered post-merge that **npm allows only ONE trusted publisher per package**. DEC-022 consolidates to a single `publish.yml` entry point. This section reflects the post-amendment design.

### Constraint

npm permits exactly one trusted-publisher registration per package, identified by `(workflow_filename, environment)`. Adding a second entry — even with a different environment — is rejected by the npm UI.

### Target config

1. **On the npm side** (Settings → Trusted Publishers):
   - Provider: GitHub Actions
   - Repository: `RR-AMATOK/Claude-Hatch`
   - Workflow filename: **`publish.yml`** (must match the file path on disk EXACTLY)
   - Environment: **`publish`**
   - Reference: <https://docs.npmjs.com/trusted-publishers>
   - **Renaming `publish.yml` or the `publish` environment must be mirrored in this registration in lock-step**, or the OIDC publish step will 403.
2. **In `publish.yml`**:
   - Top-level `permissions: { contents: read }`
   - Per-job `id-token: write` ONLY on the `publish` job (the `gate` job has no business minting an OIDC token)
   - `environment: publish` on the publish job
   - `setup-node` with `registry-url: https://registry.npmjs.org` (npm ≥ 11.5.1 requires this for OIDC routing)
   - `npm publish --provenance --access public --tag <derived-from-ref>` — see §7 for derivation logic
   - **No `NODE_AUTH_TOKEN`, no `NPM_TOKEN`** anywhere
3. **In repo Settings → Environments**:
   - Create `publish` environment with **no protection rules** (no required reviewers, no wait-timer, no deployment-branch restrictions). The env exists only to satisfy npm's registration form which requires a non-empty environment field. It is NOT a manual-approval gate.
   - Delete the legacy `release` and `release-beta` environments left over from the DEC-021 rollout.
4. **In repo Settings → Secrets**:
   - `NPM_TOKEN` is no longer needed once trusted publisher works. Delete it after first OIDC publish succeeds.

### Why a placeholder environment instead of an approval gate

DEC-022 chose zero-friction publishes (v1) over manual-approval-on-all (v2). For a solo maintainer, self-approval is theater (the approver = the tagger, no real second-eye check), and the friction cost on every beta publish is non-trivial. The CI gate (typecheck, lint, test, build, exact version-match) is the actual safety. Optional layered safety: GitHub **tag-protection rules** (Settings → Rules → Tags) can restrict who can push tag patterns to repo admins.

### Verification ritual (post-migration)

- [ ] Bump `package.json` on `beta` to `0.1.1-beta.0`, commit, tag `v0.1.1-beta.0`, push tag.
- [ ] Confirm publish succeeds via OIDC; npm dashboard shows "Provenance: GitHub Actions" and "Auth: Trusted Publisher".
- [ ] `npm view glyphling dist-tags` shows `beta: 0.1.1-beta.0`.
- [ ] Confirm `publish.yml` contains no `NODE_AUTH_TOKEN` / `NPM_TOKEN` reference.
- [ ] Delete `NPM_TOKEN` from repo secrets.
- [ ] Push `v0.1.1-beta.1` after a small change to confirm publishes still succeed (proves no fallback to classic auth).
- [ ] Record the verification outcome in `CHANGELOG-DEV.md`.

---

## 7. Beta channel strategy

Tag-triggered, **single** workflow (`publish.yml`); dist-tag inferred from tag shape.

> **Amended by DEC-022** (supersedes the original split-workflow design).

### Shape

`publish.yml` triggers on three tag patterns and routes via a derived dist-tag:

| Tag pattern              | dist-tag   | Publishes to    |
|--------------------------|------------|-----------------|
| `v[0-9]+.[0-9]+.[0-9]+`            | `latest` | `glyphling@<ver>` (default) |
| `v[0-9]+.[0-9]+.[0-9]+-rc.[0-9]+`  | `next`   | `glyphling@<ver>-rc.N` under `@next` |
| `v[0-9]+.[0-9]+.[0-9]+-beta.[0-9]+` | `beta`  | `glyphling@<ver>-beta.N` under `@beta` |

The `publish` job derives the dist-tag from `github.ref` (single bash conditional) and runs `npm publish --provenance --access public --tag <derived>`.

The `gate` job runs CI checks (typecheck, demo:lint, test, build) plus an **exact** tag↔package.json version-match check.

### Why a single workflow

npm allows only ONE trusted publisher per package. The original DEC-021 §7 split design (`release.yml` + `release-beta.yml`) couldn't both be registered. DEC-022 consolidates so all three flows authenticate through the single `publish.yml` registration.

### Why tag-triggered, not branch-push-triggered

1. **Auditability.** Every published version is a tag. Reverting a release is `git tag -d` + a new tag. Branch-push publishing makes "what's `@beta` right now?" history-spelunking.
2. **Idempotency.** Reruns of the workflow on the same tag are safe (npm rejects duplicate version). Branch-push triggers can publish twice if someone force-pushes.
3. **Decouples merging from publishing.** Merging into `beta` is integration soak; tagging is the explicit "I want this on the registry" act.

### Tagging discipline

- Stable `vX.Y.Z` — tag from `main` only.
- RC `vX.Y.Z-rc.N` — tag from `main` only (a release candidate is a candidate FOR a stable release on `main`).
- Beta `vX.Y.Z-beta.N` — tag from `beta` only.
- These rules are not CI-enforced (`publish.yml` accepts the tag regardless of source branch). Optional layered safety: **tag-protection rules** in Settings → Rules → Tags to restrict tag pushing to repo admins.

### Pre-release version bump (gate behavior change)

The gate now requires **exact** match between the tag (`v` stripped) and `package.json#version`. So before tagging:

- For `v0.1.1-beta.0`: bump `package.json` to `0.1.1-beta.0` on `beta`, commit, then tag.
- For `v0.1.1-rc.1`: bump `package.json` to `0.1.1-rc.1` on `main`, commit, then tag.

This is a behavior change from the original DEC-021 gate logic, which stripped pre-release suffixes and only checked the bare X.Y.Z. The old logic let `v0.1.1-beta.0` publish the bare `0.1.1` (because npm publishes whatever version is in `package.json`, not what the tag says) — silently corrupting `@latest`. The DEC-022 gate (EXACT match) prevents this.

### Beta promotion mechanics

- Soft rule: a change is in `beta` for **at least 24 hours of soak** before promotion to `main`. Encoded as a checkbox in the PR template, **not** enforced by CI.
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
| `publish.yml` publish            | read repo + OIDC                                       | `contents: read, id-token: write` |
| `dependabot` auto-merge (future) | write to PR                                            | `contents: write, pull-requests: write` (constrained to dependabot actor) |

**Forbidden:** `permissions: write-all`, top-level `permissions: { contents: write }`, any job using `GITHUB_TOKEN` to push to the same repo without an explicit guard.

**OIDC scope for publish:** `id-token: write` only on the `publish` job, **not** on the `gate` job. The gate job has no business minting an OIDC token.

**Pin actions by SHA in publish workflows.** See §5.5. Non-publish workflows can stay on tags initially.

---

## 11. DEC entries

### DEC-021 (ratified — in `DECISIONS.md`)

The original DEC-021 design landed in `DECISIONS.md` as part of PR #29. Its §7 split-publish-workflow design has been superseded by **DEC-022** below. Sections §6 and §7 of this document have been updated to reflect the post-DEC-022 design; the rest of DEC-021 (branch topology, gate matrix, branch-protection rules) remains intact.

Original DEC-021 paste text (historical reference):

```markdown
## DEC-021 — CI/CD branch topology and gate strategy
- **Date:** 2026-04-26
- **Status:** Accepted (proposed by @cicd-architect; pending @release-manager ratify)
- **Decided by:** @product-owner (user-confirmed)
- **Context:** Pre-existing `main` is the real trunk (34 commits, GitHub default branch); `Diagrams` is a stale 1-commit orphan with disjoint history that needs deletion. Existing `ci.yml` triggers only on `main`; we want to extend gates to a four-channel topology (`feature/*` → `dev` → `beta` → `main`) with an explicit hotfix lane, npm beta dist-tag publishing, and trusted-publisher (OIDC) auth on releases. Existing `release.yml` mixes OIDC and `NPM_TOKEN` auth — mutually exclusive paths that defeat the trusted-publisher integration.
- **Decision:** Adopt the topology in `docs/ci-cd.md`. Delete the orphan `Diagrams` branch and re-point local `origin/HEAD` at `main`; no trunk rename. Adopt the trigger matrix, promotion gates, and branch-protection rules described in `docs/ci-cd.md`. Adopt tag-triggered npm publishing in two split files: `release.yml` for `vX.Y.Z` (`@latest`) and `vX.Y.Z-rc.N` (`@next`); `release-beta.yml` for `vX.Y.Z-beta.N` (`@beta`). Migrate `release.yml` to OIDC trusted-publisher only and remove `NPM_TOKEN` from repo secrets after first successful OIDC publish. Add three new gates beyond the current set: `smoke-pack` (install built tarball, run `--version` + `statusline`), `audit-ci` with allowlist on PRs to `beta`/`main` (and a lighter variant on `dev`), and CodeQL SAST weekly + on PR to `main`. Coverage is collected as an artifact for visibility but does NOT gate merges. Required reviewers on `main` and `beta` are **0** — CI status checks are the gate. The PR-template `1024` invariant is updated to `1618` (⌊φ × 1000⌋) to align with DEC-020.
- **Consequences:** Two new permanent protected branches (`dev`, `beta`) with required-status-check lists keyed off exact job names; renaming a job becomes a coordinated branch-protection edit. Publish stops working until the npm-side trusted-publisher config is set up (user has confirmed it is registered; verification ritual in `docs/ci-cd.md` §6). Beta releases require a tag push (no auto-publish on merge to `beta`) — adds friction by design as an explicit "I want this published" act. Hotfix lane is documented, bypasses `dev`/`beta`, and requires back-port — discipline-enforced, not CI-enforced. Workflow filenames are now load-bearing for OIDC: any rename to `release.yml` / `release-beta.yml` must be mirrored in the npm trusted-publisher registration in lock-step.
```

### DEC-022 (paste-ready, append to `DECISIONS.md` as part of this PR)

```markdown
## DEC-022 — Single npm publish workflow (consolidates DEC-021 §7)
- **Date:** 2026-04-26
- **Status:** Accepted (supersedes the split-workflow portion of DEC-021)
- **Decided by:** @product-owner (user-confirmed via "v1" recommendation)
- **Context:** DEC-021 §7 specified two publish workflows (`release.yml` for stable + RC, `release-beta.yml` for beta) with two separate npm trusted-publisher registrations. After PR #29 landed, we discovered (via the npm UI) that **npm allows only ONE trusted publisher per package** — the second registration attempt is rejected. The split design is incompatible with npm's constraint. Additionally, the original gate logic stripped pre-release suffixes from tags before comparing to `package.json`, which let `v0.1.1-beta.0` publish the bare `0.1.1` version (npm reads version from `package.json`, not the tag), silently corrupting `@latest`.
- **Decision:** Consolidate to a single `.github/workflows/publish.yml` that triggers on all three tag patterns (stable, rc, beta) and routes to the correct npm dist-tag (`@latest`, `@next`, `@beta`) by deriving from the tag shape in a single bash step. Single npm trusted-publisher registration: workflow `publish.yml`, environment `publish` (a placeholder env in repo Settings → Environments with NO protection rules — npm's registration form requires a non-empty environment field, but we do not want manual approval). All publishes proceed without manual approval; the CI gate (typecheck, demo:lint, test, build, and an EXACT tag↔package.json version-match check) is the only gate. Pre-release versions must be reflected in `package.json` before tagging (e.g., bump `package.json` to `0.1.1-beta.0` on `beta` before tagging `v0.1.1-beta.0`). Delete `release.yml` and `release-beta.yml`. Delete the legacy `release` and `release-beta` GitHub environments. Optional layered safety: add tag-protection rules in Settings → Rules → Tags to restrict who can push tag patterns.
- **Consequences:** Manual-approval click on stable releases (the `release` env's required-reviewer rule from DEC-021's rollout) is gone. For solo, self-approval is theater — the CI gate is the actual safety. Adding collaborators later means a 5-min migration to add `environment: release` with required reviewers (reversible). Pre-release version bumps are now mandatory before tagging (was: implicit, gate-tolerated). Workflow filenames are still load-bearing for OIDC: renaming `publish.yml` or the `publish` environment requires updating the npm trusted-publisher registration in lock-step. The original `release.yml` and `release-beta.yml` are deleted.
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
