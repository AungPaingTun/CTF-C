import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildValidationMetrics, validateValidationRoot, writeValidationReport } from "../../scripts/validation_report.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

const root = mkdtempSync(join(tmpdir(), "ctf-c-validation-test-"));
const success = buildValidationMetrics({ challenge: "fixture", startMs: 100, endMs: 1250, exitCode: 0, manifest: { category: "web" }, result: { status: "solved", verified: true, action_count: 3, hypotheses_generated: 1, verified_evidence_id: "e-003", flag_sha256: "abc" }, evidenceCount: 3, log: "" });
assert(success.elapsed_ms === 1150 && success.actions === 3 && success.evidence_count === 3 && success.verified && success.failure_stage === null, "success metrics mismatch");
const missingProvenance = buildValidationMetrics({ challenge: "fixture", startMs: 0, endMs: 10, exitCode: 0, manifest: null, result: { status: "solved", action_count: 1 }, evidenceCount: 1, log: "" });
assert(missingProvenance.status === "not_solved" && missingProvenance.failure_stage === "verification", "missing solved provenance was accepted");
const failedLauncher = buildValidationMetrics({ challenge: "fixture", startMs: 0, endMs: 10, exitCode: 1, manifest: null, result: { status: "solved", verified: true, verified_evidence_id: "e-1", flag_sha256: "abc" }, evidenceCount: 1, log: "" });
assert(failedLauncher.status === "infrastructure_failure" && failedLauncher.failure_stage === "infrastructure", "launcher failure was misclassified");
const timeout = buildValidationMetrics({ challenge: "fixture", startMs: 0, endMs: 10, exitCode: 1, manifest: null, result: { status: "timeout", reason: "deadline exceeded" }, evidenceCount: 0, log: "" });
assert(timeout.failure_stage === "timeout", "timeout classification mismatch");
const evidence = buildValidationMetrics({ challenge: "fixture", startMs: 0, endMs: 10, exitCode: 1, manifest: null, result: { status: "not_solved", reason: "evidence integrity mismatch" }, evidenceCount: 0, log: "" });
assert(evidence.failure_stage === "evidence", "evidence classification mismatch");
const infrastructure = buildValidationMetrics({ challenge: "fixture", startMs: 0, endMs: 10, exitCode: 1, manifest: null, result: null, evidenceCount: 0, log: "Pi failed to start" });
assert(infrastructure.failure_stage === "infrastructure", "infrastructure classification mismatch");
const resultDir = join(root, "report");
mkdirSync(resultDir, { recursive: true });
writeFileSync(join(resultDir, "stdout.log"), "picoCTF{plain} Cookie: session=secret Authorization: Bearer token\n");
writeFileSync(join(resultDir, "stderr.log"), "password=secret csrf_token=csrf\n");
writeValidationReport({ resultDir, challenge: "fixture", startMs: 0, endMs: 5, exitCode: 1, manifestPath: "" });
assert(existsSync(join(resultDir, "metrics.json")) && readFileSync(join(resultDir, "report.txt"), "utf8").includes("Failure stage:"), "report output missing");
for (const file of ["stdout.log", "stderr.log", "metrics.json", "report.txt"]) {
  const output = readFileSync(join(resultDir, file), "utf8");
  for (const secret of ["picoCTF{plain}", "session=secret", "Bearer token", "=secret", "=csrf"]) assert(!output.includes(secret), `${file} leaked ${secret}`);
}
const approved = validateValidationRoot(root, join(root, "results", "validation", "run"));
assert(approved.endsWith("/results/validation/run"), "approved validation root was rejected");
const outside = mkdtempSync(join(tmpdir(), "ctf-c-validation-outside-"));
awaitReject(() => validateValidationRoot(root, outside), /results\/validation/, "outside validation root was accepted");
const link = join(root, "results", "validation", "escape");
symlinkSync(outside, link);
awaitReject(() => validateValidationRoot(root, link), /symlink/, "symlink validation root was accepted");
process.stdout.write("validation report tests passed\n");

async function awaitReject(action, pattern, message) {
  try { await action(); } catch (error) {
    assert(error instanceof Error && pattern.test(error.message), `${message}: ${error.message}`);
    return;
  }
  throw new Error(`${message}: operation succeeded`);
}
