#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
pi --mode rpc --no-builtin-tools --offline --no-session --approve \
  -e "$project_root/tests/competition_launcher.test.mjs" <<'EOF'
{"id":"state","type":"get_state"}
EOF

printf 'Competition launcher checks passed without external network or Docker\n'
