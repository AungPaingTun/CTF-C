import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { competitionTools, extractCompetitionTarget } from "../.pi/extensions/ctf-c-stage2-core.mjs";

const expectedTools = ["http_request", "websocket_exchange", "inspect_evidence", "list_source", "read_source", "search_source", "compute_digest", "derive_binary_evidence", "run_local_command", "replace_session_cookie", "adopt_session_cookie", "verify_flag", "finalize_result"];
const inputRoot = mkdtempSync(join(tmpdir(), "ctf-c-competition-input-root-"));
const inputFile = join(inputRoot, "app.py");
writeFileSync(inputFile, "print('automatic source')\n");
const challenge = `Challenge description. Find the flag.\nhttp://127.0.0.1:9/login\nSupplied file: ${inputFile}\nFind the flag.`;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export default function (pi) {
  pi.on("session_start", () => {
    process.env.CTFC_COMPETITION_INPUT_ROOTS = inputRoot;
    assert.equal(extractCompetitionTarget(challenge).origin, "http://127.0.0.1:9");
    assert.throws(() => extractCompetitionTarget("Find the flag."), /No HTTP\/HTTPS target URL/);
    assert.throws(() => extractCompetitionTarget("Challenge http://one.example/a http://two.example/b"), /Multiple distinct/);
    assert.throws(() => extractCompetitionTarget("Challenge http://user:pass@example.test/login"), /credentials/);
    assert.throws(() => extractCompetitionTarget("Challenge http://example.test/login#flag"), /fragments/);
    assert.throws(() => extractCompetitionTarget("Challenge http://example.test/a http://example.test/b"), /Multiple distinct/);
    pi.sendUserMessage(challenge);
  });

  pi.on("message_start", async (event) => {
    if (event.message?.role !== "user" || !String(event.message.content).includes("127.0.0.1:9")) return;
    await wait(100);
    const recordPath = process.env.CTFC_COMPETITION_RUN_RECORD;
    assert.ok(recordPath, "interactive initialization did not set a run record");
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    assert.equal(record.target_origin, "http://127.0.0.1:9");
    assert.equal(record.description, challenge);
    assert.equal(record.approved, true);
    assert.equal(record.action_budget, 60);
    assert.equal(statSync(record.paths.run_root).mode & 0o777, 0o700);
    assert.equal(statSync(recordPath).mode & 0o777, 0o600);
    assert.equal(statSync(record.paths.private).mode & 0o777, 0o700);
    assert.ok(record.source_root?.startsWith(record.paths.run_root), "automatic source root was not registered");
    assert.equal(readFileSync(join(record.source_root, "app.py")).toString(), "print('automatic source')\n");
    const listed = await competitionTools.find((tool) => tool.name === "list_source").execute("automatic-list", { path: ".", limit: 8 });
    assert.ok(listed.details.entries.some((entry) => entry.path === "app.py"), "ingested file was not listed by source tools");
    const read = await competitionTools.find((tool) => tool.name === "read_source").execute("automatic-read", { path: "app.py", limit: 64 });
    assert.match(read.details.text, /automatic source/);
    const search = await competitionTools.find((tool) => tool.name === "search_source").execute("automatic-search", { path: ".", query: "automatic source" });
    assert.equal(search.details.matches[0].path, "app.py");
    assert.equal(search.details.matches[0].line, 1);
    assert.deepEqual(readdirSync(process.env.CTFC_COMPETITION_RUNTIME_ROOT).filter((entry) => entry.startsWith("run-")), [record.paths.run_root.split("/").at(-1)]);
    const state = JSON.parse(readFileSync(record.paths.state, "utf8"));
    assert.equal(state.status, "active");
    assert.deepEqual(new Set(pi.getActiveTools()), new Set(expectedTools));
    assert.equal(pi.getActiveTools().includes("start_competition_run"), false);
    assert.equal(pi.getActiveTools().includes("read"), false);
    assert.equal(pi.getActiveTools().includes("bash"), false);
    assert.equal(pi.getActiveTools().includes("edit"), false);
    assert.equal(pi.getActiveTools().includes("write"), false);
    assert.equal(competitionTools.some((tool) => tool.name === "start_competition_run"), true);
    const startTool = competitionTools.find((tool) => tool.name === "start_competition_run");
    await assert.rejects(() => startTool.execute("duplicate-start", { challenge_text: challenge }), /already active/);
    delete process.env.CTFC_COMPETITION_INPUT_ROOTS;
    rmSync(inputRoot, { recursive: true, force: true });
    pi.shutdown();
  });
}
