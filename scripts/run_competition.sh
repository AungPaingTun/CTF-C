#!/bin/sh
set -eu

usage() {
  printf 'Usage: %s --target <url> --approve [--description <text> | --description-file <file>] [--source <dir>] [--flag-regex <regex>] [--time-budget <minutes>] [--action-budget <count>]\n' "$0" >&2
  exit 2
}

target=''
description_file=''
description=''
source=''
time_budget=''
action_budget=''
flag_regex=''
approved=false
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
caller_root=$(pwd -P)

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target) [ "$#" -ge 2 ] || usage; target=$2; shift 2 ;;
    --approve) approved=true; shift ;;
    --description-file) [ "$#" -ge 2 ] || usage; description_file=$2; shift 2 ;;
    --description) [ "$#" -ge 2 ] || usage; description=$2; shift 2 ;;
    --source) [ "$#" -ge 2 ] || usage; source=$2; shift 2 ;;
    --time-budget) [ "$#" -ge 2 ] || usage; time_budget=$2; shift 2 ;;
    --action-budget) [ "$#" -ge 2 ] || usage; action_budget=$2; shift 2 ;;
    --flag-regex) [ "$#" -ge 2 ] || usage; flag_regex=$2; shift 2 ;;
    *) usage ;;
  esac
done

case "$source" in
  ''|/*) ;;
  *) source="$caller_root/$source" ;;
esac
case "$description_file" in
  ''|/*) ;;
  *) description_file="$caller_root/$description_file" ;;
esac

[ -n "$target" ] || { printf 'Target is required\n' >&2; exit 2; }
[ "$approved" = true ] || { printf 'Explicit --approve is required\n' >&2; exit 1; }
[ -n "$description" ] && [ -n "$description_file" ] && { printf 'Use either --description or --description-file\n' >&2; exit 2; }

[ -n "$description" ] && set -- --target "$target" --approve --description "$description"
[ -z "$description" ] && [ -n "$description_file" ] && set -- --target "$target" --approve --description-file "$description_file"
[ -z "$description" ] && [ -z "$description_file" ] && set -- --target "$target" --approve --description "Direct Web competition run"
[ -n "$source" ] && set -- "$@" --source "$source"
[ -n "$time_budget" ] && set -- "$@" --time-budget "$time_budget"
[ -n "$action_budget" ] && set -- "$@" --action-budget "$action_budget"
[ -n "$flag_regex" ] && set -- "$@" --flag-regex "$flag_regex"
record_path=$(CTFC_PROJECT_ROOT="$project_root" node "$script_dir/create_competition_run.mjs" "$@")

cd "$project_root"
description=$(node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).description)' "$record_path")
source_hint=$(node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(r.source_root || "none")' "$record_path")
prompt="Direct 15-minute Web solve, not a source-audit workflow. Make the first same-origin HTTP request immediately; do not inspect an empty optional source directory. Use response previews first, and inspect retained evidence only when a response is truncated or form/link/body detail is needed. Preserve and use cookie state. After discovering a concrete exploit primitive, perform its corresponding state transition before guessing unrelated paths. For a leaked admin session, adopt it from the retained evidence, request the authenticated page, then verify the flag. Treat failed endpoint guesses as evidence to pivot, not a reason to repeat broad reconnaissance. Verify a flag only from retained evidence. If unable to progress, call finalize_result with not_solved and a concise safe reason. Challenge: $description. Optional source directory: $source_hint."
if env CTFC_COMPETITION_RUN_RECORD="$record_path" pi --no-builtin-tools --offline --no-session --approve "$prompt"; then
  pi_status=0
else
  pi_status=$?
fi
node "$script_dir/finalize_competition_run.mjs" "$record_path" "$pi_status"
exit "$pi_status"
