#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
runtime_root=$(mktemp -d "${TMPDIR:-/tmp}/ctf-c-competition-initialize-runtime.XXXXXX")
trap 'rm -rf "$runtime_root"' EXIT HUP INT TERM
CTFC_COMPETITION_RUNTIME_ROOT="$runtime_root" \
  CTFC_PROJECT_ROOT="$project_root" \
  pi --mode rpc --offline --no-session --approve \
  -e "$project_root/tests/competition_initialize.test.mjs" <<'EOF'
{"id":"state","type":"get_state"}
EOF
printf 'Interactive competition initialization checks passed without network\n'
