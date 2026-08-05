import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

const reasoning = {
  evidence_summary: ["The local JSON fixture returned the observed response."],
  leading_hypothesis: "The observed JSON token field contains the flag-bearing response.",
  supporting_evidence: ["The local fixture is the authorized test target."],
  experiment: "GET /json-token",
  expected_observation: "A JSON response is retained and can be verified.",
  confidence: 0.9,
  untested_experiments: [],
};

export default function (pi) {
  pi.on("session_start", async () => {
    const flag = "picoCTF{json_token_fixture}";
    const server = createServer((request, response) => {
      if (request.url === "/json-token") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ token: flag }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const recordPath = execFileSync(process.execPath, ["scripts/create_competition_run.mjs", "--target", `http://127.0.0.1:${port}`, "--approve", "--description", "JSON token redaction regression", "--time-budget", "1", "--action-budget", "4"], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
    process.env.CTFC_COMPETITION_RUN_RECORD = recordPath;
    try {
      initializeCompetitionRun();
      const http = competitionTools.find((tool) => tool.name === "http_request");
      const verify = competitionTools.find((tool) => tool.name === "verify_flag");
      const response = await http.execute("json-token", { method: "GET", path: "/json-token", action_kind: "recon", timeout_ms: 2000, reasoning });
      assert.doesNotMatch(response.details.preview, /json_token_fixture/);
      assert.match(response.details.preview, /REDACTED/);
      const record = JSON.parse(readFileSync(recordPath, "utf8"));
      const privateBody = readFileSync(`${record.paths.private}/1-e-001.body`, "utf8");
      assert.equal(privateBody, JSON.stringify({ token: flag }));
      const verified = await verify.execute("json-token-verify", { evidence_id: response.details.evidence_id });
      assert.equal(verified.details.verified, true);
      assert.equal(verified.details.flag, flag);
    } finally {
      delete process.env.CTFC_COMPETITION_RUN_RECORD;
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
