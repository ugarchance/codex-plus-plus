const $ = (id) => document.getElementById(id);
let view,
  editing = null,
  models = [];
const el = (tag, text, className) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
};
function status(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}
async function call(method, ...args) {
  const r = await window.providers.call(method, ...args);
  if (!r?.ok) throw Error(r?.error ?? "Operation failed.");
  return r.data;
}
async function run(fn) {
  for (const b of document.querySelectorAll("button")) b.disabled = true;
  try {
    await fn();
  } catch (e) {
    status(e.message, true);
  } finally {
    for (const b of document.querySelectorAll("button")) b.disabled = false;
  }
}
function button(label, fn) {
  const b = el("button", label);
  b.type = "button";
  b.onclick = () => run(fn);
  return b;
}
function providerName(id) {
  return view.presets[id]?.name ?? id;
}
function render() {
  $("catalog-info").textContent =
    `${Object.keys(view.presets).length} providers · ${view.registry.revision.slice(0, 8)}`;
  const root = $("cards");
  root.replaceChildren();
  if (!view.connections.length)
    root.append(
      el(
        "div",
        "No providers connected yet. Choose a provider and add your account.",
        "empty",
      ),
    );
  for (const c of view.connections) {
    const card = el("article", undefined, "card");
    const head = el("div", undefined, "card-head");
    const title = el("div");
    title.append(el("h3", c.label), el("p", providerName(c.providerId)));
    head.append(
      title,
      el(
        "span",
        !c.enabled
          ? "Disabled"
          : c.status === "ready"
            ? "Connected"
            : c.status === "offline"
              ? "Unavailable"
              : "Not tested",
        "badge",
      ),
    );
    card.append(
      head,
      el(
        "p",
        `${c.models.filter((m) => m.enabled).length} models enabled · ${c.hasKey ? "Key saved" : "Local connection"}`,
      ),
    );
    if (c.lastError) card.append(el("p", c.lastError, "danger"));
    const actions = el("div", undefined, "actions");
    actions.append(
      button("Edit", () => edit(c)),
      button("Refresh models", async () => {
        view = await call("discover", c.id);
        render();
        status(
          "Model list refreshed. New models are hidden by default.",
        );
      }),
    );
    const preferred = view.preferred[c.providerId];
    actions.append(
      button(
        preferred === c.id ? "Default connection ✓" : "Use this connection",
        async () => {
          view = await call("select", c.providerId, c.id);
          render();
          status("Connection selected for new chats.");
        },
      ),
      button("Automatic selection", async () => {
        view = await call("select", c.providerId, null);
        render();
        status("An available connection will be selected automatically for new chats.");
      }),
    );
    actions.append(
      button("Delete connection", async () => {
        if (
          !confirm(
            c.label +
              ": delete this connection? Its existing chats cannot continue until it is reconnected.",
          )
        )
          return;
        view = await call("remove", c.id);
        render();
        status("Connection deleted.");
      }),
    );
    card.append(actions);
    root.append(card);
  }
}
function modelRows() {
  const root = $("models");
  root.replaceChildren();
  for (const m of models) {
    const row = el("div", undefined, "model");
    const enabled = el("input");
    enabled.type = "checkbox";
    enabled.checked = m.enabled;
    enabled.disabled = m.supported === false;
    enabled.setAttribute("aria-label", m.label + ": show model");
    enabled.onchange = () => (m.enabled = enabled.checked);
    const title = el("div");
    title.append(
      el("h3", m.label),
      el(
        "small",
        m.id + (m.supported === false ? " · Custom adapter required" : ""),
      ),
    );
    const effort = el("select");
    effort.setAttribute("aria-label", m.label + ": default effort");
    if (!m.efforts.length) {
      effort.append(new Option("No effort options", ""));
      effort.disabled = true;
    } else for (const e of m.efforts) effort.append(new Option(e, e));
    effort.value = m.defaultEffort ?? "";
    effort.onchange = () => (m.defaultEffort = effort.value || null);
    row.append(enabled, title, effort);
    const details = el("details");
    details.append(el("summary", "Model settings"));
    const grid = el("div", undefined, "grid");
    function field(label, value, onchange) {
      const l = el("label", label);
      const i = el("input");
      i.value = value;
      i.onchange = () => onchange(i.value);
      l.append(i);
      grid.append(l);
      return i;
    }
    field("Model ID (API)", m.id, (v) => (m.id = v));
    field("Display name", m.label, (v) => (m.label = v));
    const protoLabel = el("label", "API protocol");
    const proto = el("select");
    for (const p of ["responses", "chat", "anthropic"])
      proto.append(new Option(p, p));
    proto.value = m.protocol;
    proto.onchange = () => (m.protocol = proto.value);
    protoLabel.append(proto);
    grid.append(protoLabel);
    field("Supported efforts (comma-separated)", m.efforts.join(","), (v) => {
      m.efforts = v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      m.defaultEffort = m.efforts.includes(m.defaultEffort)
        ? m.defaultEffort
        : (m.efforts[0] ?? null);
      modelRows();
    });
    field(
      "Context window",
      m.contextWindow,
      (v) => (m.contextWindow = Number(v)),
    );
    details.append(grid);
    row.append(details);
    root.append(row);
  }
}
function presetChanged() {
  const p = view.presets[$("provider").value];
  $("endpoint").value = p.endpoint;
  $("label").value = p.name;
  $("provider-note").textContent =
    p.note ||
    ($("provider").value === "opencode-go"
      ? "Uses the Go subscription. Connect the paid Zen route separately."
      : "");
  models = structuredClone(p.models ?? []);
  modelRows();
}
function edit(c = null) {
  editing = c?.id ?? null;
  $("editor").hidden = false;
  $("edit-title").textContent = c ? "Edit connection" : "Connect provider";
  $("provider").replaceChildren();
  for (const [id, p] of Object.entries(view.presets).sort((a, b) =>
    a[1].name.localeCompare(b[1].name),
  )) {
    const o = new Option(
      p.name + (p.supported === false ? " · Adapter required" : ""),
      id,
    );
    o.disabled = p.supported === false;
    $("provider").append(o);
  }
  $("provider").value = c?.providerId ?? "opencode-go";
  presetChanged();
  if (c) {
    $("label").value = c.label;
    $("endpoint").value = c.endpoint;
    models = structuredClone(c.models);
    modelRows();
  }
  $("api-key").value = "";
  $("api-key").placeholder = c?.hasKey
    ? "Leave blank to keep the saved key"
    : "Key is encrypted on this computer";
  $("enabled").checked = c?.enabled ?? true;
  $("editor").scrollIntoView({ behavior: "smooth" });
}
async function save(discover = false) {
  const input = {
    id: editing,
    providerId: $("provider").value,
    label: $("label").value,
    endpoint: $("endpoint").value,
    apiKey: $("api-key").value,
    enabled: $("enabled").checked,
    models,
  };
  view = await call("save", input);
  editing = editing ?? view.connections.at(-1).id;
  $("api-key").value = "";
  if (discover) view = await call("discover", editing);
  models = structuredClone(
    view.connections.find((c) => c.id === editing).models,
  );
  modelRows();
  render();
  status(
    discover
      ? "Connection verified. Select the models you want to use and save."
      : "Saved. Restart Codex++ to update the model menu.",
  );
}
function metric(root, label, value) {
  const item = el("div", undefined, "metric");
  if (!/\d/.test(String(value))) item.classList.add("unknown");
  item.append(el("strong", String(value)), el("small", label));
  root.append(item);
}
async function usage() {
  status("Refreshing usage…");
  const data = await call("usage");
  view = data.providers;
  const root = $("usage-cards");
  root.replaceChildren();
  for (const a of data.native) {
    const card = el("article", undefined, "card");
    card.append(
      el(
        "h3",
        `${a.label ?? a.email ?? "ChatGPT account"} · ${a.planType ?? "ChatGPT"}`,
      ),
    );
    if (a.usageError) card.append(el('p', a.usageError, 'danger'));
    const metrics = el("div", undefined, "metrics");
    for (const [key, label] of [
      ["fiveHour", "5-hour remaining"],
      ["weekly", "Weekly remaining"],
    ]) {
      const w = a.usageWindows?.[key];
      if (w?.usedPercent != null)
        metric(metrics, label, `${100 - w.usedPercent}%`);
    }
    if (!metrics.children.length && Number.isFinite(a.usedPercent))
      metric(metrics, "Usage remaining", `${100-a.usedPercent}%`);
    metric(metrics, "Reset credits", a.resetCredits ?? "Unknown");
    card.append(
      metrics,
      button(a.active ? "Selected account ✓" : "Use this account", async () => {
        await call("native-select", a.id);
        await usage();
      }),
    );
    root.append(card);
  }
  for (const c of view.connections) {
    const card = el("article", undefined, "card");
    card.append(el("h3", c.label + " · " + providerName(c.providerId)));
    const metrics = el("div", undefined, "metrics");
    metric(metrics, "Successful requests", c.usage?.requests ?? "Not measured yet");
    metric(
      metrics,
      "Input tokens",
      c.usage?.metered ? c.usage.inputTokens : "Unknown",
    );
    metric(
      metrics,
      "Output tokens",
      c.usage?.metered ? c.usage.outputTokens : "Unknown",
    );
    for (const q of c.quota?.metrics ?? [])
      metric(metrics, q.label, q.remainingPercent + "%");
    card.append(
      metrics,
      el(
        "p",
        c.quota?.status === "available"
          ? "Remaining quota comes from the provider API; token counters track usage on this computer."
          : "Token counters track usage on this computer. The provider's remaining quota and monetary balance are unknown.",
      ),
    );
    if (c.enabled)
      card.append(
        button(
          view.preferred[c.providerId] === c.id
            ? "Selected connection ✓"
            : "Use this connection",
          async () => {
            view = await call("select", c.providerId, c.id);
            await usage();
          },
        ),
      );
    root.append(card);
  }
  status("Usage refreshed.");
}
$("add").onclick = () => edit();
$("cancel").onclick = () => {
  $("editor").hidden = true;
};
$("provider").onchange = presetChanged;
$("form").onsubmit = (e) => {
  e.preventDefault();
  run(() => save());
};
$("discover").onclick = () => run(() => save(true));
$("add-model").onclick = () => {
  const id = "model-" + (models.length + 1);
  models.push({
    id,
    label: id,
    protocol: view.presets[$("provider").value].protocol,
    efforts: [],
    defaultEffort: null,
    contextWindow: 32768,
    enabled: false,
    images: false,
    tools: true,
  });
  modelRows();
};
$("refresh-registry").onclick = () =>
  run(async () => {
    status("Downloading the provider and model catalog…");
    view = await call("refresh-registry");
    render();
    status(
      "Catalog is up to date. Keys and connection selections are preserved. Use Refresh models to add new models to a connection.",
    );
  });
$("refresh-usage").onclick = () => run(usage);
$("usage-tab").onclick = () =>
  run(async () => {
    $("connections").hidden = true;
    $("editor").hidden = true;
    $("usage").hidden = false;
    $("usage-tab").setAttribute("aria-selected", "true");
    $("connections-tab").setAttribute("aria-selected", "false");
    await usage();
  });
$("connections-tab").onclick = () => {
  $("connections").hidden = false;
  $("usage").hidden = true;
  $("usage-tab").setAttribute("aria-selected", "false");
  $("connections-tab").setAttribute("aria-selected", "true");
};
run(async () => {
  view = await call("view");
  render();
});
