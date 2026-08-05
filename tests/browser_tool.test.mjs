import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { competitionTools } from "../.pi/extensions/ctf-c-stage2-core.mjs";
import { startJsLoginFixture } from "./fixtures/js-login-form.mjs";

function tool(name) {
  const selected = competitionTools.find((candidate) => candidate.name === name);
  if (!selected) throw new Error(`missing tool: ${name}`);
  return selected;
}
async function call(params) {
  const result = await tool("browser_action").execute("browser-fixture", params);
  return result.details ?? JSON.parse(result.content[0].text);
}

export default function (pi) {
  pi.on("session_start", async () => {
    let playwrightAvailable = true;
    try { await import("playwright"); } catch { playwrightAvailable = false; }
    if (!playwrightAvailable) {
      process.stderr.write("CTF_C_BROWSER_TOOL=skipped (install Playwright and Chromium)\n");
      return;
    }
    const recordPath = process.env.CTFC_COMPETITION_RUN_RECORD;
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    const port = Number(new URL(record.target_origin).port);
    const fixture = await startJsLoginFixture(port);
    try {
      const root = await call({ action: "goto", value: "/" });
      assert.equal(root.success, true);
      assert.match(root.current_url, /127\.0\.0\.1/);
      assert.equal(root.forms.length, 1);
      assert.equal(root.forms[0].controls.some((control) => control.name === "username"), true);
      const helper = await call({ action: "eval", value: "window.challengeHelper()" });
      assert.ok(helper.eval_result);
      const local = await call({ action: "get_storage", storage_type: "localStorage", storage_key: "browser_hint" });
      const session = await call({ action: "get_storage", storage_type: "sessionStorage", storage_key: "browser_nonce" });
      assert.match(local.eval_result, /js-login/);
      assert.ok(session.eval_result);
      const screenshot = await call({ action: "screenshot" });
      assert.ok(screenshot.screenshot_base64?.length > 100);
      await call({ action: "type", selector: "#username", value: "browser-user" });
      await call({ action: "type", selector: "#password", value: "BrowserPass_42" });
      const submitted = await call({ action: "submit", selector: "#login", wait_for: "networkidle" });
      assert.match(submitted.current_url, /\/success$/);
      assert.match(submitted.visible_text, /\[REDACTED_FLAG\]/);
      assert.ok(submitted.evidence_id);
      const closed = await call({ action: "close" });
      assert.equal(closed.success, true);
      process.stderr.write("CTF_C_BROWSER_TOOL=passed\n");
    } finally {
      await fixture.stop();
      delete process.env.CTFC_COMPETITION_RUN_RECORD;
    }
  });
}
