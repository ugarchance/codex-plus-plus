#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const CODEX_BIN = process.env.CODEX_BIN ?? "/Applications/ChatGPT.app/Contents/Resources/codex";
const USER_DATA_DIR = process.env.USER_DATA_DIR ?? path.join(os.homedir(), "Library/Application Support/CodexPP");

function info(msg) {
  console.log(`==> ${msg}`);
}

function die(msg) {
  console.error(`hata: ${msg}`);
  process.exit(1);
}

function claims(jwt) {
  const payload = String(jwt ?? "").split(".")[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function readStore(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      version: data.version ?? 1,
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      assignments: data.assignments ?? {}
    };
  } catch {
    return { version: 1, accounts: [], assignments: {} };
  }
}

function writeStore(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

const label = process.argv[2];
if (!label || label === "--help" || label === "-h") {
  console.log("Kullanım: node tools/hesap-ekle.mjs <etiket>");
  console.log("");
  console.log("Tarayıcıda ChatGPT girişi açar, oturumu Codex++ hesap deposuna ekler.");
  console.log("Etiket hesabı ayırt etmek için: \"Birincil\", \"İş\" gibi.");
  process.exit(label ? 0 : 1);
}

if (!fs.existsSync(CODEX_BIN)) die(`codex çalıştırılabiliri bulunamadı: ${CODEX_BIN}`);

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-login-"));

try {
  info(`giriş açılıyor: ${label}`);
  info("tarayıcıda açılan sayfada eklemek istediğin hesapla giriş yap");

  const result = spawnSync(CODEX_BIN, ["login"], {
    stdio: "inherit",
    env: { ...process.env, CODEX_HOME: tempHome }
  });

  if (result.status !== 0) die(`giriş tamamlanmadı (çıkış kodu ${result.status})`);

  const authFile = path.join(tempHome, "auth.json");
  if (!fs.existsSync(authFile)) die("giriş sonrası auth.json oluşmadı");

  const auth = JSON.parse(fs.readFileSync(authFile, "utf8"));
  const refreshToken = auth?.tokens?.refresh_token;
  const accessToken = auth?.tokens?.access_token;
  if (!refreshToken) die("auth.json içinde refresh token yok");

  const idClaims = claims(auth?.tokens?.id_token);
  const authClaims = claims(accessToken)["https://api.openai.com/auth"] ?? {};
  const accountId = authClaims.chatgpt_account_id ?? auth?.tokens?.account_id ?? null;

  const storeFile = path.join(USER_DATA_DIR, "accounts.json");
  const store = readStore(storeFile);

  const existing = store.accounts.find((a) => a.accountId && a.accountId === accountId);
  if (existing) {
    info(`bu hesap zaten kayıtlı: ${existing.label}, kaydı güncelleniyor`);
  }

  const account = {
    id: existing?.id ?? randomUUID(),
    label,
    email: idClaims.email ?? existing?.email ?? null,
    accountId,
    planType: authClaims.chatgpt_plan_type ?? null,
    refreshToken,
    accessToken,
    expiresAt: claims(accessToken).exp ? claims(accessToken).exp * 1000 : 0
  };

  store.accounts = existing
    ? store.accounts.map((a) => (a.id === existing.id ? account : a))
    : [...store.accounts, account];

  writeStore(storeFile, store);

  info(`eklendi: ${label}${account.email ? ` (${account.email})` : ""}${account.planType ? ` · ${account.planType}` : ""}`);
  info(`toplam ${store.accounts.length} hesap · ${storeFile}`);
} finally {
  fs.rmSync(tempHome, { recursive: true, force: true });
}
