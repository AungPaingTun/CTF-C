import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";
import { startP11InvalidTlsFixture } from "./fixtures/p11-invalid-tls.mjs";

const httpTool = competitionTools.find((tool) => tool.name === "http_request");
const finishTool = competitionTools.find((tool) => tool.name === "finalize_result");
const reasoning = (path) => ({ evidence_summary: ["The local TLS fixture is the authorized target."], leading_hypothesis: "The authorized origin should return its local TLS fixture response.", supporting_evidence: ["The target is the exact loopback origin under test."], experiment: `GET ${path}`, expected_observation: "A transport classification or HTTP response is retained.", confidence: 0.5, untested_experiments: [] });

function newRecord(origin, insecure) {
  return execFileSync(process.execPath, ["scripts/create_competition_run.mjs", "--target", origin, "--approve", "--description", "local P11 TLS fixture", "--time-budget", "1", "--action-budget", "8", ...(insecure ? ["--allow-insecure-tls"] : [])], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
}

export default function (pi) {
  pi.on("session_start", async () => {
    const fixture = await startP11InvalidTlsFixture();
    const originalTlsEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    try {
      const strictRecordPath = newRecord(fixture.origin, false);
      process.env.CTFC_COMPETITION_RUN_RECORD = strictRecordPath;
      initializeCompetitionRun();
      const strict = await httpTool.execute("p11-strict", { method: "GET", path: "/", action_kind: "recon", timeout_ms: 2000, reasoning: reasoning("/") });
      assert.equal(strict.details.status_code, null);
      assert.equal(strict.details.transport_error, "tls_certificate_validation_failed");
      assert.equal(strict.details.preview, "TLS certificate validation failed for the authorized origin.");
      assert.doesNotMatch(JSON.stringify(strict.details), /BEGIN CERTIFICATE|local\/|self-signed|DEPTH_ZERO|stack/i);
      const strictRecord = JSON.parse(readFileSync(strictRecordPath, "utf8"));
      assert.equal(strictRecord.insecure_tls, false);
      await finishTool.execute("p11-finish-strict", { status: "not_solved", reason_code: "no_progress" });

      const insecureRecordPath = newRecord(fixture.origin, true);
      process.env.CTFC_COMPETITION_RUN_RECORD = insecureRecordPath;
      initializeCompetitionRun();
      const insecure = await httpTool.execute("p11-insecure", { method: "GET", path: "/", action_kind: "recon", timeout_ms: 2000, reasoning: reasoning("/") });
      assert.equal(insecure.details.status_code, 200);
      assert.equal(insecure.details.transport_error, null);
      assert.match(insecure.details.preview, /^tls-fixture-ok/);
      assert.equal(JSON.parse(readFileSync(insecureRecordPath, "utf8")).insecure_tls, true);
      const cookie = await httpTool.execute("p11-cookie", { method: "GET", path: "/cookie", action_kind: "authenticated_request", timeout_ms: 2000, reasoning: reasoning("/cookie") });
      assert.equal(cookie.details.status_code, 200);
      assert.equal(cookie.details.preview, "cookie-ok");

      const redirect = await httpTool.execute("p11-redirect", { method: "GET", path: "/redirect-off-origin", action_kind: "recon", timeout_ms: 2000, reasoning: reasoning("/redirect-off-origin") });
      assert.equal(redirect.details.status_code, 302);
      assert.equal(redirect.details.outcome, "redirect");
      assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, originalTlsEnv);

      const launcherRoot = mkdtempSync(join(tmpdir(), "ctf-c-p11-launcher-"));
      const fakeBin = join(launcherRoot, "bin");
      const runtimeRoot = join(launcherRoot, "runtime");
      mkdirSync(fakeBin);
      const fakePi = join(fakeBin, "pi");
      writeFileSync(fakePi, "#!/bin/sh\nexit 0\n");
      chmodSync(fakePi, 0o755);
      try {
        execFileSync("scripts/run_competition.sh", ["--target", fixture.origin, "--approve", "--allow-insecure-tls", "--description", "launcher TLS option"], { cwd: process.cwd(), env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, CTFC_COMPETITION_RUNTIME_ROOT: runtimeRoot }, stdio: "ignore" });
        const runDirectory = readdirSync(runtimeRoot).find((entry) => entry.startsWith("run-"));
        assert.equal(JSON.parse(readFileSync(join(runtimeRoot, runDirectory, "run-record.json"), "utf8")).insecure_tls, true);
        assert.throws(() => execFileSync("scripts/run_competition.sh", ["--target", fixture.origin, "--approve", "--unknown-option"], { cwd: process.cwd(), env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, CTFC_COMPETITION_RUNTIME_ROOT: runtimeRoot }, stdio: "ignore" }));
      } finally {
        rmSync(launcherRoot, { recursive: true, force: true });
      }
    } finally {
      if (originalTlsEnv === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsEnv;
      delete process.env.CTFC_COMPETITION_RUN_RECORD;
      await fixture.stop();
    }
  });
}
