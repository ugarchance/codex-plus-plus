#!/usr/bin/env node

const host = process.argv[2] ?? "127.0.0.1";
const port = Number(process.argv[3] ?? 19333);

const targets = await fetch(`http://${host}:${port}/json`).then((r) => r.json());
const target = targets.find((item) => item.type === "page" && item.url?.startsWith("https://chatgpt.com"));
if (!target?.webSocketDebuggerUrl) throw new Error("ChatGPT window target not found");

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
  if (result.exceptionDetails) throw new Error(String(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text));
  return result.result.value;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickCenter(box) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await command("Input.dispatchMouseEvent", {
      type, x, y, button: "left",
      clickCount: type === "mouseMoved" ? 0 : 1,
      buttons: type === "mousePressed" ? 1 : 0,
    });
    await wait(50);
  }
}

const triggerRaw = await evaluate(`(() => {
  const composer = document.querySelector('#prompt-textarea, [contenteditable="true"]');
  if (!composer) return JSON.stringify({ error: "no composer" });
  let scope = composer.closest("form") ?? composer.parentElement;
  for (let i = 0; i < 6 && scope?.parentElement; i++) scope = scope.parentElement;
  const button = [...scope.querySelectorAll('button, [role="button"]')]
    .find(b => b.getAttribute("aria-expanded") !== null && (b.innerText ?? "").trim().length > 0
      && !/dictation|voice|files/i.test(b.getAttribute("aria-label") ?? ""));
  if (!button) return JSON.stringify({ error: "no effort trigger" });
  const r = button.getBoundingClientRect();
  return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height, current: button.innerText.trim() });
})()`);

const trigger = JSON.parse(triggerRaw);
if (trigger.error) {
  console.log(`[FAIL] effort trigger: ${trigger.error}`);
  console.log("  → hesapta effort seçicisi görünmüyor (Luna-only hesap göstergesi)");
  socket.close();
  process.exit(1);
}
console.log(`[ok] effort trigger bulundu — şu an seçili: ${JSON.stringify(trigger.current)}`);

await clickCenter(trigger);
await wait(900);

const menuRaw = await evaluate(`(() => {
  const menus = [...document.querySelectorAll('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')]
    .filter(m => m.offsetParent !== null);
  const menu = menus.at(-1);
  if (!menu) return JSON.stringify({ error: "no open menu" });
  const items = [...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]')];
  const slider = document.querySelector('[role="slider"]');
  return JSON.stringify({
    itemCount: items.length,
    items: items.map(i => (i.innerText ?? "").trim().replace(/\\s+/g, " ").slice(0, 40)),
    menuText: (menu.innerText ?? "").trim().slice(0, 400),
    slider: slider ? {
      min: slider.getAttribute("aria-valuemin"),
      max: slider.getAttribute("aria-valuemax"),
      now: slider.getAttribute("aria-valuenow"),
      label: slider.getAttribute("aria-label")
    } : null
  });
})()`);

const menu = JSON.parse(menuRaw);
console.log("\n=== effort menüsü ===");
if (menu.error) {
  console.log(`  ${menu.error}`);
} else {
  console.log(`  öğe sayısı: ${menu.itemCount}`);
  for (const item of menu.items) console.log(`   - ${item}`);
  if (menu.slider) console.log(`  slider: ${JSON.stringify(menu.slider)}`);
  if (!menu.itemCount && menu.menuText) console.log(`  menü metni:\n${menu.menuText.split("\n").map(l => `   | ${l}`).join("\n")}`);

  const steps = menu.slider
    ? Number(menu.slider.max) - Number(menu.slider.min) + 1
    : menu.itemCount;
  console.log(`\n  kademe sayısı: ${steps}`);
  console.log(`  Pro erişimi: ${steps >= 5 ? "VAR" : "yok"}`);
}

await evaluate(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`).catch(() => {});
socket.close();
