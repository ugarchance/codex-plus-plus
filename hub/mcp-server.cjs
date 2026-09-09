// Spawned by tunnel-client as `--mcp-command`. Speaks MCP on stdio and forwards every tool call to
// the hub over the broker socket. ChatGPT reaches this process through the OpenAI tunnel.

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const PROTOCOL = "2025-06-18";
const socketPath = (() => {
  const index = process.argv.indexOf("--broker-socket");
  return index === -1 ? null : process.argv[index + 1];
})();

const TOOLS = [{
  name: "codex_exec",
  description:
    "Run one shell command on the user's machine through the Codex task that is waiting on this "
    + "message, and return its output. Pass the turn token given in the message; a call without it "
    + "is rejected. The command runs in the Codex task's working directory unless workdir says "
    + "otherwise.",
  inputSchema: {
    type: "object",
    properties: {
      turn_token: { type: "string", description: "The turn token from the Codex message." },
      cmd: { type: "string", description: "Shell command to execute, for example `cat README.md`." },
      workdir: { type: "string", description: "Working directory. Defaults to the Codex task's cwd." },
      yield_time_ms: { type: "integer", description: "How long to wait for output, 250-30000 ms." },
      max_output_tokens: { type: "integer", description: "Output token budget." },
      tty: { type: "boolean", description: "Allocate a PTY for the command." }
    },
    required: ["turn_token", "cmd"],
    additionalProperties: false
  }
}];

// Codex only advertises the freeform `exec` gateway, so the command has to reach `exec_command` as
// JavaScript. Writing that JavaScript here keeps it off the model's plate and out of the prompt.
function execProgram({ cmd, workdir, yield_time_ms: yieldTimeMs, max_output_tokens: maxOutputTokens, tty }) {
  const execArguments = {
    cmd,
    ...(workdir ? { workdir } : {}),
    ...(yieldTimeMs !== undefined ? { yield_time_ms: yieldTimeMs } : {}),
    ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
    ...(tty !== undefined ? { tty } : {})
  };
  const shellArguments = {
    command: cmd,
    ...(workdir ? { workdir } : {}),
    ...(yieldTimeMs !== undefined ? { timeout_ms: yieldTimeMs } : {})
  };
  return [
    `if (typeof ALL_TOOLS === "undefined" || !Array.isArray(ALL_TOOLS)) throw new Error("Native command tool registry is unavailable");`,
    `const names = new Set(ALL_TOOLS.map(tool => tool?.name));`,
    `const candidates = ["exec_command", "shell_command"].filter(name => names.has(name));`,
    `if (candidates.length !== 1) throw new Error("Expected exactly one native command tool; found " + (candidates.join(", ") || "none"));`,
    `const command = tools[candidates[0]];`,
    `if (typeof command !== "function") throw new Error("Native command tool " + candidates[0] + " is listed but unavailable");`,
    `const result = await command(candidates[0] === "exec_command" ? ${JSON.stringify(execArguments)} : ${JSON.stringify(shellArguments)});`,
    `const emit = value => {`,
    `  if (Array.isArray(value)) { for (const item of value) emit(item); return; }`,
    `  if (value && typeof value === "object") {`,
    `    if (typeof value.output === "string") { text(value.output); return; }`,
    `    if (value.type === "text" && typeof value.text === "string") { text(value.text); return; }`,
    `    if (Array.isArray(value.content)) { for (const item of value.content) emit(item); return; }`,
    `  }`,
    `  text(value);`,
    `};`,
    `emit(result);`
  ].join("\n");
}

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

// The only window onto what ChatGPT actually asks this server for; the process has no other stdio.
const logFile = socketPath ? path.join(path.dirname(socketPath), "mcp.log") : null;
function note(line) {
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

function callBroker(token, script) {
  return new Promise((resolve, reject) => {
    if (!socketPath) {
      reject(new Error("codexpp mcp server started without --broker-socket"));
      return;
    }
    const connection = net.createConnection(socketPath);
    let buffer = "";
    connection.setEncoding("utf8");
    connection.on("connect", () => connection.write(`${JSON.stringify({ id: 1, token, script })}\n`));
    connection.on("data", (chunk) => {
      buffer += chunk;
      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      connection.end();
      let response;
      try {
        response = JSON.parse(buffer.slice(0, nl));
      } catch {
        reject(new Error("the codexpp hub sent a malformed reply"));
        return;
      }
      if (response.ok) resolve(response.output);
      else reject(new Error(response.error ?? "the codexpp hub rejected the call"));
    });
    connection.on("error", () => reject(new Error("the codexpp hub is not reachable")));
  });
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === undefined) continue;

    note(`<- ${message.method}`);
    const ok = (result) => write({ jsonrpc: "2.0", id: message.id, result });
    const failed = (code, text) => write({ jsonrpc: "2.0", id: message.id, error: { code, message: text } });

    switch (message.method) {
      case "initialize":
        ok({
          protocolVersion: typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "codexpp-native", version: "1.0.0" }
        });
        break;
      case "tools/list":
        ok({ tools: TOOLS });
        break;
      case "tools/call": {
        if (message.params?.name !== "codex_exec") {
          failed(-32602, `Unknown tool: ${message.params?.name}`);
          break;
        }
        const args = message.params?.arguments ?? {};
        if (typeof args.cmd !== "string" || !args.cmd.trim()) {
          ok({ content: [{ type: "text", text: "codex_exec needs a cmd" }], isError: true });
          break;
        }
        try {
          const output = await callBroker(args.turn_token, execProgram(args));
          note(`   codex_exec ok (${output.length} chars)`);
          ok({ content: [{ type: "text", text: output }], isError: false });
        } catch (err) {
          note(`   codex_exec failed: ${err.message}`);
          ok({ content: [{ type: "text", text: err.message }], isError: true });
        }
        break;
      }
      case "ping":
        ok({});
        break;
      default:
        // ChatGPT opens with `server/discover`, which is not part of MCP. An error is the reply the
        // official stub gives; answering with an empty result breaks plugin creation.
        failed(-32601, `Method not found: ${message.method}`);
    }
  }
});
