import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { competitionTools, initializeCompetitionRun, websocketUrlForTarget } from "../.pi/extensions/ctf-c-stage2-core.mjs";
import { startP10Fixture } from "./fixtures/p10-websocket.mjs";

const tool = (name) => competitionTools.find((candidate) => candidate.name === name);
const reasoning = (path, experiment = `test ${path}`) => ({
  evidence_summary: ["The local fixture returned an observed protocol clue."],
  leading_hypothesis: `The observed WebSocket route ${path} accepts the evidence-derived exchange.`,
  supporting_evidence: ["The active local fixture exposed the route and protocol transition."],
  experiment,
  expected_observation: "The local fixture returns a bounded text response.",
  confidence: 0.8,
  untested_experiments: [],
});

export default function (pi) {
  pi.on("session_start", async () => {
  const fixture = await startP10Fixture();
  const recordPath = execFileSync(process.execPath, ["scripts/create_competition_run.mjs", "--target", fixture.origin, "--approve", "--description", "local P10 websocket fixture", "--time-budget", "1", "--action-budget", "12"], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
  process.env.CTFC_COMPETITION_RUN_RECORD = recordPath;
  try {
    initializeCompetitionRun();
    assert.equal(websocketUrlForTarget("http://example.test", "/ws/").protocol, "ws:");
    assert.equal(websocketUrlForTarget("https://example.test", "/ws/").protocol, "wss:");

    const http = tool("http_request");
    const websocket = tool("websocket_exchange");
    const verify = tool("verify_flag");
    const root = await http.execute("p10-root", { method: "GET", path: "/", action_kind: "recon", timeout_ms: 2000, reasoning: reasoning("/", "root discovery") });
    const rootDetails = root.details;
    const beforeInvalid = JSON.parse(readFileSync(JSON.parse(readFileSync(recordPath, "utf8")).paths.state, "utf8"));
    for (const path of ["//evil.test/ws/", "//evil.test:9/ws/", "ws://evil.test/ws/", "/../ws/"]) {
      await assert.rejects(() => websocket.execute("p10-invalid", { path, messages: ["runtime:ready"], reasoning: reasoning(path) }), /Unsafe|traversal|retained HTTP evidence/);
    }
    const afterInvalid = JSON.parse(readFileSync(JSON.parse(readFileSync(recordPath, "utf8")).paths.state, "utf8"));
    assert.equal(afterInvalid.action_count, beforeInvalid.action_count);
    assert.equal(afterInvalid.evidence_sequence, beforeInvalid.evidence_sequence);

    const upgrade = await http.execute("p10-upgrade", { method: "GET", path: "/ws/", action_kind: "recon", timeout_ms: 2000, reasoning: reasoning("/ws/", "validate the observed upgrade route") });
    assert.equal(upgrade.details.status_code, 426);
    const timeout = await websocket.execute("p10-timeout", { path: "/ws/", messages: ["runtime:slow"], timeout_ms: 250, reasoning: reasoning("/ws/", "timeout bound") });
    assert.equal(timeout.details.outcome, "timeout");
    const receivedCount = await websocket.execute("p10-received-count", { path: "/ws/", messages: ["runtime:many"], timeout_ms: 2000, max_messages: 1, close_after_receive: false, reasoning: reasoning("/ws/", "received message count bound") });
    assert.equal(receivedCount.details.received_message_count, 1);
    const receivedSize = await websocket.execute("p10-received-size", { path: "/ws/", messages: ["runtime:large"], timeout_ms: 2000, reasoning: reasoning("/ws/", "received message size bound") });
    assert.equal(receivedSize.details.outcome, "protocol_error");
    const exchange = await websocket.execute("p10-exchange", { path: "/ws/", messages: ["runtime:ready"], timeout_ms: 3000, max_messages: 2, close_after_receive: true, reasoning: reasoning("/ws/", "send the exact message grammar exposed by retained JavaScript") });
    assert.equal(exchange.details.outcome, "completed");
    assert.equal(exchange.details.sent_message_count, 1);
    assert.equal(exchange.details.received_message_count, 1);
    assert.equal(exchange.details.evidence_source_id, rootDetails.evidence_id);
    assert.doesNotMatch(JSON.stringify(exchange.details), /p10_session|set-cookie|cookie/i);

    await assert.rejects(() => websocket.execute("p10-binary", { path: "/ws/", messages: [new Uint8Array([1])], reasoning: reasoning("/ws/", "binary rejection") }), /Invalid WebSocket messages/);
    await assert.rejects(() => websocket.execute("p10-many", { path: "/ws/", messages: Array.from({ length: 9 }, () => "x"), reasoning: reasoning("/ws/", "message bound rejection") }), /Invalid WebSocket messages/);
    await assert.rejects(() => websocket.execute("p10-long", { path: "/ws/", messages: ["x".repeat(4097)], reasoning: reasoning("/ws/", "message length rejection") }), /Invalid WebSocket messages/);

    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    const publicEvidence = readFileSync(`${record.paths.evidence}/${Number(exchange.details.evidence_id.slice(2))}-${exchange.details.evidence_id}.json`, "utf8");
    assert.doesNotMatch(publicEvidence, /runtime:ready|p10_session|set-cookie/i);
    const verified = await verify.execute("p10-verify", { evidence_id: exchange.details.evidence_id });
    assert.equal(verified.details.verified, true);
    assert.match(verified.details.flag, /^picoCTF\{p10_[0-9a-f]+\}$/);
  } finally {
    await fixture.stop();
    delete process.env.CTFC_COMPETITION_RUN_RECORD;
  }
  });
}
