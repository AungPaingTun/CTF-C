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

The `browser_action` tool provides Playwright-based browser automation restricted to the authorized origin; popups, downloads, and off-origin navigation are blocked. Do not use Docker, external installs, built-in shell/file/network tools, exploit files, or external targets. Never commit flags, cookies, tokens, private evidence, or payloads.

## Active typed tools

- `http_request` — bounded same-origin GET/POST with isolated cookies.
- `websocket_exchange` — bounded same-origin WebSocket exchange supported by retained HTTP evidence.
- `browser_action` — Playwright-based browser automation restricted to the authorized origin.
- `start_competition_run` — initialize or inspect the private exact-origin competition run.
- `inspect_evidence` — bounded inspection of retained response evidence.
- `list_source` — list one bounded supplied-source directory.
- `read_source` — read one bounded range from a supplied source file.
- `search_source` — search supplied source recursively for one bounded literal string.
- `compute_digest` — compute one bounded deterministic digest.
- `derive_binary_evidence` — derive bounded private evidence from retained bytes via XOR transform.
- `run_local_command` — fixed read-only local analysis profiles for supplied source: `file`, `strings`, `readelf`, `objdump`, `nm`, `sha256`, `xxd`, `hexdump`, `base64`, `grep`, `ltrace`, `strace`, `python3`, `dd`, `unzip`, `tar`, `head`, `tail`, `wc`, `sort`, `cut`, `tr` (argv-only, 10s timeout, output capped, restricted to the run directory).
- `replace_session_cookie` — replace one named cookie for the exact target origin.
- `adopt_session_cookie` — adopt a named account session from GET /sessions evidence.
- `verify_flag` — verify a flag against retained evidence and persist the solved result.
- `finalize_result` — persist a terminal non-solved result when the solve cannot continue.
- `write_work_file` — write a Python script or data file into the sandboxed work directory.
- `run_python` — execute a previously written Python script and return stdout/stderr as evidence; optional `input_files` copies up to 4 files from the source, private-evidence, or work directories into `work/` so the script can open them by filename.
- `tcp_connect` — bounded TCP socket to the authorized origin host (host/port, raw or `0x`-hex data, capped read, 1–30s timeout) for binary/pwn service interaction.

## Reversing & binary challenges

**CRITICAL — BINARY CHALLENGE WORKFLOW ORDER: Before connecting to ANY remote service, you MUST:**

1. **Read the source code first** using `read_source` on the .c file — identify buffer sizes, struct layouts, vulnerable functions, find the win/flag/hidden function name, understand the exact memory layout.

2. **Analyze the binary** using `run_local_command`:
   - `"file"` profile — confirm 32-bit vs 64-bit, stripped vs not
   - `"readelf"` with flags `["-s"]` — find symbol addresses (especially the win/flag function)
   - `"objdump"` with flags `["-d"]` — disassemble to confirm function addresses

3. **Calculate the offset from source code**, NOT by probing the remote service:
   - Stack overflow: `buffer_size + 4` (32-bit EBP) or `buffer_size + 8` (64-bit RBP)
   - Heap overflow: map struct member offsets from the source struct definition

4. **Write the exploit** using `write_work_file` with `struct.pack` — `"<I"` for 32-bit addresses, `"<Q"` for 64-bit, little-endian

5. **Only then** use `tcp_connect` to send the exploit payload

This order saves 30+ actions compared to blind probing.

**HEAP OVERFLOW WITH STRUCTS:** Map the struct layout byte-by-byte. Account for 8-byte malloc chunk headers between allocations. Preserve chunk header size fields (e.g. 0x11 for 16-byte chunk with PREV_INUSE) or malloc/free will crash. Overflow from one struct's buffer into the next struct's function pointer.

**General tools:**
- `run_local_command` with `xxd`, `hexdump`, `objdump`, `nm`, or `strings` to inspect binary structure.
- `strace` or `ltrace` to trace unknown binary execution.
- `write_work_file` + `run_python` scripts that use `struct`, `binascii`, `Crypto`, or `hashlib` to parse or decrypt binary data; load challenge files via the `run_python` `input_files` parameter.
- `tcp_connect` to interact with remote services for network/pwn challenges.
