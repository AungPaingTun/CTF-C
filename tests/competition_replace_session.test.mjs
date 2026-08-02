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
    const seenCookies = [];
    const server = createServer((request, response) => {
      seenCookies.push(request.headers.cookie ?? "");
      if (request.method === "POST" && request.url === "/login") {
        response.setHeader("Set-Cookie", "session=guest-session-fixture; Path=/");
        response.end("logged in");
      } else if (request.method === "GET" && request.url === "/sessions") {
        response.end(`session:${adminCookie}, {'_permanent': True, 'key': 'admin'}`);
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

      const login = await call("http_request", { method: "POST", path: "/login", form: { user: "guest", password: "temporary" }, action_kind: "login", timeout_ms: 2000 });
      assert.equal(login.status_code, 200);
      assert.equal(JSON.parse(readFileSync(record.paths.cookies, "utf8")).cookies[0].value, "guest-session-fixture");

      const sessions = await call("http_request", { method: "GET", path: "/sessions", action_kind: "recon", timeout_ms: 2000 });
      const beforeInvalid = state(record).action_count;
      for (const params of [
        { hypothesis_id: "H1", cookie_name: "session", cookie_value: "bad\r\nvalue" },
        { hypothesis_id: "H1", cookie_name: "session", cookie_value: "bad", path: "/../admin" },
        { hypothesis_id: "H1", cookie_name: "session", cookie_value: "bad", domain: "other.example" },
        { hypothesis_id: "H1", cookie_name: "session", cookie_value: "bad", host: "other.example" },
      ]) await assert.rejects(() => call("replace_session_cookie", params));
      await assert.rejects(() => call("http_request", { method: "GET", path: "/", headers: { cookie: "forbidden" }, action_kind: "recon", timeout_ms: 2000 }));
      assert.equal(state(record).action_count, beforeInvalid, "invalid actions consumed budget");

      const replacement = await call("replace_session_cookie", { hypothesis_id: "H1", cookie_name: "session", cookie_value: adminCookie });
      assert.equal(replacement.outcome, "cookie_replaced");
      assert.equal(state(record).action_count, beforeInvalid + 1, "replacement did not consume exactly one action");
      const publicEvidence = readFileSync(`${record.paths.evidence}/3-e-003.json`, "utf8");
      assert.doesNotMatch(publicEvidence, new RegExp(adminCookie));
      assert.doesNotMatch(JSON.stringify(replacement), new RegExp(adminCookie));
      const jar = JSON.parse(readFileSync(record.paths.cookies, "utf8"));
      assert.equal(jar.cookies[0].domain, new URL(record.target_origin).hostname);
      assert.equal(jar.cookies[0].value, adminCookie);

      const homepage = await call("http_request", { method: "GET", path: "/", action_kind: "authenticated_request", timeout_ms: 2000 });
      assert.match(seenCookies.at(-1), new RegExp(`session=${adminCookie}`));
      assert.match(homepage.preview, /\[REDACTED_FLAG\]/);
      assert.match(readFileSync(`${record.paths.private}/4-e-004.body`, "utf8"), /picoCTF\{replace_session_fixture\}/);
      await assert.rejects(() => call("verify_flag", { evidence_id: sessions.evidence_id }), /No matching flag/);
      const verified = await call("verify_flag", { evidence_id: homepage.evidence_id });
      assert.equal(verified.flag, "picoCTF{replace_session_fixture}");
      assert.equal(JSON.parse(readFileSync(record.paths.result, "utf8")).verified, true);
      assert.equal(JSON.parse(readFileSync(record.paths.result, "utf8")).status, "solved");
      assert.ok(existsSync(record.paths.result));
      process.stderr.write("CTF_C_COMPETITION_REPLACE_SESSION=passed\n");
    } finally {
      server.close();
    }
  });
}
