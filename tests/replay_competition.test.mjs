import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { startH1Fixture } from "./fixtures/h1-basic-http.mjs";
import { startH2Fixture } from "./fixtures/h2-stateful-auth.mjs";
import { startH3Fixture } from "./fixtures/h3-csrf-dynamic.mjs";
import { startH4Fixture } from "./fixtures/h4-api-session.mjs";
import { startH5Fixture } from "./fixtures/h5-recovery-auth.mjs";
import { launcherPath, mapTerminalStatus, runReplay, summarizeRun } from "../scripts/replay_competition.mjs";

test("H1 fixture starts locally, exposes a clue, and stops cleanly", async () => {
  const fixture = await startH1Fixture();
  try {
    const root = await fetch(fixture.origin);
    const rootText = await root.text();
    assert.equal(root.status, 200);
    assert.match(rootText, /href="\/reveal"/);
    assert.doesNotMatch(rootText, /picoCTF\{/);
    const reveal = await fetch(`${fixture.origin}/reveal`);
    assert.match(await reveal.text(), /^picoCTF\{h1_[0-9a-f]+\}$/);
    assert.match(fixture.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await fixture.stop();
  }
  await assert.rejects(() => fetch(`${fixture.origin}/`));
});

test("H2 fixture enforces stateful registration, login, cookie auth, and observed flag routing", async () => {
  const fixture = await startH2Fixture();
  const formHeaders = { "content-type": "application/x-www-form-urlencoded" };
  const post = (path, values) => fetch(`${fixture.origin}${path}`, { method: "POST", headers: formHeaders, body: new URLSearchParams(values), redirect: "manual" });
  try {
    const root = await fetch(fixture.origin);
    const rootText = await root.text();
    assert.equal(root.status, 200);
    assert.match(rootText, /action="\/register"/);
    assert.doesNotMatch(rootText, /picoCTF\{/);
    assert.equal((await post("/register", { username: "x", password: "no" })).status, 400);
    assert.equal((await post("/login", { username: "never-registered", password: "temporary" })).status, 401);
    assert.equal((await fetch(`${fixture.origin}/dashboard`)).status, 403);
    assert.equal((await fetch(`${fixture.origin}/flag`)).status, 403);

    const username = `h2user${Date.now().toString(36)}`;
    const password = "ValidPass_42";
    const registered = await post("/register", { username, password });
    assert.equal(registered.status, 200);
    assert.match(await registered.text(), /href="\/login"/);
    const loginPage = await fetch(`${fixture.origin}/login`);
    assert.match(await loginPage.text(), /action="\/login"/);
    assert.equal((await post("/login", { username, password: "wrong-password" })).status, 401);
    const login = await post("/login", { username, password });
    assert.equal(login.status, 302);
    assert.equal(login.headers.get("location"), "/dashboard");
    const setCookie = login.headers.get("set-cookie");
    assert.match(setCookie ?? "", /^h2_session=[^;]+; Path=\/; HttpOnly$/);
    const cookie = setCookie.split(";", 1)[0];
    const dashboard = await fetch(`${fixture.origin}/dashboard`, { headers: { cookie } });
    assert.equal(dashboard.status, 200);
    const dashboardText = await dashboard.text();
    assert.match(dashboardText, /href="\/flag"/);
    const flag = await fetch(`${fixture.origin}/flag`, { headers: { cookie } });
    assert.match(await flag.text(), /^picoCTF\{h2_[0-9a-f]+\}$/);
  } finally {
    await fixture.stop();
  }
  await assert.rejects(() => fetch(`${fixture.origin}/`));
});

test("H3 fixture binds single-use registration and login tokens to the session", async () => {
  const fixture = await startH3Fixture();
  const formHeaders = { "content-type": "application/x-www-form-urlencoded" };
  const post = (path, values, cookie) => fetch(`${fixture.origin}${path}`, { method: "POST", headers: { ...formHeaders, ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(values), redirect: "manual" });
  const getSession = async () => {
    const response = await fetch(fixture.origin);
    const setCookie = response.headers.get("set-cookie");
    const cookie = setCookie.split(";", 1)[0];
    const html = await response.text();
    const token = html.match(/name="csrf_token" value="([^"]+)"/)?.[1];
    return { cookie, token };
  };
  try {
    const first = await getSession();
    const second = await getSession();
    assert.ok(first.token && second.token);
    assert.notEqual(first.token, second.token);
    assert.equal((await post("/register", { username: "h3user", password: "ValidPass_42" }, first.cookie)).status, 400);
    assert.equal((await post("/register", { username: "h3user", password: "ValidPass_42", csrf_token: "wrong" }, first.cookie)).status, 400);
    assert.equal((await post("/register", { username: "h3user", password: "ValidPass_42", csrf_token: first.token }, second.cookie)).status, 400);
    const registered = await post("/register", { username: "h3user", password: "ValidPass_42", csrf_token: first.token }, first.cookie);
    assert.equal(registered.status, 200);
    assert.equal((await post("/register", { username: "h3user", password: "ValidPass_42", csrf_token: first.token }, first.cookie)).status, 400);

    const loginPage = await fetch(`${fixture.origin}/login`, { headers: { cookie: first.cookie } });
    const loginHtml = await loginPage.text();
    const loginToken = loginHtml.match(/name="csrf_token" value="([^"]+)"/)?.[1];
    assert.ok(loginToken);
    assert.notEqual(first.token, loginToken);
    assert.equal((await post("/login", { username: "h3user", password: "ValidPass_42" }, first.cookie)).status, 401);
    assert.equal((await post("/login", { username: "h3user", password: "ValidPass_42", csrf_token: "wrong" }, first.cookie)).status, 401);
    assert.equal((await post("/login", { username: "h3user", password: "ValidPass_42", csrf_token: loginToken }, second.cookie)).status, 401);
    const staleLoginPage = await fetch(`${fixture.origin}/login`, { headers: { cookie: first.cookie } });
    const staleLoginHtml = await staleLoginPage.text();
    const currentLoginToken = staleLoginHtml.match(/name="csrf_token" value="([^"]+)"/)?.[1];
    assert.notEqual(loginToken, currentLoginToken);
    assert.equal((await post("/login", { username: "h3user", password: "ValidPass_42", csrf_token: loginToken }, first.cookie)).status, 401);
    const login = await post("/login", { username: "h3user", password: "ValidPass_42", csrf_token: currentLoginToken }, first.cookie);
    assert.equal(login.status, 302);
    assert.equal(login.headers.get("location"), "/dashboard");
    assert.equal((await post("/login", { username: "h3user", password: "ValidPass_42", csrf_token: currentLoginToken }, first.cookie)).status, 401);
    assert.equal((await fetch(`${fixture.origin}/dashboard`)).status, 403);
    assert.equal((await fetch(`${fixture.origin}/flag`)).status, 403);
    const dashboard = await fetch(`${fixture.origin}/dashboard`, { headers: { cookie: first.cookie } });
    assert.match(await dashboard.text(), /href="\/flag"/);
    const flag = await fetch(`${fixture.origin}/flag`, { headers: { cookie: first.cookie } });
    assert.match(await flag.text(), /^picoCTF\{h3_[0-9a-f]+\}$/);
  } finally {
    await fixture.stop();
  }
  await assert.rejects(() => fetch(`${fixture.origin}/`));
});

test("H4 fixture enforces JSON registration, cookie login, redirect, and authenticated API routing", async () => {
  const fixture = await startH4Fixture();
  const jsonPost = (path, body) => fetch(`${fixture.origin}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), redirect: "manual" });
  try {
    const root = await fetch(fixture.origin);
    const rootText = await root.text();
    assert.equal(root.status, 200);
    assert.match(rootText, /\/api\/register|application\/json/);
    assert.doesNotMatch(rootText, /picoCTF\{/);
    assert.equal((await fetch(`${fixture.origin}/api/me`)).status, 401);
    assert.equal((await fetch(`${fixture.origin}/api/flag`)).status, 401);
    assert.equal((await fetch(`${fixture.origin}/api/flag`, { headers: { cookie: "h4_session=guessed" } })).status, 401);
    assert.equal((await fetch(`${fixture.origin}/api/register`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "username=apiuser&password=ValidPass_42" })).status, 415);
    assert.equal((await jsonPost("/api/login", { username: "apiuser", password: "ValidPass_42" })).status, 401);
    const malformed = await fetch(`${fixture.origin}/api/register`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    assert.equal(malformed.status, 400);
    assert.equal((await jsonPost("/api/register", { username: "x", password: "no" })).status, 400);
    const registered = await jsonPost("/api/register", { username: "apiuser", password: "ValidPass_42" });
    assert.equal(registered.status, 200);
    assert.equal((await jsonPost("/api/register", { username: "apiuser", password: "ValidPass_42" })).status, 409);
    assert.equal((await jsonPost("/api/login", { username: "apiuser", password: "wrong" })).status, 401);
    assert.equal((await fetch(`${fixture.origin}/api/login`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "username=apiuser&password=ValidPass_42" })).status, 415);
    const login = await jsonPost("/api/login", { username: "apiuser", password: "ValidPass_42" });
    assert.equal(login.status, 302);
    assert.equal(login.headers.get("location"), "/api/me");
    const setCookie = login.headers.get("set-cookie");
    assert.match(setCookie ?? "", /^h4_session=[^;]+; Path=\/; HttpOnly$/);
    const cookie = setCookie.split(";", 1)[0];
    const me = await fetch(`${fixture.origin}/api/me`, { headers: { cookie } });
    assert.equal(me.status, 200);
    const meBody = await me.json();
    assert.equal(meBody.flag_route, "/api/flag");
    const flag = await fetch(`${fixture.origin}${meBody.flag_route}`, { headers: { cookie } });
    assert.equal(flag.status, 200);
    assert.match((await flag.json()).flag, /^picoCTF\{h4_[0-9a-f]+\}$/);
  } finally {
    await fixture.stop();
  }
  await assert.rejects(() => fetch(`${fixture.origin}/`));
});

test("H5 fixture exposes a failed-login pivot before authenticated route discovery", async () => {
  const fixture = await startH5Fixture();
  const post = (path, values) => fetch(`${fixture.origin}${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values), redirect: "manual" });
  try {
    const root = await fetch(fixture.origin);
    assert.doesNotMatch(await root.text(), /picoCTF\{/);
    assert.equal((await fetch(`${fixture.origin}/dashboard`)).status, 401);
    const failed = await post("/login", { username: "not-yet-registered", password: "temporary" });
    assert.equal(failed.status, 500);
    assert.match(await failed.text(), /href="\/register"/);
    const register = await fetch(`${fixture.origin}/register`);
    assert.match(await register.text(), /action="\/register"/);
    assert.equal((await post("/register", { username: "h5user", password: "ValidPass_42" })).status, 200);
    const login = await post("/login", { username: "h5user", password: "ValidPass_42" });
    assert.equal(login.status, 302);
    assert.equal(login.headers.get("location"), "/dashboard");
    const setCookie = login.headers.get("set-cookie");
    const cookie = setCookie.split(";", 1)[0];
    const dashboard = await fetch(`${fixture.origin}/dashboard`, { headers: { cookie } });
    assert.match(await dashboard.text(), /href="\/flag"/);
    const flag = await fetch(`${fixture.origin}/flag`, { headers: { cookie } });
    assert.match(await flag.text(), /^picoCTF\{h5_[0-9a-f]+\}$/);
  } finally {
    await fixture.stop();
  }
  await assert.rejects(() => fetch(`${fixture.origin}/`));
});

test("summary is derived from public artifacts and has the required schema", () => {
  const root = mkdtempSync(join(tmpdir(), "ctf-c-summary-test-"));
  const evidence = join(root, "evidence");
  mkdirSync(evidence);
  const record = { run_id: "run-summary-test", paths: { evidence } };
  writeFileSync(join(evidence, "1-e-001.json"), JSON.stringify({ evidence_id: "e-001", tool: "http_request", request: { path: "/" } }));
  writeFileSync(join(evidence, "2-e-002.json"), JSON.stringify({ evidence_id: "e-002", tool: "http_request", request: { path: "/reveal" } }));
  const summary = summarizeRun({
    record,
    state: { action_count: 2, tool_call_count: 4 },
    result: { status: "solved", verified: true, verified_evidence_id: "e-002", flag_sha256: "a".repeat(64) },
    startedAt: 1000,
    finishedAt: 2500,
  });
   assert.deepEqual(Object.keys(summary), ["run_id", "fixture", "started_at", "finished_at", "duration_ms", "terminal_status", "verified", "verified_flag_sha256", "actions_total", "http_actions", "websocket_actions", "websocket_evidence_derived", "tool_actions", "analysis_actions", "tool_errors", "repeated_action_rejections", "evidence_count", "model", "provider", "failure_class", "failure_detail"]);
  assert.equal(summary.terminal_status, "solved");
  assert.equal(summary.verified, true);
  assert.equal(summary.duration_ms, 1500);
  assert.equal(summary.http_actions, 2);
  assert.equal(summary.tool_actions, 4);
  assert.equal(summary.tool_errors, null);
  rmSync(root, { recursive: true, force: true });
});

test("action budget status maps to exhausted", () => {
  assert.equal(mapTerminalStatus("action_budget_exhausted"), "exhausted");
  assert.equal(mapTerminalStatus("not_solved"), "not_solved");
});

test("replay delegates to the real launcher path and writes sanitized output", async () => {
  const root = mkdtempSync(join(tmpdir(), "ctf-c-replay-test-"));
  const fakeBin = join(root, "bin");
  const argsPath = join(root, "pi-args.txt");
  mkdirSync(fakeBin);
  const fakePi = join(fakeBin, "pi");
  writeFileSync(fakePi, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsPath}"\nexit 0\n`);
  chmodSync(fakePi, 0o755);
  try {
    const result = await runReplay({ outputRoot: join(root, "output"), timeBudget: "1", actionBudget: "1", env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });
    assert.ok(existsSync(result.outputPath));
    assert.equal(result.summary.terminal_status, "infrastructure_failure");
    const output = readFileSync(result.outputPath, "utf8");
    assert.doesNotMatch(output, /picoCTF\{/);
    assert.doesNotMatch(output, /(?:cookie|session|token|authorization)/i);
    assert.doesNotMatch(output, /\/private\/|\/session\//);
    assert.equal(result.summary.model, "unknown");
    assert.equal(result.summary.provider, "unknown");
    assert.equal(launcherPath, join(process.cwd(), "scripts", "run_competition.sh"));
    const defaultArgs = readFileSync(argsPath, "utf8");
    assert.doesNotMatch(defaultArgs, /--provider|--model|--thinking/);
    const h2Result = await runReplay({ fixture: "h2-stateful-auth", outputRoot: join(root, "output-h2"), timeBudget: "1", actionBudget: "1", env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });
    assert.equal(h2Result.summary.fixture, "h2-stateful-auth");
    assert.doesNotMatch(readFileSync(h2Result.outputPath, "utf8"), /picoCTF\{|cookie|password|token|\/private\/|\/session\//i);
    const h3Result = await runReplay({ fixture: "h3-csrf-dynamic", outputRoot: join(root, "output-h3"), timeBudget: "1", actionBudget: "1", env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });
    assert.equal(h3Result.summary.fixture, "h3-csrf-dynamic");
    assert.doesNotMatch(readFileSync(h3Result.outputPath, "utf8"), /picoCTF\{|cookie|password|token|\/private\/|\/session\//i);
    const h4Result = await runReplay({ fixture: "h4-api-session", outputRoot: join(root, "output-h4"), timeBudget: "1", actionBudget: "1", env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });
    assert.equal(h4Result.summary.fixture, "h4-api-session");
    assert.doesNotMatch(readFileSync(h4Result.outputPath, "utf8"), /picoCTF\{|cookie|password|token|\/private\/|\/session\//i);
    const h5Result = await runReplay({ fixture: "h5-recovery-auth", outputRoot: join(root, "output-h5"), timeBudget: "1", actionBudget: "1", env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });
    assert.equal(h5Result.summary.fixture, "h5-recovery-auth");
    assert.doesNotMatch(readFileSync(h5Result.outputPath, "utf8"), /picoCTF\{|cookie|password|token|\/private\/|\/session\//i);
    await runReplay({ outputRoot: join(root, "output-explicit"), timeBudget: "1", actionBudget: "1", piProvider: "opencode-go", piModel: "deepseek-v4-pro", piThinking: "off", env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });
    const explicitArgs = readFileSync(argsPath, "utf8");
    assert.match(explicitArgs, /--provider\nopencode-go/);
    assert.match(explicitArgs, /--model\ndeepseek-v4-pro/);
    assert.match(explicitArgs, /--thinking\noff/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
