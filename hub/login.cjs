const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const store = require("./store.cjs");
const { decodeClaims, authClaims } = require("./claims.cjs");

function codexBinary() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  if (process.resourcesPath) return path.join(process.resourcesPath, "codex");
  return "/Applications/ChatGPT.app/Contents/Resources/codex";
}

function runLogin(codexHome) {
  return new Promise((resolve, reject) => {
    const child = spawn(codexBinary(), ["login"], {
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `codex login çıkış kodu ${code}`));
    });
  });
}

async function addAccount(label) {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-login-"));
  try {
    await runLogin(codexHome);

    const authFile = path.join(codexHome, "auth.json");
    if (!fs.existsSync(authFile)) throw new Error("giriş sonrası auth.json oluşmadı");

    const auth = JSON.parse(fs.readFileSync(authFile, "utf8"));
    const refreshToken = auth?.tokens?.refresh_token;
    const accessToken = auth?.tokens?.access_token;
    if (!refreshToken) throw new Error("auth.json içinde refresh token yok");

    const claims = authClaims(accessToken);
    const identity = decodeClaims(auth?.tokens?.id_token);
    const email = identity.email ?? null;
    const existingCount = store.read().accounts.length;

    return store.upsertAccount({
      id: randomUUID(),
      label: label ?? identity.name ?? email ?? `Abonelik ${existingCount + 1}`,
      email,
      avatarUrl: identity.picture ?? null,
      accountId: claims.chatgpt_account_id ?? auth?.tokens?.account_id ?? null,
      planType: claims.chatgpt_plan_type ?? null,
      refreshToken,
      accessToken,
      expiresAt: (decodeClaims(accessToken).exp ?? 0) * 1000
    });
  } finally {
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
}

module.exports = { addAccount, codexBinary };
