import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, openSync, closeSync, readFileSync, realpathSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";

const METHODS = new Set(["GET", "POST"]);
const ACTIONS = new Set(["recon", "login", "authenticated_request", "submit", "trigger"]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function field(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp("^-[ \\t]*\\*\\*" + escaped + ":\\*\\*[ \\t]*`([^`]+)`", "m"))?.[1] ?? "";
}

function list(value) {
  return value === "none" ? [] : value.split(",").map((item) => item.trim()).filter(Boolean);
}

function fail(message) {
  throw new Error(message);
}

export function createStage3Manifest({ projectRoot = process.cwd(), slug, target, approved = false, runtimeRoot = process.env.CTFC_RUNTIME_ROOT }) {
  if (!SLUG.test(slug)) fail("Invalid challenge slug");
  if (!approved) fail("Explicit per-run approval is required");
  const challengesRoot = realpathSync(join(projectRoot, "challenges"));
  const challengeDir = resolve(challengesRoot, slug);
  if (!statSafe(challengeDir)?.isDirectory() || !realpathSafe(challengeDir).startsWith(`${challengesRoot}/`)) fail("Challenge directory not found");
  const declarationPath = join(challengeDir, "challenge.md");
  const declaration = readFileSync(declarationPath);
  const text = declaration.toString("utf8");
  const category = field(text, "Category");
  const flagRegex = field(text, "Flag regex");
  const methods = list(field(text, "Allowed HTTP methods"));
  const actionKinds = list(field(text, "Allowed action kinds"));
  const defaultMinutes = Number(field(text, "Default time budget minutes") || field(text, "Time budget minutes"));
  const maxMinutes = Number(field(text, "Maximum time budget minutes") || field(text, "Max time budget minutes") || defaultMinutes);
  const defaultActions = Number(field(text, "Default action budget") || field(text, "Action budget"));
  const maxActions = Number(field(text, "Maximum action budget") || field(text, "Max action budget") || defaultActions);
  const hostPattern = field(text, "Allowed host pattern");
  const approvalRequired = field(text, "Per-run approval required");
  if (!category || !flagRegex || !methods.length || !actionKinds.length || !Number.isInteger(defaultMinutes) || !Number.isInteger(maxMinutes) || !Number.isInteger(defaultActions) || !Number.isInteger(maxActions) || approvalRequired !== "true") fail("Incomplete durable challenge policy");
  if (methods.some((method) => !METHODS.has(method)) || actionKinds.some((kind) => !ACTIONS.has(kind))) fail("Invalid durable action policy");
  if (!target || !/^https?:\/\/[^\s/]+(?::[0-9]+)?(?:\/)?$/.test(target)) fail("Invalid target URL");
  const targetUrl = new URL(target);
  if (targetUrl.username || targetUrl.password || targetUrl.pathname !== "/" || targetUrl.search || targetUrl.hash) fail("Target must be an origin");
  if (hostPattern && hostPattern !== "none" && !new RegExp(hostPattern).test(targetUrl.hostname)) fail("Target host is outside declared policy");
  if (defaultMinutes > maxMinutes || defaultActions > maxActions) fail("Invalid budget policy");
  const root = resolve(runtimeRoot || join(process.env.TMPDIR || "/tmp", "ctf-c-runtime"));
  const runId = `${Date.now()}-${randomUUID()}`;
  const runRoot = join(root, "runs", slug, runId);
  const paths = {
    run_root: runRoot,
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
  mkdirSync(paths.run_root, { recursive: true, mode: 0o700 });
  for (const path of [paths.session, paths.work, paths.exploits, paths.evidence, paths.private]) mkdirSync(path, { recursive: true, mode: 0o700 });
  let lock;
  try { lock = openSync(paths.lock, "wx", 0o600); } catch { fail("Run is already locked"); }
  writeFileSync(lock, `${runId}\n`, { mode: 0o600 });
  closeSync(lock);
  const startedAt = new Date().toISOString();
  const manifest = {
    schema_version: 1,
    run_id: runId,
    challenge_slug: slug,
    challenge_dir: realpathSync(challengeDir),
    declaration_path: realpathSync(declarationPath),
    declaration_sha256: createHash("sha256").update(declaration).digest("hex"),
    target: { origin: `${targetUrl.protocol}//${targetUrl.host}`, protocol: targetUrl.protocol.slice(0, -1), hostname: targetUrl.hostname, port: Number(targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80)) },
    approval: { required: true, approved: true, approved_at: startedAt },
    effective: { http_methods: methods, action_kinds: actionKinds },
    budgets: { default_time_budget_minutes: defaultMinutes, maximum_time_budget_minutes: maxMinutes, time_budget_minutes: defaultMinutes, default_action_budget: defaultActions, maximum_action_budget: maxActions, action_budget: defaultActions },
    flag_regex: flagRegex,
    started_at: startedAt,
    deadline_at: new Date(Date.now() + defaultMinutes * 60_000).toISOString(),
    paths,
  };
  const encoded = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(paths.manifest, encoded, { mode: 0o600, flag: "wx" });
  chmodSync(paths.manifest, 0o600);
  const manifestSha256 = createHash("sha256").update(encoded).digest("hex");
  writeFileSync(paths.lock, `${runId}\n${manifestSha256}\n`, { mode: 0o600 });
  writeFileSync(paths.state, `${JSON.stringify({ run_id: runId, status: "created", action_count: 0 }, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(paths.cookies, "[]\n", { mode: 0o600 });
  return manifest;
}

function statSafe(path) { try { return statSync(path); } catch { return null; } }
function realpathSafe(path) { try { return realpathSync(path); } catch { return ""; } }

if (import.meta.url === `file://${process.argv[1]}`) {
  const [projectRoot, slug, target, approval, runtimeRoot] = process.argv.slice(2);
  const manifest = createStage3Manifest({ projectRoot, slug, target, approved: approval === "approved", runtimeRoot });
  process.stdout.write(`${manifest.paths.manifest}\n`);
}
