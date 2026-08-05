import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

function tool(name) {
  const selected = competitionTools.find((candidate) => candidate.name === name);
  if (!selected) throw new Error(`missing tool: ${name}`);
  return selected;
}

async function call(name, params) {
  if (name === "http_request") params = { ...params, reasoning: { evidence_summary: ["The local fixture exposes a bounded route clue."], leading_hypothesis: `The route ${params.path} is the smallest experiment for the current fixture.`, supporting_evidence: ["The local fixture is the active test target."], experiment: `${params.method} ${params.path} fixture request`, expected_observation: "The fixture returns a bounded response.", confidence: 0.5, untested_experiments: [] } };
  const result = await tool(name).execute(`competition-flow-${name}`, params);
  return result.details ?? JSON.parse(result.content[0].text);
}

export default function (pi) {
  pi.on("session_start", async () => {
    const recordPath = process.env.CTFC_COMPETITION_RUN_RECORD;
    if (!recordPath) throw new Error("competition flow requires a private run record");
    assert.deepEqual(competitionTools.map((tool) => tool.name), ["http_request", "websocket_exchange", "browser_action", "start_competition_run", "inspect_evidence", "list_source", "read_source", "search_source", "compute_digest", "derive_binary_evidence", "run_local_command", "replace_session_cookie", "adopt_session_cookie", "verify_flag", "finalize_result"]);
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    const checkpointServer = createServer((request, response) => {
      if (request.method === "POST" && request.url === "/login-failure") {
        response.writeHead(500, { "content-type": "text/plain" });
        response.end("temporary login failure");
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<a href="/authenticated">Authenticated route</a><a href="/after-inspection">After inspection</a>');
    });
    await new Promise((resolve) => checkpointServer.listen(0, "127.0.0.1", resolve));
    const checkpointPort = checkpointServer.address().port;
    const checkpointRecordPath = execFileSync(process.execPath, ["scripts/create_competition_run.mjs", "--target", `http://127.0.0.1:${checkpointPort}`, "--approve", "--description", "local checkpoint regression", "--source", record.source_root, "--time-budget", "1", "--action-budget", "20"], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
    try {
      process.env.CTFC_COMPETITION_RUN_RECORD = checkpointRecordPath;
      initializeCompetitionRun();
      const checkpointRoot = await call("http_request", { method: "GET", path: "/", action_kind: "recon", timeout_ms: 5000 });
      const firstSource = await call("list_source", { path: ".", limit: 8 });
      assert.equal(JSON.parse(readFileSync(JSON.parse(readFileSync(checkpointRecordPath, "utf8")).paths.state, "utf8")).analysis_action_count, 1);
      const evidenceBeforeDuplicate = JSON.parse(readFileSync(JSON.parse(readFileSync(checkpointRecordPath, "utf8")).paths.state, "utf8")).evidence_sequence;
      await assert.rejects(() => call("list_source", { path: ".", limit: 8 }), /Duplicate source analysis/);
      const afterDuplicate = JSON.parse(readFileSync(JSON.parse(readFileSync(checkpointRecordPath, "utf8")).paths.state, "utf8"));
      assert.equal(afterDuplicate.analysis_action_count, 1);
      assert.equal(afterDuplicate.evidence_sequence, evidenceBeforeDuplicate);
      await call("read_source", { path: "app.js", offset: 0, limit: 64 });
      await call("run_local_command", { profile: "file", paths: ["app.js"], timeout_ms: 2000 });
      for (let limit = 1; limit <= 22; limit += 1) if (limit !== 8) await call("list_source", { path: ".", limit });
      const cappedState = JSON.parse(readFileSync(JSON.parse(readFileSync(checkpointRecordPath, "utf8")).paths.state, "utf8"));
      assert.equal(cappedState.analysis_action_count, 24);
      assert.equal(cappedState.action_count, 1);
      await assert.rejects(() => call("list_source", { path: ".", limit: 23 }), /Source analysis budget exhausted/);
      const failedLogin = await call("http_request", { method: "POST", path: "/login-failure", action_kind: "login", timeout_ms: 2000 });
      assert.equal(failedLogin.status_code, 500);
      const wrongFailureInspection = await call("inspect_evidence", { evidence_id: checkpointRoot.evidence_id });
      assert.equal(wrongFailureInspection.checkpoint_cleared, undefined);
      await assert.rejects(() => call("http_request", { method: "GET", path: "/authenticated", action_kind: "authenticated_request", timeout_ms: 2000 }), /Inspect required evidence/);
      const failureInspection = await call("inspect_evidence", { evidence_id: failedLogin.evidence_id });
      assert.equal(failureInspection.checkpoint_cleared, "failed_login");
      const mutation = await call("replace_session_cookie", { hypothesis_id: "CheckpointTest", cookie_name: "checkpoint_session", cookie_value: "local-safe-value" });
      const authenticated = await call("http_request", { method: "GET", path: "/authenticated", action_kind: "authenticated_request", timeout_ms: 2000 });
      const mutationInspection = await call("inspect_evidence", { evidence_id: mutation.evidence_id });
      assert.equal(mutationInspection.checkpoint_cleared, undefined);
      await assert.rejects(() => call("http_request", { method: "GET", path: "/after-inspection", action_kind: "authenticated_request", timeout_ms: 2000 }), /Inspect required evidence/);
      const authenticatedInspection = await call("inspect_evidence", { evidence_id: authenticated.evidence_id });
      assert.equal(authenticatedInspection.checkpoint_cleared, "post_session_authenticated");
      const afterInspection = await call("http_request", { method: "GET", path: "/after-inspection", action_kind: "authenticated_request", timeout_ms: 2000 });
      assert.equal(afterInspection.status_code, 200);
      await call("finalize_result", { status: "not_solved", reason_code: "no_progress" });
    } finally {
      process.env.CTFC_COMPETITION_RUN_RECORD = recordPath;
      initializeCompetitionRun();
      await new Promise((resolve) => checkpointServer.close(resolve));
    }
    const users = new Set();
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const form = new URLSearchParams(rawBody);
      const cookie = request.headers.cookie ?? "";
      if (request.method === "GET" && request.url === "/") {
        response.setHeader("content-type", "text/html");
         response.end('<form action="/register" method="POST"><input name="user" value="visible-user"><input name="password"><input name="csrf_token" value="fixture-secret"></form><a href="/login">Login</a><script src="/static/app.js"></script><script>const next = "/dashboard";</script><!-- /strict-form /strict-json /header-check -->' + "x".repeat(1100) + "SAFE_AFTER_1024");
      } else if (request.method === "GET" && request.url === "/static/app.js") {
        response.setHeader("content-type", "application/javascript");
        response.end("window.challenge = true;");
      } else if (request.method === "GET" && request.url === "/login") {
        response.setHeader("content-type", "text/html");
        response.end('<form action="/login" method="POST"><input name="user"><input name="password"></form>');
      } else if (request.method === "POST" && request.url === "/strict-form" && request.headers["content-type"] === "application/x-www-form-urlencoded" && form.get("mode") === "form" && form.get("csrf_token") === "fixture-secret") {
        response.setHeader("content-type", "text/plain");
        response.end("strict-form-ok");
      } else if (request.method === "POST" && request.url === "/strict-json" && request.headers["content-type"] === "application/json" && JSON.parse(rawBody).mode === "json") {
        response.setHeader("content-type", "text/plain");
        response.end("strict-json-ok");
      } else if (request.method === "GET" && request.url === "/header-check") {
        response.setHeader("X-Dev-Access", "yes");
        response.setHeader("X-Custom-Trace", "fixture-secret");
        response.end(`${request.headers["x-dev-access"]}|${request.headers["x-custom-trace"]}`);
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
      process.env.CTFC_COMPETITION_INTERACTIVE = "1";
       await assert.rejects(() => call("list_source", { path: ".", limit: 8 }), /before source analysis/);
       await assert.rejects(() => call("read_source", { path: "app.js", offset: 0, limit: 64 }), /before source analysis/);
       await assert.rejects(() => call("run_local_command", { profile: "file", paths: ["app.js"], timeout_ms: 2000 }), /before source analysis/);
       await assert.rejects(() => call("compute_digest", { algorithm: "md5", text: "fixed digest input", purpose: "before root" }), /before source analysis/);
      const beforeFirstAction = JSON.parse(readFileSync(record.paths.state, "utf8"));
      assert.equal(beforeFirstAction.action_count, 0);
      assert.equal(beforeFirstAction.analysis_action_count, 0);
       const first = await call("http_request", { method: "GET", path: "/", action_kind: "recon", timeout_ms: 5000 });
       assert.equal(first.evidence_id, "e-001", "first HTTP action was not immediate");
       assert.match(first.preview, /form|register/i);
       const digestTool = tool("compute_digest");
       const md5 = await digestTool.execute("digest-md5", { algorithm: "md5", text: "hello", purpose: "derive a deterministic identifier" });
       const sha1 = await digestTool.execute("digest-sha1", { algorithm: "sha1", text: "hello", purpose: "verify a deterministic identifier" });
       const sha256 = await digestTool.execute("digest-sha256", { algorithm: "sha256", text: "hello", purpose: "verify a deterministic identifier" });
       assert.equal(md5.details.digest, "5d41402abc4b2a76b9719d911017c592");
       assert.equal(sha1.details.digest, "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
       assert.equal(sha256.details.digest, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
       for (const result of [md5, sha1, sha256]) assert.match(result.details.digest, /^[0-9a-f]+$/);
       assert.doesNotMatch(JSON.stringify(md5.details), /hello/);
       assert.doesNotMatch(readFileSync(`${record.paths.evidence}/2-e-002.json`, "utf8"), /hello/);
       const digestState = JSON.parse(readFileSync(record.paths.state, "utf8"));
       assert.equal(digestState.action_count, 1);
       assert.equal(digestState.analysis_action_count, 3);
       await assert.rejects(() => digestTool.execute("digest-duplicate", { algorithm: "md5", text: "hello", purpose: "different explanation" }), /Duplicate source analysis/);
       const afterDuplicateDigest = JSON.parse(readFileSync(record.paths.state, "utf8"));
       assert.equal(afterDuplicateDigest.action_count, digestState.action_count);
       assert.equal(afterDuplicateDigest.analysis_action_count, digestState.analysis_action_count);
       assert.equal(afterDuplicateDigest.evidence_sequence, digestState.evidence_sequence);
       const invalidDigestState = JSON.parse(readFileSync(record.paths.state, "utf8"));
       for (const params of [
         { algorithm: "sha512", text: "safe", purpose: "unsupported algorithm" },
         { algorithm: "md5", text: "", purpose: "empty text" },
         { algorithm: "md5", text: "   ", purpose: "whitespace text" },
         { algorithm: "md5", text: "bad\u0000text", purpose: "nul text" },
         { algorithm: "md5", text: "x".repeat(4097), purpose: "oversized text" },
         { algorithm: "md5", text: "safe", purpose: "   " },
         { algorithm: "md5", text: "safe", purpose: "x".repeat(257) },
         { algorithm: "md5", text: "safe", purpose: "bad\u0000purpose" },
         { algorithm: "md5", text: "safe", purpose: "valid", extra: true },
         null,
       ]) await assert.rejects(() => digestTool.execute("digest-invalid", params), /Invalid|Unsupported|Malformed/);
       const afterInvalidDigest = JSON.parse(readFileSync(record.paths.state, "utf8"));
       assert.equal(afterInvalidDigest.action_count, invalidDigestState.action_count);
       assert.equal(afterInvalidDigest.analysis_action_count, invalidDigestState.analysis_action_count);
       assert.equal(afterInvalidDigest.evidence_sequence, invalidDigestState.evidence_sequence);
      const sourceList = await call("list_source", { path: ".", limit: 8 });
      assert.deepEqual(sourceList.entries.map((entry) => entry.path), ["app.js", "nested", "symlink.js"]);
      await assert.rejects(() => call("http_request", { method: "POST", path: "/strict-form", form: { mode: "form" }, evidence_form_fields: { csrf_token: sourceList.evidence_id }, action_kind: "submit", timeout_ms: 2000 }), /not an HTTP response/);
      await assert.rejects(() => call("http_request", { method: "POST", path: "/strict-form", form: { mode: "form" }, evidence_form_fields: { csrf_token: "e-999" }, action_kind: "submit", timeout_ms: 2000 }), /current run/);
      await assert.rejects(() => call("http_request", { method: "POST", path: "/strict-form", form: { mode: "form" }, evidence_form_fields: { missing: first.evidence_id }, action_kind: "submit", timeout_ms: 2000 }), /missing/);
      await assert.rejects(() => call("http_request", { method: "POST", path: "/strict-form", form: { mode: "form" }, evidence_form_fields: { user: first.evidence_id }, action_kind: "submit", timeout_ms: 2000 }), /not hidden/);
      await assert.rejects(() => call("http_request", { method: "POST", path: "/strict-form", form: { mode: "form", csrf_token: "override" }, evidence_form_fields: { csrf_token: first.evidence_id }, action_kind: "submit", timeout_ms: 2000 }), /overrides/);
      await assert.rejects(() => call("http_request", { method: "GET", path: "/strict-form", evidence_form_fields: { csrf_token: first.evidence_id }, action_kind: "recon", timeout_ms: 2000 }), /POST form/);
      await assert.rejects(() => call("http_request", { method: "POST", path: "/strict-form", json: { mode: "form" }, evidence_form_fields: { csrf_token: first.evidence_id }, action_kind: "submit", timeout_ms: 2000 }), /POST form/);
      await assert.rejects(() => call("http_request", { method: "POST", path: "/strict-form", form: { mode: "form" }, evidence_form_fields: { "bad name": first.evidence_id }, action_kind: "submit", timeout_ms: 2000 }), /Invalid evidence form field mapping/);
      const source = await call("read_source", { path: "app.js", offset: 0, limit: 64 });
      assert.match(source.text, /source fixture/);
      await assert.rejects(() => call("read_source", { path: "symlink.js", limit: 64 }), /symlink/i);
       const strictForm = await call("http_request", { method: "POST", path: "/strict-form", form: { mode: "form" }, evidence_form_fields: { csrf_token: first.evidence_id }, action_kind: "submit", timeout_ms: 2000 });
       assert.equal(strictForm.status_code, 200, "form request did not receive its automatic Content-Type");
       assert.doesNotMatch(readFileSync(`${record.paths.evidence}/4-e-004.json`, "utf8"), /fixture-secret/);
      const strictJson = await call("http_request", { method: "POST", path: "/strict-json", json: { mode: "json" }, action_kind: "submit", timeout_ms: 2000 });
      assert.equal(strictJson.status_code, 200, "JSON request did not receive its automatic Content-Type");
      await assert.rejects(() => call("http_request", { method: "POST", path: "/strict-form", form: { mode: "form" }, headers: { "content-type": "application/json" }, action_kind: "submit", timeout_ms: 2000 }), /Conflicting Content-Type/);
      await assert.rejects(() => call("http_request", { method: "POST", path: "/strict-form", form: { mode: "form" }, headers: { "content-type": "text/plain" }, action_kind: "submit", timeout_ms: 2000 }), /Unsafe Content-Type/);
      const headerCheck = await call("http_request", { method: "GET", path: "/header-check", headers: { "X-Dev-Access": "yes", "X-Custom-Trace": "trace-value" }, action_kind: "recon", timeout_ms: 2000 });
      assert.equal(headerCheck.preview, "yes|trace-value");
      const headerInfo = await call("inspect_evidence", { evidence_id: headerCheck.evidence_id });
      assert.equal(headerInfo.response_headers["x-dev-access"], "[REDACTED_SECRET]");
      assert.equal(headerInfo.response_headers["x-custom-trace"], "[REDACTED_SECRET]");
      for (const name of ["host", "cookie", "set-cookie", "authorization", "proxy-authorization", "proxy-test", "connection", "content-length", "transfer-encoding", "upgrade"]) {
        await assert.rejects(() => call("http_request", { method: "GET", path: "/header-check", headers: { [name]: "blocked" }, action_kind: "recon", timeout_ms: 2000 }), /Unsafe request header/);
      }
      await assert.rejects(() => call("http_request", { method: "GET", path: "/header-check", headers: { "X-Bad": "line\r\nvalue" }, action_kind: "recon", timeout_ms: 2000 }), /Unsafe request header/);
      await assert.rejects(() => call("http_request", { method: "GET", path: "/header-check", headers: { ["X-" + "a".repeat(127)]: "value" }, action_kind: "recon", timeout_ms: 2000 }), /Unsafe request header/);
      await assert.rejects(() => call("http_request", { method: "GET", path: "/header-check", headers: { "X-Big": "a".repeat(4097) }, action_kind: "recon", timeout_ms: 2000 }), /Unsafe request header/);
      await assert.rejects(() => call("http_request", { method: "GET", path: "/header-check", headers: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`X-Header-${index}`, "value"])), action_kind: "recon", timeout_ms: 2000 }), /Too many request headers/);
      await assert.rejects(() => call("http_request", { method: "GET", path: "/header-check", headers: { "X-Total": "a".repeat(4090), "X-Total-2": "b".repeat(4090), "X-Total-3": "c".repeat(4090), "X-Total-4": "d".repeat(4090), "X-Total-5": "e" }, action_kind: "recon", timeout_ms: 2000 }), /Unsafe request header/);
      const inspected = await call("inspect_evidence", { evidence_id: first.evidence_id, offset: 0, limit: 4096 });
      await assert.rejects(() => call("inspect_evidence", { evidence_id: "e-999" }), /current run/);
       const longRange = await call("inspect_evidence", { evidence_id: first.evidence_id, offset: 1024, limit: 4096 });
       assert.match(longRange.body.text, /SAFE_AFTER_1024/);
       assert.doesNotMatch(first.preview, /fixture-secret/);
       assert.doesNotMatch(inspected.body.text, /fixture-secret/);
       assert.equal(inspected.forms[0].action, "/register");
       assert.equal(inspected.forms[0].controls[0].value, "visible-user");
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
      delete process.env.CTFC_COMPETITION_INTERACTIVE;
      server.close();
    }
  });
}
