#!/usr/bin/env node

import fs from "node:fs";

const host = process.argv[2] ?? "127.0.0.1";
const port = Number(process.argv[3] ?? 19333);
const mode = process.argv[4] ?? "globals";

const targets = await fetch(`http://${host}:${port}/json`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && item.url?.startsWith("app://"));
if (!target?.webSocketDebuggerUrl) throw new Error("Codex app page target not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});

function command(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

if (mode === "globals") {
  const result = await evaluate(`(() => {
    const view = window.__codexpp?.accountsSync?.() ?? null;
    const accounts = view?.accounts ?? [];
    const known = accounts.filter((account) => Number.isFinite(account.usedPercent));
    const totalWeight = known.reduce((sum, account) => sum + (account.planWeight > 0 ? account.planWeight : 1), 0);
    const weightedRemaining = totalWeight
      ? known.reduce((sum, account) => sum + (account.planWeight > 0 ? account.planWeight : 1) * (100 - account.usedPercent), 0) / totalWeight
      : null;
    return {
      globals: {
        codexpp: typeof window.__codexpp,
        frozen: Object.isFrozen(window.__codexpp),
        learnThread: typeof globalThis.__cxpLearnThread,
        autoRoute: typeof globalThis.__cxpAutoRoute,
        markActiveIneligible: typeof globalThis.__cxpMarkActiveIneligible,
        activate: typeof globalThis.__cxpActivate,
        restore: typeof globalThis.__cxpRestore,
        restorePromisePresent: globalThis.__cxpRestorePromise instanceof Promise,
        clientHosts: Object.keys(globalThis.__cxpClients ?? {}).sort(),
      },
      pool: {
        count: accounts.length,
        activePresent: Boolean(view?.activeAccountId),
        defaultPresent: Boolean(view?.defaultAccountId),
        activeIsDefault: Boolean(
          view?.activeAccountId && view.activeAccountId === view.defaultAccountId
        ),
        weightedRemaining,
        roundedWeightedRemaining: weightedRemaining == null ? null : Math.round(weightedRemaining),
        accounts: accounts.map((account) => ({
          active: account.id === view.activeAccountId,
          planType: account.planType,
          planWeight: account.planWeight,
          usedPercent: account.usedPercent,
          windowMins: account.windowMins,
        })),
      },
    };
  })()`);
  console.log(JSON.stringify(result));
} else if (mode === "buttons") {
  const result = await evaluate(`(() => [...document.querySelectorAll('button')]
    .map((button, index) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        index,
        text: (button.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 100),
        ariaLabel: button.getAttribute('aria-label'),
        title: button.getAttribute('title'),
        dataState: button.getAttribute('data-state'),
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    })
    .filter((button) => button.visible))()`);
  console.log(JSON.stringify(result));
} else if (mode === "click") {
  const x = Number(process.argv[5]);
  const y = Number(process.argv[6]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("click mode requires x and y");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const result = await evaluate(`(() => ({
    overlays: [...document.querySelectorAll('[role="menu"], [role="dialog"]')]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map((node) => ({
        role: node.getAttribute('role'),
        text: (node.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 2000),
      })),
    path: location.pathname,
  }))()`);
  console.log(JSON.stringify(result));
} else if (mode === "snapshot") {
  const outputPath = process.argv[5];
  if (!outputPath) throw new Error("snapshot mode requires an output path");
  const result = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(outputPath, Buffer.from(result.data, "base64"));
  console.log(JSON.stringify({ outputPath, bytes: fs.statSync(outputPath).size }));
} else {
  throw new Error(`unknown mode: ${mode}`);
}

socket.close();
