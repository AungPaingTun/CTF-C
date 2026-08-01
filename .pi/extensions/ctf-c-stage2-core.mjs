import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  closeSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORIES = new Set(["web", "pwn", "reverse", "surprise"]);
const ACTION_KINDS = new Set(["recon", "login", "authenticated_request", "submit", "trigger"]);
const HTTP_METHODS = new Set(["GET", "POST"]);
const SAFE_HEADERS = new Set(["accept", "content-type", "origin", "referer", "x-requested-with"]);
const FORBIDDEN_HEADERS = new Set([
  "host",
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "connection",
  "transfer-encoding",
  "content-length",
]);
const REQUIRED_FIELDS = [
  "Category",
  "Local Docker Compose",
  "Time budget",
  "Flag regex",
  "Default time budget minutes",
  "Maximum time budget minutes",
  "Default action budget",
  "Maximum action budget",
  "Allowed HTTP methods",
  "Allowed action kinds",
  "Allowed host pattern",
  "Per-run approval required",
];
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_PREVIEW_BYTES = 1024;
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 10000;
const TEST_MODE = "local-fixture";

let activeRun = null;

export function isValidChallengeSlug(slug) {
  return SLUG_PATTERN.test(slug);
}

function readField(declaration, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = declaration.match(new RegExp(`^-[ \\t]*\\*\\*${escapedLabel}:\\*\\*[ \\t]*\`([^\`]+)\``, "m"));
  return match?.[1] ?? "";
}

export function parseStage2Declaration(declaration) {
  const fields = Object.fromEntries(REQUIRED_FIELDS.map((label) => [label, readField(declaration, label)]));
  return {
    category: fields.Category,
    local_docker_compose: fields["Local Docker Compose"],
    time_budget: fields["Time budget"],
    flag_regex: fields["Flag regex"],
    default_time_budget_minutes: fields["Default time budget minutes"],
    maximum_time_budget_minutes: fields["Maximum time budget minutes"],
    default_action_budget: fields["Default action budget"],
    maximum_action_budget: fields["Maximum action budget"],
    allowed_http_methods: fields["Allowed HTTP methods"],
    allowed_action_kinds: fields["Allowed action kinds"],
    allowed_host_pattern: fields["Allowed host pattern"],
    per_run_approval_required: fields["Per-run approval required"],
  };
}

export function validateStage2Declaration(metadata, { execution = false } = {}) {
  const errors = [];
  const foundationFields = [
    "category",
    "local_docker_compose",
    "time_budget",
    "flag_regex",
    "default_time_budget_minutes",
    "maximum_time_budget_minutes",
    "default_action_budget",
    "maximum_action_budget",
    "allowed_http_methods",
    "allowed_action_kinds",
    "allowed_host_pattern",
    "per_run_approval_required",
  ];
  for (const key of foundationFields) if (!metadata[key]) errors.push(`missing:${key}`);
  if (metadata.category && !CATEGORIES.has(metadata.category)) errors.push("invalid:category");
  if (metadata.time_budget && !["15 minutes", "30 minutes"].includes(metadata.time_budget)) errors.push("invalid:time_budget");
  if (!/^[1-9][0-9]*$/.test(metadata.default_time_budget_minutes || "")) errors.push("invalid:default_time_budget_minutes");
  if (!/^[1-9][0-9]*$/.test(metadata.maximum_time_budget_minutes || "")) errors.push("invalid:maximum_time_budget_minutes");
  if (!/^[1-9][0-9]*$/.test(metadata.default_action_budget || "")) errors.push("invalid:default_action_budget");
  if (!/^[1-9][0-9]*$/.test(metadata.maximum_action_budget || "")) errors.push("invalid:maximum_action_budget");
  if (Number(metadata.default_time_budget_minutes) > Number(metadata.maximum_time_budget_minutes)) errors.push("invalid:time_budget_policy");
  if (Number(metadata.default_action_budget) > Number(metadata.maximum_action_budget)) errors.push("invalid:action_budget_policy");
  if (metadata.per_run_approval_required !== "true") errors.push("invalid:per_run_approval_required");
  const methods = parseList(metadata.allowed_http_methods);
  const actionKinds = parseList(metadata.allowed_action_kinds);
  if (methods.some((method) => !HTTP_METHODS.has(method))) errors.push("invalid:allowed_http_methods");
  if (actionKinds.some((kind) => !ACTION_KINDS.has(kind))) errors.push("invalid:allowed_action_kinds");
  try {
    validateFlagRegex(metadata.flag_regex);
  } catch {
    errors.push("invalid:flag_regex");
  }
  return errors;
}

function isInside(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent !== "" && !pathFromParent.startsWith("..") && !isAbsolute(pathFromParent);
}

function resolveChallengeDirectory(challengeSlug) {
  const challengesRoot = resolve(process.cwd(), "challenges");
  const challengeDir = resolve(challengesRoot, challengeSlug);
  if (!existsSync(challengeDir) || lstatSync(challengeDir).isSymbolicLink() || !lstatSync(challengeDir).isDirectory()) {
    throw new Error("Challenge directory not found");
  }
  const resolvedRoot = realpathSync(challengesRoot);
  const resolvedChallengeDir = realpathSync(challengeDir);
  if (!isInside(resolvedRoot, resolvedChallengeDir)) throw new Error("Challenge directory not found");
  return resolvedChallengeDir;
}

function challengeDeclarationPath(challengeSlug) {
  const challengeDir = resolveChallengeDirectory(challengeSlug);
  const declarationPath = join(challengeDir, "challenge.md");
  if (!existsSync(declarationPath) || lstatSync(declarationPath).isSymbolicLink()) throw new Error("Challenge declaration not found");
  return { challengeDir, declarationPath };
}

export function readStage2Declaration(challengeSlug, { execution = false } = {}) {
  if (!isValidChallengeSlug(challengeSlug)) throw new Error("Invalid challenge slug");
  const { challengeDir, declarationPath } = challengeDeclarationPath(challengeSlug);
  const metadata = parseStage2Declaration(readFileSync(declarationPath, "utf8"));
  const errors = validateStage2Declaration(metadata, { execution });
  if (errors.length > 0) throw new Error(`Invalid Stage 2 declaration: ${errors.join(", ")}`);
  return { challenge_slug: challengeSlug, challengeDir, ...metadata };
}

function parseList(value) {
  return value === "none" ? [] : value.split(",").map((item) => item.trim()).filter(Boolean);
}

function validateFlagRegex(pattern) {
  if (!pattern || pattern.length > 512 || /\\[1-9]|\\k<|\(\?<=[^)]|\(\?<!/.test(pattern)) throw new Error("Unsafe flag regex");
  const compiled = new RegExp(pattern);
  if (compiled.global || compiled.sticky) throw new Error("Flag regex flags are not allowed");
  return compiled;
}

function loadManifest(challengeSlug) {
  const manifestPath = process.env.CTFC_STAGE2_MANIFEST;
  if (!manifestPath || !isAbsolute(manifestPath) || !existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink()) throw new Error("Stage 3 manifest is missing or unsafe");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schema_version !== 1 || manifest.challenge_slug !== challengeSlug || manifest.paths?.manifest !== manifestPath) throw new Error("Stage 3 manifest identity mismatch");
  if (!manifest.run_id || !manifest.declaration_sha256 || !manifest.target?.origin || !manifest.approval?.approved || !manifest.approval.approved_at) throw new Error("Incomplete Stage 3 manifest");
  const runRoot = manifest.paths.run_root;
  const expectedPaths = {
    manifest: join(runRoot, "run-manifest.json"),
    lock: join(runRoot, "run.lock"),
    state: join(runRoot, "execution-state.json"),
    session: join(runRoot, "session"),
    cookies: join(runRoot, "session", "cookies.json"),
    work: join(runRoot, "work"),
    exploits: join(runRoot, "work", "exploits"),
    evidence: join(runRoot, "evidence"),
    private: join(runRoot, "private"),
    result: join(runRoot, "result.json"),
  };
  if (!isAbsolute(runRoot) || !runRoot.endsWith(`/${manifest.run_id}`) || Object.entries(expectedPaths).some(([key, value]) => manifest.paths[key] !== value)) throw new Error("Invalid Stage 3 runtime paths");
  if (!existsSync(manifest.paths.lock) || lstatSync(manifest.paths.lock).isSymbolicLink()) throw new Error("Run lock is missing or invalid");
  const manifestBytes = readFileSync(manifestPath);
  const lockLines = readFileSync(manifest.paths.lock, "utf8").trim().split("\n");
  if (lockLines.length !== 2 || lockLines[0] !== manifest.run_id || lockLines[1] !== createHash("sha256").update(manifestBytes).digest("hex")) throw new Error("Run lock is missing or invalid");
  const declaration = readStage2Declaration(challengeSlug);
  const declarationBytes = readFileSync(declaration.declaration_path || join(declaration.challengeDir, "challenge.md"));
  if (createHash("sha256").update(declarationBytes).digest("hex") !== manifest.declaration_sha256) throw new Error("Challenge declaration digest mismatch");
  const target = new URL(manifest.target.origin);
  if (`${target.protocol}//${target.host}` !== manifest.target.origin || target.pathname !== "/" || target.search || target.hash || target.username || target.password || target.protocol.slice(0, -1) !== manifest.target.protocol || target.hostname !== manifest.target.hostname || Number(target.port || (target.protocol === "https:" ? 443 : 80)) !== manifest.target.port) throw new Error("Invalid manifest target origin");
  if (declaration.allowed_host_pattern !== "none" && !new RegExp(declaration.allowed_host_pattern).test(target.hostname)) throw new Error("Manifest target host is outside durable policy");
  const methods = manifest.effective?.http_methods;
  const actionKinds = manifest.effective?.action_kinds;
  if (!Array.isArray(methods) || !Array.isArray(actionKinds) || methods.some((method) => !HTTP_METHODS.has(method) || !parseList(declaration.allowed_http_methods).includes(method)) || actionKinds.some((kind) => !ACTION_KINDS.has(kind) || !parseList(declaration.allowed_action_kinds).includes(kind))) throw new Error("Manifest widens durable action policy");
  const flagRegex = validateFlagRegex(manifest.flag_regex);
  const budget = manifest.budgets;
  if (!budget || budget.time_budget_minutes > budget.maximum_time_budget_minutes || budget.action_budget > budget.maximum_action_budget || budget.time_budget_minutes > Number(declaration.maximum_time_budget_minutes) || budget.action_budget > Number(declaration.maximum_action_budget)) throw new Error("Manifest widens durable budget policy");
  return {
    ...declaration,
    ...manifest,
    allowedHosts: [manifest.target.hostname],
    allowedMethods: methods,
    allowedActionKinds: actionKinds,
    timeBudgetMinutes: budget.time_budget_minutes,
    actionBudget: budget.action_budget,
    flagRegex,
    targetOrigin: manifest.target.origin,
    challengeRoot: declaration.challengeDir,
    runtimePaths: manifest.paths,
  };
}

function ensureRun() {
  if (!activeRun) throw new Error("No active investigation");
  if (activeRun.status !== "active") throw new Error("Investigation is finalized");
  if (Date.now() >= activeRun.deadlineAt) {
    activeRun.status = "timeout";
    throw new Error("Investigation deadline exceeded");
  }
  if (activeRun.actionCount >= activeRun.actionBudget) throw new Error("Action budget exhausted");
  activeRun.actionCount += 1;
  atomicWrite(activeRun.runtimePaths.state, `${JSON.stringify({ run_id: activeRun.runId, status: activeRun.status, action_count: activeRun.actionCount }, null, 2)}\n`);
  return activeRun;
}

function hashBuffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

function atomicWrite(path, content, mode = 0o600) {
  const temporary = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporary, content, { mode });
  renameSync(temporary, path);
}

function rejectSymlinkComponents(root, target) {
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === "" || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) throw new Error("Path escapes allowed root");
  let current = root;
  for (const part of pathFromRoot.split("/")) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error("Symlink path component rejected");
    } catch (error) {
      if (error instanceof Error && error.message === "Symlink path component rejected") throw error;
      break;
    }
  }
}

function ensureSafeDirectory(path, root) {
  rejectSymlinkComponents(root, path);
  try {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) throw new Error("Symlink path component rejected");
    if (!info.isDirectory()) throw new Error("Artifact path is not a directory");
  } catch (error) {
    if (error instanceof Error && /^(Symlink path component rejected|Artifact path is not a directory)$/.test(error.message)) throw error;
  }
  mkdirSync(path, { recursive: true });
  rejectSymlinkComponents(root, path);
}

function sanitizePreview(value, flagRegex) {
  let preview = String(value).replace(new RegExp(flagRegex.source, `${flagRegex.flags}g`), "[REDACTED_FLAG]");
  preview = preview.replace(/((?:["']?\b(?:cookie|set-cookie|authorization|password|passwd|secret|session(?:[_-]?id)?|csrf(?:[_-]?token)?|xsrf(?:[_-]?token)?|token)\b["']?)\s*[:=]\s*["']?)(?:bearer\s+)?[^"'\s,;&}]+/gi, "$1[REDACTED_SECRET]");
  preview = preview.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return preview.slice(0, MAX_PREVIEW_BYTES);
}

function writeEvidence(run, entry, privateContent) {
  const sequence = ++run.evidenceSequence;
  const evidenceId = `e-${String(sequence).padStart(3, "0")}`;
  const evidenceDir = run.runtimePaths.evidence;
  const privateDir = run.runtimePaths.private;
  ensureSafeDirectory(evidenceDir, run.runtimePaths.run_root);
  ensureSafeDirectory(privateDir, run.runtimePaths.run_root);
  const privatePath = join(privateDir, `${sequence}-${evidenceId}.body`);
  const privateBuffer = Buffer.isBuffer(privateContent) ? privateContent : Buffer.from(String(privateContent ?? ""));
  atomicWrite(privatePath, privateBuffer);
  const base = {
    evidence_id: evidenceId,
    run_id: run.runId,
    sequence,
    timestamp: new Date().toISOString(),
    ...entry,
    private_artifact_sha256: hashBuffer(privateBuffer),
    prior_evidence_hash: run.lastEvidenceHash,
  };
  const evidenceHash = hashBuffer(JSON.stringify(base));
  const record = { ...base, evidence_hash: evidenceHash };
  atomicWrite(join(evidenceDir, `${sequence}-${evidenceId}.json`), `${JSON.stringify(record, null, 2)}\n`);
  run.lastEvidenceHash = evidenceHash;
  run.evidenceRecords.set(evidenceId, { record, privatePath });
  return { evidence_id: evidenceId, outcome: entry.outcome, status_code: entry.status_code ?? null, duration_ms: entry.duration_ms ?? null, response_bytes: entry.bytes ?? null, redirect_location_present: Boolean(entry.redirect_location_present), preview: entry.preview ?? "" };
}

function ensureHttpRequest(run, params) {
  if (run.declaration.category !== "web") throw new Error("HTTP requests require Web category");
  if (!run.declaration.approval?.approved) throw new Error("HTTP requests are not authorized");
  if (!HTTP_METHODS.has(params.method) || !run.declaration.allowedMethods.includes(params.method)) throw new Error("HTTP method is not allowed");
  if (!ACTION_KINDS.has(params.action_kind) || !run.declaration.allowedActionKinds.includes(params.action_kind)) throw new Error("Action kind is not allowed");
  if (typeof params.path !== "string" || !params.path.startsWith("/") || params.path.startsWith("//") || /[?\\#@\x00\r\n]/.test(params.path)) throw new Error("Unsafe request path");
  let decodedPath = params.path;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { decodedPath = decodeURIComponent(decodedPath); } catch { throw new Error("Invalid encoded request path"); }
  }
  if (decodedPath.split("/").some((part) => part === "..") || decodedPath.includes("\\")) throw new Error("Path traversal rejected");
  const timeout = Number(params.timeout_ms);
  if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT_MS || timeout > MAX_TIMEOUT_MS) throw new Error("Invalid timeout");
  if (Object.keys(params.headers ?? {}).some((key) => FORBIDDEN_HEADERS.has(key.toLowerCase()) || !SAFE_HEADERS.has(key.toLowerCase()))) throw new Error("Unsafe request header");
  if (params.method === "GET" && (params.form || params.json)) throw new Error("GET requests cannot have a body");
  if (params.form && params.json) throw new Error("Form and JSON bodies are mutually exclusive");
  if (process.env.CTFC_STAGE2_TEST_MODE !== TEST_MODE) {
    const hostname = new URL(run.declaration.targetOrigin).hostname;
    if (["127.0.0.1", "localhost", "::1"].includes(hostname)) throw new Error("Loopback targets require test mode");
  }
  const url = new URL(`${run.declaration.targetOrigin}${params.path}`);
  for (const [key, value] of Object.entries(params.query ?? {})) {
    if (typeof value !== "string" || key.length > 128 || value.length > 1024) throw new Error("Invalid query parameter");
    url.searchParams.set(key, value);
  }
  if (!run.declaration.allowedHosts.includes(url.hostname) || url.host !== new URL(run.declaration.targetOrigin).host) throw new Error("Target host is not allowed");
  return { ...params, timeout, url };
}

function cookiePathMatches(cookiePath, requestPath) {
  return requestPath === cookiePath || requestPath.startsWith(`${cookiePath.replace(/\/$/, "")}/`);
}

function parseSetCookie(value, hostname) {
  const parts = value.split(";").map((part) => part.trim());
  const [name, ...valueParts] = parts.shift().split("=");
  if (!name || valueParts.length === 0) return null;
  const cookie = { name, value: valueParts.join("="), domain: hostname, path: "/", secure: false, expiresAt: null };
  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    if (key.toLowerCase() === "path" && rest[0]) cookie.path = rest.join("=");
    if (key.toLowerCase() === "domain" && rest[0]) cookie.domain = rest[0].replace(/^\./, "");
    if (key.toLowerCase() === "secure") cookie.secure = true;
    if (key.toLowerCase() === "max-age" && Number.isFinite(Number(rest[0]))) cookie.expiresAt = Date.now() + Number(rest[0]) * 1000;
    if (key.toLowerCase() === "expires") cookie.expiresAt = Date.parse(rest.join("="));
  }
  return cookie;
}

function storeCookies(run, response, url) {
  const values = response.headers.getSetCookie?.() ?? [];
  for (const value of values) {
    const cookie = parseSetCookie(value, url.hostname);
    if (cookie) run.cookies.set(cookie.name, cookie);
  }
  writeFileSync(run.runtimePaths.cookies, `${JSON.stringify([...run.cookies.values()], null, 2)}\n`, { mode: 0o600 });
}

function cookieHeader(run, url) {
  const values = [];
  for (const cookie of run.cookies.values()) {
    if (cookie.domain !== url.hostname || !cookiePathMatches(cookie.path, url.pathname)) continue;
    if (cookie.secure && url.protocol !== "https:") continue;
    if (cookie.expiresAt && cookie.expiresAt <= Date.now()) continue;
    values.push(`${cookie.name}=${cookie.value}`);
  }
  return values.join("; ");
}

async function readResponseBody(response, limit, signal) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.from(await response.arrayBuffer());
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) throw new Error("Response body limit exceeded");
    chunks.push(Buffer.from(value));
    if (signal.aborted) throw new Error("Request timed out");
  }
  return Buffer.concat(chunks);
}

async function executeHttpRequest(params) {
  const run = ensureRun();
  const request = ensureHttpRequest(run, params);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeout);
  let body = Buffer.alloc(0);
  let response = null;
  let outcome = "completed";
  let errorText = "";
  try {
    const headers = { ...(request.headers ?? {}) };
    const cookies = cookieHeader(run, request.url);
    if (cookies) headers.Cookie = cookies;
    const init = { method: request.method, headers, redirect: "manual", signal: controller.signal };
    if (request.form) init.body = new URLSearchParams(request.form).toString();
    if (request.json) init.body = JSON.stringify(request.json);
    if (init.body && Buffer.byteLength(init.body) > MAX_BODY_BYTES) throw new Error("Request body limit exceeded");
    response = await fetch(request.url, init);
    storeCookies(run, response, request.url);
    body = await readResponseBody(response, MAX_BODY_BYTES, controller.signal);
    if (response.status >= 300 && response.status < 400) outcome = "redirect";
    else if (response.status >= 400) outcome = "http_error";
  } catch (error) {
    outcome = controller.signal.aborted ? "timeout" : "error";
    errorText = error instanceof Error ? error.message : "request failed";
  } finally {
    clearTimeout(timer);
  }
  const duration = Date.now() - started;
  const preview = sanitizePreview(body.toString("utf8") || errorText, run.declaration.flagRegex);
  return writeEvidence(run, {
    hypothesis_id: request.hypothesis_id,
    tool: "http_request",
    action_kind: request.action_kind,
    duration_ms: duration,
    outcome,
    status_code: response?.status ?? null,
    bytes: body.byteLength,
    redirect_location_present: response?.headers.has("location") ?? false,
    preview,
    request: { method: request.method, path: request.path, query_hash: hashBuffer(JSON.stringify(request.query ?? {})), body_hash: hashBuffer(Buffer.from(initBody(request))) },
  }, body.length > 0 ? body : errorText);
}

function initBody(request) {
  if (request.form) return new URLSearchParams(request.form).toString();
  if (request.json) return JSON.stringify(request.json);
  return "";
}

function safeRelativePath(run, input, roots) {
  if (typeof input !== "string" || !input || isAbsolute(input) || input.includes("\\") || input.includes("\x00") || input.split("/").some((part) => part === "..")) throw new Error("Unsafe relative path");
  const target = resolve(run.challengeRoot, input);
  const resolvedTarget = existsSync(target) ? realpathSync(target) : target;
  if (!roots.some((root) => isInside(root, resolvedTarget) || resolvedTarget === root)) throw new Error("Path escapes challenge directory");
  const matchingRoot = roots.find((root) => isInside(root, resolvedTarget) || resolvedTarget === root);
  rejectSymlinkComponents(matchingRoot, target);
  return target;
}

function executableFor(profile) {
  const candidates = {
    file: ["/usr/bin/file", "/bin/file"],
    strings: ["/usr/bin/strings", "/bin/strings"],
    readelf: ["/usr/bin/readelf", "/opt/homebrew/bin/readelf"],
    objdump: ["/usr/bin/objdump", "/opt/homebrew/bin/objdump"],
    nm: ["/usr/bin/nm", "/usr/bin/nm-classic", "/opt/homebrew/bin/nm"],
    sha256: ["/usr/bin/shasum", "/bin/shasum"],
    run_exploit: ["/usr/bin/python3", "/opt/homebrew/bin/python3"],
  }[profile];
  const executable = candidates?.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error(`Profile executable unavailable: ${profile}`);
  return executable;
}

function spawnBounded(executable, args, cwd, timeout) {
  return new Promise((resolvePromise) => {
    const child = spawn(executable, args, { cwd, shell: false, env: { PATH: "/usr/bin:/bin:/opt/homebrew/bin", LANG: "C" } });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes <= MAX_BODY_BYTES) target.push(chunk);
      else child.kill("SIGTERM");
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), limited: bytes > MAX_BODY_BYTES });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ code: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.from(error.message), limited: false });
    });
  });
}

async function executeLocalCommand(params) {
  const run = ensureRun();
  const timeout = Number(params.timeout_ms);
  if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT_MS || timeout > MAX_TIMEOUT_MS) throw new Error("Invalid timeout");
  const profile = params.profile;
  if (!Object.hasOwn({ file: 1, strings: 1, readelf: 1, objdump: 1, nm: 1, sha256: 1, run_exploit: 1 }, profile)) throw new Error("Invalid command profile");
  if (profile === "run_exploit" && process.env.CTFC_STAGE2_TEST_MODE !== TEST_MODE) throw new Error("run_exploit is test-mode-only");
  const sourceRoot = realpathSync(join(run.challengeRoot, "source"));
  const workRoot = realpathSync(run.runtimePaths.work);
  const exploitsRoot = realpathSync(run.runtimePaths.exploits);
  const roots = profile === "run_exploit" ? [exploitsRoot] : [sourceRoot, workRoot];
  const paths = params.paths ?? [];
  if (paths.length === 0 || paths.length > 8) throw new Error("Invalid command paths");
  const resolvedPaths = profile === "run_exploit"
    ? paths.map((path) => safeRelativePath({ ...run, challengeRoot: exploitsRoot }, path.replace(/^exploits\//, ""), roots))
    : paths.map((path) => safeRelativePath(run, path, roots));
  if (profile === "run_exploit") {
    if (resolvedPaths.length !== 1 || !resolvedPaths[0].endsWith(".py")) throw new Error("run_exploit requires one Python file");
    const relativeExploit = relative(run.challengeRoot, resolvedPaths[0]);
    const recorded = run.writtenExploitFiles.get(relativeExploit);
    if (!recorded || recorded !== hashBuffer(readFileSync(resolvedPaths[0]))) throw new Error("Exploit file is not recorded or was modified");
  }
  const args = Array.isArray(params.args) ? params.args : [];
  if (args.length > 16 || args.some((arg) => typeof arg !== "string" || arg.length > 256 || (profile === "run_exploit" && arg.startsWith("-")))) throw new Error("Invalid command arguments");
  const executable = executableFor(profile);
  const commandArgs = profile === "run_exploit" ? [resolvedPaths[0], ...args] : profile === "sha256" ? ["-a", "256", ...resolvedPaths] : [...args, ...resolvedPaths];
  const started = Date.now();
  const result = await spawnBounded(executable, commandArgs, run.challengeRoot, timeout);
  const output = Buffer.concat([result.stdout, result.stderr]);
  const outcome = result.limited ? "output_limit" : result.signal ? "timeout" : result.code === 0 ? "completed" : "error";
  return writeEvidence(run, {
    hypothesis_id: params.hypothesis_id,
    tool: "run_local_command",
    profile,
    duration_ms: Date.now() - started,
    outcome,
    exit_code: result.code,
    bytes: output.byteLength,
    preview: sanitizePreview(output.toString("utf8"), run.declaration.flagRegex),
  }, output);
}

function ensureExploitPath(run, relativePath) {
  if (typeof relativePath !== "string" || !relativePath.endsWith(".py") || isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.includes("\x00") || relativePath.split("/").some((part) => part === "..")) throw new Error("Unsafe exploit path");
  const root = realpathSync(run.runtimePaths.exploits);
  const target = resolve(root, relativePath);
  if (!isInside(root, target)) throw new Error("Exploit path escapes challenge");
  rejectSymlinkComponents(root, target);
  if (existsSync(target)) throw new Error("Exploit file already exists");
  return target;
}

function writeExploit(params) {
  const run = ensureRun();
  if (params.language !== "python") throw new Error("Only Python exploits are supported");
  if (typeof params.content !== "string" || Buffer.byteLength(params.content) > 64 * 1024) throw new Error("Exploit content exceeds limit");
  const target = ensureExploitPath(run, params.relative_path);
  ensureSafeDirectory(run.runtimePaths.exploits, run.runtimePaths.work);
  const descriptor = openSync(target, "wx", 0o600);
  try { writeFileSync(descriptor, params.content, { mode: 0o600 }); } finally { closeSync(descriptor); }
  const relativePath = relative(run.challengeRoot, target);
  run.writtenExploitFiles.set(relativePath, hashBuffer(readFileSync(target)));
  return writeEvidence(run, { hypothesis_id: params.hypothesis_id, tool: "write_exploit", outcome: "completed", path: relativePath, bytes: Buffer.byteLength(params.content), preview: "exploit file created" }, params.content);
}

function verifyFlag(params) {
  if (!activeRun || !["active"].includes(activeRun.status)) throw new Error("No verifiable active investigation");
  const evidence = activeRun.evidenceRecords.get(params.evidence_id);
  if (!evidence) throw new Error("Evidence does not belong to current run");
  const publicPath = join(activeRun.runtimePaths.evidence, `${evidence.record.sequence}-${params.evidence_id}.json`);
  rejectSymlinkComponents(activeRun.runtimePaths.run_root, publicPath);
  rejectSymlinkComponents(activeRun.runtimePaths.run_root, evidence.privatePath);
  const publicRecord = JSON.parse(readFileSync(publicPath, "utf8"));
  const privateBytes = readFileSync(evidence.privatePath);
  const { evidence_hash: publicHash, ...publicBase } = publicRecord;
  if (hashBuffer(privateBytes) !== evidence.record.private_artifact_sha256 || publicHash !== hashBuffer(JSON.stringify(publicBase))) throw new Error("Evidence integrity check failed");
  if (publicHash !== evidence.record.evidence_hash) throw new Error("Evidence record changed");
  const text = privateBytes.toString("utf8");
  const candidateOffset = params.candidate ? text.indexOf(params.candidate) : -1;
  const candidateMatch = params.candidate && candidateOffset >= 0 && activeRun.declaration.flagRegex.test(params.candidate)
    ? [params.candidate]
    : null;
  if (candidateMatch) candidateMatch.index = candidateOffset;
  const match = candidateMatch ?? activeRun.declaration.flagRegex.exec(text);
  if (!match) throw new Error("No matching flag in retained evidence");
  const flagSha256 = hashBuffer(match[0]);
  activeRun.verifiedFlags.set(params.evidence_id, { flag_sha256: flagSha256, match_offset: match.index });
  return { verified: true, evidence_id: params.evidence_id, flag_sha256: flagSha256, match_offset: match.index };
}

function finalizeResult(params) {
  if (!activeRun || activeRun.status !== "active") throw new Error("Investigation is already finalized or missing");
  if (!["solved", "not_solved", "timeout", "infrastructure_failure"].includes(params.status)) throw new Error("Invalid final status");
  const verification = params.verified_evidence_id ? activeRun.verifiedFlags.get(params.verified_evidence_id) : null;
  if (params.status === "solved" && !verification) throw new Error("Solved requires verified evidence");
  activeRun.status = params.status;
  const result = { status: params.status, reason: String(params.reason).slice(0, 500), run_id: activeRun.runId, challenge_slug: activeRun.challengeSlug, action_count: activeRun.actionCount, elapsed_ms: Date.now() - activeRun.startedAt, verified_evidence_id: params.verified_evidence_id ?? null, flag_sha256: verification?.flag_sha256 ?? null, finalized_at: new Date().toISOString() };
  atomicWrite(activeRun.runtimePaths.result, `${JSON.stringify(result, null, 2)}\n`);
  atomicWrite(activeRun.runtimePaths.state, `${JSON.stringify({ ...result, action_count: activeRun.actionCount }, null, 2)}\n`);
  return result;
}

export function beginInvestigation(challengeSlug) {
  if (activeRun?.status === "active") throw new Error("An investigation is already active");
  const declaration = loadManifest(challengeSlug);
  const challengeRoot = declaration.challengeRoot;
  activeRun = {
    runId: declaration.run_id, status: "active", challengeSlug, challengeRoot, declaration,
    runtimePaths: declaration.runtimePaths, normalizedTargetOrigin: declaration.targetOrigin, startedAt: Date.now(), deadlineAt: Date.parse(declaration.deadline_at),
    actionBudget: declaration.actionBudget, actionCount: 0, evidenceSequence: 0, lastEvidenceHash: null,
    cookies: new Map(), writtenExploitFiles: new Map(), verifiedFlags: new Map(), evidenceRecords: new Map(), consecutiveNoNewEvidence: 0,
  };
  atomicWrite(activeRun.runtimePaths.state, `${JSON.stringify({ run_id: activeRun.runId, status: activeRun.status, action_count: 0 }, null, 2)}\n`);
  return { challenge_slug: challengeSlug, state: "ready", phase: "source_audit", category: declaration.category, next_action: "delegate_one_read_only_auditor", remote_actions: "allowed_by_manifest", side_effects: "none", run_id: declaration.run_id };
}

function textResult(value) { return { content: [{ type: "text", text: JSON.stringify(value) }], details: value }; }

const stage2Status = defineTool({
  name: "stage2_status", label: "Stage 2 Status", description: "Read and validate local CTF-C challenge declaration metadata.",
  parameters: Type.Object({ challenge_slug: Type.String({ description: "Safe challenge directory slug" }) }),
  async execute(_id, params) {
    const declaration = readStage2Declaration(params.challenge_slug);
    return textResult({ challenge_slug: declaration.challenge_slug, category: declaration.category, methods: parseList(declaration.allowed_http_methods), action_kinds: parseList(declaration.allowed_action_kinds), per_run_approval_required: declaration.per_run_approval_required, time_budget: declaration.time_budget });
  },
});

const beginInvestigationTool = defineTool({
  name: "begin_investigation", label: "Begin Investigation", description: "Start one bounded CTF-C investigation without side effects.",
  parameters: Type.Object({ challenge_slug: Type.String({ description: "Safe challenge directory slug" }) }),
  async execute(_id, params) { return textResult(beginInvestigation(params.challenge_slug)); },
});

const httpRequestTool = defineTool({
  name: "http_request", label: "HTTP Request", description: "Perform one declaration-authorized bounded Web request and save evidence.",
  parameters: Type.Object({ hypothesis_id: Type.String(), method: Type.Union([Type.Literal("GET"), Type.Literal("POST")]), path: Type.String(), query: Type.Optional(Type.Record(Type.String(), Type.String())), form: Type.Optional(Type.Record(Type.String(), Type.String())), json: Type.Optional(Type.Record(Type.String(), Type.Unknown())), headers: Type.Optional(Type.Record(Type.String(), Type.String())), action_kind: Type.String(), timeout_ms: Type.Number() }),
  async execute(_id, params) { return textResult(await executeHttpRequest(params)); },
});

const localCommandTool = defineTool({
  name: "run_local_command", label: "Run Local Command", description: "Run one fixed-profile bounded local command and save evidence.",
  parameters: Type.Object({ hypothesis_id: Type.String(), profile: Type.String(), paths: Type.Array(Type.String()), args: Type.Optional(Type.Array(Type.String())), timeout_ms: Type.Number() }),
  async execute(_id, params) { return textResult(await executeLocalCommand(params)); },
});

const writeExploitTool = defineTool({
  name: "write_exploit", label: "Write Exploit", description: "Create one confined Python exploit file for the active test run.",
  parameters: Type.Object({ hypothesis_id: Type.String(), relative_path: Type.String(), content: Type.String(), language: Type.Literal("python") }),
  async execute(_id, params) { return textResult(writeExploit(params)); },
});

const verifyFlagTool = defineTool({
  name: "verify_flag", label: "Verify Flag", description: "Verify a candidate only against retained private evidence.",
  parameters: Type.Object({ evidence_id: Type.String(), candidate: Type.Optional(Type.String()) }),
  async execute(_id, params) { return textResult(verifyFlag(params)); },
});

const finalizeResultTool = defineTool({
  name: "finalize_result", label: "Finalize Result", description: "Finalize one investigation with verified or non-solved state.",
  parameters: Type.Object({ status: Type.String(), reason: Type.String(), verified_evidence_id: Type.Optional(Type.String()) }),
  async execute(_id, params) { return textResult(finalizeResult(params)); },
});

export const stage2Tools = [stage2Status, beginInvestigationTool, httpRequestTool, localCommandTool, writeExploitTool, verifyFlagTool, finalizeResultTool];

export default function (pi) {
  for (const tool of stage2Tools) pi.registerTool(tool);
}
