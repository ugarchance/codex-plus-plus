const store = require("./store.cjs");
const tokens = require("./tokens.cjs");
const probe = require("./probe.cjs");

const STALE_MS = 60_000;

let inFlight = null;

function stale(account, force) {
  return force || !account.usageAt || Date.now() - account.usageAt >= STALE_MS;
}

async function collect(force) {
  const targets = store.accounts().filter((account) => stale(account, force));
  if (targets.length === 0) return store.publicView();

  const credentials = [];
  for (const account of targets) {
    const accessToken = await tokens.accessTokenFor(account);
    if (!accessToken || !account.accountId) continue;
    credentials.push({
      id: account.id,
      accessToken,
      accountId: account.accountId,
      planType: account.planType ?? null
    });
  }

  const results = await probe.readUsage(credentials);
  for (const { id } of credentials) {
    store.updateAccount(id, results.get(id) ?? { usageAt: Date.now(), usedPercent: null });
  }

  return store.publicView();
}

async function refreshAll({ force = false } = {}) {
  if (!inFlight) {
    inFlight = collect(force).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

module.exports = { refreshAll };
