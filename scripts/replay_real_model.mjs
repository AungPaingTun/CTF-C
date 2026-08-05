import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { runReplay } from "./replay_competition.mjs";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);
const fixtures = [
  { name: "h1-basic-http", description: "Maintained H1 basic route fixture." },
  { name: "h2-stateful-auth", description: "Maintained H2 stateful login fixture." },
  { name: "h3-csrf-dynamic", description: "Maintained H3 session-bound authentication fixture." },
  { name: "h4-api-session", description: "Maintained H4 JSON API authentication fixture." },
  { name: "h5-recovery-auth", description: "Maintained H5 recovery and authentication fixture." },
  { name: "p10-websocket", description: "Maintained WebSocket protocol transition fixture." },
  { name: "derived-flag", description: "Redirect chain with a base64-encoded flag requiring provenance-backed verification." },
  { name: "interactive-starter", description: "Interactive starter contract exercised through the real launcher." },
  { name: "js-login-form", description: "Browser-required JavaScript-rendered login fixture.", browser_required: true },
];

function option(args, name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
}
function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "_");
}
function commandVersion(command, args) {
  try { return execFileSync(command, args, { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return "unknown"; }
}
function flagFrom(result) {
  const path = result.record?.paths?.private ? join(result.record.paths.private, "verified-flag.txt") : "";
  return path && existsSync(path) ? readFileSync(path, "utf8").trim() : null;
}
function toolErrorsFrom(result) {
  const directory = result.record?.paths?.evidence;
  if (!directory || !existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => /^\d+-e-\d+\.json$/.test(name)).sort().flatMap((name) => {
    const entry = JSON.parse(readFileSync(join(directory, name), "utf8"));
    return entry.outcome === "error" || entry.outcome === "timeout" || entry.transport_error ? [{ evidence_id: entry.evidence_id, tool: entry.tool, outcome: entry.outcome, transport_error: entry.transport_error ?? null }] : [];
  });
}
function counts(results) {
  return results.reduce((total, item) => {
    const status = item.status === "exhausted" ? "failed" : item.status;
    if (Object.hasOwn(total, status)) total[status] += 1;
    else if (status === "action_budget_exhausted") total.failed += 1;
    return total;
  }, { total: results.length, solved: 0, failed: 0, timeout: 0, infra_failure: 0, not_solved: 0 });
}
function normalizeStatus(status) {
  return status === "infrastructure_failure" ? "infra_failure" : status === "exhausted" ? "failed" : status;
}

async function main() {
  const args = process.argv.slice(2);
  const provider = option(args, "--provider", process.env.CTFC_PI_PROVIDER || "opencode-go");
  const model = option(args, "--model", process.env.CTFC_PI_MODEL || "deepseek-v4-pro");
  const thinking = option(args, "--thinking", process.env.CTFC_PI_THINKING || "off");
  const selected = option(args, "--fixtures", "").split(",").filter(Boolean);
  const availableFixtures = args.includes("--include-browser") ? fixtures : fixtures.filter((fixture) => !fixture.browser_required);
  const selectedFixtures = selected.length ? availableFixtures.filter((fixture) => selected.includes(fixture.name)) : availableFixtures;
  if (selected.length && selectedFixtures.length !== selected.length) throw new Error("Unknown fixture in --fixtures");
  if (args.includes("--dry-run")) {
    process.stdout.write(`${JSON.stringify({ provider, model, thinking, fixtures: selectedFixtures }, null, 2)}\n`);
    return 0;
  }
  const maxDuration = Number(option(args, "--max-duration-ms", String(2 * 60 * 60 * 1000)));
  const timeBudget = option(args, "--time-budget", "15");
  const actionBudget = option(args, "--action-budget", "20");
  if (!Number.isSafeInteger(maxDuration) || maxDuration < 1) throw new Error("--max-duration-ms must be a positive integer");
  const reportPath = resolve(option(args, "--report", join(projectRoot, "reports", `replay_real_model_${timestamp()}.json`)));
  const startedAt = Date.now();
  const results = [];
  for (const fixture of selectedFixtures) {
    if (Date.now() - startedAt >= maxDuration) {
      results.push({ name: fixture.name, status: "timeout", flag: null, time_used_ms: Date.now() - startedAt, actions_used: null, confidence: null, terminal_cause: "real_model_gate_deadline_exceeded", tool_errors: [], expected_fail: false });
      continue;
    }
    try {
      const replay = await runReplay({ fixture: fixture.name, timeBudget, actionBudget, piProvider: provider, piModel: model, piThinking: thinking });
      const summary = replay.summary;
      results.push({ name: fixture.name, status: normalizeStatus(summary.terminal_status), flag: flagFrom(replay), time_used_ms: summary.duration_ms, actions_used: summary.actions_total, confidence: replay.state?.reasoning?.confidence ?? null, terminal_cause: replay.result?.reason_code ?? (summary.terminal_status === "solved" ? "verified" : summary.failure_detail ?? null), tool_errors: toolErrorsFrom(replay), exploration_budget_used: summary.exploration_budget_used, exploration_budget_remaining: summary.exploration_budget_remaining, expected_fail: false });
    } catch (error) {
      results.push({ name: fixture.name, status: "infra_failure", flag: null, time_used_ms: Date.now() - startedAt, actions_used: null, confidence: null, terminal_cause: String(error?.message ?? "fixture replay failed").replace(/[\r\n]+/g, " ").slice(0, 512), tool_errors: [String(error?.message ?? "fixture replay failed")], expected_fail: false });
    }
  }
  const report = {
    summary: counts(results),
    per_fixture: results,
    metadata: {
      provider,
      model,
      pi_version: commandVersion("pi", ["--version"]),
      extension_commit: commandVersion("git", ["rev-parse", "--short", "HEAD"]),
      timestamp: new Date().toISOString(),
      time_budget_minutes: Number(timeBudget),
      action_budget: Number(actionBudget),
      max_duration_ms: maxDuration,
    },
  };
  mkdirSync(resolve(reportPath, ".."), { recursive: true, mode: 0o755 });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Report: ${reportPath}\n${JSON.stringify(report.summary)}\n`);
  return report.summary.solved === report.summary.total ? 0 : 1;
}

try { process.exitCode = await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
