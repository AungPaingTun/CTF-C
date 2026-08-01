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
grep -Eq '^-[[:space:]]*\*\*Target authorization:\*\*[[:space:]]*`(local-only|remote-authorized)`' "$dir/challenge.md" || { printf 'Invalid or missing target authorization declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Target:\*\*[[:space:]]*`(local-source-only|authorized-target)`' "$dir/challenge.md" || { printf 'Invalid or missing target declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Remote status:\*\*[[:space:]]*`(local-only|remote-authorized)`' "$dir/challenge.md" || { printf 'Invalid or missing remote status declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Authorized remote actions:\*\*[[:space:]]*`[^`]+`' "$dir/challenge.md" || { printf 'Missing authorized remote actions declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*User approval record:\*\*[[:space:]]*`(not approved|approved[^`]*)`' "$dir/challenge.md" || { printf 'Invalid or missing user approval record\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Local Docker Compose:\*\*[[:space:]]*`[^`]+`' "$dir/challenge.md" || { printf 'Missing Local Docker Compose declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Authorized:\*\*[[:space:]]*`(true|false)`' "$dir/challenge.md" || { printf 'Missing Authorized declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Remote actions allowed:\*\*[[:space:]]*`(true|false)`' "$dir/challenge.md" || { printf 'Missing Remote actions allowed declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Target URL:\*\*[[:space:]]*`[^`]+`' "$dir/challenge.md" || { printf 'Missing Target URL declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Allowed hosts:\*\*[[:space:]]*`[^`]+`' "$dir/challenge.md" || { printf 'Missing Allowed hosts declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Allowed HTTP methods:\*\*[[:space:]]*`[^`]+`' "$dir/challenge.md" || { printf 'Missing Allowed HTTP methods declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Allowed action kinds:\*\*[[:space:]]*`[^`]+`' "$dir/challenge.md" || { printf 'Missing Allowed action kinds declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Time budget minutes:\*\*[[:space:]]*`[1-9][0-9]*`' "$dir/challenge.md" || { printf 'Invalid or missing Time budget minutes declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Action budget:\*\*[[:space:]]*`[1-9][0-9]*`' "$dir/challenge.md" || { printf 'Invalid or missing Action budget declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Flag regex:\*\*[[:space:]]*`[^`]+`' "$dir/challenge.md" || { printf 'Missing Flag regex declaration\n' >&2; exit 1; }
grep -Eq '^-[[:space:]]*\*\*Time budget:\*\*[[:space:]]*`(15 minutes|30 minutes)`' "$dir/challenge.md" || { printf 'Invalid or missing time budget\n' >&2; exit 1; }

if grep -Eq '^-[[:space:]]*\*\*Authorized:\*\*[[:space:]]*`false`' "$dir/challenge.md" && ! grep -Eq '^-[[:space:]]*\*\*Remote actions allowed:\*\*[[:space:]]*`false`' "$dir/challenge.md"; then
  printf 'Authorized and Remote actions allowed must agree\n' >&2
  exit 1
fi
if grep -Eq '^-[[:space:]]*\*\*Authorized:\*\*[[:space:]]*`true`' "$dir/challenge.md" && ! grep -Eq '^-[[:space:]]*\*\*Remote actions allowed:\*\*[[:space:]]*`true`' "$dir/challenge.md"; then
  printf 'Authorized and Remote actions allowed must agree\n' >&2
  exit 1
fi
if find "$dir" -type f \( -name '.env' -o -name '*.pem' -o -name '*.key' -o -name '*.token' -o -name '*.cookie' -o -name 'cookies.txt' \) -print | grep -q .; then
  printf 'Obvious secret-like file detected\n' >&2
  exit 1
fi
budget=$(grep -Eo '15 minutes|30 minutes' "$dir/challenge.md")
if grep -Eq '^-[[:space:]]*\*\*Authorized:\*\*[[:space:]]*`true`' "$dir/challenge.md"; then
  remote_message='approval recorded; preflight does not authorize'
else
  remote_message='blocked'
fi
printf 'Preflight passed: %s\nTime budget: %s\nNetwork access: not performed\nRemote actions: %s\n' "$dir" "$budget" "$remote_message"
