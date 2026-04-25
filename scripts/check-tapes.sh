#!/usr/bin/env bash
# check-tapes.sh — GIF-safety lint for vhs .tape files.
#
# Rejects any tape that could leak host identity through the recorded frames:
# absolute home paths, $HOME / $USER references, macOS iCloud prefixes.
#
# Usage:
#   scripts/check-tapes.sh                  # scan every tracked .tape
#   scripts/check-tapes.sh path/to/one.tape # scan a single file
#
# Exit codes: 0 = clean, 1 = forbidden pattern found, 2 = usage error.

set -euo pipefail

# Extended-regex (grep -E) patterns. Each line is matched independently.
# Kept intentionally narrow — false positives waste author time.
PATTERNS=(
  '/Users/'
  '/home/[A-Za-z0-9_-]+'
  '/root/'
  '/private/tmp/'
  '/Library/Mobile Documents/'
  '\$HOME([^A-Z_]|$)'
  '\$USER([^A-Z_]|$)'
  '\$LOGNAME'
  '\$HOSTNAME'
)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Resolve target list.
if [[ $# -gt 0 ]]; then
  TARGETS=("$@")
else
  # Default: every tracked .tape (works whether or not there are any yet).
  mapfile -t TARGETS < <(cd "$REPO_ROOT" && git ls-files -- '*.tape' 2>/dev/null || true)
fi

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "[check-tapes] no .tape files to scan — OK"
  exit 0
fi

fail=0
for tape in "${TARGETS[@]}"; do
  if [[ ! -f "$tape" ]]; then
    echo "[check-tapes] not a file: $tape" >&2
    exit 2
  fi
  for pat in "${PATTERNS[@]}"; do
    # Strip leading '# ' comment lines — those are author notes, not recorded.
    if grep -nE "$pat" "$tape" | grep -v '^[0-9]\+:# ' >/dev/null; then
      echo "[check-tapes] FORBIDDEN pattern \"$pat\" in $tape:"
      grep -nE "$pat" "$tape" | grep -v '^[0-9]\+:# ' | head -5 | sed 's/^/    /'
      fail=1
    fi
  done
done

if [[ $fail -eq 0 ]]; then
  echo "[check-tapes] ${#TARGETS[@]} tape(s) clean"
fi

exit $fail
