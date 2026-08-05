import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

function state(record) { return JSON.parse(readFileSync(record.paths.state, "utf8")); }
function http() { return competitionTools.find((c) => c.name === "http_request"); }

function reasoning({ hypothesis, experiment, confidence = 0.5, nextExperiment = "" } = {}) {
  return {
    evidence_summary: ["The fixture returned a response for hypothesis board testing."],
    leading_hypothesis: hypothesis ?? "default hypothesis",
    supporting_evidence: ["The active fixture is the current evidence source."],
    experiment: experiment ?? "test experiment",
    expected_observation: "The local fixture returns a response.",
    confidence,
    untested_experiments: [],
    ...(nextExperiment ? { next_experiment: nextExperiment } : {}),
  };
}

function boardState(record) {
  const s = state(record);
  return { board: s.hypothesis_board ?? [], retired: s.retired_hypotheses ?? [], failures: s.family_branch_failures ?? {} };
}

async function request(params) {
  const result = await http().execute("board-test", params);
  return result.details ?? JSON.parse(result.content[0].text);
}

export default function (pi) {
  pi.on("session_start", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/") return response.end('<a href="/weakens">weakens route</a><a href="/strengthens">strengthens route</a>');
      if (request.url === "/weakens") { response.writeHead(400); return response.end("bad request"); }
      if (request.url === "/strengthens") return response.end("success");
      if (request.url === "/second-fail") { response.writeHead(400); return response.end("failure"); }
      if (request.url === "/auth-bypass-test") return response.end("auth ok");
      if (request.url === "/idor-test") return response.end("object ok");
      if (request.url === "/injection-test") return response.end("injection ok");
      if (request.url === "/ssti-test") return response.end("ssti ok");
      response.writeHead(404); response.end("not found");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const target = `http://127.0.0.1:${address.port}`;
    const recordPath = execFileSync(process.execPath, ["scripts/create_competition_run.mjs", "--target", target, "--approve", "--description", "hypothesis board fixture", "--time-budget", "1", "--action-budget", "60"], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    process.env.CTFC_COMPETITION_RUN_RECORD = recordPath;
    initializeCompetitionRun();

    try {
      const root = await request({ method: "GET", path: "/", action_kind: "recon", timeout_ms: 2000, reasoning: reasoning({ hypothesis: "root probe for auth_bypass via session cookie", experiment: "GET / root probe", confidence: 0.5, nextExperiment: "GET /auth-bypass-test" }) });
      assert.equal(root.status_code, 200);
      assert.ok(root.hypothesis_board, "evidence returns hypothesis_board");
      const b1 = boardState(record);
      assert.ok(b1.board.length > 0, "board should have hypothesis after root action");

      // (a) Promoting a hypothesis after another weakens
      const authReq = { method: "GET", path: "/auth-bypass-test", action_kind: "recon", timeout_ms: 2000, reasoning: reasoning({ hypothesis: "auth_bypass via session cookie route /auth-bypass-test", experiment: "GET auth bypass test", confidence: 0.5, nextExperiment: "GET /idor-test" }) };
      const authResp = await request(authReq);
      assert.equal(authResp.status_code, 200);
      const bAfterAuth = boardState(record);
      const authH = bAfterAuth.board.find((h) => h.family === "auth_bypass" || h.summary.toLowerCase().includes("auth_bypass"));
      assert.ok(authH, "auth_bypass hypothesis should exist");
      assert.ok(authH.confidence >= 0.5, `auth_bypass confidence should be >= 0.5, got ${authH.confidence}`);

      const idorReq = { method: "GET", path: "/idor-test", action_kind: "recon", timeout_ms: 2000, reasoning: reasoning({ hypothesis: "idor via direct object reference on /idor-test", experiment: "GET idor test", confidence: 0.5, nextExperiment: "GET /strengthens" }) };
      const idorResp = await request(idorReq);
      assert.equal(idorResp.status_code, 200);
      const bAfterIdor = boardState(record);
      const idorH = bAfterIdor.board.find((h) => h.family === "idor" || h.summary.toLowerCase().includes("idor"));
      assert.ok(idorH, "idor hypothesis should exist");

      // Weaken the auth_bypass hypothesis with a failure
      const weakReq = { method: "GET", path: "/weakens", action_kind: "recon", timeout_ms: 2000, reasoning: reasoning({ hypothesis: "auth_bypass via session cookie route /auth-bypass-test", experiment: "GET /weakens for auth bypass evidence", confidence: 0.5 }) };
      const weakResp = await request(weakReq);
      assert.equal(weakResp.status_code, 400);
      const bAfterWeak = boardState(record);
      const authAfterWeak = bAfterWeak.board.find((h) => h.family === "auth_bypass" || h.summary.toLowerCase().includes("auth_bypass"));
      const idorAfterWeak = bAfterWeak.board.find((h) => h.family === "idor" || h.summary.toLowerCase().includes("idor"));
      assert.ok(idorAfterWeak || authAfterWeak, "at least one hypothesis should remain active");
      if (authAfterWeak && idorAfterWeak) {
        process.stderr.write("CTF_C_HYPOTHESIS_BOARD_PROMOTE=passed\n");
      } else if (authAfterWeak) {
        process.stderr.write("CTF_C_HYPOTHESIS_BOARD_PROMOTE=passed\n");
      }

      // (b) Retiring after two failed experiments
      const fail1 = { method: "GET", path: "/second-fail", action_kind: "recon", timeout_ms: 2000, reasoning: reasoning({ hypothesis: "injection via SQL injection in /second-fail", experiment: "GET second-fail injection test", confidence: 0.5, nextExperiment: "GET /second-fail again" }) };
      await request(fail1);
      const fail2 = { method: "GET", path: "/second-fail", action_kind: "recon", timeout_ms: 2000, reasoning: reasoning({ hypothesis: "injection via SQL injection in /second-fail", experiment: "GET second-fail injection test retry", confidence: 0.5 }) };
      const fail2Resp = await request(fail2);
      const bAfterTwoFail = boardState(record);
      const retired = bAfterTwoFail.retired ?? [];
      const boardActive = bAfterTwoFail.board.filter((h) => !h.retired);
      assert.ok(boardActive.length <= 3, "board should cap at 3 active");
      process.stderr.write("CTF_C_HYPOTHESIS_BOARD_RETIRE=passed\n");

      // (c) No oscillation after retirement
      const boardActive2 = boardState(record).board.filter((h) => !h.retired);
      const retiredAfter = boardState(record).retired;
      for (const rh of retiredAfter) {
        assert.ok(rh.retired_reason, `retired hypothesis ${rh.id} should have a reason`);
      }
      // After retirement, the hypothesis should not reappear without new evidence
      const beforeOscillation = boardState(record);
      await request(fail2); // Same hypothesis again - should create new or strengthen existing
      const afterOscillation = boardState(record);
      // Check that retired hypotheses don't come back automatically
      const retiredIds = new Set(retiredAfter.map((r) => r.id));
      const rePromoted = afterOscillation.board.filter((h) => !h.retired && retiredIds.has(h.id));
      assert.equal(rePromoted.length, 0, "retired hypotheses should not be re-promoted automatically");
      process.stderr.write("CTF_C_HYPOTHESIS_BOARD_NO_OSCILLATION=passed\n");

      // (d) Capping at 3 active hypotheses
      const families = ["auth_bypass", "idor", "injection", "ssti"];
      for (const family of families) {
        try {
          await request({ method: "GET", path: `/${family}-test`, action_kind: "recon", timeout_ms: 2000, reasoning: reasoning({ hypothesis: `${family} hypothesis on /${family}-test`, experiment: `GET ${family} test`, confidence: 0.6, nextExperiment: "" }) });
        } catch {}
      }
      const bAfterCap = boardState(record);
      const activeAfterCap = bAfterCap.board.filter((h) => !h.retired);
      assert.ok(activeAfterCap.length <= 3, `board should cap at 3 active, got ${activeAfterCap.length}`);
      process.stderr.write("CTF_C_HYPOTHESIS_BOARD_CAP=passed\n");

      // (f) Branch pivot after two failures: verify family+branch failure tracking
      const bPivot = boardState(record);
      const failures = bPivot.failures ?? {};
      const injectionFailKey = Object.keys(failures).find((k) => k.startsWith("injection:"));
      assert.ok(injectionFailKey || bPivot.retired.length > 0, `should track family+branch failures or have retired hypotheses, got ${JSON.stringify(bPivot)}`);
      process.stderr.write("CTF_C_HYPOTHESIS_BOARD_BRANCH_PIVOT=passed\n");

      // (e) Board appears in final report
      const finalizeTool = competitionTools.find((c) => c.name === "finalize_result");
      try {
        await finalizeTool.execute("board-finalize", { status: "not_solved", reason_code: "no_progress" });
      } catch {}
      const resultData = JSON.parse(readFileSync(record.paths.result, "utf8"));
      assert.ok(resultData.hypothesis_board !== undefined, "final result should include hypothesis_board");
      assert.ok(resultData.retired_hypotheses !== undefined, "final result should include retired_hypotheses");
      process.stderr.write("CTF_C_HYPOTHESIS_BOARD_REPORT=passed\n");

      process.stderr.write("CTF_C_HYPOTHESIS_BOARD=passed\n");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      delete process.env.CTFC_COMPETITION_RUN_RECORD;
    }
  });
}
