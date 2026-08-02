#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
real_pi=$(command -v pi)
runtime_root=$(mktemp -d "${TMPDIR:-/tmp}/ctf-c-competition-flow-runtime.XXXXXX")
server_port=$(node -e 'const net=require("net"); const s=net.createServer(); s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port)); s.close();});')
fake_dir=$(mktemp -d "${TMPDIR:-/tmp}/ctf-c-competition-flow-pi.XXXXXX")
fake_pi="$fake_dir/pi"
source_root=$(mktemp -d "${TMPDIR:-/tmp}/ctf-c-competition-flow-source.XXXXXX")
trap 'rm -rf "$runtime_root" "$fake_dir" "$source_root"' EXIT HUP INT TERM
printf '%s\n' '// source fixture' 'export const marker = "source fixture";' >"$source_root/app.js"
mkdir "$source_root/nested"
ln -s app.js "$source_root/symlink.js"
printf '%s\n' '#!/bin/sh' "exec \"$real_pi\" --mode rpc --no-builtin-tools --offline --no-session --approve -e \"$project_root/tests/competition_flow.test.mjs\"" >"$fake_pi"
chmod 755 "$fake_pi"
PATH="$(dirname "$fake_pi"):$PATH" CTFC_COMPETITION_RUNTIME_ROOT="$runtime_root" \
  "$project_root/scripts/run_competition.sh" --target "http://127.0.0.1:$server_port" --approve --description "Stateful Web fixture" --source "$source_root" >/dev/null
printf 'Direct competition flow checks passed without a challenge directory or declaration\n'
