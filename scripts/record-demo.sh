#!/usr/bin/env bash
# record-demo.sh — record a glyphling demo GIF in a sandboxed environment.
#
# Wraps vhs so the recording can never capture host identity (HOME path, user
# name, hostname, iCloud/library paths). Must be used for every GIF that ends
# up under docs/assets/.
#
# Usage:
#   scripts/record-demo.sh <tape-file> [--out docs/assets/<name>.gif]
#
# Pre-requisites:
#   - vhs installed:     brew install vhs
#   - glyphling built:   npm run build
#   - check-tapes.sh clean on the input tape
#
# The tape MUST use a cwd-relative Output directive (e.g. `Output demo.gif`).
# The wrapper copies the result to --out (or docs/assets/<tape-basename>.gif).

set -euo pipefail

usage() {
  echo "Usage: $0 <tape-file> [--out <path-to-gif>]" >&2
  exit 2
}

TAPE=""
OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT="${2:?--out requires a path}"; shift 2 ;;
    -h|--help) usage ;;
    *)
      if [[ -z "$TAPE" ]]; then TAPE="$1"; shift
      else echo "[record-demo] unexpected arg: $1" >&2; usage
      fi ;;
  esac
done

[[ -n "$TAPE" ]] || usage
[[ -f "$TAPE" ]] || { echo "[record-demo] tape not found: $TAPE" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TAPE_ABS="$(cd "$(dirname "$TAPE")" && pwd)/$(basename "$TAPE")"

# Default output: docs/assets/<tape-basename>.gif
if [[ -z "$OUT" ]]; then
  base="$(basename "$TAPE" .tape)"
  OUT="$REPO_ROOT/docs/assets/${base}.gif"
fi

# --- Layer 1: tape lint (defence in depth) ------------------------------
"$SCRIPT_DIR/check-tapes.sh" "$TAPE_ABS"

# --- Layer 2: tooling presence ------------------------------------------
VHS_BIN="$(command -v vhs || true)"
[[ -n "$VHS_BIN" ]] || { echo "[record-demo] vhs not installed. brew install vhs" >&2; exit 1; }

NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || { echo "[record-demo] node not found in PATH" >&2; exit 1; }

GLYPHLING_BIN="$REPO_ROOT/dist/src/bin.js"
if [[ ! -f "$GLYPHLING_BIN" ]]; then
  echo "[record-demo] dist/src/bin.js missing — run 'npm run build' first" >&2
  exit 1
fi

# --- Layer 3: sandboxed env ---------------------------------------------
SANDBOX="$(mktemp -d -t glyphling-demo.XXXXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/home" "$SANDBOX/state" "$SANDBOX/bin"
cp "$TAPE_ABS" "$SANDBOX/recording.tape"

# Symlink dist/ into the sandbox so the GLYPHLING_BIN path is space- and
# tilde-free. The repo path (especially under iCloud Drive's
# `Mobile Documents/com~apple~CloudDocs/`) trips both bash word-splitting AND
# the SEC-007 validator inside `glyphling export`. The sandbox path is always
# safe (`/var/folders/...` or `/tmp/...`).
ln -s "$REPO_ROOT/dist" "$SANDBOX/dist"
SAFE_GLYPHLING_BIN="$SANDBOX/dist/src/bin.js"

# Install a `glyphling` shim on the sandbox PATH so tapes can call
# `glyphling <cmd>` without exposing the bin path.
cat > "$SANDBOX/bin/glyphling" <<EOF
#!/bin/sh
exec node "$SAFE_GLYPHLING_BIN" "\$@"
EOF
chmod +x "$SANDBOX/bin/glyphling"

# Resolve PATH entries for the whitelist. We include only the dirs that host
# the binaries we actually invoke, plus /usr/bin:/bin for core tools vhs may shell out to.
VHS_DIR="$(dirname "$VHS_BIN")"
NODE_DIR="$(dirname "$NODE_BIN")"
SAFE_PATH="$SANDBOX/bin:$VHS_DIR:$NODE_DIR:/usr/bin:/bin"

cd "$SANDBOX"

# env -i wipes the host environment. We re-inject only what vhs and the
# tape's shell need — nothing that identifies the host user.
env -i \
  HOME="$SANDBOX/home" \
  USER="glyphling" \
  LOGNAME="glyphling" \
  HOSTNAME="glyphling-demo" \
  SHELL="/bin/sh" \
  PS1='$ ' \
  PS2='' \
  PROMPT_COMMAND='' \
  TERM="xterm-256color" \
  LC_ALL="C.UTF-8" \
  LANG="C.UTF-8" \
  PATH="$SAFE_PATH" \
  GLYPHLING_HOME="$SANDBOX/state" \
  GLYPHLING_BIN="$SAFE_GLYPHLING_BIN" \
  "$VHS_BIN" recording.tape

# --- Layer 4: collect output --------------------------------------------
# The tape must have written a GIF via `Output <name>.gif` (cwd-relative).
# We accept any single .gif in the sandbox root.
shopt -s nullglob
produced=( "$SANDBOX"/*.gif )
shopt -u nullglob

if [[ ${#produced[@]} -ne 1 ]]; then
  echo "[record-demo] expected exactly one .gif in sandbox, found ${#produced[@]}" >&2
  ls -la "$SANDBOX" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
cp "${produced[0]}" "$OUT"

echo "[record-demo] wrote $OUT"
