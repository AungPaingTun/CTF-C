import { createServer } from "node:http";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStage3Manifest } from "../scripts/create_stage3_manifest.mjs";
import { beginInvestigation, stage2Tools } from "../.pi/extensions/ctf-c-stage2-core.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

function tool(name) {
  const selected = stage2Tools.find((candidate) => candidate.name === name);
  if (!selected) throw new Error(`missing tool: ${name}`);
  return selected;
}

async function call(name, params) {
  const result = await tool(name).execute(`coordinator-test-${name}`, params);
  return result.details ?? JSON.parse(result.content[0].text);
}

async function rejects(action, pattern, message) {
  try { await action(); } catch (error) {
    assert(error instanceof Error && pattern.test(error.message), `${message}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  throw new Error(`${message}: operation succeeded`);
}

export default function (pi) {
  pi.on("session_start", async () => {
    const server = createServer((request, response) => {
      if (request.method !== "GET" || !request.url?.startsWith("/step?")) { response.statusCode = 404; response.end("not found"); return; }
      const n = new URL(request.url, "http://127.0.0.1").searchParams.get("n");
      response.end(n === "10" ? "picoCTF{coordinator_fixture}" : `step-${n}`);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("coordinator fixture did not bind");
    const slug = `stage2-coordinator-${process.pid}`;
    const challengeRoot = join(process.cwd(), "challenges", slug);
    const runtimeRoot = mkdtempSync(join(tmpdir(), "ctf-c-stage2-coordinator-"));
    mkdirSync(join(process.cwd(), "challenges"), { recursive: true });
    cpSync(join(process.cwd(), "tests", "fixtures", "stage2-web"), challengeRoot, { recursive: true });
    const manifest = createStage3Manifest({ projectRoot: process.cwd(), slug, target: `http://127.0.0.1:${address.port}/`, approved: true, runtimeRoot });
    process.env.CTFC_STAGE2_MANIFEST = manifest.paths.manifest;
    try {
      const started = beginInvestigation(slug);
      assert(started.state === "ready", "coordinator did not begin investigation first");
      await rejects(() => call("record_hypotheses", { hypotheses: [{ id: "H1", rank: 1, confidence: 2, statement: "bad", evidence_refs: ["source/app.js"] }] }), /confidence/, "invalid confidence was accepted");
      await rejects(() => call("record_hypotheses", { hypotheses: [{ id: "H1", rank: 1, confidence: 0.9, statement: "one", evidence_refs: ["source/app.js"] }, { id: "H1", rank: 2, confidence: 0.5, statement: "two", evidence_refs: ["source/app.js"] }] }), /unique/, "duplicate hypothesis IDs were accepted");
      await rejects(() => call("http_request", { hypothesis_id: "unknown", method: "GET", path: "/step", query: { n: "0" }, action_kind: "recon", timeout_ms: 2000 }), /Unknown or unrecorded hypothesis/, "unrecorded hypothesis performed an action");
      await call("record_hypotheses", { hypotheses: [{ id: "H1", rank: 1, confidence: 0.9, statement: "The fixture reveals the flag after sequential bounded requests.", evidence_refs: ["tests/fixtures/stage2-web/source/app.js"], local_test: "Inspect the deterministic step endpoint.", proposed_remote_action: { action_kind: "recon", method: "GET", path: "/step" } }] });
      for (let index = 1; index <= 10; index += 1) {
        const evidence = await call("http_request", { hypothesis_id: "H1", method: "GET", path: "/step", query: { n: String(index) }, action_kind: "recon", timeout_ms: 2000 });
        assert(evidence.evidence_id === `e-${String(index).padStart(3, "0")}`, "evidence sequence was not monotonic");
      }
      await rejects(() => call("finalize_result", { status: "solved", reason: "missing verification", verified_evidence_id: "e-010" }), /Solved requires verified evidence/, "solved finalized without verification");
      const verification = await call("verify_flag", { evidence_id: "e-010" });
      assert(verification.verified === true, "coordinator failed to verify final evidence");
      const final = await call("finalize_result", { status: "solved", reason: "verified coordinator fixture", verified_evidence_id: "e-010" });
      assert(final.status === "solved" && final.action_count === 10, "coordinator final state was incorrect");
      await rejects(() => call("http_request", { hypothesis_id: "H1", method: "GET", path: "/step", query: { n: "11" }, action_kind: "recon", timeout_ms: 2000 }), /finalized/, "action ran after finalization");
      process.stderr.write("CTF_C_COORDINATOR=passed\n");
    } finally {
      delete process.env.CTFC_STAGE2_MANIFEST;
      server.close();
      rmSync(challengeRoot, { recursive: true, force: true });
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
}
