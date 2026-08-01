# CTF-C Agent Instructions

## Scope

This is a safe Stage 4 Pi workspace for offline, source-assisted Web exploitation, Binary exploitation, and one surprise category. Crypto and forensics are explicitly out of scope. Do not add browser automation, Docker automation beyond the declared local Compose lifecycle scripts, exploit delivery, an API server, a UI, or a Python rule-based planner.

## Delegation

- Maximum one active subagent. Never run agents in parallel or with worktree isolation.
- The root Pi session is the coordinator because it loads this file. Do not spawn `.pi/agents/coordinator.md` as a child.
- The coordinator is the only role that may request remote interaction, and only after explicit user confirmation of authorization.
- The coordinator classifies first and routes Web to `web_auditor`, or Pwn/Reverse to `binary_auditor`.
- Surprise-category work uses generic triage and requires user approval before adding a skill.
- The coordinator may spawn one specialist level; specialist agents may not spawn children.
- Run `scripts/route_challenge.sh` before starting Pi; it performs offline routing without invoking Pi or a model.
- Local Docker commands may operate only on an explicitly declared Compose file inside one `challenges/<slug>/` directory.
- Narrow exception: after the operator starts a valid, explicitly declared, local-only Compose stack and explicitly authorizes one hypothesis, `local_validator` may run only `docker compose -f <declared-compose> exec -T <declared-service> <sanitized-command>` for that bounded proof.
- Pi must not run Docker start, stop, down, up, build, run, exec shell, or reconfiguration; the operator controls lifecycle scripts.
- Raw subagent transcripts are disabled by project settings.

## Coordinator Contract

- Call `begin_investigation` first and follow its route.
- Select exactly one foreground auditor: Web -> `web_auditor`; Pwn/Reverse -> `binary_auditor`; Surprise -> coordinator-only triage.
- Never schedule, parallelize, or delegate from an auditor.
- Require strict JSON auditor output, then call `record_hypotheses` before any execution action.
- Use one recorded hypothesis and one typed action at a time; re-evaluate every result.
- Never invent IDs or claim success from prose, previews, or model state.
- Call `verify_flag` before `finalize_result` with `solved`, finalize every terminal state, and stop after finalization.
- Stop on verification, deadline, budget exhaustion, three no-progress actions, infrastructure failure, explicit not-solved, or interruption.
- Do not use built-in shell, file, or network tools; use only typed Stage 2 tools.

## Safety

Require explicit approval before login, registration, payload submission, browser automation, external hosting, tunnels, installing tools, public uploads, or destructive actions. A local proof is required before a remote attempt. Piolium is documented only as a future optional local-source audit tool; do not invoke it.

Never commit flags, source archives, cookies, tokens, API keys, artifacts, logs, or exploit payloads. Keep permanent notes sanitized.

The exception never permits browser or HTTP endpoint contact, remote network access, secrets or keys, payload delivery, source modification, or reusable exploit artifacts.

## Models and time

Auditors inherit the configured free/fast Pi model. The coordinator may use Luna Medium only as a human-selected escalation for difficult reasoning, source-review synthesis, or final exploit review. Follow the 15-minute and 30-minute budgets in `docs/benchmark_protocol.md`.

## Workspace conventions

- Pi is the runtime. Start it with `pi` from this directory.
- Use `scripts/new_challenge.sh` to create challenge workspaces, `scripts/preflight.sh` to validate them, and `scripts/route_challenge.sh` to select the route before analysis.
- Skills are installed only through skills.sh from `ljagiello/ctf-skills`: `solve-challenge`, `ctf-web`, `ctf-pwn`, and `ctf-reverse`.
- Piolium is not installed or invoked; it is documented only as a possible later local-source audit tool.
