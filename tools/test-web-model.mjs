#!/usr/bin/env node

import fs from "node:fs";

const logFile = process.argv[2] ?? "/private/tmp/claude-501/-Users-ahmet-gpt-binary-patch/558edffe-38cc-41e9-83f4-7ab90bb915c9/scratchpad/codexpp6.log";
const model = process.argv[3] ?? "chatgpt-web/instant";
const prompt = process.argv[4] ?? "Reply with exactly: codexpp-gateway-ok";

const log = fs.readFileSync(logFile, "utf8");
const match = [...log.matchAll(/codexpp gateway on (http:\/\/127\.0\.0\.1:\d+\/backend-api\/codex)/g)].at(-1);
if (!match) throw new Error("gateway route not found in the log");
const base = match[1];
console.log(`gateway ${base}`);
console.log(`model   ${model}\n`);

const started = Date.now();
const response = await fetch(`${base}/responses`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "text/event-stream" },
  body: JSON.stringify({
    model,
    stream: true,
    store: false,
    prompt_cache_key: "codexpp-test",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }] }],
  }),
});

console.log(`status ${response.status} ${response.headers.get("content-type")}`);
if (!response.body) throw new Error("no response body");

const decoder = new TextDecoder();
let buffer = "";
const events = [];
let answer = null;
for await (const chunk of response.body) {
  buffer += decoder.decode(chunk, { stream: true });
  let index;
  while ((index = buffer.indexOf("\n\n")) !== -1) {
    const raw = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);
    const name = /^event: (.+)$/m.exec(raw)?.[1];
    const data = /^data: (.*)$/m.exec(raw)?.[1];
    if (!name) continue;
    events.push(name);
    if (name === "response.output_text.done" && data) {
      try { answer = JSON.parse(data).text; } catch {}
    }
    if (name === "response.failed" && data) {
      console.log(`  FAILED: ${data.slice(0, 300)}`);
    }
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\nolaylar (${seconds}s): ${events.join(" → ")}`);
console.log(`yanıt: ${answer === null ? "(yok)" : JSON.stringify(answer.slice(0, 300))}`);
process.exit(answer ? 0 : 1);
