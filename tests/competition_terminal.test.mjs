import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

function tool(name) {
  const selected = competitionTools.find((candidate) => candidate.name === name);
  if (!selected) throw new Error(`missing tool: ${name}`);
  return selected;
}

async function call(name, params) {
  const result = await tool(name).execute(`competition-terminal-${name}`, params);
  return result.details ?? JSON.parse(result.content[0].text);
}

function state(record) {
  return JSON.parse(readFileSync(record.paths.state, "utf8"));
}

export default function (pi) {
  pi.on("session_start", async () => {
    const recordPath = process.env.CTFC_COMPETITION_RUN_RECORD;
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    try {
      initializeCompetitionRun();
      const exhausted = state(record);
      exhausted.action_count = record.action_budget;
      writeFileSync(record.paths.state, `${JSON.stringify(exhausted)}\n`);
      initializeCompetitionRun();
      const exhaustedResult = await call("finalize_result", { status: "action_budget_exhausted", reason_code: "action_budget_reached" });
      assert.equal(exhaustedResult.status, "action_budget_exhausted");
      assert.equal(JSON.parse(readFileSync(record.paths.result, "utf8")).status, "action_budget_exhausted");

      const helper = join(process.cwd(), "scripts", "create_competition_run.mjs");
      const secondRecordPath = execFileSync(process.execPath, [helper, "--target", "http://127.0.0.1:1", "--approve", "--description", "timeout fixture"], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
      const secondRecord = JSON.parse(readFileSync(secondRecordPath, "utf8"));
      process.env.CTFC_COMPETITION_RUN_RECORD = secondRecordPath;
      initializeCompetitionRun();
      const expired = state(secondRecord);
      expired.deadline_at = Date.now() - 1;
      writeFileSync(secondRecord.paths.state, `${JSON.stringify(expired)}\n`);
      const timeoutResult = await call("finalize_result", { status: "timeout", reason_code: "deadline_reached" });
      assert.equal(timeoutResult.status, "timeout");
      assert.equal(JSON.parse(readFileSync(secondRecord.paths.result, "utf8")).status, "timeout");
      for (const resultPath of [record.paths.result, secondRecord.paths.result]) {
        const result = readFileSync(resultPath, "utf8");
        assert.doesNotMatch(result, /picoCTF\{/);
        assert.doesNotMatch(result, /session/i);
      }
      process.stderr.write("CTF_C_COMPETITION_TERMINAL=passed\n");
    } finally {
      delete process.env.CTFC_COMPETITION_RUN_RECORD;
    }
  });
}
