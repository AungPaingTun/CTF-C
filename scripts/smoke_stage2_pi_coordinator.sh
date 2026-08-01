#!/bin/sh
set -eu

[ "$#" -eq 1 ] || { printf 'Usage: %s <challenge-slug>\n' "$0" >&2; exit 2; }
slug=$1
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
challenge_dir="$project_root/challenges/$slug"
[ -n "${CTFC_STAGE2_TARGET:-}" ] || { printf 'Set CTFC_STAGE2_TARGET; target input is launcher-controlled and not a command-line argument\n' >&2; exit 2; }

"$script_dir/preflight.sh" "$challenge_dir" >/dev/null
unset CTFC_STAGE2_TEST_MODE
exec "$script_dir/run_challenge.sh" "$slug" --target "$CTFC_STAGE2_TARGET" --approve
