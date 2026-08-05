import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const sessionCookieName = "h2_session";

function formData(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))));
    request.on("error", reject);
  });
}

function sessionFrom(request) {
  const cookie = request.headers.cookie ?? "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookieName}=`))?.slice(sessionCookieName.length + 1) ?? null;
}

export async function startH2Fixture() {
  const users = new Map();
  const sessions = new Set();
  const flag = `${["pico", "CTF"].join("")}\{h2_${randomUUID().replaceAll("-", "")}\}`;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end('<!doctype html><form action="/register" method="POST"><label>Username <input name="username"></label><label>Password <input name="password" type="password"></label><button type="submit">Register</button></form>');
      return;
    }
    if (request.method === "POST" && request.url === "/register") {
      const form = await formData(request);
      const username = form.get("username");
      const password = form.get("password");
      if (typeof username !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{2,31}$/.test(username) || typeof password !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(password)) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        response.end("invalid registration");
        return;
      }
      users.set(username, password);
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end('<p>Registration complete.</p><a href="/login">Continue to login</a>');
      return;
    }
    if (request.method === "GET" && request.url === "/login") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end('<!doctype html><form action="/login" method="POST"><label>Username <input name="username"></label><label>Password <input name="password" type="password"></label><button type="submit">Login</button></form>');
      return;
    }
    if (request.method === "POST" && request.url === "/login") {
      const form = await formData(request);
      const username = form.get("username");
      const password = form.get("password");
      if (typeof username !== "string" || typeof password !== "string" || users.get(username) !== password) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
        response.end("invalid credentials");
        return;
      }
      const session = randomUUID().replaceAll("-", "");
      sessions.add(session);
      response.writeHead(302, { "location": "/dashboard", "set-cookie": `${sessionCookieName}=${session}; Path=/; HttpOnly`, "content-type": "text/plain; charset=utf-8" });
      response.end("redirecting");
      return;
    }
    if (request.method === "GET" && request.url === "/dashboard") {
      if (!sessions.has(sessionFrom(request))) {
        response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        response.end("forbidden");
        return;
      }
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end('<h1>Dashboard</h1><a href="/flag">Open the observed flag route</a>');
      return;
    }
    if (request.method === "GET" && request.url === "/flag") {
      if (!sessions.has(sessionFrom(request))) {
        response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        response.end("forbidden");
        return;
      }
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end(flag);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
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
