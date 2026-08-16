const path = require("node:path");

const store = require("./store.cjs");
const tokens = require("./tokens.cjs");
const native = require("./native.cjs");

function backupPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(store.userDataDir(), `auth-backup-${stamp}.json`);
}

async function activate(accountId) {
  const credentials = await tokens.credentialsFor(accountId);
  if (!credentials) return { ok: false, error: "no valid token for this account" };
  store.setActive(accountId);
  store.setPreferred(accountId);
  return { ok: true, credentials, view: store.publicView() };
}

async function logoutPlan(accountId) {
  if (!store.findAccount(accountId)) return { ok: false, error: "account not found" };

  if (store.activeAccountId() !== accountId) {
    return { ok: true, next: null, credentials: null, signOut: false };
  }

  const next = store.accounts().find((account) => account.id !== accountId) ?? null;
  if (!next) return { ok: true, next: null, credentials: null, signOut: true };

  const credentials = await tokens.credentialsFor(next.id);
  if (!credentials) return { ok: false, error: `no valid token for ${next.label}` };
  return { ok: true, next: next.id, credentials, signOut: false };
}

function logoutCommit(accountId, nextId) {
  const account = store.findAccount(accountId);
  if (!account) return store.publicView();

  if (account.native) native.archive(backupPath());
  else store.removeAccount(accountId);

  if (nextId) {
    store.setActive(nextId);
    store.setPreferred(nextId);
  } else if (store.read().activeAccountId === accountId) {
    store.setActive(null);
  }

  if (store.read().defaultAccountId === accountId) store.setPreferred(null);

  return store.publicView();
}

module.exports = { activate, logoutPlan, logoutCommit };
