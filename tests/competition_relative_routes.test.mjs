import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

function tool(name) {
  const selected = competitionTools.find((candidate) => candidate.name === name);
  if (!selected) throw new Error(`missing tool: ${name}`);
  return selected;
}

async function call(params) {
  const result = await tool("http_request").execute("relative-route", {
    ...params,
    timeout_ms: params.timeout_ms ?? 2000,
    reasoning: {
      evidence_summary: ["The loopback fixture returned the current route clue."],
      leading_hypothesis: `The route ${params.path} is supported by retained fixture evidence.`,
      supporting_evidence: ["The route is present in the current local response."],
      experiment: params.experiment ?? `${params.method} ${params.path} relative-route fixture request`,
      expected_observation: "The loopback fixture returns a bounded response.",
      confidence: 0.7,
      untested_experiments: [],
    },
  });
  return result.details ?? JSON.parse(result.content[0].text);
}

function state(record) {
  return JSON.parse(readFileSync(record.paths.state, "utf8"));
}

export default function (pi) {
  pi.on("session_start", async () => {
    const server = createServer(async (request, response) => {
      if (request.method === "GET" && request.url === "/") {
        response.setHeader("content-type", "text/html");
        response.end('<form action="upload.php" method="POST" enctype="multipart/form-data"><input type="file" name="image"></form><a href="nested/page">Nested</a><a href="//example.invalid/external">External</a><script src="assets/root.js"></script>');
        return;
      }
      if (request.method === "POST" && (request.url === "/upload.php" || request.url === "/nested/upload.php")) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const raw = Buffer.concat(chunks);
        const valid = /^multipart\/form-data; boundary=/.test(request.headers["content-type"] ?? "") && raw.includes('name="image"') && raw.includes('filename="safe-name.gif"') && raw.includes("GIF89a");
        response.statusCode = valid ? 200 : 400;
        response.end(valid ? "upload-ok" : "upload-invalid");
        return;
      }
      if (request.method === "GET" && request.url === "/nested/page") {
        response.setHeader("Location", "redirected");
        response.setHeader("content-type", "text/html");
        response.end('<form action="upload.php" method="POST" enctype="multipart/form-data"><input type="file" name="image"></form><a href="next">Next</a><script src="assets/app.js"></script><script>fetch(\'api/next.php\')</script>');
        return;
      }
      response.setHeader("content-type", request.url.endsWith(".js") ? "application/javascript" : "text/plain");
      response.end("relative-route-ok");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const target = server.address().port;
    const actualRecordPath = execFileSync(process.execPath, ["scripts/create_competition_run.mjs", "--target", `http://127.0.0.1:${target}`, "--approve", "--description", "relative route fixture", "--time-budget", "1", "--action-budget", "20"], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
    const actualRecord = JSON.parse(readFileSync(actualRecordPath, "utf8"));
    try {
      process.env.CTFC_COMPETITION_RUN_RECORD = actualRecordPath;
      initializeCompetitionRun();
      const root = await call({ method: "GET", path: "/", action_kind: "recon" });
      const rootState = state(actualRecord);
      const rootFile = { source_evidence_id: root.evidence_id, file: { field_name: "image", filename: "safe-name.gif", content_type: "image/gif", content_base64: "R0lGODlh" } };
      await assert.rejects(() => call({ method: "POST", path: "/", action_kind: "submit", multipart: rootFile, experiment: "relative root wrong multipart path" }), /submit POST \/upload\.php/);
      assert.deepEqual(state(actualRecord), rootState);
      const rootUpload = await call({ method: "POST", path: "/upload.php", action_kind: "submit", multipart: rootFile, experiment: "relative root form action" });
      assert.equal(rootUpload.status_code, 200);
      assert.ok(!state(actualRecord).hypothesis_route_paths.includes("/upload.php"));
      const nested = await call({ method: "GET", path: "/nested/page", action_kind: "recon" });
      const inspected = await tool("inspect_evidence").execute("inspect-relative", { evidence_id: nested.evidence_id });
      assert.equal(inspected.details.forms[0].action, "/nested/upload.php");
      assert.ok(inspected.details.links.includes("/nested/next"));
      assert.equal(inspected.details.scripts[0].src, "/nested/assets/app.js");
      const nestedFile = { source_evidence_id: nested.evidence_id, file: rootFile.file };
      const nestedBeforeWrong = state(actualRecord);
      await assert.rejects(() => call({ method: "POST", path: "/nested/page", action_kind: "submit", multipart: nestedFile, experiment: "relative nested wrong multipart path" }), /submit POST \/nested\/upload\.php/);
      assert.deepEqual(state(actualRecord), nestedBeforeWrong);
      const nestedUpload = await call({ method: "POST", path: "/nested/upload.php", action_kind: "submit", multipart: nestedFile, experiment: "relative nested form action" });
      assert.equal(nestedUpload.status_code, 200);
      for (const path of ["/nested/next", "/nested/assets/app.js", "/nested/redirected", "/nested/api/next.php"]) {
        const route = await call({ method: "GET", path, action_kind: "recon", experiment: `relative route ${path}` });
        assert.equal(route.status_code, 200, `${path} was not resolved as a clue`);
      }
      await assert.rejects(() => call({ method: "GET", path: "/external", action_kind: "submit", experiment: "reject external route clue" }), /Rejected HTTP request/);
      process.stderr.write("CTF_C_COMPETITION_RELATIVE_ROUTES=passed\n");
    } finally {
      delete process.env.CTFC_COMPETITION_RUN_RECORD;
      await new Promise((resolve) => server.close(resolve));
    }
    if (typeof pi.shutdown === "function") pi.shutdown();
  });
}
