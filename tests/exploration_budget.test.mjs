import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

function state(record) { return JSON.parse(readFileSync(record.paths.state, "utf8")); }
function http() { return competitionTools.find((candidate) => candidate.name === "http_request"); }
async function request(path, score, justification = "A bounded route hypothesis is supported by the current response.") {
  const reasoning = { evidence_summary: ["The local fixture is the current evidence source."], leading_hypothesis: `The route ${path} may expose a related fact.`, supporting_evidence: ["The active fixture returned a bounded response."], experiment: `GET ${path} exploration`, expected_observation: "A bounded response or new route clue is returned.", confidence: 0.5, untested_experiments: [], ...(score === undefined ? {} : { exploration_score: score, exploration_justification: justification, route_family: "other" }) };
  const result = await http().execute(`exploration-${path}`, { method: "GET", path, action_kind: "recon", timeout_ms: 2000, reasoning });
  return result.details ?? JSON.parse(result.content[0].text);
}

export default function (pi) {
  pi.on("session_start", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/") return response.end('<a href="/derived">derived route</a>');
      if (request.url === "/derived") return response.end("derived response");
      if (request.url === "/meaningful") return response.end('<a href="/new-fact">new fact</a>');
      response.writeHead(404); response.end("not found");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const target = `http://127.0.0.1:${address.port}`;
    const recordPath = execFileSync(process.execPath, ["scripts/create_competition_run.mjs", "--target", target, "--approve", "--description", "exploration budget fixture", "--time-budget", "1", "--action-budget", "20"], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    process.env.CTFC_COMPETITION_RUN_RECORD = recordPath;
    initializeCompetitionRun();
    try {
      await request("/");
      assert.equal(state(record).exploration_budget_used, 0, JSON.stringify(state(record)));
      await request("/derived");
      assert.equal(state(record).exploration_budget_used, 0, JSON.stringify(state(record)));
      await assert.rejects(() => request("/low-score", 0.2), /score must be at least 0.3/);
      const beforeUnknown = state(record);
      await request("/unknown", 0.5);
      assert.equal(state(record).exploration_budget_used, beforeUnknown.exploration_budget_used + 1, JSON.stringify(state(record)));
      const beforeMeaningful = state(record);
      await request("/meaningful", 0.5);
      const afterMeaningful = state(record);
      assert.equal(afterMeaningful.exploration_budget_used, beforeMeaningful.exploration_budget_used, JSON.stringify(afterMeaningful));
      assert.equal(afterMeaningful.exploration_budget_remaining, beforeMeaningful.exploration_budget_remaining, JSON.stringify(afterMeaningful));
      assert.equal(afterMeaningful.exploration_log.at(-1).outcome, "refunded");
      for (const path of ["/exhaust-one", "/exhaust-two", "/exhaust-three", "/exhaust-four"]) await request(path, 0.5);
      assert.equal(state(record).exploration_budget_remaining, 0, JSON.stringify(state(record)));
      await assert.rejects(() => request("/exhaust-five", 0.5), /exploration budget is exhausted/);
      process.stderr.write("CTF_C_EXPLORATION_BUDGET=passed\n");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      delete process.env.CTFC_COMPETITION_RUN_RECORD;
    }
  });
}
