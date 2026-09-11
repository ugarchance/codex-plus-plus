// Task-owned documents and bounded capacity follow the MIT reference browser-host
// / concurrency contract. Codex++ starts with two documents, not unbounded fan-out.
function createPool(createSession, capacity = 2) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 2) throw Error('Unsupported Web browser capacity');
  const entries = [{ session: createSession(), owner: null, used: 0 }];
  let selected = entries[0], clock = 0;
  const every = (method, ...args) => entries.map(entry => entry.session[method](...args)).some(Boolean);
  return {
    ...selected.session,
    open: options => selected.session.open(options),
    effortTrigger: (...args) => selected.session.effortTrigger(...args),
    setEffort: (...args) => selected.session.setEffort(...args),
    async status() {
      return { ...await selected.session.status(), capacity,
        leases: entries.map(entry => ({ threadId: entry.owner, ...entry.session.leaseStatus() })) };
    },
    runTurn(options) {
      const owner = options.identity?.threadId ?? (options.request ? require('./web-contract.cjs').parseTurnIdentity(options.request).threadId : null);
      let entry = owner === null ? entries[0] : entries.find(item => item.owner === owner);
      if (!entry) entry = entries.find(item => item.owner === null && !item.session.leaseStatus().active);
      if (!entry && entries.length < capacity) { entry = { session: createSession(), owner: null, used: 0 }; entries.push(entry); }
      if (!entry) entry = entries.filter(item => !item.session.leaseStatus().active).sort((a,b)=>a.used-b.used)[0];
      if (!entry || entry.session.leaseStatus().active) throw Error('ChatGPT Web browser capacity is occupied; no other task or physical lease was replaced');
      // An idle document may be reused, but its runTurn still proves canonical
      // context/account and refuses to overwrite any unowned draft.
      const previous = entry.owner;
      entry.owner = owner;
      try {
        const run = entry.session.runTurn(options);
        selected = entry; entry.used = ++clock;
        return run;
      } catch (error) { entry.owner = previous; throw error; }
    },
    cancelTurn: (...args) => every('cancelTurn', ...args),
    cancelThread: (...args) => every('cancelThread', ...args),
    commitContext: (...args) => every('commitContext', ...args),
    resetConversation: () => every('resetConversation'),
    close: () => { for (const entry of entries) entry.session.close(); },
  };
}
module.exports = { createPool };
