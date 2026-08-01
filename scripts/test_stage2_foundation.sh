#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)

node --check "$project_root/.pi/extensions/ctf-c-stage2-core.mjs"
foundation_output=$("$script_dir/run_challenge.sh" "$project_root/tests/fixtures/web-source-audit")

if grep -Eq '(^|[[:space:]])(curl|wget|nc|ssh|docker)([[:space:]]|$)' "$script_dir/run_challenge.sh"; then
  printf 'execution or network command found in foundation runner\n' >&2
  exit 1
fi

printf 'Stage 2 foundation checks passed without execution or network access\n'
