const RESULT_MARKER = "__CODEXPP_NATIVE_RESULT_V2__";

const tokenProperty = {
  turn_token: { type: "string", description: "Current logical-turn token from the Codex transport block." },
  request_id: {type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$',description:'A unique id for this logical tool invocation. Use a NEW id for each new call or wait poll, even with identical arguments. Reuse the same id only to retry this exact invocation.'},
};

const TOOLS = Object.freeze([
  {
    name: "codex_exec",
    description: "Run an advertised native command tool in the active Codex task. Returns the complete native result, including session_id, exit_code, errors and content blocks.",
    inputSchema: {
      type: "object",
      properties: {
        ...tokenProperty,
        cmd: { type: "string" },
        workdir: { type: "string" },
        shell: { type: "string", description: "Optional native shell selector passed to the advertised executor." },
        yield_time_ms: { type: "integer", minimum: 250, maximum: 30_000 },
        max_output_tokens: { type: "integer", minimum: 1 },
        tty: { type: "boolean" },
      },
      required: ["turn_token", "request_id", "cmd"],
      additionalProperties: false,
    },
  },
  {
    name: "codex_write_stdin",
    description: "Continue or poll an existing native command session through the active Codex task.",
    inputSchema: {
      type: "object",
      properties: {
        ...tokenProperty,
        session_id: { type: "integer" },
        chars: { type: "string" },
        yield_time_ms: { type: "integer", minimum: 0, maximum: 300_000 },
        max_output_tokens: { type: "integer", minimum: 1 },
      },
      required: ["turn_token", "request_id", "session_id"],
      additionalProperties: false,
    },
  },
  {
    name: "codex_apply_patch",
    description: "Apply a patch with the advertised native apply_patch tool so Codex keeps its diff and approval lifecycle.",
    inputSchema: {
      type: "object",
      properties: { ...tokenProperty, patch: { type: "string" } },
      required: ["turn_token", "request_id", "patch"],
      additionalProperties: false,
    },
  },
  {
    name: "codex_view_image",
    description: "Inspect a local image with the advertised native view_image tool and preserve image content blocks.",
    inputSchema: {
      type: "object",
      properties: {
        ...tokenProperty,
        path: { type: "string" },
        detail: { type: "string", enum: ["high", "original"] },
      },
      required: ["turn_token", "request_id", "path"],
      additionalProperties: false,
    },
  },
  {
    name: "codex_tool_inventory",
    description: "List a bounded page of tools actually advertised in the active Codex turn. Descriptions are returned only for the requested page.",
    inputSchema: {
      type: "object",
      properties: {
        ...tokenProperty,
        cursor: { type: "integer", minimum: 0 },
        page_size: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["turn_token", "request_id"],
      additionalProperties: false,
    },
  },
  {
    name: "codex_tool_call",
    description: "Call one exact tool from codex_tool_inventory. No fallback or guessed tool name is used.",
    inputSchema: {
      type: "object",
      properties: {
        ...tokenProperty,
        wire_name: { type: "string" },
        kind: { type: "string", enum: ["function", "freeform"] },
        arguments: { type: "object" },
        input: { type: "string" },
      },
      required: ["turn_token", "request_id", "wire_name", "kind"],
      additionalProperties: false,
    },
  },
]);

function resultEmitter() {
  return [
    `const __cxpResult=(value)=>{`,
    `  let normalized;`,
    `  if(value&&typeof value==="object"&&(Array.isArray(value.content)||value.structuredContent!==undefined||value.isError!==undefined)){normalized=value}`,
    `  else if(value&&typeof value==="object"){`,
    `    const content=typeof value.image_url==="string"`,
    `      ?[{type:"image",image_url:value.image_url,detail:value.detail??null}]`,
    `      :[{type:"text",text:typeof value.output==="string"?value.output:JSON.stringify(value)}];`,
    `    normalized={...value,content,structuredContent:value,isError:false};`,
    `  }else normalized={content:[{type:"text",text:typeof value==="string"?value:JSON.stringify(value??null)}],isError:false};`,
    `  text(${JSON.stringify(RESULT_MARKER)}+JSON.stringify(normalized));`,
    `};`,
    `const __cxpFailure=(error)=>__cxpResult({content:[{type:"text",text:error instanceof Error?error.message:String(error)}],isError:true});`,
  ];
}

function inventoryPrelude() {
  return [
    `if(typeof ALL_TOOLS==="undefined"||!Array.isArray(ALL_TOOLS))throw new Error("Native tool registry is unavailable");`,
    `const __cxpTools=ALL_TOOLS.filter(t=>t&&typeof t.name==="string");`,
    `const __cxpNames=new Set(__cxpTools.map(t=>t.name));`,
  ];
}

function invokeProgram(candidates, argumentExpressions) {
  return [
    ...resultEmitter(),
    `try{`,
    ...inventoryPrelude().map((line) => `  ${line}`),
    `  const __cxpCandidates=${JSON.stringify(candidates)}.filter(name=>__cxpNames.has(name)&&typeof tools[name]==="function");`,
    `  if(__cxpCandidates.length!==1)throw new Error("Expected exactly one advertised native tool from: ${candidates.join(", ")}; found "+(__cxpCandidates.join(", ")||"none"));`,
    `  const __cxpName=__cxpCandidates[0];`,
    `  const __cxpArgs=__cxpName===${JSON.stringify(candidates[0])}?${argumentExpressions[0]}:${argumentExpressions[1] ?? argumentExpressions[0]};`,
    `  __cxpResult(await tools[__cxpName](__cxpArgs));`,
    `}catch(error){__cxpFailure(error)}`,
  ].join("\n");
}

function buildNativeProgram(name, args, directInventory = []) {
  switch (name) {
    case "codex_exec": {
      const execArgs = {
        cmd: args.cmd,
        ...(args.workdir ? { workdir: args.workdir } : {}),
        ...(args.shell ? { shell: args.shell } : {}),
        ...(args.yield_time_ms !== undefined ? { yield_time_ms: args.yield_time_ms } : {}),
        ...(args.max_output_tokens !== undefined ? { max_output_tokens: args.max_output_tokens } : {}),
        ...(args.tty !== undefined ? { tty: args.tty } : {}),
      };
      const shellArgs = {
        command: args.cmd,
        ...(args.workdir ? { workdir: args.workdir } : {}),
        ...(args.shell ? { shell: args.shell } : {}),
        ...(args.yield_time_ms !== undefined ? { timeout_ms: args.yield_time_ms } : {}),
      };
      return invokeProgram(["exec_command", "shell_command"], [JSON.stringify(execArgs), JSON.stringify(shellArgs)]);
    }
    case "codex_write_stdin":
      return invokeProgram(["write_stdin"], [JSON.stringify({
        session_id: args.session_id,
        ...(args.chars !== undefined ? { chars: args.chars } : {}),
        ...(args.yield_time_ms !== undefined ? { yield_time_ms: args.yield_time_ms } : {}),
        ...(args.max_output_tokens !== undefined ? { max_output_tokens: args.max_output_tokens } : {}),
      })]);
    case "codex_apply_patch":
      return invokeProgram(["apply_patch"], [JSON.stringify(args.patch)]);
    case "codex_view_image":
      return invokeProgram(["view_image"], [JSON.stringify({ path: args.path, ...(args.detail ? { detail: args.detail } : {}) })]);
    case "codex_tool_inventory": {
      const cursor = Number.isInteger(args.cursor) ? args.cursor : 0;
      const pageSize = Number.isInteger(args.page_size) ? Math.min(50, Math.max(1, args.page_size)) : 20;
      return [
        ...resultEmitter(),
        `try{`,
        ...inventoryPrelude().map((line) => `  ${line}`),
        `  const all=[...${JSON.stringify(directInventory)},...__cxpTools.map(t=>({...t,wireName:t.name,surface:"gateway",namespace:null,kind:/FREEFORM|freeform tool/.test(t.description??"")?"freeform":"function"}))];`,
        `  const start=${cursor},size=${pageSize};`,
        `  const page=all.slice(start,start+size);`,
        `  const next=start+page.length<all.length?start+page.length:null;`,
        `  __cxpResult({content:[{type:"text",text:JSON.stringify(page)}],structuredContent:{tools:page,nextCursor:next,total:all.length},isError:false});`,
        `}catch(error){__cxpFailure(error)}`,
      ].join("\n");
    }
    case "codex_tool_call": {
      if (typeof args.wire_name !== "string" || !/^[A-Za-z_$][\w$]*(?:__[A-Za-z_$][\w$]*)*$/.test(args.wire_name)) {
        throw new Error("codex_tool_call wire_name is invalid");
      }
      if (args.kind === "freeform" && typeof args.input !== "string") throw new Error("freeform native tools require input text");
      if (args.kind === "function" && (!args.arguments || typeof args.arguments !== "object" || Array.isArray(args.arguments))) {
        throw new Error("function native tools require an arguments object");
      }
      return invokeProgram([args.wire_name], [JSON.stringify(args.kind === "freeform" ? args.input : args.arguments)]);
    }
    default:
      throw new Error(`Unknown bridge tool: ${name}`);
  }
}

function validateArguments(name, args) {
  if (!args || typeof args !== "object" || typeof args.turn_token !== "string" || !args.turn_token) {
    throw new Error(`${name} needs the current turn_token`);
  }
  const schema = TOOLS.find(tool => tool.name === name)?.inputSchema;
  if (!schema) throw new Error('Unknown bridge tool');
  if(typeof args.request_id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(args.request_id))throw Error('Codex++ Native v2 requires a unique request_id per invocation; refresh this connector\'s actions to schema revision 3. No native tool was executed');
  if (Buffer.byteLength(JSON.stringify(args)) > 512 * 1024) throw new Error('Native tool arguments exceed the 512 KiB limit');
  for (const key of schema.required) if (args[key] === undefined) throw new Error(`${name} requires ${key}`);
  for (const [key, value] of Object.entries(args)) {
    const property = schema.properties[key];
    if (!property) throw new Error(`${name} does not accept ${key}`);
    const valid = property.type === 'integer' ? Number.isSafeInteger(value)
      : property.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
      : typeof value === property.type;
    if (!valid || (property.enum && !property.enum.includes(value))
      || (property.minimum !== undefined && value < property.minimum) || (property.maximum !== undefined && value > property.maximum)) throw new Error(`${name}.${key} does not match its advertised schema`);
  }
  if (name === "codex_exec" && (typeof args.cmd !== "string" || !args.cmd.trim())) throw new Error("codex_exec needs cmd");
  if (name === "codex_write_stdin" && !Number.isInteger(args.session_id)) throw new Error("codex_write_stdin needs an integer session_id");
  if (name === "codex_apply_patch" && (typeof args.patch !== "string" || !args.patch.trim())) throw new Error("codex_apply_patch needs patch text");
  if (name === "codex_view_image" && (typeof args.path !== "string" || !args.path)) throw new Error("codex_view_image needs path");
  return args;
}

// Direct-first selection follows the MIT reference mcp-server.ts (see THIRD_PARTY_NOTICES.md).
// Only this turn's advertised registry grants a route. The hub never executes a tool itself.
function execGateway(registry) {
  return registry.find(t => t.kind === "freeform" && t.name === "exec" && (!t.namespace || t.namespace === "functions"));
}

function resolveNativeRequest(registry, name, args) {
  const isAgentWait = t => t.name === 'wait_agent' && /^(collaboration|multi_agent_v[12])$/.test(t.namespace ?? '');
  const direct = registry.map(t => ({ ...t, surface: "direct",
    ...(isAgentWait(t) ? { description: `${t.description ?? ''}\nWeb transport: pass timeout_ms: 30000 exactly; poll again after each return so other task MCP calls can proceed.`,
      schema: {...t.schema, properties: {...t.schema?.properties, timeout_ms: {...t.schema?.properties?.timeout_ms, enum:[30000]}}, required:[...new Set([...(t.schema?.required??[]),'timeout_ms'])]} } : {}) }));
  const gateway = execGateway(registry);
  if (name === "codex_tool_inventory" && !gateway) {
    const cursor = args.cursor ?? 0, size = Math.min(args.page_size ?? 20, 50);
    const page = direct.slice(cursor, cursor + size);
    const result = { content: [{ type: "text", text: JSON.stringify(page) }], structuredContent: {
      tools: page, nextCursor: cursor + page.length < direct.length ? cursor + page.length : null, total: direct.length,
    }, isError: false };
    return { result };
  }
  let tool, payload;
  const exact = toolName => registry.find(t => t.name === toolName && (!t.namespace || t.namespace === "functions"));
  switch (name) {
    case "codex_exec": {
      tool = exact("exec_command") ?? exact("shell_command");
      const { turn_token, request_id, ...commandArgs } = args;
      payload = commandArgs;
      if (tool?.name === "shell_command") {
        const { cmd, yield_time_ms, max_output_tokens, tty, ...rest } = commandArgs;
        payload = { ...rest, command: cmd, ...(yield_time_ms === undefined ? {} : { timeout_ms: yield_time_ms }) };
      }
      break;
    }
    case "codex_write_stdin":
    case "codex_view_image": {
      tool = exact(name === "codex_write_stdin" ? "write_stdin" : "view_image");
      const { turn_token, request_id, ...rest } = args; payload = rest; break;
    }
    case "codex_apply_patch": tool = exact("apply_patch"); payload = tool?.kind === "freeform" ? args.patch : { input: args.patch }; break;
    case "codex_tool_call":
      tool = registry.find(t => t.wireName === args.wire_name);
      // V2 is a direct native namespace, not a function hidden behind exec.
      if (/^(?:collaboration|multi_agent_v\d)(?:\.|__)/.test(args.wire_name) && !tool) throw new Error('No advertised direct subagent tool for this protocol');
      if (tool && tool.kind !== args.kind) throw new Error("native tool kind does not match its advertised registry");
      payload = args.kind === "freeform" ? args.input : args.arguments;
      if (tool && isAgentWait(tool) && (!tool.schema?.properties?.timeout_ms || payload?.timeout_ms !== 30000)) {
        throw new Error('Web subagent wait requires an advertised timeout_ms parameter and exactly 30000 ms; no timeout was silently changed');
      }
      break;
    case "codex_tool_inventory": break;
    default: throw new Error(`Unknown bridge tool: ${name}`);
  }
  if (tool) return { wireName: tool.wireName, name: tool.name, namespace: tool.namespace, kind: tool.kind,
    ...(tool.kind === "freeform" ? { input: payload } : { arguments: payload }) };
  if (!gateway) throw new Error(`No advertised native tool or exec gateway for ${name}`);
  return { wireName: gateway.wireName, name: gateway.name, namespace: gateway.namespace, kind: "freeform",
    input: buildNativeProgram(name, args, direct) };
}

module.exports = { TOOLS, RESULT_MARKER, buildNativeProgram, validateArguments, resolveNativeRequest, execGateway };
