import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beginInvestigation, isValidChallengeSlug, readStage2Declaration } from "../.pi/extensions/ctf-c-stage2-core.mjs";
import { createStage3Manifest } from "../scripts/create_stage3_manifest.mjs";

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
    const fixtureSlug = `stage2-restricted-${process.pid}`;
    const fixturePath = join(process.cwd(), "challenges", fixtureSlug);
    cpSync(join(process.cwd(), "tests", "fixtures", "web-source-audit"), fixturePath, { recursive: true });
    try {
      const status = readStage2Declaration(fixtureSlug);
      if (status.category !== "web" || status.default_time_budget_minutes !== "15" || status.per_run_approval_required !== "true") {
        throw new Error("stage2 status metadata mismatch");
      }
      process.stderr.write("CTF_C_STATUS=metadata-read\n");
      const runtimeRoot = mkdtempSync(join(tmpdir(), "ctf-c-stage2-restricted-runtime-"));
      try {
        const manifest = createStage3Manifest({ projectRoot: process.cwd(), slug: fixtureSlug, target: "http://127.0.0.1:18080/", approved: true, runtimeRoot });
        process.env.CTFC_STAGE2_MANIFEST = manifest.paths.manifest;
        const skeleton = beginInvestigation(fixtureSlug);
        if (skeleton.state !== "ready" || skeleton.phase !== "source_audit" || skeleton.side_effects !== "none") {
          throw new Error("begin investigation skeleton mismatch");
        }
      } finally {
        delete process.env.CTFC_STAGE2_MANIFEST;
        rmSync(runtimeRoot, { recursive: true, force: true });
      }
    } finally {
      rmSync(fixturePath, { recursive: true, force: true });
    }
    process.stderr.write("CTF_C_INVESTIGATION=ready\n");
  });
}
