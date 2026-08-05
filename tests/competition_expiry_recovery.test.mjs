import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

function tool(name) {
  const selected = competitionTools.find((candidate) => candidate.name === name);
  if (!selected) throw new Error(`missing tool: ${name}`);
  return selected;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function state(record) {
  return JSON.parse(readFileSync(record.paths.state, "utf8"));
}

export default function (pi) {
  let oldRecord;
  let oldEvidence;
  let newRunChallenge;
  let liveRunChallenge;

  pi.on("session_start", async () => {
    const helper = `${process.cwd()}/scripts/create_competition_run.mjs`;
    const oldRecordPath = execFileSync(process.execPath, [helper, "--target", "http://127.0.0.1:1", "--approve", "--description", "expired P10 fixture", "--time-budget", "1", "--action-budget", "20"], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
    oldRecord = JSON.parse(readFileSync(oldRecordPath, "utf8"));
    process.env.CTFC_COMPETITION_RUN_RECORD = oldRecordPath;
    initializeCompetitionRun();
    await tool("compute_digest").execute("p10-old-evidence", { algorithm: "sha256", text: "old-run-evidence", purpose: "P10 isolation fixture" });
    await tool("replace_session_cookie").execute("p10-old-cookie", { hypothesis_id: "old-cookie", cookie_name: "session", cookie_value: "old-cookie-value" });
    oldEvidence = readFileSync(`${oldRecord.paths.evidence}/1-e-001.json`, "utf8");
    const expired = state(oldRecord);
    expired.deadline_at = Date.now() - 1;
    expired.reasoning = { current_hypothesis: "The expired run still has a testable route.", confidence: 0.5, supporting_evidence: ["Old retained evidence exists."], untested_experiments: ["Request the old route."], tested_experiments: [] };
    writeFileSync(oldRecord.paths.state, `${JSON.stringify(expired)}\n`);
    initializeCompetitionRun();
    const timeout = await tool("finalize_result").execute("p10-timeout", { status: "timeout", reason_code: "deadline_reached" });
    assert.equal(timeout.details.status, "timeout");
    assert.equal(state(oldRecord).status, "timeout");
    assert.equal(JSON.parse(readFileSync(oldRecord.paths.result, "utf8")).status, "timeout");
    assert.equal(readFileSync(`${oldRecord.paths.evidence}/1-e-001.json`, "utf8"), oldEvidence);
    newRunChallenge = "P10 CTF challenge recovery fixture http://127.0.0.1:2";
    pi.sendUserMessage(newRunChallenge);
  });

  pi.on("message_start", async (event) => {
    const text = String(event.message?.content ?? "");
    if (text === newRunChallenge) {
      await wait(100);
      const newRecord = JSON.parse(readFileSync(process.env.CTFC_COMPETITION_RUN_RECORD, "utf8"));
      assert.notEqual(newRecord.run_id, oldRecord.run_id);
      assert.notEqual(newRecord.paths.run_root, oldRecord.paths.run_root);
      assert.equal(newRecord.target_origin, "http://127.0.0.1:2");
      assert.equal(state(newRecord).status, "active");
      assert.equal(state(newRecord).evidence_sequence, 0);
      assert.doesNotMatch(readFileSync(newRecord.paths.cookies, "utf8"), /old-cookie-value/);
      assert.equal(state(oldRecord).status, "timeout");
      assert.equal(readFileSync(`${oldRecord.paths.evidence}/1-e-001.json`, "utf8"), oldEvidence);
      liveRunChallenge = "P10 live replacement challenge http://127.0.0.1:3";
      pi.sendUserMessage(liveRunChallenge);
      return;
    }
    if (text === liveRunChallenge) {
      await wait(100);
      const currentRecord = JSON.parse(readFileSync(process.env.CTFC_COMPETITION_RUN_RECORD, "utf8"));
      assert.notEqual(currentRecord.run_id, oldRecord.run_id);
      assert.equal(currentRecord.target_origin, "http://127.0.0.1:2");
      assert.equal(state(currentRecord).status, "active");
      assert.equal(readFileSync(`${oldRecord.paths.evidence}/1-e-001.json`, "utf8"), oldEvidence);
      process.stderr.write("CTF_C_COMPETITION_EXPIRY_RECOVERY=passed\n");
      pi.shutdown();
    }
  });
}
