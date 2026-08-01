import { createServer } from "node:http";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stage2Tools, beginInvestigation } from "../.pi/extensions/ctf-c-stage2-core.mjs";

function tool(name) {
  const selected = stage2Tools.find((candidate) => candidate.name === name);
  if (!selected) throw new Error(`missing tool: ${name}`);
  return selected;
}

async function call(name, params) {
  const result = await tool(name).execute(`stage2-test-${name}`, params);
  return result.details ?? JSON.parse(result.content[0].text);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectReject(action, pattern, message) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error && pattern.test(error.message), message);
    return;
  }
  throw new Error(`${message}: operation succeeded`);
}

export default function (pi) {
  pi.on("session_start", async () => {
    const server = createServer((request, response) => {
      if (request.method === "POST" && request.url === "/login") {
        response.setHeader("Set-Cookie", "session=fixture-ok; Path=/");
        response.end("logged in");
        return;
      }
      if (request.method === "GET" && request.url === "/flag") {
        if (request.headers.cookie === "session=fixture-ok") response.end("picoCTF{stage2_execution_fixture}");
        else { response.statusCode = 403; response.end("forbidden"); }
        return;
      }
      if (request.method === "GET" && request.url?.startsWith("/query?")) {
        const query = new URL(request.url, "http://127.0.0.1");
        if (query.searchParams.get("q") === "stage2") response.end("picoCTF{first} picoCTF{second} Cookie: session=abc123 csrf_token=csrf-secret password=top-secret Authorization: Bearer auth-secret {\"password\":\"json-secret\",\"csrf_token\":\"json-csrf\",\"session\":\"json-session\"}");
        else { response.statusCode = 400; response.end("bad query"); }
        return;
      }
      response.statusCode = 404;
      response.end("not found");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture server did not bind");

    const slug = `stage2-web-fixture-${process.pid}`;
    const challengeRoot = join(process.cwd(), "challenges", slug);
    const fixtureRoot = join(process.cwd(), "tests", "fixtures", "stage2-web");
    mkdirSync(join(process.cwd(), "challenges"), { recursive: true });
    cpSync(fixtureRoot, challengeRoot, { recursive: true });
    const declarationPath = join(challengeRoot, "challenge.md");
    writeFileSync(declarationPath, readFileSync(declarationPath, "utf8").replace("__PORT__", String(address.port)));
    let outsideRoot = null;

    try {
      const started = beginInvestigation(slug);
      assert(started.state === "ready" && started.remote_actions === "allowed_by_declaration", "investigation did not start as declared");
      const evidenceDir = join(challengeRoot, "artifacts", "evidence");
      outsideRoot = mkdtempSync(join(tmpdir(), "ctf-c-stage2-outside-"));
      symlinkSync(outsideRoot, evidenceDir);
      await expectReject(
        () => call("http_request", { hypothesis_id: "symlink-evidence", method: "POST", path: "/login", form: { user: "fixture" }, action_kind: "login", timeout_ms: 2000 }),
        /Symlink path component rejected/,
        "symlinked evidence directory was accepted",
      );
      rmSync(evidenceDir, { recursive: true, force: true });
      mkdirSync(evidenceDir);
      const login = await call("http_request", { hypothesis_id: "login", method: "POST", path: "/login", form: { user: "fixture" }, action_kind: "login", timeout_ms: 2000 });
      assert(login.status_code === 200 && login.evidence_id, "login request failed");
      const query = await call("http_request", { hypothesis_id: "query", method: "GET", path: "/query", query: { q: "stage2" }, action_kind: "recon", timeout_ms: 2000 });
      assert(query.status_code === 200, "query request failed");
      assert(query.preview.match(/\[REDACTED_FLAG\]/g)?.length === 2, "multiple flags were not redacted");
      for (const secret of ["session=abc123", "csrf-secret", "top-secret", "auth-secret", "json-secret", "json-csrf", "json-session"]) assert(!query.preview.includes(secret), `public preview leaked ${secret}`);
      const querySequence = Number(query.evidence_id.slice(2));
      const queryPublicPath = join(challengeRoot, "artifacts", "evidence", `${querySequence}-${query.evidence_id}.json`);
      const queryPublicOriginal = readFileSync(queryPublicPath);
      const queryPublicRecord = JSON.parse(queryPublicOriginal.toString("utf8"));
      queryPublicRecord.preview = "tampered";
      writeFileSync(queryPublicPath, `${JSON.stringify(queryPublicRecord)}\n`);
      await expectReject(() => call("verify_flag", { evidence_id: query.evidence_id }), /Evidence integrity check failed|Evidence record changed/, "tampered public evidence was accepted");
      writeFileSync(queryPublicPath, queryPublicOriginal);
      const queryPrivatePath = join(challengeRoot, "artifacts", "private", `${querySequence}-${query.evidence_id}.body`);
      const queryPrivateOriginal = readFileSync(queryPrivatePath);
      writeFileSync(queryPrivatePath, "tampered private artifact");
      await expectReject(() => call("verify_flag", { evidence_id: query.evidence_id }), /Evidence integrity check failed/, "tampered private evidence was accepted");
      writeFileSync(queryPrivatePath, queryPrivateOriginal);
      const flagResponse = await call("http_request", { hypothesis_id: "flag", method: "GET", path: "/flag", action_kind: "authenticated_request", timeout_ms: 2000 });
      assert(flagResponse.status_code === 200 && flagResponse.preview.includes("REDACTED_FLAG"), "cookie or redaction behavior failed");
      await expectReject(
        () => call("finalize_result", { status: "solved", reason: "unverified", verified_evidence_id: flagResponse.evidence_id }),
        /Solved requires verified evidence/,
        "unverified evidence solved the investigation",
      );
      const verified = await call("verify_flag", { evidence_id: flagResponse.evidence_id });
      assert(verified.verified === true, "flag verification failed");
      const command = await call("run_local_command", { hypothesis_id: "hash", profile: "sha256", paths: ["source/app.js"], timeout_ms: 2000 });
      assert(command.outcome === "completed", "local command failed");
      const sourceEscape = join(challengeRoot, "source", "escape");
      rmSync(sourceEscape, { recursive: true, force: true });
      symlinkSync(outsideRoot, sourceEscape);
      await expectReject(
        () => call("run_local_command", { hypothesis_id: "symlink-source", profile: "sha256", paths: ["source/escape/missing.js"], timeout_ms: 2000 }),
        /Symlink path component rejected|Path escapes allowed root/,
        "symlinked source parent was accepted",
      );
      rmSync(sourceEscape, { recursive: true, force: true });
      const exploitEscape = join(challengeRoot, "exploits", "escape");
      rmSync(exploitEscape, { recursive: true, force: true });
      symlinkSync(outsideRoot, exploitEscape);
      await expectReject(
        () => call("write_exploit", { hypothesis_id: "symlink-exploit", relative_path: "escape/payload.py", language: "python", content: "print('no')\n" }),
        /Symlink path component rejected|Path escapes allowed root/,
        "symlinked exploit parent was accepted",
      );
      rmSync(exploitEscape, { recursive: true, force: true });
      const exploit = await call("write_exploit", { hypothesis_id: "exploit", relative_path: "fixture.py", language: "python", content: "print('picoCTF{stage2_exploit_fixture}')\n" });
      const exploitRun = await call("run_local_command", { hypothesis_id: "exploit-run", profile: "run_exploit", paths: ["exploits/fixture.py"], timeout_ms: 2000 });
      assert(exploit.evidence_id && exploitRun.outcome === "completed", "test exploit execution failed");
      const exploitEvidence = await call("verify_flag", { evidence_id: exploitRun.evidence_id });
      try {
        await call("http_request", { hypothesis_id: "escape", method: "GET", path: "/../flag", action_kind: "recon", timeout_ms: 2000 });
        throw new Error("unsafe path accepted");
      } catch (error) {
        assert(error instanceof Error && /Unsafe request path|Path traversal/.test(error.message), "unsafe path rejection mismatch");
      }
      const final = await call("finalize_result", { status: "solved", reason: "fixture evidence verified", verified_evidence_id: flagResponse.evidence_id });
      assert(exploitEvidence.verified === true && final.status === "solved", "finalization failed");
      process.stderr.write("CTF_C_EXECUTION=passed\n");
    } finally {
      server.close();
      rmSync(challengeRoot, { recursive: true, force: true });
      if (outsideRoot) rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
}
