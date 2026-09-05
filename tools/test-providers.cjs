const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
process.env.USER_DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "cxp-provider-tests-"),
);
const p = require("../hub/providers.cjs");
const g = require("../hub/provider-gateway.cjs");
const w = require("../hub/provider-wire.cjs");
p.setEncryptionForTests({
  isEncryptionAvailable: () => true,
  encryptString: (v) => Buffer.from("test:" + v),
  decryptString: (v) => v.toString().slice(5),
});
let upstream;
let requests = [];
let base;
let faultStatus = 0;
const init = new Promise((resolve) => {
  upstream = http.createServer(async (req, res) => {
    let b = "";
    for await (const c of req) b += c;
    requests.push({
      headers: req.headers,
      body: b ? JSON.parse(b) : null,
      url: req.url,
    });
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "example" }] }));
    }
    if(faultStatus){res.writeHead(faultStatus);return res.end('private upstream diagnostic');}
    const writer = w.responseWriter(res);
    writer.begin();
    writer.text("MOCK_OK");
    writer.complete(
      { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      new Set(),
    );
  });
  upstream.listen(0, "127.0.0.1", () => {
    base = "http://127.0.0.1:" + upstream.address().port + "/v1";
    resolve();
  });
});
after(() => {
  g.stop();
  upstream.closeAllConnections();
  upstream.close();
});
function add(label) {
  const v = p.save({
    providerId: "custom",
    endpoint: base,
    label,
    apiKey: "test-provider-secret",
    models: [
      {
        id: "example",
        protocol: "responses",
        efforts: ["low", "high"],
        defaultEffort: "low",
        enabled: true,
      },
    ],
  });
  const c = v.connections.at(-1);
  p.update(c.id, { status: "ready" });
  return c.id;
}
test("encrypted store and three connections preserve explicit selection and pinned routes", async () => {
  await init;
  const ids = [add("A"), add("B"), add("C")];
  const v = p.view();
  assert.equal(v.connections.length, 3);
  assert.ok(!JSON.stringify(v).includes("test-provider-secret"));
  assert.ok(!JSON.stringify(v).includes("dGVzdD"));
  const m = p.catalog()[0];
  assert.equal(m.connectionIds.length, 3);
  p.select("custom", ids[1]);
  assert.equal(p.choose(m.model).connection.id, ids[1]);
  p.bind("thread-pinned", ids[0], m.model);
  assert.equal(p.choose(m.model, "thread-pinned").connection.id, ids[0]);
  p.update(ids[0], { enabled: false });
  assert.throws(() => p.choose(m.model, "thread-pinned"));
  assert.throws(() =>
    p.save({
      ...v.connections[1],
      endpoint: "https://changed.example/v1",
      apiKey: "",
    }),
  );
  p.update(ids[0], { enabled: true });
});
test("gateway authenticates local caller, isolates provider key and reports real usage", async () => {
  await init;
  const route = await g.prepare(p.catalog()[0].model, null);
  g.bind(route.ticket, "gateway-thread");
  const url =
    route.config["model_providers.cxp-external"].base_url + "/responses";
  const body = JSON.stringify({
    model: p.catalog()[0].model,
    input: "Hello",
    reasoning: { effort: "low" },
    stream: true,
  });
  const denied = await fetch(url, { method: "POST", body });
  assert.equal(denied.status, 401);
  const origin = await fetch(url, {
    method: "POST",
    body,
    headers: {
      Authorization: "Bearer " + process.env.CODEXPP_GATEWAY_KEY,
      Origin: "https://example.com",
    },
  });
  assert.equal(origin.status, 401);
  const response = await fetch(url, {
    method: "POST",
    body,
    headers: {
      Authorization: "Bearer " + process.env.CODEXPP_GATEWAY_KEY,
      "ChatGPT-Account-ID": "must-not-leak",
    },
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /MOCK_OK/);
  const r = requests.at(-1);
  assert.equal(r.headers.authorization, "Bearer test-provider-secret");
  assert.equal(r.headers["chatgpt-account-id"], undefined);
  assert.equal(r.body.model, "example");
  assert.equal(r.body.reasoning.effort, "low");
  assert.equal(p.view().connections.find((c) => c.usage)?.usage.inputTokens, 3);
});
test("disabled models and invalid efforts fail before provider traffic", async () => {
  const m = p.catalog()[0];
  const route = await g.prepare(m.model);
  const url =
    route.config["model_providers.cxp-external"].base_url + "/responses";
  const count = requests.length;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.CODEXPP_GATEWAY_KEY },
    body: JSON.stringify({ model: m.model, reasoning: { effort: "ultra" } }),
  });
  assert.equal(r.status, 502);
  assert.equal(requests.length, count);
});
test("custom tools, images and tool results translate without dropping contract", () => {
  const body = w.chatRequest(
    {
      instructions: "rules",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "test" },
            { type: "input_image", image_url: "data:image/png;base64,AA==" },
          ],
        },
        {
          type: "custom_tool_call",
          call_id: "c1",
          name: "apply_patch",
          input: "PATCH",
        },
        { type: "custom_tool_call_output", call_id: "c1", output: "done" },
      ],
      tools: [{ type: "custom", name: "apply_patch" }],
      reasoning: { effort: "high" },
    },
    { id: "m", efforts: ["high"] },
  );
  assert.equal(body.messages[1].content[1].type, "image_url");
  assert.equal(
    body.messages[2].tool_calls[0].function.arguments,
    '{"input":"PATCH"}',
  );
  assert.equal(body.messages[3].tool_call_id, "c1");
  assert.equal(body.tools[0].function.parameters.required[0], "input");
  assert.throws(() =>
    w.chatRequest(
      { tools: [{ type: "web_search" }] },
      { id: "m", efforts: [] },
    ),
  );
});
test("registry is data-only and keeps Go separate from paid Zen", () => {
  const r = require("../hub/provider-registry.cjs").read();
  assert.notEqual(
    r.providers["opencode-go"].endpoint,
    r.providers["opencode-zen"].endpoint,
  );
  assert.equal(r.providers["github-copilot"].supported, false);
  assert.ok(Object.keys(r.providers).length > 20);
  assert.ok(
    r.providers["opencode-go"].models.some((m) => m.protocol === "responses"),
  );
  assert.ok(
    Object.values(r.providers).every((p) => !Object.hasOwn(p, "credential")),
  );
});

test("SSE accepts every CRLF split boundary and rejects truncated events", async () => {
  const source = 'data: {"text":"café 🚀"}\r\n\r\ndata: [DONE]\r\n\r\n';
  const bytes = Buffer.from(source);
  for (let i = 1; i < bytes.length; i++) {
    async function* chunks() {
      yield bytes.subarray(0, i);
      yield bytes.subarray(i);
    }
    const events = [];
    for await (const e of w.sse(chunks())) events.push(e);
    assert.deepEqual(events, [{ text: "café 🚀" }]);
  }
  await assert.rejects(async () => {
    for await (const e of w.sse([Buffer.from('data: {"unfinished":true}')]))
      void e;
  }, /Incomplete/);
});

async function translated(events, protocol, tools = []) {
  let output = "";
  const res = { writeHead() {}, write: (s) => (output += s), end() {} };
  await w.translateStream(
    {
      body: events.map((e) =>
        Buffer.from("data: " + JSON.stringify(e) + "\n\n"),
      ),
    },
    res,
    protocol,
    { tools },
  );
  const result = [];
  for await (const e of w.sse([Buffer.from(output)])) result.push(e);
  return result;
}
test('namespace tools preserve identities, custom inputs and history across both adapters', async () => {
  const tools = [
    {type:'namespace',name:'functions',tools:[{type:'function',name:'lookup',parameters:{type:'object',properties:{}}},{type:'custom',name:'apply_patch'}]},
    {type:'namespace',name:'other',tools:[{type:'function',name:'lookup'}]},
    {type:'function',name:'lookup'},
  ];
  const model = {id:'example',efforts:[]};
  const body = w.chatRequest({tools,tool_choice:{type:'function',namespace:'functions',name:'lookup'}},model);
  const aliases = body.tools.map(t=>t.function.name);
  assert.equal(new Set(aliases).size,4);
  assert.ok(aliases.every(n=>/^[a-zA-Z0-9_-]{1,64}$/.test(n)));
  assert.equal(body.tool_choice.function.name,aliases[0]);
  const calls = await translated([{choices:[{delta:{tool_calls:[{index:0,id:'c',function:{name:aliases[1],arguments:'{"input":"PATCH"}'}}]},finish_reason:'tool_calls'}]}],'chat',tools);
  const custom = calls.at(-1).response.output[0];
  assert.equal(custom.namespace,'functions');
  assert.equal(custom.name,'apply_patch');
  assert.equal(custom.type,'custom_tool_call');
  assert.equal(custom.input,'PATCH');
  const input=[custom,{type:'custom_tool_call_output',call_id:'c',output:'ok'}];
  assert.equal(w.chatRequest({input,tools},model).messages[0].tool_calls[0].function.name,aliases[1]);
  assert.equal(w.anthropicRequest({input,tools},model).messages[0].content[0].name,aliases[1]);
  const messages=await translated([
    {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'f',name:aliases[0],input:{}}},
    {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{}'}},
    {type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:2}},
    {type:'message_stop'}
  ],'anthropic',tools);
  const fn=messages.at(-1).response.output[0];
  assert.equal(fn.namespace,'functions');assert.equal(fn.name,'lookup');assert.equal(fn.type,'function_call');
});
test('Chat and Messages thread configs disable unsupported hosted web search', async () => {
  await init;
  for(const protocol of ['chat','anthropic','responses']) {
    const id='web-contract-'+protocol;
    const v=p.save({providerId:'custom',label:id,endpoint:base,models:[{id,protocol,enabled:true,efforts:[]}]});
    p.update(v.connections.at(-1).id,{status:'ready'});
    p.bind('thread-'+id,v.connections.at(-1).id,'cxp/custom/'+id);
    const route=await g.prepare('cxp/custom/'+id,'thread-'+id);
    assert.equal(route.config.web_search,protocol==='responses'?undefined:'disabled');
  }
});
test("Chat stream reconstructs split custom tool arguments and usage", async () => {
  const events = await translated(
    [
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call1",
                  function: { name: "apply_patch", arguments: '{"input":' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"PATCH"}' } }],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      {
        choices: [],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      },
    ],
    "chat",
    [{ type: "custom", name: "apply_patch" }],
  );
  const response = events.at(-1).response;
  assert.equal(response.status, "completed");
  assert.equal(response.output[0].type, "custom_tool_call");
  assert.equal(response.output[0].input, "PATCH");
  assert.equal(response.usage.total_tokens, 10);
});
test("Messages translates tool results and streamed function calls", async () => {
  const body = w.anthropicRequest(
    {
      input: [
        {
          type: "function_call",
          call_id: "a",
          name: "shell",
          arguments: '{"cmd":"dir"}',
        },
        { type: "function_call_output", call_id: "a", output: "file.txt" },
      ],
      tools: [{ type: "function", name: "shell" }],
    },
    { id: "claude", efforts: [] },
  );
  assert.equal(body.messages[0].content[0].type, "tool_use");
  assert.equal(body.messages[1].content[0].type, "tool_result");
  assert.equal(body.thinking, undefined);
  const events = await translated(
    [
      { type: "message_start", message: { usage: { input_tokens: 9 } } },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "c1", name: "shell" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"cmd":"dir"}' },
      },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 4 },
      },
      { type: "message_stop" },
    ],
    "anthropic",
  );
  assert.equal(events.at(-1).response.output[0].arguments, '{"cmd":"dir"}');
  assert.equal(events.at(-1).response.usage.total_tokens, 13);
});
test("truncated and failed streams never report successful completion", async () => {
  await assert.rejects(
    () =>
      translated([{ choices: [{ delta: { content: "partial" } }] }], "chat"),
    /before completion/,
  );
  await assert.rejects(
    () =>
      translated(
        [
          {
            choices: [
              { delta: { content: "partial" }, finish_reason: "length" },
            ],
          },
        ],
        "chat",
      ),
    /before completion/,
  );
  await assert.rejects(
    () =>
      translated(
        [{ type: "error", error: { message: "private upstream message" } }],
        "anthropic",
      ),
    /Provider stream error/,
  );
});
test("Go quota reports real remaining percentages and treats missing values as unknown", () => {
  const { goMetrics } = require("../hub/provider-usage.cjs");
  assert.deepEqual(
    goMetrics({
      usage: {
        rolling: { percent: 25 },
        weekly: { percent: null },
        monthly: { percent: 100 },
      },
    }).map((m) => m.remainingPercent),
    [75, 0],
  );
  assert.deepEqual(goMetrics({ usage: { rolling: { percent: "n/a" } } }), []);
});
test("discovery keeps enabled choices and preferred connections, new models stay disabled", async () => {
  const id = p.view().connections[0].id;
  const before = p.view().preferred;
  await g.discover(id);
  const v = p.view();
  assert.equal(v.connections[0].models[0].enabled, true);
  assert.deepEqual(v.preferred, before);
  const newId = p
    .save({
      providerId: "custom",
      endpoint: base,
      label: "Discovery",
      apiKey: "test-provider-secret",
    })
    .connections.at(-1).id;
  await g.discover(newId);
  assert.equal(
    p.view().connections.find((c) => c.id === newId).models[0].enabled,
    false,
  );
});

test("thinking text and Messages signatures survive encrypted tool round trips", async () => {
  const chat = await translated(
    [
      { choices: [{ delta: { reasoning_content: "private reasoning" } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "c2",
                  function: { name: "shell", arguments: "{}" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    ],
    "chat",
  );
  const output = chat.at(-1).response.output;
  assert.ok(output[0].encrypted_content.startsWith("cxp_reasoning_v1:"));
  assert.ok(!output[0].encrypted_content.includes("private reasoning"));
  const request = w.chatRequest(
    {
      input: [
        ...output,
        { type: "function_call_output", call_id: "c2", output: "ok" },
      ],
    },
    { id: "m", efforts: [] },
  );
  assert.equal(request.messages[0].reasoning_content, "private reasoning");
  assert.equal(request.messages[1].role, "tool");
  const messages = await translated(
    [
      { type: "message_start", message: { usage: { input_tokens: 1 } } },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "thought" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "provider-signature" },
      },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "c3", name: "shell" },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: "{}" },
      },
      { type: "message_stop" },
    ],
    "anthropic",
  );
  const roundtrip = w.anthropicRequest(
    { input: messages.at(-1).response.output },
    { id: "m", efforts: [] },
  );
  assert.equal(
    roundtrip.messages[0].content[0].signature,
    "provider-signature",
  );
  assert.equal(roundtrip.messages[0].content[1].type, "tool_use");
});

test('same-provider compatible model changes retain the pinned connection; smaller contexts fail closed',async()=>{
  const c=p.view().connections[1];const original=c.models[0];p.save({...c,models:[original,{...original,id:'second'},{...original,id:'smaller',contextWindow:1024}]});
  const route=await g.prepare('cxp/custom/example');g.bind(route.ticket,'switch-thread');const url=route.config['model_providers.cxp-external'].base_url+'/responses';
  const send=model=>fetch(url,{method:'POST',headers:{Authorization:'Bearer '+process.env.CODEXPP_GATEWAY_KEY},body:JSON.stringify({model,input:'Hello',stream:true})});
  const changed=await send('cxp/custom/second');assert.equal(changed.status,200);await changed.text();assert.equal(p.read().routes['switch-thread'].modelId,'cxp/custom/second');assert.equal(p.read().routes['switch-thread'].connectionId,c.id);
  const count=requests.length;const smaller=await send('cxp/custom/smaller');assert.equal(smaller.status,502);assert.equal(requests.length,count);
});

test('provider auth/quota failures never masquerade as native ChatGPT auth and never retry',async()=>{
  for(const code of [401,403,429]){
    const c=p.view().connections[1];p.update(c.id,{cooldownUntil:null});const route=await g.prepare('cxp/custom/example');const count=requests.length;faultStatus=code;
    const response=await fetch(route.config['model_providers.cxp-external'].base_url+'/responses',{method:'POST',headers:{Authorization:'Bearer '+process.env.CODEXPP_GATEWAY_KEY},body:JSON.stringify({model:'cxp/custom/example',input:'test'})});
    const error=await response.json();assert.equal(response.status,502);assert.equal(error.error.type,'provider_error');assert.ok(!JSON.stringify(error).includes('private upstream'));assert.equal(requests.length,count+1);assert.ok(p.read().connections.find(x=>x.id===c.id).cooldownUntil>Date.now());
  }
  faultStatus=0;
});

test('Windows DPAPI encrypts and decrypts without Electron safeStorage', {skip:process.platform!=='win32'}, ()=>{
  const secrets=require('../hub/provider-secrets.cjs');const value='unit-test-only';const encrypted=secrets.encryptString(value);assert.equal(secrets.decryptString(encrypted),value);assert.equal(encrypted.includes(Buffer.from(value)),false);assert.throws(()=>secrets.decryptString(Buffer.from('invalid')));
});
