const STATUS_LABELS = new Map([
  ["solved", "SOLVED"],
  ["not_solved", "NOT_SOLVED"],
  ["timeout", "TIMEOUT"],
  ["action_budget_exhausted", "NOT_SOLVED"],
  ["infrastructure_failure", "INFRASTRUCTURE_FAILURE"],
]);

const FAILURE_REASONS = new Map([
  ["no_progress", "The run ended without a verified flag."],
  ["deadline_reached", "The competition time budget expired."],
  ["action_budget_reached", "The competition action budget was exhausted."],
  ["runner_failure", "The competition runner failed."],
]);

function safeLine(value) {
  return String(value ?? "").replace(/[\r\n\x00-\x1f\x7f]/g, " ").trim();
}

export function elapsedSeconds(startedAt, finishedAt = Date.now()) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return 0;
  return Math.max(0, (finishedAt - startedAt) / 1000);
}

export function elapsedLabel(startedAt, at = Date.now()) {
  const seconds = Math.floor(elapsedSeconds(startedAt, at));
  return `[${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}]`;
}

export function liveLine(startedAt, message, at = Date.now()) {
  return `${elapsedLabel(startedAt, at)} ${safeLine(message)}\n`;
}

export function writeLiveLine(startedAt, message, at = Date.now()) {
  process.stderr.write(liveLine(startedAt, message, at));
}

export function finalOutput({ status, startedAt, finishedAt = Date.now(), actionCount = 0, toolCalls = 0, evidenceCount = 0, flag = "", lastProgress = "No progress recorded.", failureReason = "", resumeFrom = "" }) {
  const solved = status === "solved";
  const lines = [
    `Status: ${STATUS_LABELS.get(status) ?? "INFRASTRUCTURE_FAILURE"}`,
    `Elapsed: ${elapsedSeconds(startedAt, finishedAt).toFixed(1)}`,
    `HTTP actions: ${Number.isSafeInteger(actionCount) ? actionCount : 0}`,
    `Tool calls: ${Number.isSafeInteger(toolCalls) ? toolCalls : 0}`,
    `Evidence items: ${Number.isSafeInteger(evidenceCount) ? evidenceCount : 0}`,
    `Flag: ${solved ? safeLine(flag) : ""}`,
    `Last progress: ${safeLine(lastProgress) || "No progress recorded."}`,
  ];
  if (!solved) lines.push(`Failure reason: ${safeLine(failureReason) || "The run did not produce a verified flag."}`);
  lines.push(`Resume from: ${safeLine(resumeFrom)}`);
  return `${lines.join("\n")}\n`;
}

export function failureReason(reasonCode) {
  return FAILURE_REASONS.get(reasonCode) ?? "The run did not produce a verified flag.";
}
