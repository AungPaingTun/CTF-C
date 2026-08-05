import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function state(record) {
  return JSON.parse(readFileSync(record.paths.state, "utf8"));
}

function tool(name) {
  const selected = competitionTools.find((candidate) => candidate.name === name);
  if (!selected) throw new Error(`missing tool: ${name}`);
  return selected;
}

export default function (pi) {
  let staleChallenge;
  let resolveStaleChallenge;
  const staleChallengeHandled = new Promise((resolve) => { resolveStaleChallenge = resolve; });

  pi.on("session_start", async () => {
    const helper = `${process.cwd()}/scripts/create_competition_run.mjs`;
    const recordPath = execFileSync(process.execPath, [helper, "--target", "http://127.0.0.1:1", "--approve", "--description", "stale runtime fixture"], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    process.env.CTFC_COMPETITION_RUN_RECORD = recordPath;
    initializeCompetitionRun();
    const normal = await tool("compute_digest").execute("normal-runtime", { algorithm: "sha256", text: "normal-runtime", purpose: "P14 unchanged runtime" });
    assert.equal(normal.details.algorithm, "sha256");
    const beforeStaleTool = state(record);
    const launcherPath = `${process.cwd()}/scripts/run_competition.sh`;
    const originalLauncher = readFileSync(launcherPath);
    writeFileSync(launcherPath, Buffer.concat([originalLauncher, Buffer.from("\n# P14 stale-runtime fixture\n")]), { mode: 0o755 });
    try {
      await assert.rejects(() => tool("compute_digest").execute("stale-runtime", { algorithm: "sha256", text: "stale-runtime", purpose: "P14 stale runtime" }), /CTF-C files changed after this Pi session started\. Exit Pi and start a fresh competition session before testing another challenge\./);
      assert.deepEqual(state(record), beforeStaleTool);
      staleChallenge = "P14 CTF stale runtime challenge http://127.0.0.1:2";
      pi.sendUserMessage(staleChallenge);
      await staleChallengeHandled;
      assert.equal(process.env.CTFC_COMPETITION_RUN_RECORD, recordPath);
      assert.deepEqual(state(record), beforeStaleTool);
      const childEnv = { ...process.env };
      delete childEnv.CTFC_COMPETITION_RUN_RECORD;
      const fresh = execFileSync("pi", ["--mode", "rpc", "--no-builtin-tools", "--offline", "--no-session", "--approve", "-e", `${process.cwd()}/tests/competition_runtime_guard_fresh.test.mjs`], { encoding: "utf8", env: childEnv, input: '{"id":"state","type":"get_state"}\n' });
      assert.match(fresh, /CTF_C_COMPETITION_RUNTIME_GUARD_FRESH=passed/);
    } finally {
      writeFileSync(launcherPath, originalLauncher, { mode: 0o755 });
    }
    pi.shutdown();
  });

  pi.on("message_start", async (event) => {
    if (String(event.message?.content ?? "") !== staleChallenge) return;
    await wait(100);
    assert.deepEqual(pi.getActiveTools(), []);
    resolveStaleChallenge();
  });
}
