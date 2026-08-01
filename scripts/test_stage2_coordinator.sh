#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
stderr_file=$(mktemp "${TMPDIR:-/tmp}/ctf-c-stage2-coordinator.XXXXXX")
stdout_file=$(mktemp "${TMPDIR:-/tmp}/ctf-c-stage2-coordinator-out.XXXXXX")
trap 'rm -f "$stderr_file" "$stdout_file"' EXIT HUP INT TERM

CTFC_STAGE2_TEST_MODE=local-fixture pi --mode rpc --no-builtin-tools --offline --no-session --approve \
  -e "$project_root/tests/stage2_coordinator.test.mjs" >"$stdout_file" 2>"$stderr_file" <<'EOF'
{"id":"state","type":"get_state"}
EOF

grep -q '"command":"get_state"' "$stdout_file"
grep -q '^CTF_C_COORDINATOR=passed$' "$stderr_file"
printf 'Stage 2 coordinator contract checks passed sequentially\n'
