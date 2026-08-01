#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
stderr_file=$(mktemp "${TMPDIR:-/tmp}/ctf-c-stage3-runtime.XXXXXX")
stdout_file=$(mktemp "${TMPDIR:-/tmp}/ctf-c-stage3-runtime-out.XXXXXX")
trap 'rm -f "$stderr_file" "$stdout_file"' EXIT HUP INT TERM

pi --mode rpc --no-builtin-tools --offline --no-session --approve \
  -e "$project_root/tests/stage3_runtime.test.mjs" >"$stdout_file" 2>"$stderr_file" <<'EOF'
{"id":"state","type":"get_state"}
EOF

grep -q '"command":"get_state"' "$stdout_file"
grep -q '^CTF_C_STAGE3_RUNTIME=passed$' "$stderr_file"
printf 'Stage 3 runtime boundary checks passed without external network or Docker\n'
