const store = require("./store.cjs");
const tokens = require("./tokens.cjs");
const probe = require("./probe.cjs");
const { emptyUsage } = require("./rate-limits.cjs");

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
    try {
      const accessToken = await tokens.accessTokenFor(account);
      if (!accessToken || !account.accountId) throw new Error('Missing account credentials');
      credentials.push({
        id: account.id,
        accessToken,
        accountId: account.accountId,
        planType: account.planType ?? null
      });
    } catch {
      // One expired/revoked subscription must not freeze every other account.
      // Do not keep presenting its old quota as a current measurement.
      store.updateAccount(account.id, {
        ...emptyUsage(), usageAt: Date.now(),
        usageError: 'Unable to refresh this account session. Sign in again.'
      });
    }
  }

  const results = await probe.readUsage(credentials);
  for (const { id } of credentials) {
    store.updateAccount(id, results.has(id)
      ? { ...results.get(id), usageError: null }
      : { ...emptyUsage(), usageAt: Date.now(), usageError: 'Unable to fetch usage. Try again.' });
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
