import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const [recordPath, rawExitCode] = process.argv.slice(2);
if (!recordPath || !/^\d+$/.test(rawExitCode ?? "")) process.exit(2);

const record = JSON.parse(readFileSync(recordPath, "utf8"));
const stateExists = existsSync(record.paths.state);
const state = stateExists
  ? JSON.parse(readFileSync(record.paths.state, "utf8"))
  : { run_id: record.run_id, target_origin: record.target_origin, status: "active", started_at: Date.now(), deadline_at: Date.now(), action_count: 0, evidence_sequence: 0, last_evidence_hash: null };
if (state.status === "solved" || state.status !== "active") process.exit(0);

const exitCode = Number(rawExitCode);
const now = Date.now();
const status = !stateExists
  ? "infrastructure_failure"
  : now >= state.deadline_at
  ? "timeout"
  : state.action_count >= record.action_budget
    ? "action_budget_exhausted"
    : exitCode === 0
      ? "not_solved"
      : "infrastructure_failure";
const result = {
  status,
  run_id: record.run_id,
  action_count: state.action_count,
  evidence_sequence: state.evidence_sequence,
  last_evidence_hash: state.last_evidence_hash,
  finalized_at: new Date().toISOString(),
};
const writeAtomic = (path, content) => {
  const temporary = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, path);
};
writeAtomic(record.paths.result, `${JSON.stringify(result, null, 2)}\n`);
writeAtomic(record.paths.state, `${JSON.stringify({ ...state, status }, null, 2)}\n`);
