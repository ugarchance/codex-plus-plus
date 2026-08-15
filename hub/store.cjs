const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const EMPTY = { version: 1, accounts: [], assignments: {} };

function storePath() {
  return path.join(app.getPath("userData"), "accounts.json");
}

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    return {
      version: data.version ?? 1,
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      assignments: data.assignments ?? {}
    };
  } catch {
    return { ...EMPTY, accounts: [], assignments: {} };
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

function publicView() {
  const data = read();
  return {
    accounts: data.accounts.map((a) => ({
      id: a.id,
      label: a.label ?? null,
      email: a.email ?? null,
      planType: a.planType ?? null,
      accountId: a.accountId ?? null
    })),
    assignments: data.assignments
  };
}

module.exports = { storePath, read, write, updateAccount, publicView };
