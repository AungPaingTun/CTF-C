#!/bin/sh
set -eu

[ "$#" -eq 1 ] || { printf 'Usage: %s <challenge-dir>\n' "$0" >&2; exit 2; }
dir=$1
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)

"$script_dir/preflight.sh" "$dir" >/dev/null
route_output=$("$script_dir/route_challenge.sh" "$dir")
printf '%s\n' "$route_output"
printf 'Foundation state: ready for source audit only\n'
printf 'No HTTP, TCP, cookies, command execution, Docker execution, exploit writing, evidence storage, flag verification, or final result logic performed\n'
