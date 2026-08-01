#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
stderr_file=$(mktemp "${TMPDIR:-/tmp}/ctf-c-stage2-rpc-stderr.XXXXXX")
stdout_file=$(mktemp "${TMPDIR:-/tmp}/ctf-c-stage2-rpc-stdout.XXXXXX")
trap 'rm -f "$stderr_file" "$stdout_file"' EXIT HUP INT TERM

printf '%s\n' '{"id":"state","type":"get_state"}' |
  pi --mode rpc --no-builtin-tools --offline --no-session --approve \
    -e "$project_root/tests/stage2_tool_probe.ts" >"$stdout_file" 2>"$stderr_file"

grep -q '"command":"get_state"' "$stdout_file"
tool_line=$(grep '^CTF_C_TOOL_LIST=' "$stderr_file")
grep -q '^CTF_C_INVALID_SLUGS=rejected$' "$stderr_file"
grep -q '^CTF_C_SYMLINKS=rejected$' "$stderr_file"
grep -q '^CTF_C_STATUS=metadata-read$' "$stderr_file"
grep -q '^CTF_C_INVESTIGATION=ready$' "$stderr_file"
printf '%s\n' "$tool_line" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const tools = JSON.parse(input.trim().slice("CTF_C_TOOL_LIST=".length));
  const allowed = ["Agent", "begin_investigation", "finalize_result", "get_subagent_result", "http_request", "record_hypotheses", "run_local_command", "stage2_status", "steer_subagent", "verify_flag", "write_exploit"];
  if (!allowed.every((name) => tools.includes(name))) process.exit(1);
  if (tools.filter((name) => name === "stage2_status").length !== 1) process.exit(1);
  if (tools.some((name) => !allowed.includes(name))) process.exit(1);
  if (tools.some((name) => /browser|network/i.test(name))) process.exit(1);
  process.stdout.write(`restricted tools: ${tools.join(",")}\n`);
});
'

grep -q '^extensions: false$' "$project_root/.pi/agents/source_auditor.md"
grep -q '^extensions: false$' "$project_root/.pi/agents/web_auditor.md"
grep -q '^extensions: false$' "$project_root/.pi/agents/binary_auditor.md"
grep -q '^extensions: false$' "$project_root/.pi/agents/reviewer.md"
grep -q '^tools: read, grep, find, ls$' "$project_root/.pi/agents/source_auditor.md"
grep -q '^tools: read, grep, find, ls$' "$project_root/.pi/agents/web_auditor.md"
grep -q '^tools: read, grep, find, ls$' "$project_root/.pi/agents/binary_auditor.md"
grep -q '^tools: read, grep, find, ls$' "$project_root/.pi/agents/reviewer.md"
grep -q '^allowed_subagents: none$' "$project_root/.pi/agents/source_auditor.md"
grep -q '^allowed_subagents: none$' "$project_root/.pi/agents/web_auditor.md"
grep -q '^allowed_subagents: none$' "$project_root/.pi/agents/binary_auditor.md"
grep -q '^allowed_subagents: none$' "$project_root/.pi/agents/reviewer.md"
! grep -Eq 'stage2_status|begin_investigation|record_hypotheses|http_request|run_local_command|write_exploit|verify_flag|finalize_result' "$project_root/.pi/agents/source_auditor.md" "$project_root/.pi/agents/web_auditor.md" "$project_root/.pi/agents/binary_auditor.md" "$project_root/.pi/agents/reviewer.md"

if grep -Eq '(^|[[:space:]])(curl|wget|nc|ssh)([[:space:]]|$)' "$project_root/.pi/extensions/ctf-c-stage2-core.mjs"; then
  printf 'network utility found in stage2 extension\n' >&2
  exit 1
fi

printf 'restricted Pi smoke test passed without a model call or network request\n'
