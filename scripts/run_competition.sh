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

description=$(node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).description)' "$record_path")
source_hint=$(node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(r.source_root || "none")' "$record_path")
prompt="Solve this Web CTF challenge directly: $description. Optional source directory: $source_hint. Use typed tools only, inspect evidence after requests, reason and revise after each result, verify the flag from retained evidence, and stop."
exec env CTFC_COMPETITION_RUN_RECORD="$record_path" pi --no-builtin-tools --offline --no-session --approve "$prompt"
