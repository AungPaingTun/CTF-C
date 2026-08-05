import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { startH1Fixture } from "../tests/fixtures/h1-basic-http.mjs";
import { startH2Fixture } from "../tests/fixtures/h2-stateful-auth.mjs";
import { startH3Fixture } from "../tests/fixtures/h3-csrf-dynamic.mjs";
import { startH4Fixture } from "../tests/fixtures/h4-api-session.mjs";
import { startH5Fixture } from "../tests/fixtures/h5-recovery-auth.mjs";
import { startP10Fixture } from "../tests/fixtures/p10-websocket.mjs";
import { startDerivedFlagFixture } from "../tests/fixtures/derived-flag.mjs";
import { startJsLoginFixture } from "../tests/fixtures/js-login-form.mjs";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);
export const launcherPath = join(projectRoot, "scripts", "run_competition.sh");
const defaultOutputRoot = join(projectRoot, ".ctf-c", "replay-output");
const runtimeBase = join(projectRoot, ".ctf-c", "competition-runs");

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function safeDetail(status, reason) {
  if (status === "solved") return "Flag verified from retained evidence.";
  if (status === "action_budget_exhausted") return "The action budget was exhausted.";
  if (status === "timeout") return "The time budget expired.";
  if (status === "infrastructure_failure") return "The launcher or runtime failed before a verified solve.";
  return reason === "no_progress" ? "No verified flag was produced." : "The run ended without verification.";
}

export function mapTerminalStatus(status) {
  return status === "action_budget_exhausted" ? "exhausted" : ["solved", "not_solved", "timeout", "infrastructure_failure"].includes(status) ? status : "infrastructure_failure";
}

function evidenceFiles(record) {
  if (!existsSync(record.paths.evidence)) return [];
  return readdirSync(record.paths.evidence).filter((name) => /^\d+-e-\d+\.json$/.test(name)).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).map((name) => JSON.parse(readFileSync(join(record.paths.evidence, name), "utf8")));
}

export function summarizeRun({ record, state, result, startedAt, finishedAt, fixture = "h1-basic-http" }) {
  const evidence = evidenceFiles(record);
  const verifiedEvidence = result?.status === "solved" && result?.verified === true && typeof result.verified_evidence_id === "string"
    && evidence.some((entry) => entry.evidence_id === result.verified_evidence_id && ["http_request", "websocket_exchange"].includes(entry.tool));
  const status = result?.status ?? state?.status ?? "infrastructure_failure";
  const failureClass = status === "solved" ? "none" : status === "timeout" || status === "action_budget_exhausted" ? "budget" : status === "infrastructure_failure" ? "infrastructure" : "unknown";
  const start = new Date(startedAt ?? Date.now());
  const finish = new Date(finishedAt ?? Date.now());
  return {
    run_id: record.run_id,
    fixture,
    started_at: start.toISOString(),
    finished_at: finish.toISOString(),
    duration_ms: Math.max(0, finish.getTime() - start.getTime()),
    terminal_status: mapTerminalStatus(status),
    verified: verifiedEvidence,
    verified_flag_sha256: verifiedEvidence && typeof result.flag_sha256 === "string" ? result.flag_sha256 : null,
    actions_total: Number.isSafeInteger(state?.action_count) ? state.action_count : null,
    http_actions: evidence.filter((entry) => entry.tool === "http_request").length,
    websocket_actions: evidence.filter((entry) => entry.tool === "websocket_exchange").length,
    websocket_evidence_derived: evidence.some((entry) => entry.tool === "websocket_exchange" && typeof entry.evidence_source_id === "string"),
    tool_actions: Number.isSafeInteger(state?.tool_call_count) ? state.tool_call_count : null,
    analysis_actions: Number.isSafeInteger(state?.analysis_action_count) ? state.analysis_action_count : null,
    tool_errors: null,
    repeated_action_rejections: null,
    evidence_count: evidence.length,
    model: "unknown",
    provider: "unknown",
    failure_class: failureClass,
    failure_detail: safeDetail(status, result?.reason_code),
    exploration_budget_used: Number.isSafeInteger(state?.exploration_budget_used) ? state.exploration_budget_used : 0,
    exploration_budget_remaining: Number.isSafeInteger(state?.exploration_budget_used) && Number.isSafeInteger(state?.exploration_budget) ? Math.max(0, state.exploration_budget - state.exploration_budget_used) : 5,
    hypothesis_board: Array.isArray(state?.hypothesis_board) ? state.hypothesis_board.filter((h) => !h.retired).map((h) => ({ id: h.id, rank: h.rank, family: h.family, branch: h.branch, confidence: Math.round((h.confidence ?? 0) * 100) / 100, summary: h.summary, next_experiment: h.next_experiment })) : [],
    retired_hypotheses: Array.isArray(state?.retired_hypotheses) ? state.retired_hypotheses.map((h) => ({ id: h.id, family: h.family, branch: h.branch, confidence: Math.round((h.confidence ?? 0) * 100) / 100, summary: h.summary, retired_reason: h.retired_reason })) : [],
  };
}

function findRecord(runtimeRoot) {
  const entries = readdirSync(runtimeRoot).filter((entry) => entry.startsWith("run-") && existsSync(join(runtimeRoot, entry, "run-record.json")));
  if (entries.length !== 1) throw new Error(`Expected one generated run record, found ${entries.length}`);
  return join(runtimeRoot, entries[0], "run-record.json");
}

function invokeLauncher(args, env, timeoutMs) {
  return new Promise((resolveResult) => {
    const child = spawn(launcherPath, args, { cwd: projectRoot, env, stdio: ["ignore", "ignore", "ignore"] });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", () => resolveResult(127));
    child.on("close", (code) => { clearTimeout(timer); resolveResult(code ?? 127); });
  });
}

export async function runReplay({ fixture: fixtureName = "h1-basic-http", timeBudget = "15", actionBudget = "20", piProvider = "", piModel = "", piThinking = "", outputRoot = defaultOutputRoot, env = process.env } = {}) {
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  const fixtureStart = fixtureName === "h1-basic-http" ? startH1Fixture : fixtureName === "h2-stateful-auth" ? startH2Fixture : fixtureName === "h3-csrf-dynamic" ? startH3Fixture : fixtureName === "h4-api-session" ? startH4Fixture : fixtureName === "h5-recovery-auth" ? startH5Fixture : fixtureName === "p10-websocket" ? startP10Fixture : fixtureName === "derived-flag" ? startDerivedFlagFixture : fixtureName === "interactive-starter" ? startH1Fixture : fixtureName === "js-login-form" ? startJsLoginFixture : null;
  if (!fixtureStart) throw new Error(`Unsupported fixture: ${fixtureName}`);
  const fixture = await fixtureStart();
  const runtimeRoot = join(runtimeBase, `replay-${randomUUID()}`);
  mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  const startedAt = Date.now();
  let record;
  try {
    const replayDescription = fixtureName === "derived-flag"
      ? "This is a derived-flag challenge. Follow the observed redirects to the final response, retain its encoded value, and use verify_flag with the provenance-backed base64_decode derivation. Do not guess or copy a decoded flag."
        : fixtureName === "interactive-starter"
          ? "This is the interactive starter flow. Begin with the required root request, follow the observed route, and verify the flag from retained evidence."
          : fixtureName === "js-login-form"
            ? "This challenge requires browser_action. Use the persistent browser context to goto the root, wait for the JavaScript-rendered login form, type the observed credentials from retained page script evidence, submit it, and verify the success response."
          : null;
    await invokeLauncher([
      "--target", fixture.origin,
      "--approve",
      "--description", `${fixtureName === "h2-stateful-auth" ? "This is a stateful authentication challenge. Begin with the required root HTTP request. Use observed forms and routes to register a new account, log in with that same account, preserve the automatically issued cookie, follow the observed redirect/dashboard workflow, and verify the flag only from authenticated retained evidence. Do not use session replacement or session adoption tools unless evidence proves they are required. " : fixtureName === "h3-csrf-dynamic" ? "This is a session-bound CSRF authentication challenge. Begin with the required root request. Use observed forms and routes. Registration and login require dynamically generated hidden values that are bound to the current session. Do not guess, hard-code, or expose hidden values. When an observed form requires a session-bound hidden value, do not guess or place the raw value in form. Use evidence_form_fields to map the hidden field name to the evidence ID containing that observed form. The tool will inject the value privately. Continue to use ordinary form fields for username and password. Verify a flag only from authenticated retained evidence. " : fixtureName === "h4-api-session" ? "This is a stateful JSON API authentication challenge. Begin with the required root request. Use only observed routes. Registration and login require JSON request bodies, not form data. Preserve the automatically issued session cookie, follow the observed redirect, inspect the authenticated API state, and verify the flag only from retained authenticated evidence. Do not use session replacement or adoption tools. " : fixtureName === "h5-recovery-auth" ? "This is a recovery authentication challenge. Begin with the required root request. If a login attempt fails, inspect that exact response before another HTTP request, then follow only the observed pivot route. Use observed forms, preserve the automatically issued session cookie after authentication, inspect authenticated evidence, and verify the flag only from the observed authenticated route. " : ""}Challenge target at ${fixture.origin}. Follow observed routes and verify the flag from retained evidence.`,
       ...(replayDescription ? ["--description", replayDescription] : []),
       "--time-budget", String(timeBudget),
      "--action-budget", String(actionBudget),
      ...(piProvider ? ["--pi-provider", piProvider] : []),
      ...(piModel ? ["--pi-model", piModel] : []),
      ...(piThinking ? ["--pi-thinking", piThinking] : []),
    ], { ...env, CTFC_COMPETITION_RUNTIME_ROOT: runtimeRoot }, Number(timeBudget) * 60000 + 30000);
    const recordPath = findRecord(runtimeRoot);
    record = JSON.parse(readFileSync(recordPath, "utf8"));
    const state = existsSync(record.paths.state) ? JSON.parse(readFileSync(record.paths.state, "utf8")) : null;
    const result = existsSync(record.paths.result) ? JSON.parse(readFileSync(record.paths.result, "utf8")) : null;
    const summary = summarizeRun({ record, state, result, startedAt: state?.started_at ?? startedAt, finishedAt: Date.now(), fixture: fixtureName });
    const outputPath = join(outputRoot, `${summary.run_id}.json`);
    writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
     return { summary, outputPath, record, state, result };
  } catch (error) {
    const detail = String(error?.message ?? "The replay could not safely derive the generated run artifacts.").replace(/[\r\n]+/g, " ").slice(0, 512);
    const fallback = { run_id: record?.run_id ?? randomUUID(), fixture: fixtureName, started_at: new Date(startedAt).toISOString(), finished_at: new Date().toISOString(), duration_ms: Date.now() - startedAt, terminal_status: "infrastructure_failure", verified: false, verified_flag_sha256: null, actions_total: null, http_actions: null, websocket_actions: null, websocket_evidence_derived: false, tool_actions: null, analysis_actions: null, tool_errors: null, repeated_action_rejections: null, evidence_count: null, model: "unknown", provider: "unknown", failure_class: "infrastructure", failure_detail: detail };
    const outputPath = join(outputRoot, `${fallback.run_id}.json`);
    writeFileSync(outputPath, `${JSON.stringify(fallback, null, 2)}\n`, { mode: 0o600 });
    return { summary: fallback, outputPath, error };
  } finally {
    await fixture.stop();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fixture = option(args, "--fixture", "h1-basic-http");
  if (!["h1-basic-http", "h2-stateful-auth", "h3-csrf-dynamic", "h4-api-session", "h5-recovery-auth", "p10-websocket", "derived-flag", "interactive-starter", "js-login-form"].includes(fixture)) throw new Error("Unsupported replay fixture");
  const runs = Number(option(args, "--runs", "1"));
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
  const outputRoot = option(args, "--output-root", defaultOutputRoot);
  const piProvider = option(args, "--pi-provider", "");
  const piModel = option(args, "--pi-model", "");
  const piThinking = option(args, "--pi-thinking", "");
  const summaries = [];
  for (let index = 0; index < runs; index += 1) {
    const { summary, outputPath } = await runReplay({ fixture, timeBudget: option(args, "--time-budget", "15"), actionBudget: option(args, "--action-budget", "20"), piProvider, piModel, piThinking, outputRoot });
    summaries.push(summary);
    process.stdout.write(`run ${index + 1}/${runs}: ${summary.terminal_status}, verified=${summary.verified}, actions=${summary.actions_total ?? "unknown"}\n`);
    process.stdout.write(`summary: ${outputPath}\n`);
  }
  const solved = summaries.filter((summary) => summary.verified).length;
  process.stdout.write(`aggregate: runs=${runs}, solved=${solved}, evidence=${summaries.reduce((total, summary) => total + (summary.evidence_count ?? 0), 0)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
