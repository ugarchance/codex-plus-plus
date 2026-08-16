const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const store = require("./store.cjs");
const { decodeClaims, authClaims } = require("./claims.cjs");

function codexBinary() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const name = process.platform === "win32" ? "codex.exe" : "codex";
  if (process.resourcesPath) return path.join(process.resourcesPath, name);
  if (process.platform === "win32") {
    // outside the app (tools/add-account.mjs): prefer the installed Codex++ copy
    const installed = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "CodexPP", "resources", name);
    if (fs.existsSync(installed)) return installed;
    return name; // resolved from PATH
  }
  return "/Applications/ChatGPT.app/Contents/Resources/codex";
}

function runLogin(codexHome) {
  return new Promise((resolve, reject) => {
    const child = spawn(codexBinary(), ["login"], {
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `codex login exited with code ${code}`));
    });
  });
}

async function storeAccountFromCodexHome(codexHome, label) {
  const authFile = path.join(codexHome, "auth.json");
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(authFile)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!fs.existsSync(authFile)) throw new Error("no auth.json was created after login");

  const auth = JSON.parse(fs.readFileSync(authFile, "utf8"));
  const refreshToken = auth?.tokens?.refresh_token;
  const accessToken = auth?.tokens?.access_token;
  if (!refreshToken) throw new Error("auth.json has no refresh token");

  const claims = authClaims(accessToken);
  const identity = decodeClaims(auth?.tokens?.id_token);
  const email = identity.email ?? null;
  const existingCount = store.read().accounts.length;

  return store.upsertAccount({
    id: randomUUID(),
    label: label ?? identity.name ?? email ?? `Subscription ${existingCount + 1}`,
    email,
    avatarUrl: identity.picture ?? null,
    accountId: claims.chatgpt_account_id ?? auth?.tokens?.account_id ?? null,
    planType: claims.chatgpt_plan_type ?? null,
    refreshToken,
    accessToken,
    expiresAt: (decodeClaims(accessToken).exp ?? 0) * 1000
  });
}

function runDeviceCodeLogin(codexHome, { timeoutMs = 180_000, onPrompt } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(codexBinary(), ["app-server"], {
      env: { ...process.env, CODEX_HOME: codexHome, RUST_LOG: "error" },
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true
    });

    const pending = new Map();
    let nextId = 1;
    let buffer = "";
    let loginId = null;
    let settled = false;
    let timeoutTimer = null;
    let pollTimer = null;

    const cleanup = () =>
      new Promise((res) => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        let closed = false;
        const done = () => {
          if (closed) return;
          closed = true;
          res();
        };
        child.once("exit", done);
        const giveUp = setTimeout(done, 3000);
        giveUp.unref?.();
        try {
          child.kill();
        } catch {
          done();
        }
      });

    const finish = async (err, val) => {
      if (settled) return;
      settled = true;
      await cleanup();
      if (err) reject(err);
      else resolve(val);
    };

    const send = (method, params) => {
      const id = nextId++;
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rej(new Error(`${method} request timed out`));
        }, 15_000);
        pending.set(id, (msg) => {
          clearTimeout(timer);
          if (msg.error) rej(new Error(msg.error.message || `${method} failed`));
          else res(msg.result);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    };

    const notify = (method, params) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    };

    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }

        if (typeof msg.id === "number" && pending.has(msg.id)) {
          const handler = pending.get(msg.id);
          pending.delete(msg.id);
          handler(msg);
        } else if (msg.method) {
          if (msg.method === "account/login/completed") {
            const p = msg.params || {};
            if (p.success) {
              finish(null, true);
            } else {
              finish(new Error(p.error || "Login was not completed"));
            }
          } else if (msg.method === "account/updated") {
            const authFile = path.join(codexHome, "auth.json");
            if (fs.existsSync(authFile)) {
              finish(null, true);
            }
          }
        }
      }
    });

    child.on("error", (err) => {
      finish(err);
    });

    child.on("close", (code) => {
      if (!settled) {
        const authFile = path.join(codexHome, "auth.json");
        if (fs.existsSync(authFile)) {
          finish(null, true);
        } else {
          finish(new Error(`codex app-server exited prematurely with code ${code}`));
        }
      }
    });

    (async () => {
      try {
        await send("initialize", {
          clientInfo: { name: "codexpp-hub", version: "1.0.0" },
          capabilities: { experimentalApi: true }
        });
        notify("initialized", {});

        const loginRes = await send("account/login/start", { type: "chatgptDeviceCode" });
        if (!loginRes || loginRes.type !== "chatgptDeviceCode") {
          throw new Error(`unexpected login response: ${JSON.stringify(loginRes)}`);
        }

        loginId = loginRes.loginId ?? null;
        const userCode = loginRes.userCode;
        const verificationUrl = loginRes.verificationUrl;

        if (!userCode || !verificationUrl) {
          throw new Error("engine did not return userCode or verificationUrl");
        }

        if (typeof onPrompt === "function") {
          onPrompt({ userCode, verificationUrl, loginId });
        }

        timeoutTimer = setTimeout(async () => {
          if (settled) return;
          if (loginId) {
            try {
              await send("account/login/cancel", { loginId });
            } catch {}
          }
          const timeoutErr = new Error(`Device code login timed out after ${Math.round(timeoutMs / 1000)}s`);
          timeoutErr.code = "ETIMEDOUT";
          timeoutErr.isTimeout = true;
          finish(timeoutErr);
        }, timeoutMs);

        pollTimer = setInterval(async () => {
          if (settled) return;
          const authFile = path.join(codexHome, "auth.json");
          if (fs.existsSync(authFile)) {
            try {
              const data = JSON.parse(fs.readFileSync(authFile, "utf8"));
              if (data?.tokens?.refresh_token) {
                finish(null, true);
                return;
              }
            } catch {}
          }
          try {
            const acc = await send("account/read", { refreshToken: false });
            if (acc?.account) {
              finish(null, true);
            }
          } catch {}
        }, 2000);
      } catch (err) {
        finish(err);
      }
    })();
  });
}

async function addAccount(label) {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-login-"));
  try {
    await runLogin(codexHome);
    return await storeAccountFromCodexHome(codexHome, label);
  } finally {
    try {
      fs.rmSync(codexHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
}

async function addAccountDeviceCode(label, timeoutOrOptions, callback) {
  let timeoutMs = 180_000;
  let onPrompt = null;

  if (typeof timeoutOrOptions === "number") {
    timeoutMs = timeoutOrOptions;
    if (typeof callback === "function") onPrompt = callback;
  } else if (typeof timeoutOrOptions === "function") {
    onPrompt = timeoutOrOptions;
  } else if (timeoutOrOptions && typeof timeoutOrOptions === "object") {
    if (typeof timeoutOrOptions.timeoutMs === "number") timeoutMs = timeoutOrOptions.timeoutMs;
    if (typeof timeoutOrOptions.onPrompt === "function") onPrompt = timeoutOrOptions.onPrompt;
    if (typeof timeoutOrOptions.onDeviceCode === "function") onPrompt = timeoutOrOptions.onDeviceCode;
  }

  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-login-dc-"));
  try {
    await runDeviceCodeLogin(codexHome, { timeoutMs, onPrompt });
    return await storeAccountFromCodexHome(codexHome, label);
  } finally {
    try {
      fs.rmSync(codexHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
}

module.exports = { addAccount, addAccountDeviceCode, codexBinary };
