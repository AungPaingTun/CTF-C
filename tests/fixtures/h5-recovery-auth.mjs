import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const sessionCookieName = "h5_session";

function readForm(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))));
    request.on("error", reject);
  });
}

function sessionValue(request) {
  const cookie = request.headers.cookie ?? "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookieName}=`))?.slice(sessionCookieName.length + 1) ?? null;
}

export async function startH5Fixture() {
  const account = { username: null, password: null };
  const sessions = new Set();
  let failedLoginIssued = false;
  const flag = `${["pico", "CTF"].join("")}\{h5_${randomUUID().replaceAll("-", "")}\}`;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<!doctype html><h1>Account portal</h1><form action="/login" method="POST"><label>Username <input name="username"></label><label>Password <input name="password" type="password"></label><button type="submit">Login</button></form>');
      return;
    }
    if (request.method === "GET" && request.url === "/login") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<form action="/login" method="POST"><input name="username"><input name="password" type="password"></form>');
      return;
    }
    if (request.method === "POST" && request.url === "/login") {
      const form = await readForm(request);
      if (!failedLoginIssued) {
        failedLoginIssued = true;
        response.writeHead(500, { "content-type": "text/html; charset=utf-8" });
        response.end('<p>Login backend failed.</p><a href="/register">Create an account</a>');
        return;
      }
      if (account.username === null || form.get("username") !== account.username || form.get("password") !== account.password) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
        response.end("invalid credentials");
        return;
      }
      const session = randomUUID().replaceAll("-", "");
      sessions.add(session);
      response.writeHead(302, { location: "/dashboard", "set-cookie": `${sessionCookieName}=${session}; Path=/; HttpOnly` });
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/register") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<form action="/register" method="POST"><input name="username"><input name="password" type="password"></form>');
      return;
    }
    if (request.method === "POST" && request.url === "/register") {
      const form = await readForm(request);
      if (account.username !== null || typeof form.get("username") !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{2,31}$/.test(form.get("username")) || typeof form.get("password") !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(form.get("password"))) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        response.end("invalid registration");
        return;
      }
      account.username = form.get("username");
      account.password = form.get("password");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<p>Registration complete.</p><a href="/login">Return to login</a>');
      return;
    }
    if (request.method === "GET" && request.url === "/dashboard") {
      if (!sessions.has(sessionValue(request))) { response.writeHead(401); response.end("unauthorized"); return; }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<a href="/flag">Open the authenticated flag route</a>');
      return;
    }
    if (request.method === "GET" && request.url === "/flag") {
      if (!sessions.has(sessionValue(request))) { response.writeHead(401); response.end("unauthorized"); return; }
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end(flag);
      return;
    }
    response.writeHead(404);
    response.end("not found");
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
