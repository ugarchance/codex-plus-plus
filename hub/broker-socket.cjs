const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const broker = require("./turn-broker.cjs");

const MAX_FRAME_BYTES = 1_048_576;
const connections = new Set();
const invocationClients = new Map();
let server = null;
let socketPath = null;
let instanceId = null;

function defaultSocketPath() {
  const { app } = require("electron");
  const data = app.getPath("userData");
  if (process.platform === "win32") {
    const suffix = crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
    return `\\\\.\\pipe\\codexpp-broker-${suffix}`;
  }
  return path.join(data, "harness", "broker-v2.sock");
}

function reply(connection, message) {
  if (connection.destroyed || !connection.writable) return;
  let frame = `${JSON.stringify(message)}\n`;
  if (Buffer.byteLength(frame, 'utf8') > MAX_FRAME_BYTES) {
    frame = JSON.stringify({
      id: typeof message.id === 'string' && message.id.length <= 256 ? message.id : null,
      ok: false,
      error: 'The native result exceeds the 1 MiB broker frame limit; execution may already have completed. Do not retry the operation; inspect the existing native receipt',
    }) + '\n';
  }
  connection.write(frame);
}

function handle(connection) {
  connections.add(connection);
  connection.setEncoding("utf8");
  let buffer = "";
  let requests = 0;
  let activeInvocation = null;
  let invocationSettled = false;
  const detachInvocation = () => {
    if (!activeInvocation) return;
    const { key, token, callId } = activeInvocation;
    const clients = invocationClients.get(key);
    clients?.delete(connection);
    if (clients?.size === 0) {
      invocationClients.delete(key);
      if (!invocationSettled) broker.cancelTool(token, callId, "the MCP client disconnected");
    }
    activeInvocation = null;
  };
  connection.on("data", (chunk) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer, "utf8") > MAX_FRAME_BYTES) {
      reply(connection, { id: null, ok: false, error: "broker frame exceeded the size limit" });
      connection.end();
      return;
    }
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      requests += 1;
      if (requests > 1) {
        reply(connection, { id: null, ok: false, error: "one broker request is allowed per connection" });
        connection.end();
        return;
      }
      let request;
      try { request = JSON.parse(line); } catch {
        reply(connection, { id: null, ok: false, error: "malformed broker request" });
        connection.end();
        return;
      }
      if (request.operation === "probe" && typeof request.nonce === "string") {
        reply(connection, {
          id: request.id ?? null,
          ok: true,
          result: { schemaVersion: 2, instanceId, nonce: request.nonce },
        });
        connection.end();
        return;
      }
      if (request.operation !== "invoke" || !request.request || typeof request.request !== "object") {
        reply(connection, { id: request.id ?? null, ok: false, error: "unsupported broker operation" });
        connection.end();
        return;
      }
      const invocationKey = `${request.token}:${request.request.callId}`;
      const clients = invocationClients.get(invocationKey) ?? new Set();
      clients.add(connection); invocationClients.set(invocationKey, clients);
      activeInvocation = { key: invocationKey, token: request.token, callId: request.request.callId };
      Promise.resolve(broker.requestTool(request.token, request.request)).then(
        (result) => {
          invocationSettled = true; detachInvocation();
          if (request.request.bridgeArguments?.wire_name === require('./web-compaction.cjs').WIRE_NAME) {
            console.log('==> codexpp broker: checkpoint handoff accepted (no ordinary tool dispatch)');
          } else console.log(`==> codexpp broker: native call ${request.request.bridgeTool ?? "tool"} completed`);
          reply(connection, { id: request.id, ok: true, result });
          connection.end();
        },
        (error) => {
          invocationSettled = true; detachInvocation();
          console.error("==> codexpp broker: native call rejected");
          reply(connection, { id: request.id, ok: false, error: error.message });
          connection.end();
        },
      );
    }
  });
  connection.on("end", () => {
    if (requests === 0 && buffer.trim()) connection.destroy(new Error("broker client ended mid-frame"));
  });
  connection.on("error", () => connection.destroy());
  connection.on("close", () => { detachInvocation(); connections.delete(connection); });
}

function probeSocket(target, timeoutMs = 500) {
  return new Promise((resolve, reject) => {
    const probe = net.createConnection(target);
    const timer = setTimeout(() => { probe.destroy(); reject(new Error("broker owner probe timed out; refusing to remove socket")); }, timeoutMs);
    probe.once("connect", () => { clearTimeout(timer); probe.destroy(); resolve(true); });
    probe.once("error", error => { clearTimeout(timer); ["ECONNREFUSED", "ENOENT"].includes(error.code) ? resolve(false) : reject(error); });
  });
}

async function prepareUnixSocket(target) {
  if (!path.isAbsolute(target) || Buffer.byteLength(target) > 100) throw new Error("broker socket requires a short absolute Unix path");
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(target)) return;
  if (await probeSocket(target)) throw new Error(`another live Codex++ broker owns ${target}`);
  const stat = fs.lstatSync(target);
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("broker socket belongs to another user");
  if (!stat.isSocket()) throw new Error(`refusing to remove non-socket broker path ${target}`);
  fs.unlinkSync(target);
}

async function start(target = null) {
  if (server) return { socketPath, instanceId };
  socketPath = target ?? defaultSocketPath();
  instanceId = crypto.randomBytes(16).toString("hex");
  if (!socketPath.startsWith("\\\\.\\pipe\\")) await prepareUnixSocket(socketPath);

  server = net.createServer(handle);
  server.on("error", (error) => console.error("==> codexpp broker socket:", error.message));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  if (process.platform !== "win32") fs.chmodSync(socketPath, 0o600);
  return { socketPath, instanceId };
}

async function stop() {
  if (!server) return;
  const closing = server;
  const closingPath = socketPath;
  server = null;
  socketPath = null;
  instanceId = null;
  for (const connection of connections) connection.destroy();
  connections.clear();
  await new Promise((resolve) => closing.close(resolve));
  if (closingPath && process.platform !== "win32" && fs.existsSync(closingPath)) fs.unlinkSync(closingPath);
}

function address() {
  return socketPath;
}

module.exports = { start, stop, address, defaultSocketPath, prepareUnixSocket, MAX_FRAME_BYTES };
