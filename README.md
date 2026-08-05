# CTF-C

CTF-C is a direct Pi runner for explicitly authorized Web CTF challenges. It starts one restricted Pi session, keeps the session state private to one temporary run, and exposes only bounded typed tools for same-origin HTTP, supplied-source analysis, evidence inspection, and evidence-backed flag verification.

## Run a challenge

From the repository root:

```sh
./scripts/run_competition.sh \
  --target https://challenge.example \
  --approve \
  --description "Paste the challenge description here"
```

Add `--source <directory>` when supplied source files are available. Use `--flag-regex <regex>` when the competition flag format is not the default `picoCTF{...}` pattern. The launcher also accepts `--description-file <file>`, `--time-budget <minutes>`, and `--action-budget <count>`.

`--approve` is the explicit operator authorization for the declared target. The target must be an exact HTTP(S) origin; all requests remain on that origin. Pi runs with `--no-builtin-tools` and cannot use shell, file, or network built-ins.

## Active typed tools

- `http_request` — bounded same-origin GET and POST requests with isolated cookies.
- `inspect_evidence` — bounded inspection of retained response evidence.
- `list_source` and `read_source` — bounded, symlink-safe access to an explicitly supplied source directory.
- `run_local_command` — fixed read-only local analysis profiles for supplied source.
- `verify_flag` — verifies the run’s configured flag pattern against retained evidence and writes the verified result.

Runs retain private cookies and response bodies under `.ctf-c/competition-runs/`, which is ignored by Git. Do not commit run records, evidence, cookies, tokens, or flags.

## Direct checks

```sh
./scripts/test_competition_launcher.sh
./scripts/test_competition_flow.sh
```
