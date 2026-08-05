import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const sessionCookieName = "h4_session";

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new Error("malformed json")); }
    });
    request.on("error", reject);
  });
}

function sessionValue(request) {
  const cookie = request.headers.cookie ?? "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookieName}=`))?.slice(sessionCookieName.length + 1) ?? null;
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export async function startH4Fixture() {
  const account = { username: null, password: null };
  const sessions = new Set();
  const flag = `${["pico", "CTF"].join("")}\{h4_${randomUUID().replaceAll("-", "")}\}`;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<!doctype html><h1>JSON account service</h1><p>Use JSON with <code>POST /api/register</code> and <code>POST /api/login</code>.</p><script>const loginRoute = "/api/login"; const registerRoute = "/api/register"; const profileRoute = "/api/me";</script>');
      return;
    }
    if (request.method === "POST" && request.url === "/api/register") {
      if (request.headers["content-type"] !== "application/json") {
        json(response, 415, { error: "json required" });
        return;
      }
      let body;
      try { body = await readJson(request); } catch { json(response, 400, { error: "malformed json" }); return; }
      if (account.username !== null) { json(response, 409, { error: "account already exists" }); return; }
      if (typeof body?.username !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{2,31}$/.test(body.username) || typeof body?.password !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(body.password)) {
        json(response, 400, { error: "invalid registration" });
        return;
      }
      account.username = body.username;
      account.password = body.password;
      json(response, 200, { ok: true, login_route: "/api/login" });
      return;
    }
    if (request.method === "POST" && request.url === "/api/login") {
      if (request.headers["content-type"] !== "application/json") { json(response, 415, { error: "json required" }); return; }
      let body;
      try { body = await readJson(request); } catch { json(response, 400, { error: "malformed json" }); return; }
      if (account.username === null || body?.username !== account.username || body?.password !== account.password) { json(response, 401, { error: "invalid credentials" }); return; }
      const session = randomUUID().replaceAll("-", "");
      sessions.add(session);
      response.writeHead(302, { location: "/api/me", "set-cookie": `${sessionCookieName}=${session}; Path=/; HttpOnly` });
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/api/me") {
      if (!sessions.has(sessionValue(request))) { json(response, 401, { error: "authentication required" }); return; }
      json(response, 200, { authenticated: true, flag_route: "/api/flag" });
      return;
    }
    if (request.method === "GET" && request.url === "/api/flag") {
      if (!sessions.has(sessionValue(request))) { json(response, 401, { error: "authentication required" }); return; }
      json(response, 200, { flag });
      return;
    }
    json(response, 404, { error: "not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async stop() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
