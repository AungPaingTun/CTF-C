import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { competitionTools, initializeCompetitionRun } from "../.pi/extensions/ctf-c-stage2-core.mjs";

function httpTool() {
  const selected = competitionTools.find((candidate) => candidate.name === "http_request");
  if (!selected) throw new Error("missing http_request tool");
  return selected;
}

async function call(params) {
  params = { ...params, reasoning: { evidence_summary: ["The fixture returned an observed route clue."], leading_hypothesis: `The route ${params.path} is evidence-backed by the fixture.`, supporting_evidence: ["The active fixture is the current evidence source."], experiment: params.reasoning_experiment ?? `${params.method} ${params.path} decision-harness request`, expected_observation: "The local fixture returns a response.", confidence: 0.5, untested_experiments: [] } };
  const result = await httpTool().execute("competition-decision-harness", params);
  return result.details ?? JSON.parse(result.content[0].text);
}

export default function (pi) {
  pi.on("session_start", async () => {
    const recordPath = process.env.CTFC_COMPETITION_RUN_RECORD;
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    const seen = [];
    const seenRequests = [];
    const server = createServer(async (request, response) => {
      seen.push(request.url);
      seenRequests.push(`${request.method} ${request.url}`);
      if (request.url === "/") {
        response.setHeader("content-type", "text/html");
        response.end('<a href="/profile/user/123">Profile</a><form action="upload.php" method="POST" enctype="multipart/form-data"><input type="file" name="image"></form>');
      }
      else if (request.url === "/profile/user/123") {
        response.setHeader("Location", "/redirect");
        response.setHeader("content-type", "text/html");
          response.end('<a href="/account/123">Account</a><a href="/binary">Binary</a><a href="/wasm">Wasm</a><form action="/profile/user/123/update" method="POST"><input name="role"></form><form action="/upload" method="POST" enctype="multipart/form-data"><input type="hidden" name="upload_token" value="fixture-upload-token"><input type="file" name="image"></form><form action="/upload-no-hidden" method="POST" enctype="multipart/form-data"><input type="file" name="image"></form><script>fetch(\'/login\', { method: \'POST\' }); axios(\'/axios-login\', {}); xhr.open(\'GET\', \'/xhr-login\', true); location.href = \'/location-login\'; window.location = "/window-login"; fetch(\'/file(name)\', {}); fetch(\'/path;param=value\', {}); // /comment\');</script>');
      }
      else if (request.method === "POST" && request.url === "/upload") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const raw = Buffer.concat(chunks);
        const contentType = request.headers["content-type"] ?? "";
        const valid = /^multipart\/form-data; boundary=/.test(contentType) && raw.includes('name="image"') && raw.includes('filename="safe-name.gif"') && raw.includes("Content-Type: image/gif") && raw.includes("fixed-caption") && raw.includes("fixture-upload-token") && raw.includes("GIF89a");
        response.statusCode = valid ? 200 : 400;
        response.end(valid ? "upload-ok" : "upload-invalid");
      }
      else if (request.method === "POST" && request.url === "/upload-no-hidden") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const raw = Buffer.concat(chunks);
        const contentType = request.headers["content-type"] ?? "";
        const valid = /^multipart\/form-data; boundary=/.test(contentType) && raw.includes('name="image"') && raw.includes('filename="safe-name.gif"') && raw.includes("Content-Type: image/gif") && raw.includes("fixed-caption") && raw.includes("GIF89a") && !raw.includes("upload_token");
        response.statusCode = valid ? 200 : 400;
        response.end(valid ? "upload-no-hidden-ok" : "upload-no-hidden-invalid");
      }
      else if (request.method === "POST" && request.url === "/upload.php") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const raw = Buffer.concat(chunks);
        const contentType = request.headers["content-type"] ?? "";
        const valid = /^multipart\/form-data; boundary=/.test(contentType) && raw.includes('name="image"') && raw.includes('filename="safe-name.gif"') && raw.includes("Content-Type: image/gif") && raw.includes("GIF89a");
        response.statusCode = valid ? 200 : 400;
        response.end(valid ? "upload-action-ok" : "upload-action-invalid");
      }
      else if (request.method === "GET" && request.url === "/binary") {
        const key = Buffer.from("K");
        const flag = Buffer.from("picoCTF{binary_fixture}");
        const encoded = Buffer.concat([Buffer.from("HEADER"), Buffer.from(flag.map((byte) => byte ^ key[0]))]);
        response.setHeader("content-type", "application/octet-stream");
        response.end(encoded);
      }
      else if (request.method === "GET" && request.url === "/wasm") {
        response.setHeader("content-type", "application/wasm");
        response.end(Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x07, 0x09, 0x01, 0x03, 0x72, 0x75, 0x6e, 0x00, 0x00, 0x0b, 0x01, 0x00]));
      }
      else response.end("ok");
    });
    await new Promise((resolve) => server.listen(Number(new URL(record.target_origin).port), "127.0.0.1", resolve));
    try {
      initializeCompetitionRun();
      const beforeUnavailable = JSON.parse(readFileSync(record.paths.state, "utf8"));
      await assert.rejects(() => competitionTools.find((candidate) => candidate.name === "list_source").execute("unavailable-source", { path: ".", limit: 8 }), /\[UNAVAILABLE_CAPABILITY\]/);
      const afterUnavailable = JSON.parse(readFileSync(record.paths.state, "utf8"));
      assert.equal(afterUnavailable.action_count, beforeUnavailable.action_count);
      assert.equal(afterUnavailable.evidence_sequence, beforeUnavailable.evidence_sequence);
      assert.equal(afterUnavailable.unavailable_capabilities.length, 1);
      await assert.rejects(() => competitionTools.find((candidate) => candidate.name === "list_source").execute("duplicate-unavailable-source", { path: ".", limit: 8 }), /already recorded/);
      assert.equal(JSON.parse(readFileSync(record.paths.state, "utf8")).unavailable_capabilities.length, 1);
      const rootObserved = await call({ method: "GET", path: "/", action_kind: "recon", timeout_ms: 2000 });
      assert.equal(rootObserved.status_code, 200);
      const beforeInvalidActionKind = JSON.parse(readFileSync(record.paths.state, "utf8"));
      await assert.rejects(() => call({ method: "GET", path: "/invalid-action-kind", action_kind: "upload", timeout_ms: 2000 }), /HTTP method or action kind is not allowed/);
      const afterInvalidActionKind = JSON.parse(readFileSync(record.paths.state, "utf8"));
      assert.equal(afterInvalidActionKind.action_count, beforeInvalidActionKind.action_count);
      assert.equal(afterInvalidActionKind.evidence_sequence, beforeInvalidActionKind.evidence_sequence);
      assert.ok(!seenRequests.includes("GET /invalid-action-kind"));
      const rootMultipart = { source_evidence_id: rootObserved.evidence_id, file: { field_name: "image", filename: "safe-name.gif", content_type: "image/gif", content_base64: "R0lGODlh" } };
      const beforeWrongAction = JSON.parse(readFileSync(record.paths.state, "utf8"));
      await assert.rejects(() => call({ method: "POST", path: "/", action_kind: "submit", multipart: rootMultipart, reasoning_experiment: "multipart wrong observed action path", timeout_ms: 2000 }), /submit POST \/upload\.php/);
      const afterWrongAction = JSON.parse(readFileSync(record.paths.state, "utf8"));
      assert.equal(afterWrongAction.action_count, beforeWrongAction.action_count);
      assert.equal(afterWrongAction.evidence_sequence, beforeWrongAction.evidence_sequence);
      assert.ok(!seenRequests.includes("POST /"));
      const actionUpload = await call({ method: "POST", path: "/upload.php", action_kind: "submit", multipart: rootMultipart, reasoning_experiment: "multipart observed action path", timeout_ms: 2000 });
      assert.equal(actionUpload.status_code, 200);
      assert.equal(actionUpload.preview, "upload-action-ok");
      const observed = await call({ method: "GET", path: "/profile/user/123", action_kind: "recon", timeout_ms: 2000 });
      assert.equal(observed.status_code, 200);
      assert.equal(observed.reasoning.confidence_after, 0.6);
      const upload = await call({ method: "POST", path: "/upload", action_kind: "submit", multipart: { source_evidence_id: observed.evidence_id, file: { field_name: "image", filename: "safe-name.gif", content_type: "image/gif", content_base64: "R0lGODlh" }, fields: { caption: "fixed-caption" }, evidence_form_fields: { upload_token: observed.evidence_id } }, timeout_ms: 2000 });
       assert.equal(upload.status_code, 200);
       assert.equal(upload.preview, "upload-ok");
       const beforeNoHiddenMultipart = JSON.parse(readFileSync(record.paths.state, "utf8"));
       const noHiddenMultipart = { source_evidence_id: observed.evidence_id, file: { field_name: "image", filename: "safe-name.gif", content_type: "image/gif", content_base64: "R0lGODlh" }, fields: { caption: "fixed-caption" } };
       const noHiddenUpload = await call({ method: "POST", path: "/upload-no-hidden", action_kind: "submit", multipart: noHiddenMultipart, reasoning_experiment: "multipart no-hidden omitted mapping" , timeout_ms: 2000 });
       assert.equal(noHiddenUpload.status_code, 200);
       assert.equal(noHiddenUpload.preview, "upload-no-hidden-ok");
       const afterNoHiddenUpload = JSON.parse(readFileSync(record.paths.state, "utf8"));
       assert.equal(afterNoHiddenUpload.action_count, beforeNoHiddenMultipart.action_count + 1);
       const emptyNoHiddenUpload = await call({ method: "POST", path: "/upload-no-hidden", action_kind: "submit", multipart: { ...noHiddenMultipart, evidence_form_fields: {} }, reasoning_experiment: "multipart no-hidden empty mapping", timeout_ms: 2000 });
       assert.equal(emptyNoHiddenUpload.status_code, 200);
       assert.equal(emptyNoHiddenUpload.preview, "upload-no-hidden-ok");
       const afterEmptyNoHiddenUpload = JSON.parse(readFileSync(record.paths.state, "utf8"));
       assert.equal(afterEmptyNoHiddenUpload.action_count, afterNoHiddenUpload.action_count + 1);
      const uploadEvidence = readFileSync(`${record.paths.evidence}/${Number(upload.evidence_id.slice(2))}-e-${upload.evidence_id.slice(2)}.json`, "utf8");
      assert.doesNotMatch(uploadEvidence, /R0lGODlh|GIF89a|fixture-upload-token|fixed-caption/);
      const beforeInvalidMultipart = JSON.parse(readFileSync(record.paths.state, "utf8"));
      const validMultipart = { source_evidence_id: observed.evidence_id, file: { field_name: "image", filename: "safe-name.gif", content_type: "image/gif", content_base64: "R0lGODlh" } };
       const invalidMultipartCalls = [
        { method: "POST", path: "/unobserved-upload", action_kind: "submit", multipart: validMultipart },
        { method: "POST", path: "/upload", action_kind: "submit", multipart: { ...validMultipart, file: { ...validMultipart.file, field_name: "other" } } },
        { method: "GET", path: "/upload", action_kind: "recon", multipart: validMultipart },
       { method: "POST", path: "/upload", action_kind: "login", multipart: validMultipart },
        { method: "POST", path: "/upload", action_kind: "submit", form: { mode: "conflict" }, multipart: validMultipart },
        { method: "POST", path: "/upload", action_kind: "submit", json: { mode: "conflict" }, multipart: validMultipart },
        { method: "POST", path: "/upload", action_kind: "submit", multipart: { ...validMultipart, file: { ...validMultipart.file, content_base64: "not-base64" } } },
        { method: "POST", path: "/upload", action_kind: "submit", multipart: { ...validMultipart, file: { ...validMultipart.file, content_base64: "A".repeat(87384) } } },
        { method: "POST", path: "/upload", action_kind: "submit", multipart: { ...validMultipart, file: { ...validMultipart.file, filename: "../unsafe.gif" } } },
        { method: "POST", path: "/upload", action_kind: "submit", multipart: { ...validMultipart, file: { ...validMultipart.file, content_type: "text/plain; charset=utf-8" } } },
        { method: "POST", path: "/upload", action_kind: "submit", headers: { "Content-Type": "multipart/form-data; boundary=caller" }, multipart: validMultipart },
       ];
       await assert.rejects(() => call({ method: "POST", path: "/upload", action_kind: "login", multipart: validMultipart }), /^Multipart requires method POST and action_kind submit\.$/);
       for (const params of invalidMultipartCalls) await assert.rejects(() => call(params), /Rejected HTTP request|Multipart|Invalid|Unsafe|requires/);
      const afterInvalidMultipart = JSON.parse(readFileSync(record.paths.state, "utf8"));
      assert.equal(afterInvalidMultipart.action_count, beforeInvalidMultipart.action_count);
      assert.equal(afterInvalidMultipart.evidence_sequence, beforeInvalidMultipart.evidence_sequence);
      await assert.rejects(() => call({ method: "GET", path: "/profile/user/123", action_kind: "recon", timeout_ms: 2000 }), /Equivalent reasoning experiment/);
      await assert.rejects(() => httpTool().execute("missing-reasoning", { method: "GET", path: "/profile/user/123", action_kind: "recon", timeout_ms: 2000 }), /reasoning is required/);
      const beforeSpray = JSON.parse(readFileSync(record.paths.state, "utf8")).action_count;
       await assert.rejects(() => call({ method: "GET", path: "/admin", action_kind: "trigger", timeout_ms: 2000 }), /Strongest current clue/);
      assert.equal(JSON.parse(readFileSync(record.paths.state, "utf8")).action_count, beforeSpray);
      assert.ok(!seen.includes("/admin"));
      await assert.rejects(() => call({ method: "GET", path: "/login',", action_kind: "recon", timeout_ms: 2000 }), /Rejected HTTP request/);
      assert.ok(!seen.includes("/login',"));
      const login = await call({ method: "POST", path: "/login", form: { user: "guest" }, action_kind: "login", timeout_ms: 2000 });
      assert.equal(login.status_code, 200, "fetch-derived POST route was rejected");
      const redirect = await call({ method: "GET", path: "/redirect", action_kind: "recon", timeout_ms: 2000 });
      assert.equal(redirect.status_code, 200, "redirect-derived route was rejected");
      const parenthesized = await call({ method: "GET", path: "/file(name)", action_kind: "recon", timeout_ms: 2000 });
      assert.equal(parenthesized.status_code, 200, "internal parentheses were stripped");
      const semicolon = await call({ method: "GET", path: "/path;param=value", action_kind: "recon", timeout_ms: 2000 });
      assert.equal(semicolon.status_code, 200, "internal semicolon was stripped");
      const comment = await call({ method: "GET", path: "/comment", action_kind: "recon", timeout_ms: 2000 });
      assert.equal(comment.status_code, 200, "comment route retained its delimiter");
      for (const path of ["/axios-login", "/xhr-login", "/location-login", "/window-login"]) {
        const route = await call({ method: "GET", path, action_kind: "recon", timeout_ms: 2000 });
        assert.equal(route.status_code, 200, `${path} route was rejected`);
      }

      const mutation = await call({ method: "GET", path: "/profile/admin/123", action_kind: "recon", timeout_ms: 2000 });
      assert.equal(mutation.status_code, 200, "observed-route mutation was rejected");
      const linked = await call({ method: "GET", path: "/account/123", action_kind: "recon", timeout_ms: 2000 });
      assert.equal(linked.status_code, 200, "link-derived request was rejected");
      const submitted = await call({ method: "POST", path: "/profile/user/123/update", form: { role: "admin" }, action_kind: "submit", timeout_ms: 2000 });
      assert.equal(submitted.status_code, 200, "form-derived request was rejected");

      const beforeSecondSpray = JSON.parse(readFileSync(record.paths.state, "utf8")).action_count;
      await assert.rejects(() => call({ method: "GET", path: "/debug", action_kind: "recon", timeout_ms: 2000 }), /Rejected HTTP request/);
       assert.equal(JSON.parse(readFileSync(record.paths.state, "utf8")).action_count, beforeSecondSpray);
       assert.ok(!seen.includes("/debug"));
       const beforeUnobservedPost = JSON.parse(readFileSync(record.paths.state, "utf8"));
       await assert.rejects(() => call({ method: "POST", path: "/unobserved-post", action_kind: "submit", form: { probe: "1" }, timeout_ms: 2000 }), /Strongest current clue/);
       const afterUnobservedPost = JSON.parse(readFileSync(record.paths.state, "utf8"));
       assert.equal(afterUnobservedPost.action_count, beforeUnobservedPost.action_count);
       assert.equal(afterUnobservedPost.evidence_sequence, beforeUnobservedPost.evidence_sequence);
       for (const path of ["/hypothesis-one", "/hypothesis-two", "/hypothesis-three"]) {
         const hypothesis = await call({ method: "GET", path, action_kind: "recon", timeout_ms: 2000 });
         assert.equal(hypothesis.status_code, 200, `${path} qualifying hypothesis was rejected`);
       }
       const beforeFourthHypothesis = JSON.parse(readFileSync(record.paths.state, "utf8"));
       await assert.rejects(() => call({ method: "GET", path: "/hypothesis-four", action_kind: "recon", timeout_ms: 2000 }), /hypothesis route allowance is exhausted/);
       const afterFourthHypothesis = JSON.parse(readFileSync(record.paths.state, "utf8"));
       assert.equal(afterFourthHypothesis.action_count, beforeFourthHypothesis.action_count);
       assert.equal(afterFourthHypothesis.evidence_sequence, beforeFourthHypothesis.evidence_sequence);
       await assert.rejects(() => call({ method: "GET", path: "/hypothesis-one", action_kind: "recon", timeout_ms: 2000 }), /repeated hypothesis route/);
        initializeCompetitionRun();
        await assert.rejects(() => call({ method: "GET", path: "/hypothesis-four-after-resume", action_kind: "recon", timeout_ms: 2000 }), /hypothesis route allowance is exhausted/);
        const binaryRecordPath = execFileSync(process.execPath, ["scripts/create_competition_run.mjs", "--target", record.target_origin, "--approve", "--description", "binary evidence regression", "--time-budget", "1", "--action-budget", "20"], { encoding: "utf8", env: { ...process.env, CTFC_PROJECT_ROOT: process.cwd() } }).trim();
        process.env.CTFC_COMPETITION_RUN_RECORD = binaryRecordPath;
         initializeCompetitionRun();
         const binaryRoot = await call({ method: "GET", path: "/", action_kind: "recon", timeout_ms: 2000 });
         assert.equal(JSON.parse(readFileSync(JSON.parse(readFileSync(binaryRecordPath, "utf8")).paths.state, "utf8")).required_evidence_inspection, null);
        const binaryEvidence = await call({ method: "GET", path: "/binary", action_kind: "recon", timeout_ms: 2000 });
        const inspectTool = competitionTools.find((candidate) => candidate.name === "inspect_evidence");
        const deriveTool = competitionTools.find((candidate) => candidate.name === "derive_binary_evidence");
        const verifyTool = competitionTools.find((candidate) => candidate.name === "verify_flag");
        const hex = await inspectTool.execute("binary-hex", { evidence_id: binaryEvidence.evidence_id, offset: 0, limit: 16, view: "hex" });
        assert.equal(hex.details.lines[0].offset, 0);
        assert.match(hex.details.lines[0].ascii, /HEADER/);
        const strings = await inspectTool.execute("binary-strings", { evidence_id: binaryEvidence.evidence_id, offset: 0, limit: 64, view: "strings" });
        assert.equal(strings.details.strings[0].text, "HEADER");
        const wasmEvidence = await call({ method: "GET", path: "/wasm", action_kind: "recon", timeout_ms: 2000 });
        const wasm = await inspectTool.execute("wasm-summary", { evidence_id: wasmEvidence.evidence_id, offset: 0, limit: 4096, view: "wasm_summary" });
         assert.equal(wasm.details.version, 1);
         assert.equal(wasm.details.exports[0].name, "run");
         assert.equal(wasm.details.data_ranges.length, 1);
         const wasmState = JSON.parse(readFileSync(JSON.parse(readFileSync(binaryRecordPath, "utf8")).paths.state, "utf8"));
         assert.deepEqual(wasmState.required_evidence_inspection, { kind: "wasm_artifact", evidence_id: wasmEvidence.evidence_id });
         const beforeWasmBlocked = JSON.parse(readFileSync(JSON.parse(readFileSync(binaryRecordPath, "utf8")).paths.state, "utf8"));
         await assert.rejects(() => call({ method: "GET", path: "/wasm-blocked", action_kind: "recon", reasoning_experiment: "WASM checkpoint blocked request", timeout_ms: 2000 }), new RegExp(`Inspect required evidence ${wasmEvidence.evidence_id}`));
         const afterWasmBlocked = JSON.parse(readFileSync(JSON.parse(readFileSync(binaryRecordPath, "utf8")).paths.state, "utf8"));
         assert.equal(afterWasmBlocked.action_count, beforeWasmBlocked.action_count);
         assert.equal(afterWasmBlocked.evidence_sequence, beforeWasmBlocked.evidence_sequence);
         assert.ok(!seenRequests.includes("GET /wasm-blocked"));
         initializeCompetitionRun();
         assert.deepEqual(JSON.parse(readFileSync(JSON.parse(readFileSync(binaryRecordPath, "utf8")).paths.state, "utf8")).required_evidence_inspection, { kind: "wasm_artifact", evidence_id: wasmEvidence.evidence_id });
         const wasmText = await inspectTool.execute("wasm-text", { evidence_id: wasmEvidence.evidence_id });
         assert.equal(wasmText.details.checkpoint_cleared, undefined);
         assert.deepEqual(JSON.parse(readFileSync(JSON.parse(readFileSync(binaryRecordPath, "utf8")).paths.state, "utf8")).required_evidence_inspection, { kind: "wasm_artifact", evidence_id: wasmEvidence.evidence_id });
         const wasmSummary = await inspectTool.execute("wasm-summary-checkpoint", { evidence_id: wasmEvidence.evidence_id, view: "wasm_summary", limit: 4096 });
         assert.equal(wasmSummary.details.checkpoint_cleared, "wasm_artifact");
         assert.match(wasmSummary.details.next_action_guidance, /WASM inspection checkpoint cleared/);
         assert.match(wasmSummary.details.next_action_guidance, /observed exports, sections, strings, or derived evidence/);
         assert.match(wasmSummary.details.next_action_guidance, /do not resume unrelated endpoint guessing/);
         const afterWasmInspection = await call({ method: "GET", path: "/", action_kind: "recon", reasoning_experiment: "post-WASM inspected root observation", timeout_ms: 2000 });
         assert.equal(afterWasmInspection.status_code, 200);
         assert.equal(JSON.parse(readFileSync(JSON.parse(readFileSync(binaryRecordPath, "utf8")).paths.state, "utf8")).required_evidence_inspection, null);
        await assert.rejects(() => inspectTool.execute("invalid-wasm", { evidence_id: binaryEvidence.evidence_id, offset: 0, limit: 64, view: "wasm_summary" }), /Invalid WASM/);
        const beforeInvalidDerive = JSON.parse(readFileSync(JSON.parse(readFileSync(binaryRecordPath, "utf8")).paths.state, "utf8"));
        await assert.rejects(() => deriveTool.execute("bad-key", { source_evidence_id: binaryEvidence.evidence_id, operation: "xor_repeat", offset: 6, length: 21, key_base64: "not-base64" }), /Invalid binary derivation key/);
        await assert.rejects(() => deriveTool.execute("bad-range", { source_evidence_id: binaryEvidence.evidence_id, operation: "xor_repeat", offset: 6, length: 65537, key_base64: "Sw==" }), /Invalid binary derivation range/);
        const afterInvalidDerive = JSON.parse(readFileSync(JSON.parse(readFileSync(binaryRecordPath, "utf8")).paths.state, "utf8"));
        assert.deepEqual(afterInvalidDerive, beforeInvalidDerive);
         const derived = await deriveTool.execute("derive-xor", { source_evidence_id: binaryEvidence.evidence_id, operation: "xor_repeat", offset: 6, length: 23, key_base64: "Sw==" });
         const derivedEvidence = readFileSync(`${JSON.parse(readFileSync(binaryRecordPath, "utf8")).paths.evidence}/${Number(derived.details.evidence_id.slice(2))}-${derived.details.evidence_id}.json`, "utf8");
        assert.doesNotMatch(derivedEvidence, /Sw==|HEADER|picoCTF\{binary_fixture\}/);
        const verified = await verifyTool.execute("verify-derived", { evidence_id: derived.details.evidence_id });
        assert.equal(verified.details.flag, "picoCTF{binary_fixture}");
        process.env.CTFC_COMPETITION_RUN_RECORD = recordPath;
        initializeCompetitionRun();
         process.stderr.write("CTF_C_COMPETITION_DECISION_HARNESS=passed\n");
    } finally {
      server.close();
    }
  });
}
