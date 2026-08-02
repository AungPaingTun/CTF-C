import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeCompetitionRun, stage2Tools } from "../.pi/extensions/ctf-c-stage2-core.mjs";

const root = process.cwd();
const helper = join(root, "scripts", "create_competition_run.mjs");
const launcher = join(root, "scripts", "run_competition.sh");
const temp = mkdtempSync(join(tmpdir(), "ctf-c-competition-test-"));
const description = join(temp, "challenge.txt");
const runtimeRoot = join(root, ".ctf-c", "competition-runs", "test");
writeFileSync(description, "Find the flag in the session behavior.\n");

function runHelper(args) {
  return spawnSync(process.execPath, [helper, ...args], { cwd: root, encoding: "utf8" });
}

function assertRejected(args, text) {
  const result = runHelper(args);
  assert.notEqual(result.status, 0, `${text}: operation succeeded`);
  assert.match(`${result.stderr}${result.stdout}`, new RegExp(text, "i"));
}

const base = ["--target", "http://example.test:8080", "--approve", "--description-file", description];
export default function (pi) {
  pi.on("session_start", async () => {
    try {
  assertRejected(["--target", "http://example.test:8080", "--description-file", description], "approve");
  assertRejected(["--target", "not-a-url", "--approve", "--description-file", description], "valid URL");
  assertRejected(["--target", "http://user:pass@example.test:8080", "--approve", "--description-file", description], "credentials");
  assertRejected(["--target", "http://example.test:8080/#fragment", "--approve", "--description-file", description], "fragment");

  const fakePi = join(temp, "pi");
  const fakeOutput = join(temp, "pi-args.txt");
  writeFileSync(fakePi, `#!/bin/sh\nprintf '%s\\n' "$@" > "${fakeOutput}"\nprintf 'record=%s\\n' "$CTFC_COMPETITION_RUN_RECORD" >> "${fakeOutput}"\n`);
  chmodSync(fakePi, 0o755);
  const launch = spawnSync(launcher, ["--target", "http://example.test:8080", "--approve", "--description-file", description], {
    cwd: root,
    env: { ...process.env, PATH: `${temp}:${process.env.PATH}`, CTFC_COMPETITION_RUNTIME_ROOT: runtimeRoot },
    encoding: "utf8",
  });
  assert.equal(launch.status, 0, launch.stderr);
  const output = readFileSync(fakeOutput, "utf8");
  assert.match(output, /--no-builtin-tools/);
  assert.doesNotMatch(output, /auditor|begin_investigation|record_hypotheses/);
  const recordPath = output.match(/^record=(.+)$/m)?.[1];
  assert.ok(recordPath && existsSync(recordPath), "private run record was not created");
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  assert.equal(record.target_origin, "http://example.test:8080");
  assert.equal(record.approved, true);
  assert.equal(statSync(recordPath).mode & 0o777, 0o600, "run record is not private");
  assert.equal(statSync(record.paths.run_root).mode & 0o777, 0o700, "runtime directory is not private");
  execFileSync("git", ["check-ignore", "-q", record.paths.run_root], { cwd: root, stdio: "ignore" });

  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("typed action response");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const local = runHelper(["--target", `http://127.0.0.1:${address.port}`, ...base.slice(2)]);
  assert.equal(local.status, 0, local.stderr);
  const localRecordPath = local.stdout.trim();
  process.env.CTFC_COMPETITION_RUN_RECORD = localRecordPath;
  process.env.CTFC_STAGE2_TEST_MODE = "local-fixture";
  initializeCompetitionRun();
  const httpTool = stage2Tools.find((tool) => tool.name === "http_request");
  const result = await httpTool.execute("direct-action", { hypothesis_id: "H1", method: "GET", path: "/", action_kind: "recon", timeout_ms: 2000 });
  assert.ok(result.details?.evidence_id, "first typed action did not produce evidence");
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
