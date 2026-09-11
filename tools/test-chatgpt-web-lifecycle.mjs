#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const native = require("../hub/native-tools.cjs");
const contract = require("../hub/web-contract.cjs");
const mcp = require("../hub/mcp-server.cjs");
const tunnel = require("../hub/tunnel.cjs");
const gateway = require("../hub/gateway.cjs");
const broker = require("../hub/turn-broker.cjs");
const brokerSocket = require("../hub/broker-socket.cjs");
const webSession = require("../hub/web-session.cjs");
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

async function runNativeProgram(name, args, advertised, implementations) {
  const emitted = [];
  const program = native.buildNativeProgram(name, args);
  const execute = new Function("tools", "ALL_TOOLS", "text", `return (async()=>{${program}\n})()`);
  await execute(implementations, advertised.map((toolName) => ({ name: toolName, description: `${toolName} docs` })), (value) => emitted.push(value));
  assert.equal(emitted.length, 1);
  return contract.normalizeRichResult(emitted[0]);
}

test("exec and write_stdin preserve session, exit, error and structured fields", async () => {
  const exec = await runNativeProgram("codex_exec", { turn_token: "token", cmd: "long" }, ["exec_command"], {
    exec_command: async () => ({
      output: "started",
      session_id: 42,
      exit_code: null,
      content: [{ type: "text", text: "started" }],
      structuredContent: { phase: "running" },
      isError: false,
    }),
  });
  assert.equal(exec.session_id, 42);
  assert.equal(exec.exit_code, null);
  assert.deepEqual(exec.structuredContent, { phase: "running" });

  const continued = await runNativeProgram("codex_write_stdin", { turn_token: "token", session_id: 42, chars: "\n" }, ["write_stdin"], {
    write_stdin: async () => ({
      output: "done",
      session_id: 42,
      exit_code: 7,
      content: [{ type: "text", text: "done" }],
      isError: true,
    }),
  });
  assert.equal(continued.session_id, 42);
  assert.equal(continued.exit_code, 7);
  assert.equal(continued.isError, true);
});

test("native patch, image, inventory and exact direct tool call use advertised tools only", async () => {
  let patchInput = null;
  const patchResult = await runNativeProgram("codex_apply_patch", { turn_token: "token", patch: "*** Begin Patch" }, ["apply_patch"], {
    apply_patch: async (input) => { patchInput = input; return { content: [{ type: "text", text: "ok" }], isError: false }; },
  });
  assert.equal(patchInput, "*** Begin Patch");
  assert.equal(patchResult.isError, false);

  const image = await runNativeProgram("codex_view_image", { turn_token: "token", path: "C:\\tmp\\image.png" }, ["view_image"], {
    view_image: async () => ({ content: [{ type: "image", data: "AA==", mimeType: "image/png" }], isError: false }),
  });
  assert.equal(image.content[0].type, "image");

  const inventory = await runNativeProgram("codex_tool_inventory", { turn_token: "token", cursor: 1, page_size: 1 }, ["first", "second", "third"], {});
  assert.equal(inventory.structuredContent.tools[0].name, "second");
  assert.equal(inventory.structuredContent.nextCursor, 2);

  let directArgs = null;
  const direct = await runNativeProgram("codex_tool_call", {
    turn_token: "token",
    wire_name: "mcp__demo__lookup",
    kind: "function",
    arguments: { id: 9 },
  }, ["mcp__demo__lookup"], {
    mcp__demo__lookup: async (args) => { directArgs = args; return { content: [{ type: "text", text: "found" }], isError: false }; },
  });
  assert.deepEqual(directArgs, { id: 9 });
  assert.equal(direct.content[0].text, "found");
  const missing = await runNativeProgram("codex_tool_call", {
    turn_token: "token", wire_name: "mcp__missing__lookup", kind: "function", arguments: {},
  }, ["mcp__demo__lookup"], { mcp__demo__lookup: async () => ({}) });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /found none|advertised native tool/i);
});

test("MCP negotiates schema and proves its broker with an instance-bound nonce", async () => {
  const handle = mcp.createMessageHandler({
    socketPath: null,
    instanceId: "instance-1",
    probeBrokerFn: async (_socket, nonce) => ({ schemaVersion: 2, instanceId: "broker-1", nonce }),
  });
  const init = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(init.result.serverInfo.name, "codexpp-native-v2");
  const list = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(list.result.tools.length, 6);
  const ping = await handle({ jsonrpc: "2.0", id: 3, method: "ping", params: { nonce: "nonce-1" } });
  assert.deepEqual(ping.result, {
    schemaVersion: 2,
    connector: "codexpp-native-v2",
    instanceId: "instance-1",
    nonce: "nonce-1",
    broker: { schemaVersion: 2, instanceId: "broker-1", nonce: "nonce-1" },
  });
  const malformed = await handle({ jsonrpc: "2.0", id: 4, method: "initialize", params: { protocolVersion: "invalid" } });
  assert.equal(malformed.error.code, -32602);
  const discover = await handle({ jsonrpc: "2.0", id: 5, method: "server/discover", params: {} });
  assert.equal(discover.error.code, -32601);
});

test("live ChatGPT MCP version offer negotiates an explicitly supported version", async () => {
  const handle = mcp.createMessageHandler();
  for (const protocolVersion of ["2025-11-25", "2099-01-01"]) {
    const response = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion } });
    assert.equal(response.error, undefined);
    assert.equal(response.result.protocolVersion, "2025-06-18");
    assert.ok(mcp.PROTOCOLS.has(response.result.protocolVersion));
  }
});

test("standard MCP ping is liveness only and does not require a broker nonce", async () => {
  const handle = mcp.createMessageHandler({ probeBrokerFn: () => { throw new Error("Must not probe broker"); } });
  const response = await handle({ jsonrpc: "2.0", id: 1, method: "ping" });
  assert.deepEqual(response, { jsonrpc: "2.0", id: 1, result: {} });
});

test("MCP ping reaches the live broker nonce endpoint", async () => {
  const target = process.platform === "win32"
    ? `\\\\.\\pipe\\codexpp-web-test-${crypto.randomUUID()}`
    : path.join(os.tmpdir(), `codexpp-web-test-${crypto.randomUUID()}.sock`);
  await brokerSocket.start(target);
  try {
    const probe = await mcp.probeBroker(target, "broker-nonce", { timeoutMs: 1_000 });
    assert.equal(probe.schemaVersion, 2);
    assert.equal(probe.nonce, "broker-nonce");
    assert.match(probe.instanceId, /^[a-f0-9]{32}$/);
  } finally {
    await brokerSocket.stop();
  }
});

test("composer select-all shortcut is platform-correct", () => {
  assert.equal(webSession.selectAllModifier("darwin"), "meta");
  assert.equal(webSession.selectAllModifier("win32"), "control");
  assert.equal(webSession.selectAllModifier("linux"), "control");
});

test("MCP readiness rejects stale schema, wrong instance and spawn errors", async () => {
  const fakeProbe = (mode) => {
    const manager = tunnel.createTunnelManager({
      platform: "linux",
      resourcesPath: () => "/fixture/resources",
      userDir: () => "/fixture/user",
      spawn: (_command, args) => {
        const child = makeChild();
        if (mode === "spawn-error") {
          queueMicrotask(() => child.emit("error", new Error("denied")));
          return child;
        }
        const expected = args[args.indexOf("--instance-id") + 1];
        child.stdin.write = (line) => {
          const message = JSON.parse(line);
          let result;
          if (message.method === "initialize") result = { serverInfo: { name: "codexpp-native-v2" } };
          if (message.method === "tools/list") result = { tools: mode === "stale" ? [{ name: "codex_exec" }] : mode === 'stale-ping-action' ? native.TOOLS.map(t => ({ ...t, inputSchema: { type: 'object', properties: { action: { enum: ['ping'] } } } })) : native.TOOLS };
          if (message.method === "ping") result = {
            schemaVersion: 2,
            instanceId: mode === "wrong-instance" ? "wrong" : expected,
            nonce: message.params.nonce,
            broker: { schemaVersion: 2, instanceId: "broker-fixture", nonce: message.params.nonce },
          };
          queueMicrotask(() => child.stdout.emit("data", `${JSON.stringify({ id: message.id, result })}\n`));
        };
        return child;
      },
    });
    return manager.probeMcp("/tmp/broker.sock", 500);
  };
  await assert.rejects(fakeProbe("stale"), /schema, instance or nonce/i);
  await assert.rejects(fakeProbe('stale-ping-action'), /schema, instance or nonce/i);
  await assert.rejects(fakeProbe("wrong-instance"), /schema, instance or nonce/i);
  await assert.rejects(fakeProbe("spawn-error"), /spawn failed/i);
});

test("broker EOF before newline is a bounded failure", async () => {
  const server = net.createServer((socket) => socket.end('{"ok":true'));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(
      mcp.callBroker(server.address().port, "token", { callId: "call-eof", input: "x" }, { timeoutMs: 500 }),
      /closed before sending a complete reply/i,
    );
  } finally {
    server.closeAllConnections?.();
    await Promise.race([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
  }
});

test("compaction paths are exact, tool-free and advance the retained epoch", () => {
  assert.equal(gateway.requestPath("/backend-api/codex/responses/compact?x=1"), "/backend-api/codex/responses/compact");
  assert.equal(contract.isCompactionRequest({}, "/backend-api/codex/responses/compact"), "v1");
  assert.equal(contract.isCompactionRequest({}, "/backend-api/codex/responses/compact-extra"), null);
  assert.equal(contract.isCompactionRequest({ input: [{ type: "compaction_trigger" }] }, "/backend-api/codex/responses"), "v2");
  const metadata = { "x-codex-turn-metadata": JSON.stringify({ thread_id: "thread-c", turn_id: "turn-c", context_window_id: "old" }) };
  const source = {
    model: "chatgpt-web/sol-full",
    client_metadata: metadata,
    input: [
      { type: "additional_tools", tools: [{ type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec" }] }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "latest work" }] },
    ],
  };
  const compactPrompt = contract.compilePrompt(source, { harness: false, compaction: true });
  assert.deepEqual(JSON.parse(compactPrompt.text.split("<codex_context_json>\n")[1].split("\n</codex_context_json>")[0]).task_context.advertised_native_tools, []);
  const replacement = contract.buildCompactionReplacement(source, "summary");
  assert.equal(replacement.at(-1).role, "user");
  const replay = { ...source, input: replacement };
  assert.notEqual(contract.parseTurnIdentity(source).epoch, contract.parseTurnIdentity(replay).epoch);
});

test("two HTTP round owners cannot consume one browser promise", async () => {
  const key = `owner-${crypto.randomUUID()}`;
  broker.begin(key, { turnId: "turn-owner", replace: true });
  const first = broker.waitForTool(key, new Promise(() => {}), { roundId: "round-one" });
  await assert.rejects(
    broker.waitForTool(key, new Promise(() => {}), { roundId: "round-two" }),
    /already owns/i,
  );
  const firstRejected = assert.rejects(first, /done/i);
  broker.end(key, "done");
  await firstRejected;
});

test("gateway route readiness and generation change across restart", async () => {
  const before = gateway.routeInfo();
  assert.equal(before.ready, false);
  const first = await gateway.start();
  assert.equal(gateway.routeInfo().ready, true);
  assert.equal(gateway.routeInfo().generation, first.generation);
  await gateway.stop();
  assert.equal(gateway.routeInfo().ready, false);
  const second = await gateway.start();
  assert.ok(second.generation > first.generation);
  assert.ok(second.baseUrl.startsWith("http://127.0.0.1:"));
  await gateway.stop();
});

function makeStream() {
  const stream = new EventEmitter();
  stream.setEncoding = () => stream;
  return stream;
}

function makeChild() {
  const child = new EventEmitter();
  child.stdout = makeStream();
  child.stderr = makeStream();
  child.stdin = { write() {}, end() {} };
  child.kill = () => { child.killed = true; queueMicrotask(() => { child.emit("exit", 0, null); child.emit('close', 0); }); };
  return child;
}

test("tunnel profile uses the required main channel", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-profile-test-"));
  try {
    const manager = tunnel.createTunnelManager({ userDir: () => root, resourcesPath: () => root });
    const profile = JSON.parse(fs.readFileSync(manager.writeProfile(`tunnel_${"a".repeat(32)}`, "test.sock"), "utf8"));
    assert.equal(profile.mcp.commands[0].channel, "main");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("tunnel quoting handles spaces/apostrophes and stop cancels a queued restart", async () => {
  const posix = tunnel.commandLine(["/A B/node", "/tmp/O'Reilly/server", "--broker-socket", "/tmp/a b.sock"], "linux");
  assert.match(posix, /^'\/A B\/node' /);
  assert.match(posix, /O'"'"'Reilly/);
  const windows = tunnel.commandLine(["C:\\Program Files\\node.exe", "C:\\a b\\server.cjs"], "win32");
  assert.equal(windows, '"C:\\\\Program Files\\\\node.exe" "C:\\\\a b\\\\server.cjs"');
  assert.throws(() => tunnel.commandLine(["bad\npath"], "win32"), /newline/i);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-tunnel-test-"));
  const resources = path.join(root, "resources");
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  fs.mkdirSync(path.join(resources, "cua_node", "bin"), { recursive: true });
  fs.mkdirSync(path.join(resources, "hub"), { recursive: true });
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ tunnelId: `tunnel_${"a".repeat(32)}` }));
  fs.writeFileSync(path.join(root, "runtime-key"), "not-a-real-key");
  fs.writeFileSync(path.join(root, "bin", "tunnel-client"), "fixture");
  fs.writeFileSync(path.join(resources, "cua_node", "bin", "node"), "fixture");
  fs.writeFileSync(path.join(resources, "hub", "mcp-server.cjs"), "fixture");
  const scheduled = [];
  let spawnCount = 0;
  let tunnelChild = null;
  const spawn = (_command, args) => {
    spawnCount += 1;
    const child = makeChild();
    if (args[0]?.endsWith("mcp-server.cjs")) {
      const instanceId = args[args.indexOf("--instance-id") + 1];
      child.stdin.write = (line) => {
        const message = JSON.parse(line);
        let result;
        if (message.method === "initialize") result = { serverInfo: { name: "codexpp-native-v2" } };
        if (message.method === "tools/list") result = { tools: native.TOOLS };
        if (message.method === "ping") result = {
          schemaVersion: 2,
          instanceId,
          nonce: message.params.nonce,
          broker: { schemaVersion: 2, instanceId: "broker-fixture", nonce: message.params.nonce },
        };
        queueMicrotask(() => child.stdout.emit("data", `${JSON.stringify({ id: message.id, result })}\n`));
      };
    } else {
      tunnelChild = child;
    }
    return child;
  };
  const manager = tunnel.createTunnelManager({
    platform: "linux",
    resourcesPath: () => resources,
    userDir: () => root,
    spawn,
    fetch: async (url) => {
      assert.equal(new URL(url).pathname, "/readyz");
      return { ok: true };
    },
    delay: async () => {
      if (!fs.existsSync(path.join(root, "health.url"))) {
        fs.writeFileSync(path.join(root, "health.url"), "http://127.0.0.1:1/");
      }
    },
    setTimeout: (callback) => { const timer = { callback, unref() {} }; scheduled.push(timer); return timer; },
    clearTimeout: (timer) => { timer.cancelled = true; },
    drainTimeoutMs: 15,
  });
  try {
    const started = await manager.start("/tmp/broker.sock");
    assert.equal(started.ready, true);
    tunnelChild.emit("exit", 1, null);
    tunnelChild.emit('close', 1);
    assert.equal(manager.status().phase, "restart-wait");
    const beforeStop = spawnCount;
    manager.stop();
    for (const timer of scheduled) if (!timer.cancelled) timer.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(spawnCount, beforeStop);
    assert.equal(manager.status().phase, "stopped");
    await manager.start('/tmp/broker.sock');
    tunnelChild.kill = () => {};
    const drain = await manager.stop();
    assert.equal(drain.drained, false);
    const beforeBlockedRestart = spawnCount;
    assert.equal((await manager.start('/tmp/broker.sock')).ready, false);
    assert.equal(spawnCount, beforeBlockedRestart);
    tunnelChild.emit('close', 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

let failures = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(`  ${error?.stack ?? error}`);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} ChatGPT Web lifecycle tests passed`);
if (failures) process.exitCode = 1;
