import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export default function (pi) {
  pi.on("session_start", async () => {
    const helper = join(process.cwd(), "scripts", "create_competition_run.mjs");
    const recordPath = execFileSync(process.execPath, [helper, "--target", "http://127.0.0.1:1", "--approve", "--description", "watchdog fixture", "--time-budget", "1"], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    process.env.CTFC_COMPETITION_RUN_RECORD = recordPath;
    initializeCompetitionRun();
    const current = JSON.parse(readFileSync(record.paths.state, "utf8"));
    current.deadline_at = Date.now() + 50;
    writeFileSync(record.paths.state, `${JSON.stringify(current)}\n`);
    initializeCompetitionRun();

    // A pending model/provider operation must not prevent the timer from firing.
    const neverReturningModelCall = new Promise(() => {});
    await Promise.race([neverReturningModelCall, wait(150)]);
    const finalState = JSON.parse(readFileSync(record.paths.state, "utf8"));
    const result = JSON.parse(readFileSync(record.paths.result, "utf8"));
    assert.equal(finalState.status, "timeout");
    assert.equal(result.status, "timeout");
    assert.equal(result.reason_code, "hard_deadline_exceeded");

    const runtimeRoot = mkdtempSync(join(tmpdir(), "ctf-c-preflight-"));
    const failed = spawnSync(join(process.cwd(), "scripts", "run_competition.sh"), ["--target", "http://127.0.0.1:1", "--approve", "--pi-provider", "invalid-provider", "--pi-model", "invalid-model"], { cwd: process.cwd(), env: { ...process.env, CTFC_COMPETITION_RUNTIME_ROOT: runtimeRoot }, encoding: "utf8" });
    assert.equal(failed.status, 78);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /infrastructure_failure|provider preflight failed/i);
    assert.equal(existsSync(join(runtimeRoot, "run-record.json")), false);
    process.stderr.write("CTF_C_WATCHDOG_PREFLIGHT=passed\n");
    delete process.env.CTFC_COMPETITION_RUN_RECORD;
  });
}
