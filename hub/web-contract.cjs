const crypto = require("node:crypto");

const WEB_MODEL_PREFIX = "chatgpt-web/";
const CONNECTOR_ID = "codexpp-native-v2";
const CONNECTOR_NAME = "Codex++ Native v2";
const CONTRACT_VERSION = 2;
const MAX_ATTACHMENTS = 10;
const NATIVE_RESULT_MARKER = "__CODEXPP_NATIVE_RESULT_V2__";
const COMPACTION_PREFIX = "ocx1:";
// Native compact.rs framing; adapted from reference responses/compaction.ts (MIT, THIRD_PARTY_NOTICES.md).
const SUMMARY_PREFIX = "Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:";

function decodeWebCheckpoint(envelope) {
  const encoded = envelope.slice(COMPACTION_PREFIX.length);
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.toString('base64') !== encoded) throw new Error('Invalid or empty transparent compaction envelope');
  const summary = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!summary.trim()) throw new Error('Empty compaction checkpoint');
  return summary;
}

// Adapted from reference native-passthrough.scrubBridgeArtifactsForNative (MIT).
// Ordinary native requests stay byte-for-byte untouched. Only our transparent
// checkpoint proves this cross-provider boundary; real encrypted blobs stay opaque.
function restoreWebCheckpointForNative(request) {
  const isOurs = item => item?.type === 'compaction' && typeof item.encrypted_content === 'string'
    && item.encrypted_content.startsWith(COMPACTION_PREFIX);
  if (!Array.isArray(request?.input) || !request.input.some(isOurs)) return request;
  if (request.previous_response_id || request.input.some(item => item?.type === 'item_reference')) {
    throw new Error('Native transition from a Web checkpoint requires complete inline history, not provider-local references');
  }
  return { ...request, input: request.input.map(item => {
    if (!item || typeof item !== 'object') return item;
    if (isOurs(item)) return { type: 'message', role: 'user', content: [
      { type: 'input_text', text: `${SUMMARY_PREFIX}\n\n${decodeWebCheckpoint(item.encrypted_content)}` },
    ] };
    const { id, ...content } = item;
    return content; // IDs are backend-local; call_id and all actual evidence remain.
  }) };
}

// These browser composer limits were measured by the MIT-licensed reference implementation at
// commit e85e3693. They are transport limits, not native Codex context-window claims.
const COMPOSER_LIMITS = Object.freeze({
  0: 545_000,
  1: 1_045_000,
  2: 1_045_000,
  3: 1_045_000,
  4: 1_635_000,
});

const BASE_MODELS = Object.freeze({
  "chatgpt-web/sol": { family: "sol", mode: "browser", fixedEffortIndex: null, requiresPro: false },
  "chatgpt-web/sol-full": { family: "sol", mode: "full", fixedEffortIndex: null, requiresPro: false },
  // Persisted pre-v2 thread values remain explicit aliases. They never fall back to a current UI
  // value, and new model rows are generated from the two family/mode entries above.
  "chatgpt-web/instant": { family: "sol", mode: "browser", fixedEffortIndex: 0, requiresPro: false, legacy: true },
  "chatgpt-web/medium": { family: "sol", mode: "browser", fixedEffortIndex: 1, requiresPro: false, legacy: true },
  "chatgpt-web/high": { family: "sol", mode: "browser", fixedEffortIndex: 2, requiresPro: false, legacy: true },
  "chatgpt-web/extra-high": { family: "sol", mode: "browser", fixedEffortIndex: 3, requiresPro: true, legacy: true },
  "chatgpt-web/pro": { family: "sol", mode: "browser", fixedEffortIndex: 4, requiresPro: true, legacy: true },
  "chatgpt-web/pro-harness": { family: "sol", mode: "full", fixedEffortIndex: 4, requiresPro: true, legacy: true },
});

const EFFORT_INDEX = Object.freeze({ low: 0, medium: 1, high: 2, xhigh: 3, ultra: 4, max: 4 });

function sha(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function parseMetadata(request) {
  const raw = request?.client_metadata?.["x-codex-turn-metadata"];
  if (!raw) return {};
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") throw new Error("x-codex-turn-metadata must be JSON text or an object");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch (error) {
    throw new Error(`x-codex-turn-metadata is invalid: ${error.message}`);
  }
}

function parseTurnIdentity(request) {
  const metadata = parseMetadata(request);
  const threadId = typeof metadata.thread_id === "string" && metadata.thread_id ? metadata.thread_id : null;
  const turnId = typeof metadata.turn_id === "string" && metadata.turn_id ? metadata.turn_id : null;
  if (!threadId || !turnId) {
    throw new Error("ChatGPT Web requires separate thread_id and turn_id values in x-codex-turn-metadata");
  }
  const explicitEpoch = String(metadata.compaction_epoch ?? "0");
  const compacted = (Array.isArray(request?.input) ? request.input : []).findLast((item) => {
    if (item?.type === "compaction") return true;
    if (item?.type !== "message" || item.role !== "user") return false;
    const text = (Array.isArray(item.content) ? item.content : [item.content]).map(textPart).join("");
    return text.startsWith(SUMMARY_PREFIX);
  });
  const epoch = compacted ? `compact-${sha(JSON.stringify(stable(compacted))).slice(0, 24)}` : explicitEpoch;
  return {
    threadId,
    turnId,
    rootTurnId: typeof metadata.root_turn_id === "string" ? metadata.root_turn_id : turnId,
    promptCacheKey: typeof request?.prompt_cache_key === "string" ? request.prompt_cache_key : null,
    epoch,
    contextWindowId: typeof metadata.context_window_id === "string" ? metadata.context_window_id : null,
    requestKind: typeof metadata.request_kind === "string" ? metadata.request_kind : "turn",
    agentName: typeof metadata.agent_name === "string" ? metadata.agent_name : null,
    parentThreadId: typeof metadata.parent_thread_id === 'string' ? metadata.parent_thread_id : null,
    cwd: typeof metadata.cwd === "string" ? metadata.cwd : null,
    sandbox: metadata.sandbox_mode ?? metadata.sandbox ?? null,
  };
}

function reasoningIndex(request, fallback = 2) {
  const effort = request?.reasoning?.effort;
  if (typeof effort !== "string") return fallback;
  const index = EFFORT_INDEX[effort];
  if (index === undefined) throw new Error(`ChatGPT Web reasoning effort is not supported: ${effort}`);
  return index;
}

function requireWebModel(modelId, capabilities = {}, request = null) {
  const base = BASE_MODELS[modelId];
  if (!base) throw new Error(`ChatGPT Web model is not supported: ${modelId}`);
  if (capabilities.solAvailable === false) throw new Error("ChatGPT Sol is not available for this account");
  const effortIndex = base.fixedEffortIndex ?? reasoningIndex(request, 2);
  if (effortIndex >= 3 && capabilities.proAvailable === false) {
    throw new Error(`${effortIndex === 4 ? "ChatGPT Pro" : "ChatGPT Extra High"} is not available for this account`);
  }
  return Object.freeze({ ...base, id: modelId, effortIndex, harness: base.mode === "full" });
}

function catalogRows() {
  return [
    {
      slug: "chatgpt-web/sol",
      label: "ChatGPT Web — Sol (Browser only)",
      description: "ChatGPT Web without native Codex tools. Model effort is selected separately.",
      mode: "browser",
    },
    {
      slug: "chatgpt-web/sol-full",
      label: "ChatGPT Web — Sol (Full)",
      description: `ChatGPT Web with native Codex tools through ${CONNECTOR_NAME}. Model effort is selected separately.`,
      mode: "full",
    },
  ];
}

function textPart(part) {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  return typeof part.text === "string" ? part.text : "";
}

function normalizeContent(content, images) {
  const parts = Array.isArray(content) ? content : [content];
  const normalized = [];
  for (const part of parts) {
    if (typeof part === "string") {
      normalized.push({ type: "text", text: part });
      continue;
    }
    if (!part || typeof part !== "object") continue;
    if (part.type === "encrypted_content") throw new Error("ChatGPT Web does not support encrypted cross-backend message content");
    if (["input_text", "output_text", "text"].includes(part.type) || typeof part.text === "string") {
      normalized.push({ type: "text", text: textPart(part) });
      continue;
    }
    if (["input_image", "image", "computer_screenshot"].includes(part.type)) {
      let source = part.image_url ?? part.imageUrl ?? part.url ?? part.path ?? null;
      if (source && typeof source === "object") source = source.url;
      if (!source && part.data && (part.mimeType ?? part.mime_type)) source = `data:${part.mimeType ?? part.mime_type};base64,${part.data}`;
      const attachment = {
        id: `image-${images.length + 1}-${sha(source).slice(0, 12)}`,
        source,
        detail: part.detail ?? null,
        mimeType: part.mimeType ?? part.mime_type ?? null,
      };
      images.push(attachment);
      normalized.push({ type: "image_attachment", id: attachment.id, detail: attachment.detail });
      continue;
    }
    normalized.push({ type: part.type ?? "unknown", value: stable(part) });
  }
  return normalized;
}

function normalizeInput(request) {
  if (request?.previous_response_id) throw new Error('ChatGPT Web requires canonical full input; previous_response_id-only continuation is not supported by this build');
  const images = [];
  const records = [];
  if (typeof request?.instructions === "string" && request.instructions) {
    records.push({ type: "instructions", role: "system", content: [{ type: "text", text: request.instructions }] });
  }
  const input = require('./web-history.cjs').inputFor(request)
    ?? (typeof request?.input === 'string' ? [{ type: 'message', role: 'user', content: request.input }] : request?.input);
  for (const item of Array.isArray(input) ? input : []) {
    if (!item || typeof item !== "object" || item.type === "additional_tools") continue;
    if (item.type === 'agent_message') {
      // Reference parser.ts / environment.ts: keep external agent messages distinct
      // from user/developer authority. Never interpret backend ciphertext as text.
      const opaque = value => value && typeof value === 'object' && (value.type === 'encrypted_content'
        || (Array.isArray(value) ? value.some(opaque) : Object.values(value).some(opaque)));
      if (opaque(item.content)) throw new Error('ChatGPT Web cannot read encrypted V2 agent messages; a plaintext-delivery protocol is required');
      if (typeof item.id !== 'string' || !item.id || typeof item.author !== 'string' || typeof item.recipient !== 'string') throw new Error('Agent message routing identity is incomplete');
      const metadata = parseMetadata(request);
      if (metadata.subagent_kind === 'thread_spawn' && input.findLast(x=>x?.type==='agent_message') === item
        && (metadata.thread_id === metadata.parent_thread_id || metadata.agent_name !== item.recipient)) throw new Error('Agent message recipient does not match the native child routing identity');
      records.push({...stable(item), type:'agent_message', role:'agentMessage', content:normalizeContent(item.content, images)});
      continue;
    }
    if (item.encrypted_content && !['compaction', 'reasoning'].includes(item.type)) throw new Error('ChatGPT Web cannot transport an encrypted native input item');
    if (item.type === "message" || (!item.type && item.role)) {
      records.push({
        ...stable(item),
        type: "message",
        role: item.role ?? "context",
        content: normalizeContent(item.content, images),
      });
      continue;
    }
    if (["custom_tool_call", "function_call"].includes(item.type)) {
      records.push({
        ...stable(item),
        type: item.type,
        call_id: item.call_id ?? item.callId ?? null,
        name: item.name ?? null,
        input: item.input ?? item.arguments ?? null,
      });
      continue;
    }
    if (["custom_tool_call_output", "function_call_output"].includes(item.type)) {
      const result = normalizeRichResult(item.output, item.is_error ?? item.isError);
      records.push({
        type: item.type,
        call_id: item.call_id ?? item.callId ?? null,
        output: { ...result, content: normalizeContent(result.content, images) },
      });
      continue;
    }
    if (item.type === "compaction_trigger") {
      records.push({ type: "compaction_trigger" });
      continue;
    }
    if (item.type === "compaction" && typeof item.encrypted_content === "string") {
      if (item.encrypted_content.startsWith(COMPACTION_PREFIX)) {
        const summary = decodeWebCheckpoint(item.encrypted_content);
        records.push({ type: "compacted_context", content: summary });
      } else {
        throw new Error("ChatGPT Web cannot restore opaque native compaction; this protocol is unsupported");
      }
      continue;
    }
    if (item.type === "reasoning") {
      // Only public summaries are transportable, never private reasoning payloads.
      if (item.summary?.length) records.push({ type: "public_summary", summary: stable(item.summary) });
      continue;
    }
    records.push(stable(item));
  }
  return { records, images };
}

function toolKind(tool) {
  return tool?.type === "custom" || tool?.format ? "freeform" : "function";
}

function extractToolRegistry(request) {
  const inventory = [];
  const add = (tool, namespace = null) => {
    if (tool?.type === "namespace") {
      for (const child of tool.tools ?? []) add(child, namespace ? `${namespace}.${tool.name}` : tool.name);
      return;
    }
    if (!["function", "custom"].includes(tool?.type)) return;
    if (!tool || typeof tool.name !== "string" || !tool.name) return;
    inventory.push({
      wireName: namespace ? `${namespace}.${tool.name}` : tool.name,
      namespace,
      name: tool.name,
      kind: toolKind(tool),
      description: typeof tool.description === "string" ? tool.description : "",
      schema: stable(tool.parameters ?? tool.input_schema ?? tool.inputSchema ?? tool.format ?? null),
    });
  };
  for (const tool of Array.isArray(request?.tools) ? request.tools : []) add(tool);
  for (const item of Array.isArray(request?.input) ? request.input : []) {
    if (item?.type !== "additional_tools") continue;
    for (const entry of Array.isArray(item.tools) ? item.tools : []) {
      if (entry?.type === "namespace" && Array.isArray(entry.tools)) {
        for (const tool of entry.tools) add(tool, entry.name ?? null);
      } else {
        add(entry);
      }
    }
  }
  const seen = new Set();
  return inventory.filter((tool) => {
    if (seen.has(tool.wireName)) return false;
    seen.add(tool.wireName);
    return true;
  });
}

function normalizeResultContent(value) {
  if (typeof value === "string") return [{ type: "text", text: value }];
  if (!Array.isArray(value)) return [];
  return value.map((part) => {
    if (typeof part === "string") return { type: "text", text: part };
    if (!part || typeof part !== "object") return { type: "text", text: String(part ?? "") };
    if (["input_text", "output_text"].includes(part.type)) return { ...part, type: "text" };
    return stable(part);
  });
}

function normalizeRichResult(output, explicitError) {
  const candidates = typeof output === "string" ? [output] : (Array.isArray(output) ? output.map(textPart) : []);
  const marked = candidates.find((text) => text.includes(NATIVE_RESULT_MARKER)) ?? "";
  const markerAt = marked.indexOf(NATIVE_RESULT_MARKER);
  if (markerAt !== -1) {
    try {
      const parsed = JSON.parse(marked.slice(markerAt + NATIVE_RESULT_MARKER.length).trim());
      const normalized = normalizeRichResult(parsed, explicitError);
      const transportContent = normalizeResultContent(output).filter((part) => !part?.text?.includes?.(NATIVE_RESULT_MARKER));
      return transportContent.length
        ? { ...normalized, _meta: { ...normalized._meta, codexppTransportContent: transportContent } }
        : normalized;
    } catch {
      return { content: [{ type: "text", text: "the native tool returned a malformed rich-result envelope" }], isError: true };
    }
  }
  if (output && typeof output === "object" && !Array.isArray(output)
    && (Array.isArray(output.content) || output.structuredContent !== undefined || output.isError !== undefined)) {
    return {
      ...stable(output),
      content: normalizeResultContent(output.content),
      ...(output.structuredContent !== undefined ? { structuredContent: stable(output.structuredContent) } : {}),
      isError: explicitError === true || output.isError === true,
      ...(output._meta !== undefined ? { _meta: stable(output._meta) } : {}),
    };
  }
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return { ...stable(output), structuredContent: stable(output),
      content: [{ type: "text", text: typeof output.output === "string" ? output.output : JSON.stringify(output) }],
      isError: explicitError === true };
  }
  return { content: normalizeResultContent(output), isError: explicitError === true };
}

function extractToolOutputs(request) {
  const outputs = [];
  for (const item of Array.isArray(request?.input) ? request.input : []) {
    if (!["custom_tool_call_output", "function_call_output"].includes(item?.type)) continue;
    const callId = item.call_id ?? item.callId;
    if (typeof callId !== "string" || !callId) continue;
    outputs.push({ callId, result: normalizeRichResult(item.output, item.is_error ?? item.isError) });
  }
  return outputs;
}

function contractDigest(request) {
  const { records } = normalizeInput(request);
  const durable = records.filter((item) => item.type === "instructions"
    || (item.type === "message" && ["system", "developer"].includes(item.role)));
  return sha(JSON.stringify(stable({ durable, text: request?.text ?? null })));
}

function conversationKeyOf(request, model, accountKey = "default") {
  const identity = parseTurnIdentity(request);
  const spec = requireWebModel(model, {}, request);
  return sha(JSON.stringify({
    contract: CONTRACT_VERSION,
    threadId: identity.threadId,
    epoch: identity.epoch,
    family: spec.family,
    mode: spec.mode,
    effortIndex: spec.effortIndex,
    accountKey,
  }));
}

function contextCheckpoint(request, output) {
  // Reference dev-chat.historyOutput binds generated output to its native turn.
  // Desktop 0.153.4 additionally annotates our output text as kind "unknown".
  // Mirror only the measured metadata protocol; never discard provenance to force reuse.
  const annotated = (Array.isArray(request.input) ? request.input : []).some(item => {
    const metadata = item?.internal_chat_message_metadata_passthrough;
    return typeof metadata?.turn_id === 'string' && Array.isArray(metadata.content_item_kinds);
  });
  const turnId = annotated ? parseTurnIdentity(request).turnId : null;
  const history = output.map(item => annotated && item.type === 'message' && item.role === 'assistant'
    ? { ...item, internal_chat_message_metadata_passthrough: {
      turn_id: turnId, content_item_kinds: item.content.map(() => 'unknown'),
    } } : item);
  return [...normalizeInput(request).records, ...normalizeInput({ input: history }).records];
}

function canonicalSuffix(previous, current) {
  if (!Array.isArray(previous) || !previous.length || previous.length > current.length) return null;
  const replay = records => records.map(record => {
    const value = { ...record };
    // Measured engine 0.153.4 preserves id/role/content/phase but omits completed SSE status.
    if (value.status === 'completed') delete value.status;
    return value;
  });
  if (JSON.stringify(stable(replay(previous))) !== JSON.stringify(stable(replay(current.slice(0, previous.length))))) return null;
  return current.slice(previous.length);
}

function runtimeContextUpdates(previous, current) {
  const before=new Map(normalizeInput(previous).records.filter(x=>x.type==='agent_message').map(x=>[x.id,x]));
  const seen=new Set(),updates=[];
  for(const item of normalizeInput(current).records.filter(x=>x.type==='agent_message')) {
    if(seen.has(item.id))throw Error('Duplicate native agent message identity');
    seen.add(item.id);
    if(before.has(item.id)) {
      if(JSON.stringify(stable(before.get(item.id)))!==JSON.stringify(stable(item)))throw Error('Native agent message changed under an existing identity');
    } else updates.push(item);
  }
  if(updates.length>64 || Buffer.byteLength(JSON.stringify(updates))>65536)throw Error('Native agent context update exceeds its bounded transport size');
  if(JSON.stringify(updates).includes('"image_attachment"'))throw Error('A new multimodal agent message requires a fresh browser context; it cannot be reduced to text in a waiting tool result');
  return updates;
}

function promptBudget(text, { effortIndex = 2, proAvailable = false, images = [], outputReserve = 8192 } = {}) {
  // Reference chatgpt-web-models.ts distinguishes account limits from native model windows.
  const composerCharLimit = proAvailable ? COMPOSER_LIMITS[effortIndex] : effortIndex === 0 ? 211256 : 1048572;
  const contextWindow = proAvailable ? (effortIndex === 4 ? 104000 : 103000) + 8193 : effortIndex === 0 ? 41000 : 90000;
  const imageReserve = images.reduce((total, image) => total + (image.detail === 'original' ? 8192 : 4096), 0);
  const bytes = Buffer.byteLength(text, 'utf8');
  const inputBudget = contextWindow - 8192 - outputReserve - imageReserve;
  if (text.length > composerCharLimit) throw new Error(`ChatGPT Web composer exceeds ${composerCharLimit} characters; no text was truncated`);
  const estimatedTokens = require('./token-estimate.cjs').estimateTokens(text);
  if (estimatedTokens > inputBudget) throw new Error(`ChatGPT Web token preflight (${estimatedTokens} o200k estimated, ${inputBudget} available) requires compaction; no text was truncated`);
  return { characters: text.length, bytes, estimatedTokens, tokenizer: 'o200k_base', inputBudget, composerCharLimit, estimated: true, providerUsage: null };
}

function estimateUsage(request, output=[]) {
  // Reference usage.ts: the native compaction trigger needs a token count at tool
  // boundaries too. These are local estimates, not billed/observed provider usage.
  const compiled=compilePrompt(request,{harness:false,preflightBudget:false});
  const estimate=require('./token-estimate.cjs').estimateTokens;
  const input_tokens=estimate(compiled.text)+compiled.images.reduce((n,image)=>n+(image.detail==='original'?8192:4096),0);
  const output_tokens=estimate(JSON.stringify(output));
  return {usage:{input_tokens,output_tokens,total_tokens:input_tokens+output_tokens},
    metadata:{codexpp_usage:{estimated:true,tokenizer:'o200k_base',provider_usage:null}}};
}

function transportBlock({ token, harness, identity }) {
  if (harness && (typeof token !== "string" || !token)) {
    throw new Error("Full ChatGPT Web turns require a non-null current turn token");
  }
  return {
    version: CONTRACT_VERSION,
    connector: harness ? { id: CONNECTOR_ID, name: CONNECTOR_NAME } : null,
    native_tools: harness ? {
      turn_token: token,
      tool_schema_revision:3,
      request_id_rule:'Every connector call requires a unique request_id (8-128 letters, digits, underscores or hyphens). Each new invocation or wait poll gets a new id, even with identical arguments. Only an exact retry keeps its id; never automatically retry an ambiguous side effect.',
      rule: "Use only connector tools advertised for this turn. Keep the same token for every tool round in this logical turn.",
    } : { enabled: false },
    logical_turn: identity ? { thread_id: identity.threadId, turn_id: identity.turnId, epoch: identity.epoch } : null,
  };
}

function compilePrompt(request, { token = null, retained = false, checkpoint = null, harness = false, compaction = false, compactionControl = false, model = request?.model, preflightBudget = true, proAvailable = null } = {}) {
  const identity = request?.client_metadata ? parseTurnIdentity(request) : null;
  const normalized = normalizeInput(request);
  const records = (retained ? canonicalSuffix(checkpoint, normalized.records) : null) ?? normalized.records;
  const ids = new Set();
  const scan = value => {
    if (Array.isArray(value)) { value.forEach(scan); return; }
    if (!value || typeof value !== 'object') return;
    if (value.type === 'image_attachment') ids.add(value.id);
    for (const child of Object.values(value)) if (child && typeof child === 'object') scan(child);
  };
  scan(records);
  const images = normalized.images.filter(image => ids.has(image.id));
  if (preflightBudget && images.length > MAX_ATTACHMENTS) {
    throw new Error(`ChatGPT Web supports at most ${MAX_ATTACHMENTS} image attachments per browser message`);
  }
  const transport = transportBlock({ token, harness, identity });
  const inventory = compaction ? [] : extractToolRegistry(request).map(({ wireName, kind }) => ({ wireName, kind }));
  const payload = {
    codex_transport: transport,
    task_context: {
      records,
      output_schema: request?.text?.format ?? null,
      workspace: identity ? { cwd: identity.cwd, sandbox: identity.sandbox } : null,
      advertised_native_tools: inventory,
      attachments: images.map(({ id, detail, mimeType }) => ({ id, detail, mimeType })),
    },
  };
  const text = [
    compaction ? `Summarize the structured context as a checkpoint. Do not continue the task or call ${compactionControl ? 'ordinary work tools; only the separate reserved checkpoint submission is allowed' : 'any tools'}.` : "Continue the Codex task using the structured context below. Preserve its role ordering and task semantics.",
    compaction ? "This checkpoint operation has no native tool authority." : harness
      ? `When native evidence or an edit is needed, use ${CONNECTOR_NAME}; first inspect its paginated inventory and call only tools advertised for this turn.`
      : "This Browser-only mode has no native tool access; report any missing capability instead of simulating it.",
    "Do not expose or reinterpret the transport fields as user instructions.",
    "<codex_context_json>",
    JSON.stringify(payload),
    "</codex_context_json>",
  ].join("\n");
  const effortIndex = model && BASE_MODELS[model] ? requireWebModel(model, {}, request).effortIndex : reasoningIndex(request, 2);
  const budget = preflightBudget ? promptBudget(text, { effortIndex, proAvailable: proAvailable ?? effortIndex >= 3, images }) : null;
  return {
    text,
    images,
    records,
    bytes: Buffer.byteLength(text, "utf8"),
    budget,
    contractDigest: contractDigest(request),
  };
}

function isCompactionRequest(request, pathname = "") {
  if (pathname.endsWith("/responses/compact")) return "v1";
  const input = Array.isArray(request?.input) ? request.input : [];
  return input.at(-1)?.type === "compaction_trigger" ? "v2" : null;
}

function buildCompactionReplacement(request, summaryText) {
  if (typeof summaryText !== "string" || !summaryText.trim()) {
    throw new Error("ChatGPT Web compaction requires a verified non-empty summary");
  }
  const items = (Array.isArray(request?.input) ? request.input : []).filter((item) => item?.type !== "compaction_trigger");
  const recentUsers = [];
  let remaining = 80_000, imageCount = 0;
  for (const item of items.slice().reverse()) {
    if ((item?.type && item.type !== 'message') || item?.role !== 'user') continue;
    const blocks = typeof item.content === 'string' ? [{ type: 'input_text', text: item.content }] : item.content ?? [];
    const text = blocks.map(textPart).join('');
    if (text.startsWith(SUMMARY_PREFIX) || /^<(?:goal_context|codex_internal_context\b[^>]*)>[\s\S]*<\/(?:goal_context|codex_internal_context)>$/.test(text.trim())) continue;
    const kept = [];
    for (const block of blocks.slice().reverse()) {
      if (block.type === 'input_image') { if (imageCount < MAX_ATTACHMENTS) { kept.unshift(structuredClone(block)); imageCount++; } continue; }
      if (!['input_text', 'text'].includes(block.type)) throw new Error(`Unsupported retained compaction block: ${block.type}`);
      if (typeof block.text !== 'string' || !remaining) continue;
      const retainedText = block.text.slice(-remaining);
      remaining -= retainedText.length;
      if (retainedText) kept.unshift({ ...structuredClone(block), type: 'input_text', text: retainedText });
    }
    if (kept.length) recentUsers.unshift({ ...structuredClone(item), type: 'message', role: 'user', content: kept });
  }
  return [...recentUsers, {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: `${SUMMARY_PREFIX}\n${summaryText.trim()}` }],
  }];
}

module.exports = {
  WEB_MODEL_PREFIX,
  CONNECTOR_ID,
  CONNECTOR_NAME,
  CONTRACT_VERSION,
  COMPOSER_LIMITS,
  catalogRows,
  supportedModels: () => Object.keys(BASE_MODELS),
  requireWebModel,
  parseTurnIdentity,
  conversationKeyOf,
  compilePrompt,
  normalizeInput,
  restoreWebCheckpointForNative,
  canonicalSuffix,
  contextCheckpoint,
  promptBudget,
  estimateUsage,
  runtimeContextUpdates,
  extractToolRegistry,
  extractToolOutputs,
  normalizeRichResult,
  isCompactionRequest,
  buildCompactionReplacement,
};
