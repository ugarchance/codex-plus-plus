const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const broker = require("./turn-broker.cjs");

let server = null;
let socketPath = null;

function defaultSocketPath() {
  const { app } = require("electron");
  return path.join(app.getPath("userData"), "harness", "broker.sock");
}

function handle(connection) {
  connection.setEncoding("utf8");
  let buffer = "";

  const reply = (message) => connection.write(`${JSON.stringify(message)}\n`);

  connection.on("data", async (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;

      let request;
      try {
        request = JSON.parse(line);
      } catch {
        continue;
      }

      try {
        const output = await broker.requestTool(request.token, request.script);
        console.log(`==> codexpp broker: codex_exec ok, ${output.length} chars back`);
        reply({ id: request.id, ok: true, output });
      } catch (err) {
        console.error(`==> codexpp broker: codex_exec rejected (${err.message})`);
        reply({ id: request.id, ok: false, error: err.message });
      }
    }
  });

  connection.on("error", () => connection.destroy());
}

async function start(target = null) {
  if (server) return { socketPath };

  socketPath = target ?? defaultSocketPath();
  fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  fs.rmSync(socketPath, { force: true });

  server = net.createServer(handle);
  server.on("error", (err) => console.error("==> codexpp broker socket:", err.message));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  fs.chmodSync(socketPath, 0o600);

  return { socketPath };
}

async function stop() {
  if (!server) return;
  const closing = server;
  server = null;
  await new Promise((resolve) => closing.close(resolve));
  if (socketPath) fs.rmSync(socketPath, { force: true });
  socketPath = null;
}

function address() {
  return socketPath;
}

module.exports = { start, stop, address };
