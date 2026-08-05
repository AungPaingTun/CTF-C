import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

const xml = '<?xml version="1.0"?><!DOCTYPE data><data><ID>fixture</ID></data>';
const reasoning = (path) => ({ evidence_summary: ["The local fixture exposed the XML route."], leading_hypothesis: "The observed route parses the supplied XML body.", supporting_evidence: ["The route is linked by the local fixture response."], experiment: `POST ${path} raw XML`, expected_observation: "The fixture receives the exact XML and XML Content-Type.", confidence: 0.8, untested_experiments: [] });

export default function (pi) {
  pi.on("session_start", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/") {
        response.end('<a href="/data">XML endpoint</a><a href="/data-soap">SOAP endpoint</a>');
        return;
      }
      if (request.method === "POST" && ["/data", "/data-soap"].includes(request.url)) {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const expectedType = request.url === "/data" ? "application/xml" : "application/soap+xml; charset=utf-8";
          const ok = request.headers["content-type"] === expectedType && body === xml;
          response.writeHead(ok ? 200 : 415, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok }));
        });
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const recordPath = execFileSync(process.execPath, ["scripts/create_competition_run.mjs", "--target", `http://127.0.0.1:${port}`, "--approve", "--description", "raw XML request regression", "--time-budget", "1", "--action-budget", "8"], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
    process.env.CTFC_COMPETITION_RUN_RECORD = recordPath;
    try {
      initializeCompetitionRun();
      const http = competitionTools.find((tool) => tool.name === "http_request");
      const root = await http.execute("xml-root", { method: "GET", path: "/", action_kind: "recon", timeout_ms: 2000, reasoning: reasoning("/") });
      await assert.rejects(() => http.execute("xml-bad-type", { method: "POST", path: "/data", action_kind: "submit", raw_xml: xml, headers: { "content-type": "application/json" }, timeout_ms: 2000, reasoning: reasoning("/data") }), /Raw XML requires an XML Content-Type/);
      const appXml = await http.execute("xml-app", { method: "POST", path: "/data", action_kind: "submit", raw_xml: xml, timeout_ms: 2000, reasoning: reasoning("/data") });
      assert.equal(appXml.details.status_code, 200);
      assert.equal(appXml.details.preview, '{"ok":true}');
      const soapXml = await http.execute("xml-soap", { method: "POST", path: "/data-soap", action_kind: "submit", raw_xml: xml, headers: { "content-type": "application/soap+xml; charset=utf-8" }, timeout_ms: 2000, reasoning: reasoning("/data-soap") });
      assert.equal(soapXml.details.status_code, 200);
      const record = JSON.parse(readFileSync(recordPath, "utf8"));
      const evidence = JSON.parse(readFileSync(`${record.paths.evidence}/2-e-002.json`, "utf8"));
      assert.match(evidence.request.body_hash, /^[0-9a-f]{64}$/);
      assert.doesNotMatch(JSON.stringify(evidence), /<!DOCTYPE|<data>/);
      assert.equal(root.details.status_code, 200);
    } finally {
      delete process.env.CTFC_COMPETITION_RUN_RECORD;
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
