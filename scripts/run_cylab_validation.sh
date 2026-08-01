#!/bin/sh
set -eu

[ "$#" -eq 1 ] || { printf 'Usage: %s <challenge-slug>\n' "$0" >&2; exit 2; }
slug=$1
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
[ "${CTFC_CYLAB_AUTHORIZED:-}" = "1" ] || { printf 'Set CTFC_CYLAB_AUTHORIZED=1 for explicit operator authorization\n' >&2; exit 1; }
[ -n "${CTFC_STAGE2_TARGET:-}" ] || { printf 'Set CTFC_STAGE2_TARGET for the manually started authorized instance\n' >&2; exit 1; }

"$script_dir/preflight.sh" "$project_root/challenges/$slug" >/dev/null
validation_root=$(node "$script_dir/validation_report.mjs" --validate-root "$project_root" "${CTFC_VALIDATION_ROOT:-$project_root/results/validation}")
run_id=$(date -u +%Y%m%dT%H%M%SZ)-$$
run_dir="$validation_root/$slug/$run_id"
umask 077
mkdir -p -m 700 "$run_dir"
run_dir_real=$(CDPATH= cd -- "$run_dir" && pwd -P)
case "$run_dir_real" in
  "$validation_root"/*) ;;
  *) printf 'Validation run directory escapes approved root\n' >&2; exit 1 ;;
esac
start_ms=$(node -e 'process.stdout.write(String(Date.now()))')
set +e
env -u CTFC_STAGE2_TEST_MODE CTFC_STAGE2_NO_SUBMIT=1 CTFC_STAGE2_TARGET="$CTFC_STAGE2_TARGET" "$script_dir/run_challenge.sh" "$slug" --target "$CTFC_STAGE2_TARGET" --approve >"$run_dir/stdout.log" 2>"$run_dir/stderr.log"
exit_code=$?
set -e
end_ms=$(node -e 'process.stdout.write(String(Date.now()))')
manifest_path=$(awk -F': ' '/^Stage 3 manifest: /{value=$2} END{if (value) print value}' "$run_dir/stdout.log")
node "$script_dir/validation_report.mjs" "$run_dir" "$slug" "$start_ms" "$end_ms" "$exit_code" "$manifest_path"
printf 'Validation output: %s\n' "$run_dir"
exit "$exit_code"
