import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";

const METHODS = new Set(["GET", "POST"]);
const ACTIONS = new Set(["recon", "login", "authenticated_request", "submit", "trigger"]);
const SAFE_HEADERS = new Set(["accept", "content-type", "origin", "referer", "x-requested-with"]);
const FORBIDDEN_HEADERS = new Set(["host", "cookie", "set-cookie", "authorization", "proxy-authorization", "connection", "transfer-encoding", "content-length"]);
const MAX_BODY = 1024 * 1024;
const MAX_INSPECT = 4096;
const MAX_TIMEOUT = 10000;
const MIN_TIMEOUT = 250;
const MAX_SOURCE_ENTRIES = 128;
const MAX_SOURCE_PATH = 512;
const MAX_SOURCE_OFFSET = 8 * 1024 * 1024;
const MAX_SOURCE_READ = 16 * 1024;
let activeRun;

const hash = (value) => createHash("sha256").update(value).digest("hex");
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
function sanitize(value, limit = MAX_INSPECT) {
  const flagPattern = activeRun?.flagPattern;
  const redacted = flagPattern ? String(value).replace(new RegExp(flagPattern.source, "g"), "[REDACTED_FLAG]") : String(value);
  return redacted
    .replace(/((?:["']?\b(?:cookie|set-cookie|authorization|password|passwd|secret|session(?:[_-]?id)?|csrf(?:[_-]?token)?|xsrf(?:[_-]?token)?|token)\b["']?)\s*[:=]\s*["']?)(?:bearer\s+)?[^"'\s,;&}]+/gi, "$1[REDACTED_SECRET]")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").slice(0, limit);
}
function headersForEvidence(headers) {
  const result = {};
  for (const [name, value] of headers ?? []) result[name.toLowerCase()] = /^(authorization|cookie|set-cookie|proxy-authenticate|proxy-authorization|x-api-key)$/i.test(name) ? "[REDACTED_SECRET]" : sanitize(value, 512);
  return result;
}
function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? match[1] ?? match[2] ?? match[3] ?? "" : "";
}
function inspectHtml(body) {
  const forms = [];
  for (const match of body.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form\s*>/gi)) {
    if (forms.length === 32) break;
    const opening = match[0].slice(0, match[0].indexOf(">") + 1);
    const controls = [...match[1].matchAll(/<(input|textarea|select|button)\b[^>]*>/gi)].slice(0, 32).map((control) => {
      const name = attr(control[0], "name");
      const type = attr(control[0], "type") || control[1].toLowerCase();
      return { tag: control[1].toLowerCase(), name: sanitize(name, 128), type: sanitize(type, 64), value: /(?:pass|secret|token|csrf|session|cookie|auth)/i.test(`${name} ${type}`) ? "[REDACTED_SECRET]" : sanitize(attr(control[0], "value"), 256) };
    });
    forms.push({ action: sanitize(attr(opening, "action") || "/", 256), method: (attr(opening, "method") || "GET").toUpperCase(), controls });
  }
  const links = [...body.matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].slice(0, 32).map((match) => sanitize(match[1] ?? match[2] ?? match[3], 512));
  const scripts = [...body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].slice(0, 32).map((match) => {
    const source = attr(match[0].slice(0, match[0].indexOf(">") + 1), "src");
    return source ? { src: sanitize(source, 512) } : { inline_excerpt: sanitize(match[2], 512) };
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
  if (activeRun?.status === "active" && activeRun.run_id !== record.run_id) throw new Error("A different competition run is already active");
  const state = loadState(record); const startedAt = state.started_at ?? Date.now(); const deadlineAt = state.deadline_at ?? startedAt + record.time_budget * 60000;
  activeRun = { ...record, status: state.status ?? "active", startedAt, deadlineAt, actionCount: state.action_count ?? 0, evidenceSequence: state.evidence_sequence ?? 0, lastEvidenceHash: state.lastEvidenceHash ?? state.last_evidence_hash ?? null, evidenceRecords: state.evidenceRecords ?? new Map(), cookies: loadCookies(record), verified: null };
  persistState(); return activeRun;
}
function persistState() {
  atomicWrite(activeRun.paths.state, `${JSON.stringify({ run_id: activeRun.run_id, target_origin: activeRun.target_origin, status: activeRun.status, started_at: activeRun.startedAt, deadline_at: activeRun.deadlineAt, action_count: activeRun.actionCount, evidence_sequence: activeRun.evidenceSequence, last_evidence_hash: activeRun.lastEvidenceHash }, null, 2)}\n`);
}
function ensureActive(count = true) {
  if (!activeRun) throw new Error("No active competition run");
  if (activeRun.status !== "active") throw new Error("Competition run is finalized");
  if (Date.now() >= activeRun.deadlineAt) throw new Error("Competition deadline exceeded");
  if (activeRun.actionCount >= activeRun.action_budget) throw new Error("Action budget exhausted");
  if (count) activeRun.actionCount += 1;
  persistState();
}
function writeEvidence(entry, body) {
  const sequence = ++activeRun.evidenceSequence; const evidenceId = `e-${String(sequence).padStart(3, "0")}`; const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ""));
  const privatePath = join(activeRun.paths.private, `${sequence}-${evidenceId}.body`); rejectSymlinks(activeRun.runRoot, privatePath); atomicWrite(privatePath, bytes);
  const base = { evidence_id: evidenceId, run_id: activeRun.run_id, target_origin: activeRun.target_origin, sequence, timestamp: new Date().toISOString(), ...entry, private_artifact_sha256: hash(bytes), prior_evidence_hash: activeRun.lastEvidenceHash };
  const evidence = { ...base, evidence_hash: hash(JSON.stringify(base)) }; const publicPath = join(activeRun.paths.evidence, `${sequence}-${evidenceId}.json`); rejectSymlinks(activeRun.runRoot, publicPath); atomicWrite(publicPath, `${JSON.stringify(evidence, null, 2)}\n`);
  activeRun.lastEvidenceHash = evidence.evidence_hash; activeRun.evidenceRecords.set(evidenceId, { record: evidence, privatePath }); persistState();
  return { evidence_id: evidenceId, outcome: entry.outcome, status_code: entry.status_code ?? null, response_bytes: bytes.length, preview: entry.preview ?? "", content_type: entry.content_type ?? null };
}
function cookieHeader(url) { return [...activeRun.cookies.values()].filter((cookie) => cookie.domain === url.hostname && url.pathname.startsWith(cookie.path) && (!cookie.secure || url.protocol === "https:")).map((cookie) => `${cookie.name}=${cookie.value}`).join("; "); }
function storeCookies(response, url) {
  for (const value of response.headers.getSetCookie?.() ?? []) {
    const [name, ...parts] = value.split(";")[0].split("="); if (name && parts.length) activeRun.cookies.set(name, { name, value: parts.join("="), domain: url.hostname, path: "/", secure: /;\s*secure/i.test(value) });
  }
  atomicWrite(activeRun.paths.cookies, `${JSON.stringify({ schema_version: 1, run_id: activeRun.run_id, target_origin: activeRun.target_origin, cookies: [...activeRun.cookies.values()] }, null, 2)}\n`);
}
function contentType(headers) {
  const entries = Object.entries(headers ?? {});
  const match = entries.find(([name]) => name.toLowerCase() === "content-type");
  return match ? match[1].trim().toLowerCase() : null;
}
function requestParams(params) {
  if (!METHODS.has(params.method) || !ACTIONS.has(params.action_kind)) throw new Error("HTTP method or action kind is not allowed");
  if (typeof params.path !== "string" || !params.path.startsWith("/") || params.path.startsWith("//") || /[?\\#@\x00\r\n]/.test(params.path)) throw new Error("Unsafe request path");
  let path = params.path; try { path = decodeURIComponent(decodeURIComponent(path)); } catch { throw new Error("Invalid encoded request path"); }
  if (path.split("/").includes("..") || path.includes("\\")) throw new Error("Path traversal rejected");
  const timeout = Number(params.timeout_ms); if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT || timeout > MAX_TIMEOUT) throw new Error("Invalid timeout");
  const headerNames = new Set();
  for (const [key, value] of Object.entries(params.headers ?? {})) {
    const name = key.toLowerCase();
    if (typeof key !== "string" || typeof value !== "string" || key.length > 128 || value.length > 4096 || /[\r\n\x00]/.test(value) || headerNames.has(name) || FORBIDDEN_HEADERS.has(name) || !SAFE_HEADERS.has(name)) throw new Error("Unsafe request header");
    headerNames.add(name);
  }
  if (params.method === "GET" && (params.form || params.json)) throw new Error("GET requests cannot have a body");
  if (params.form && params.json) throw new Error("Form and JSON bodies are mutually exclusive");
  const suppliedContentType = contentType(params.headers);
  if (suppliedContentType && !["application/x-www-form-urlencoded", "application/json"].includes(suppliedContentType)) throw new Error("Unsafe Content-Type value");
  if (suppliedContentType && !params.form && !params.json) throw new Error("Content-Type requires a form or JSON body");
  if (params.form && suppliedContentType && suppliedContentType !== "application/x-www-form-urlencoded") throw new Error("Conflicting Content-Type for form body");
  if (params.json && suppliedContentType && suppliedContentType !== "application/json") throw new Error("Conflicting Content-Type for JSON body");
  const url = new URL(`${activeRun.target_origin}${params.path}`);
  for (const [key, value] of Object.entries(params.query ?? {})) { if (!/^[\w.-]{1,128}$/.test(key) || typeof value !== "string" || value.length > 1024) throw new Error("Invalid query parameter"); url.searchParams.set(key, value); }
  if (url.hostname !== activeRun.target.hostname || url.host !== activeRun.target.host) throw new Error("Target host is not allowed");
  return { ...params, timeout, url };
}
async function readBody(response, signal) {
  const reader = response.body?.getReader(); if (!reader) return Buffer.from(await response.arrayBuffer()); const chunks = []; let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > MAX_BODY) throw new Error("Response body limit exceeded"); chunks.push(Buffer.from(value)); if (signal.aborted) throw new Error("Request timed out"); }
  return Buffer.concat(chunks);
}
async function httpRequest(params) {
  ensureActive(); const request = requestParams(params); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), request.timeout); let body = Buffer.alloc(0); let response; let outcome = "completed"; let error = ""; const started = Date.now();
  try { const headers = { ...(request.headers ?? {}) }; const cookies = cookieHeader(request.url); if (cookies) headers.Cookie = cookies; const init = { method: request.method, headers, redirect: "manual", signal: controller.signal }; if (request.form) { init.body = new URLSearchParams(request.form).toString(); if (!contentType(headers)) headers["content-type"] = "application/x-www-form-urlencoded"; } if (request.json) { init.body = JSON.stringify(request.json); if (!contentType(headers)) headers["content-type"] = "application/json"; } if (Buffer.byteLength(init.body ?? "") > MAX_BODY) throw new Error("Request body limit exceeded"); response = await fetch(request.url, init); storeCookies(response, request.url); body = await readBody(response, controller.signal); if (response.status >= 300 && response.status < 400) outcome = "redirect"; else if (response.status >= 400) outcome = "http_error"; } catch (caught) { outcome = controller.signal.aborted ? "timeout" : "error"; error = caught instanceof Error ? caught.message : "request failed"; } finally { clearTimeout(timer); }
  return writeEvidence({ tool: "http_request", action_kind: request.action_kind, duration_ms: Date.now() - started, outcome, status_code: response?.status ?? null, bytes: body.length, redirect_location_present: Boolean(response?.headers.has("location")), response_headers: headersForEvidence(response?.headers), content_type: response?.headers.get("content-type") ?? null, preview: sanitize(body.toString("utf8") || error, 1024), request: { method: request.method, path: request.path, query_hash: hash(JSON.stringify(request.query ?? {})), body_hash: hash(Buffer.from(request.form ? new URLSearchParams(request.form).toString() : request.json ? JSON.stringify(request.json) : "")) } }, body.length ? body : error);
}
function evidenceFor(id) {
  const item = activeRun.evidenceRecords.get(id); if (!item) throw new Error("Evidence does not belong to current run"); rejectSymlinks(activeRun.runRoot, item.privatePath); const publicRecord = JSON.parse(readFileSync(join(activeRun.paths.evidence, `${item.record.sequence}-${id}.json`), "utf8")); const body = readFileSync(item.privatePath); const { evidence_hash: evidenceHash, ...base } = publicRecord; if (hash(body) !== publicRecord.private_artifact_sha256 || hash(JSON.stringify(base)) !== evidenceHash) throw new Error("Evidence integrity check failed"); return { item, publicRecord, body };
}
function inspectEvidence(params) {
  ensureActive(false); if (!/^e-\d{3,}$/.test(params.evidence_id)) throw new Error("Evidence ID is required"); const { publicRecord, body } = evidenceFor(params.evidence_id); const offset = params.offset ?? 0; const limit = params.limit ?? MAX_INSPECT; if (!Number.isInteger(offset) || offset < 0 || offset > MAX_BODY || !Number.isInteger(limit) || limit < 1 || limit > MAX_INSPECT) throw new Error("Invalid evidence inspection range"); const text = body.toString("utf8"); return { evidence_id: params.evidence_id, run_id: activeRun.run_id, status_code: publicRecord.status_code ?? null, outcome: publicRecord.outcome ?? null, content_type: publicRecord.content_type ?? null, response_headers: publicRecord.response_headers ?? {}, body: { offset, limit, total_bytes: body.length, text: sanitize(text.slice(offset, offset + limit), limit), truncated: offset + limit < text.length }, ...inspectHtml(text), json_summary: jsonSummary(text) };
}
function verifyFlag(params) {
  ensureActive(false); const { body } = evidenceFor(params.evidence_id); const text = body.toString("utf8"); const candidateMatches = params.candidate && activeRun.flagPattern.test(params.candidate); const match = candidateMatches && text.includes(params.candidate) ? { value: params.candidate, index: text.indexOf(params.candidate) } : (() => { const found = activeRun.flagPattern.exec(text); return found ? { value: found[0], index: found.index } : null; })(); if (!match) throw new Error("No matching flag in retained evidence"); activeRun.status = "solved"; activeRun.verified = { evidence_id: params.evidence_id, flag_sha256: hash(match.value) }; const result = { status: "solved", run_id: activeRun.run_id, target_origin: activeRun.target_origin, action_count: activeRun.actionCount, verified: true, verified_evidence_id: params.evidence_id, flag_sha256: hash(match.value), finalized_at: new Date().toISOString() }; atomicWrite(activeRun.paths.result, `${JSON.stringify(result, null, 2)}\n`); persistState(); return { verified: true, evidence_id: params.evidence_id, flag: match.value, flag_sha256: hash(match.value), match_offset: match.index };
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
  const bytesToRead = Math.min(limit, source.stat.size - offset); const buffer = Buffer.alloc(bytesToRead); const descriptor = openSync(source.target, "r");
  try { readSync(descriptor, buffer, 0, bytesToRead, offset); } finally { closeSync(descriptor); }
  const text = buffer.toString("utf8"); const evidence = writeEvidence({ tool: "read_source", outcome: "completed", preview: sanitize(text, 1024), source_path: source.path, offset, total_bytes: source.stat.size }, buffer);
  return { ...evidence, path: source.path, offset, limit, total_bytes: source.stat.size, text: sanitize(text, limit), truncated: offset + bytesToRead < source.stat.size };
}

const executables = { file: ["/usr/bin/file", "/bin/file"], strings: ["/usr/bin/strings", "/bin/strings"], readelf: ["/usr/bin/readelf", "/opt/homebrew/bin/readelf"], objdump: ["/usr/bin/objdump", "/opt/homebrew/bin/objdump"], nm: ["/usr/bin/nm", "/usr/bin/nm-classic", "/opt/homebrew/bin/nm"], sha256: ["/usr/bin/shasum", "/bin/shasum"] };
function localCommand(params) {
  ensureActive(); if (!activeRun.source_root) throw new Error("Source analysis requires an optional source directory"); if (!Object.hasOwn(executables, params.profile)) throw new Error("Invalid source analysis profile"); const timeout = Number(params.timeout_ms); if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT || timeout > MAX_TIMEOUT) throw new Error("Invalid timeout"); if (!Array.isArray(params.paths) || params.paths.length < 1 || params.paths.length > 8) throw new Error("Invalid source analysis paths"); const sourceRoot = realpathSync(activeRun.source_root); const paths = params.paths.map((path) => { if (typeof path !== "string" || !path || isAbsolute(path) || path.includes("\\") || path.split("/").includes("..")) throw new Error("Unsafe source path"); const target = resolve(sourceRoot, path); const resolved = existsSync(target) ? realpathSync(target) : target; if (!(resolved === sourceRoot || inside(sourceRoot, resolved))) throw new Error("Source path escapes supplied directory"); rejectSymlinks(sourceRoot, target); return target; }); const executable = executables[params.profile].find((path) => existsSync(path)); if (!executable) throw new Error("Source analysis executable unavailable"); const args = Array.isArray(params.args) ? params.args : []; if (args.length > 16 || args.some((arg) => typeof arg !== "string" || arg.length > 256)) throw new Error("Invalid source analysis arguments"); const commandArgs = params.profile === "sha256" ? ["-a", "256", ...paths] : [...args, ...paths]; return new Promise((resolveResult) => { const child = spawn(executable, commandArgs, { cwd: sourceRoot, shell: false, env: { PATH: "/usr/bin:/bin:/opt/homebrew/bin", LANG: "C" } }); const out = []; let size = 0; const collect = (chunk) => { size += chunk.length; if (size <= MAX_BODY) out.push(chunk); else child.kill("SIGTERM"); }; child.stdout.on("data", collect); child.stderr.on("data", collect); const timer = setTimeout(() => child.kill("SIGTERM"), timeout); child.on("close", (code, signal) => { clearTimeout(timer); const body = Buffer.concat(out); resolveResult(writeEvidence({ tool: "run_local_command", profile: params.profile, outcome: size > MAX_BODY ? "output_limit" : signal ? "timeout" : code === 0 ? "completed" : "error", exit_code: code, preview: sanitize(body.toString("utf8")) }, body)); }); child.on("error", (error) => { clearTimeout(timer); resolveResult(writeEvidence({ tool: "run_local_command", profile: params.profile, outcome: "error", preview: sanitize(error.message) }, error.message)); }); }); }

function textResult(value) { return { content: [{ type: "text", text: JSON.stringify(value) }], details: value }; }
const httpRequestTool = defineTool({ name: "http_request", label: "HTTP Request", description: "Perform one bounded same-origin Web request and retain its evidence.", parameters: Type.Object({ method: Type.Union([Type.Literal("GET"), Type.Literal("POST")]), path: Type.String(), query: Type.Optional(Type.Record(Type.String(), Type.String())), form: Type.Optional(Type.Record(Type.String(), Type.String())), json: Type.Optional(Type.Record(Type.String(), Type.Unknown())), headers: Type.Optional(Type.Record(Type.String(), Type.String())), action_kind: Type.String(), timeout_ms: Type.Number() }), async execute(_id, params) { return textResult(await httpRequest(params)); } });
const inspectEvidenceTool = defineTool({ name: "inspect_evidence", label: "Inspect Evidence", description: "Inspect bounded structured details from retained evidence in this run.", parameters: Type.Object({ evidence_id: Type.String(), offset: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()) }), async execute(_id, params) { return textResult(inspectEvidence(params)); } });
const listSourceTool = defineTool({ name: "list_source", label: "List Source", description: "List one bounded supplied-source directory.", parameters: Type.Object({ path: Type.Optional(Type.String()), limit: Type.Optional(Type.Number()) }), async execute(_id, params) { return textResult(listSource(params)); } });
const readSourceTool = defineTool({ name: "read_source", label: "Read Source", description: "Read one bounded range from a supplied source file.", parameters: Type.Object({ path: Type.String(), offset: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()) }), async execute(_id, params) { return textResult(readSource(params)); } });
const verifyFlagTool = defineTool({ name: "verify_flag", label: "Verify Flag", description: "Verify a candidate only against retained evidence and persist the solved result.", parameters: Type.Object({ evidence_id: Type.String(), candidate: Type.Optional(Type.String()) }), async execute(_id, params) { return textResult(verifyFlag(params)); } });
const localCommandTool = defineTool({ name: "run_local_command", label: "Analyze Source", description: "Run one bounded read-only analysis profile against supplied source.", parameters: Type.Object({ profile: Type.String(), paths: Type.Array(Type.String()), args: Type.Optional(Type.Array(Type.String())), timeout_ms: Type.Number() }), async execute(_id, params) { return textResult(await localCommand(params)); } });
export const competitionTools = [httpRequestTool, inspectEvidenceTool, listSourceTool, readSourceTool, localCommandTool, verifyFlagTool];
export default function (pi) { if (process.env.CTFC_COMPETITION_RUN_RECORD) initializeCompetitionRun(); for (const tool of competitionTools) pi.registerTool(tool); }
