// Adapted from codex-chatgpt-web src/model-catalog.ts (MIT, e85e3693).
// Attribution and full license: ../THIRD_PARTY_NOTICES.md.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const contract = require('./web-contract.cjs');
let snapshot = { catalogPath: null, catalogError: 'Web engine catalog has not been prepared' };
function augmentCatalog(catalog) {
  if (!Array.isArray(catalog?.models)) throw new Error('Native engine catalog is missing its models array');
  const native = catalog.models.filter(row => !row?.slug?.startsWith(contract.WEB_MODEL_PREFIX));
  const template = native.find(row => row?.visibility === 'list' && Array.isArray(row.supported_reasoning_levels)
    && ['freeform', 'function'].includes(row.apply_patch_tool_type));
  if (!template) throw new Error('Native engine catalog has no verified tool-capable template');
  const labels = contract.catalogRows();
  const plaintextAgents = native.some(row => row.multi_agent_version === 'v2');
  const web = contract.supportedModels().map(slug => {
    const spec = contract.requireWebModel(slug);
    // The family row includes Instant. Use its lower advertised window; the per-turn browser
    // preflight separately enforces the actual account/effort limit. Never reuse native windows.
    const context = spec.fixedEffortIndex === null || spec.effortIndex === 0 ? 41000 : 90000;
    const row = { ...structuredClone(template), slug,
      display_name: labels.find(x => x.slug === slug)?.label ?? slug,
      description: `ChatGPT Web ${spec.mode}; ${!spec.harness ? 'no native tools or subagents' : plaintextAgents ? 'native V2 plaintext subagents, two task-owned browser slots' : 'native tools; subagents unavailable in this engine catalog'}`,
      visibility: spec.legacy ? 'hide' : 'list', supported_in_api: true,
      tool_mode: null, multi_agent_version: spec.harness && plaintextAgents ? 'v2' : 'disabled',
      input_modalities: ['text', 'image'], context_window: context, max_context_window: context,
      effective_context_window_percent: 80, auto_compact_token_limit: context === 41000 ? 32000 : 80000,
      default_reasoning_level: 'high', supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'ultra'].map(effort => ({ effort, description: `ChatGPT Web ${effort} (browser verified before send)` })),
      additional_speed_tiers: [], service_tiers: [], default_service_tier: null, upgrade: null,
    };
    delete row.comp_hash; delete row.availability_nux;
    return row;
  });
  return { ...structuredClone(catalog), models: [...structuredClone(native), ...web] };
}
function prepare(privateHome) {
  try {
    if (!privateHome || !path.isAbsolute(privateHome)) throw new Error('Web catalog requires the active private Codex home');
    const source = fs.readFileSync(path.join(privateHome, 'models_cache.json'));
    if (source.length > 16 * 1024 * 1024) throw new Error('Native model cache exceeds the bounded catalog size');
    const content = JSON.stringify(augmentCatalog(JSON.parse(source)));
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    const directory = path.join(privateHome, 'codexpp-web');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const catalogPath = path.join(directory, `catalog-${hash}.json`);
    if (!fs.existsSync(catalogPath)) fs.writeFileSync(catalogPath, content, { mode: 0o600, flag: 'wx' });
    snapshot = { catalogPath, catalogError: null };
  } catch (error) { snapshot = { catalogPath: null, catalogError: error.message }; }
  return snapshot;
}
function engineArgs(args, host, prepareCatalog = () => prepare(process.env.CODEX_HOME), gatewayRoute = () => require('./gateway.cjs').route()) {
  if (host?.id !== 'local') return args;
  // Respect an explicit user launch override. It must not be silently replaced.
  if (args.some(value => /^(model_catalog_json|openai_base_url)\s*=/.test(value))) return args;
  const result = prepareCatalog();
  if (!result.catalogPath) return args; // native startup stays available; Web preflight explains the blocker
  const route = gatewayRoute();
  if (!/^http:\/\/127\.0\.0\.1:\d+\/backend-api\/codex$/.test(route ?? '')) {
    snapshot = { catalogPath: null, catalogError: 'Web catalog transport was not ready at engine startup; restart Codex++ after the hub is ready' };
    return args;
  }
  // Authenticated model refresh happens outside a thread. Route this app process
  // through the same native-preserving gateway; never write the shared config.
  // In engine 0.153.4 an app-server-local -c (the desktop adds its MCP config)
  // replaces root-level -c values. Keep these overrides in the subcommand too.
  return [...args, '-c', `model_catalog_json=${JSON.stringify(result.catalogPath)}`, '-c', `openai_base_url=${JSON.stringify(route)}`];
}
module.exports = { augmentCatalog, prepare, engineArgs, status: () => snapshot };
