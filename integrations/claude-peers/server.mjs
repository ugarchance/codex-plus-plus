#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

const HOME = os.homedir();
const SESSIONS_DIR = process.env.CLAUDE_SESSIONS_DIR || path.join(HOME, ".claude", "sessions");
const SELF_NAME = process.env.CLAUDE_PEERS_NAME || "codex";
const REQUIRE_AUTH = process.env.CLAUDE_PEERS_REQUIRE_AUTH === "1";
const SERVER_NAME = "claude-peers";
const SERVER_VERSION = "1.0.0";
const PEER_PROTOCOL = 1;
const VERSION_FLOOR = "2.1.0";

const inbox = [];
let self = null;

const log = (msg) => process.stderr.write(`[claude-peers] ${msg}\n`);

function socketPathFor(pid) {
  if (process.platform === "win32") return `\\\\.\\pipe\\cc-socks-${pid}`;
  const base = process.env.XDG_RUNTIME_DIR
    ? path.join(process.env.XDG_RUNTIME_DIR, "cc-socks")
    : "/tmp/cc-socks";
  return path.join(base, `${pid}.sock`);
}

function loadRecords() {
  let names = [];
  try {
    names = fs.readdirSync(SESSIONS_DIR);
  } catch {
    return [];
  }
  const records = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      records.push(JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, name), "utf8")));
    } catch {
      /* half-written registry file */
    }
  }
  return records;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function peerToken(pid) {
  let names = [];
  try {
    names = fs.readdirSync(SESSIONS_DIR);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.startsWith(`${pid}.`) || !name.endsWith(".key")) continue;
    try {
      return JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, name), "utf8")).peerToken;
    } catch {
      return null;
    }
  }
  return null;
}

function probeSocket(sockPath, timeout = 400) {
  return new Promise((resolve) => {
    if (!sockPath) return resolve("missing");
    if (process.platform !== "win32" && !fs.existsSync(sockPath)) return resolve("missing");
    const client = net.connect(sockPath);
    const done = (verdict) => {
      client.removeAllListeners();
      client.destroy();
      resolve(verdict);
    };
    client.setTimeout(timeout, () => done("dead"));
    client.on("connect", () => done("live"));
    client.on("error", (err) => done(err.code === "EACCES" ? "denied" : "dead"));
  });
}

function claudePeerVersion() {
  const parse = (raw) => String(raw || "").split(".").slice(0, 3).map(Number);
  let best = VERSION_FLOOR;
  let bestParts = parse(VERSION_FLOOR);
  for (const record of loadRecords()) {
    if (record.entrypoint === "codex-mcp") continue;
    const parts = parse(record.version);
    if (parts.length !== 3 || parts.some(Number.isNaN)) continue;
    for (let i = 0; i < 3; i += 1) {
      if (parts[i] > bestParts[i]) {
        best = record.version;
        bestParts = parts;
        break;
      }
      if (parts[i] < bestParts[i]) break;
    }
  }
  return best;
}

async function liveSessions() {
  const out = [];
  for (const record of loadRecords()) {
    if (!pidAlive(record.pid) || record.pid === process.pid) continue;
    out.push({
      pid: record.pid,
      name: (record.name || "(unnamed)").trim(),
      sessionId: record.sessionId,
      cwd: record.cwd,
      kind: record.kind,
      status: record.status,
      version: record.version,
      peerProtocol: record.peerProtocol,
      socket: record.messagingSocketPath,
      socketStatus: await probeSocket(record.messagingSocketPath),
      addressable: peerToken(record.pid) != null,
    });
  }
  return out;
}

async function resolveTarget({ name, pid }) {
  const sessions = await liveSessions();
  let hits;
  if (pid != null) {
    hits = sessions.filter((s) => s.pid === pid);
  } else {
    const needle = String(name || "").trim().toLowerCase();
    hits = sessions.filter((s) => s.name.toLowerCase() === needle);
    if (hits.length === 0 && needle) {
      hits = sessions.filter((s) => s.name.toLowerCase().includes(needle));
    }
  }
  if (hits.length === 0) throw new Error(`no live Claude session matches ${name ?? pid}`);
  if (hits.length > 1) {
    const listing = hits.map((s) => `${s.name} (pid ${s.pid})`).join(", ");
    throw new Error(`ambiguous target, select by pid: ${listing}`);
  }
  return hits[0];
}

function sendToSession(target, text, replyHint) {
  const token = peerToken(target.pid);
  if (!token) throw new Error(`no peerToken readable for pid ${target.pid}`);

  const address = self?.address;
  let body = text;
  if (replyHint && address) {
    body = `${text}\n\n[Codex peer] Reply with: SendMessage(to: "${address}", message: "...")`;
  }
  const content = address
    ? `<cross-session-message from="${address}" from-name="${SELF_NAME}">\n${body}\n</cross-session-message>`
    : body;

  const frame = {
    msgV: 1,
    msg_id: randomUUID(),
    type: "user",
    message: { role: "user", content },
    priority: "next",
    ...(address ? { from: address } : {}),
  };

  return new Promise((resolve, reject) => {
    const client = net.connect(target.socket);
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      client.removeAllListeners();
      client.destroy();
      fn(arg);
    };
    client.setTimeout(5000, () => finish(reject, new Error("timed out writing to peer socket")));
    client.on("error", (err) => finish(reject, err));
    client.on("connect", () => {
      client.write(
        `${JSON.stringify({ type: "auth", token })}\n${JSON.stringify(frame)}\n`,
        () => finish(resolve, frame.msg_id),
      );
    });
  });
}

const ENVELOPE = /^<cross-session-message((?: [a-z-]+="[^"]*")*)>\n([\s\S]*)\n<\/cross-session-message>$/;

function parseEnvelope(text) {
  const match = ENVELOPE.exec(text);
  if (!match) return { from: null, fromName: null, body: text };
  const attrs = {};
  for (const [, key, value] of match[1].matchAll(/ ([a-z-]+)="([^"]*)"/g)) attrs[key] = value;
  return {
    from: attrs.from ?? null,
    fromName: attrs["from-name"] ?? null,
    fromMode: attrs["from-mode"] ?? null,
    body: match[2],
  };
}

function drainInbox({ waitMs = 0, fromName = null } = {}) {
  const deadline = Date.now() + Math.max(0, waitMs);
  return new Promise((resolve) => {
    const attempt = () => {
      const taken = inbox.splice(0, inbox.length);
      const parsed = taken.map((item) => ({
        ...parseEnvelope(item.raw),
        receivedAt: item.receivedAt,
      }));
      let keep = parsed;
      if (fromName) {
        keep = parsed.filter((p) => (p.fromName || "").toLowerCase() === fromName.toLowerCase());
        for (const p of parsed) {
          if (!keep.includes(p)) inbox.push({ receivedAt: p.receivedAt, raw: p.body });
        }
      }
      if (keep.length > 0 || Date.now() >= deadline) return resolve(keep);
      setTimeout(attempt, 200);
    };
    attempt();
  });
}

function startListener() {
  const pid = process.pid;
  const sockPath = socketPathFor(pid);
  if (process.platform !== "win32") {
    fs.mkdirSync(path.dirname(sockPath), { recursive: true, mode: 0o700 });
    if (fs.existsSync(sockPath)) fs.unlinkSync(sockPath);
  }

  const token = randomUUID().replace(/-/g, "");
  const server = net.createServer((conn) => {
    let authed = !REQUIRE_AUTH;
    let buf = "";
    conn.setTimeout(30000, () => conn.destroy());
    conn.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          continue;
        }
        if (frame.type === "auth") {
          authed = frame.token === token;
          if (!authed) return conn.destroy();
          continue;
        }
        if (!authed) return conn.destroy();
        if (frame.type !== "user") continue;
        let content = frame.message?.content;
        if (Array.isArray(content)) {
          content = content.map((part) => part?.text ?? "").join("");
        }
        inbox.push({ receivedAt: Date.now() / 1000, raw: content || "" });
      }
    });
    conn.on("error", () => conn.destroy());
  });

  server.listen(sockPath);
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(sockPath, 0o600);
    } catch {
      /* best effort */
    }
  }

  const now = Date.now();
  const record = {
    pid,
    sessionId: randomUUID(),
    cwd: process.cwd(),
    startedAt: now,
    procStart: new Date().toString(),
    version: claudePeerVersion(),
    peerProtocol: PEER_PROTOCOL,
    peerFeatures: [],
    kind: "interactive",
    entrypoint: "codex-mcp",
    pidDomain: process.platform === "win32" ? "win32" : "darwin",
    messagingSocketPath: sockPath,
    name: SELF_NAME,
    nameSource: "user",
    nameSince: now,
    updatedAt: now,
    status: "idle",
    statusUpdatedAt: now,
  };

  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const jsonPath = path.join(SESSIONS_DIR, `${pid}.json`);
  const keyPath = path.join(SESSIONS_DIR, `${pid}.${randomUUID().replace(/-/g, "")}.key`);
  fs.writeFileSync(jsonPath, JSON.stringify(record));
  fs.writeFileSync(
    keyPath,
    JSON.stringify({ peerToken: token, pidDomain: record.pidDomain, procStart: record.procStart }),
    { mode: 0o600 },
  );

  self = { address: `uds:${sockPath}`, name: SELF_NAME, pid, socket: sockPath, jsonPath, keyPath, server };
  log(`listening on ${sockPath} as '${SELF_NAME}'`);
}

function cleanup() {
  if (!self) return;
  const targets = [self.jsonPath, self.keyPath];
  if (process.platform !== "win32") targets.push(self.socket);
  for (const target of targets) {
    try {
      fs.unlinkSync(target);
    } catch {
      /* already gone */
    }
  }
  self = null;
}

const TOOLS = [
  {
    name: "list_claude_sessions",
    description:
      "List live Claude Code sessions on this machine (name, pid, cwd, status, whether they can be messaged). Use before sending.",
    inputSchema: {
      type: "object",
      properties: {
        only_addressable: {
          type: "boolean",
          description: "Return only sessions that can actually receive a message.",
        },
      },
    },
  },
  {
    name: "send_message_to_claude",
    description:
      "Send a message to a live Claude Code session. It arrives there as a user prompt. Delivery is one-way; ask for a reply explicitly and then call read_claude_messages.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Target session name from list_claude_sessions." },
        pid: { type: "integer", description: "Target pid, for disambiguation." },
        message: { type: "string", description: "Message body." },
        expect_reply: {
          type: "boolean",
          description: "Append this server's reply address to the message. Default true.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "read_claude_messages",
    description:
      "Read messages Claude sessions sent back to Codex. Drains the inbox; set wait_seconds to block until a reply arrives.",
    inputSchema: {
      type: "object",
      properties: {
        wait_seconds: { type: "number", description: "Block up to N seconds (default 0)." },
        from_name: { type: "string", description: "Only messages from this session name." },
      },
    },
  },
  {
    name: "claude_peer_address",
    description: "This server's own peer address and name, as Claude sessions see it.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name, args) {
  if (name === "list_claude_sessions") {
    let sessions = await liveSessions();
    if (args.only_addressable) {
      sessions = sessions.filter((s) => s.addressable && s.socketStatus === "live");
    }
    return { count: sessions.length, sessions };
  }
  if (name === "send_message_to_claude") {
    if (!args.message) throw new Error("message is required");
    const target = await resolveTarget({ name: args.name, pid: args.pid });
    const msgId = await sendToSession(target, args.message, args.expect_reply !== false);
    return {
      delivered: true,
      msg_id: msgId,
      to: { name: target.name, pid: target.pid },
      note: "Delivery only. The peer has not necessarily acted on it.",
    };
  }
  if (name === "read_claude_messages") {
    const messages = await drainInbox({
      waitMs: Number(args.wait_seconds || 0) * 1000,
      fromName: args.from_name || null,
    });
    return { count: messages.length, messages };
  }
  if (name === "claude_peer_address") {
    return {
      name: self?.name ?? null,
      address: self?.address ?? null,
      pid: self?.pid ?? null,
      listening: Boolean(self),
    };
  }
  throw new Error(`unknown tool ${name}`);
}

function respond(id, payload) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...payload })}\n`);
}

async function handleRequest(request) {
  const { id, method, params = {} } = request;
  if (method === "initialize") {
    return respond(id, {
      result: {
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    });
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") return respond(id, { result: { tools: TOOLS } });
  if (method === "tools/call") {
    try {
      const result = await callTool(params.name, params.arguments || {});
      return respond(id, {
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    } catch (err) {
      return respond(id, {
        result: { content: [{ type: "text", text: `${err.name}: ${err.message}` }], isError: true },
      });
    }
  }
  if (id != null) respond(id, { error: { code: -32601, message: `unknown method ${method}` } });
}

function main() {
  try {
    startListener();
  } catch (err) {
    log(`listener unavailable (${err.message}); send/list still work, inbox will not`);
  }

  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        continue;
      }
      handleRequest(request);
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

for (const signal of ["exit", "SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    cleanup();
    if (signal !== "exit") process.exit(0);
  });
}

main();
