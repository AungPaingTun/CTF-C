#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
output=$(mktemp "${TMPDIR:-/tmp}/ctf-c-launcher-test.XXXXXX")
trap 'rm -f "$output"' EXIT HUP INT TERM
if pi --mode rpc --no-builtin-tools --offline --no-session --approve \
  -e "$project_root/tests/competition_launcher.test.mjs" >"$output" 2>&1 <<'EOF'
{"id":"state","type":"get_state"}
EOF
then
  pi_status=0
else
  pi_status=$?
fi
cat "$output"
if [ "$pi_status" -ne 0 ] || grep -q 'extension_error' "$output"; then
  exit 1
fi

printf 'Competition launcher checks passed without external network or Docker\n'
