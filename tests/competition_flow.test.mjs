import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

function tool(name) {
  const selected = competitionTools.find((candidate) => candidate.name === name);
  if (!selected) throw new Error(`missing tool: ${name}`);
  return selected;
}

async function call(name, params) {
  const result = await tool(name).execute(`competition-flow-${name}`, params);
  return result.details ?? JSON.parse(result.content[0].text);
}

export default function (pi) {
  pi.on("session_start", async () => {
    const recordPath = process.env.CTFC_COMPETITION_RUN_RECORD;
    if (!recordPath) throw new Error("competition flow requires a private run record");
    assert.deepEqual(competitionTools.map((tool) => tool.name), ["http_request", "inspect_evidence", "list_source", "read_source", "run_local_command", "verify_flag"]);
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    const users = new Set();
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const form = new URLSearchParams(rawBody);
      const cookie = request.headers.cookie ?? "";
      if (request.method === "GET" && request.url === "/") {
        response.setHeader("content-type", "text/html");
        response.end('<form action="/register" method="POST"><input name="user"><input name="password"><input name="csrf_token" value="fixture-secret"></form><a href="/login">Login</a><script src="/static/app.js"></script><script>const next = "/dashboard";</script>' + "x".repeat(1100) + "SAFE_AFTER_1024");
      } else if (request.method === "GET" && request.url === "/static/app.js") {
        response.setHeader("content-type", "application/javascript");
        response.end("window.challenge = true;");
      } else if (request.method === "GET" && request.url === "/login") {
        response.setHeader("content-type", "text/html");
        response.end('<form action="/login" method="POST"><input name="user"><input name="password"></form>');
      } else if (request.method === "POST" && request.url === "/strict-form" && request.headers["content-type"] === "application/x-www-form-urlencoded" && form.get("mode") === "form") {
        response.setHeader("content-type", "text/plain");
        response.end("strict-form-ok");
      } else if (request.method === "POST" && request.url === "/strict-json" && request.headers["content-type"] === "application/json" && JSON.parse(rawBody).mode === "json") {
        response.setHeader("content-type", "text/plain");
        response.end("strict-json-ok");
      } else if (request.method === "POST" && request.url === "/register") {
        users.add(form.get("user"));
        response.setHeader("content-type", "text/html");
        response.end('<a href="/login">Continue to login</a>');
      } else if (request.method === "POST" && request.url === "/login" && users.has(form.get("user")) && form.get("password") === "temporary") {
        response.setHeader("Set-Cookie", "session=fixture-ok; Path=/");
        response.setHeader("X-Api-Key", "fixture-secret");
        response.setHeader("content-type", "text/html");
        response.end('<a href="/dashboard">Dashboard</a>');
      } else if (request.method === "GET" && request.url === "/dashboard" && cookie === "session=fixture-ok") {
        response.setHeader("content-type", "text/html");
        response.end('<a href="/flag">Flag</a>');
      } else if (request.method === "GET" && request.url === "/flag" && cookie === "session=fixture-ok") {
        response.setHeader("content-type", "text/plain");
        response.end("picoCTF{competition_direct_fixture}");
      } else {
        response.statusCode = 403;
        response.end("forbidden");
      }
    });
    await new Promise((resolve) => server.listen(Number(new URL(record.target_origin).port), "127.0.0.1", resolve));
    try {
      process.env.CTFC_STAGE2_TEST_MODE = "local-fixture";
      const first = await call("http_request", { method: "GET", path: "/", action_kind: "recon", timeout_ms: 2000 });
      assert.equal(first.evidence_id, "e-001", "first HTTP action was not immediate");
      assert.match(first.preview, /form|register/i);
      const sourceList = await call("list_source", { path: ".", limit: 8 });
      assert.deepEqual(sourceList.entries.map((entry) => entry.path), ["app.js", "nested", "symlink.js"]);
      const source = await call("read_source", { path: "app.js", offset: 0, limit: 64 });
      assert.match(source.text, /source fixture/);
      await assert.rejects(() => call("read_source", { path: "symlink.js", limit: 64 }), /symlink/i);
      const strictForm = await call("http_request", { method: "POST", path: "/strict-form", form: { mode: "form" }, action_kind: "submit", timeout_ms: 2000 });
      assert.equal(strictForm.status_code, 200, "form request did not receive its automatic Content-Type");
      const strictJson = await call("http_request", { method: "POST", path: "/strict-json", json: { mode: "json" }, action_kind: "submit", timeout_ms: 2000 });
      assert.equal(strictJson.status_code, 200, "JSON request did not receive its automatic Content-Type");
      await assert.rejects(() => call("http_request", { method: "POST", path: "/strict-form", form: { mode: "form" }, headers: { "content-type": "application/json" }, action_kind: "submit", timeout_ms: 2000 }), /Conflicting Content-Type/);
      await assert.rejects(() => call("http_request", { method: "POST", path: "/strict-form", form: { mode: "form" }, headers: { "content-type": "text/plain" }, action_kind: "submit", timeout_ms: 2000 }), /Unsafe Content-Type/);
      const inspected = await call("inspect_evidence", { evidence_id: first.evidence_id, offset: 0, limit: 4096 });
      await assert.rejects(() => call("inspect_evidence", { evidence_id: "e-999" }), /current run/);
      const longRange = await call("inspect_evidence", { evidence_id: first.evidence_id, offset: 1024, limit: 4096 });
      assert.match(longRange.body.text, /SAFE_AFTER_1024/);
      assert.equal(inspected.forms[0].action, "/register");
      assert.equal(inspected.forms[0].controls[2].value, "[REDACTED_SECRET]");
      assert.deepEqual(inspected.links, ["/login"]);
      assert.deepEqual(inspected.scripts.map((script) => script.src || script.inline_excerpt), ["/static/app.js", "const next = \"/dashboard\";"]);
      const script = await call("http_request", { method: "GET", path: inspected.scripts[0].src, action_kind: "recon", timeout_ms: 2000 });
      assert.equal(script.status_code, 200);
      const username = `direct-${process.pid}`;
      await call("http_request", { method: "POST", path: inspected.forms[0].action, form: { user: username, password: "temporary" }, action_kind: "login", timeout_ms: 2000 });
      const loginPage = await call("http_request", { method: "GET", path: "/login", action_kind: "recon", timeout_ms: 2000 });
      const loginForm = await call("inspect_evidence", { evidence_id: loginPage.evidence_id });
      assert.equal(loginForm.forms[0].action, "/login");
      const login = await call("http_request", { method: "POST", path: loginForm.forms[0].action, form: { user: username, password: "temporary" }, action_kind: "login", timeout_ms: 2000 });
      const loginInfo = await call("inspect_evidence", { evidence_id: login.evidence_id });
      assert.match(loginInfo.links[0] ?? "", /dashboard/);
      assert.equal(loginInfo.response_headers["x-api-key"], "[REDACTED_SECRET]");
      const jar = JSON.parse(readFileSync(record.paths.cookies, "utf8"));
      assert.equal(jar.run_id, record.run_id, "cookie jar run identity missing");
      assert.equal(jar.target_origin, record.target_origin, "cookie jar target identity missing");
      const loginRecordBeforeResume = readFileSync(`${record.paths.evidence}/9-e-009.json`);
      const stateBeforeResume = JSON.parse(readFileSync(record.paths.state, "utf8"));
      initializeCompetitionRun();
      const stateAfterResume = JSON.parse(readFileSync(record.paths.state, "utf8"));
      assert.equal(stateAfterResume.started_at, stateBeforeResume.started_at, "resume changed the original start time");
      assert.equal(stateAfterResume.deadline_at, stateBeforeResume.deadline_at, "resume extended the original deadline");
      assert.deepEqual(readFileSync(`${record.paths.evidence}/9-e-009.json`), loginRecordBeforeResume, "resume overwrote previous evidence");
      const expiredState = { ...stateAfterResume, deadline_at: Date.now() - 1 };
      writeFileSync(record.paths.state, `${JSON.stringify(expiredState)}\n`);
      initializeCompetitionRun();
      await assert.rejects(() => call("inspect_evidence", { evidence_id: first.evidence_id }), /deadline exceeded/);
      writeFileSync(record.paths.state, `${JSON.stringify(stateAfterResume)}\n`);
      initializeCompetitionRun();
      const oldEvidence = await call("inspect_evidence", { evidence_id: first.evidence_id });
      assert.match(oldEvidence.body.text, /register/);
      const dashboard = await call("http_request", { method: "GET", path: "/dashboard", action_kind: "authenticated_request", timeout_ms: 2000 });
      assert.equal(dashboard.evidence_id, "e-010", "resume did not continue evidence numbering");
      const loginRecord = JSON.parse(readFileSync(`${record.paths.evidence}/9-e-009.json`, "utf8"));
      const dashboardRecord = JSON.parse(readFileSync(`${record.paths.evidence}/10-e-010.json`, "utf8"));
      assert.equal(dashboardRecord.prior_evidence_hash, loginRecord.evidence_hash, "resume broke the evidence hash chain");
      const dashboardInfo = await call("inspect_evidence", { evidence_id: dashboard.evidence_id });
      assert.deepEqual(dashboardInfo.links, ["/flag"]);
      const flag = await call("http_request", { method: "GET", path: dashboardInfo.links[0], action_kind: "authenticated_request", timeout_ms: 2000 });
      assert.equal(flag.preview, "[REDACTED_FLAG]");
      const flagInfo = await call("inspect_evidence", { evidence_id: flag.evidence_id });
      assert.equal(flagInfo.body.text, "[REDACTED_FLAG]");
      await assert.rejects(() => call("verify_flag", { evidence_id: "e-999" }), /current run/);
      const verified = await call("verify_flag", { evidence_id: flag.evidence_id });
      assert.equal(verified.flag, "picoCTF{competition_direct_fixture}");
      assert.equal(verified.verified, true);
      assert.ok(existsSync(record.paths.result));
      const statePath = record.paths.state;
      const originalState = readFileSync(statePath);
      writeFileSync(statePath, "corrupt\n");
      await assert.rejects(() => initializeCompetitionRun(), /Competition state is corrupted/);
      writeFileSync(statePath, originalState);
      const mismatchedState = JSON.parse(originalState.toString("utf8"));
      mismatchedState.target_origin = "http://other.example";
      writeFileSync(statePath, `${JSON.stringify(mismatchedState)}\n`);
      await assert.rejects(() => initializeCompetitionRun(), /does not match run/);
      writeFileSync(statePath, originalState);
      process.stderr.write("CTF_C_COMPETITION_FLOW=passed\n");
    } finally {
      delete process.env.CTFC_STAGE2_TEST_MODE;
      server.close();
    }
  });
}
