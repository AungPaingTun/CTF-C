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
   writeFileSync(fakePi, `#!/bin/sh\nprintf '%s\\n' "$@" > "${fakeOutput}"\nprintf 'cwd=%s\\n' "$PWD" >> "${fakeOutput}"\nprintf 'record=%s\\n' "$CTFC_COMPETITION_RUN_RECORD" >> "${fakeOutput}"\nCTFC_SURFACE_OUTPUT="${fakeOutput}" exec "${realPi}" --mode rpc --no-builtin-tools --offline --no-session --approve -e "${surfaceTest}" <<'EOF'\n{"id":"state","type":"get_state"}\nEOF\n`);
  chmodSync(fakePi, 0o755);
   const defaultLaunch = spawnSync(launcher, ["--target", "http://example.test:8080", "--approve"], {
     cwd: temp,
     env: { ...process.env, PATH: `${temp}:${process.env.PATH}`, CTFC_COMPETITION_RUNTIME_ROOT: runtimeRoot },
     encoding: "utf8",
   });
   assert.equal(defaultLaunch.status, 0, defaultLaunch.stderr);
   const launch = spawnSync(launcher, ["--target", "http://example.test:8080", "--approve", "--description", "Find the flag."], {
     cwd: temp,
    env: { ...process.env, PATH: `${temp}:${process.env.PATH}`, CTFC_COMPETITION_RUNTIME_ROOT: runtimeRoot },
    encoding: "utf8",
  });
  assert.equal(launch.status, 0, launch.stderr);
  const output = readFileSync(fakeOutput, "utf8");
   assert.match(output, /--no-builtin-tools/);
   assert.match(output, new RegExp(`cwd=${root.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}`));
   assert.match(output, /tools=http_request,inspect_evidence,list_source,read_source,run_local_command,replace_session_cookie,adopt_session_cookie,verify_flag,finalize_result/);
  const recordPath = output.match(/^record=(.+)$/m)?.[1];
  assert.ok(recordPath && existsSync(recordPath), "private run record was not created");
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  assert.equal(record.target_origin, "http://example.test:8080");
  assert.equal(record.approved, true);
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
   assert.deepEqual(competitionTools.map((tool) => tool.name), ["http_request", "inspect_evidence", "list_source", "read_source", "run_local_command", "replace_session_cookie", "adopt_session_cookie", "verify_flag", "finalize_result"]);
  const httpTool = competitionTools.find((tool) => tool.name === "http_request");
  const verifyTool = competitionTools.find((tool) => tool.name === "verify_flag");
  for (const [name, configured] of Object.entries(flags)) {
    const local = runHelper(["--target", `http://127.0.0.1:${address.port}`, "--approve", "--description", `Verify ${name}.`, "--flag-regex", configured.regex]);
    assert.equal(local.status, 0, local.stderr);
    const localRecordPath = local.stdout.trim();
    const localRecord = JSON.parse(readFileSync(localRecordPath, "utf8"));
    assert.equal(localRecord.flag_regex, configured.regex);
    process.env.CTFC_COMPETITION_RUN_RECORD = localRecordPath;
    initializeCompetitionRun();
    const result = await httpTool.execute(`direct-action-${name}`, { method: "GET", path: `/${name}`, action_kind: "recon", timeout_ms: 2000 });
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
