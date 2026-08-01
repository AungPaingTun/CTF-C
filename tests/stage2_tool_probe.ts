import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isValidChallengeSlug, readStage2Status } from "../.pi/extensions/ctf-c-stage2.ts";

function assertChallengeSymlinkIsRejected(): void {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "ctf-c-stage2-probe-"));
  try {
    mkdirSync(join(fixtureRoot, "challenges"));
    symlinkSync(tmpdir(), join(fixtureRoot, "challenges", "symlinked-challenge"));
    const originalCwd = process.cwd();
    try {
      process.chdir(fixtureRoot);
      let rejected = false;
      try {
        readStage2Status("symlinked-challenge");
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error("challenge-directory symlink accepted");
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => {
    const tools = pi.getActiveTools().sort();
    process.stderr.write(`CTF_C_TOOL_LIST=${JSON.stringify(tools)}\n`);
    const invalidSlugs = ["../escape", "nested/path", "/tmp/challenge", "bad_slug", "..", "valid--bad"];
    if (invalidSlugs.some((slug) => isValidChallengeSlug(slug))) {
      throw new Error("invalid challenge slug accepted");
    }
    process.stderr.write("CTF_C_INVALID_SLUGS=rejected\n");
    assertChallengeSymlinkIsRejected();
    process.stderr.write("CTF_C_SYMLINKS=rejected\n");
    const status = readStage2Status("secure-email-service-picoctf-web");
    if (status.category !== "web" || status.authorization_state !== "local-only" || status.remote_actions_state !== "none" || status.time_budget !== "15 minutes") {
      throw new Error("stage2 status metadata mismatch");
    }
    process.stderr.write("CTF_C_STATUS=metadata-read\n");
  });
}
