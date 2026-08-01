import { createServer } from "node:http";
import { cpSync, existsSync, mkdirSync, readFileSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStage3Manifest } from "../scripts/create_stage3_manifest.mjs";
import { beginInvestigation, stage2Tools } from "../.pi/extensions/ctf-c-stage2-core.mjs";
import { createHash } from "node:crypto";

function assert(condition, message) { if (!condition) throw new Error(message); }

async function rejects(action, pattern, message) {
  try { await action(); } catch (error) {
    assert(error instanceof Error && pattern.test(error.message), `${message}: ${error.message}`);
    return;
  }
  throw new Error(`${message}: operation succeeded`);
}

function tool(name) {
  const selected = stage2Tools.find((candidate) => candidate.name === name);
  if (!selected) throw new Error(`missing tool: ${name}`);
  return selected;
}

async function call(name, params) {
  const result = await tool(name).execute(`stage3-test-${name}`, params);
  return result.details ?? JSON.parse(result.content[0].text);
}

export default function (pi) {
  pi.on("session_start", async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("runtime test server did not bind");
    const slug = `stage3-runtime-${process.pid}`;
    const challengeRoot = join(process.cwd(), "challenges", slug);
    const fixtureRoot = join(process.cwd(), "tests", "fixtures", "stage2-web");
    const runtimeRoot = mkdtempSync(join(tmpdir(), "ctf-c-stage3-runtime-"));
    mkdirSync(join(process.cwd(), "challenges"), { recursive: true });
    cpSync(fixtureRoot, challengeRoot, { recursive: true });
    const declarationPath = join(challengeRoot, "challenge.md");
    const declarationBefore = readFileSync(declarationPath);
    let manifestA;
    let manifestB;
    try {
      manifestA = createStage3Manifest({ projectRoot: process.cwd(), slug, target: `http://127.0.0.1:${address.port}/`, approved: true, runtimeRoot });
      manifestB = createStage3Manifest({ projectRoot: process.cwd(), slug, target: `http://127.0.0.1:${address.port}/`, approved: true, runtimeRoot });
      assert(readFileSync(declarationPath).equals(declarationBefore), "manifest creation changed challenge declaration");
      assert(manifestA.run_id !== manifestB.run_id && manifestA.paths.run_root !== manifestB.paths.run_root, "concurrent manifests reused a run directory");
      assert((statSync(manifestA.paths.manifest).mode & 0o777) === 0o600, "manifest is not private");
      assert(manifestA.target.port === address.port && manifestA.target.hostname === "127.0.0.1", "target was not sourced from manifest");
      assert(!declarationBefore.toString("utf8").includes("Target URL") && !declarationBefore.toString("utf8").includes("Authorized:"), "fixture contains live target state");
      await rejects(() => createStage3Manifest({ projectRoot: process.cwd(), slug, target: manifestA.target.origin, approved: false, runtimeRoot }), /approval/i, "missing per-run approval was accepted");

      process.env.CTFC_STAGE2_MANIFEST = manifestA.paths.manifest;
      await rejects(() => beginInvestigation(`${slug}-wrong`), /identity mismatch|Challenge directory not found/, "mismatched slug was accepted");
      const originalManifest = readFileSync(manifestA.paths.manifest);
      const tampered = JSON.parse(originalManifest.toString("utf8"));
      tampered.target.origin = "http://127.0.0.1:1";
      writeFileSync(manifestA.paths.manifest, `${JSON.stringify(tampered)}\n`);
      await rejects(() => beginInvestigation(slug), /target origin|identity mismatch|lock/, "tampered manifest was accepted");
      writeFileSync(manifestA.paths.manifest, originalManifest);

      const originalDeclaration = readFileSync(declarationPath);
      writeFileSync(declarationPath, Buffer.concat([originalDeclaration, Buffer.from("\n")]));
      await rejects(() => beginInvestigation(slug), /declaration digest/, "invalid declaration digest was accepted");
      writeFileSync(declarationPath, originalDeclaration);

      const originalLock = readFileSync(manifestA.paths.lock);
      writeFileSync(manifestA.paths.lock, "wrong-run\n");
      await rejects(() => beginInvestigation(slug), /lock/, "reused or invalid lock was accepted");
      writeFileSync(manifestA.paths.lock, originalLock);

      const policyManifest = JSON.parse(originalManifest.toString("utf8"));
      policyManifest.effective.http_methods = ["GET", "PUT"];
      const policyBytes = Buffer.from(`${JSON.stringify(policyManifest)}\n`);
      writeFileSync(manifestA.paths.manifest, policyBytes);
      writeFileSync(manifestA.paths.lock, `${manifestA.run_id}\n${createHash("sha256").update(policyBytes).digest("hex")}\n`);
      await rejects(() => beginInvestigation(slug), /widens durable action policy/, "manifest widened HTTP methods");
      writeFileSync(manifestA.paths.manifest, originalManifest);
      const actionManifest = JSON.parse(originalManifest.toString("utf8"));
      actionManifest.effective.action_kinds = ["recon", "execute_shell"];
      const actionBytes = Buffer.from(`${JSON.stringify(actionManifest)}\n`);
      writeFileSync(manifestA.paths.manifest, actionBytes);
      writeFileSync(manifestA.paths.lock, `${manifestA.run_id}\n${createHash("sha256").update(actionBytes).digest("hex")}\n`);
      await rejects(() => beginInvestigation(slug), /widens durable action policy/, "manifest widened action kinds");
      writeFileSync(manifestA.paths.manifest, originalManifest);
      writeFileSync(manifestA.paths.lock, originalLock);

      const started = beginInvestigation(slug);
      assert(started.run_id === manifestA.run_id && started.remote_actions === "allowed_by_manifest", "manifest run was not initialized");
      await call("record_hypotheses", { hypotheses: [{ id: "H1", rank: 1, confidence: 0.8, statement: "The fixture source supports a bounded local proof.", evidence_refs: ["tests/fixtures/stage2-web/source/app.js"] }] });
      const command = await call("run_local_command", { hypothesis_id: "H1", profile: "sha256", paths: ["source/app.js"], timeout_ms: 2000 });
      assert(command.evidence_id && readdirSync(manifestA.paths.evidence).length > 0, "evidence was not written under runtime directory");
      assert(!existsSync(join(challengeRoot, "artifacts", "evidence")), "evidence was written under challenge directory");
      await call("finalize_result", { status: "not_solved", reason: "runtime path test" });
      assert(existsSync(manifestA.paths.result) && existsSync(manifestA.paths.state), "result/state was not written under runtime directory");
      assert(readFileSync(declarationPath).equals(declarationBefore), "challenge declaration changed during run");
      process.stderr.write("CTF_C_STAGE3_RUNTIME=passed\n");
    } finally {
      delete process.env.CTFC_STAGE2_MANIFEST;
      server.close();
      rmSync(challengeRoot, { recursive: true, force: true });
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
}
