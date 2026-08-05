import assert from "node:assert/strict";
import { finalOutput, liveLine } from "../scripts/competition_output.mjs";

const solved = finalOutput({
  status: "solved",
  startedAt: 1000,
  finishedAt: 11234,
  actionCount: 3,
  toolCalls: 7,
  evidenceCount: 3,
  flag: "picoCTF{verified}",
  lastProgress: "Flag verified",
  resumeFrom: "e-003",
});
assert.equal(solved, "Status: SOLVED\nElapsed: 10.2\nHTTP actions: 3\nTool calls: 7\nEvidence items: 3\nFlag: picoCTF{verified}\nLast progress: Flag verified\nResume from: e-003\n");
assert.doesNotMatch(solved, /Failure reason:/);

const failed = finalOutput({
  status: "timeout",
  startedAt: 1000,
  finishedAt: 6500,
  actionCount: 2,
  toolCalls: 4,
  evidenceCount: 2,
  flag: "picoCTF{must-not-print}",
  lastProgress: "HTTP GET /login returned 200.",
  failureReason: "The competition time budget expired.",
  resumeFrom: "e-002",
});
assert.equal(failed, "Status: TIMEOUT\nElapsed: 5.5\nHTTP actions: 2\nTool calls: 4\nEvidence items: 2\nFlag: \nLast progress: HTTP GET /login returned 200.\nFailure reason: The competition time budget expired.\nResume from: e-002\n");
assert.doesNotMatch(failed, /must-not-print/);
assert.equal(liveLine(1000, "First HTTP action: GET / → 200", 11234), "[00:10] First HTTP action: GET / → 200\n");

process.stderr.write("CTF_C_COMPETITION_OUTPUT=passed\n");
