const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { decodeClaims, authClaims } = require("./claims.cjs");

const NATIVE_ID = "native";

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function authPath() {
  return path.join(codexHome(), "auth.json");
}

function read() {
  let auth;
  try {
    auth = JSON.parse(fs.readFileSync(authPath(), "utf8"));
  } catch {
    return null;
  }

  const accessToken = auth?.tokens?.access_token;
  if (!accessToken) return null;

  const identity = decodeClaims(auth.tokens.id_token);
  const claims = authClaims(accessToken);

  return {
    id: NATIVE_ID,
    native: true,
    label: identity.name ?? identity.email ?? "Ana hesap",
    email: identity.email ?? null,
    avatarUrl: identity.picture ?? null,
    accountId: claims.chatgpt_account_id ?? auth.tokens.account_id ?? null,
    planType: claims.chatgpt_plan_type ?? null,
    accessToken,
    refreshToken: auth.tokens.refresh_token ?? null,
    expiresAt: (decodeClaims(accessToken).exp ?? 0) * 1000
  };
}

function writeTokens({ accessToken, refreshToken }) {
  const target = authPath();
  const auth = JSON.parse(fs.readFileSync(target, "utf8"));
  auth.tokens = {
    ...auth.tokens,
    access_token: accessToken,
    refresh_token: refreshToken ?? auth.tokens.refresh_token
  };
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, target);
  return read();
}

function archive(backupPath) {
  const source = authPath();
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(source, backupPath);
  fs.rmSync(source);
  return true;
}

module.exports = { NATIVE_ID, authPath, read, writeTokens, archive };
