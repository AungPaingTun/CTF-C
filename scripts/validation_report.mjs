import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_FLAG_PATTERN = "picoCTF\\{[^}\\r\\n]{1,256}\\}";

function redactText(value, flagPattern = DEFAULT_FLAG_PATTERN) {
  let text = String(value);
  try { text = text.replace(new RegExp(flagPattern, "g"), "[REDACTED_FLAG]"); } catch { /* use secret redaction when a declaration pattern is invalid */ }
  return text.replace(/((?:["']?\b(?:cookie|set-cookie|authorization|password|passwd|secret|session(?:[_-]?id)?|csrf(?:[_-]?token)?|xsrf(?:[_-]?token)?|token)\b["']?)\s*[:=]\s*["']?)(?:bearer\s+)?[^"'\s,;&}]+/gi, "$1[REDACTED_SECRET]");
}

function readField(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp("^-[ \\t]*\\*\\*" + escaped + ":\\*\\*[ \\t]*`([^`]+)`", "m"))?.[1] ?? "";
}

function classifyFailure(status, reason, log) {
  if (status === "solved") return null;
  const text = `${reason} ${log}`.toLowerCase();
  if (status === "timeout" || /deadline|timed out|timeout/.test(text)) return "timeout";
  if (/route|routing|category/.test(text)) return "routing";
  if (/auditor|json|prose/.test(text)) return "auditing";
  if (/hypothesis/.test(text)) return "hypothesis";
  if (/evidence|artifact|integrity/.test(text)) return "evidence";
  if (/verif|flag|hash/.test(text)) return "verification";
  if (/finaliz|solved|not_solved/.test(text)) return "finalization";
  if (/action|request|http|method/.test(text)) return "execution";
  return "infrastructure";
}

function recommendations(stage) {
  return {
    routing: "Review deterministic category routing and auditor selection.",
    auditing: "Review strict auditor JSON production and local evidence references.",
    hypothesis: "Review hypothesis validation and ranking before execution.",
    execution: "Review typed action scope, authorization, and action results.",
    evidence: "Review evidence creation, paths, and integrity checks.",
    verification: "Review retained evidence and flag verification provenance.",
    finalization: "Review terminal-state and verification requirements.",
    timeout: "Review budget, deadline, and coordinator stopping behavior.",
    infrastructure: "Review Pi, runtime, manifest, and local infrastructure errors.",
  }[stage] ?? "No recommendation; run completed successfully.";
}

export function buildValidationMetrics({ challenge, startMs, endMs, exitCode, manifest, result, evidenceCount, log }) {
  const hasVerifiedProvenance = Boolean(result?.status === "solved" && exitCode === 0 && result.verified === true && result.verified_evidence_id && result.flag_sha256);
  const launcherFailed = exitCode !== 0;
  const status = result?.status === "solved" && !hasVerifiedProvenance ? (launcherFailed ? "infrastructure_failure" : "not_solved") : (result?.status ?? "infrastructure_failure");
  const failureReason = result?.status === "solved" && !hasVerifiedProvenance ? (launcherFailed ? `Pi exited with status ${exitCode}` : "Solved result lacked verified provenance") : (result?.reason ?? (exitCode === 0 ? "No authoritative result was produced" : `Pi exited with status ${exitCode}`));
  const failureStage = classifyFailure(status, failureReason, log);
  return {
    challenge,
    category: manifest?.category ?? "unknown",
    status,
    elapsed_ms: Math.max(0, endMs - startMs),
    actions: Number(result?.action_count ?? 0),
    evidence_count: evidenceCount,
    hypotheses_generated: Number(result?.hypotheses_generated ?? 0),
    verified: hasVerifiedProvenance,
    failure_stage: failureStage,
    failure_reason: redactText(failureReason, manifest?.flag_regex),
    notes: failureStage ? recommendations(failureStage) : "",
  };
}

export function validateValidationRoot(projectRoot, requestedRoot) {
  const project = resolve(projectRoot);
  const approved = join(project, "results", "validation");
  const requested = resolve(requestedRoot);
  if (!requested.startsWith(`${approved}/`) && requested !== approved) throw new Error("Validation root must be under results/validation");
  rejectSymlinkComponents(project, approved);
  mkdirSync(approved, { recursive: true, mode: 0o700 });
  const approvedReal = realpathSafe(approved);
  rejectSymlinkComponents(project, requested);
  mkdirSync(requested, { recursive: true, mode: 0o700 });
  rejectSymlinkComponents(project, requested);
  const resolved = realpathSafe(requested);
  if (!resolved.startsWith(`${approvedReal}/`) && resolved !== approvedReal) throw new Error("Validation root symlink escapes approved root");
  return resolved;
}

function rejectSymlinkComponents(root, target) {
  const parts = target.slice(root.length).split("/").filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error("Validation root symlink escapes approved root");
    } catch (error) {
      if (error instanceof Error && error.message === "Validation root symlink escapes approved root") throw error;
      break;
    }
  }
}

export function writeValidationReport({ resultDir, challenge, startMs, endMs, exitCode, manifestPath }) {
  let manifest = null;
  let result = null;
  let log = "";
  if (manifestPath && existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    cpSync(manifestPath, join(resultDir, "run-manifest.json"));
    if (existsSync(manifest.paths.result)) {
      result = JSON.parse(readFileSync(manifest.paths.result, "utf8"));
      writeFileSync(join(resultDir, "result.json"), `${JSON.stringify({ ...result, reason: redactText(result.reason ?? "", manifest.flag_regex) }, null, 2)}\n`, { mode: 0o600 });
    }
    if (existsSync(manifest.paths.evidence)) cpSync(manifest.paths.evidence, join(resultDir, "evidence"), { recursive: true });
    if (existsSync(manifest.paths.private)) cpSync(manifest.paths.private, join(resultDir, "private"), { recursive: true });
    if (existsSync(manifest.declaration_path)) {
      const declaration = readFileSync(manifest.declaration_path, "utf8");
      manifest.category = readField(declaration, "Category");
    }
  }
  const flagPattern = manifest?.flag_regex ?? DEFAULT_FLAG_PATTERN;
  for (const file of ["stdout.log", "stderr.log"]) if (existsSync(join(resultDir, file))) {
    const path = join(resultDir, file);
    const redacted = redactText(readFileSync(path, "utf8"), flagPattern);
    writeFileSync(path, redacted, { mode: 0o600 });
    log += redacted;
  }
  const evidenceCount = manifest?.paths?.evidence && existsSync(manifest.paths.evidence) ? readdirSync(manifest.paths.evidence).filter((name) => name.endsWith(".json")).length : 0;
  const metrics = buildValidationMetrics({ challenge, startMs, endMs, exitCode, manifest, result, evidenceCount, log });
  writeFileSync(join(resultDir, "metrics.json"), redactText(`${JSON.stringify(metrics, null, 2)}\n`, flagPattern), { mode: 0o600 });
  const report = [
    `Challenge: ${metrics.challenge}`,
    `Category: ${metrics.category}`,
    `Status: ${metrics.status}`,
    `Elapsed ms: ${metrics.elapsed_ms}`,
    `Actions: ${metrics.actions}`,
    `Evidence count: ${metrics.evidence_count}`,
    `Hypotheses generated: ${metrics.hypotheses_generated}`,
    `Verified: ${metrics.verified}`,
    `Failure stage: ${metrics.failure_stage ?? "none"}`,
    `Failure reason: ${metrics.failure_reason}`,
    `Recommendations: ${metrics.notes || "none"}`,
  ].join("\n") + "\n";
  writeFileSync(join(resultDir, "report.txt"), redactText(report, flagPattern), { mode: 0o600 });
  return metrics;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === "--validate-root") {
    process.stdout.write(`${validateValidationRoot(process.argv[3], process.argv[4])}\n`);
    process.exit(0);
  }
  const [resultDir, challenge, start, end, exitCode, manifestPath = ""] = process.argv.slice(2);
  mkdirSync(resultDir, { recursive: true, mode: 0o700 });
  writeValidationReport({ resultDir, challenge, startMs: Number(start), endMs: Number(end), exitCode: Number(exitCode), manifestPath });
}

function realpathSafe(path) {
  try { return realpathSync(path); } catch { return path; }
}
