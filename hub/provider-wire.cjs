const crypto = require("node:crypto");
const providers = require("./providers.cjs");
const CAPSULE = "cxp_reasoning_v1:";

// Chat/Messages tools have a flat name space. Keep the Responses namespace
// contract reversible, including tool calls already present in thread history.
function toolName(name, namespace) {
  if (!namespace) return name;
  const suffix = crypto.createHash('sha256').update(namespace + '\0' + name).digest('hex').slice(0, 12);
  return 'cxp_' + (namespace + '_' + name).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 46) + '_' + suffix;
}
function toolDefinitions(payload) {
  const result = [];
  for (const t of payload.tools ?? []) {
    if (t.type === 'namespace') {
      if (!t.name || !Array.isArray(t.tools)) throw Error('Invalid tool namespace definition.');
      for (const child of t.tools) result.push({ ...child, namespace: t.name });
    } else result.push(t);
  }
  const names = new Set();
  for (const t of result) {
    const name = toolName(t.name, t.namespace);
    if (names.has(name)) throw Error('Invalid duplicate tool name.');
    names.add(name);
  }
  return result;
}

function textContent(content) {
  if (typeof content === "string") return content;
  return (content ?? []).map((p) => p.text ?? "").join("\n");
}
function toolsFor(payload) {
  return toolDefinitions(payload).map((t) => {
    if (t.type === "function")
      return {
        type: "function",
        function: {
          name: toolName(t.name, t.namespace),
          description: t.description,
          parameters: t.parameters ?? { type: "object", properties: {} },
        },
      };
    if (t.type === "custom")
      return {
        type: "function",
        function: {
          name: toolName(t.name, t.namespace),
          description: t.description,
          parameters: {
            type: "object",
            properties: { input: { type: "string" } },
            required: ["input"],
            additionalProperties: false,
          },
        },
      };
    throw Error(`Provider adapter does not support this tool type: ${t.type}`);
  });
}
function messagesFor(payload) {
  const messages = [];
  let reasoning = null;
  if (payload.instructions)
    messages.push({ role: "system", content: payload.instructions });
  for (const item of typeof payload.input === "string"
    ? [{ role: "user", content: payload.input }]
    : (payload.input ?? [])) {
    if (item.type === "function_call" || item.type === "custom_tool_call") {
      const tool = {
        id: item.call_id,
        type: "function",
        function: {
          name: toolName(item.name, item.namespace),
          arguments:
            item.type === "custom_tool_call"
              ? JSON.stringify({ input: item.input })
              : item.arguments,
        },
      };
      const previous = messages.at(-1);
      if (previous?.role === "assistant")
        (previous.tool_calls ??= []).push(tool);
      else
        messages.push({ role: "assistant", content: null, tool_calls: [tool] });
    } else if (
      item.type === "function_call_output" ||
      item.type === "custom_tool_call_output"
    )
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content:
          typeof item.output === "string"
            ? item.output
            : JSON.stringify(item.output),
      });
    else if (item.type === "reasoning") {
      if (item.encrypted_content?.startsWith(CAPSULE)) {
        reasoning = JSON.parse(
          providers.secret({
            secret: item.encrypted_content.slice(CAPSULE.length),
          }),
        );
        if (
          (reasoning.protocol === "chat" &&
            typeof reasoning.text !== "string") ||
          (reasoning.protocol === "anthropic" &&
            !Array.isArray(reasoning.blocks))
        )
          throw Error("Invalid provider reasoning history.");
      }
      continue;
    } else if (item.role) {
      const content =
        typeof item.content === "string"
          ? item.content
          : (item.content ?? []).map((p) => {
              if (["input_text", "output_text", "text"].includes(p.type))
                return { type: "text", text: p.text };
              if (p.type === "input_image" && p.image_url)
                return { type: "image_url", image_url: { url: p.image_url } };
              throw Error("Provider does not support this content type.");
            });
      const role = item.role === "developer" ? "system" : item.role;
      const previous = messages.at(-1);
      if (
        role === "assistant" &&
        previous?.role === "assistant" &&
        previous.tool_calls
      )
        previous.content = [textContent(previous.content), textContent(content)]
          .filter(Boolean)
          .join("\n");
      else messages.push({ role, content });
    } else
      throw Error(
        "Unsupported conversation history item. Start a new chat.",
      );
    if (reasoning && messages.at(-1)?.role === "assistant") {
      const last = messages.at(-1);
      if (reasoning.protocol === "chat")
        last.reasoning_content = reasoning.text;
      else last.__cxpThinking = reasoning.blocks;
      reasoning = null;
    }
  }
  return messages;
}
function chatRequest(payload, model) {
  const body = {
    model: model.id,
    messages: messagesFor(payload),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (payload.tools?.length) body.tools = toolsFor(payload);
  if (payload.reasoning?.effort && model.efforts.length)
    body.reasoning_effort = payload.reasoning.effort;
  if (payload.max_output_tokens) body.max_tokens = payload.max_output_tokens;
  if (body.tools?.length) {
    body.tool_choice =
      typeof payload.tool_choice === "string"
        ? payload.tool_choice
        : payload.tool_choice?.type === "function"
          ? { type: "function", function: { name: toolName(payload.tool_choice.name, payload.tool_choice.namespace) } }
          : "auto";
    if (
      model.requestProfile === "auto-tool-choice" &&
      body.tool_choice !== "none"
    )
      body.tool_choice = "auto";
  }
  return body;
}
function anthropicRequest(payload, model) {
  const chat = chatRequest(payload, model);
  const messages = [];
  const system = [];
  for (const m of chat.messages) {
    if (m.role === "system") {
      system.push(textContent(m.content));
      continue;
    }
    let content = [];
    if (m.role === "tool")
      content = [
        {
          type: "tool_result",
          tool_use_id: m.tool_call_id,
          content: m.content,
        },
      ];
    else {
      for (const p of typeof m.content === "string"
        ? [{ type: "text", text: m.content }]
        : (m.content ?? [])) {
        if (p.type === "text" && p.text) content.push(p);
        else if (p.type === "image_url") {
          const match = /^data:([^;]+);base64,(.*)$/.exec(p.image_url.url);
          content.push({
            type: "image",
            source: match
              ? { type: "base64", media_type: match[1], data: match[2] }
              : { type: "url", url: p.image_url.url },
          });
        }
      }
      for (const t of m.tool_calls ?? [])
        content.push({
          type: "tool_use",
          id: t.id,
          name: t.function.name,
          input: JSON.parse(t.function.arguments),
        });
    }
    if (m.__cxpThinking) content.unshift(...m.__cxpThinking);
    const role = m.role === "assistant" ? "assistant" : "user";
    if (messages.at(-1)?.role === role)
      messages.at(-1).content.push(...content);
    else messages.push({ role, content });
  }
  const body = {
    model: model.id,
    system: system.join("\n"),
    messages,
    max_tokens: Math.min(payload.max_output_tokens ?? 8192, 16384),
    stream: true,
  };
  if (chat.tools)
    body.tools = chat.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  // Messages routes are capability-specific. Never fabricate a thinking budget.
  if (model.efforts.length && payload.reasoning?.effort)
    body.output_config = { effort: payload.reasoning.effort };
  return body;
}
async function* sse(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 8 * 1024 * 1024)
      throw Error("Provider event is too large.");
    let separator;
    while ((separator = /\r?\n\r?\n/.exec(buffer))) {
      const event = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      yield JSON.parse(data);
    }
  }
  if (buffer.trim()) throw Error("Incomplete provider stream.");
}
function responseWriter(res) {
  let sequence = 0;
  const id = "resp_" + crypto.randomUUID().replaceAll("-", "");
  const items = [];
  let textItem;
  let textIndex;
  let reasoningItem;
  let reasoningIndex;
  let reasoningValue;
  const calls = new Map();
  function emit(type, data) {
    res.write(
      `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`,
    );
  }
  function base(status, usage) {
    return {
      id,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status,
      output: items,
      usage,
    };
  }
  function begin() {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
    });
    emit("response.created", { response: base("in_progress") });
  }
  function reasoning(value) {
    if (!reasoningItem) {
      reasoningIndex = items.length;
      reasoningItem = {
        id: "rs_" + crypto.randomUUID(),
        type: "reasoning",
        summary: [],
      };
      items.push(reasoningItem);
      emit("response.output_item.added", {
        output_index: reasoningIndex,
        item: reasoningItem,
      });
    }
    reasoningValue = value;
  }
  function text(delta) {
    if (!delta) return;
    if (!textItem) {
      textIndex = items.length;
      textItem = {
        id: "msg_" + crypto.randomUUID(),
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: [{ type: "output_text", text: "", annotations: [] }],
      };
      items.push(textItem);
      emit("response.output_item.added", {
        output_index: textIndex,
        item: { ...textItem, content: [] },
      });
      emit("response.content_part.added", {
        item_id: textItem.id,
        output_index: textIndex,
        content_index: 0,
        part: textItem.content[0],
      });
    }
    textItem.content[0].text += delta;
    emit("response.output_text.delta", {
      item_id: textItem.id,
      output_index: textIndex,
      content_index: 0,
      delta,
    });
  }
  function call(index, delta) {
    let t = calls.get(index);
    if (!t) {
      t = {
        id: "fc_" + crypto.randomUUID(),
        type: "function_call",
        status: "in_progress",
        call_id: delta.id ?? "call_" + crypto.randomUUID(),
        name: "",
        arguments: "",
      };
      calls.set(index, t);
    }
    if (delta.id) t.call_id = delta.id;
    if (delta.name) t.name += delta.name;
    if (delta.arguments) t.arguments += delta.arguments;
  }
  function complete(usage, customNames, toolBindings = new Map()) {
    if (reasoningItem) {
      reasoningItem.encrypted_content =
        CAPSULE + providers.encrypt(JSON.stringify(reasoningValue));
      emit("response.output_item.done", {
        output_index: reasoningIndex,
        item: reasoningItem,
      });
    }
    if (textItem) {
      textItem.status = "completed";
      emit("response.output_text.done", {
        item_id: textItem.id,
        output_index: textIndex,
        content_index: 0,
        text: textItem.content[0].text,
      });
      emit("response.content_part.done", {
        item_id: textItem.id,
        output_index: textIndex,
        content_index: 0,
        part: textItem.content[0],
      });
      emit("response.output_item.done", {
        output_index: textIndex,
        item: textItem,
      });
    }
    for (const item of calls.values()) {
      if (!item.name) throw Error("Tool name is missing.");
      item.arguments ||= "{}";
      JSON.parse(item.arguments);
      item.status = "completed";
      if (customNames.has(item.name)) {
        item.type = "custom_tool_call";
        item.input = JSON.parse(item.arguments).input;
        if (typeof item.input !== "string")
          throw Error("Custom tool input is missing.");
        delete item.arguments;
      }
      const binding = toolBindings.get(item.name);
      if (binding?.namespace) {
        item.name = binding.name;
        item.namespace = binding.namespace;
      }
      const index = items.length;
      items.push(item);
      emit("response.output_item.added", {
        output_index: index,
        item: { ...item, status: "in_progress" },
      });
      emit("response.output_item.done", { output_index: index, item });
    }
    emit("response.completed", { response: base("completed", usage) });
    res.end();
  }
  return { begin, text, call, complete, emit, reasoning };
}
async function translateStream(upstream, res, protocol, payload) {
  const writer = responseWriter(res);
  writer.begin();
  let usage;
  let finished = false;
  let reasoningText = "";
  const thinking = new Map();
  const definitions = toolDefinitions(payload);
  const names = new Set(definitions.filter(t => t.type === 'custom').map(t => toolName(t.name, t.namespace)));
  const bindings = new Map(definitions.map(t => [toolName(t.name, t.namespace), t]));
  for await (const e of sse(upstream.body)) {
    if (e.error || e.type === "error") throw Error("Provider stream error.");
    if (protocol === "chat") {
      if (e.usage)
        usage = {
          input_tokens: e.usage.prompt_tokens ?? 0,
          output_tokens: e.usage.completion_tokens ?? 0,
          total_tokens: e.usage.total_tokens ?? 0,
          input_tokens_details: {
            cached_tokens: e.usage.prompt_tokens_details?.cached_tokens ?? 0,
          },
        };
      for (const choice of e.choices ?? []) {
        if (choice.index && choice.index !== 0) continue;
        if (choice.finish_reason) {
          if (["length", "content_filter"].includes(choice.finish_reason))
            throw Error(
              "Provider response stopped before completion: " + choice.finish_reason,
            );
          finished = true;
        }
        const delta = choice.delta ?? {};
        if (typeof delta.reasoning_content === "string") {
          reasoningText += delta.reasoning_content;
          writer.reasoning({ protocol: "chat", text: reasoningText });
        }
        writer.text(delta.content);
        for (const t of delta.tool_calls ?? [])
          writer.call(t.index, {
            id: t.id,
            name: t.function?.name,
            arguments: t.function?.arguments,
          });
      }
    } else {
      if (e.type === "message_start")
        usage = {
          input_tokens: e.message.usage?.input_tokens ?? 0,
          output_tokens: 0,
        };
      if (
        e.type === "content_block_start" &&
        ["thinking", "redacted_thinking"].includes(e.content_block.type)
      ) {
        thinking.set(e.index, { ...e.content_block });
        writer.reasoning({
          protocol: "anthropic",
          blocks: [...thinking.values()],
        });
      }
      if (e.type === "content_block_delta" && thinking.has(e.index)) {
        const block = thinking.get(e.index);
        if (e.delta.type === "thinking_delta")
          block.thinking = (block.thinking ?? "") + e.delta.thinking;
        if (e.delta.type === "signature_delta")
          block.signature = (block.signature ?? "") + e.delta.signature;
        writer.reasoning({
          protocol: "anthropic",
          blocks: [...thinking.values()],
        });
      }
      if (
        e.type === "content_block_start" &&
        e.content_block.type === "tool_use"
      )
        writer.call(e.index, {
          id: e.content_block.id,
          name: e.content_block.name,
        });
      if (e.type === "content_block_delta") {
        writer.text(e.delta?.type === "text_delta" ? e.delta.text : "");
        if (e.delta?.type === "input_json_delta")
          writer.call(e.index, { arguments: e.delta.partial_json });
      }
      if (e.type === "message_delta") {
        if (e.delta?.stop_reason === "max_tokens")
          throw Error("Provider response reached its output limit.");
        if (e.usage)
          usage = { ...usage, output_tokens: e.usage.output_tokens ?? 0 };
      }
      if (e.type === "message_stop") finished = true;
    }
  }
  if (!finished) throw Error("Provider connection closed before completion.");
  if (usage)
    usage.total_tokens ??=
      (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  writer.complete(usage, names, bindings);
  return usage;
}
module.exports = {
  messagesFor,
  chatRequest,
  anthropicRequest,
  sse,
  responseWriter,
  translateStream,
};
