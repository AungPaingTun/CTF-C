import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

export async function startH1Fixture() {
  const flag = `${["pico", "CTF"].join("")}\{h1_${randomUUID().replaceAll("-", "")}\}`;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.method === "GET" && request.url === "/") {
      response.end('<!doctype html><a href="/reveal">Continue to the evidence route</a>');
      return;
    }
    if (request.method === "GET" && request.url === "/reveal") {
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end(flag);
      return;
    }
    response.statusCode = 404;
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
