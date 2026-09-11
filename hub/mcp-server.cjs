// Spawned by tunnel-client as --mcp-command. It exposes a narrow bridge; every native operation is
// sent back to the active Codex turn and therefore keeps the native sandbox/approval/UI lifecycle.

const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { TOOLS, validateArguments } = require("./native-tools.cjs");

const PROTOCOLS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const DEFAULT_PROTOCOL = "2025-06-18";
const CALL_TIMEOUT_MS = 90_000;
const MAX_FRAME_BYTES = 1_048_576;

function socketArgument(argv = process.argv) {
  const index = argv.indexOf("--broker-socket");
  return index === -1 ? null : argv[index + 1];
}

function argumentValue(name, argv = process.argv) {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1];
}

function hashCall(token, rpcId, name, args) {
  // Live ChatGPT reuses JSON-RPC id=0, including within one MCP process/session.
  // Only a caller-owned invocation id can distinguish a retry from a new call.
  if(typeof args?.request_id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(args.request_id))throw Error('Missing request_id; refresh Codex++ Native v2 actions before retrying');
  return `bridge_${crypto.createHash("sha256").update(JSON.stringify({ token, requestId:args.request_id })).digest("hex").slice(0, 32)}`;
}

function exchangeBroker(socketPath, payload, { timeoutMs = CALL_TIMEOUT_MS, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (!socketPath) {
      reject(new Error("Codex++ Native v2 started without a broker socket"));
      return;
    }
    const connection = net.createConnection(socketPath);
    let buffer = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      connection.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("the Codex++ broker call timed out")), timeoutMs);
    const abort = () => finish(new Error("the MCP invocation was cancelled"));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    connection.setEncoding("utf8");
    connection.on("connect", () => connection.write(`${JSON.stringify(payload)}\n`));
    connection.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > MAX_FRAME_BYTES) {
        finish(new Error("the Codex++ broker reply exceeded the frame limit"));
        return;
      }
      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      let response;
      try { response = JSON.parse(buffer.slice(0, nl)); } catch {
        finish(new Error("the Codex++ broker sent a malformed reply"));
        return;
      }
      if (response.id !== payload.id) { finish(new Error("the Codex++ broker reply id did not match the request")); return; }
      if (response.ok) finish(null, response.result);
      else finish(new Error(response.error ?? "the Codex++ broker rejected the call"));
    });
    connection.on("end", () => {
      if (!settled && !buffer.includes("\n")) finish(new Error("the Codex++ broker closed before sending a complete reply"));
    });
    connection.on("close", () => {
      if (!settled) finish(new Error("the Codex++ broker closed before sending a complete reply"));
    });
    connection.on("error", () => finish(new Error("the Codex++ broker is not reachable")));
  });
}

function callBroker(socketPath, token, request, options) {
  return exchangeBroker(socketPath, {
    id: request.callId,
    operation: "invoke",
    token,
    request,
  }, options);
}

function probeBroker(socketPath, nonce, options) {
  return exchangeBroker(socketPath, {
    id: `probe_${crypto.createHash("sha256").update(String(nonce)).digest("hex").slice(0, 16)}`,
    operation: "probe",
    nonce,
  }, { timeoutMs: 5_000, ...options });
}

function errorResult(error) {
  return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
}

function normalizeMcpResult(result) {
  if (result && typeof result === "object" && Array.isArray(result.content)) {
    return { ...result, content: result.content.map(part => {
      if (part?.type !== 'input_image' && !(part?.type === 'image' && part.image_url)) return part;
      // Reference index.brokerContent: Responses image URLs are not MCP content
      // blocks. Preserve bytes as an image (or a remote resource link), not text.
      const { type, image_url, detail, ...rest } = part;
      const source = typeof image_url === 'string' ? image_url : image_url?.url;
      if (typeof source !== 'string') throw new Error('Native tool image has no supported URL');
      const metadata = { ...rest, ...(detail ? { _meta: { ...rest._meta, 'codex/imageDetail': detail } } : {}) };
      if (source.startsWith('data:')) {
        const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
        if (!match || Buffer.from(match[2], 'base64').toString('base64') !== match[2]) throw new Error('Native tool image has invalid base64 data');
        return { ...metadata, type: 'image', data: match[2], mimeType: match[1] };
      }
      const url = new URL(source);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Native tool image URL scheme is unsupported');
      return { ...metadata, type: 'resource_link', uri: source, name: 'Codex tool image', mimeType: 'image/*' };
    }) };
  }
  return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result ?? null) }], isError: false };
}

function createMessageHandler({ socketPath, instanceId = null, note = () => {}, probeBrokerFn = probeBroker } = {}) {
  return async function handle(message, { signal } = {}) {
    const ok = (result) => ({ jsonrpc: "2.0", id: message.id, result });
    const failed = (code, text) => ({ jsonrpc: "2.0", id: message.id, error: { code, message: text } });
    switch (message.method) {
      case "initialize": {
        const requested = message.params?.protocolVersion ?? DEFAULT_PROTOCOL;
        if (typeof requested !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
          return failed(-32602, "MCP protocolVersion must be a date-formatted version");
        }
        // MCP version negotiation requires offering a supported version when the client's newest
        // version is not supported. This does not claim support for that newer protocol.
        const negotiated = PROTOCOLS.has(requested) ? requested : DEFAULT_PROTOCOL;
        return ok({
          protocolVersion: negotiated,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "codexpp-native-v2", title: "Codex++ Native v2", version: "2.1.0" },
          instructions: "Calls are scoped to a current Codex logical-turn token and execute only through that turn's advertised native tools.",
        });
      }
      case "tools/list":
        return ok({ tools: TOOLS });
      case "tools/call": {
        const name = message.params?.name;
        if (!TOOLS.some((tool) => tool.name === name)) return failed(-32602, `Unknown tool: ${name}`);
        const args = message.params?.arguments ?? {};
        try {
          validateArguments(name, args);
          const callId = hashCall(args.turn_token, message.id, name, args);
          const result = await callBroker(socketPath, args.turn_token, {
            callId,
            bridgeTool: name,
            bridgeArguments: args,
          }, { signal });
          note(`${name} ok`);
          return ok(normalizeMcpResult(result));
        } catch (error) {
          note(`${name} failed`);
          return ok(errorResult(error));
        }
      }
      case "ping":
        {
          // Standard MCP ping has no params and proves only transport liveness. Our explicit nonce
          // extension below additionally checks broker/schema/instance readiness for the launcher.
          if (message.params?.nonce === undefined) return ok({});
          const nonce = message.params?.nonce ?? null;
          if (typeof nonce !== "string" || !nonce) return failed(-32602, "ping requires a non-empty nonce");
          let brokerProbe;
          try {
            brokerProbe = await probeBrokerFn(socketPath, nonce);
          } catch (error) {
            return failed(-32001, `Broker readiness failed: ${error.message}`);
          }
        return ok({
          schemaVersion: 2,
          connector: "codexpp-native-v2",
          instanceId,
          nonce,
          broker: brokerProbe,
        });
        }
      default:
        return failed(-32601, `Method not found: ${message.method}`);
    }
  };
}

function runStdio({ argv = process.argv, input = process.stdin, output = process.stdout } = {}) {
  const socketPath = socketArgument(argv);
  const instanceId = argumentValue("--instance-id", argv);
  const logFile = socketPath && !socketPath.startsWith("\\\\.\\pipe\\")
    ? path.join(path.dirname(socketPath), "mcp-v2.log")
    : null;
  const note = (line) => {
    if (!logFile) return;
    try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`); } catch {}
  };
  const handle = createMessageHandler({ socketPath, instanceId, note });
  const write = (message) => output.write(`${JSON.stringify(message)}\n`);
  let buffer = "";
  const inFlight = new Map();
  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer, "utf8") > MAX_FRAME_BYTES) {
      write({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "MCP frame exceeded the size limit" } });
      buffer = "";
      return;
    }
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch {
        write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        continue;
      }
      if (message.method === "notifications/cancelled") {
        inFlight.get(message.params?.requestId)?.abort(); continue;
      }
      if (message.id === undefined) continue;
      if (inFlight.has(message.id)) {
        write({ jsonrpc: "2.0", id: message.id, error: { code: -32600, message: "MCP request id is already active" } }); continue;
      }
      const controller = new AbortController(); inFlight.set(message.id, controller);
      // Do not await here: independent parent/child native requests must not block the shared MCP
      // stdio channel behind a long-running tool.
      Promise.resolve(handle(message, { signal: controller.signal })).then(write, (error) => write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: error.message },
      })).finally(() => inFlight.delete(message.id));
    }
  });
  input.on("end", () => {
    for (const controller of inFlight.values()) controller.abort();
    if (buffer.trim()) write({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "MCP input ended mid-frame" } });
  });
}

if (require.main === module) runStdio();

module.exports = {
  TOOLS,
  PROTOCOLS,
  MAX_FRAME_BYTES,
  callBroker,
  probeBroker,
  createMessageHandler,
  normalizeMcpResult,
  runStdio,
};
