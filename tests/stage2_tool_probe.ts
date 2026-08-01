import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beginInvestigation, isValidChallengeSlug, readStage2Declaration } from "../.pi/extensions/ctf-c-stage2-core.mjs";

function assertChallengeSymlinkIsRejected(): void {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "ctf-c-stage2-probe-"));
  try {
    mkdirSync(join(fixtureRoot, "challenges"));
    symlinkSync(tmpdir(), join(fixtureRoot, "challenges", "symlinked-challenge"));
    const originalCwd = process.cwd();
    try {
      process.chdir(fixtureRoot);
      try {
        readStage2Declaration("symlinked-challenge");
        throw new Error("challenge-directory symlink accepted");
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "Challenge directory not found") {
          throw error;
        }
      }
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
    const status = readStage2Declaration("secure-email-service-picoctf-web");
    if (status.category !== "web" || status.authorization_state !== "local-only" || status.authorized_remote_actions !== "none" || status.time_budget !== "15 minutes") {
      throw new Error("stage2 status metadata mismatch");
    }
    process.stderr.write("CTF_C_STATUS=metadata-read\n");
    const skeleton = beginInvestigation("secure-email-service-picoctf-web");
    if (skeleton.state !== "ready" || skeleton.phase !== "source_audit" || skeleton.side_effects !== "none") {
      throw new Error("begin investigation skeleton mismatch");
    }
    process.stderr.write("CTF_C_INVESTIGATION=ready\n");
  });
}
