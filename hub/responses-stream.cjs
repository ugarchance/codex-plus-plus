const crypto = require("node:crypto");

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString("hex")}`;
}

function frame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function envelope({ responseId, model, promptCacheKey, status, output, error = null, incompleteDetails = null, usage=null, metadata={} }) {
  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    background: false,
    error,
    incomplete_details: incompleteDetails,
    instructions: null,
    max_output_tokens: null,
    model,
    output,
    parallel_tool_calls: false,
    previous_response_id: null,
    prompt_cache_key: promptCacheKey ?? null,
    reasoning: { context: "all_turns", effort: null, mode: "standard", summary: null },
    service_tier: "auto",
    store: false,
    temperature: 1.0,
    text: { format: { type: "text" }, verbosity: "medium" },
    tool_choice: "auto",
    tools: [],
    top_p: 1.0,
    truncation: "disabled",
    usage,
    metadata,
  };
}

function messageItem({ itemId, text, status, phase = "final_answer" }) {
  return {
    id: itemId,
    type: "message",
    status,
    content: status === "completed" ? [{ type: "output_text", annotations: [], logprobs: [], text }] : [],
    phase,
    role: "assistant",
  };
}

function toolCallItem({ itemId, callId, source, status, kind = "freeform", name = "exec", namespace }) {
  return {
    id: itemId,
    type: kind === "function" ? "function_call" : "custom_tool_call",
    status,
    call_id: callId,
    [kind === "function" ? "arguments" : "input"]: status === "completed" ? source : "",
    name,
    ...(namespace ? { namespace } : {}),
    // Reference bridge.ts plaintextCollaborationFields (MIT, THIRD_PARTY_NOTICES).
    // V2 otherwise stores these Web-origin strings as opaque backend ciphertext.
    ...(kind === 'function' && namespace === 'collaboration' && ['spawn_agent', 'send_message', 'followup_task'].includes(name)
      ? { encrypted_function_args: [] } : {}),
  };
}

class ResponseStreamWriter {
  constructor(response, { model, promptCacheKey = null, responseId = id("resp") } = {}) {
    this.response = response;
    this.model = model;
    this.promptCacheKey = promptCacheKey;
    this.responseId = responseId;
    this.sequence = 0;
    this.createdAt = Date.now();
    this.started = false;
    this.terminal = false;
    this.output = [];
    this.message = null;
  }

  next() { return this.sequence++; }

  send(event, data) {
    if (this.terminal) return false;
    if (this.response.destroyed || this.response.writableEnded) { this.terminal = true; return false; }
    this.response.write(frame(event, { ...data, sequence_number: this.next() }));
    return true;
  }

  created() {
    if (this.started || this.terminal) return false;
    this.started = true;
    this.send("response.created", {
      type: "response.created",
      response: envelope({
        responseId: this.responseId,
        model: this.model,
        promptCacheKey: this.promptCacheKey,
        status: "in_progress",
        output: [],
      }),
    });
    this.send("response.in_progress", {
      type: "response.in_progress",
      response: envelope({
        responseId: this.responseId,
        model: this.model,
        promptCacheKey: this.promptCacheKey,
        status: "in_progress",
        output: [],
      }),
    });
    return true;
  }

  heartbeat({ phase = "browser", activeTools = 0, revision = 0 } = {}) {
    if (!this.started || this.terminal) return false;
    return this.send("response.heartbeat", {
      type: "response.heartbeat",
      response_id: this.responseId,
      phase,
      active_tools: activeTools,
      revision,
      elapsed_ms: Date.now() - this.createdAt,
    });
  }

  ensureMessage(phase = "final_answer") {
    if (this.message) return this.message;
    const itemId = id(phase === "commentary" ? "commentary" : "msg");
    this.message = { itemId, text: "", outputIndex: this.output.length, phase };
    this.send("response.output_item.added", {
      type: "response.output_item.added",
      item: messageItem({ itemId, text: "", status: "in_progress", phase }),
      output_index: this.message.outputIndex,
    });
    this.send("response.content_part.added", {
      type: "response.content_part.added",
      content_index: 0,
      item_id: itemId,
      output_index: this.message.outputIndex,
      part: { type: "output_text", annotations: [], logprobs: [], text: "" },
    });
    return this.message;
  }

  textDelta(delta, { phase = "final_answer" } = {}) {
    if (!this.started || this.terminal || typeof delta !== "string" || !delta) return false;
    const message = this.ensureMessage(phase);
    message.text += delta;
    return this.send("response.output_text.delta", {
      type: "response.output_text.delta",
      content_index: 0,
      delta,
      item_id: message.itemId,
      logprobs: [],
      output_index: message.outputIndex,
    });
  }

  finishMessage() {
    const message = this.message;
    if (!message) return null;
    this.send("response.output_text.done", {
      type: "response.output_text.done",
      content_index: 0,
      item_id: message.itemId,
      logprobs: [],
      output_index: message.outputIndex,
      text: message.text,
    });
    this.send("response.content_part.done", {
      type: "response.content_part.done",
      content_index: 0,
      item_id: message.itemId,
      output_index: message.outputIndex,
      part: { type: "output_text", annotations: [], logprobs: [], text: message.text },
    });
    const item = messageItem({ itemId: message.itemId, text: message.text, status: "completed", phase: message.phase });
    this.send("response.output_item.done", {
      type: "response.output_item.done",
      item,
      output_index: message.outputIndex,
    });
    this.output.push(item);
    this.message = null;
    return item;
  }

  toolCalls(calls) {
    if (!this.started || this.terminal) return false;
    this.finishMessage();
    for (const call of calls) {
      const itemId = id("ctc");
      const outputIndex = this.output.length;
      const kind = call.kind ?? "freeform";
      const source = kind === "function" ? JSON.stringify(call.arguments ?? {}) : call.source ?? call.input ?? "";
      const namespace = call.namespace ?? (call.wireName?.includes(".") ? call.wireName.split(".").slice(0, -1).join(".") : null);
      const name = call.name ?? call.wireName?.split(".").at(-1) ?? "exec";
      const spec = { itemId, callId: call.callId, source, kind, namespace, name };
      const event = kind === "function" ? "response.function_call_arguments" : "response.custom_tool_call_input";
      this.send("response.output_item.added", {
        type: "response.output_item.added",
        item: toolCallItem({ ...spec, status: "in_progress" }),
        output_index: outputIndex,
      });
      this.send(`${event}.delta`, {
        type: `${event}.delta`,
        delta: source,
        item_id: itemId,
        output_index: outputIndex,
      });
      this.send(`${event}.done`, {
        type: `${event}.done`,
        [kind === "function" ? "arguments" : "input"]: source,
        item_id: itemId,
        output_index: outputIndex,
      });
      const item = toolCallItem({ ...spec, status: "completed" });
      this.send("response.output_item.done", {
        type: "response.output_item.done",
        item,
        output_index: outputIndex,
      });
      this.output.push(item);
    }
    return true;
  }

  compaction(summary) {
    if (!this.started || this.terminal || typeof summary !== "string" || !summary.trim()) return false;
    const item = {
      id: id("cmp"),
      type: "compaction",
      encrypted_content: `ocx1:${Buffer.from(summary.trim(), "utf8").toString("base64")}`,
    };
    this.send("response.output_item.added", { type: "response.output_item.added", item, output_index: 0 });
    this.send("response.output_item.done", { type: "response.output_item.done", item, output_index: 0 });
    this.output.push(item);
    return true;
  }

  completed({usage=null,metadata={}}={}) {
    if (!this.started || this.terminal) return false;
    this.finishMessage();
    this.send("response.completed", {
      type: "response.completed",
      response: envelope({
        responseId: this.responseId,
        model: this.model,
        promptCacheKey: this.promptCacheKey,
        status: "completed",
        output: this.output,
        usage,metadata,
      }),
    });
    this.terminal = true;
    return true;
  }

  incomplete(message, code = "deadline_exceeded") {
    if (!this.started || this.terminal) return false;
    this.send("response.incomplete", {
      type: "response.incomplete",
      response: envelope({
        responseId: this.responseId,
        model: this.model,
        promptCacheKey: this.promptCacheKey,
        status: "incomplete",
        output: [],
        incompleteDetails: { reason: code, message },
      }),
    });
    this.message = null;
    this.terminal = true;
    return true;
  }

  failed(message, code = "server_error") {
    if (!this.started || this.terminal) return false;
    this.send("response.failed", {
      type: "response.failed",
      response: envelope({
        responseId: this.responseId,
        model: this.model,
        promptCacheKey: this.promptCacheKey,
        status: "failed",
        output: [],
        error: { code, message },
      }),
    });
    this.message = null;
    this.terminal = true;
    return true;
  }
}

// Legacy iterable helpers remain for existing diagnostics; all use the same production writer.
function collect(run, options) {
  const chunks = [];
  const response = { write(chunk) { chunks.push(String(chunk)); return true; } };
  const writer = new ResponseStreamWriter(response, options);
  writer.created();
  run(writer);
  return chunks;
}

function* events({ model, promptCacheKey, text }) {
  yield* collect((writer) => { writer.textDelta(text); writer.completed(); }, { model, promptCacheKey });
}

function* toolCall({ model, promptCacheKey, callId, source }) {
  yield* collect((writer) => { writer.toolCalls([{ callId, source }]); writer.completed(); }, { model, promptCacheKey });
}

function failure({ message, model = "unknown", promptCacheKey = null }) {
  return collect((writer) => writer.failed(message), { model, promptCacheKey }).join("");
}

module.exports = { ResponseStreamWriter, events, toolCall, failure, frame };
