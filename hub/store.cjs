const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function userDataDir() {
  if (process.env.USER_DATA_DIR) return process.env.USER_DATA_DIR;
  try {
    return require("electron").app.getPath("userData");
  } catch {
    return path.join(os.homedir(), "Library/Application Support/CodexPP");
  }
}

function storePath() {
  return path.join(userDataDir(), "accounts.json");
}

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    return {
      version: data.version ?? 1,
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      assignments: data.assignments ?? {},
      defaultAccountId: data.defaultAccountId ?? null
    };
  } catch {
    return { version: 1, accounts: [], assignments: {}, defaultAccountId: null };
  }
}

function write(data) {
  const target = storePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, target);
}

function updateAccount(id, changes) {
  const data = read();
  const index = data.accounts.findIndex((a) => a.id === id);
  if (index === -1) return null;
  data.accounts[index] = { ...data.accounts[index], ...changes };
  write(data);
  return data.accounts[index];
}

function upsertAccount(account) {
  const data = read();
  const index = data.accounts.findIndex(
    (a) => a.id === account.id || (account.accountId && a.accountId === account.accountId)
  );
  const slot = index === -1 ? data.accounts.length : index;
  data.accounts[slot] = index === -1 ? account : { ...data.accounts[index], ...account, id: data.accounts[index].id };
  if (!data.defaultAccountId) data.defaultAccountId = data.accounts[slot].id;
  write(data);
  return data.accounts[slot];
}

function publicView() {
  const data = read();
  return {
    defaultAccountId: data.defaultAccountId,
    accounts: data.accounts.map((a) => ({
      id: a.id,
      label: a.label ?? null,
      email: a.email ?? null,
      planType: a.planType ?? null,
      accountId: a.accountId ?? null,
      avatarUrl: a.avatarUrl ?? null,
      usedPercent: a.usedPercent ?? null,
      resetAt: a.resetAt ?? null
    })),
    assignments: data.assignments
  };
}

module.exports = { storePath, userDataDir, read, write, updateAccount, upsertAccount, publicView };
