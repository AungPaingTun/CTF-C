import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

const root = process.cwd();
const helper = join(root, "scripts", "create_competition_run.mjs");
const launcher = join(root, "scripts", "run_competition.sh");
const surfaceTest = join(root, "tests", "competition_surface.test.mjs");
const realPi = execFileSync("sh", ["-c", "command -v pi"], { encoding: "utf8" }).trim();
const temp = mkdtempSync(join(tmpdir(), "ctf-c-competition-test-"));
const runtimeRoot = join(root, ".ctf-c", "competition-runs", "test");

function runHelper(args) {
  return spawnSync(process.execPath, [helper, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, CTFC_COMPETITION_RUNTIME_ROOT: runtimeRoot } });
}

function assertRejected(args, text) {
  const result = runHelper(args);
  assert.notEqual(result.status, 0, `${text}: operation succeeded`);
  assert.match(`${result.stderr}${result.stdout}`, new RegExp(text, "i"));
}

export default function (pi) {
  pi.on("session_start", async () => {
    try {
   assertRejected(["--target", "http://example.test:8080", "--description", "x"], "approve");
   assertRejected(["--target", "not-a-url", "--approve"], "valid URL");
   assertRejected(["--target", "http://user:pass@example.test:8080", "--approve"], "credentials");
   assertRejected(["--target", "http://example.test:8080/#fragment", "--approve"], "fragment");
   assertRejected(["--target", "http://example.test:8080", "--approve", "--flag-regex", "["], "Flag regex");

  const fakePi = join(temp, "pi");
  const fakeOutput = join(temp, "pi-args.txt");
   writeFileSync(fakePi, `#!/bin/sh\nfor arg do [ "$arg" = "--list-models" ] && exit 0; done\nprintf '%s\\n' "$@" > "${fakeOutput}"\nprintf 'cwd=%s\\n' "$PWD" >> "${fakeOutput}"\nprintf 'record=%s\\n' "$CTFC_COMPETITION_RUN_RECORD" >> "${fakeOutput}"\nCTFC_SURFACE_OUTPUT="${fakeOutput}" exec "${realPi}" --mode rpc --no-builtin-tools --offline --no-session --approve -e "${surfaceTest}" <<'EOF'\n{"id":"state","type":"get_state"}\nEOF\n`);
  chmodSync(fakePi, 0o755);
   const defaultLaunch = spawnSync(launcher, ["--target", "http://example.test:8080", "--approve"], {
     cwd: temp,
     env: { ...process.env, PATH: `${temp}:${process.env.PATH}`, CTFC_COMPETITION_RUNTIME_ROOT: runtimeRoot },
     encoding: "utf8",
    });
    assert.equal(defaultLaunch.status, 0, defaultLaunch.stderr);
    const defaultOutput = readFileSync(fakeOutput, "utf8");
    assert.doesNotMatch(defaultOutput, /--provider|--model|--thinking/);
    const launch = spawnSync(launcher, ["--target", "http://example.test:8080", "--approve", "--description", "Find the flag.", "--pi-provider", "opencode-go", "--pi-model", "deepseek-v4-pro", "--pi-thinking", "off"], {
     cwd: temp,
    env: { ...process.env, PATH: `${temp}:${process.env.PATH}`, CTFC_COMPETITION_RUNTIME_ROOT: runtimeRoot },
    encoding: "utf8",
  });
   assert.equal(launch.status, 0, launch.stderr);
  const output = readFileSync(fakeOutput, "utf8");
   assert.match(output, /--no-builtin-tools/);
    assert.match(output, /--offline/);
    assert.match(output, /--no-session/);
    assert.match(output, /--approve/);
     assert.match(output, /--tools\nhttp_request,websocket_exchange,browser_action,start_competition_run,inspect_evidence,list_source,read_source,search_source,compute_digest,derive_binary_evidence,run_local_command,replace_session_cookie,adopt_session_cookie,verify_flag,finalize_result/);
    assert.match(output, /--provider\nopencode-go/);
    assert.match(output, /--model\ndeepseek-v4-pro/);
    assert.match(output, /--thinking\noff/);
   assert.match(output, new RegExp(`cwd=${root.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}`));
       assert.match(output, /tools=http_request,websocket_exchange,browser_action,start_competition_run,inspect_evidence,list_source,read_source,search_source,compute_digest,derive_binary_evidence,run_local_command,replace_session_cookie,adopt_session_cookie,verify_flag,finalize_result/);
     assert.match(output, /Derive a specific hypothesis from retained evidence before each request/);
     assert.match(output, /Mutate an observed route before unrelated endpoints/);
     assert.match(output, /Authentication or session evidence means prioritize observed redirects, cookies, links, forms, comments, and authenticated routes/);
      assert.match(output, /Before starting a fresh multi-step branch, check the remaining time and action budget/);
      assert.match(output, /For a deterministic identifier transformation such as MD5, use compute_digest before hypothesis-route requests/);
      assert.match(output, /DECISION LOOP: After root reconnaissance and every meaningful response/);
      assert.match(output, /Maintain the ranked hypothesis board as authoritative/);
      assert.match(output, /If the user pastes a CTF challenge with a target URL that differs from the currently bound origin/);
      assert.match(output, /call start_competition_run before any HTTP request/);
      assert.match(output, /Do not call finalize_result between successive challenges/);
      assert.match(output, /After root reconnaissance and every meaningful response/);
      assert.match(output, /HYPOTHESIS BOARD/);
      assert.match(output, /up to 3 ranked active hypotheses/);
      assert.match(output, /The rank-1 hypothesis is the authoritative primary/);
      assert.match(output, /After two failed experiments testing the same family\+branch/);
      assert.match(output, /retire or pivot that hypothesis/);
      assert.match(output, /Do not repeat a retired family\+branch experiment/);
      assert.match(output, /board is the single source of truth/i);
      assert.match(output, /Before starting a fresh multi-step branch, check the remaining time and action budget/);
      assert.match(output, /observed multipart file form means submit one evidence-backed multipart request first/);
       assert.match(output, /When a multipart form has no hidden inputs, omit multipart\.evidence_form_fields; source evidence plus the observed file field is sufficient/);
       assert.match(output, /source_evidence_id is the page containing the observed form; submit multipart POST to the form observed action path/);
       assert.match(output, /use method POST, and use action_kind exactly submit/);
       assert.match(output, /Classify deterministic unavailable or unconfigured capabilities as Unavailable Capability/);
      assert.match(output, /\[UNAVAILABLE_CAPABILITY\]/);
      assert.match(output, /Distinguish DNS failure, connection refused, timeout, TLS failure, HTTP response, redirect, and application error/);
       assert.match(output, /Expand route families only after new evidence, contradiction, or verified observation/);
       assert.match(output, /If unable to progress, call finalize_result with not_solved/);
       assert.match(output, /Rank evidence as authenticated response > server-generated metadata > redirect targets > HTML forms > comments > headers > error messages > timing > speculation/);
       assert.match(output, /Derive a specific hypothesis from retained evidence before each request/);
       assert.match(output, /do not spray guesses such as \/api, \/debug, \/users, \/admin/);
       assert.match(output, /retire contradicted hypotheses, promote the strongest supported alternative/);
        assert.match(output, /complete the smallest evidence-backed chain: discovery/);
        assert.match(output, /choose one highest-information or verification action/);
       assert.match(output, /EXPLOIT COMPLETION: When retained evidence strongly supports a concrete primitive, leave discovery mode/);
      assert.match(output, /next action that obtains protected data, the missing parameter, or likely flag-bearing evidence/);
       assert.match(output, /do not spend actions merely increasing confidence in an already-supported primitive/);
       assert.match(output, /Continue until verification succeeds, evidence disproves the chain, the chain becomes impossible, or the deadline or action budget requires termination/);
      assert.match(output, /Confirmed server-side template evaluation means perform only minimum confirmation, then prioritize extraction/);
     assert.match(output, /observed dynamic object route or predictable identifier transformation means identify the invariant route family/);
     assert.match(output, /derive candidates only from retained evidence or a confirmed deterministic transform using compute_digest/);
      assert.match(output, /An error, status, or body differential suggesting injection or parser behavior means use the smallest differential confirmation, then prioritize extraction/);
      assert.match(output, /An asynchronous workflow means reserve actions for polling, retrieval, and verify_flag/);
      assert.match(output, /When retained evidence is binary or WASM, inspect that exact evidence with inspect_evidence using wasm_summary, strings, or hex before any additional HTTP request/);
      assert.match(output, /derive private evidence and use normal verify_flag; do not brute-force keys or execute the artifact/);
       assert.match(output, /this is mandatory/);
     assert.match(output, /FIRST-ACTION CONTRACT: The first successful tool call must be http_request/);
     assert.match(output, /method GET, path \/, action_kind recon, timeout_ms 5000/);
     assert.match(output, /Valid action_kind values are exactly recon, login, authenticated_request, submit, and trigger/);
  const recordPath = output.match(/^record=(.+)$/m)?.[1];
  assert.ok(recordPath && existsSync(recordPath), "private run record was not created");
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
   assert.equal(record.target_origin, "http://example.test:8080");
   assert.equal(record.approved, true);
   assert.equal(record.action_budget, 20);
  assert.equal(record.flag_regex, "picoCTF\\{[^}\\r\\n]{1,256}\\}");
  assert.equal(statSync(recordPath).mode & 0o777, 0o600, "run record is not private");
   assert.equal(statSync(record.paths.run_root).mode & 0o777, 0o700, "runtime directory is not private");
   assert.equal(JSON.parse(readFileSync(record.paths.result, "utf8")).status, "not_solved");
  execFileSync("git", ["check-ignore", "-q", record.paths.run_root], { cwd: root, stdio: "ignore" });

  const flags = {
    pico: { regex: "picoCTF\\{[^}\\r\\n]{1,256}\\}", value: "picoCTF{configured_pattern}" },
    flag: { regex: "flag\\{[^}\\r\\n]{1,256}\\}", value: "flag{configured_pattern}" },
    cylab: { regex: "CYLAB\\{[^}\\r\\n]{1,256}\\}", value: "CYLAB{configured_pattern}" },
  };
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(flags[request.url.slice(1)]?.value ?? "typed action response");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  process.env.CTFC_STAGE2_TEST_MODE = "local-fixture";
    assert.deepEqual(competitionTools.map((tool) => tool.name), ["http_request", "websocket_exchange", "browser_action", "start_competition_run", "inspect_evidence", "list_source", "read_source", "search_source", "compute_digest", "derive_binary_evidence", "run_local_command", "replace_session_cookie", "adopt_session_cookie", "verify_flag", "finalize_result"]);
   const httpTool = competitionTools.find((tool) => tool.name === "http_request");
   const digestTool = competitionTools.find((tool) => tool.name === "compute_digest");
   const verifyTool = competitionTools.find((tool) => tool.name === "verify_flag");
  for (const [name, configured] of Object.entries(flags)) {
    const local = runHelper(["--target", `http://127.0.0.1:${address.port}`, "--approve", "--description", `Verify ${name}.`, "--flag-regex", configured.regex]);
    assert.equal(local.status, 0, local.stderr);
    const localRecordPath = local.stdout.trim();
    const localRecord = JSON.parse(readFileSync(localRecordPath, "utf8"));
    assert.equal(localRecord.flag_regex, configured.regex);
     process.env.CTFC_COMPETITION_RUN_RECORD = localRecordPath;
     initializeCompetitionRun();
     const digest = await digestTool.execute(`digest-${name}`, { algorithm: "md5", text: "launcher-safe-input", purpose: "local deterministic test" });
     assert.equal(digest.details.digest, "a3e323ed331169673938b48c8b2967f9");
     assert.doesNotMatch(JSON.stringify(digest.details), /launcher-safe-input/);
     assert.equal(localRecord.source_root, null, "digest test unexpectedly requires a source root");
     const result = await httpTool.execute(`direct-action-${name}`, { method: "GET", path: `/${name}`, action_kind: "recon", timeout_ms: 2000, reasoning: { evidence_summary: ["The local launcher fixture exposes the requested flag route."], leading_hypothesis: `The route /${name} contains the configured flag.`, supporting_evidence: ["The route is provided by the local fixture."], experiment: `GET /${name} configured-flag request`, expected_observation: "The response contains the configured flag.", confidence: 0.8, untested_experiments: [], exploration_score: 0.8, exploration_justification: "The configured fixture route is the explicit test target." } });
    assert.ok(result.details?.evidence_id, "first typed action did not produce evidence");
    const verified = await verifyTool.execute(`verify-${name}`, { evidence_id: result.details.evidence_id });
    assert.equal(verified.details?.flag, configured.value, `configured ${name} flag was not verified`);
    assert.equal(verified.details?.verified, true, `configured ${name} flag was not verified`);
    assert.equal(JSON.parse(readFileSync(localRecord.paths.result, "utf8")).status, "solved");
  }
  server.close();
  delete process.env.CTFC_COMPETITION_RUN_RECORD;
  delete process.env.CTFC_STAGE2_TEST_MODE;
  process.stderr.write("CTF_C_COMPETITION_LAUNCHER=passed\n");
    } finally {
      rmSync(temp, { recursive: true, force: true });
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
}
