import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const sessionCookieName = "h3_session";

function randomValue() {
  return randomUUID().replaceAll("-", "");
}

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

function invalid(response, status = 403) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end("request rejected");
}

export async function startH3Fixture() {
  const sessions = new Map();
  const flag = `${["pico", "CTF"].join("")}\{h3_${randomValue()}\}`;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      const session = randomValue();
      sessions.set(session, { registrationToken: randomValue(), loginToken: null, username: null, password: null, authenticated: false });
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": `${sessionCookieName}=${session}; Path=/; HttpOnly` });
      response.end('<!doctype html><form action="/register" method="POST"><label>Username <input name="username"></label><label>Password <input name="password" type="password"></label><input type="hidden" name="csrf_token" value="' + sessions.get(session).registrationToken + '"><button type="submit">Register</button></form>');
      return;
    }

    const session = sessions.get(sessionValue(request));
    if (request.method === "POST" && request.url === "/register") {
      if (!session) {
        invalid(response);
        return;
      }
      const form = await readForm(request);
      const username = form.get("username");
      const password = form.get("password");
      if (form.get("csrf_token") !== session.registrationToken || typeof username !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{2,31}$/.test(username) || typeof password !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(password)) {
        invalid(response, 400);
        return;
      }
      session.registrationToken = null;
      session.username = username;
      session.password = password;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<p>Registration complete.</p><a href="/login">Continue to login</a>');
      return;
    }

    if (request.method === "GET" && request.url === "/login") {
      if (!session || !session.username) {
        invalid(response);
        return;
      }
      session.loginToken = randomValue();
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<!doctype html><form action="/login" method="POST"><label>Username <input name="username"></label><label>Password <input name="password" type="password"></label><input type="hidden" name="csrf_token" value="' + session.loginToken + '"><button type="submit">Login</button></form>');
      return;
    }

    if (request.method === "POST" && request.url === "/login") {
      if (!session) {
        invalid(response);
        return;
      }
      const form = await readForm(request);
      const username = form.get("username");
      const password = form.get("password");
      if (form.get("csrf_token") !== session.loginToken || username !== session.username || password !== session.password) {
        invalid(response, 401);
        return;
      }
      session.loginToken = null;
      session.authenticated = true;
      response.writeHead(302, { "location": "/dashboard", "content-type": "text/plain; charset=utf-8" });
      response.end("redirecting");
      return;
    }

    if (request.method === "GET" && request.url === "/dashboard") {
      if (!session?.authenticated) {
        invalid(response);
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<h1>Dashboard</h1><a href="/flag">Open the observed flag route</a>');
      return;
    }

    if (request.method === "GET" && request.url === "/flag") {
      if (!session?.authenticated) {
        invalid(response);
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
