const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const native = require("./native.cjs");

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
      defaultAccountId: data.defaultAccountId ?? null,
      activeAccountId: data.activeAccountId ?? null,
      native: data.native ?? {}
    };
  } catch {
    return { version: 1, accounts: [], assignments: {}, defaultAccountId: null, activeAccountId: null, native: {} };
  }
}

function write(data) {
  const target = storePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, target);
}

function accounts(data = read()) {
  const list = [];
  const base = native.read();
  if (base) list.push({ ...base, ...data.native });

  const claimed = new Set(list.map((a) => a.accountId).filter(Boolean));
  for (const account of data.accounts) {
    if (account.accountId && claimed.has(account.accountId)) continue;
    list.push(account);
  }
  return list;
}

function findAccount(id) {
  return accounts().find((a) => a.id === id) ?? null;
}

function activeAccountId(data = read()) {
  const list = accounts(data);
  const active = list.find((a) => a.id === data.activeAccountId);
  if (active) return active.id;
  return list.find((a) => a.id === native.NATIVE_ID)?.id ?? list[0]?.id ?? null;
}

function updateAccount(id, changes) {
  const data = read();

  if (id === native.NATIVE_ID) {
    data.native = { ...data.native, ...changes };
    write(data);
    return findAccount(id);
  }

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
  write(data);
  return data.accounts[slot];
}

function removeAccount(id) {
  const data = read();
  const index = data.accounts.findIndex((a) => a.id === id);
  if (index === -1) return false;
  data.accounts.splice(index, 1);
  if (data.defaultAccountId === id) data.defaultAccountId = data.accounts[0]?.id ?? null;
  if (data.activeAccountId === id) data.activeAccountId = null;
  delete data.assignments[id];
  write(data);
  return true;
}

function setActive(id) {
  const data = read();
  data.activeAccountId = id;
  write(data);
}

function setPreferred(id) {
  const data = read();
  data.defaultAccountId = id;
  write(data);
}

function publicView() {
  const data = read();
  return {
    activeAccountId: activeAccountId(data),
    defaultAccountId: data.defaultAccountId,
    accounts: accounts(data).map((a) => ({
      id: a.id,
      native: a.native === true,
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

module.exports = {
  storePath,
  userDataDir,
  read,
  write,
  accounts,
  findAccount,
  activeAccountId,
  updateAccount,
  upsertAccount,
  removeAccount,
  setActive,
  setPreferred,
  publicView
};
