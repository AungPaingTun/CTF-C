import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const FLAG_REGEX = "picoCTF\\{[^}\\r\\n]{1,256}\\}";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function value(args, name, required = true) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length || args[index + 1].startsWith("--")) {
    if (required) fail(`${name} requires a value`);
    return "";
  }
  return args[index + 1];
}

function validateTarget(raw) {
  let target;
  try {
    target = new URL(raw);
  } catch {
    fail("Target must be a valid URL");
  }
  if (!target || !["http:", "https:"].includes(target.protocol)) fail("Target must use http or https");
  if (target.username || target.password) fail("Target credentials are not allowed");
  if (target.hash) fail("Target fragments are not allowed");
  if (target.pathname !== "/" || target.search) fail("Target must be an exact origin without a path or query");
  return `${target.protocol}//${target.host}`;
}

function existingDirectory(raw, label) {
  if (!raw) return null;
  let path;
  try {
    path = realpathSync(resolve(raw));
    if (!lstatSync(path).isDirectory()) throw new Error("not a directory");
  } catch {
    fail(`${label} must be an existing directory`);
  }
  return path;
}

function regularFile(raw) {
  let path;
  try {
    path = realpathSync(resolve(raw));
    if (!lstatSync(path).isFile()) throw new Error("not a file");
  } catch {
    fail("Description file must be an existing regular file");
  }
  return path;
}

function positiveInteger(raw, name, fallback, maximum) {
  const valueToCheck = raw || String(fallback);
  if (!/^[1-9][0-9]*$/.test(valueToCheck)) fail(`${name} must be a positive integer`);
  const value = Number(valueToCheck);
  if (value > maximum) fail(`${name} exceeds the maximum of ${maximum}`);
  return value;
}

const args = process.argv.slice(2);
if (!args.includes("--approve")) fail("Explicit --approve is required");
const targetOrigin = validateTarget(value(args, "--target"));
const descriptionPath = regularFile(value(args, "--description-file"));
const sourceRoot = existingDirectory(value(args, "--source", false), "Source");
const timeBudget = positiveInteger(value(args, "--time-budget", false), "Time budget", 15, 30);
const actionBudget = positiveInteger(value(args, "--action-budget", false), "Action budget", 20, 40);
const description = readFileSync(descriptionPath, "utf8");
const projectRoot = process.env.CTFC_PROJECT_ROOT ? resolve(process.env.CTFC_PROJECT_ROOT) : process.cwd();
const runtimeBase = resolve(process.env.CTFC_COMPETITION_RUNTIME_ROOT || join(projectRoot, ".ctf-c", "competition-runs"));
mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });
chmodSync(runtimeBase, 0o700);
const runRoot = mkdtempSync(join(runtimeBase, "run-"), { encoding: "utf8" });
chmodSync(runRoot, 0o700);
const paths = {
  run_root: runRoot,
  state: join(runRoot, "execution-state.json"),
  session: join(runRoot, "session"),
  cookies: join(runRoot, "session", "cookies.json"),
  work: join(runRoot, "work"),
  exploits: join(runRoot, "work", "exploits"),
  evidence: join(runRoot, "evidence"),
  private: join(runRoot, "private"),
  result: join(runRoot, "result.json"),
};
for (const directory of [paths.session, paths.work, paths.exploits, paths.evidence, paths.private]) mkdirSync(directory, { recursive: true, mode: 0o700 });
const record = {
  run_id: randomUUID(),
  target_origin: targetOrigin,
  approved: true,
  description,
  source_root: sourceRoot,
  time_budget: timeBudget,
  action_budget: actionBudget,
  flag_regex: FLAG_REGEX,
  paths,
};
const recordPath = join(runRoot, "run-record.json");
writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
chmodSync(recordPath, 0o600);
process.stdout.write(`${recordPath}\n`);
