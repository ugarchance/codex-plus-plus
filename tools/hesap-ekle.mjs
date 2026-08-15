#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const label = process.argv[2];
if (!label || label === "--help" || label === "-h") {
  console.log("Kullanım: node tools/hesap-ekle.mjs <etiket>");
  console.log("");
  console.log("Tarayıcıda ChatGPT girişi açar, oturumu Codex++ hesap deposuna ekler.");
  console.log("Etiket hesabı ayırt etmek için: \"Birincil\", \"İş\" gibi.");
  process.exit(label ? 0 : 1);
}

const store = require(path.join(repoDir, "hub/store.cjs"));
const login = require(path.join(repoDir, "hub/login.cjs"));

console.log(`==> giriş açılıyor: ${label}`);
console.log("==> tarayıcıda açılan sayfada eklemek istediğin hesapla giriş yap");

let added;
try {
  added = await login.addAccount(label);
} catch (err) {
  console.error(`hata: ${err.message}`);
  process.exit(1);
}

console.log(`==> eklendi: ${added.label}${added.email ? ` (${added.email})` : ""}${added.planType ? ` · ${added.planType}` : ""}`);
console.log(`==> toplam ${store.read().accounts.length} hesap · ${store.storePath()}`);
