import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

function frame(text) {
  const payload = Buffer.from(text);
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length <= 0xffff) return Buffer.concat([Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]), payload]);
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(payload.length));
  return Buffer.concat([Buffer.from([0x81, 127]), length, payload]);
}

function readFrames(socket, onText, onTooMany) {
  let buffer = Buffer.alloc(0);
  let messages = 0;
  const consume = () => {
    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      if ((first & 0x0f) !== 1 || !(second & 0x80)) return socket.end();
      let length = second & 0x7f;
      let headerLength = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); headerLength = 4; }
      if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); headerLength = 10; }
      if (length > 65536 || buffer.length < headerLength + 4 + length) return;
      const mask = buffer.subarray(headerLength, headerLength + 4);
      const payload = Buffer.alloc(length);
      for (let index = 0; index < length; index += 1) payload[index] = buffer[headerLength + 4 + index] ^ mask[index % 4];
      buffer = buffer.subarray(headerLength + 4 + length);
      messages += 1;
      if (messages > 8) return onTooMany();
      onText(payload.toString("utf8"));
    }
  };
  socket.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); consume(); });
}

export async function startP10Fixture() {
  const session = randomUUID().replaceAll("-", "");
  const flag = `picoCTF{p10_${randomUUID().replaceAll("-", "")}}`;
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.setHeader("content-type", "text/html");
      response.setHeader("set-cookie", `p10_session=${session}; Path=/; HttpOnly`);
      response.end('<script>const socket = new WebSocket("/ws/"); socket.onmessage = (event) => console.log(event.data); socket.send("runtime:ready");</script>');
      return;
    }
    if (request.url === "/ws/") {
      response.writeHead(426, { Upgrade: "websocket", Connection: "Upgrade" });
      response.end("WebSocket required");
      return;
    }
    if (request.url === "/flag") {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  server.on("upgrade", (request, socket) => {
    if (request.url !== "/ws/" || request.headers.cookie !== `p10_session=${session}` || request.headers.origin !== origin) return socket.destroy();
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") return socket.destroy();
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    readFrames(socket, (message) => {
      if (message === "runtime:slow") return setTimeout(() => socket.write(frame("slow-response")), 1000);
      if (message === "runtime:many") { socket.write(frame("first-response")); return socket.write(frame("second-response")); }
      const response = message === "runtime:ready" ? flag : message === "runtime:large" ? "x".repeat(65537) : "try-again";
      socket.write(frame(response));
      if (response === flag) setTimeout(() => socket.end(), 10);
    }, () => socket.end());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    flagPattern: /^picoCTF\{p10_[0-9a-f]+\}$/,
    async stop() { await new Promise((resolve) => server.close(resolve)); },
  };
}
