#!/bin/sh
set -eu

usage() {
  printf 'Usage: %s [--install]\n' "$0" >&2
  exit 2
}

install=false
case "${1:-}" in
  '') ;;
  --install) install=true ;;
  *) usage ;;
esac
[ "$#" -le 1 ] || usage

command='npx --yes skills add ljagiello/ctf-skills --skill solve-challenge ctf-web ctf-pwn ctf-reverse --agent pi --copy --yes'
printf 'Reviewed skills source: ljagiello/ctf-skills\n'
printf 'Approved skills: solve-challenge ctf-web ctf-pwn ctf-reverse\n'
printf 'Dry-run command: %s\n' "$command"

if [ "$install" = true ]; then
  printf 'Installing approved skills because --install was explicitly supplied.\n'
  exec sh -c "$command"
fi

printf 'No installation performed. Re-run with --install to execute the command.\n'
