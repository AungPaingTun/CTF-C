#!/bin/sh
set -eu

[ "$#" -eq 1 ] || { printf 'Usage: %s <challenge-dir>\n' "$0" >&2; exit 2; }
[ -n "${1:-}" ] || { printf 'Challenge directory is required\n' >&2; exit 2; }
dir=$1
[ -d "$dir" ] || { printf 'Missing challenge directory: %s\n' "$dir" >&2; exit 1; }
challenges_root=$(CDPATH= cd -- "$(dirname "$0")/../challenges" && pwd -P)
fixtures_root=$(CDPATH= cd -- "$(dirname "$0")/../tests/fixtures" && pwd -P)
resolved_dir=$(CDPATH= cd -- "$dir" && pwd -P)
case "$resolved_dir" in
  "$challenges_root"/*|"$fixtures_root"/*) ;;
  *) printf 'Challenge directory must be inside %s or offline fixtures under %s\n' "$challenges_root" "$fixtures_root" >&2; exit 1 ;;
esac
[ -f "$dir/challenge.md" ] || { printf 'Missing challenge.md\n' >&2; exit 1; }
[ -d "$dir/artifacts" ] && [ -d "$dir/exploits" ] && [ -d "$dir/source" ] || { printf 'Missing required challenge directories\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Category:\*\*[[:space:]]*`(web|pwn|reverse|surprise)`' "$dir/challenge.md" || { printf 'Invalid or missing category declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Local Docker Compose:\*\*[[:space:]]*`[^`]+`' "$dir/challenge.md" || { printf 'Missing Local Docker Compose declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Flag regex:\*\*[[:space:]]*`[^`]+`' "$dir/challenge.md" || { printf 'Missing Flag regex declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Default time budget minutes:\*\*[[:space:]]*`[1-9][0-9]*`' "$dir/challenge.md" || { printf 'Invalid or missing default time budget declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Maximum time budget minutes:\*\*[[:space:]]*`[1-9][0-9]*`' "$dir/challenge.md" || { printf 'Invalid or missing maximum time budget declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Default action budget:\*\*[[:space:]]*`[1-9][0-9]*`' "$dir/challenge.md" || { printf 'Invalid or missing default action budget declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Maximum action budget:\*\*[[:space:]]*`[1-9][0-9]*`' "$dir/challenge.md" || { printf 'Invalid or missing maximum action budget declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Allowed HTTP methods:\*\*[[:space:]]*`[^`]+`' "$dir/challenge.md" || { printf 'Missing Allowed HTTP methods declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Allowed action kinds:\*\*[[:space:]]*`[^`]+`' "$dir/challenge.md" || { printf 'Missing Allowed action kinds declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Allowed host pattern:\*\*[[:space:]]*`[^`]+`' "$dir/challenge.md" || { printf 'Missing Allowed host pattern declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Per-run approval required:\*\*[[:space:]]*`true`' "$dir/challenge.md" || { printf 'Per-run approval must be required\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Time budget:\*\*[[:space:]]*`(15 minutes|30 minutes)`' "$dir/challenge.md" || { printf 'Invalid or missing time budget\n' >&2; exit 1; }

if grep -Eq '^-[[:space:]]*\*\*(User approval record|Authorized|Remote actions allowed|Target URL|Allowed hosts):' "$dir/challenge.md"; then
  printf 'Live target or authorization fields are forbidden in challenge.md\n' >&2
  exit 1
fi
if find "$dir" -type f \( -name '.env' -o -name '*.pem' -o -name '*.key' -o -name '*.token' -o -name '*.cookie' -o -name 'cookies.txt' \) -print | grep -q .; then
  printf 'Obvious secret-like file detected\n' >&2
  exit 1
fi
budget=$(grep -Eo '[0-9]+ minutes' "$dir/challenge.md")
printf 'Preflight passed: %s\nTime budget: %s\nNetwork access: not performed\nPer-run approval: required\n' "$dir" "$budget"
