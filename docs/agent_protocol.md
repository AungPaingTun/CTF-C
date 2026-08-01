# Agent Protocol

All specialist results must be concise, sanitized, local-source-based, and strict JSON. Do not include flags, credentials, cookies, tokens, source archives, logs, or reusable exploit payloads.

## Auditor JSON

Return exactly one JSON object with `scope_checked`, `evidence`, `hypotheses`, and `remote_action_performed`. Use no Markdown fences or surrounding prose. `evidence` entries contain `path`, `line`, and `fact`. Each hypothesis contains a unique `id`, `rank` 1-3, `confidence` 0-1, `statement`, `evidence_refs`, optional `local_test`, and optional `proposed_remote_action`. Return at most three hypotheses and always set `remote_action_performed` to `false`.

Evidence must describe Web request, data, and trust flows using exact local paths. Auditors must not claim commands or target contact.

## Binary Auditor

Use the Auditor JSON contract. Evidence must identify exact local binary or source paths, relevant functions or regions, execution flow, and trust boundaries. Hypotheses must be testable locally.

## Local Validator

Return the common JSON fields above, plus a `validation` array containing one record:

```json
{
  "scope_checked": ["source/example.c:1-20"],
  "evidence": [],
  "hypotheses": [],
  "validation": [{
    "hypothesis_id": "H1",
    "procedure": "sanitized local procedure",
    "expected": "expected observation",
    "actual": "observed observation",
    "cleanup": "cleanup performed or not required"
  }],
  "remote_action_performed": false
}
```

Write only inside that challenge's `artifacts/` or `exploits/` directories when writing is explicitly permitted by the challenge workflow. After the operator starts a valid, explicitly declared, local-only Compose stack and explicitly authorizes one hypothesis, the only permitted Docker proof is `docker compose -f <declared-compose> exec -T <declared-service> <sanitized-command>`. Do not start or stop the stack, run Docker start, stop, down, up, build, run, exec shell, or reconfiguration; the operator controls lifecycle scripts. Do not use a browser or HTTP endpoint, remote network, secrets or keys, payload delivery, source modification, or reusable exploit artifacts.

## Reviewer

After two failed hypotheses, return the common JSON fields with evidence from local files, challenge the assumptions behind the failed hypotheses, rank at most three alternatives, and include one recommended next local action in `local_test`. Set `remote_action_performed` to `false`.
