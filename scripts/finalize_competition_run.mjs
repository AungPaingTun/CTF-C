import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { failureReason, finalOutput } from "./competition_output.mjs";

const [recordPath, rawExitCode] = process.argv.slice(2);
if (!recordPath || !/^\d+$/.test(rawExitCode ?? "")) process.exit(2);

const record = JSON.parse(readFileSync(recordPath, "utf8"));
const stateExists = existsSync(record.paths.state);
const state = stateExists
  ? JSON.parse(readFileSync(record.paths.state, "utf8"))
  : { run_id: record.run_id, target_origin: record.target_origin, status: "active", started_at: Date.now(), deadline_at: Date.now(), action_count: 0, evidence_sequence: 0, last_evidence_hash: null };

const exitCode = Number(rawExitCode);
const now = Date.now();
const status = state.status === "solved"
  ? "solved"
  : state.status !== "active"
    ? state.status
    : !stateExists
  ? "infrastructure_failure"
  : now >= state.deadline_at
  ? "timeout"
  : state.action_count >= record.action_budget
    ? "action_budget_exhausted"
  : exitCode === 0
      ? "not_solved"
      : "infrastructure_failure";
const resultPath = record.paths.result;
const result = existsSync(resultPath) && state.status === "solved"
  ? JSON.parse(readFileSync(resultPath, "utf8"))
  : {
      status,
      run_id: record.run_id,
      action_count: state.action_count,
      evidence_sequence: state.evidence_sequence,
      last_evidence_hash: state.last_evidence_hash,
      finalized_at: new Date().toISOString(),
    };
const reasonCode = result.reason_code
  ?? (status === "timeout" ? "deadline_reached" : status === "action_budget_exhausted" ? "action_budget_reached" : status === "infrastructure_failure" ? "runner_failure" : "no_progress");
const writeAtomic = (path, content) => {
  const temporary = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, path);
};
if (state.status === "active" || !stateExists) {
  writeAtomic(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  writeAtomic(record.paths.state, `${JSON.stringify({ ...state, status }, null, 2)}\n`);
}
const verifiedFlagPath = `${record.paths.private}/verified-flag.txt`;
const flag = status === "solved" && existsSync(verifiedFlagPath) ? readFileSync(verifiedFlagPath, "utf8").trim() : "";
process.stdout.write(finalOutput({
  status,
  startedAt: state.started_at,
  finishedAt: now,
  actionCount: state.action_count,
  toolCalls: state.tool_call_count ?? state.action_count ?? 0,
  evidenceCount: state.evidence_sequence,
  flag,
  lastProgress: state.report?.last_progress ?? (status === "solved" ? "Flag verified" : "No progress recorded."),
  failureReason: failureReason(reasonCode),
  resumeFrom: state.report?.resume_from ?? "",
}));
