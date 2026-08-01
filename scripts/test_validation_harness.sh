#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)

if "$script_dir/run_cylab_validation.sh" >/dev/null 2>&1; then
  printf 'validation harness accepted missing slug\n' >&2
  exit 1
fi
if "$script_dir/run_cylab_validation.sh" "web-source-audit" >/dev/null 2>&1; then
  printf 'validation harness accepted missing authorization\n' >&2
  exit 1
fi
node "$project_root/tests/validation/validation_report.test.mjs"
if grep -q 'CTFC_STAGE2_TEST_MODE=local-fixture' "$script_dir/run_cylab_validation.sh"; then
  printf 'validation harness enables local-fixture mode\n' >&2
  exit 1
fi
grep -q 'CTFC_STAGE2_NO_SUBMIT=1' "$script_dir/run_cylab_validation.sh"
printf 'Validation harness offline checks passed\n'
