import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

function tool(name) {
  const selected = competitionTools.find((candidate) => candidate.name === name);
  if (!selected) throw new Error(`missing tool: ${name}`);
  return selected;
}

function state(record) {
  return JSON.parse(readFileSync(record.paths.state, "utf8"));
}

export default function (pi) {
  pi.on("session_start", async () => {
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const recordPath = execFileSync(process.execPath, ["scripts/create_competition_run.mjs", "--target", `http://127.0.0.1:${port}`, "--approve", "--description", "planner adaptation fixture", "--time-budget", "1", "--action-budget", "20"], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    process.env.CTFC_COMPETITION_RUN_RECORD = recordPath;
    initializeCompetitionRun();
    const beforeCapability = state(record);
    await assert.rejects(() => tool("list_source").execute("planner-capability", { path: ".", limit: 8 }), /\[UNAVAILABLE_CAPABILITY\]/);
    await assert.rejects(() => tool("list_source").execute("planner-capability-duplicate", { path: ".", limit: 8 }), /already recorded/);
    const afterCapability = state(record);
    assert.equal(afterCapability.action_count, beforeCapability.action_count);
    assert.equal(afterCapability.evidence_sequence, beforeCapability.evidence_sequence);
    assert.equal(afterCapability.unavailable_capabilities.length, 1);
    const transport = await tool("http_request").execute("planner-transport", { method: "GET", path: "/", action_kind: "recon", timeout_ms: 250, reasoning: { evidence_summary: ["The local closed-port fixture is the only transport observation."], leading_hypothesis: "The local closed port may refuse the connection.", supporting_evidence: ["The target is a loopback port that was closed before this request."], experiment: "GET / closed-port transport probe", expected_observation: "A bounded transport failure is recorded.", confidence: 0.5, untested_experiments: [] } });
    assert.equal(transport.details.status_code, null);
    const afterTransport = state(record);
    assert.equal(afterTransport.reasoning.transport_class, "connection_refused");
    assert.notEqual(afterTransport.status, "infrastructure_failure");
    afterTransport.reasoning.current_hypothesis = "The unavailable source branch is retired.";
    afterTransport.reasoning.supporting_evidence = ["The source capability is deterministically unavailable."];
    afterTransport.reasoning.untested_experiments = ["[UNAVAILABLE_CAPABILITY] read supplied source"];
    writeFileSync(record.paths.state, `${JSON.stringify(afterTransport)}\n`);
    initializeCompetitionRun();
    const finalized = await tool("finalize_result").execute("planner-converged", { status: "not_solved", reason_code: "no_progress" });
    assert.equal(finalized.details.status, "not_solved");
    assert.equal(state(record).status, "not_solved");
    process.stderr.write("CTF_C_COMPETITION_PLANNER_ADAPTATION=passed\n");
    if (typeof pi.shutdown === "function") pi.shutdown();
  });
}
