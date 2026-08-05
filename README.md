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

## Real-model replay gate

The opt-in real-model gate runs the maintained HTTP, authentication, WebSocket, derived-flag, and starter fixtures through the actual Pi decision loop. It requires configured provider credentials and is intentionally not part of `npm test`.

```sh
npm run test:real-model -- --provider opencode-go --model deepseek-v4-pro
npm run test:real-model -- --dry-run
```

Reports are written to `reports/replay_real_model_*.json` by default. Each report contains aggregate solved, failed, timeout, infrastructure-failure, and not-solved counts plus per-fixture status, verified flag, elapsed time, actions, confidence, terminal cause, and tool errors. A nonzero exit means at least one fixture was not solved within its budget. Use `--report <path>`, `--fixtures <comma-separated names>`, `--time-budget <minutes>`, `--action-budget <count>`, or `--max-duration-ms <milliseconds>` to bound or select a run. Reports can contain verified flags and must not be committed.

## Browser fixtures

The typed `browser_action` tool uses one persistent Playwright Chromium context per competition run. It stays on the bound origin, blocks popups and downloads, and records each action as inspectable evidence. The test runs inside Pi's RPC environment (requires `pi` on PATH). Install the dependency and browser binary once:

```sh
npm install
npm run install:browser
npm run test:browser
```

Include the browser-required fixture in the opt-in real-model gate with `npm run test:real-model -- --include-browser`. Browser screenshots are returned as base64 and are never written by the tool. Script evaluation is limited to code that exactly appears in retained current-run page-script evidence.

## Exploration budget

Unknown GET reconnaissance routes use a default five-point per-run exploration budget. Evidence-derived links, forms, redirects, scripts, source clues, and route-family mutations are free. Unknown routes must include an `exploration_score` from `0.0` to `1.0` and a brief `exploration_justification`; scores below `0.3` are rejected while an active hypothesis remains. A meaningful new route clue or response fact refunds one point, and state/reports record budget usage, remaining points, route families, and exploration decisions.

## Hypothesis board

Every evidence record returns a persisted structured `hypothesis_board` with up to 3 ranked active hypotheses. Each hypothesis tracks:

- `id`, `rank`, `family` (auth_bypass, idor, ssti, injection, source_disclosure, upload_execution, protocol_transition, unknown)
- `branch` (confirmation, extraction, privilege_boundary)
- `confidence` (0.0-1.0), `summary`, `next_experiment`
- `supporting_evidence_ids`, `disconfirming_evidence_ids`

The rank-1 hypothesis is the authoritative primary; its `next_experiment` drives every action. After every meaningful HTTP/WebSocket/browser response, the board is automatically updated: confidence adjusts by evidence tier (authenticated_response > server_metadata > redirect_targets > html_forms > comments > headers > error_messages > timing > speculation), hypotheses are retired at confidence < 0.2 or after two failed experiments in the same family+branch without new evidence, and the strongest active hypothesis is promoted to rank 1. Active hypotheses are capped at 3; excess are retired weakest-first. Retired hypotheses are stored in `retired_hypotheses` and are not re-promoted unless new hard evidence contradicts disconfirming evidence. When no active hypotheses remain, an "unknown" family hypothesis is spawned from the strongest retained evidence.

The board appears in evidence responses, execution state, replay summaries, and the final result.
