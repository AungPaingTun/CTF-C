# CTF-C Agent Instructions

Use the direct competition runner as the only solving path. The root Pi session reasons about the supplied Web challenge, acts immediately through typed tools, inspects retained evidence after each meaningful action, revises its approach, verifies any flag against retained evidence, and stops when solved or bounded by the run.

## Operating Contract

- Pi always runs with `--no-builtin-tools`; use only the registered typed tools.
- Remote interaction requires explicit operator authorization via `--approve`.
- HTTP requests are limited to the exact same-origin target bound to the run.
- Cookies, state, evidence, and private response bodies are isolated per temporary run.
- Use `inspect_evidence` for retained responses instead of hidden or unbounded access.
- A flag is solved only after `verify_flag` confirms it in retained evidence.
- Stop after verification, timeout, action-budget exhaustion, infrastructure failure, or a clear inability to progress.

Do not use browser automation, Docker, external installs, built-in shell/file/network tools, exploit files, or external targets. Never commit flags, cookies, tokens, private evidence, or payloads.
