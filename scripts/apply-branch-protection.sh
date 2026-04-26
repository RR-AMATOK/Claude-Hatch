#!/usr/bin/env sh
# ============================================================
# apply-branch-protection.sh
# ============================================================
# Idempotent branch-protection rule setup for RR-AMATOK/Claude-Hatch.
# Run once during CI/CD rollout; safe to re-run (PUT is idempotent).
#
# Prerequisites:
#   - gh CLI authenticated: gh auth login
#   - Caller must have admin access to the repository
#
# Usage:
#   bash scripts/apply-branch-protection.sh
#
# Required-status-check names that this script references come from
# exact job `name:` fields in these workflow files:
#
#   From .github/workflows/_node-test.yml (reusable):
#     "test (node 20.x · ubuntu-latest)"
#     "test (node 22.x · ubuntu-latest)"
#     "test (node 20.x · macos-latest)"
#     "test (node 22.x · macos-latest)"
#     "pack dry-run (tarball hygiene)"
#
#   From .github/workflows/security.yml:
#     "audit-ci (high)"
#     "CodeQL"
#
#   From .github/workflows/promote-gate.yml (reusable workflow_call —
#   names are PREFIXED by the calling job's display name):
#     "smoke-pack (ubuntu-latest) / smoke-pack (ubuntu-latest)"
#     "smoke-pack (macos-latest) / smoke-pack (macos-latest)"
#
# WARNING: Renaming any of those job `name:` fields will break
# branch protection without this script being updated and re-run.
# ============================================================

set -euo pipefail

REPO="RR-AMATOK/Claude-Hatch"

echo "[branch-protection] Applying rules for $REPO ..."

# ============================================================
# main — full gates + linear history
# ============================================================

echo "[branch-protection] Setting main ..."

gh api --method PUT "repos/$REPO/branches/main/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "test (node 20.x · ubuntu-latest)",
      "test (node 22.x · ubuntu-latest)",
      "test (node 20.x · macos-latest)",
      "test (node 22.x · macos-latest)",
      "pack dry-run (tarball hygiene)",
      "audit-ci (high)",
      "CodeQL",
      "smoke-pack (ubuntu-latest) / smoke-pack (ubuntu-latest)",
      "smoke-pack (macos-latest) / smoke-pack (macos-latest)"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true,
    "require_last_push_approval": false
  },
  "required_linear_history": true,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_signatures": false,
  "restrictions": null
}
JSON

echo "[branch-protection] main: OK"

# ============================================================
# beta — same as main minus CodeQL as required check;
#        linear history on (fast-fwd from dev)
# ============================================================

echo "[branch-protection] Setting beta ..."

gh api --method PUT "repos/$REPO/branches/beta/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "test (node 20.x · ubuntu-latest)",
      "test (node 22.x · ubuntu-latest)",
      "test (node 20.x · macos-latest)",
      "test (node 22.x · macos-latest)",
      "pack dry-run (tarball hygiene)",
      "audit-ci (high)",
      "smoke-pack (ubuntu-latest) / smoke-pack (ubuntu-latest)"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true,
    "require_last_push_approval": false
  },
  "required_linear_history": true,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_signatures": false,
  "restrictions": null
}
JSON

echo "[branch-protection] beta: OK"

# ============================================================
# dev — lighter gates; no linear history (preserve PR merge commits)
# ============================================================

echo "[branch-protection] Setting dev ..."

gh api --method PUT "repos/$REPO/branches/dev/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "test (node 22.x · ubuntu-latest)",
      "pack dry-run (tarball hygiene)",
      "audit-ci (high)"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true,
    "require_last_push_approval": false
  },
  "required_linear_history": false,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_signatures": false,
  "restrictions": null
}
JSON

echo "[branch-protection] dev: OK"
echo "[branch-protection] All branches configured. Done."
