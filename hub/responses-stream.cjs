const crypto = require("node:crypto");

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString("hex")}`;
}

function frame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function envelope({ responseId, model, promptCacheKey, status, output }) {
  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    background: false,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model,
    output,
    parallel_tool_calls: false,
    previous_response_id: null,
    prompt_cache_key: promptCacheKey ?? null,
    reasoning: { context: "all_turns", effort: "high", mode: "standard", summary: null },
    service_tier: "auto",
    store: false,
    temperature: 1.0,
    text: { format: { type: "text" }, verbosity: "medium" },
    tool_choice: "auto",
    tools: [],
    top_p: 1.0,
    truncation: "disabled",
    usage: null,
    metadata: {}
  };
}

function messageItem({ itemId, text, status }) {
  return {
    id: itemId,
    type: "message",
    status,
    content: status === "completed"
      ? [{ type: "output_text", annotations: [], logprobs: [], text }]
      : [],
    phase: "final_answer",
    role: "assistant"
  };
}

function* events({ model, promptCacheKey, text }) {
  const responseId = id("resp");
  const itemId = id("msg");
  let sequence = 0;
  const next = () => sequence++;

  yield frame("response.created", {
    type: "response.created",
    response: envelope({ responseId, model, promptCacheKey, status: "in_progress", output: [] }),
    sequence_number: next()
  });
  yield frame("response.in_progress", {
    type: "response.in_progress",
    response: envelope({ responseId, model, promptCacheKey, status: "in_progress", output: [] }),
    sequence_number: next()
  });
  yield frame("response.output_item.added", {
    type: "response.output_item.added",
    item: messageItem({ itemId, text: "", status: "in_progress" }),
    output_index: 0,
    sequence_number: next()
  });
  yield frame("response.content_part.added", {
    type: "response.content_part.added",
    content_index: 0,
    item_id: itemId,
    output_index: 0,
    part: { type: "output_text", annotations: [], logprobs: [], text: "" },
    sequence_number: next()
  });
  yield frame("response.output_text.delta", {
    type: "response.output_text.delta",
    content_index: 0,
    delta: text,
    item_id: itemId,
    logprobs: [],
    output_index: 0,
    sequence_number: next()
  });
  yield frame("response.output_text.done", {
    type: "response.output_text.done",
    content_index: 0,
    item_id: itemId,
    logprobs: [],
    output_index: 0,
    sequence_number: next(),
    text
  });
  yield frame("response.content_part.done", {
    type: "response.content_part.done",
    content_index: 0,
    item_id: itemId,
    output_index: 0,
    part: { type: "output_text", annotations: [], logprobs: [], text },
    sequence_number: next()
  });

  const finalItem = messageItem({ itemId, text, status: "completed" });
  yield frame("response.output_item.done", {
    type: "response.output_item.done",
    item: finalItem,
    output_index: 0,
    sequence_number: next()
  });
  yield frame("response.completed", {
    type: "response.completed",
    response: envelope({ responseId, model, promptCacheKey, status: "completed", output: [finalItem] }),
    sequence_number: next()
  });
}

function toolCallItem({ itemId, callId, source, status }) {
  return {
    id: itemId,
    type: "custom_tool_call",
    status,
    call_id: callId,
    input: status === "completed" ? source : "",
    name: "exec"
  };
}

// Codex runs local tools in code mode: one custom tool named `exec` whose input is JavaScript.
function* toolCall({ model, promptCacheKey, callId, source }) {
  const responseId = id("resp");
  const itemId = id("ctc");
  let sequence = 0;
  const next = () => sequence++;

  yield frame("response.created", {
    type: "response.created",
    response: envelope({ responseId, model, promptCacheKey, status: "in_progress", output: [] }),
    sequence_number: next()
  });
  yield frame("response.in_progress", {
    type: "response.in_progress",
    response: envelope({ responseId, model, promptCacheKey, status: "in_progress", output: [] }),
    sequence_number: next()
  });
  yield frame("response.output_item.added", {
    type: "response.output_item.added",
    item: toolCallItem({ itemId, callId, source, status: "in_progress" }),
    output_index: 0,
    sequence_number: next()
  });
  yield frame("response.custom_tool_call_input.delta", {
    type: "response.custom_tool_call_input.delta",
    delta: source,
    item_id: itemId,
    output_index: 0,
    sequence_number: next()
  });
  yield frame("response.custom_tool_call_input.done", {
    type: "response.custom_tool_call_input.done",
    input: source,
    item_id: itemId,
    output_index: 0,
    sequence_number: next()
  });

  const finalItem = toolCallItem({ itemId, callId, source, status: "completed" });
  yield frame("response.output_item.done", {
    type: "response.output_item.done",
    item: finalItem,
    output_index: 0,
    sequence_number: next()
  });
  yield frame("response.completed", {
    type: "response.completed",
    response: envelope({ responseId, model, promptCacheKey, status: "completed", output: [finalItem] }),
    sequence_number: next()
  });
}

function failure({ message }) {
  return frame("response.failed", {
    type: "response.failed",
    response: {
      status: "failed",
      error: { code: "server_error", message }
    },
    sequence_number: 0
  });
}

module.exports = { events, toolCall, failure };
