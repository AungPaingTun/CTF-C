#!/bin/sh
set -eu

[ "$#" -ge 1 ] || { printf 'Usage: %s <challenge-slug> [--target <url> --approve]\n' "$0" >&2; exit 2; }
slug=$1
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
shift
target=''
approved=false
runtime_root=${CTFC_RUNTIME_ROOT:-}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --target) [ "$#" -ge 2 ] || { printf '%s requires a value\n' "$1" >&2; exit 2; }; target=$2; shift 2 ;;
    --approve) approved=true; shift ;;
    --runtime-root) [ "$#" -ge 2 ] || { printf '%s requires a value\n' "$1" >&2; exit 2; }; runtime_root=$2; shift 2 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done
if [ -d "$slug" ]; then
  dir=$(CDPATH= cd -- "$slug" && pwd -P)
  slug=$(basename "$dir")
else
  dir="$project_root/challenges/$slug"
fi

"$script_dir/preflight.sh" "$dir" >/dev/null
route_output=$("$script_dir/route_challenge.sh" "$dir")
printf '%s\n' "$route_output"
if [ -z "$target" ]; then
  printf 'Foundation state: ready for source audit only\n'
  printf 'No runtime manifest created; provide --target and --approve for a bounded run\n'
  exit 0
fi
[ "$approved" = true ] || { printf 'Explicit --approve is required with --target\n' >&2; exit 1; }
manifest_path=$(node "$script_dir/create_stage3_manifest.mjs" "$project_root" "$slug" "$target" approved "$runtime_root")
printf 'Stage 3 manifest: %s\n' "$manifest_path"
coordinator_contract='Call begin_investigation first. Follow its route, run exactly one foreground read-only auditor, require strict JSON, call record_hypotheses before one typed action at a time, re-evaluate after each result, verify_flag before solved, finalize every terminal state, and stop after finalization. Use no built-in tools, parallelism, background scheduling, or invented IDs.'
exec env CTFC_STAGE2_MANIFEST="$manifest_path" pi --no-builtin-tools --offline --no-session --approve "$coordinator_contract"
