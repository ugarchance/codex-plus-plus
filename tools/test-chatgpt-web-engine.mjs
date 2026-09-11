#!/usr/bin/env node

// Local integration: real installed Codex engine + production gateway/broker/native programs, with
// only the ChatGPT browser surface replaced by a deterministic adapter. It reads auth.json into an
// isolated CODEX_HOME and never writes the real home. Set CXP_ENGINE_SILENCE_MS=65000 to exercise
// parser-visible heartbeat beyond the engine's ordinary idle interval.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const hubRequire = createRequire(new URL("../hub/", import.meta.url));
const broker = hubRequire("./turn-broker.cjs");
const native = hubRequire("./native-tools.cjs");
const silenceMs = Number(process.env.CXP_ENGINE_SILENCE_MS ?? 2_000);
const codexBin = process.env.CODEX_BIN ?? (process.platform === "win32"
  ? path.join(process.env.LOCALAPPDATA ?? "", "Programs", "CodexPP", "resources", "codex.exe")
  : "/Applications/CodexPP.app/Contents/Resources/codex");

const tokens = [];
const conversationKeys = [];
let logicalTurn = 0;
let nativeRoundCount = 0;
let advertisedNames = [];
let execPolicyBlocker = null;

function textOf(result) {
  return (result?.content ?? []).filter((part) => part?.type === "text").map((part) => part.text).join("\n");
}

async function nativeRound(token, callId, bridgeTool, args) {
  nativeRoundCount += 1;
  return broker.requestTool(token, {
    callId,
    wireName: "functions.exec",
    kind: "freeform",
    input: native.buildNativeProgram(bridgeTool, { turn_token: token, ...args }),
    bridgeTool,
  }, { timeoutMs: 60_000 });
}

const sessionPath = hubRequire.resolve("./web-session.cjs");
hubRequire.cache[sessionPath] = {
  id: sessionPath,
  filename: sessionPath,
  loaded: true,
  exports: {
    runTurn({ key, token, onDelta }) {
      logicalTurn += 1;
      const thisTurn = logicalTurn;
      tokens.push(token);
      conversationKeys.push(key);
      const run = (async () => {
        if (thisTurn === 1) {
          await new Promise((resolve) => setTimeout(resolve, silenceMs));
          onDelta?.("Native araç zincirini doğruluyorum. ");
          let cursor = 0;
          advertisedNames = [];
          for (let page = 0; page < 10; page += 1) {
            const inventory = await nativeRound(token, `engine-turn-1-inventory-${page}`, "codex_tool_inventory", { cursor, page_size: 50 });
            assert.equal(inventory.isError, false);
            advertisedNames.push(...inventory.structuredContent.tools.map((tool) => tool.name));
            if (inventory.structuredContent.nextCursor === null) break;
            cursor = inventory.structuredContent.nextCursor;
          }
          assert.ok(advertisedNames.includes("exec_command"));
          assert.ok(advertisedNames.includes("write_stdin"));
          assert.ok(advertisedNames.includes("view_image"));
          const viewed = await nativeRound(token, "engine-turn-1-image", "codex_view_image", {
            path: path.join(work, "pixel.png"),
          });
          assert.equal(viewed.content.some((part) => part.type === "image"), true);
          const created = await nativeRound(token, "engine-turn-1-create", "codex_exec", {
            cmd: process.platform === "win32"
              ? "Set-Content -LiteralPath .\\chatgpt-web-engine.txt -Value 'first-turn' -NoNewline"
              : "printf first-turn > ./chatgpt-web-engine.txt",
            ...(process.platform === "win32" ? { shell: "powershell.exe" } : {}),
          });
          if (created.isError && /blocked by policy/i.test(textOf(created))) {
            execPolicyBlocker = textOf(created).split("\n")[0];
            return { text: "first-turn-complete-with-native-policy-blocker", effort: { applied: true, now: 2 }, reused: false, chars: 1 };
          }
          assert.equal(created.isError, false, textOf(created));
          const read = await nativeRound(token, "engine-turn-1-read", "codex_exec", {
            cmd: process.platform === "win32" ? "Get-Content -LiteralPath .\\chatgpt-web-engine.txt" : "cat ./chatgpt-web-engine.txt",
            ...(process.platform === "win32" ? { shell: "powershell.exe" } : {}),
          });
          assert.match(textOf(read), /first-turn/);
          const long = await nativeRound(token, "engine-turn-1-long", "codex_exec", {
            cmd: process.platform === "win32"
              ? "Write-Output long-start; Start-Sleep -Seconds 12; Write-Output long-finish"
              : "printf 'long-start\\n'; sleep 12; printf 'long-finish\\n'",
            yield_time_ms: 10_000,
            ...(process.platform === "win32" ? { shell: "powershell.exe" } : {}),
          });
          assert.ok(Number.isInteger(long.session_id), `long command did not return session_id: ${JSON.stringify(Object.keys(long))}`);
          const continued = await nativeRound(token, "engine-turn-1-stdin", "codex_write_stdin", {
            session_id: long.session_id,
            chars: "",
            yield_time_ms: 30_000,
          });
          assert.match(textOf(continued), /long-finish/);
          assert.equal(continued.exit_code, 0);
          return { text: "first-turn-complete", effort: { applied: true, now: 2 }, reused: false, chars: 1 };
        }

        assert.notEqual(token, tokens[0]);
        await assert.rejects(
          nativeRound(tokens[0], "engine-old-token", "codex_exec", { cmd: "echo stale" }),
          /revoked|no active/i,
        );
        if (execPolicyBlocker) {
          const viewed = await nativeRound(token, "engine-turn-2-image", "codex_view_image", {
            path: path.join(work, "pixel.png"),
          });
          assert.equal(viewed.content.some((part) => part.type === "image"), true);
          return { text: "second-turn-complete-with-native-policy-blocker", effort: { applied: true, now: 2 }, reused: true, chars: 1 };
        }
        const changed = await nativeRound(token, "engine-turn-2-change", "codex_exec", {
          cmd: process.platform === "win32"
            ? "Set-Content -LiteralPath .\\chatgpt-web-engine.txt -Value 'second-turn' -NoNewline"
            : "printf second-turn > ./chatgpt-web-engine.txt",
          ...(process.platform === "win32" ? { shell: "powershell.exe" } : {}),
        });
        assert.equal(changed.isError, false, textOf(changed));
        const read = await nativeRound(token, "engine-turn-2-read", "codex_exec", {
          cmd: process.platform === "win32" ? "Get-Content -LiteralPath .\\chatgpt-web-engine.txt" : "cat ./chatgpt-web-engine.txt",
          ...(process.platform === "win32" ? { shell: "powershell.exe" } : {}),
        });
        assert.match(textOf(read), /second-turn/);
        return { text: "second-turn-complete", effort: { applied: true, now: 2 }, reused: true, chars: 1 };
      })().catch((error) => {
        console.error(`browser-stub failure: ${error.message}`);
        throw error;
      });
      run.leaseId = `stub-${thisTurn}`;
      run.cancel = () => {};
      return run;
    },
  },
};

const gateway = hubRequire("./gateway.cjs");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-web-engine-home-"));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-web-engine-work-"));
fs.writeFileSync(path.join(work, "pixel.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
const realAuth = path.join(os.homedir(), ".codex", "auth.json");
if (!fs.existsSync(codexBin)) throw new Error(`installed Codex engine not found: ${codexBin}`);
if (!fs.existsSync(realAuth)) throw new Error("auth.json is required for the real-engine contract test");
fs.copyFileSync(realAuth, path.join(home, "auth.json"));
fs.chmodSync(path.join(home, "auth.json"), 0o600);
const catalogPath = path.join(home, "catalog.json");
const auth = JSON.parse(fs.readFileSync(realAuth, "utf8"));
const accessToken = auth?.tokens?.access_token;
const accountId = auth?.tokens?.account_id;
if (!accessToken || !accountId) throw new Error("auth.json does not contain the native access/account fields needed for the catalog request");
const catalogResponse = await fetch("https://chatgpt.com/backend-api/codex/models?client_version=0.153.4", {
  headers: {
    authorization: `Bearer ${accessToken}`,
    "chatgpt-account-id": accountId,
    originator: "codex_cli_rs",
    "user-agent": "codex_cli_rs/0.153.4",
    version: "0.153.4",
    accept: "application/json",
  },
});
if (!catalogResponse.ok) throw new Error(`native model catalog request failed with HTTP ${catalogResponse.status}`);
const nativeCatalog = await catalogResponse.json();
const template = nativeCatalog.models?.find((model) => model.slug === "gpt-5.6-sol") ?? nativeCatalog.models?.[0];
if (!template) throw new Error("native model catalog did not contain a template row");
const webModel = {
  ...structuredClone(template),
  slug: "chatgpt-web/sol-full",
  display_name: "ChatGPT Web — Sol (Full)",
  description: "Local engine contract fixture",
  supported_reasoning_levels: [{ effort: "high", description: "High" }],
  default_reasoning_level: "high",
  multi_agent_version: "disabled",
  tool_mode: "code_mode_only",
  prefer_websockets: false,
};
delete webModel.comp_hash;
fs.writeFileSync(catalogPath, JSON.stringify({ models: [webModel] }));
fs.writeFileSync(path.join(home, "config.toml"), [
  'model = "gpt-5.6-sol"',
  'approval_policy = "never"',
  'sandbox_mode = "workspace-write"',
  'stream_max_retries = 1',
  'request_max_retries = 1',
  "",
].join("\n"));

const notifications = [];
const pending = new Map();
let child = null;
let nextId = 1;
let buffer = "";

function send(method, params, timeoutMs = 180_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function responseTurnId(value) {
  return value?.turn?.id ?? value?.turnId ?? value?.id ?? null;
}

function eventTurnId(message) {
  return message?.params?.turn?.id ?? message?.params?.turnId ?? message?.params?.turn_id ?? null;
}

async function waitTurn(startIndex, expectedTurnId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const terminal = notifications.slice(startIndex).find((message) => ["turn/completed", "turn/failed"].includes(message.method)
      && (!expectedTurnId || eventTurnId(message) === expectedTurnId));
    if (terminal) return terminal;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("real engine turn did not reach a terminal notification");
}

try {
  const { baseUrl } = await gateway.start();
  child = spawn(codexBin, ["app-server"], {
    env: { ...process.env, CODEX_HOME: home, RUST_LOG: "error" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id !== undefined && pending.has(message.id)) {
        const settle = pending.get(message.id);
        pending.delete(message.id);
        settle(message);
      } else if (message.method) notifications.push(message);
    }
  });

  await send("initialize", { clientInfo: { name: "codexpp-web-engine", version: "2" }, capabilities: { experimentalApi: true } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);
  const thread = await send("thread/start", {
    cwd: work,
    model: "chatgpt-web/sol-full",
    config: {
      openai_base_url: baseUrl,
      model_catalog_json: catalogPath,
      features: { code_mode: true, code_mode_only: true },
    },
    allowProviderModelFallback: false,
  });
  const threadId = thread?.threadId ?? thread?.thread?.id ?? thread?.id;
  assert.ok(threadId);

  let offset = notifications.length;
  const firstTurn = await send("turn/start", { threadId, model: "chatgpt-web/sol-full", input: [{ type: "text", text: "first local contract turn" }] });
  let terminal = await waitTurn(offset, responseTurnId(firstTurn), silenceMs + 180_000);
  assert.equal(terminal.method, "turn/completed", stderr.slice(0, 500));
  if (!execPolicyBlocker && !fs.existsSync(path.join(work, "chatgpt-web-engine.txt"))) {
    const errors = notifications.slice(offset)
      .filter((message) => message.method === "error")
      .map((message) => message.params?.error?.message ?? message.params?.message)
      .filter(Boolean);
    throw new Error(`first turn completed without the native file effect (browserCalls=${logicalTurn}, events=${notifications.slice(offset).map((message) => message.method).join(",")}, errors=${JSON.stringify(errors)})`);
  }
  if (!execPolicyBlocker) assert.equal(fs.readFileSync(path.join(work, "chatgpt-web-engine.txt"), "utf8").trim(), "first-turn");

  offset = notifications.length;
  const secondTurn = await send("turn/start", { threadId, model: "chatgpt-web/sol-full", input: [{ type: "text", text: "second local contract turn" }] });
  terminal = await waitTurn(offset, responseTurnId(secondTurn));
  assert.equal(terminal.method, "turn/completed", stderr.slice(0, 500));
  if (!execPolicyBlocker) assert.equal(fs.readFileSync(path.join(work, "chatgpt-web-engine.txt"), "utf8").trim(), "second-turn");
  assert.equal(tokens.length, 2);
  assert.notEqual(tokens[0], tokens[1]);
  assert.equal(conversationKeys[0], conversationKeys[1]);
  assert.ok(nativeRoundCount >= 4);
  console.log(`PASS real engine: ${nativeRoundCount} native rounds, fresh second-turn token, retained conversation, silence=${silenceMs}ms`);
  if (!advertisedNames.includes("apply_patch")) console.log("BLOCKED real engine native patch: installed engine did not advertise apply_patch in this turn");
  if (execPolicyBlocker) console.log(`BLOCKED real engine exec/write_stdin/file effect: native policy rejected its shell process (${execPolicyBlocker})`);
} finally {
  if (child) {
    child.stdin.end();
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once("close", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
  }
  await gateway.stop();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
}
