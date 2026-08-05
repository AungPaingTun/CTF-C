import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

const flag = "picoCTF{derived_base64_fixture}";
const reasoning = (path) => ({ evidence_summary: ["The local fixture exposed the encoded response route."], leading_hypothesis: "The retained encoded response decodes to the flag.", supporting_evidence: ["The route is linked by the local fixture."], experiment: `GET ${path}`, expected_observation: "The response is retained for bounded derivation.", confidence: 0.8, untested_experiments: [] });

export default function (pi) {
  pi.on("session_start", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/") return response.end('<a href="/encoded">encoded response</a>');
      if (request.url === "/encoded") return response.end(Buffer.from(flag).toString("base64"));
      response.writeHead(404);
      response.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const recordPath = execFileSync(process.execPath, ["scripts/create_competition_run.mjs", "--target", `http://127.0.0.1:${port}`, "--approve", "--description", "derived flag regression", "--time-budget", "1", "--action-budget", "8"], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
    process.env.CTFC_COMPETITION_RUN_RECORD = recordPath;
    try {
      initializeCompetitionRun();
      const http = competitionTools.find((tool) => tool.name === "http_request");
      const digest = competitionTools.find((tool) => tool.name === "compute_digest");
      const verify = competitionTools.find((tool) => tool.name === "verify_flag");
      await http.execute("derived-root", { method: "GET", path: "/", action_kind: "recon", timeout_ms: 2000, reasoning: reasoning("/") });
      const encoded = await http.execute("derived-http", { method: "GET", path: "/encoded", action_kind: "recon", timeout_ms: 2000, reasoning: reasoning("/encoded") });
      const encodedValue = Buffer.from("fixture").toString("base64");
      const decoded = await digest.execute("base64-decode", { algorithm: "base64_decode", text: encodedValue, purpose: "derive a bounded fixture value" });
      assert.equal(decoded.details.value, "fixture");
      const encodedAgain = await digest.execute("base64-encode", { algorithm: "base64_encode", text: "fixture", purpose: "encode a bounded fixture value" });
      assert.equal(encodedAgain.details.value, Buffer.from("fixture").toString("base64"));
      const verified = await verify.execute("derived-verify", { evidence_id: encoded.details.evidence_id, derivation: { source_evidence_id: encoded.details.evidence_id, operation: "base64_decode" } });
      assert.equal(verified.details.verified, true);
      assert.equal(verified.details.flag, flag);
    } finally {
      delete process.env.CTFC_COMPETITION_RUN_RECORD;
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
