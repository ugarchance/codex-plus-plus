#!/usr/bin/env node

// Patch 090 has to survive the renderer shipping any of the known
// thread/unarchived handler shapes, and has to fail closed when the shape is
// ambiguous. Hardcoding the branding helper name (`Il(` -> `Mm(`) is what broke
// it on macOS 26.825.51511; these cases keep the anchor name-independent.

import patch from "../patch/patches/090-auto-routing-core.mjs";

const CREATE_GUARD = "throw Error(`Durable side conversations must start on a local host`);";
const STARTED = "case`thread/started`:{let{thread:i}=r.params,a=t.upsertConversationFromThread(i);t.threadStore.record(i.id);return}";

const SHAPES = {
  "direct, Mm wrapper (macOS 26.825)": "case`thread/unarchived`:t.handleThreadUnarchived(Mm(r.params.threadId));return;",
  "direct, Il wrapper (win 26.820)": "case`thread/unarchived`:t.handleThreadUnarchived(Il(r.params.threadId));return;",
  "direct, no wrapper": "case`thread/unarchived`:t.handleThreadUnarchived(r.params.threadId);return;",
  "direct, $-prefixed wrapper": "case`thread/unarchived`:t.handleThreadUnarchived($5(r.params.threadId));return;",
  "historical destructured": "case`thread/unarchived`:{let{threadId:q}=r.params;t.handle(q)}",
};

const bundle = (unarchived) => `let x=1;${STARTED}${unarchived ?? ""}${CREATE_GUARD}`;

let failures = 0;

function pass(label, detail) {
  console.log(`[PASS] ${label.padEnd(36)} ${detail}`);
}

function fail(label, detail) {
  console.log(`[FAIL] ${label.padEnd(36)} ${detail}`);
  failures++;
}

for (const [label, unarchived] of Object.entries(SHAPES)) {
  try {
    const out = patch.apply(bundle(unarchived));
    const hooks = (out.match(/__cxpLearnThread\?\.\(/g) ?? []).length;
    const autoRoute = out.includes(`${CREATE_GUARD}await globalThis.__cxpAutoRoute?.();`);
    if (out.includes(patch.marker) && hooks === 2 && autoRoute) {
      pass(label, `learnThread hooks = 2, autoRoute injected`);
    } else {
      fail(label, `marker=${out.includes(patch.marker)} hooks=${hooks} autoRoute=${autoRoute}`);
    }
  } catch (err) {
    fail(label, err.message);
  }
}

const ambiguous = {
  "both shapes present": bundle(SHAPES["direct, Mm wrapper (macOS 26.825)"] + SHAPES["historical destructured"]),
  "no unarchived handler": bundle(null),
};

for (const [label, source] of Object.entries(ambiguous)) {
  try {
    patch.apply(source);
    fail(label, "expected the patch to fail closed, it applied instead");
  } catch (err) {
    pass(label, `rejected: ${err.message}`);
  }
}

console.log("");
if (failures === 0) {
  console.log("All thread/unarchived shape cases passed.");
} else {
  console.log(`${failures} case(s) failed.`);
  process.exit(1);
}
