import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

function tool(name) {
  const selected = competitionTools.find((candidate) => candidate.name === name);
  if (!selected) throw new Error(`missing tool: ${name}`);
  return selected;
}

async function call(name, params) {
  if (name === "http_request") params = { ...params, reasoning: { evidence_summary: ["The session fixture exposes the requested route."], leading_hypothesis: `The route ${params.path} tests the current session hypothesis.`, supporting_evidence: ["The local session fixture is the active evidence source."], experiment: `${params.method} ${params.path} session request`, expected_observation: "The fixture returns a bounded session response.", confidence: 0.5, untested_experiments: [] } };
  const result = await tool(name).execute(`competition-replace-session-${name}`, params);
  return result.details ?? JSON.parse(result.content[0].text);
}

function state(record) {
  return JSON.parse(readFileSync(record.paths.state, "utf8"));
}

export default function (pi) {
  pi.on("session_start", async () => {
    const recordPath = process.env.CTFC_COMPETITION_RUN_RECORD;
    if (!recordPath) throw new Error("replace-session flow requires a private run record");
     const record = JSON.parse(readFileSync(recordPath, "utf8"));
     const adminCookie = "admin-session-fixture-value";
     const guestCookie = "guest-session-fixture";
    const seenCookies = [];
    const server = createServer((request, response) => {
      seenCookies.push(request.headers.cookie ?? "");
       if (request.method === "POST" && request.url === "/register") {
         response.end("registered <a href=\"/login\">login</a>");
       } else if (request.method === "POST" && request.url === "/login") {
         response.setHeader("Set-Cookie", `session=${guestCookie}; Path=/`);
         response.end("logged in <a href=\"/sessions\">sessions</a>");
      } else if (request.method === "GET" && request.url === "/sessions") {
         response.end(`session:${adminCookie}, {'_permanent': True, 'key': 'admin'}<p>session:${guestCookie}, {'_permanent': True, 'key': 'guest'}</p>`);
      } else if (request.method === "GET" && request.url === "/" && request.headers.cookie === `session=${adminCookie}`) {
        response.end("Welcome admin picoCTF{replace_session_fixture}");
      } else {
        response.end("guest");
      }
    });
    await new Promise((resolve) => server.listen(Number(new URL(record.target_origin).port), "127.0.0.1", resolve));
    try {
      initializeCompetitionRun();
      assert.ok(competitionTools.some((candidate) => candidate.name === "replace_session_cookie"));

       const register = await call("http_request", { method: "POST", path: "/register", form: { user: "guest", password: "temporary" }, action_kind: "login", timeout_ms: 2000 });
       assert.equal(register.status_code, 200);
       const login = await call("http_request", { method: "POST", path: "/login", form: { user: "guest", password: "temporary" }, action_kind: "login", timeout_ms: 2000 });
       assert.equal(login.status_code, 200);
       assert.equal(JSON.parse(readFileSync(record.paths.cookies, "utf8")).cookies[0].value, guestCookie);

       const sessions = await call("http_request", { method: "GET", path: "/sessions", action_kind: "recon", timeout_ms: 2000 });
       const beforeInvalid = state(record).action_count;
       for (const params of [
         { evidence_id: sessions.evidence_id, cookie_name: "session", account_key: "missing" },
         { evidence_id: "e-999", cookie_name: "session", account_key: "admin" },
       ]) await assert.rejects(() => call("adopt_session_cookie", params));
       for (const params of [
         { hypothesis_id: "H1", cookie_name: "session", cookie_value: "bad\r\nvalue" },
         { hypothesis_id: "H1", cookie_name: "session", cookie_value: "bad", path: "/../admin" },
         { hypothesis_id: "H1", cookie_name: "session", cookie_value: "bad", domain: "other.example" },
         { hypothesis_id: "H1", cookie_name: "session", cookie_value: "bad", host: "other.example" },
       ]) await assert.rejects(() => call("replace_session_cookie", params));
       await assert.rejects(() => call("http_request", { method: "GET", path: "/", headers: { cookie: "forbidden" }, action_kind: "recon", timeout_ms: 2000 }));
       assert.equal(state(record).action_count, beforeInvalid, "invalid actions consumed budget");

       const adoption = await call("adopt_session_cookie", { evidence_id: sessions.evidence_id, cookie_name: "session", account_key: "admin" });
       assert.equal(adoption.outcome, "cookie_adopted");
       assert.equal(state(record).action_count, beforeInvalid + 1, "adoption did not consume exactly one action");
       const publicEvidence = readFileSync(`${record.paths.evidence}/4-e-004.json`, "utf8");
       assert.doesNotMatch(publicEvidence, new RegExp(adminCookie));
       assert.doesNotMatch(JSON.stringify(adoption), new RegExp(adminCookie));
       assert.doesNotMatch(readFileSync(`${record.paths.evidence}/3-e-003.json`, "utf8"), new RegExp(adminCookie));
       const inspectedSessions = await call("inspect_evidence", { evidence_id: sessions.evidence_id });
       assert.doesNotMatch(JSON.stringify(inspectedSessions), new RegExp(adminCookie));
       assert.match(inspectedSessions.body.text, /REDACTED_SECRET/);
       const jar = JSON.parse(readFileSync(record.paths.cookies, "utf8"));
       assert.equal(jar.cookies[0].domain, new URL(record.target_origin).hostname);
       assert.equal(jar.cookies[0].value, adminCookie);

       const homepage = await call("http_request", { method: "GET", path: "/", action_kind: "authenticated_request", timeout_ms: 2000 });
       assert.match(seenCookies.at(-1), new RegExp(`session=${adminCookie}`));
       assert.match(homepage.preview, /\[REDACTED_FLAG\]/);
       assert.match(readFileSync(`${record.paths.private}/5-e-005.body`, "utf8"), /picoCTF\{replace_session_fixture\}/);
       await assert.rejects(() => call("verify_flag", { evidence_id: sessions.evidence_id }), /No matching flag/);
       const verified = await call("verify_flag", { evidence_id: homepage.evidence_id });
       assert.equal(verified.flag, "picoCTF{replace_session_fixture}");
       assert.equal(verified.verified, true);
       const result = readFileSync(record.paths.result, "utf8");
       assert.doesNotMatch(result, new RegExp(adminCookie));
       assert.doesNotMatch(result, /picoCTF\{replace_session_fixture\}/);
       assert.equal(JSON.parse(result).status, "solved");
      assert.ok(existsSync(record.paths.result));
      process.stderr.write("CTF_C_COMPETITION_REPLACE_SESSION=passed\n");
    } finally {
      server.close();
    }
  });
}
