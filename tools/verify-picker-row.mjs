#!/usr/bin/env node

const host = process.argv[2] ?? "127.0.0.1";
const port = Number(process.argv[3] ?? 19333);

const targets = await fetch(`http://${host}:${port}/json`).then((r) => r.json());
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

const command = (method, params = {}) => {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickCenter(box) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await command("Input.dispatchMouseEvent", {
      type, x, y, button: "left", clickCount: type === "mouseMoved" ? 0 : 1, buttons: type === "mousePressed" ? 1 : 0,
    });
    await wait(40);
  }
}

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${label}${detail !== undefined ? `  ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const triggerBox = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll("button")];
  const hit = buttons.find(b => /Sol|Terra|Luna|Auto|5\\.\\d|Spark|Daybreak/i.test(b.innerText ?? ""));
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height, text: hit.innerText.slice(0, 40) });
})()`);

if (!triggerBox) {
  check("composer model trigger found", false, "no button matched the model-name pattern");
} else {
  const box = JSON.parse(triggerBox);
  check("composer model trigger found", true, JSON.stringify(box.text));
  await clickCenter(box);
  await wait(700);

  const modelRowBox = await evaluate(`(() => {
    const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')].at(-1);
    if (!menu) return null;
    const row = [...menu.querySelectorAll('[role="menuitem"]')].find(i => /^Model /.test(i.getAttribute("aria-label") ?? ""));
    if (!row) return JSON.stringify({ error: "no Model row", labels: [...menu.querySelectorAll('[role="menuitem"]')].map(i => i.getAttribute("aria-label")).slice(0, 8) });
    const r = row.getBoundingClientRect();
    return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
  })()`);

  const parsedRow = modelRowBox ? JSON.parse(modelRowBox) : null;
  check("model submenu row reachable", Boolean(parsedRow && !parsedRow.error), modelRowBox);

  if (parsedRow && !parsedRow.error) {
    await clickCenter(parsedRow);
    await wait(900);

    const listing = await evaluate(`(() => {
      const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')].at(-1);
      if (!menu) return null;
      return menu.innerText;
    })()`);

    check("model list rendered", Boolean(listing), listing ? `${listing.split("\n").length} rows` : "no open menu");
    if (listing) {
      const hasWebRow = /ChatGPT Web/i.test(listing);
      check("ChatGPT Web row is visible in the picker", hasWebRow, hasWebRow ? "" : listing.slice(0, 400).replace(/\n/g, " | "));
    }
  }
}

await evaluate(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`).catch(() => {});
socket.close();
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed`);
process.exit(failures ? 1 : 0);
