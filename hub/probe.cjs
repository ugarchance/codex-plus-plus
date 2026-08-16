const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { codexBinary } = require("./login.cjs");

const REQUEST_TIMEOUT_MS = 30_000;

function open() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-probe-"));
  const child = spawn(codexBinary(), ["app-server"], {
    env: { ...process.env, CODEX_HOME: home, RUST_LOG: "error" },
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true
  });

  const pending = new Map();
  let nextId = 1;
  let buffer = "";

  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const settle = pending.get(message.id);
      if (settle) {
        pending.delete(message.id);
        settle(message);
      }
    }
  });

  const send = (method, params) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };

  const close = () =>
    new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        try {
          fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch {
          // a locked sqlite file must not cost the collected results; the temp dir is cosmetic
        }
        resolve();
      };
      child.once("exit", finish);
      const giveUp = setTimeout(finish, 5000);
      giveUp.unref?.();
      try {
        child.kill();
      } catch {
        finish();
      }
    });

  return { send, close, child };
}

async function readUsage(credentials) {
  if (credentials.length === 0) return new Map();

  const session = open();
  const results = new Map();

  try {
    await session.send("initialize", {
      clientInfo: { name: "codexpp-hub", version: "1.0.0" },
      capabilities: { experimentalApi: true }
    });
    session.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);

    for (const entry of credentials) {
      try {
        await session.send("account/login/start", {
          type: "chatgptAuthTokens",
          accessToken: entry.accessToken,
          chatgptAccountId: entry.accountId,
          chatgptPlanType: entry.planType ?? null
        });

        const account = await session.send("account/read", { refreshToken: false });
        const limits = await session.send("account/rateLimits/read", {});
        const primary = limits?.rateLimits?.primary;

        results.set(entry.id, {
          email: account?.account?.email ?? null,
          planType: account?.account?.planType ?? entry.planType ?? null,
          usedPercent: typeof primary?.usedPercent === "number" ? primary.usedPercent : null,
          resetAt: typeof primary?.resetsAt === "number" ? primary.resetsAt * 1000 : null,
          usageAt: Date.now()
        });
      } catch (err) {
        console.error(`==> codexpp could not read usage (${entry.id}):`, err.message);
      }
    }
  } finally {
    await session.close();
  }

  return results;
}

module.exports = { readUsage };
