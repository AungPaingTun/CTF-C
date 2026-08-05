#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)

real_pi=$(command -v pi)
total=0
passed=0

run_wrapper() {
  local label="$1"
  local script="$2"
  total=$((total + 1))
  if "$script" >/dev/null 2>&1; then
    printf 'PASS  %s\n' "$label"
    passed=$((passed + 1))
  else
    printf 'FAIL  %s\n' "$label"
  fi
}

run_orphan() {
  local label="$1"
  local test_file="$2"
  total=$((total + 1))

  local runtime_root
  runtime_root=$(mktemp -d "${TMPDIR:-/tmp}/ctf-c-${label}-runtime.XXXXXX")
  local fake_dir
  fake_dir=$(mktemp -d "${TMPDIR:-/tmp}/ctf-c-${label}-pi.XXXXXX")
  local fake_pi="$fake_dir/pi"
  local server_port
  server_port=$(node -e 'const net=require("net"); const s=net.createServer(); s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port)); s.close();});')
  trap 'rm -rf "$runtime_root" "$fake_dir"' EXIT HUP INT TERM

  printf '%s\n' '#!/bin/sh' "exec \"$real_pi\" --mode rpc --no-builtin-tools --offline --no-session --approve -e \"$project_root/tests/${test_file}\"" >"$fake_pi"
  chmod 755 "$fake_pi"

  if PATH="$(dirname "$fake_pi"):$PATH" CTFC_COMPETITION_RUNTIME_ROOT="$runtime_root" \
    "$project_root/scripts/run_competition.sh" --target "http://127.0.0.1:$server_port" --approve --description "$label fixture" >/dev/null 2>&1; then
    printf 'PASS  %s\n' "$label"
    passed=$((passed + 1))
  else
    printf 'FAIL  %s\n' "$label"
  fi

  rm -rf "$runtime_root" "$fake_dir"
  trap - EXIT HUP INT TERM
}

# Existing wrapper scripts
for script in "$project_root"/scripts/test_competition_*.sh; do
  label=$(basename "$script" .sh | sed 's/^test_competition_//')
  run_wrapper "$label" "$script"
done

# Orphaned test files
run_orphan "derived_flag"       "derived_flag.test.mjs"
run_orphan "exploration_budget" "exploration_budget.test.mjs"
run_orphan "json_token_flag"    "json_token_flag.test.mjs"
run_orphan "p10_websocket"      "p10_websocket.test.mjs"
run_orphan "p11_tls"            "p11_tls.test.mjs"
run_orphan "raw_xml_request"    "raw_xml_request.test.mjs"

# watchdog_preflight creates its own run and spawns run_competition.sh as a subprocess;
# it must run without a pre-initialized competition run.
run_watchdog_preflight() {
  local label="watchdog_preflight"
  total=$((total + 1))

  local runtime_root
  runtime_root=$(mktemp -d "${TMPDIR:-/tmp}/ctf-c-${label}-runtime.XXXXXX")
  trap 'rm -rf "$runtime_root"' EXIT HUP INT TERM

  if "$real_pi" --mode rpc --no-builtin-tools --offline --no-session --approve -e "$project_root/tests/watchdog_preflight.test.mjs" >/dev/null 2>&1; then
    printf 'PASS  %s\n' "$label"
    passed=$((passed + 1))
  else
    printf 'FAIL  %s\n' "$label"
  fi

  rm -rf "$runtime_root"
  trap - EXIT HUP INT TERM
}
run_watchdog_preflight

printf '\n%d/%d tests passed\n' "$passed" "$total"
[ "$passed" -eq "$total" ]
