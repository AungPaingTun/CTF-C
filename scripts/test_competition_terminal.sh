#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
runtime_root=$(mktemp -d "${TMPDIR:-/tmp}/ctf-c-competition-terminal-runtime.XXXXXX")
server_port=$(node -e 'const net=require("net"); const s=net.createServer(); s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port)); s.close();});')
trap 'rm -rf "$runtime_root"' EXIT HUP INT TERM
CTFC_COMPETITION_RUNTIME_ROOT="$runtime_root" \
  CTFC_PROJECT_ROOT="$project_root" \
  node "$project_root/scripts/create_competition_run.mjs" --target "http://127.0.0.1:$server_port" --approve --description "Terminal fixture" >"$runtime_root/record-path"
record_path=$(<"$runtime_root/record-path")
CTFC_COMPETITION_RUN_RECORD="$record_path" \
  pi --mode rpc --no-builtin-tools --offline --no-session --approve \
  -e "$project_root/tests/competition_terminal.test.mjs" <<'EOF'
{"id":"state","type":"get_state"}
EOF
printf 'Competition terminal-result checks passed without external network or Docker\n'
