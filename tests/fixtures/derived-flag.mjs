import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

export async function startDerivedFlagFixture() {
  const flag = `picoCTF{derived_${randomUUID().replaceAll("-", "")}}`;
  const encoded = Buffer.from(flag, "utf8").toString("base64");
  const server = createServer((request, response) => {
    if (request.url === "/") { response.writeHead(302, { location: "/step-one" }); response.end(); return; }
    if (request.url === "/step-one") { response.writeHead(302, { location: "/step-two" }); response.end(); return; }
    if (request.url === "/step-two") { response.setHeader("content-type", "text/plain; charset=utf-8"); response.end(encoded); return; }
    response.writeHead(404); response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { origin: `http://127.0.0.1:${address.port}`, async stop() { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); } };
}
