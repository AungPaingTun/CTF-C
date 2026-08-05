#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
real_pi=$(command -v pi)
runtime_root=$(mktemp -d "${TMPDIR:-/tmp}/ctf-c-competition-decision-runtime.XXXXXX")
fake_dir=$(mktemp -d "${TMPDIR:-/tmp}/ctf-c-competition-decision-pi.XXXXXX")
fake_pi="$fake_dir/pi"
server_port=$(node -e 'const net=require("net"); const s=net.createServer(); s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port)); s.close();});')
trap 'rm -rf "$runtime_root" "$fake_dir"' EXIT HUP INT TERM
printf '%s\n' '#!/bin/sh' "exec \"$real_pi\" --mode rpc --no-builtin-tools --offline --no-session --approve -e \"$project_root/tests/competition_decision_harness.test.mjs\"" >"$fake_pi"
chmod 755 "$fake_pi"
PATH="$(dirname "$fake_pi"):$PATH" CTFC_COMPETITION_RUNTIME_ROOT="$runtime_root" \
  "$project_root/scripts/run_competition.sh" --target "http://127.0.0.1:$server_port" --approve --description "Decision harness fixture" >/dev/null
printf 'Competition decision harness checks passed without a live target\n'
