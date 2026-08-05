import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

export default function (pi) {
  pi.on("session_start", async () => {
    const helper = `${process.cwd()}/scripts/create_competition_run.mjs`;
    const recordPath = execFileSync(process.execPath, [helper, "--target", "http://127.0.0.1:1", "--approve", "--description", "fresh runtime fixture"], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
    process.env.CTFC_COMPETITION_RUN_RECORD = recordPath;
    initializeCompetitionRun();
    const digest = await competitionTools.find((tool) => tool.name === "compute_digest").execute("fresh-runtime", { algorithm: "sha256", text: "fresh-runtime", purpose: "P14 fresh session" });
    assert.equal(digest.details.algorithm, "sha256");
    process.stderr.write("CTF_C_COMPETITION_RUNTIME_GUARD_FRESH=passed\n");
    pi.shutdown();
  });
}
