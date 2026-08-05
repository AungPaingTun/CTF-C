import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

export async function startJsLoginFixture(port) {
  const flag = `picoCTF{browser_${randomUUID().replaceAll("-", "")}}`;
  const nonce = randomUUID();
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html><title>JS Login</title><main id="app"></main><script>sessionStorage.setItem("browser_nonce", "${nonce}"); localStorage.setItem("browser_hint", "js-login"); window.challengeHelper = () => sessionStorage.getItem("browser_nonce"); window.clientSubmit = () => { const user = document.querySelector("#username").value; const pass = document.querySelector("#password").value; if (user === "browser-user" && pass === "BrowserPass_42") window.location = "/success"; else document.querySelector("#error").textContent = "invalid"; }; document.addEventListener("DOMContentLoaded", () => { const app = document.querySelector("#app"); app.innerHTML = '<form id="login" onsubmit="event.preventDefault(); window.clientSubmit()"><label>Username<input id="username" name="username"></label><label>Password<input id="password" name="password" type="password"></label><button id="submit" type="submit">Log in</button><p id="error"></p></form>'; });</script>`);
      return;
    }
    if (request.url === "/success") {
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end(flag);
      return;
    }
    response.writeHead(404); response.end("not found");
  });
  await new Promise((resolve) => server.listen(port || 0, "127.0.0.1", resolve));
  const address = server.address();
  return { origin: `http://127.0.0.1:${address.port}`, async stop() { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); } };
}
