# CTF-C Agent Instructions

Use the direct competition runner as the only solving path. When a user message clearly contains a CTF challenge and exactly one HTTP/HTTPS target URL, the competition extension initializes the private run before the model turn and restricts Pi to the typed competition tools. The root Pi session acts immediately, inspects retained evidence after each meaningful action, revises its approach, verifies any flag against retained evidence, and stops when solved or bounded by the run.

## Operating Contract

- Scripted runs use `--no-builtin-tools`; interactive qualifying challenge messages dynamically restrict the active session to the registered typed tools.
- A qualifying pasted challenge message is the operator authorization for its single extracted target; no repeated permission prompt is required inside that run.
- HTTP requests are limited to the exact same-origin target bound to the run.
- Cookies, state, evidence, and private response bodies are isolated per temporary run.
- Use `inspect_evidence` for retained responses instead of hidden or unbounded access.
- Before every HTTP request, provide a concise evidence summary, leading hypothesis, supporting evidence, smallest experiment, expected observation, confidence, and any remaining untested experiments.
- After each response, use the returned confidence update and do not repeat an equivalent experiment.
- Do not finalize while an evidence-backed hypothesis has an untested experiment and action budget remains.
- A flag is solved only after `verify_flag` confirms it in retained evidence.
- Stop after verification, timeout, action-budget exhaustion, infrastructure failure, or a clear inability to progress.
- Do not trigger competition initialization for ordinary development messages that merely contain URLs.

Do not use browser automation, Docker, external installs, built-in shell/file/network tools, exploit files, or external targets. Never commit flags, cookies, tokens, private evidence, or payloads.
