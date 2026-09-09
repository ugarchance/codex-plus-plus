#!/usr/bin/env node

import fs from "node:fs";

const hostFile = "/private/tmp/claude-501/-Users-ahmet-gpt-binary-patch/558edffe-38cc-41e9-83f4-7ab90bb915c9/scratchpad/cdp-host";
const host = process.argv[2] ?? (fs.existsSync(hostFile) ? fs.readFileSync(hostFile, "utf8").trim() : "127.0.0.1");
const port = Number(process.argv[3] ?? 19333);
const prompt = process.argv[4] ?? "Reply with exactly: codexpp-probe-ok";

async function attach(predicate, label) {
  const targets = await fetch(`http://${host}:${port}/json`).then((r) => r.json());
  const target = targets.find(predicate);
  if (!target?.webSocketDebuggerUrl) throw new Error(`${label} target not found`);
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
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(String(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text));
    }
    return result.result.value;
  };
  return { socket, command, evaluate };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${label}${detail !== undefined ? `  ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const app = await attach((t) => t.type === "page" && t.url?.startsWith("app://"), "Codex app");
await app.evaluate(`(async()=>JSON.stringify(await window.__codexpp.webOpen({show:true})))()`);
await wait(3000);

const web = await attach((t) => t.type === "page" && t.url?.startsWith("https://chatgpt.com"), "ChatGPT window");

await web.command("Page.navigate", { url: "https://chatgpt.com/?temporary-chat=true" });
await wait(6000);

const ready = JSON.parse(await web.evaluate(`(() => {
  const composer = document.querySelector('#prompt-textarea, [contenteditable="true"]');
  const temporaryHint = /temporary chat|geçici sohbet/i.test(document.body?.innerText ?? "");
  return JSON.stringify({
    url: location.href,
    composer: Boolean(composer),
    temporaryHint,
    signedIn: document.querySelectorAll('[data-testid*="login"], a[href*="auth/login"]').length === 0
  });
})()`));
check("temporary chat açıldı", ready.composer && ready.signedIn, JSON.stringify(ready));

if (ready.composer) {
  const boxRaw = await web.evaluate(`(() => {
    const c = document.querySelector('#prompt-textarea, [contenteditable="true"]');
    const r = c.getBoundingClientRect();
    return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
  })()`);
  const box = JSON.parse(boxRaw);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await web.command("Input.dispatchMouseEvent", {
      type, x, y, button: "left",
      clickCount: type === "mouseMoved" ? 0 : 1,
      buttons: type === "mousePressed" ? 1 : 0,
    });
    await wait(60);
  }
  await web.command("Input.insertText", { text: prompt });
  await wait(500);

  const typed = await web.evaluate(`(() => {
    const c = document.querySelector('#prompt-textarea, [contenteditable="true"]');
    return (c.innerText ?? c.value ?? "").trim();
  })()`);
  check("composer'a metin yazıldı", typed.includes("codexpp-probe"), JSON.stringify(typed.slice(0, 60)));

  for (const type of ["keyDown", "keyUp"]) {
    await web.command("Input.dispatchKeyEvent", {
      type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      text: type === "keyDown" ? "\r" : undefined,
    });
    await wait(60);
  }

  let answer = null;
  const deadline = Date.now() + 90_000;
  let lastLen = 0;
  let stableSince = null;
  while (Date.now() < deadline) {
    await wait(1500);
    const snap = JSON.parse(await web.evaluate(`(() => {
      const turns = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
      const last = turns.at(-1);
      const streaming = document.querySelectorAll('[data-testid="stop-button"], button[aria-label*="Stop"]').length > 0;
      return JSON.stringify({
        turnCount: turns.length,
        text: last ? (last.innerText ?? "").trim().slice(0, 400) : null,
        streaming
      });
    })()`));
    if (snap.text) {
      answer = snap.text;
      if (snap.text.length === lastLen && !snap.streaming) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince > 2000) break;
      } else {
        stableSince = null;
        lastLen = snap.text.length;
      }
    }
  }
  check("ChatGPT yanıt verdi", Boolean(answer), answer ? JSON.stringify(answer.slice(0, 120)) : "yanıt yok");
}

app.socket.close();
web.socket.close();
console.log(failures ? `\n${failures} kontrol başarısız` : `\ntüm kontroller geçti`);
process.exit(failures ? 1 : 0);
