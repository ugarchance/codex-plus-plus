const { app, BrowserWindow, ipcMain } = require("electron");
const providers = require("./providers.cjs");
const gateway = require("./provider-gateway.cjs");
const accounts = require("./store.cjs");
function trusted(event) {return event.senderFrame === event.sender.mainFrame && (event.senderFrame?.url??'').startsWith('app://');}
function changed() {
  for (const w of BrowserWindow.getAllWindows())
    if (!w.isDestroyed()) w.webContents.send("codexpp:providers-changed");
}
function handle(name, fn) {
  ipcMain.handle("codexpp:providers:" + name, async (event, ...args) => {
    if (!trusted(event)) throw Error("Untrusted provider UI");
    try {
      return { ok: true, data: await fn(event, ...args) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}
handle("view", () => providers.view());
handle("catalog", () => providers.catalog());
handle("refresh-registry", async () => {
  await require("./provider-registry.cjs").refresh();
  changed();
  return providers.view();
});
handle("save", (_, input) => {
  const r = providers.save(input);
  changed();
  return r;
});
handle("remove", (_, id) => {
  const r = providers.remove(id);
  changed();
  return r;
});
handle("select", (_, providerId, id) => {
  const r = providers.select(providerId, id);
  changed();
  return r;
});
handle("discover", async (_, id) => {
  const r = await gateway.discover(id);
  changed();
  return r;
});
handle("prepare", (_, modelId, threadId) => gateway.prepare(modelId, threadId));
handle("bind", (_, ticket, threadId) => gateway.bind(ticket, threadId));
handle("route", (_, threadId) => providers.read().routes?.[threadId] ?? null);
handle("usage", async () => {
  await Promise.all([
    require("./usage.cjs").refreshAll({ force: true }),
    require("./provider-usage.cjs").refresh(),
  ]);
  const v = accounts.publicView();
  return {
    native: await Promise.all(
      v.accounts.map(async (a) => {
        try {
          const r = await require("./resets.cjs").creditsFor(a.id, {
            force: true,
          });
          return {
            ...a,
            active: a.id === v.activeAccountId,
            resetCredits: r.available_count,
          };
        } catch {
          return {
            ...a,
            active: a.id === v.activeAccountId,
            resetCredits: null,
          };
        }
      }),
    ),
    providers: providers.view(),
  };
});
const pending = new Map();
handle(
  "native-select",
  (event, id) =>
    new Promise((resolve, reject) => {
      const owner = event.sender;
      if (!owner || owner.isDestroyed())
        return reject(
          Error(
            "Reopen Providers from the main Codex++ window.",
          ),
        );
      if (!accounts.findAccount(id)) return reject(Error("Account not found."));
      const requestId = require("node:crypto").randomUUID();
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(Error("Account selection timed out."));
      }, 20000);
      pending.set(requestId, { owner, resolve, reject, timer });
      owner.send("codexpp:provider-native-select", { requestId, id });
    }),
);
handle("native-selected", (event, requestId, ok) => {
  const p = pending.get(requestId);
  if (!p || p.owner !== event.sender) return;
  pending.delete(requestId);
  clearTimeout(p.timer);
  ok ? p.resolve(true) : p.reject(Error("Unable to switch accounts."));
});
app.on("before-quit", () => gateway.stop());
