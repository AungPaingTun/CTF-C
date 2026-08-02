#!/bin/sh
set -eu

usage() {
  printf 'Usage: %s --target <url> --approve --description-file <file> [--source <dir>] [--time-budget <minutes>] [--action-budget <count>]\n' "$0" >&2
  exit 2
}

target=''
description_file=''
source=''
time_budget=''
action_budget=''
approved=false
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target) [ "$#" -ge 2 ] || usage; target=$2; shift 2 ;;
    --approve) approved=true; shift ;;
    --description-file) [ "$#" -ge 2 ] || usage; description_file=$2; shift 2 ;;
    --source) [ "$#" -ge 2 ] || usage; source=$2; shift 2 ;;
    --time-budget) [ "$#" -ge 2 ] || usage; time_budget=$2; shift 2 ;;
    --action-budget) [ "$#" -ge 2 ] || usage; action_budget=$2; shift 2 ;;
    *) usage ;;
  esac
done

[ -n "$target" ] || { printf 'Target is required\n' >&2; exit 2; }
[ "$approved" = true ] || { printf 'Explicit --approve is required\n' >&2; exit 1; }
[ -n "$description_file" ] || { printf 'Description file is required\n' >&2; exit 2; }

set -- --target "$target" --approve --description-file "$description_file"
[ -n "$source" ] && set -- "$@" --source "$source"
[ -n "$time_budget" ] && set -- "$@" --time-budget "$time_budget"
[ -n "$action_budget" ] && set -- "$@" --action-budget "$action_budget"
record_path=$(CTFC_PROJECT_ROOT="$project_root" node "$script_dir/create_competition_run.mjs" "$@")

description=$(node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).description)' "$record_path")
source_hint=$(node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(r.source_root || "none")' "$record_path")
prompt="Understand this challenge: $description. Source directory: $source_hint. Classify internally, inspect source if provided, otherwise start probing. Use only typed tools, reason after each observation, verify the flag, and stop."
exec env CTFC_COMPETITION_RUN_RECORD="$record_path" pi --no-builtin-tools --offline --no-session --approve "$prompt"
