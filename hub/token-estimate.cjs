// Adapted from codex-chatgpt-web e85e3693 src/lib/token-estimate.ts (MIT).
// Copyright (c) 2026 codex-chatgpt-web contributors. See THIRD_PARTY_NOTICES.md.
let tokenizer;
function estimateTokens(text) {
  if (!text) return 0;
  // No byte/character-ratio fallback: a missing runtime dependency is a preflight error.
  tokenizer ??= require('tiktoken').get_encoding('o200k_base');
  let count = 0;
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 4096, text.length);
    if (end < text.length) {
      const previous = text.charCodeAt(end - 1), next = text.charCodeAt(end);
      if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--;
    }
    count += tokenizer.encode_ordinary(text.slice(start, end)).length;
    start = end;
  }
  return count;
}
module.exports = { estimateTokens };
