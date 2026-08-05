import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { writeLiveLine } from "../../scripts/competition_output.mjs";
import { ingestCompetitionInputs } from "../../scripts/ingest_competition_inputs.mjs";

const METHODS = new Set(["GET", "POST"]);
const ACTIONS = new Set(["recon", "login", "authenticated_request", "submit", "trigger"]);
const WS_MAX_OUTBOUND_MESSAGES = 8;
const WS_MAX_RECEIVED_MESSAGES = 16;
const WS_MAX_MESSAGE_BYTES = 64 * 1024;
const WS_MAX_TOTAL_BYTES = 256 * 1024;
const WS_MAX_TIMEOUT = 15000;
const WS_SUBPROTOCOL = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const SAFE_HEADERS = new Set(["accept", "content-type", "origin", "referer", "x-requested-with"]);
const FORBIDDEN_HEADERS = new Set(["host", "cookie", "set-cookie", "authorization", "proxy-authorization", "connection", "transfer-encoding", "content-length", "upgrade"]);
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MAX_HEADERS = 32;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_BODY = 1024 * 1024;
const MAX_RAW_XML = 256 * 1024;
const MAX_INSPECT = 4096;
const MAX_TIMEOUT = 10000;
const MIN_TIMEOUT = 250;
const MAX_SOURCE_ENTRIES = 128;
const MAX_SOURCE_PATH = 512;
const MAX_SOURCE_OFFSET = 8 * 1024 * 1024;
const MAX_SOURCE_READ = 16 * 1024;
const MAX_EVIDENCE_FORM_FIELDS = 16;
const MAX_EVIDENCE_FORM_VALUE = 4096;
const MAX_MULTIPART_FILE_BYTES = 64 * 1024;
const MAX_MULTIPART_FILENAME = 128;
const MAX_MULTIPART_FIELDS = 8;
const MAX_MULTIPART_CONTENT_TYPE = 128;
const MAX_BINARY_VIEW_BYTES = 4096;
const MAX_DERIVED_BINARY_BYTES = 64 * 1024;
const FORM_FIELD_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const MAX_ANALYSIS_ACTIONS = 24;
const MAX_SEARCH_QUERY = 256;
const MAX_SEARCH_RESULTS = 64;
const MAX_SEARCH_FILES = 128;
const MAX_SEARCH_TOTAL_BYTES = 8 * 1024 * 1024;
const HYPOTHESIS_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const ACCOUNT_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TERMINAL_STATUSES = new Set(["not_solved", "timeout", "action_budget_exhausted", "infrastructure_failure"]);
const DEFAULT_FLAG_REGEX = "picoCTF\\{[^}\\r\\n]{1,256}\\}";
const MAX_REASONING_TEXT = 512;
const MAX_REASONING_ITEMS = 5;
const DEFAULT_EXPLORATION_BUDGET = 5;
const ROUTE_FAMILIES = new Set(["source", "api", "auth", "upload", "admin", "debug", "public", "other"]);
const HYPOTHESIS_FAMILIES = new Set(["auth_bypass", "idor", "ssti", "injection", "source_disclosure", "upload_execution", "protocol_transition", "unknown"]);
const HYPOTHESIS_BRANCHES = new Set(["confirmation", "extraction", "privilege_boundary"]);
const MAX_ACTIVE_HYPOTHESES = 3;
const HYPOTHESIS_MIN_CONFIDENCE = 0.2;
const HYPOTHESIS_MAX_FAILURES = 2;
const DIGEST_ALGORITHMS = new Set(["md5", "sha1", "sha256", "base64_encode", "base64_decode"]);
const DERIVATION_OPERATIONS = new Set(["base64_decode", "url_decode", "hex_decode", "xor_repeat", "concat"]);
const MAX_DERIVATION_BYTES = 64 * 1024;
const MAX_DIGEST_TEXT_BYTES = 4096;
const MAX_DIGEST_PURPOSE = 256;
const UNAVAILABLE_CAPABILITY_MARKER = "[UNAVAILABLE_CAPABILITY]";
const COMPETITION_TOOL_NAMES = ["http_request", "websocket_exchange", "browser_action", "start_competition_run", "inspect_evidence", "list_source", "read_source", "search_source", "compute_digest", "derive_binary_evidence", "run_local_command", "replace_session_cookie", "adopt_session_cookie", "verify_flag", "finalize_result"];
let activeRun;
let extensionApi;
let lastUserChallenge;
let watchdogTimer;
let browserContext;
let browserPage;
let browserOrigin;
let browserInstance;

const hash = (value) => createHash("sha256").update(value).digest("hex");
const RUNTIME_FILES = [".pi/extensions/ctf-c-stage2-core.mjs", "scripts/start_competition_pi.sh", "scripts/run_competition.sh"];
const STALE_RUNTIME_MESSAGE = "CTF-C files changed after this Pi session started. Exit Pi and start a fresh competition session before testing another challenge.";
function runtimeRevision() {
  const digest = createHash("sha256");
  for (const relativePath of RUNTIME_FILES) digest.update(relativePath).update("\u0000").update(readFileSync(resolve(process.cwd(), relativePath)));
  return digest.digest("hex");
}
const loadedRuntimeRevision = runtimeRevision();
function ensureRuntimeCurrent() {
  let currentRevision;
  try { currentRevision = runtimeRevision(); } catch { currentRevision = null; }
  if (currentRevision !== loadedRuntimeRevision) {
    extensionApi?.setActiveTools([]);
    throw new Error(STALE_RUNTIME_MESSAGE);
  }
}
const atomicWrite = (path, content) => {
  const temporary = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, path);
};
const inside = (parent, candidate) => {
  const path = relative(parent, candidate);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
};
function rejectSymlinks(root, target, allowRoot = false) {
  const path = relative(root, target);
  if ((!path && !allowRoot) || path.startsWith("..") || isAbsolute(path)) throw new Error("Path escapes run root");
  if (!path) return;
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("Symlink path component rejected");
  }
}
function compileFlagRegex(value) {
  if (typeof value !== "string" || !value || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Competition flag regex is invalid");
  try { return new RegExp(value); } catch { throw new Error("Competition flag regex is invalid"); }
}
function challengeText(message) {
  if (message?.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return Array.isArray(message.content)
    ? message.content.filter((part) => part?.type === "text").map((part) => part.text).join("")
    : "";
}
export function extractCompetitionTarget(text) {
  const raw = [...String(text).matchAll(/https?:\/\/[^\s<>"'`]+/gi)].map((match) => match[0].replace(/[.,;:!?)}\]]+$/g, ""));
  const targets = [];
  for (const candidate of raw) {
    let url;
    try { url = new URL(candidate); } catch { continue; }
    if (!["http:", "https:"].includes(url.protocol)) continue;
    if (url.username || url.password) throw new Error("Target credentials are not allowed");
    if (url.hash) throw new Error("Target fragments are not allowed");
    const origin = `${url.protocol}//${url.host}`;
    if (!targets.some((target) => target.url === url.href)) targets.push({ origin, candidate, url: url.href });
  }
  if (targets.length === 0) throw new Error("No HTTP/HTTPS target URL found");
  if (targets.length > 1) throw new Error("Multiple distinct target URLs found");
  return { origin: targets[0].origin, candidate: targets[0].candidate };
}
function validateRunOption(value, fallback, name, maximum) {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < 1 || selected > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  return selected;
}
function createRunRecord({ targetOrigin, description, timeBudget, actionBudget, flagRegex }) {
  return new Promise((resolveResult, rejectResult) => {
    const script = join(process.cwd(), "scripts", "create_competition_run.mjs");
    const child = spawn(process.execPath, [script, "--target", targetOrigin, "--approve", "--description", description, "--time-budget", String(timeBudget), "--action-budget", String(actionBudget), "--flag-regex", flagRegex], {
      cwd: process.cwd(),
      env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", rejectResult);
    child.on("close", (code) => {
      if (code !== 0) return rejectResult(new Error(Buffer.concat(stderr).toString("utf8").trim() || "Competition run creation failed"));
      const recordPath = Buffer.concat(stdout).toString("utf8").trim();
      if (!recordPath || !isAbsolute(recordPath)) return rejectResult(new Error("Competition run creation returned an invalid record"));
      resolveResult(recordPath);
    });
  });
}
async function startCompetitionRun(params, trustedText = null) {
  retireExpiredRun();
  if (typeof params.challenge_text !== "string" || !params.challenge_text.trim()) throw new Error("Challenge text is required");
  if (trustedText !== null && params.challenge_text !== trustedText) throw new Error("Challenge text must match the pasted user message");
  if (trustedText === null && (!lastUserChallenge || params.challenge_text !== lastUserChallenge)) throw new Error("Challenge text must come from the pasted user message");
  const text = params.challenge_text;
  if (!/\b(?:ctf|picoctf|challenge|flag|capture[\s-]*the[\s-]*flag)\b/i.test(text)) throw new Error("Message does not meet challenge activation criteria");
  const target = extractCompetitionTarget(text);
  if (params.target_url !== undefined && (typeof params.target_url !== "string" || params.target_url !== target.candidate)) throw new Error("target_url must match the extracted challenge target");
  if (activeRun?.status === "active" && activeRun.target_origin === target.origin) return { run_id: activeRun.run_id, target_origin: activeRun.target_origin, status: activeRun.status, time_budget: activeRun.time_budget, action_budget: activeRun.action_budget, reused: true };
  const timeBudget = validateRunOption(params.time_budget_minutes, 15, "Time budget", 30);
  const actionBudget = validateRunOption(params.action_budget, trustedText !== null ? 60 : 20, "Action budget", 60);
  const flagRegex = params.flag_regex ?? DEFAULT_FLAG_REGEX;
  compileFlagRegex(flagRegex);
  const recordPath = await createRunRecord({ targetOrigin: target.origin, description: text, timeBudget, actionBudget, flagRegex });
  ingestCompetitionInputs(recordPath, text);
  if (activeRun?.status === "active" && activeRun.target_origin !== target.origin) activeRun = null;
  process.env.CTFC_COMPETITION_RUN_RECORD = recordPath;
  initializeCompetitionRun();
  extensionApi?.setActiveTools(COMPETITION_TOOL_NAMES);
  return { run_id: activeRun.run_id, target_origin: activeRun.target_origin, status: activeRun.status, time_budget: activeRun.time_budget, action_budget: activeRun.action_budget };
}
function sanitize(value, limit = MAX_INSPECT) {
  // Public previews are redacted; private evidence remains the verification source.
  const flagPattern = activeRun?.flagPattern;
  const htmlRedacted = String(value).replace(/<(input|textarea|select|button)\b[^>]*>/gi, (tag) => {
    const name = attr(tag, "name");
    if (!sensitiveFieldName(name)) return tag;
    return tag.replace(/(\bvalue\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "$1\"[REDACTED_SECRET]\"");
  }).replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea\s*>)/gi, (full, opening, closing) => sensitiveFieldName(attr(opening, "name")) ? `${opening}[REDACTED_SECRET]${closing}` : full);
  const redacted = flagPattern ? htmlRedacted.replace(new RegExp(flagPattern.source, "g"), "[REDACTED_FLAG]") : htmlRedacted;
  return redacted
    .replace(/((?:["']?\b(?:cookie|set-cookie|authorization|password|passwd|secret|session(?:[_-]?id)?|csrf(?:[_-]?token)?|xsrf(?:[_-]?token)?|token)\b["']?)\s*[:=]\s*["']?)(?:bearer\s+)?[^"'\s,;&}]+/gi, "$1[REDACTED_SECRET]")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").slice(0, limit);
}
function reasoningParams(value) {
  if (!value || typeof value !== "object") throw new Error("HTTP reasoning is required");
  const list = (name, required = true) => {
    const items = value[name];
    if (!required && items === undefined) return [];
    if (!Array.isArray(items) || (!items.length && required) || items.length > MAX_REASONING_ITEMS || items.some((item) => typeof item !== "string" || !item.trim() || item.length > MAX_REASONING_TEXT)) throw new Error(`Invalid reasoning ${name}`);
    return items.map((item) => sanitize(item, MAX_REASONING_TEXT));
  };
  const text = (name) => {
    if (typeof value[name] !== "string" || !value[name].trim() || value[name].length > MAX_REASONING_TEXT) throw new Error(`Invalid reasoning ${name}`);
    return sanitize(value[name], MAX_REASONING_TEXT);
  };
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error("Invalid reasoning confidence");
  const explorationScore = value.exploration_score;
  if (explorationScore !== undefined && (!Number.isFinite(explorationScore) || explorationScore < 0 || explorationScore > 1)) throw new Error("Invalid exploration score");
  const explorationJustification = value.exploration_justification === undefined ? "" : text("exploration_justification");
  const routeFamily = value.route_family === undefined ? "other" : String(value.route_family);
  if (!ROUTE_FAMILIES.has(routeFamily)) throw new Error("Invalid route family");
  const nextExperiment = value.next_experiment === undefined ? "" : text("next_experiment");
  return { evidence_summary: list("evidence_summary"), leading_hypothesis: text("leading_hypothesis"), supporting_evidence: list("supporting_evidence"), experiment: text("experiment"), expected_observation: text("expected_observation"), confidence: value.confidence, untested_experiments: list("untested_experiments", false), exploration_score: explorationScore, exploration_justification: explorationJustification, route_family: routeFamily, next_experiment: nextExperiment };
}
function reasoningFingerprint(request) {
  return hash(JSON.stringify({ hypothesis: request.reasoning.leading_hypothesis, experiment: request.reasoning.experiment })).slice(0, 24);
}
function classifyTransport(statusCode, outcome, error) {
  if (statusCode != null) return outcome === "redirect" ? "redirect" : statusCode >= 400 ? "application_error" : "http_response";
  if (outcome === "timeout") return "timeout";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|dns/i.test(error)) return "dns_failure";
  if (/ECONNREFUSED|connection refused/i.test(error)) return "connection_refused";
  if (/TLS|SSL|certificate|self[- ]signed/i.test(error)) return "tls_failure";
  return "unknown_transport";
}
function transportErrorCode(statusCode, outcome, error) {
  if (statusCode != null) return null;
  if (/DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_HAS_EXPIRED|ERR_TLS_CERT_ALTNAME_INVALID|certificate verify failed|self[- ]signed|certificate/i.test(error)) return "tls_certificate_validation_failed";
  if (outcome === "timeout" || /timeout|timed out|ETIMEDOUT/i.test(error)) return "connection_timeout";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|dns/i.test(error)) return "dns_resolution_failed";
  if (/ECONNREFUSED|connection refused/i.test(error)) return "connection_refused";
  if (/ECONNRESET|socket hang up|socket reset/i.test(error)) return "socket_reset";
  return "transport_failure";
}
function sanitizedTransportPreview(code) {
  return code === "tls_certificate_validation_failed" ? "TLS certificate validation failed for the authorized origin." : code === "dns_resolution_failed" ? "DNS resolution failed for the authorized origin." : code === "connection_refused" ? "Connection refused by the authorized origin." : code === "connection_timeout" ? "Connection timed out before an HTTP response." : code === "socket_reset" ? "The connection was reset before an HTTP response." : "The authorized origin could not be reached before an HTTP response.";
}
function updateReasoning(request, statusCode, outcome, error = "") {
  const before = request.reasoning.confidence;
  const transportClass = classifyTransport(statusCode, outcome, error);
  const after = statusCode == null || outcome === "error" || outcome === "timeout"
    ? Math.max(0, before - (transportClass === "unknown_transport" ? 0.1 : 0.2))
    : statusCode >= 200 && statusCode < 300
      ? Math.min(1, before + 0.1)
      : statusCode >= 400
        ? Math.max(0, before - 0.15)
        : before;
  activeRun.reasoning = { current_hypothesis: request.reasoning.leading_hypothesis, confidence: after, supporting_evidence: request.reasoning.supporting_evidence, untested_experiments: request.reasoning.untested_experiments, next_experiment: request.reasoning.next_experiment, tested_experiments: [...activeRun.reasoning.tested_experiments, reasoningFingerprint(request)].slice(-128), transport_class: transportClass, transport_observations: [...(activeRun.reasoning.transport_observations ?? []), { class: transportClass, fingerprint: reasoningFingerprint(request) }].slice(-64) };
  return { ...request.reasoning, confidence_after: after };
}
function evidenceTierForBoard(statusCode, outcome, body) {
  const text = typeof body === "string" ? body.slice(0, 4096) : (Buffer.isBuffer(body) ? body.toString("utf8").slice(0, 4096) : "");
  if (statusCode >= 200 && statusCode < 300) return activeRun.cookies.size > 0 || /login|session|auth/i.test(text) ? "authenticated_response" : /<form/i.test(text) ? "html_forms" : /<!--/.test(text) ? "comments" : "html_forms";
  if (statusCode >= 300 && statusCode < 400) return "redirect_targets";
  if (statusCode >= 500) return "server_metadata";
  if (statusCode >= 400) return "error_messages";
  if (outcome === "timeout" || outcome === "error") return "timing";
  return "speculation";
}
const TIER_SCORES = { authenticated_response: 1.0, server_metadata: 0.8, redirect_targets: 0.7, html_forms: 0.6, comments: 0.5, headers: 0.4, error_messages: 0.3, timing: 0.2, speculation: 0.1 };
function tierScore(tier) { return TIER_SCORES[tier] ?? 0.1; }
function initializeHypothesisBoard() {
  if (!activeRun.hypothesisBoard) activeRun.hypothesisBoard = [];
  if (!activeRun.retiredHypotheses) activeRun.retiredHypotheses = [];
  if (!activeRun.familyBranchFailures) activeRun.familyBranchFailures = {};
  const active = activeRun.hypothesisBoard.filter((h) => !h.retired);
  if (active.length === 0 && activeRun.evidenceRecords.size > 0 && activeRun.hypothesisBoard.length === 0) spawnUnknownHypothesis();
}
function classifyFamily(text) {
  const lower = text.toLowerCase();
  if (/auth|bypass|login|session|credential|password|token/.test(lower)) return "auth_bypass";
  if (/idor|direct.object|reference|access.control/.test(lower)) return "idor";
  if (/ssti|template|jinja|twig|mustache|render/.test(lower)) return "ssti";
  if (/sql|injection|xss|command|os.inject|code.exec/.test(lower)) return "injection";
  if (/source|disclosure|leak|expos|\.git|\.env|config/.test(lower)) return "source_disclosure";
  if (/upload|file.exec|shell.upload/.test(lower)) return "upload_execution";
  if (/websocket|protocol|transition|upgrade/.test(lower)) return "protocol_transition";
  return "unknown";
}
function classifyBranch(experiment) {
  const lower = experiment.toLowerCase();
  if (/extract|dump|read|steal|retrieve|download/.test(lower)) return "extraction";
  if (/privilege|admin|escalat|role|elevat/.test(lower)) return "privilege_boundary";
  return "confirmation";
}
function findBoardHypothesis(leadingHypothesis) {
  const family = classifyFamily(leadingHypothesis);
  const summary = leadingHypothesis.slice(0, 64).toLowerCase();
  return activeRun.hypothesisBoard.find((h) => !h.retired && (h.family === family || h.summary.toLowerCase().includes(summary) || summary.includes(h.summary.toLowerCase())));
}
function capHypotheses() {
  const active = activeRun.hypothesisBoard.filter((h) => !h.retired);
  while (active.length > MAX_ACTIVE_HYPOTHESES) {
    const weakest = active.sort((a, b) => a.confidence - b.confidence)[0];
    weakest.retired = true;
    weakest.retired_reason = "capped at 3 active hypotheses";
    activeRun.retiredHypotheses.push({ ...weakest });
    activeRun.hypothesisBoard = activeRun.hypothesisBoard.filter((h) => h.id !== weakest.id);
    const idx = active.indexOf(weakest);
    if (idx >= 0) active.splice(idx, 1);
  }
}
function promoteHypotheses() {
  const active = activeRun.hypothesisBoard.filter((h) => !h.retired).sort((a, b) => b.confidence - a.confidence);
  for (let i = 0; i < active.length; i += 1) active[i].rank = i + 1;
}
function hypothesisBoardSummary() {
  const active = (activeRun?.hypothesisBoard ?? []).filter((h) => !h.retired);
  if (!active.length) return [];
  return active.map((h) => ({ id: h.id, rank: h.rank, family: h.family, branch: h.branch, confidence: Math.round(h.confidence * 100) / 100, summary: h.summary, next_experiment: h.next_experiment, supporting_count: h.supporting_evidence_ids.length, disconfirming_count: h.disconfirming_evidence_ids.length }));
}
function spawnUnknownHypothesis() {
  const evidenceRecords = [...activeRun.evidenceRecords.values()];
  if (!evidenceRecords.length) return;
  const bestEvidence = evidenceRecords.filter((item) => item.record.tool === "http_request" && item.record.status_code >= 200 && item.record.status_code < 300).sort((a, b) => (b.record.sequence ?? 0) - (a.record.sequence ?? 0))[0]
    ?? evidenceRecords.filter((item) => item.record.tool === "http_request").sort((a, b) => (b.record.sequence ?? 0) - (a.record.sequence ?? 0))[0];
  if (!bestEvidence) return;
  const evidenceId = bestEvidence.record.evidence_id;
  let bodyText = "";
  try { bodyText = evidenceFor(evidenceId).body.toString("utf8").slice(0, 4096); } catch {}
  const links = bodyText ? [...bodyText.matchAll(/href\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)].slice(0, 3).map((m) => normalizeCluePath(m[1] ?? m[2])) : [];
  const forms = bodyText ? [...bodyText.matchAll(/<form\b[^>]*action\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].slice(0, 3).map((m) => ({ path: normalizeCluePath(m[1] ?? m[2]), method: "GET" })) : [];
  let next = "";
  if (links[0]) next = `GET ${links[0]}`;
  else if (forms[0]) next = `${forms[0].method} ${forms[0].path}`;
  const id = `h${(activeRun.hypothesisBoard?.length ?? 0) + (activeRun.retiredHypotheses?.length ?? 0) + 1}`;
  activeRun.hypothesisBoard.push({ id, rank: 1, family: "unknown", summary: "spawned from strongest retained evidence", supporting_evidence_ids: [evidenceId], confidence: 0.4, next_experiment: next, disconfirming_evidence_ids: [], estimated_action_cost: 1, branch: "confirmation", retired: false, retired_reason: null });
}
function updateHypothesisBoard(reasoning, evidenceId, statusCode, outcome, body) {
  initializeHypothesisBoard();
  const tier = evidenceTierForBoard(statusCode, outcome, body);
  const weight = tierScore(tier);
  if (!reasoning?.leading_hypothesis) return;
  const leadingHypothesis = reasoning.leading_hypothesis;
  const confidence = reasoning.confidence_after ?? reasoning.confidence ?? 0.5;
  const experiment = reasoning.experiment ?? "";
  const nextExperiment = reasoning.next_experiment ?? "";
  const family = classifyFamily(leadingHypothesis);
  const branch = classifyBranch(experiment);
  let h = findBoardHypothesis(leadingHypothesis);
  if (!h) {
    const id = `h${activeRun.hypothesisBoard.length + activeRun.retiredHypotheses.length + 1}`;
    h = { id, rank: activeRun.hypothesisBoard.filter((x) => !x.retired).length + 1, family, summary: leadingHypothesis.slice(0, 128), supporting_evidence_ids: [], confidence: 0.5, next_experiment: "", disconfirming_evidence_ids: [], estimated_action_cost: 1, branch, retired: false, retired_reason: null };
    activeRun.hypothesisBoard.push(h);
  }
  const success = statusCode >= 200 && statusCode < 300;
  const failure = !success && (outcome === "error" || outcome === "timeout" || statusCode >= 400);
  const adjustment = success ? 0.1 * weight : failure ? -0.12 * weight : 0;
  h.confidence = Math.max(0, Math.min(1, h.confidence + adjustment));
  if (adjustment > 0) { h.supporting_evidence_ids = [...new Set([...h.supporting_evidence_ids, evidenceId])].slice(-32); }
  else if (adjustment < 0) { h.disconfirming_evidence_ids = [...new Set([...h.disconfirming_evidence_ids, evidenceId])].slice(-32); }
  h.summary = leadingHypothesis.slice(0, 128);
  if (nextExperiment) h.next_experiment = nextExperiment;
  h.branch = branch;
  const fbKey = `${family}:${branch}`;
  activeRun.familyBranchFailures[fbKey] = (activeRun.familyBranchFailures[fbKey] ?? 0) + (failure ? 1 : 0);
  if (success) activeRun.familyBranchFailures[fbKey] = 0;
  if (h.confidence < HYPOTHESIS_MIN_CONFIDENCE) {
    h.retired = true;
    h.retired_reason = `confidence ${h.confidence.toFixed(2)} below threshold`;
    activeRun.retiredHypotheses.push({ ...h });
    activeRun.hypothesisBoard = activeRun.hypothesisBoard.filter((bh) => bh.id !== h.id);
  } else if (activeRun.familyBranchFailures[fbKey] >= HYPOTHESIS_MAX_FAILURES && h.supporting_evidence_ids.length < 2) {
    h.retired = true;
    h.retired_reason = `two failed ${family}/${branch} experiments without new evidence`;
    activeRun.retiredHypotheses.push({ ...h });
    activeRun.hypothesisBoard = activeRun.hypothesisBoard.filter((bh) => bh.id !== h.id);
  }
  capHypotheses();
  promoteHypotheses();
  persistState();
}
function headersForEvidence(headers) {
  const result = {};
  for (const [name, value] of headers ?? []) result[name.toLowerCase()] = /^(authorization|cookie|set-cookie|proxy-authenticate|proxy-authorization|x-)/i.test(name) ? "[REDACTED_SECRET]" : sanitize(value, 512);
  return result;
}
function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? match[1] ?? match[2] ?? match[3] ?? "" : "";
}
function sensitiveFieldName(name) {
  return /(?:csrf|xsrf|token|nonce|authenticity[_-]?token|^state$)/i.test(name);
}
function resolveSameOriginUrl(value, baseUrl = activeRun.target_origin) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try { url = new URL(value, baseUrl); } catch { return null; }
  return url.origin === activeRun.target_origin ? url : null;
}
function displayResolvedUrl(value, baseUrl) {
  const url = resolveSameOriginUrl(value, baseUrl);
  return url ? `${url.pathname || "/"}${url.search}${url.hash}` : sanitize(value, 512);
}
function evidenceRequestUrl(record) {
  return resolveSameOriginUrl(record.request?.path || "/", activeRun.target_origin) ?? new URL(activeRun.target_origin);
}
function inspectHtml(body, baseUrl = activeRun.target_origin) {
  const forms = [];
  for (const match of body.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form\s*>/gi)) {
    if (forms.length === 32) break;
    const opening = match[0].slice(0, match[0].indexOf(">") + 1);
    const controls = [...match[1].matchAll(/<(input|textarea|select|button)\b[^>]*>/gi)].slice(0, 32).map((control) => {
      const name = attr(control[0], "name");
      const type = attr(control[0], "type") || control[1].toLowerCase();
      return { tag: control[1].toLowerCase(), name: sanitize(name, 128), type: sanitize(type, 64), value: /(?:pass|secret|token|csrf|session|cookie|auth)/i.test(`${name} ${type}`) ? "[REDACTED_SECRET]" : sanitize(attr(control[0], "value"), 256) };
    });
    forms.push({ action: displayResolvedUrl(attr(opening, "action") || new URL(baseUrl).pathname, baseUrl), method: (attr(opening, "method") || "GET").toUpperCase(), controls });
  }
  const links = [...body.matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].slice(0, 32).map((match) => displayResolvedUrl(match[1] ?? match[2] ?? match[3], baseUrl));
  const scripts = [...body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].slice(0, 32).map((match) => {
    const source = attr(match[0].slice(0, match[0].indexOf(">") + 1), "src");
    return source ? { src: displayResolvedUrl(source, baseUrl) } : { inline_excerpt: sanitize(match[2], 512) };
  });
  return { forms, links, scripts };
}
function jsonSummary(body) {
  const trimmed = body.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) return null;
  try {
    const value = JSON.parse(trimmed);
    if (Array.isArray(value)) return { type: "array", length: value.length };
    if (value && typeof value === "object") return { type: "object", keys: Object.keys(value).slice(0, 32).map((key) => sanitize(key, 128)) };
    return { type: typeof value };
  } catch { return null; }
}
function redactBinary(body) {
  const pattern = activeRun?.flagPattern;
  if (!pattern) return body;
  const text = body.toString("utf8");
  const matcher = new RegExp(pattern.source, "g");
  const parts = [];
  let cursor = 0;
  for (const match of text.matchAll(matcher)) {
    const start = Buffer.byteLength(text.slice(0, match.index), "utf8");
    const end = start + Buffer.byteLength(match[0], "utf8");
    parts.push(body.subarray(cursor, start), Buffer.from("[REDACTED_FLAG]"));
    cursor = end;
  }
  return parts.length ? Buffer.concat([...parts, body.subarray(cursor)]) : body;
}
function readVarUint(bytes, cursor) {
  let value = 0;
  let shift = 0;
  for (let count = 0; count < 5; count += 1) {
    if (cursor >= bytes.length) throw new Error("Invalid WASM varuint");
    const byte = bytes[cursor++];
    value += (byte & 0x7f) * (2 ** shift);
    if (!(byte & 0x80)) return { value, cursor };
    shift += 7;
  }
  throw new Error("Invalid WASM varuint");
}
function readWasmName(bytes, cursor) {
  const length = readVarUint(bytes, cursor); cursor = length.cursor;
  const end = cursor + length.value;
  if (end > bytes.length) throw new Error("Invalid WASM name");
  return { value: sanitize(bytes.subarray(cursor, end).toString("utf8"), 128), cursor: end };
}
function inspectBinaryView(body, offset, limit, view) {
  const bytes = body.subarray(offset, offset + limit);
  if (view === "hex") {
    const safe = redactBinary(bytes);
    const lines = [];
    for (let index = 0; index < safe.length; index += 16) {
      const line = safe.subarray(index, index + 16);
      const ascii = [...line].map((byte) => byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".").join("");
      lines.push({ offset: offset + index, hex: line.toString("hex"), ascii: sanitize(ascii, 64) });
    }
    return { view, offset, byte_count: bytes.length, lines };
  }
  if (view === "strings") {
    const strings = [];
    let start = -1;
    for (let index = 0; index <= bytes.length; index += 1) {
      const printable = index < bytes.length && bytes[index] >= 0x20 && bytes[index] <= 0x7e;
      if (printable && start < 0) start = index;
      if ((!printable || index === bytes.length) && start >= 0) {
        if (index - start >= 4) strings.push({ offset: offset + start, encoding: "ascii", text: sanitize(bytes.subarray(start, index).toString("ascii"), 256) });
        start = -1;
        if (strings.length >= 128) break;
      }
    }
    return { view, offset, byte_count: bytes.length, strings };
  }
  if (bytes.length < 8 || !bytes.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d])) || !bytes.subarray(4, 8).equals(Buffer.from([0x01, 0x00, 0x00, 0x00]))) throw new Error("Invalid WASM magic or version");
  const sections = [];
  const exports = [];
  const dataRanges = [];
  let cursor = 8;
  while (cursor < bytes.length) {
    const id = bytes[cursor++];
    const size = readVarUint(bytes, cursor); cursor = size.cursor;
    const payloadOffset = cursor;
    const end = cursor + size.value;
    if (end > bytes.length) throw new Error("Truncated WASM section");
    sections.push({ id, offset: offset + payloadOffset, byte_length: size.value });
    if (id === 7) {
      let exportCursor = payloadOffset;
      const count = readVarUint(bytes, exportCursor); exportCursor = count.cursor;
      for (let index = 0; index < count.value && index < 128; index += 1) {
        const name = readWasmName(bytes, exportCursor); exportCursor = name.cursor;
        if (exportCursor >= end) throw new Error("Invalid WASM export");
        const kind = bytes[exportCursor++];
        const exportIndex = readVarUint(bytes, exportCursor); exportCursor = exportIndex.cursor;
        exports.push({ name: name.value, kind, index: exportIndex.value });
      }
    }
    if (id === 11) dataRanges.push({ offset: offset + payloadOffset, byte_length: size.value });
    cursor = end;
  }
  return { view, offset, byte_count: bytes.length, version: 1, sections, exports, data_ranges: dataRanges };
}
function normalizeCluePath(value, baseUrl = activeRun.target_origin) {
  const url = resolveSameOriginUrl(value, baseUrl);
  return url?.pathname || null;
}
function cleanBodyRoute(value) {
  return value.replace(/["'`](?:[,;)]*)$/, "").replace(/[,;]+$/, "");
}
function evidenceRouteClues() {
  const clues = [];
  const add = (value, source, baseUrl = activeRun.target_origin) => {
    const path = normalizeCluePath(value, baseUrl);
    if (path && !clues.some((clue) => clue.path === path)) clues.push({ path, source });
  };
  for (const [evidenceId, item] of activeRun.evidenceRecords) {
    const record = item.record;
    if (record.tool !== "http_request") continue;
    const baseUrl = evidenceRequestUrl(record);
    add(record.request?.path, "an observed request");
    add(record.response_headers?.location, "a response redirect", baseUrl);
    for (const [name, value] of Object.entries(record.response_headers ?? {})) add(value, `an observed ${name} response header`, baseUrl);
    const body = evidenceFor(evidenceId).body.toString("utf8");
    const inspected = inspectHtml(body, baseUrl);
    for (const link of inspected.links) add(link, "an observed link", baseUrl);
    for (const form of inspected.forms) add(form.action, "an observed form", baseUrl);
    for (const script of inspected.scripts) {
      add(script.src, "an observed script", baseUrl);
      for (const match of String(script.inline_excerpt ?? "").matchAll(/(?:fetch|WebSocket|location(?:\.href)?|window\.location)\s*\([^)]*?["']([^"']+)["']/gi)) add(match[1], "an observed script route", baseUrl);
    }
    const routeToken = /(?:["'`]|\s)((?:\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%{}\[\]-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%{}\[\]-]+)*)|(?:[A-Za-z0-9._~-]+\/)+[A-Za-z0-9._~!$&'()*+,;=:@%{}\[\]-]+|[A-Za-z0-9._~-]+\.(?:php|html?|js|css|json|txt))(?:[?#][^"'`\s<]*)?)(?=["'`\s<])/gi;
    for (const match of body.matchAll(routeToken)) add(cleanBodyRoute(match[1]), "an observed response route", baseUrl);
  }
  return clues;
}
function sameRouteFamily(candidate, observed) {
  const left = candidate.split("/").filter(Boolean);
  const right = observed.split("/").filter(Boolean);
  if (!left.length || !right.length) return candidate === observed;
  const length = Math.min(left.length, right.length);
  let same = 0;
  for (let index = 0; index < length; index += 1) if (left[index] === right[index]) same += 1;
  if (left.length === right.length) return same >= left.length - 1 && same >= 1;
  return Math.abs(left.length - right.length) === 1 && same >= length - 1 && same >= 1;
}
function routeFamily(path) {
  const value = path.toLowerCase();
  if (/\/source(?:\/|$)|\.git|\.env|config/.test(value)) return "source";
  if (/\/api(?:\/|$)|\.json(?:$|[?#])/.test(value)) return "api";
  if (/login|logout|auth|session|register|account/.test(value)) return "auth";
  if (/upload|file|attachment|media/.test(value)) return "upload";
  if (/admin|dashboard|manage/.test(value)) return "admin";
  if (/debug|trace|test|health/.test(value)) return "debug";
  if (/public|static|assets|robots\.txt|sitemap\.xml/.test(value)) return "public";
  return "other";
}
function requestDecision(request) {
  if (activeRun.evidenceSequence === 0) return { allow: true };
  if (activeRun.hypothesisRoutePaths.has(request.path)) return { allow: false, reason: `Rejected repeated hypothesis route ${request.path}.` };
  const clues = evidenceRouteClues();
  const observed = clues.map((clue) => clue.path);
  const exact = clues.find((clue) => clue.path === request.path);
  if (exact) return { allow: true };
  if (activeRun.cookies.size && request.path === "/") return { allow: true };
  const explored = new Set([...activeRun.evidenceRecords.values()].map((item) => item.record.request?.path).filter(Boolean));
  const strongest = clues.find((clue) => !explored.has(clue.path));
  const clue = strongest ?? clues[0];
  const detail = clue ? `Strongest current clue: ${clue.source} at ${clue.path}.` : "No retained route clue supports this request.";
  const qualifyingHypothesis = request.method === "GET" && request.action_kind === "recon" && request.path.startsWith("/") && !request.path.startsWith("//") && request.url.origin === activeRun.target_origin && request.reasoning.leading_hypothesis.trim() && request.reasoning.supporting_evidence.length && request.reasoning.experiment.trim() && request.reasoning.expected_observation.trim();
  if (qualifyingHypothesis) {
    const score = request.reasoning.exploration_score;
    const justification = request.reasoning.exploration_justification;
    if (score === undefined || !justification) return { allow: false, reason: `Rejected unknown route ${request.path}: provide exploration_score and exploration_justification.` };
    const family = request.reasoning.route_family === "other" ? routeFamily(request.path) : request.reasoning.route_family;
    const repeatedFamily = activeRun.exploredRouteFamilies.has(family);
    const effectiveScore = repeatedFamily ? Math.max(0, score - 0.15) : score;
    if (effectiveScore < 0.3 && activeRun.reasoning.current_hypothesis) return { allow: false, reason: `Rejected unknown route ${request.path}: exploration score must be at least 0.3 while an active hypothesis remains.` };
    if (activeRun.explorationBudgetRemaining < 1) return { allow: false, reason: `Rejected unknown route ${request.path}: exploration budget is exhausted.` };
    const exploration = { score, effectiveScore, justification, family, repeatedFamily, beforeClues: new Set(observed) };
    activeRun.explorationBudgetUsed += 1;
    activeRun.explorationBudgetRemaining -= 1;
    activeRun.exploredRouteFamilies.add(family);
    activeRun.pendingExploration = exploration;
    activeRun.explorationLog.push({ path: request.path, score, effective_score: effectiveScore, justification, family, outcome: "reserved" });
    persistState();
    return { allow: true, hypothesisPath: request.path, exploration };
  }
  return { allow: false, reason: `Rejected HTTP request to ${request.path}. ${detail}` };
}

function loadRecord() {
  const recordPath = process.env.CTFC_COMPETITION_RUN_RECORD;
  if (!recordPath || !isAbsolute(recordPath) || !existsSync(recordPath) || lstatSync(recordPath).isSymbolicLink()) throw new Error("Competition run record is missing or unsafe");
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  if (!record.run_id || !record.approved || !record.target_origin || !record.flag_regex || !record.paths?.run_root || !record.paths.state || !record.paths.evidence || !record.paths.private || !record.paths.cookies || !record.paths.result) throw new Error("Incomplete competition run record");
  const target = new URL(record.target_origin);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || target.pathname !== "/" || target.search || target.hash) throw new Error("Invalid competition target origin");
  const runRoot = resolve(record.paths.run_root);
  const paths = [record.paths.state, record.paths.cookies, record.paths.evidence, record.paths.private, record.paths.result];
  if (!paths.every((path) => isAbsolute(path) && (resolve(path) === runRoot || inside(runRoot, resolve(path))))) throw new Error("Competition runtime path escapes run root");
  if (record.source_root && (!isAbsolute(record.source_root) || !existsSync(record.source_root) || !lstatSync(record.source_root).isDirectory())) throw new Error("Competition source directory is invalid");
  return { ...record, target, runRoot, flagPattern: compileFlagRegex(record.flag_regex) };
}
function loadCookies(record) {
  if (!existsSync(record.paths.cookies)) return new Map();
  if (lstatSync(record.paths.cookies).isSymbolicLink()) throw new Error("Competition cookie jar is unsafe");
  const jar = JSON.parse(readFileSync(record.paths.cookies, "utf8"));
  if (jar.schema_version !== 1 || jar.run_id !== record.run_id || jar.target_origin !== record.target_origin || !Array.isArray(jar.cookies)) throw new Error("Competition cookie jar does not match run");
  return new Map(jar.cookies.map((cookie) => [cookie.name, cookie]));
}
function loadEvidence(record, state) {
  if (!existsSync(record.paths.evidence) || lstatSync(record.paths.evidence).isSymbolicLink()) throw new Error("Competition evidence directory is unsafe");
  const map = new Map(); let prior = null;
  for (const entry of readdirSync(record.paths.evidence).sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
    if (!/^\d+-e-\d+\.json$/.test(entry)) throw new Error("Competition evidence index is corrupted");
    const match = entry.match(/^(\d+)-(e-\d+)\.json$/); const sequence = Number(match[1]); const evidenceId = match[2];
    const publicPath = join(record.paths.evidence, entry); const privatePath = join(record.paths.private, `${sequence}-${evidenceId}.body`);
    rejectSymlinks(record.runRoot, publicPath); rejectSymlinks(record.runRoot, privatePath);
    if (!existsSync(privatePath)) throw new Error("Competition evidence artifact is missing or unsafe");
    const evidence = JSON.parse(readFileSync(publicPath, "utf8")); const body = readFileSync(privatePath);
    const { evidence_hash: evidenceHash, ...base } = evidence;
    if (evidence.run_id !== record.run_id || evidence.target_origin !== record.target_origin || evidence.evidence_id !== evidenceId || evidence.sequence !== sequence || evidence.prior_evidence_hash !== prior || evidence.private_artifact_sha256 !== hash(body) || evidenceHash !== hash(JSON.stringify(base))) throw new Error("Competition evidence chain is invalid");
    map.set(evidenceId, { record: evidence, privatePath }); prior = evidenceHash;
  }
  if (state && map.size !== state.evidence_sequence) throw new Error("Competition evidence count does not match state");
  return { map, prior };
}
function loadState(record) {
  if (!existsSync(record.paths.state)) return { action_count: 0, evidence_sequence: 0, last_evidence_hash: null, status: "active", started_at: null, deadline_at: null };
  if (lstatSync(record.paths.state).isSymbolicLink()) throw new Error("Competition state is unsafe");
  let state; try { state = JSON.parse(readFileSync(record.paths.state, "utf8")); } catch { throw new Error("Competition state is corrupted"); }
  if (state.run_id !== record.run_id || state.target_origin !== record.target_origin) throw new Error("Competition state does not match run");
  if ((state.started_at !== undefined && (!Number.isSafeInteger(state.started_at) || state.started_at <= 0)) || (state.deadline_at !== undefined && (!Number.isSafeInteger(state.deadline_at) || state.deadline_at <= 0 || state.deadline_at < state.started_at))) throw new Error("Competition state timing is invalid");
  const evidence = loadEvidence(record, state); const last = evidence.map.get(`e-${String(state.evidence_sequence).padStart(3, "0")}`);
  if (state.evidence_sequence !== evidence.map.size || (state.evidence_sequence && state.last_evidence_hash !== last?.record.evidence_hash)) throw new Error("Competition state evidence index does not match run");
  return { ...state, evidenceRecords: evidence.map, lastEvidenceHash: evidence.prior };
}
export function initializeCompetitionRun() {
  const record = loadRecord();
  retireExpiredRun();
  if (activeRun?.status === "active" && activeRun.run_id !== record.run_id) throw new Error("A different competition run is already active");
  const state = loadState(record); const isNewRun = state.started_at == null; const startedAt = state.started_at ?? Date.now(); const deadlineAt = state.deadline_at ?? startedAt + record.time_budget * 60000;
  if (browserContext && activeRun?.run_id !== record.run_id) void closeBrowser();
  const explorationBudget = Number.isSafeInteger(state.exploration_budget) && state.exploration_budget > 0 ? state.exploration_budget : DEFAULT_EXPLORATION_BUDGET;
  const explorationUsed = Number.isSafeInteger(state.exploration_budget_used) && state.exploration_budget_used >= 0 ? state.exploration_budget_used : 0;
  activeRun = { ...record, insecure_tls: record.insecure_tls === true, status: state.status ?? "active", startedAt, deadlineAt, actionCount: state.action_count ?? 0, toolCallCount: state.tool_call_count ?? 0, analysisActionCount: state.analysis_action_count ?? 0, analysisActionFingerprints: new Set(state.analysis_action_fingerprints ?? []), hypothesisRoutePaths: new Set(state.hypothesis_route_paths ?? []), unavailableCapabilities: new Set(state.unavailable_capabilities ?? []), explorationBudget, explorationBudgetUsed: explorationUsed, explorationBudgetRemaining: Math.max(0, explorationBudget - explorationUsed), exploredRouteFamilies: new Set(state.explored_route_families ?? []), explorationLog: Array.isArray(state.exploration_log) ? state.exploration_log : [], hypothesisBoard: Array.isArray(state.hypothesis_board) ? state.hypothesis_board : [], retiredHypotheses: Array.isArray(state.retired_hypotheses) ? state.retired_hypotheses : [], familyBranchFailures: state.family_branch_failures ?? {}, interactive: process.env.CTFC_COMPETITION_INTERACTIVE === "1", evidenceSequence: state.evidence_sequence ?? 0, lastEvidenceHash: state.lastEvidenceHash ?? state.last_evidence_hash ?? null, report: state.report ?? { last_progress: "Run started.", resume_from: "" }, reasoning: state.reasoning ?? { current_hypothesis: "", confidence: 0, supporting_evidence: [], untested_experiments: [], tested_experiments: [] }, evidenceRecords: state.evidenceRecords ?? new Map(), cookies: loadCookies(record), requiredEvidenceInspection: state.required_evidence_inspection ?? null, sessionMutationEvidenceId: state.session_mutation_evidence_id ?? null, verified: null };
  retireExpiredRun();
  if (isNewRun) writeLiveLine(startedAt, "Run started");
  scheduleWatchdog();
  persistState(); return activeRun;
}
function clearWatchdog() {
  if (watchdogTimer) clearTimeout(watchdogTimer);
  watchdogTimer = null;
}
function terminalResult(status, reasonCode) {
  void closeBrowser();
  activeRun.status = status;
  activeRun.report.last_progress = `Terminal failure: ${status}`;
  writeLiveLine(activeRun.startedAt, `Important milestone: terminal failure (${status})`);
  const result = { status, run_id: activeRun.run_id, action_count: activeRun.actionCount, evidence_sequence: activeRun.evidenceSequence, last_evidence_hash: activeRun.lastEvidenceHash, exploration_budget_used: activeRun.explorationBudgetUsed, exploration_budget_remaining: activeRun.explorationBudgetRemaining, hypothesis_board: hypothesisBoardSummary(), retired_hypotheses: (activeRun.retiredHypotheses ?? []).map((h) => ({ id: h.id, family: h.family, branch: h.branch, confidence: Math.round(h.confidence * 100) / 100, summary: h.summary, retired_reason: h.retired_reason })), reason_code: reasonCode, finalized_at: new Date().toISOString() };
  atomicWrite(activeRun.paths.result, `${JSON.stringify(result, null, 2)}\n`);
  persistState();
  clearWatchdog();
  return result;
}
function scheduleWatchdog() {
  clearWatchdog();
  if (!activeRun || activeRun.status !== "active") return;
  const remaining = Math.max(0, activeRun.deadlineAt - Date.now());
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    if (!activeRun || activeRun.status !== "active") return;
    terminalResult("timeout", "hard_deadline_exceeded");
  }, remaining);
  watchdogTimer.unref?.();
}
function persistState() {
  activeRun.report.exploration_budget_used = activeRun.explorationBudgetUsed;
  activeRun.report.exploration_budget_remaining = activeRun.explorationBudgetRemaining;
  atomicWrite(activeRun.paths.state, `${JSON.stringify({ run_id: activeRun.run_id, target_origin: activeRun.target_origin, status: activeRun.status, started_at: activeRun.startedAt, deadline_at: activeRun.deadlineAt, action_count: activeRun.actionCount, tool_call_count: activeRun.toolCallCount, analysis_action_count: activeRun.analysisActionCount, analysis_action_fingerprints: [...activeRun.analysisActionFingerprints], hypothesis_route_paths: [...activeRun.hypothesisRoutePaths], unavailable_capabilities: [...activeRun.unavailableCapabilities], exploration_budget: activeRun.explorationBudget, exploration_budget_used: activeRun.explorationBudgetUsed, exploration_budget_remaining: activeRun.explorationBudgetRemaining, explored_route_families: [...activeRun.exploredRouteFamilies], exploration_log: activeRun.explorationLog.slice(-64), hypothesis_board: activeRun.hypothesisBoard, retired_hypotheses: activeRun.retiredHypotheses.slice(-64), family_branch_failures: activeRun.familyBranchFailures, evidence_sequence: activeRun.evidenceSequence, last_evidence_hash: activeRun.lastEvidenceHash, report: activeRun.report, reasoning: activeRun.reasoning, required_evidence_inspection: activeRun.requiredEvidenceInspection, session_mutation_evidence_id: activeRun.sessionMutationEvidenceId }, null, 2)}\n`);
}
function retireExpiredRun() {
  if (!activeRun || activeRun.status !== "active" || Date.now() < activeRun.deadlineAt) return false;
  terminalResult("timeout", "deadline_reached");
  return true;
}
function ensureActive() {
  if (!activeRun) throw new Error("No active competition run");
  if (activeRun.status !== "active") throw new Error("Competition run is finalized");
  if (Date.now() >= activeRun.deadlineAt) throw new Error("Competition deadline exceeded");
}
function ensureHttpRequestAllowed() {
  if (activeRun.requiredEvidenceInspection) throw new Error(`Inspect required evidence ${activeRun.requiredEvidenceInspection.evidence_id} before another HTTP request`);
}
function hasHttpEvidence() {
  return [...activeRun.evidenceRecords.values()].some((item) => item.record.tool === "http_request");
}
function ensureFirstInteractiveHttp(params) {
  if ((activeRun.interactive || process.env.CTFC_COMPETITION_INTERACTIVE === "1") && !hasHttpEvidence() && (params.method !== "GET" || params.path !== "/" || params.action_kind !== "recon" || Number(params.timeout_ms) !== 5000)) throw new Error("First HTTP action must be GET / with action_kind recon and timeout_ms 5000");
}
function analysisFingerprint(tool, value) {
  return hash(JSON.stringify({ tool, value }));
}
function reserveAnalysisAction(fingerprint) {
  if ((activeRun.interactive || process.env.CTFC_COMPETITION_INTERACTIVE === "1") && !hasHttpEvidence()) throw new Error("Request GET / with action_kind recon and timeout_ms 5000 before source analysis");
  if (activeRun.analysisActionFingerprints.has(fingerprint)) throw new Error("Duplicate source analysis operation");
  if (activeRun.analysisActionCount >= MAX_ANALYSIS_ACTIONS) throw new Error("Source analysis budget exhausted");
  activeRun.analysisActionCount += 1;
  activeRun.analysisActionFingerprints.add(fingerprint);
  persistState();
}
function computeDigest(params) {
  ensureActive();
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("Malformed digest input");
  const allowed = new Set(["algorithm", "text", "purpose"]);
  if (Object.keys(params).some((key) => !allowed.has(key))) throw new Error("Malformed digest input");
  if (!DIGEST_ALGORITHMS.has(params.algorithm)) throw new Error("Unsupported digest algorithm");
  if (typeof params.text !== "string" || !params.text.trim() || params.text.includes("\u0000") || Buffer.byteLength(params.text, "utf8") > MAX_DIGEST_TEXT_BYTES) throw new Error("Invalid digest text");
  if (typeof params.purpose !== "string" || !params.purpose.trim() || params.purpose.includes("\u0000") || params.purpose.length > MAX_DIGEST_PURPOSE) throw new Error("Invalid digest purpose");
  reserveAnalysisAction(analysisFingerprint("compute_digest", { algorithm: params.algorithm, text: params.text }));
   const inputBytes = Buffer.from(params.text, "utf8");
   if (params.algorithm === "base64_encode" || params.algorithm === "base64_decode") {
     let transformed;
     if (params.algorithm === "base64_encode") transformed = inputBytes.toString("base64");
     else {
       if (inputBytes.length > 4 * Math.ceil(MAX_DIGEST_TEXT_BYTES / 3) + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(params.text)) throw new Error("Invalid base64 digest input");
       transformed = Buffer.from(params.text, "base64").toString("utf8");
     }
     const outputBytes = Buffer.byteLength(transformed, "utf8");
     const metadata = { algorithm: params.algorithm, input_bytes: inputBytes.length, input_sha256: hash(inputBytes), output_bytes: outputBytes, output_sha256: hash(transformed), purpose_sha256: hash(params.purpose) };
     const evidence = writeEvidence({ tool: "compute_digest", outcome: "completed", ...metadata, preview: JSON.stringify({ algorithm: params.algorithm, input_bytes: inputBytes.length, output_bytes: outputBytes, output_sha256: metadata.output_sha256 }) }, JSON.stringify(metadata));
     return { ...evidence, algorithm: params.algorithm, value: sanitize(transformed, MAX_INSPECT), input_bytes: inputBytes.length, output_bytes: outputBytes, output_sha256: metadata.output_sha256 };
   }
   const digest = createHash(params.algorithm).update(inputBytes).digest("hex");
   const metadata = { algorithm: params.algorithm, digest, input_bytes: inputBytes.length, input_sha256: hash(params.text), purpose_sha256: hash(params.purpose) };
   const evidence = writeEvidence({ tool: "compute_digest", outcome: "completed", algorithm: params.algorithm, digest, input_bytes: metadata.input_bytes, input_sha256: metadata.input_sha256, purpose_sha256: metadata.purpose_sha256, preview: JSON.stringify({ algorithm: params.algorithm, digest, input_bytes: metadata.input_bytes }) }, JSON.stringify(metadata));
   return { ...evidence, algorithm: params.algorithm, digest, input_bytes: metadata.input_bytes };
}
function deriveBinaryEvidence(params) {
  ensureActive();
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("Malformed binary derivation input");
  const allowed = new Set(["source_evidence_id", "operation", "offset", "length", "key_base64"]);
  if (Object.keys(params).some((key) => !allowed.has(key)) || typeof params.source_evidence_id !== "string" || !/^e-\d{3,}$/.test(params.source_evidence_id) || params.operation !== "xor_repeat" || !Number.isInteger(params.offset) || params.offset < 0 || !Number.isInteger(params.length) || params.length < 1 || params.length > MAX_DERIVED_BINARY_BYTES || typeof params.key_base64 !== "string") throw new Error("Invalid binary derivation input");
  if (params.key_base64.length > 4 * Math.ceil(64 / 3) + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(params.key_base64)) throw new Error("Invalid binary derivation key");
  const key = Buffer.from(params.key_base64, "base64");
  if (key.length < 1 || key.length > 64) throw new Error("Invalid binary derivation key");
  const { publicRecord, body } = evidenceFor(params.source_evidence_id);
  if (!["http_request", "derive_binary_evidence"].includes(publicRecord.tool)) throw new Error("Binary source evidence is not eligible");
  if (params.offset > body.length || params.length > body.length - params.offset) throw new Error("Invalid binary derivation range");
  const sourceBytes = body.subarray(params.offset, params.offset + params.length);
  const keySha256 = hash(key);
  reserveAnalysisAction(analysisFingerprint("derive_binary_evidence", { source_evidence_id: params.source_evidence_id, operation: params.operation, offset: params.offset, length: params.length, key_sha256: keySha256 }));
  const derived = Buffer.alloc(sourceBytes.length);
  for (let index = 0; index < sourceBytes.length; index += 1) derived[index] = sourceBytes[index] ^ key[index % key.length];
  const publicMetadata = { source_evidence_id: params.source_evidence_id, operation: params.operation, source_offset: params.offset, source_length: params.length, key_sha256: keySha256, source_artifact_sha256: publicRecord.private_artifact_sha256, derived_artifact_sha256: hash(derived), byte_count: derived.length };
  const evidence = writeEvidence({ tool: "derive_binary_evidence", outcome: "completed", ...publicMetadata, preview: JSON.stringify({ tool: "derive_binary_evidence", operation: params.operation, byte_count: derived.length }) }, derived);
  return { ...evidence, ...publicMetadata };
}
function consumeAction() {
  ensureActive();
  if (activeRun.pendingAnalysisFingerprint) {
    const fingerprint = activeRun.pendingAnalysisFingerprint;
    activeRun.pendingAnalysisFingerprint = null;
    reserveAnalysisAction(fingerprint);
    return;
  }
  if (activeRun.actionCount >= activeRun.action_budget) throw new Error("Action budget exhausted");
  activeRun.actionCount += 1;
  persistState();
}
function writeEvidence(entry, body) {
  const sequence = ++activeRun.evidenceSequence; const evidenceId = `e-${String(sequence).padStart(3, "0")}`; const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ""));
  const privatePath = join(activeRun.paths.private, `${sequence}-${evidenceId}.body`); rejectSymlinks(activeRun.runRoot, privatePath); atomicWrite(privatePath, bytes);
  const base = { evidence_id: evidenceId, run_id: activeRun.run_id, target_origin: activeRun.target_origin, sequence, timestamp: new Date().toISOString(), ...entry, private_artifact_sha256: hash(bytes), prior_evidence_hash: activeRun.lastEvidenceHash };
  const evidence = { ...base, evidence_hash: hash(JSON.stringify(base)) }; const publicPath = join(activeRun.paths.evidence, `${sequence}-${evidenceId}.json`); rejectSymlinks(activeRun.runRoot, publicPath); atomicWrite(publicPath, `${JSON.stringify(evidence, null, 2)}\n`);
  activeRun.lastEvidenceHash = evidence.evidence_hash; activeRun.evidenceRecords.set(evidenceId, { record: evidence, privatePath });
  if (entry.tool === "http_request" && entry.action_kind === "login" && entry.status_code >= 500) activeRun.requiredEvidenceInspection = { kind: "failed_login", evidence_id: evidenceId };
  if (entry.tool === "http_request" && entry.action_kind === "authenticated_request" && entry.status_code >= 200 && entry.status_code < 300 && activeRun.sessionMutationEvidenceId) {
    activeRun.requiredEvidenceInspection = { kind: "post_session_authenticated", evidence_id: evidenceId };
    activeRun.sessionMutationEvidenceId = null;
  }
  if (entry.tool === "http_request" && isWasmArtifact(entry, bytes)) activeRun.requiredEvidenceInspection = { kind: "wasm_artifact", evidence_id: evidenceId };
  if (entry.tool === "http_request" && activeRun.pendingExploration) {
    const exploration = activeRun.pendingExploration;
    const responseText = bytes.toString("utf8");
    const newClue = Boolean(entry.redirect_location_present) || /<(?:a|form|script)\b|(?:\/api\/|application\/json|location\s*[:=])/i.test(responseText);
    const meaningful = newClue || (entry.status_code >= 300 && entry.status_code < 400) || (entry.status_code >= 401 && entry.status_code !== 404);
    if (meaningful && activeRun.explorationBudgetUsed > 0 && activeRun.explorationBudgetRemaining < activeRun.explorationBudget) {
      activeRun.explorationBudgetUsed -= 1;
      activeRun.explorationBudgetRemaining += 1;
    }
    const log = activeRun.explorationLog.at(-1);
    if (log) { log.outcome = meaningful ? "refunded" : "consumed"; log.meaningful_fact = meaningful; log.evidence_id = evidenceId; }
    activeRun.pendingExploration = null;
  }
  if (entry.tool === "http_request" || entry.tool === "websocket_exchange" || entry.tool === "browser_action")
    updateHypothesisBoard(entry.reasoning, evidenceId, entry.status_code, entry.outcome, body);
  persistState();
  return { evidence_id: evidenceId, outcome: entry.outcome, status_code: entry.status_code ?? null, transport_error: entry.transport_error ?? null, response_bytes: bytes.length, preview: entry.preview ?? "", content_type: entry.content_type ?? null, reasoning: entry.reasoning ?? null, hypothesis_board: hypothesisBoardSummary() };
}
function cookieHeader(url) { return [...activeRun.cookies.values()].filter((cookie) => cookie.domain === url.hostname && url.pathname.startsWith(cookie.path) && (!cookie.secure || url.protocol === "https:")).map((cookie) => `${cookie.name}=${cookie.value}`).join("; "); }
function storeCookies(response, url) {
  for (const value of response.headers.getSetCookie?.() ?? []) {
    const [name, ...parts] = value.split(";")[0].split("="); if (name && parts.length) activeRun.cookies.set(name, { name, value: parts.join("="), domain: url.hostname, path: "/", secure: /;\s*secure/i.test(value) });
  }
  persistCookies();
}
function persistCookies() {
  atomicWrite(activeRun.paths.cookies, `${JSON.stringify({ schema_version: 1, run_id: activeRun.run_id, target_origin: activeRun.target_origin, cookies: [...activeRun.cookies.values()] }, null, 2)}\n`);
}
function contentType(headers) {
  const entries = Object.entries(headers ?? {});
  const match = entries.find(([name]) => name.toLowerCase() === "content-type");
  return match ? match[1].trim().toLowerCase() : null;
}
function isXmlContentType(value) {
  const mime = String(value ?? "").split(";", 1)[0].trim().toLowerCase();
  return mime === "application/xml" || mime === "text/xml" || /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+\+xml$/.test(mime);
}
function isWasmArtifact(entry, body) {
  const normalizedContentType = typeof entry.content_type === "string" ? entry.content_type.split(";", 1)[0].trim().toLowerCase() : "";
  return normalizedContentType === "application/wasm" || (Buffer.isBuffer(body) && body.length >= 4 && body.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d])));
}
function attrValue(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? { present: true, value: match[1] ?? match[2] ?? match[3] ?? "" } : { present: false, value: "" };
}
function resolveEvidenceFormFields(params) {
  const mappings = params.evidence_form_fields;
  if (mappings === undefined) return { form: params.form, metadata: null };
  if (params.method !== "POST" || params.json || !params.form || typeof params.form !== "object" || Array.isArray(params.form) || typeof mappings !== "object" || Array.isArray(mappings)) throw new Error("evidence_form_fields requires a POST form submission");
  const entries = Object.entries(mappings);
  if (!entries.length || entries.length > MAX_EVIDENCE_FORM_FIELDS) throw new Error("Invalid evidence_form_fields");
  const form = { ...params.form };
  const metadata = {};
  for (const [fieldName, evidenceId] of entries) {
    if (!FORM_FIELD_NAME.test(fieldName) || typeof evidenceId !== "string" || !/^e-\d{3,}$/.test(evidenceId)) throw new Error("Invalid evidence form field mapping");
    if (Object.hasOwn(form, fieldName)) throw new Error("Evidence form field overrides an ordinary form field");
    const { publicRecord, body } = evidenceFor(evidenceId);
    if (publicRecord.tool !== "http_request") throw new Error("Evidence form source is not an HTTP response");
    const html = body.toString("utf8");
    let formsFound = 0;
    let matches = 0;
    let value = "";
    for (const formMatch of html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form\s*>/gi)) {
      formsFound += 1;
      for (const controlMatch of formMatch[1].matchAll(/<(input|textarea|select|button)\b[^>]*>/gi)) {
        const tag = controlMatch[0];
        if (attr(tag, "name") !== fieldName) continue;
        matches += 1;
        const type = (attr(tag, "type") || controlMatch[1]).toLowerCase();
        if (controlMatch[1].toLowerCase() !== "input" || type !== "hidden") throw new Error("Evidence form field is not hidden");
        const fieldValue = attrValue(tag, "value");
        if (!fieldValue.present || Buffer.byteLength(fieldValue.value) > MAX_EVIDENCE_FORM_VALUE) throw new Error("Evidence form field is missing or oversized");
        value = fieldValue.value;
      }
    }
    if (!formsFound) throw new Error("Evidence form HTML is malformed");
    if (matches === 0) throw new Error("Evidence form field is missing");
    if (matches !== 1) throw new Error("Evidence form field is duplicated");
    form[fieldName] = value;
    metadata[fieldName] = { source_evidence_id: evidenceId, value_sha256: hash(value) };
  }
  return { form, metadata };
}
function resolveMultipart(params) {
  const multipart = params.multipart;
  if (!multipart || typeof multipart !== "object" || Array.isArray(multipart)) throw new Error("Invalid multipart input");
  const allowed = new Set(["source_evidence_id", "file", "fields", "evidence_form_fields"]);
  if (Object.keys(multipart).some((key) => !allowed.has(key))) throw new Error("Invalid multipart input");
  if (typeof multipart.source_evidence_id !== "string" || !/^e-\d{3,}$/.test(multipart.source_evidence_id)) throw new Error("Invalid multipart source evidence");
  const file = multipart.file;
  if (!file || typeof file !== "object" || Array.isArray(file)) throw new Error("Invalid multipart file");
  const fileKeys = new Set(["field_name", "filename", "content_type", "content_base64"]);
  if (Object.keys(file).some((key) => !fileKeys.has(key))) throw new Error("Invalid multipart file");
  if (typeof file.field_name !== "string" || !FORM_FIELD_NAME.test(file.field_name) || file.field_name.length > 128) throw new Error("Invalid multipart file field");
  if (typeof file.filename !== "string" || !file.filename || file.filename.length > MAX_MULTIPART_FILENAME || file.filename.includes("/") || file.filename.includes("\\") || file.filename.includes("..") || file.filename.includes('"') || /[\x00-\x1f\x7f]/.test(file.filename)) throw new Error("Unsafe multipart filename");
  if (typeof file.content_type !== "string" || file.content_type.length > MAX_MULTIPART_CONTENT_TYPE || !/^[A-Za-z0-9][A-Za-z0-9!#$^_.+-]{0,63}\/[A-Za-z0-9][A-Za-z0-9!#$^_.+-]{0,63}$/.test(file.content_type)) throw new Error("Unsafe multipart content type");
  if (typeof file.content_base64 !== "string" || file.content_base64.length > 4 * Math.ceil(MAX_MULTIPART_FILE_BYTES / 3) + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content_base64)) throw new Error("Invalid multipart base64");
  const bytes = Buffer.from(file.content_base64, "base64");
  if (bytes.length > MAX_MULTIPART_FILE_BYTES) throw new Error("Multipart file is too large");
  const fields = multipart.fields ?? {};
  if (!fields || typeof fields !== "object" || Array.isArray(fields) || Object.keys(fields).length > MAX_MULTIPART_FIELDS) throw new Error("Invalid multipart fields");
  for (const [name, value] of Object.entries(fields)) if (!FORM_FIELD_NAME.test(name) || name.length > 128 || typeof value !== "string" || value.length > MAX_EVIDENCE_FORM_VALUE || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Invalid multipart field");
  const hiddenMappings = multipart.evidence_form_fields ?? {};
  if (!hiddenMappings || typeof hiddenMappings !== "object" || Array.isArray(hiddenMappings) || Object.keys(hiddenMappings).length > MAX_MULTIPART_FIELDS) throw new Error("Invalid multipart evidence fields");
  if (Object.keys(fields).some((name) => Object.hasOwn(hiddenMappings, name)) || Object.hasOwn(fields, file.field_name) || Object.hasOwn(hiddenMappings, file.field_name)) throw new Error("Duplicate multipart field");
  const { publicRecord, body } = evidenceFor(multipart.source_evidence_id);
  if (publicRecord.tool !== "http_request") throw new Error("Multipart source evidence is not an HTTP response");
  const sourceUrl = evidenceRequestUrl(publicRecord);
  let selectedForm = null;
  let observedActionPath = null;
  for (const match of body.toString("utf8").matchAll(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi)) {
    const opening = match[0].slice(0, match[0].indexOf(">") + 1);
    const action = attr(opening, "action");
    const formUrl = resolveSameOriginUrl(action || sourceUrl.href, sourceUrl);
    if (!formUrl || (attr(opening, "method") || "GET").toUpperCase() !== "POST" || !/multipart\/form-data/i.test(attr(opening, "enctype"))) continue;
    const controls = [...match[0].matchAll(/<(input|textarea|select|button)\b[^>]*>/gi)].map((control) => ({ name: attr(control[0], "name"), type: (attr(control[0], "type") || control[1]).toLowerCase(), tag: control[0] }));
    if (!controls.some((control) => control.type === "file" && control.name === file.field_name)) continue;
    if (formUrl.pathname !== params.path) {
      observedActionPath = formUrl.pathname;
      continue;
    }
    selectedForm = controls;
    break;
  }
  if (!selectedForm) {
    if (observedActionPath) throw new Error(`Multipart form action path mismatch: submit POST ${observedActionPath} for the observed file field.`);
    throw new Error("Multipart form or file field was not observed");
  }
  const hiddenNames = new Set(selectedForm.filter((control) => control.type === "hidden" && control.name).map((control) => control.name));
  if ([...Object.keys(hiddenMappings)].some((name) => !hiddenNames.has(name))) throw new Error("Multipart hidden field was not observed");
  const hidden = Object.keys(hiddenMappings).length
    ? resolveEvidenceFormFields({ method: "POST", form: {}, evidence_form_fields: hiddenMappings })
    : { form: {}, metadata: {} };
  const metadata = { source_evidence_id: multipart.source_evidence_id, file_field_name: file.field_name, filename_sha256: hash(file.filename), content_type: file.content_type, byte_length: bytes.length, content_sha256: hash(bytes), field_names: Object.keys(fields).sort(), hidden_field_names: Object.keys(hiddenMappings).sort(), hidden_fields: hidden.metadata };
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.append(name, value);
  for (const [name, value] of Object.entries(hidden.form)) formData.append(name, value);
  formData.append(file.field_name, new Blob([bytes], { type: file.content_type }), file.filename);
  const boundary = `----ctfc-${randomUUID()}`;
  const parts = [];
  for (const [name, value] of [...Object.entries(fields), ...Object.entries(hidden.form)]) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field_name}"; filename="${file.filename}"\r\nContent-Type: ${file.content_type}\r\n\r\n`), bytes, Buffer.from("\r\n")]));
  const rawBody = Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]);
  if (rawBody.length > MAX_BODY) throw new Error("Request body limit exceeded");
  return { body: formData, rawBody, contentType: `multipart/form-data; boundary=${boundary}`, metadata };
}
function requestParams(params) {
  if (!METHODS.has(params.method) || !ACTIONS.has(params.action_kind)) throw new Error("HTTP method or action kind is not allowed");
  const reasoning = reasoningParams(params.reasoning);
  const evidenceFields = resolveEvidenceFormFields(params);
  if (typeof params.path !== "string" || !params.path.startsWith("/") || params.path.startsWith("//") || /[?\\#@\x00\r\n]/.test(params.path)) throw new Error("Unsafe request path");
  let path = params.path; try { path = decodeURIComponent(decodeURIComponent(path)); } catch { throw new Error("Invalid encoded request path"); }
  if (path.split("/").includes("..") || path.includes("\\")) throw new Error("Path traversal rejected");
  const timeout = Number(params.timeout_ms); if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT || timeout > MAX_TIMEOUT) throw new Error("Invalid timeout");
  const headerNames = new Set();
  const headerEntries = Object.entries(params.headers ?? {});
  if (headerEntries.length > MAX_HEADERS) throw new Error("Too many request headers");
  let headerBytes = 0;
  for (const [key, value] of headerEntries) {
    const name = key.toLowerCase();
    if (typeof value !== "string") throw new Error("Unsafe request header");
    headerBytes += Buffer.byteLength(key) + Buffer.byteLength(value);
    const allowed = SAFE_HEADERS.has(name) || /^x-[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/i.test(key);
    if (typeof key !== "string" || typeof value !== "string" || key.length > 128 || value.length > 4096 || headerBytes > MAX_HEADER_BYTES || !HEADER_NAME.test(key) || /[\r\n\x00]/.test(value) || headerNames.has(name) || FORBIDDEN_HEADERS.has(name) || !allowed) throw new Error("Unsafe request header");
    headerNames.add(name);
  }
  if (params.method === "GET" && (params.form || params.json || params.raw_xml || params.evidence_form_fields)) throw new Error("GET requests cannot have a body");
  if (params.multipart !== undefined && (params.method !== "POST" || params.action_kind !== "submit")) throw new Error("Multipart requires method POST and action_kind submit.");
  if (params.multipart !== undefined && (params.form !== undefined || params.json !== undefined || params.evidence_form_fields !== undefined)) throw new Error("Multipart is mutually exclusive with form, json, and evidence_form_fields");
  if (params.multipart !== undefined && Object.entries(params.headers ?? {}).some(([key]) => key.toLowerCase() === "content-type")) throw new Error("Multipart Content-Type is managed automatically");
  if (params.form && params.json) throw new Error("Form and JSON bodies are mutually exclusive");
  if (params.raw_xml !== undefined && (params.method !== "POST" || params.form !== undefined || params.json !== undefined || params.multipart !== undefined || params.evidence_form_fields !== undefined)) throw new Error("raw_xml requires a POST request with no other body");
  if (params.raw_xml !== undefined && (typeof params.raw_xml !== "string" || Buffer.byteLength(params.raw_xml, "utf8") > MAX_RAW_XML)) throw new Error("Invalid raw XML body");
  const suppliedContentType = contentType(params.headers);
  if (params.raw_xml !== undefined && suppliedContentType && !isXmlContentType(suppliedContentType)) throw new Error("Raw XML requires an XML Content-Type");
  if (suppliedContentType && !params.raw_xml && !["application/x-www-form-urlencoded", "application/json"].includes(suppliedContentType)) throw new Error("Unsafe Content-Type value");
  if (suppliedContentType && !params.form && !params.json && params.raw_xml === undefined) throw new Error("Content-Type requires a form or JSON body");
  if (params.form && suppliedContentType && suppliedContentType !== "application/x-www-form-urlencoded") throw new Error("Conflicting Content-Type for form body");
  if (params.json && suppliedContentType && suppliedContentType !== "application/json") throw new Error("Conflicting Content-Type for JSON body");
  let body = "";
  try { body = params.form ? new URLSearchParams(params.form).toString() : params.json ? JSON.stringify(params.json) : params.raw_xml ?? ""; } catch { throw new Error("Invalid request body"); }
  if (Buffer.byteLength(body) > MAX_BODY) throw new Error("Request body limit exceeded");
  const url = new URL(`${activeRun.target_origin}${params.path}`);
  for (const [key, value] of Object.entries(params.query ?? {})) { if (!/^[\w.-]{1,128}$/.test(key) || typeof value !== "string" || value.length > 1024) throw new Error("Invalid query parameter"); url.searchParams.set(key, value); }
  if (url.hostname !== activeRun.target.hostname || url.host !== activeRun.target.host) throw new Error("Target host is not allowed");
  const multipart = params.multipart !== undefined ? resolveMultipart({ ...params, path }) : null;
  return { ...params, form: evidenceFields.form, evidenceFormFields: evidenceFields.metadata, multipart, reasoning, timeout, url };
}
async function readBody(response, signal) {
  const reader = response.body?.getReader(); if (!reader) return Buffer.from(await response.arrayBuffer()); const chunks = []; let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > MAX_BODY) throw new Error("Response body limit exceeded"); chunks.push(Buffer.from(value)); if (signal.aborted) throw new Error("Request timed out"); }
  return Buffer.concat(chunks);
}
function performHttpsRequest(request, controller) {
  if (request.url.protocol !== "https:" || request.url.origin !== activeRun.target_origin) throw new Error("HTTPS request is outside the authorized origin");
  return new Promise((resolveResult, rejectResult) => {
    const headers = { ...(request.headers ?? {}) };
    let body = null;
    if (request.multipart) { body = request.multipart.rawBody; headers["content-type"] = request.multipart.contentType; }
    else if (request.form) { body = Buffer.from(new URLSearchParams(request.form).toString()); if (!contentType(headers)) headers["content-type"] = "application/x-www-form-urlencoded"; }
    else if (request.json) { body = Buffer.from(JSON.stringify(request.json)); if (!contentType(headers)) headers["content-type"] = "application/json"; }
    else if (request.raw_xml) { body = Buffer.from(request.raw_xml, "utf8"); if (!contentType(headers)) headers["content-type"] = "application/xml"; }
    if (body && !headers["content-length"] && !headers["Content-Length"]) headers["content-length"] = String(body.length);
    const agent = new HttpsAgent({ rejectUnauthorized: !activeRun.insecure_tls, maxSockets: 1 });
    const client = httpsRequest({ protocol: "https:", hostname: request.url.hostname, port: request.url.port || 443, path: `${request.url.pathname}${request.url.search}`, method: request.method, headers, agent, servername: request.url.hostname }, (response) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) for (const item of Array.isArray(value) ? value : [value]) if (item != null) responseHeaders.append(name, String(item));
      const chunks = [];
      let total = 0;
      response.on("data", (chunk) => { total += chunk.length; if (total > MAX_BODY) { client.destroy(new Error("Response body limit exceeded")); return; } chunks.push(Buffer.from(chunk)); });
      response.on("end", () => resolveResult({ status: response.statusCode ?? null, headers: responseHeaders, body: Buffer.concat(chunks) }));
      response.on("error", rejectResult);
    });
    client.on("error", rejectResult);
    client.setTimeout(request.timeout, () => { controller.abort(); client.destroy(new Error("Request timed out")); });
    controller.signal.addEventListener("abort", () => client.destroy(new Error("Request timed out")), { once: true });
    if (body) client.write(body);
    client.end();
  });
}
async function performHttpRequest(params) {
  ensureActive(); const request = requestParams(params); const fingerprint = reasoningFingerprint(request); if (activeRun.reasoning.tested_experiments.includes(fingerprint)) throw new Error("Equivalent reasoning experiment was already attempted"); const decision = requestDecision(request); if (!decision.allow) throw new Error(decision.reason); consumeAction(); if (decision.hypothesisPath) { activeRun.hypothesisRoutePaths.add(decision.hypothesisPath); persistState(); } const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), request.timeout); let body = Buffer.alloc(0); let response; let outcome = "completed"; let error = ""; const started = Date.now();
  let transportDetail = "";
  try { const headers = { ...(request.headers ?? {}) }; const cookies = cookieHeader(request.url); if (cookies) headers.Cookie = cookies; const init = { method: request.method, headers, redirect: "manual", signal: controller.signal }; if (request.url.protocol === "https:") response = await performHttpsRequest({ ...request, headers }, controller); else { if (request.multipart) init.body = request.multipart.body; else if (request.form) { init.body = new URLSearchParams(request.form).toString(); if (!contentType(headers)) headers["content-type"] = "application/x-www-form-urlencoded"; } if (request.json) { init.body = JSON.stringify(request.json); if (!contentType(headers)) headers["content-type"] = "application/json"; } if (request.raw_xml) { init.body = request.raw_xml; if (!contentType(headers)) headers["content-type"] = "application/xml"; } response = await fetch(request.url, init); body = await readBody(response, controller.signal); } storeCookies(response, request.url); if (request.url.protocol === "https:") body = response.body; if (response.status >= 300 && response.status < 400) outcome = "redirect"; else if (response.status >= 400) outcome = "http_error"; } catch (caught) { outcome = controller.signal.aborted ? "timeout" : "error"; error = caught instanceof Error ? caught.message : "request failed"; transportDetail = caught instanceof Error && caught.cause?.code ? String(caught.cause.cause?.code ?? caught.cause.code) : ""; } finally { clearTimeout(timer); }
  const transportError = transportErrorCode(response?.status ?? null, outcome, `${error} ${transportDetail}`);
  const reasoning = updateReasoning(request, response?.status ?? null, outcome, `${error} ${transportDetail}`);
    return writeEvidence({ tool: "http_request", action_kind: request.action_kind, duration_ms: Date.now() - started, outcome, status_code: response?.status ?? null, transport_error: transportError, bytes: body.length, redirect_location_present: Boolean(response?.headers.has("location")), response_headers: headersForEvidence(response?.headers), content_type: response?.headers.get("content-type") ?? null, preview: transportError ? sanitizedTransportPreview(transportError) : sanitize(body.toString("utf8"), 1024), reasoning, request: { method: request.method, path: request.path, query_hash: hash(JSON.stringify(request.query ?? {})), body_hash: hash(request.multipart ? JSON.stringify(request.multipart.metadata) : Buffer.from(request.form ? new URLSearchParams(request.form).toString() : request.json ? JSON.stringify(request.json) : request.raw_xml ?? "")), ...(request.evidenceFormFields ? { evidence_form_fields: request.evidenceFormFields } : {}), ...(request.multipart ? { multipart: request.multipart.metadata } : {}) } }, body.length ? body : transportError ? sanitizedTransportPreview(transportError) : error);
}
async function httpRequest(params) {
  ensureFirstInteractiveHttp(params);
  ensureHttpRequestAllowed();
  const evidence = await performHttpRequest(params);
  const status = evidence.status_code ?? "ERROR";
  if (!activeRun.report.first_http_action) {
    activeRun.report.first_http_action = `${params.method} ${params.path} -> ${status}`;
    writeLiveLine(activeRun.startedAt, `First HTTP action: ${params.method} ${params.path} → ${status}`);
  }
  const milestone = params.action_kind === "login" && status >= 200 && status < 300
    ? "Login success"
    : params.action_kind === "authenticated_request" && status >= 200 && status < 300
      ? "Authenticated session established"
      : null;
  if (milestone && activeRun.report.last_progress !== milestone) {
    activeRun.report.last_progress = milestone;
    writeLiveLine(activeRun.startedAt, `Important milestone: ${milestone}`);
  }
  if (!milestone && activeRun.report.last_progress === "Run started.") activeRun.report.last_progress = `HTTP ${params.method} ${params.path} returned ${status}.`;
  activeRun.report.resume_from = evidence.evidence_id;
  persistState();
  return evidence;
}

function websocketPathSupported(path) {
  for (const [evidenceId, item] of activeRun.evidenceRecords) {
    if (item.record.tool !== "http_request") continue;
    const record = item.record;
    if (record.request?.path === path && (record.status_code === 426 || /(^|,\s*)websocket/i.test(record.response_headers?.upgrade ?? ""))) return evidenceId;
    const baseUrl = evidenceRequestUrl(record);
    const body = evidenceFor(evidenceId).body.toString("utf8");
    for (const match of body.matchAll(/(?:new\s+)?WebSocket\s*\(\s*["'`]([^"'`]+)["'`]/gi)) {
      let candidate;
      try { candidate = new URL(match[1], baseUrl); } catch { continue; }
      if ((candidate.protocol === "http:" || candidate.protocol === "https:") && candidate.origin === activeRun.target_origin && candidate.pathname === path) return evidenceId;
      if ((candidate.protocol === "ws:" || candidate.protocol === "wss:") && `${candidate.protocol === "ws:" ? "http:" : "https:"}//${candidate.host}` === activeRun.target_origin && candidate.pathname === path) return evidenceId;
    }
  }
  return null;
}

export function websocketUrlForTarget(origin, path) {
  const url = new URL(`${origin}${path}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

function websocketParams(params) {
  ensureActive();
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("Malformed WebSocket input");
  if (typeof params.path !== "string" || !params.path.startsWith("/") || params.path.startsWith("//") || /[?#@\\\x00\r\n]/.test(params.path)) throw new Error("Unsafe WebSocket path");
  let path = params.path;
  try { path = decodeURIComponent(decodeURIComponent(path)); } catch { throw new Error("Invalid encoded WebSocket path"); }
  if (path.split("/").includes("..") || path.includes("\\")) throw new Error("WebSocket path traversal rejected");
  const supportedByEvidence = websocketPathSupported(path);
  if (!supportedByEvidence) throw new Error("WebSocket endpoint is not supported by retained HTTP evidence");
  if (!Array.isArray(params.messages) || params.messages.length > WS_MAX_OUTBOUND_MESSAGES || params.messages.some((message) => typeof message !== "string" || Buffer.byteLength(message, "utf8") > 4096)) throw new Error("Invalid WebSocket messages");
  const subprotocols = params.subprotocols ?? [];
  if (!Array.isArray(subprotocols) || subprotocols.length > 4 || new Set(subprotocols).size !== subprotocols.length || subprotocols.some((protocol) => typeof protocol !== "string" || protocol.length > 128 || !WS_SUBPROTOCOL.test(protocol))) throw new Error("Invalid WebSocket subprotocols");
  const timeout = Number(params.timeout_ms ?? 5000);
  if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT || timeout > WS_MAX_TIMEOUT) throw new Error("Invalid WebSocket timeout");
  const maxMessages = Number(params.max_messages ?? 8);
  if (!Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > WS_MAX_RECEIVED_MESSAGES) throw new Error("Invalid WebSocket message limit");
  if (params.close_after_receive !== undefined && typeof params.close_after_receive !== "boolean") throw new Error("Invalid WebSocket close setting");
  if (typeof WebSocket !== "function") throw new Error("WebSocket transport unavailable");
  const wsUrl = websocketUrlForTarget(activeRun.target_origin, path);
  if (wsUrl.hostname !== activeRun.target.hostname || wsUrl.host !== activeRun.target.host) throw new Error("WebSocket target host is not allowed");
  return { path, supportedByEvidence, messages: params.messages, subprotocols, timeout, maxMessages, closeAfterReceive: params.close_after_receive ?? true, url: wsUrl, reasoning: reasoningParams(params.reasoning) };
}

async function websocketExchange(params) {
  const request = websocketParams(params);
  const fingerprint = reasoningFingerprint({ reasoning: request.reasoning, path: request.path, method: "WEBSOCKET" });
  if (activeRun.reasoning.tested_experiments.includes(fingerprint)) throw new Error("Equivalent reasoning experiment was already attempted");
  consumeAction();
  const started = Date.now();
  let actionResult;
  const received = [];
  let receivedBytes = 0;
  let ws;
  let outcome = "error";
  let error = "";
  let closeCode = null;
  let closeReason = "";
  let opened = false;
  const cookie = cookieHeader(new URL(activeRun.target_origin));
  await new Promise((resolve) => {
    let settled = false;
    const settle = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { outcome = "timeout"; error = "WebSocket timeout"; if (ws && ws.readyState < 2) ws.close(1000, "timeout"); settle(); }, request.timeout);
    try {
      ws = new WebSocket(request.url.href, { protocols: request.subprotocols, headers: { Origin: activeRun.target_origin, ...(cookie ? { Cookie: cookie } : {}) } });
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        opened = true;
        try { for (const message of request.messages) ws.send(message); outcome = "connected"; } catch (caught) { outcome = "error"; error = caught instanceof Error ? caught.message : "WebSocket send failed"; ws.close(1000, "send failure"); }
      };
      ws.onmessage = (event) => {
        if (typeof event.data !== "string") { outcome = "protocol_error"; error = "Binary WebSocket messages are not supported"; ws.close(1000, "text only"); return; }
        const bytes = Buffer.byteLength(event.data, "utf8");
        if (bytes > WS_MAX_MESSAGE_BYTES || receivedBytes + bytes > WS_MAX_TOTAL_BYTES) { outcome = "protocol_error"; error = "WebSocket response limit exceeded"; ws.close(1000, "message limit"); return; }
        received.push(event.data); receivedBytes += bytes; outcome = "completed";
        if (received.length >= request.maxMessages || (request.closeAfterReceive && received.length > 0)) { if (ws && ws.readyState < 2) ws.close(1000, "complete"); settle(); }
      };
      ws.onerror = () => { if (outcome !== "completed" && outcome !== "protocol_error" && outcome !== "timeout") { outcome = opened ? "error" : "handshake_error"; error = "WebSocket connection failed"; } settle(); };
      ws.onclose = (event) => { closeCode = event.code; closeReason = event.reason ?? ""; if (outcome === "connected") outcome = "completed"; settle(); };
    } catch (caught) { outcome = "error"; error = caught instanceof Error ? caught.message : "WebSocket connection failed"; settle(); }
  }).finally(() => {});
  const body = received.length ? received.join("\n") : error;
  const previews = received.map((message) => sanitize(message, 1024));
  const reasoning = updateReasoning({ ...request, reasoning: request.reasoning }, outcome === "completed" ? 101 : null, outcome === "timeout" ? "timeout" : outcome === "completed" ? "completed" : "error", error);
  const entry = {
    tool: "websocket_exchange",
    path: request.path,
    outcome,
    duration_ms: Date.now() - started,
    negotiated_subprotocol: ws?.protocol || null,
    sent_message_count: request.messages.length,
    received_message_count: received.length,
    received_bytes: receivedBytes,
    received_previews: previews,
    close_code: closeCode,
    close_reason: sanitize(closeReason, 256),
    evidence_source_id: request.supportedByEvidence,
    preview: sanitize(JSON.stringify({ outcome, received: previews, error: error || null }), 4096),
    reasoning,
    request: { path: request.path, subprotocols: request.subprotocols, message_count: request.messages.length, message_hashes: request.messages.map((message) => hash(message)) },
  };
  return { ...writeEvidence(entry, body), path: request.path, outcome, negotiated_subprotocol: entry.negotiated_subprotocol, sent_message_count: entry.sent_message_count, received_message_count: entry.received_message_count, received_bytes: entry.received_bytes, received_previews: entry.received_previews, close_code: entry.close_code, close_reason: entry.close_reason, evidence_source_id: entry.evidence_source_id };
}

function evidenceFor(id) {
  const item = activeRun.evidenceRecords.get(id); if (!item) throw new Error("Evidence does not belong to current run"); rejectSymlinks(activeRun.runRoot, item.privatePath); const publicRecord = JSON.parse(readFileSync(join(activeRun.paths.evidence, `${item.record.sequence}-${id}.json`), "utf8")); const body = readFileSync(item.privatePath); const { evidence_hash: evidenceHash, ...base } = publicRecord; if (hash(body) !== publicRecord.private_artifact_sha256 || hash(JSON.stringify(base)) !== evidenceHash) throw new Error("Evidence integrity check failed"); return { item, publicRecord, body };
}
 function inspectEvidence(params) {
   ensureActive();
   if (!/^e-\d{3,}$/.test(params.evidence_id)) throw new Error("Evidence ID is required");
    const { publicRecord, body } = evidenceFor(params.evidence_id);
    const baseUrl = evidenceRequestUrl(publicRecord);
   const offset = params.offset ?? 0;
   const limit = params.limit ?? MAX_INSPECT;
   const view = params.view ?? "text";
    if (!Number.isInteger(offset) || offset < 0 || offset > MAX_BODY || !Number.isInteger(limit) || limit < 1 || limit > MAX_INSPECT || (view !== "text" && offset > body.length)) throw new Error("Invalid evidence inspection range");
    if (!["text", "hex", "strings", "wasm_summary"].includes(view)) throw new Error("Invalid evidence inspection view");
    const checkpoint = activeRun.requiredEvidenceInspection;
    const binaryMeaningfulView = ["wasm_summary", "strings", "hex"].includes(view);
    const clearsCheckpoint = checkpoint?.evidence_id === params.evidence_id && (checkpoint.kind !== "wasm_artifact" || binaryMeaningfulView);
    const common = { evidence_id: params.evidence_id, run_id: activeRun.run_id, status_code: publicRecord.status_code ?? null, outcome: publicRecord.outcome ?? null, content_type: publicRecord.content_type ?? null, response_headers: publicRecord.response_headers ?? {} };
    const details = view !== "text"
      ? inspectBinaryView(body, offset, Math.min(limit, MAX_BINARY_VIEW_BYTES), view)
      : (() => {
        const text = body.toString("utf8");
        return { body: { offset, limit, total_bytes: body.length, text: sanitize(text.slice(offset, offset + limit), limit), truncated: offset + limit < text.length }, ...inspectHtml(text, baseUrl), json_summary: jsonSummary(text) };
      })();
    if (clearsCheckpoint) {
      activeRun.requiredEvidenceInspection = null;
      persistState();
    }
    const checkpointResult = clearsCheckpoint ? { checkpoint_cleared: checkpoint.kind, next_action_guidance: checkpoint.kind === "wasm_artifact" ? "WASM inspection checkpoint cleared. Use observed exports, sections, strings, or derived evidence for the next evidence-backed decision; do not resume unrelated endpoint guessing." : checkpoint.kind === "post_session_authenticated" ? "Authenticated evidence inspected. Follow an observed authenticated link, form action, redirect, or route clue before another HTTP request." : "Failed login evidence inspected. Derive the next request from observed evidence before another login submission." } : {};
    return { ...common, ...details, ...checkpointResult };
  }
function derivationBytes(params) {
  const derivation = params.derivation;
  if (!derivation || typeof derivation !== "object" || Array.isArray(derivation) || !DERIVATION_OPERATIONS.has(derivation.operation)) throw new Error("Invalid flag derivation");
  const ids = derivation.source_evidence_ids ?? (derivation.source_evidence_id ? [derivation.source_evidence_id] : []);
  if (!Array.isArray(ids) || !ids.length || ids.length > 4 || ids.some((id) => typeof id !== "string" || !/^e-\d{3,}$/.test(id))) throw new Error("Invalid flag derivation evidence");
  const sources = ids.map((id) => evidenceFor(id));
  if (sources.some(({ publicRecord }) => !["http_request", "derive_binary_evidence"].includes(publicRecord.tool))) throw new Error("Flag derivation source is not eligible");
  if (derivation.operation === "concat") {
    const combined = Buffer.concat(sources.map(({ body }) => body));
    if (combined.length > MAX_DERIVATION_BYTES) throw new Error("Flag derivation output is too large");
    return combined;
  }
  if (ids.length !== 1) throw new Error("This flag derivation operation requires one evidence source");
  const source = sources[0].body;
  const offset = derivation.offset ?? 0;
  const length = derivation.length ?? source.length - offset;
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 1 || offset > source.length || length > source.length - offset || length > MAX_DERIVATION_BYTES) throw new Error("Invalid flag derivation range");
  const selected = source.subarray(offset, offset + length);
  if (derivation.operation === "base64_decode") {
    const encoded = selected.toString("utf8");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error("Invalid derived base64");
    return Buffer.from(encoded, "base64");
  }
  if (derivation.operation === "url_decode") {
    try { return Buffer.from(decodeURIComponent(selected.toString("utf8")), "utf8"); } catch { throw new Error("Invalid derived URL encoding"); }
  }
  if (derivation.operation === "hex_decode") {
    const hex = selected.toString("utf8");
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new Error("Invalid derived hex");
    return Buffer.from(hex, "hex");
  }
  if (typeof derivation.key_base64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(derivation.key_base64)) throw new Error("Invalid derived XOR key");
  const key = Buffer.from(derivation.key_base64, "base64");
  if (!key.length || key.length > 64) throw new Error("Invalid derived XOR key");
  const output = Buffer.alloc(selected.length);
  for (let index = 0; index < selected.length; index += 1) output[index] = selected[index] ^ key[index % key.length];
  return output;
}
function verifyFlag(params) {
  ensureActive(); const { body } = evidenceFor(params.evidence_id); // Verify against raw private evidence, never a redacted preview.
  const text = (params.derivation === undefined ? body : derivationBytes(params)).toString("utf8"); const candidateMatches = params.candidate && activeRun.flagPattern.test(params.candidate); const match = candidateMatches && text.includes(params.candidate) ? { value: params.candidate, index: text.indexOf(params.candidate) } : (() => { const found = activeRun.flagPattern.exec(text); return found ? { value: found[0], index: found.index } : null; })(); if (!match) throw new Error("No matching flag in retained evidence or proven derivation"); activeRun.status = "solved"; void closeBrowser(); activeRun.verified = { evidence_id: params.evidence_id, flag_sha256: hash(match.value) }; atomicWrite(join(activeRun.paths.private, "verified-flag.txt"), `${match.value}\n`); activeRun.report.last_progress = "Flag verified"; activeRun.report.resume_from = params.evidence_id; writeLiveLine(activeRun.startedAt, "Flag verified");   const result = { status: "solved", run_id: activeRun.run_id, action_count: activeRun.actionCount, evidence_sequence: activeRun.evidenceSequence, exploration_budget_used: activeRun.explorationBudgetUsed, exploration_budget_remaining: activeRun.explorationBudgetRemaining, hypothesis_board: hypothesisBoardSummary(), retired_hypotheses: (activeRun.retiredHypotheses ?? []).map((h) => ({ id: h.id, family: h.family, branch: h.branch, confidence: Math.round(h.confidence * 100) / 100, summary: h.summary, retired_reason: h.retired_reason })), verified: true, verified_evidence_id: params.evidence_id, flag_sha256: hash(match.value), finalized_at: new Date().toISOString() }; atomicWrite(activeRun.paths.result, `${JSON.stringify(result, null, 2)}\n`); persistState(); clearWatchdog(); return { verified: true, evidence_id: params.evidence_id, flag: match.value, flag_sha256: hash(match.value), match_offset: match.index };
}
function cookieReplacementParams(params) {
  const allowed = new Set(["hypothesis_id", "cookie_name", "cookie_value", "path"]);
  if (Object.keys(params).some((key) => !allowed.has(key))) throw new Error("Cookie host and domain overrides are not allowed");
  if (typeof params.hypothesis_id !== "string" || !HYPOTHESIS_ID.test(params.hypothesis_id)) throw new Error("Invalid hypothesis ID");
  if (typeof params.cookie_name !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(params.cookie_name)) throw new Error("Invalid cookie name");
  if (typeof params.cookie_value !== "string" || !params.cookie_value || Buffer.byteLength(params.cookie_value) > 4096 || /[\x00-\x20\x7f;,]/.test(params.cookie_value)) throw new Error("Invalid cookie value");
  const path = params.path ?? "/";
  if (typeof path !== "string" || path.length > 512 || !path.startsWith("/") || path.startsWith("//") || /[\x00-\x20\x7f;,?#\\\r\n]/.test(path)) throw new Error("Invalid cookie path");
  let decoded;
  try { decoded = decodeURIComponent(decodeURIComponent(path)); } catch { throw new Error("Invalid cookie path"); }
  if (decoded.split("/").includes("..")) throw new Error("Invalid cookie path");
  return { cookieName: params.cookie_name, cookieValue: params.cookie_value, path };
}
function replaceSessionCookie(params) {
  ensureActive(); const cookie = cookieReplacementParams(params); consumeAction();
  activeRun.cookies.set(cookie.cookieName, { name: cookie.cookieName, value: cookie.cookieValue, domain: activeRun.target.hostname, path: cookie.path, secure: activeRun.target.protocol === "https:" });
  persistCookies();
  const valueHash = hash(cookie.cookieValue);
  const publicEvidence = { cookie_name: cookie.cookieName, target_host: activeRun.target.hostname, path: cookie.path, value_hash: valueHash, outcome: "cookie_replaced" };
  const evidence = writeEvidence({ tool: "replace_session_cookie", ...publicEvidence }, JSON.stringify(publicEvidence));
  activeRun.sessionMutationEvidenceId = evidence.evidence_id;
  persistState();
  return { evidence_id: evidence.evidence_id, outcome: "cookie_replaced", cookie_name: cookie.cookieName, path: cookie.path };
}
function adoptSessionCookieParams(params) {
  const allowed = new Set(["evidence_id", "cookie_name", "account_key"]);
  if (Object.keys(params).some((key) => !allowed.has(key))) throw new Error("Unsupported session adoption parameter");
  if (typeof params.evidence_id !== "string" || !/^e-\d{3,}$/.test(params.evidence_id)) throw new Error("Invalid evidence ID");
  if (typeof params.account_key !== "string" || !ACCOUNT_KEY.test(params.account_key)) throw new Error("Invalid account key");
  const { publicRecord, body } = evidenceFor(params.evidence_id);
  if (publicRecord.tool !== "http_request" || publicRecord.request?.method !== "GET" || publicRecord.request?.path !== "/sessions") throw new Error("Evidence is not a /sessions response");
  const escapedKey = params.account_key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.toString("utf8").match(new RegExp(`session:([^,\\s<]{1,4096}),\\s*\\{[^{}]{0,512}['"]key['"]\\s*:\\s*['"]${escapedKey}['"]`));
  if (!match) throw new Error("Named session was not found in retained evidence");
  return { cookie: cookieReplacementParams({ hypothesis_id: "EvidenceAdoption", cookie_name: params.cookie_name, cookie_value: match[1] }), accountKey: params.account_key };
}
function adoptSessionCookie(params) {
  ensureActive(); const { cookie, accountKey } = adoptSessionCookieParams(params); consumeAction();
  activeRun.cookies.set(cookie.cookieName, { name: cookie.cookieName, value: cookie.cookieValue, domain: activeRun.target.hostname, path: "/", secure: activeRun.target.protocol === "https:" });
  persistCookies();
  const publicEvidence = { source_evidence_id: params.evidence_id, cookie_name: cookie.cookieName, target_host: activeRun.target.hostname, account_key: accountKey, path: "/", value_hash: hash(cookie.cookieValue), outcome: "cookie_adopted" };
  const evidence = writeEvidence({ tool: "adopt_session_cookie", ...publicEvidence }, JSON.stringify(publicEvidence));
  activeRun.sessionMutationEvidenceId = evidence.evidence_id;
  persistState();
  activeRun.report.last_progress = "Privileged session adopted";
  activeRun.report.resume_from = evidence.evidence_id;
  writeLiveLine(activeRun.startedAt, "Important milestone: privileged session adopted");
  return { evidence_id: evidence.evidence_id, outcome: "cookie_adopted", source_evidence_id: params.evidence_id, cookie_name: cookie.cookieName, account_key: accountKey, path: "/" };
}
function finalizeResult(params) {
  if (!activeRun) throw new Error("No active competition run");
  retireExpiredRun();
  if (activeRun.status === "solved") return { status: "solved", already_finalized: true };
  if (activeRun.status !== "active") return { status: activeRun.status, already_finalized: true };
  if (!TERMINAL_STATUSES.has(params.status)) throw new Error("Invalid terminal result status");
  const actionableUntested = (activeRun.reasoning.untested_experiments ?? []).filter((experiment) => !String(experiment).startsWith(UNAVAILABLE_CAPABILITY_MARKER));
  const boardRank1 = (activeRun.hypothesisBoard ?? []).find((h) => !h.retired && h.rank === 1);
  if (activeRun.status !== "timeout" && activeRun.actionCount < activeRun.action_budget && ((activeRun.reasoning.current_hypothesis && activeRun.reasoning.supporting_evidence.length && actionableUntested.length) || (boardRank1 && boardRank1.next_experiment && boardRank1.confidence >= HYPOTHESIS_MIN_CONFIDENCE))) throw new Error("Cannot finalize while an evidence-backed untested experiment remains");
  const reasonCodes = new Set(["no_progress", "deadline_reached", "action_budget_reached", "runner_failure"]);
  if (params.reason_code !== undefined && !reasonCodes.has(params.reason_code)) throw new Error("Invalid terminal reason code");
  const result = terminalResult(params.status, params.reason_code ?? "runner_failure");
  return { status: params.status, action_count: activeRun.actionCount, evidence_sequence: activeRun.evidenceSequence, last_evidence_hash: activeRun.lastEvidenceHash };
}

function sourceRoot() {
  if (!activeRun.source_root) throw new Error("Source access requires an optional source directory");
  if (lstatSync(activeRun.source_root).isSymbolicLink()) throw new Error("Source root symlink rejected");
  return realpathSync(activeRun.source_root);
}
function sourcePath(raw, { directory = false } = {}) {
  const root = sourceRoot();
  const path = raw ?? ".";
  if (typeof path !== "string" || !path || path.length > MAX_SOURCE_PATH || isAbsolute(path) || path.includes("\\") || path.split("/").includes("..")) throw new Error("Unsafe source path");
  const target = resolve(root, path);
  if (target !== root && !inside(root, target)) throw new Error("Source path escapes supplied directory");
  rejectSymlinks(root, target, true);
  if (!existsSync(target) || lstatSync(target).isSymbolicLink()) throw new Error("Source path is missing or unsafe");
  const stat = lstatSync(target);
  if (directory && !stat.isDirectory()) throw new Error("Source path must be a directory");
  if (!directory && !stat.isFile()) throw new Error("Source path must be a regular file");
  return { root, path: target === root ? "." : relative(root, target), target, stat };
}
function listSource(params) {
  ensureActive(); const limit = params.limit ?? MAX_SOURCE_ENTRIES;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SOURCE_ENTRIES) throw new Error("Invalid source list limit");
  const source = sourcePath(params.path, { directory: true });
  reserveAnalysisAction(analysisFingerprint("list_source", { path: source.path, limit }));
  const names = readdirSync(source.target).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const entries = names.slice(0, limit).map((name) => {
    const target = join(source.target, name);
    if (lstatSync(target).isSymbolicLink()) throw new Error("Source symlink rejected");
    const stat = lstatSync(target);
    return { path: source.path === "." ? name : `${source.path}/${name}`, kind: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other", size: stat.isFile() ? stat.size : null };
  });
  const body = JSON.stringify({ path: source.path, entries, truncated: names.length > entries.length });
  return { ...writeEvidence({ tool: "list_source", outcome: "completed", preview: sanitize(body, 1024) }, body), path: source.path, entries, truncated: names.length > entries.length };
}
function readSource(params) {
  ensureActive(); const source = sourcePath(params.path); const offset = params.offset ?? 0; const limit = params.limit ?? MAX_SOURCE_READ;
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_SOURCE_OFFSET || !Number.isInteger(limit) || limit < 1 || limit > MAX_SOURCE_READ || offset > source.stat.size) throw new Error("Invalid source read range");
  reserveAnalysisAction(analysisFingerprint("read_source", { path: source.path, offset, limit }));
  const bytesToRead = Math.min(limit, source.stat.size - offset); const buffer = Buffer.alloc(bytesToRead); const descriptor = openSync(source.target, "r");
  try { readSync(descriptor, buffer, 0, bytesToRead, offset); } finally { closeSync(descriptor); }
  const text = buffer.toString("utf8"); const evidence = writeEvidence({ tool: "read_source", outcome: "completed", preview: sanitize(text, 1024), source_path: source.path, offset, total_bytes: source.stat.size }, buffer);
  return { ...evidence, path: source.path, offset, limit, total_bytes: source.stat.size, text: sanitize(text, limit), truncated: offset + bytesToRead < source.stat.size };
}
function searchSource(params) {
  ensureActive();
  const query = params.query;
  const limit = params.limit ?? MAX_SEARCH_RESULTS;
  if (typeof query !== "string" || !query || query.length > MAX_SEARCH_QUERY || /[\u0000-\u001f\u007f]/.test(query)) throw new Error("Invalid literal source search query");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_RESULTS) throw new Error("Invalid source search limit");
  const source = sourcePath(params.path, { directory: true });
  reserveAnalysisAction(analysisFingerprint("search_source", { path: source.path, query, limit }));
  const files = [];
  const visit = (directory, relativeDirectory) => {
    if (files.length >= MAX_SEARCH_FILES) return;
    const names = readdirSync(directory).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    for (const name of names) {
      if (files.length >= MAX_SEARCH_FILES) break;
      const target = join(directory, name);
      if (lstatSync(target).isSymbolicLink()) throw new Error("Source symlink rejected");
      const stat = lstatSync(target);
      const relativePath = relativeDirectory === "." ? name : `${relativeDirectory}/${name}`;
      if (stat.isDirectory()) visit(target, relativePath);
      else if (stat.isFile()) files.push({ target, path: relativePath, size: stat.size });
    }
  };
  visit(source.target, source.path);
  const matches = [];
  let scannedBytes = 0;
  let scannedFiles = 0;
  for (const file of files) {
    if (scannedBytes + file.size > MAX_SEARCH_TOTAL_BYTES) break;
    scannedBytes += file.size;
    scannedFiles += 1;
    const text = readFileSync(file.target, "utf8");
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
      if (lines[index].includes(query)) matches.push({ path: file.path, line: index + 1, text: sanitize(lines[index], 512) });
    }
    if (matches.length >= limit) break;
  }
  const result = { path: source.path, query: sanitize(query, MAX_SEARCH_QUERY), matches, truncated: matches.length >= limit || scannedFiles < files.length, scanned_files: scannedFiles };
  const body = JSON.stringify(result);
  return { ...writeEvidence({ tool: "search_source", outcome: "completed", preview: sanitize(body, 1024), source_path: source.path }, body), ...result };
}

const executables = { file: ["/usr/bin/file", "/bin/file"], strings: ["/usr/bin/strings", "/bin/strings"], readelf: ["/usr/bin/readelf", "/opt/homebrew/bin/readelf"], objdump: ["/usr/bin/objdump", "/opt/homebrew/bin/objdump"], nm: ["/usr/bin/nm", "/usr/bin/nm-classic", "/opt/homebrew/bin/nm"], sha256: ["/usr/bin/shasum", "/bin/shasum"] };
async function closeBrowser() {
  const context = browserContext;
  const browser = browserInstance;
  browserContext = null;
  browserPage = null;
  browserOrigin = null;
  browserInstance = null;
  try { await context?.close(); } catch {}
  try { await browser?.close(); } catch {}
}
function browserSelector(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\u0000\r\n]/.test(value)) throw new Error("Invalid browser CSS selector");
  return value;
}
function browserValue(value, label, limit = 16 * 1024) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (typeof text !== "string" || text.length > limit || /\u0000/.test(text)) throw new Error(`Invalid browser ${label}`);
  return text;
}
function browserEvalAllowed(source) {
  if (typeof source !== "string" || source.length < 1 || source.length > 4096) throw new Error("Invalid browser eval source");
  if (/(?:fetch|XMLHttpRequest|WebSocket|window\.open|document\.cookie|location\s*=|importScripts|navigator\.sendBeacon)\s*[(=]/i.test(source)) throw new Error("Browser eval uses a blocked capability");
  for (const item of activeRun.evidenceRecords.values()) {
    if (readFileSync(item.privatePath, "utf8").includes(source)) return source;
  }
  throw new Error("Browser eval must exactly match script retained in current-run evidence");
}
async function launchBrowser() {
  if (browserPage) return browserPage;
  try {
    const { chromium } = await import("playwright");
    browserInstance = await chromium.launch({ headless: true });
    browserContext = await browserInstance.newContext({ acceptDownloads: false });
    browserOrigin = activeRun.target_origin;
    await browserContext.route("**/*", async (route) => {
      try { if (new URL(route.request().url()).origin !== browserOrigin) return route.abort(); } catch { return route.abort(); }
      return route.continue();
    });
    browserContext.on("download", (download) => { void download.cancel().catch(() => {}); });
    browserPage = await browserContext.newPage();
    browserContext.on("page", (page) => { if (page !== browserPage) void page.close().catch(() => {}); });
    browserPage.on("popup", (page) => { void page.close().catch(() => {}); });
    return browserPage;
  } catch (error) {
    await closeBrowser();
    throw new Error(`Browser capability unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function browserCookies(cookies) {
  return cookies.map((cookie) => ({ name: cookie.name, domain: cookie.domain, path: cookie.path, secure: cookie.secure, http_only: cookie.httpOnly, same_site: cookie.sameSite ?? null }));
}
async function browserSnapshot(page, timeout) {
  const currentUrl = page.url();
  const resolved = resolveSameOriginUrl(currentUrl, activeRun.target_origin);
  if (!resolved) throw new Error("Browser page escaped the bound origin");
  const content = (await page.content()).slice(0, MAX_BODY);
  const dom = await page.evaluate(() => {
    const controls = (form) => [...form.querySelectorAll("input,textarea,select,button")].slice(0, 32).map((element) => ({ tag: element.tagName.toLowerCase(), name: element.getAttribute("name") ?? "", type: element.getAttribute("type") ?? element.tagName.toLowerCase(), value: /pass|secret|token|csrf|session|cookie|auth/i.test(`${element.getAttribute("name") ?? ""} ${element.getAttribute("type") ?? ""}`) ? "[REDACTED_SECRET]" : String(element.value ?? "").slice(0, 256) }));
    return {
      forms: [...document.forms].slice(0, 32).map((form) => ({ action: form.action, method: (form.method || "get").toUpperCase(), controls: controls(form) })),
      links: [...document.links].slice(0, 32).map((link) => link.href),
    };
  });
  const parsed = inspectHtml(content, currentUrl);
  const cookies = browserContext ? browserCookies(await browserContext.cookies(activeRun.target_origin)) : [];
  return { success: true, current_url: currentUrl, page_title: sanitize(await page.title(), 256), visible_text: sanitize(await page.locator("body").innerText({ timeout }), MAX_INSPECT), forms: dom.forms.map((form) => ({ ...form, action: displayResolvedUrl(form.action, currentUrl) })), links: dom.links.map((link) => displayResolvedUrl(link, currentUrl)), scripts: parsed.scripts, cookies };
}
async function browserAction(params) {
  ensureActive();
  const action = params.action;
  const allowed = new Set(["goto", "click", "type", "submit", "screenshot", "eval", "get_storage", "set_storage", "wait", "close"]);
  if (!allowed.has(action)) throw new Error("Invalid browser action");
  const timeout = params.timeout_ms ?? 5000;
  if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT || timeout > MAX_TIMEOUT) throw new Error("Invalid browser timeout");
  if (["get_storage", "set_storage"].includes(action) && !["localStorage", "sessionStorage"].includes(params.storage_type)) throw new Error("Invalid browser storage type");
  consumeAction();
  const started = Date.now();
  try {
    if (action === "close") {
      await closeBrowser();
      const result = { success: true, current_url: null, page_title: "", visible_text: "", forms: [], links: [], scripts: [], cookies: [] };
      return { ...writeEvidence({ tool: "browser_action", action, outcome: "completed", duration_ms: Date.now() - started, preview: JSON.stringify(result) }, JSON.stringify(result)), ...result };
    }
    const page = await launchBrowser();
    if (action === "goto") {
      const url = resolveSameOriginUrl(browserValue(params.value ?? "/", "navigation"), activeRun.target_origin);
      if (!url) throw new Error("Browser navigation must remain on the bound origin");
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout });
    } else if (action === "click") await page.locator(browserSelector(params.selector)).click({ timeout });
    else if (action === "type") await page.locator(browserSelector(params.selector)).fill(browserValue(params.value, "input"), { timeout });
    else if (action === "submit") { await page.locator(browserSelector(params.selector)).evaluate((element) => element instanceof HTMLFormElement ? element.requestSubmit() : element.click()); await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => {}); }
    else if (action === "screenshot") {}
    else if (action === "wait") {
      if (params.wait_for === "networkidle") await page.waitForLoadState("networkidle", { timeout });
      else if (params.wait_for) await page.locator(browserSelector(params.wait_for)).waitFor({ state: "visible", timeout });
      else await page.waitForTimeout(Math.min(timeout, 10000));
    } else if (action === "get_storage") {
      const storage = params.storage_type;
      const key = params.storage_key;
      if (typeof key !== "string" || !key || key.length > 256) throw new Error("Invalid browser storage key");
      actionResult = await page.evaluate(({ storage, key }) => window[storage][key], { storage, key });
    } else if (action === "set_storage") {
      if (typeof params.storage_key !== "string" || !params.storage_key || params.storage_key.length > 256) throw new Error("Invalid browser storage key");
      const value = browserValue(params.storage_value ?? params.value, "storage value");
      await page.evaluate(({ storage, key, value }) => window[storage].setItem(key, value), { storage: params.storage_type, key: params.storage_key, value });
    } else if (action === "eval") {
      const source = browserEvalAllowed(browserValue(params.value, "eval source", 4096));
      actionResult = await page.evaluate((script) => (0, eval)(script), source);
    }
    if (params.wait_for && action !== "wait") {
      if (params.wait_for === "networkidle") await page.waitForLoadState("networkidle", { timeout });
      else await page.locator(browserSelector(params.wait_for)).waitFor({ state: "visible", timeout });
    }
    const result = await browserSnapshot(page, timeout);
    if (action === "screenshot") result.screenshot_base64 = (await page.screenshot({ type: "png" })).toString("base64");
    if (action === "get_storage") result.eval_result = sanitize(JSON.stringify(actionResult ?? null), MAX_INSPECT);
    if (action === "eval") result.eval_result = sanitize(JSON.stringify(actionResult ?? null), MAX_INSPECT);
    const privateResult = { ...result, eval_result: action === "eval" || action === "get_storage" ? actionResult : result.eval_result };
    return { ...writeEvidence({ tool: "browser_action", action, outcome: "completed", duration_ms: Date.now() - started, current_url: result.current_url, preview: sanitize(JSON.stringify(result), 2048) }, JSON.stringify(privateResult)), ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = { success: false, current_url: browserPage?.url() || null, page_title: "", visible_text: "", forms: [], links: [], scripts: [], cookies: [], error: sanitize(message, 512) };
    return { ...writeEvidence({ tool: "browser_action", action, outcome: "error", duration_ms: Date.now() - started, preview: JSON.stringify(result) }, message), ...result };
  }
}
function localCommand(params) {
  ensureActive(); if (!activeRun.source_root) throw new Error("Source analysis requires an optional source directory"); if (!Object.hasOwn(executables, params.profile)) throw new Error("Invalid source analysis profile"); const timeout = Number(params.timeout_ms); if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT || timeout > MAX_TIMEOUT) throw new Error("Invalid timeout"); if (!Array.isArray(params.paths) || params.paths.length < 1 || params.paths.length > 8) throw new Error("Invalid source analysis paths"); const sourceRoot = realpathSync(activeRun.source_root); const paths = params.paths.map((path) => { if (typeof path !== "string" || !path || isAbsolute(path) || path.includes("\\") || path.split("/").includes("..")) throw new Error("Unsafe source path"); const target = resolve(sourceRoot, path); const resolved = existsSync(target) ? realpathSync(target) : target; if (!(resolved === sourceRoot || inside(sourceRoot, resolved))) throw new Error("Source path escapes supplied directory"); rejectSymlinks(sourceRoot, target); return target; }); const executable = executables[params.profile].find((path) => existsSync(path)); if (!executable) throw new Error("Source analysis executable unavailable"); const args = Array.isArray(params.args) ? params.args : []; if (args.length > 16 || args.some((arg) => typeof arg !== "string" || arg.length > 256)) throw new Error("Invalid source analysis arguments"); const commandArgs = params.profile === "sha256" ? ["-a", "256", ...paths] : [...args, ...paths]; consumeAction(); return new Promise((resolveResult) => { const child = spawn(executable, commandArgs, { cwd: sourceRoot, shell: false, env: { PATH: "/usr/bin:/bin:/opt/homebrew/bin", LANG: "C" } }); const out = []; let size = 0; const collect = (chunk) => { size += chunk.length; if (size <= MAX_BODY) out.push(chunk); else child.kill("SIGTERM"); }; child.stdout.on("data", collect); child.stderr.on("data", collect); const timer = setTimeout(() => child.kill("SIGTERM"), timeout); child.on("close", (code, signal) => { clearTimeout(timer); const body = Buffer.concat(out); resolveResult(writeEvidence({ tool: "run_local_command", profile: params.profile, outcome: size > MAX_BODY ? "output_limit" : signal ? "timeout" : code === 0 ? "completed" : "error", exit_code: code, preview: sanitize(body.toString("utf8")) }, body)); }); child.on("error", (error) => { clearTimeout(timer); resolveResult(writeEvidence({ tool: "run_local_command", profile: params.profile, outcome: "error", preview: sanitize(error.message) }, error.message)); }); }); }

function unavailableCapabilityKind(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/optional source directory|Source analysis executable unavailable|feature not configured|unavailable inspection mode|unsupported tool/i.test(message)) return message;
  return null;
}
function capabilityAwareExecute(toolName, execute) {
  return async (id, params) => {
    try { return await execute(id, params); } catch (error) {
      const kind = unavailableCapabilityKind(error);
      if (!kind || !activeRun) throw error;
      const key = hash(JSON.stringify({ tool: toolName, capability: kind, evidence_sequence: activeRun.evidenceSequence }));
      if (activeRun.unavailableCapabilities.has(key)) throw new Error(`${UNAVAILABLE_CAPABILITY_MARKER} already recorded; provide new evidence before retrying this capability.`);
      activeRun.unavailableCapabilities.add(key);
      persistState();
      throw new Error(`${UNAVAILABLE_CAPABILITY_MARKER} ${kind}`);
    }
  };
}
function textResult(value) { if (activeRun) { activeRun.toolCallCount += 1; persistState(); } return { content: [{ type: "text", text: JSON.stringify(value) }], details: value }; }
  const browserActionTool = defineTool({ name: "browser_action", label: "Browser Action", description: "Use one persistent, exact-origin browser context for bounded DOM interaction, storage, screenshots, and evidence-bound script evaluation. Popups and downloads are blocked.", parameters: Type.Object({ action: Type.Union([Type.Literal("goto"), Type.Literal("click"), Type.Literal("type"), Type.Literal("submit"), Type.Literal("screenshot"), Type.Literal("eval"), Type.Literal("get_storage"), Type.Literal("set_storage"), Type.Literal("wait"), Type.Literal("close")]), selector: Type.Optional(Type.String()), value: Type.Optional(Type.Unknown()), storage_type: Type.Optional(Type.Union([Type.Literal("localStorage"), Type.Literal("sessionStorage")])), storage_key: Type.Optional(Type.String()), storage_value: Type.Optional(Type.Unknown()), timeout_ms: Type.Optional(Type.Number()), wait_for: Type.Optional(Type.String()) }), async execute(_id, params) { return textResult(await browserAction(params)); } });
  const httpRequestTool = defineTool({ name: "http_request", label: "HTTP Request", description: "Perform one bounded same-origin Web request and retain its evidence with required reasoning. Supports bounded raw_xml POST bodies with an XML Content-Type. For an observed multipart form with no hidden inputs, omit multipart.evidence_form_fields; source evidence plus the observed file field is sufficient. source_evidence_id is the page containing the observed form; submit multipart POST to that form's observed action path, not necessarily the page path.", parameters: Type.Object({ method: Type.Union([Type.Literal("GET"), Type.Literal("POST")]), path: Type.String(), query: Type.Optional(Type.Record(Type.String(), Type.String())), form: Type.Optional(Type.Record(Type.String(), Type.String())), raw_xml: Type.Optional(Type.String()), evidence_form_fields: Type.Optional(Type.Record(Type.String(), Type.String())), json: Type.Optional(Type.Record(Type.String(), Type.Unknown())), multipart: Type.Optional(Type.Object({ source_evidence_id: Type.String(), file: Type.Object({ field_name: Type.String(), filename: Type.String(), content_type: Type.String(), content_base64: Type.String() }), fields: Type.Optional(Type.Record(Type.String(), Type.String())), evidence_form_fields: Type.Optional(Type.Record(Type.String(), Type.String())) })), headers: Type.Optional(Type.Record(Type.String(), Type.String())), reasoning: Type.Object({ evidence_summary: Type.Array(Type.String()), leading_hypothesis: Type.String(), supporting_evidence: Type.Array(Type.String()), experiment: Type.String(), expected_observation: Type.String(), confidence: Type.Number(), untested_experiments: Type.Optional(Type.Array(Type.String())), exploration_score: Type.Optional(Type.Number()), exploration_justification: Type.Optional(Type.String()), route_family: Type.Optional(Type.String()), next_experiment: Type.Optional(Type.String()) }), action_kind: Type.Union([Type.Literal("recon"), Type.Literal("login"), Type.Literal("authenticated_request"), Type.Literal("submit"), Type.Literal("trigger")]), timeout_ms: Type.Number() }), async execute(_id, params) { return textResult(await httpRequest(params)); } });
   const websocketExchangeTool = defineTool({ name: "websocket_exchange", label: "WebSocket Exchange", description: "Open one bounded same-origin WebSocket supported by retained HTTP evidence, send ordered text messages, retain sanitized exchange evidence, and close.", parameters: Type.Object({ path: Type.String(), messages: Type.Array(Type.String()), subprotocols: Type.Optional(Type.Array(Type.String())), timeout_ms: Type.Optional(Type.Number()), max_messages: Type.Optional(Type.Number()), close_after_receive: Type.Optional(Type.Boolean()), reasoning: Type.Object({ evidence_summary: Type.Array(Type.String()), leading_hypothesis: Type.String(), supporting_evidence: Type.Array(Type.String()), experiment: Type.String(), expected_observation: Type.String(), confidence: Type.Number(), untested_experiments: Type.Optional(Type.Array(Type.String())), exploration_score: Type.Optional(Type.Number()), exploration_justification: Type.Optional(Type.String()), route_family: Type.Optional(Type.String()), next_experiment: Type.Optional(Type.String()) }) }), async execute(_id, params) { return textResult(await websocketExchange(params)); } });
  const startCompetitionRunTool = defineTool({ name: "start_competition_run", label: "Start Competition Run", description: "Initialize or inspect the private exact-origin competition run from the exact pasted challenge message. A different target origin starts a new isolated run.", parameters: Type.Object({ challenge_text: Type.String(), target_url: Type.Optional(Type.String()), time_budget_minutes: Type.Optional(Type.Number()), action_budget: Type.Optional(Type.Number()), flag_regex: Type.Optional(Type.String()) }), async execute(_id, params) { return textResult(await startCompetitionRun(params)); } });
  const inspectEvidenceTool = defineTool({ name: "inspect_evidence", label: "Inspect Evidence", description: "Inspect bounded structured details from retained evidence in this run.", parameters: Type.Object({ evidence_id: Type.String(), offset: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()), view: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("hex"), Type.Literal("strings"), Type.Literal("wasm_summary")])) }), async execute(_id, params) { return textResult(inspectEvidence(params)); } });
const listSourceTool = defineTool({ name: "list_source", label: "List Source", description: "List one bounded supplied-source directory.", parameters: Type.Object({ path: Type.Optional(Type.String()), limit: Type.Optional(Type.Number()) }), async execute(_id, params) { return textResult(listSource(params)); } });
 const readSourceTool = defineTool({ name: "read_source", label: "Read Source", description: "Read one bounded range from a supplied source file.", parameters: Type.Object({ path: Type.String(), offset: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()) }), async execute(_id, params) { return textResult(readSource(params)); } });
 const searchSourceTool = defineTool({ name: "search_source", label: "Search Source", description: "Search supplied source recursively for one bounded literal string.", parameters: Type.Object({ query: Type.String(), path: Type.Optional(Type.String()), limit: Type.Optional(Type.Number()) }), async execute(_id, params) { return textResult(searchSource(params)); } });
  const computeDigestTool = defineTool({ name: "compute_digest", label: "Compute Digest", description: "Compute one bounded deterministic digest without source access or HTTP.", parameters: Type.Object({ algorithm: Type.Union([Type.Literal("md5"), Type.Literal("sha1"), Type.Literal("sha256")]), text: Type.String(), purpose: Type.String() }), async execute(_id, params) { return textResult(computeDigest(params)); } });
  const deriveBinaryEvidenceTool = defineTool({ name: "derive_binary_evidence", label: "Derive Binary Evidence", description: "Derive bounded private evidence from retained bytes using one fixed XOR transform.", parameters: Type.Object({ source_evidence_id: Type.String(), operation: Type.Literal("xor_repeat"), offset: Type.Number(), length: Type.Number(), key_base64: Type.String() }), async execute(_id, params) { return textResult(deriveBinaryEvidence(params)); } });
const replaceSessionCookieTool = defineTool({ name: "replace_session_cookie", label: "Replace Session Cookie", description: "Replace one named cookie for the exact active target origin and retain redacted evidence.", parameters: Type.Object({ hypothesis_id: Type.String(), cookie_name: Type.String(), cookie_value: Type.String(), path: Type.Optional(Type.String()) }), async execute(_id, params) { return textResult(replaceSessionCookie(params)); } });
const adoptSessionCookieTool = defineTool({ name: "adopt_session_cookie", label: "Adopt Session Cookie", description: "Adopt a named account session from current-run GET /sessions evidence without returning its value.", parameters: Type.Object({ evidence_id: Type.String(), cookie_name: Type.String(), account_key: Type.String() }), async execute(_id, params) { return textResult(adoptSessionCookie(params)); } });
 const verifyFlagTool = defineTool({ name: "verify_flag", label: "Verify Flag", description: "Verify a literal or bounded, provenance-backed derived flag against retained evidence and persist the solved result.", parameters: Type.Object({ evidence_id: Type.String(), candidate: Type.Optional(Type.String()), derivation: Type.Optional(Type.Object({ source_evidence_id: Type.Optional(Type.String()), source_evidence_ids: Type.Optional(Type.Array(Type.String())), operation: Type.Union([Type.Literal("base64_decode"), Type.Literal("url_decode"), Type.Literal("hex_decode"), Type.Literal("xor_repeat"), Type.Literal("concat")]), offset: Type.Optional(Type.Number()), length: Type.Optional(Type.Number()), key_base64: Type.Optional(Type.String()) })) }), async execute(_id, params) { return textResult(verifyFlag(params)); } });
const finalizeResultTool = defineTool({ name: "finalize_result", label: "Finalize Result", description: "Persist a safe terminal non-solved result when the direct Web solve cannot continue.", parameters: Type.Object({ status: Type.Union([Type.Literal("not_solved"), Type.Literal("timeout"), Type.Literal("action_budget_exhausted"), Type.Literal("infrastructure_failure")]), reason_code: Type.Optional(Type.Union([Type.Literal("no_progress"), Type.Literal("deadline_reached"), Type.Literal("action_budget_reached"), Type.Literal("runner_failure")])) }), async execute(_id, params) { return textResult(finalizeResult(params)); } });
const localCommandTool = defineTool({ name: "run_local_command", label: "Analyze Source", description: "Run one bounded read-only analysis profile against supplied source.", parameters: Type.Object({ profile: Type.String(), paths: Type.Array(Type.String()), args: Type.Optional(Type.Array(Type.String())), timeout_ms: Type.Number() }), async execute(_id, params) { return textResult(await localCommand(params)); } });
 const originalLocalCommandExecute = localCommandTool.execute;
 localCommandTool.execute = async (id, params) => {
   activeRun.pendingAnalysisFingerprint = analysisFingerprint("run_local_command", { profile: params.profile, paths: params.paths, args: params.args ?? [] });
   try { return await originalLocalCommandExecute(id, params); } finally { if (activeRun) activeRun.pendingAnalysisFingerprint = null; }
 };
      const competitionTools = [httpRequestTool, websocketExchangeTool, browserActionTool, startCompetitionRunTool, inspectEvidenceTool, listSourceTool, readSourceTool, searchSourceTool, computeDigestTool, deriveBinaryEvidenceTool, localCommandTool, replaceSessionCookieTool, adoptSessionCookieTool, verifyFlagTool, finalizeResultTool];
for (const tool of competitionTools) {
  let execute = tool.execute;
  if (["list_source", "read_source", "search_source", "run_local_command"].includes(tool.name)) execute = capabilityAwareExecute(tool.name, execute);
  tool.execute = async (id, params) => {
    ensureRuntimeCurrent();
    return execute(id, params);
  };
}
export { competitionTools };
export default function (pi) {
  extensionApi = pi;
  if (process.env.CTFC_COMPETITION_RUN_RECORD) initializeCompetitionRun();
  pi.on("message_start", async (event) => {
    const text = challengeText(event.message);
    if (!text || !/\b(?:ctf|picoctf|challenge|flag|capture[\s-]*the[\s-]*flag)\b/i.test(text)) return;
    let target;
    lastUserChallenge = text;
    try { target = extractCompetitionTarget(text); } catch { return; }
    if (!target) return;
    try { ensureRuntimeCurrent(); } catch (error) { extensionApi?.setActiveTools([]); process.stderr.write(`${error.message}\n`); return; }
    retireExpiredRun();
    if (activeRun?.status === "active" && activeRun.target_origin === target.origin) return;
    extensionApi?.setActiveTools([]);
    try { await startCompetitionRun({ challenge_text: text }, text); } catch (error) { process.stderr.write(`CTF-C interactive initialization failed: ${error.message}\n`); }
  });
  for (const tool of competitionTools) pi.registerTool(tool);
}
