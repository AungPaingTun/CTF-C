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
grep -Eq '^-[[:space:]]*\*\*Target authorization:\*\*[[:space:]]*`local-only`' "$dir/challenge.md" || { printf 'Stage 2 requires Target authorization: local-only\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Target:\*\*[[:space:]]*`local-source-only`' "$dir/challenge.md" || { printf 'Stage 2 requires Target: local-source-only\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Remote status:\*\*[[:space:]]*`local-only`' "$dir/challenge.md" || { printf 'Stage 2 requires Remote status: local-only\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Authorized remote actions:\*\*[[:space:]]*`[^`]+`' "$dir/challenge.md" || { printf 'Missing authorized remote actions declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*User approval record:\*\*[[:space:]]*`not approved`' "$dir/challenge.md" || { printf 'Stage 2 requires User approval record: not approved\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Local Docker Compose:\*\*[[:space:]]*`[^`]+`' "$dir/challenge.md" || { printf 'Missing Local Docker Compose declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Time budget:\*\*[[:space:]]*`(15 minutes|30 minutes)`' "$dir/challenge.md" || { printf 'Invalid or missing time budget\n' >&2; exit 1; }

if find "$dir" -type f \( -name '.env' -o -name '*.pem' -o -name '*.key' -o -name '*.token' -o -name '*.cookie' -o -name 'cookies.txt' \) -print | grep -q .; then
  printf 'Obvious secret-like file detected\n' >&2
  exit 1
fi
budget=$(grep -Eo '15 minutes|30 minutes' "$dir/challenge.md")
printf 'Preflight passed: %s\nTime budget: %s\nNetwork access: not performed\nRemote actions: blocked\n' "$dir" "$budget"
