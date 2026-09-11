// Owns the Codex++ Native v2 tunnel lifecycle. Readiness requires a local MCP schema/nonce probe
// plus the tunnel health endpoint; process existence alone is never reported as ready.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const RESTART_DELAY_MS = 5_000;
const MAX_RESTARTS = 5;
const READY_TIMEOUT_MS = 20_000;

function quotePosix(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function quoteWindows(value) {
  const text = String(value);
  if (/[\r\n]/u.test(text)) throw new Error("Tunnel command arguments cannot contain newlines");
  // tunnel-client uses a shell-word parser on Windows too, not CommandLineToArgvW.
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function commandLine(args, platform = process.platform) {
  const quote = platform === "win32" ? quoteWindows : quotePosix;
  return args.map(quote).join(" ");
}

function createTunnelManager(dependencies = {}) {
  const spawnChild = dependencies.spawn ?? spawn;
  const fetchUrl = dependencies.fetch ?? fetch;
  const delay = dependencies.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const schedule = dependencies.setTimeout ?? setTimeout;
  const unschedule = dependencies.clearTimeout ?? clearTimeout;
  const platform = dependencies.platform ?? process.platform;
  const resourcesPath = dependencies.resourcesPath ?? (() => process.resourcesPath);
  const dataDir = dependencies.userDir ?? (() => {
    const { app } = require("electron");
    return path.join(app.getPath("userData"), "tunnel");
  });

  let child = null;
  let restartTimer = null;
  let restarts = 0;
  let stopping = false;
  let instanceId = null;
  let brokerInstanceId = null;
  let stopPromise = null;
  let phase = "stopped";
  let lastError = null;

  function binaryPath() {
    return path.join(dataDir(), "bin", platform === "win32" ? "tunnel-client.exe" : "tunnel-client");
  }

  function nodePath() {
    return path.join(resourcesPath(), "cua_node", "bin", platform === "win32" ? "node.exe" : "node");
  }

  function mcpServerPath() {
    return path.join(resourcesPath(), "hub", "mcp-server.cjs");
  }

  function settings() {
    const file = path.join(dataDir(), "config.json");
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return /^tunnel_[a-f0-9]{32}$/.test(parsed?.tunnelId ?? "") ? parsed : null;
    } catch {
      return null;
    }
  }

  function mcpArgs(socketPath) {
    return [nodePath(), mcpServerPath(), "--broker-socket", socketPath, "--instance-id", instanceId];
  }

  function mcpCommand(socketPath) {
    return commandLine(mcpArgs(socketPath), platform);
  }

  function writeProfile(tunnelId, socketPath) {
    const dir = dataDir();
    const profile = path.join(dir, "profiles", "codexpp-native-v2.json");
    fs.mkdirSync(path.dirname(profile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(profile, `${JSON.stringify({
      config_version: 1,
      admin_ui: { open_browser: false },
      control_plane: {
        api_key: `file:${path.join(dir, "runtime-key")}`,
        base_url: "https://api.openai.com",
        tunnel_id: tunnelId,
      },
      health: { listen_addr: "127.0.0.1:0", url_file: path.join(dir, "health.url") },
      log: { file: path.join(dir, "tunnel.log"), format: "json", level: "info" },
      // The tunnel routing channel is fixed by the client; MCP serverInfo retains the v2 identity.
      mcp: { commands: [{ channel: "main", command: mcpCommand(socketPath) }] },
    }, null, 2)}\n`, { mode: 0o600 });
    return profile;
  }

  function probeMcp(socketPath, timeoutMs = 5_000, expectedBrokerInstanceId = brokerInstanceId) {
    return new Promise((resolve, reject) => {
      const probe = spawnChild(nodePath(), [mcpServerPath(), "--broker-socket", socketPath, "--instance-id", instanceId], {
        stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      });
      let buffer = "";
      const replies = new Map();
      let settled = false;
      const nonce = crypto.randomBytes(16).toString("hex");
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        probe.kill();
        if (error) reject(error);
        else resolve(true);
      };
      const timer = setTimeout(() => finish(new Error("MCP readiness probe timed out")), timeoutMs);
      timer.unref?.();
      probe.once("error", (error) => finish(new Error(`MCP readiness spawn failed: ${error.message}`)));
      probe.once("exit", (code) => { if (!settled) finish(new Error(`MCP readiness process exited early (${code})`)); });
      probe.stdout.setEncoding("utf8");
      probe.stdout.on("data", (chunk) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 1048576) { finish(new Error("MCP readiness frame exceeded its limit")); return; }
        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let message;
          try { message = JSON.parse(line); } catch { finish(new Error("MCP readiness returned malformed JSON")); return; }
          replies.set(message.id, message);
          if (replies.size < 3) continue;
          const init = replies.get(1)?.result;
          const tools = replies.get(2)?.result?.tools;
          const ping = replies.get(3)?.result;
          const expectedTools = require('./native-tools.cjs').TOOLS;
          const schemasMatch = Array.isArray(tools) && tools.length === expectedTools.length && expectedTools.every(expected => {
            const actual = tools.find(tool => tool.name === expected.name);
            return actual && JSON.stringify(actual.inputSchema) === JSON.stringify(expected.inputSchema);
          });
          if (init?.serverInfo?.name !== "codexpp-native-v2"
            || !schemasMatch
            || ping?.schemaVersion !== 2
            || ping?.instanceId !== instanceId
            || ping?.nonce !== nonce
            || ping?.broker?.schemaVersion !== 2
            || ping?.broker?.nonce !== nonce
            || typeof ping?.broker?.instanceId !== "string"
            || (expectedBrokerInstanceId !== null && ping?.broker?.instanceId !== expectedBrokerInstanceId)) {
            finish(new Error("MCP readiness schema, instance or nonce did not match"));
            return;
          }
          finish(null);
        }
      });
      probe.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`);
      probe.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
      probe.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping", params: { nonce } })}\n`);
    });
  }

  async function waitForHealth(expectedChild) {
    const file = path.join(dataDir(), "health.url");
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (stopping || child !== expectedChild) throw new Error("tunnel exited before readiness");
      if (fs.existsSync(file)) {
        const url = fs.readFileSync(file, "utf8").trim();
        if (/^http:\/\/127\.0\.0\.1:\d+\/?$/u.test(url)) {
          try {
            const response = await fetchUrl(new URL("/readyz", url).href, { signal: AbortSignal.timeout(2_000) });
            if (response.ok) return url;
          } catch {}
        }
      }
      await delay(200);
    }
    throw new Error("tunnel health endpoint did not become ready");
  }

  function noteStream(stream, prefix) {
    let buffer = "";
    stream?.setEncoding?.("utf8");
    stream?.on?.("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 1048576) buffer = ''; // never retain unbounded child log lines
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (/error|fatal/i.test(line)) console.error(`==> codexpp tunnel ${prefix}: runtime reported an error (payload withheld)`);
      }
    });
  }

  function scheduleRestart(profile, socketPath) {
    if (stopping || restartTimer || restarts >= MAX_RESTARTS) {
      if (!stopping && restarts >= MAX_RESTARTS) phase = "failed";
      return;
    }
    restarts += 1;
    phase = "restart-wait";
    restartTimer = schedule(() => {
      restartTimer = null;
      if (!stopping) launch(profile, socketPath).catch(() => {});
    }, RESTART_DELAY_MS);
    restartTimer.unref?.();
  }

  async function launch(profile, socketPath) {
    if (stopping) throw new Error("tunnel stopped before scheduled launch");
    phase = "starting";
    lastError = null;
    const healthFile = path.join(dataDir(), "health.url");
    fs.rmSync(healthFile, { force: true });
    const launched = spawnChild(binaryPath(), ["run", "--config", profile], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child = launched;
    noteStream(launched.stdout, "out");
    noteStream(launched.stderr, "err");
    let terminalSeen = false;
    const terminal = (kind, detail) => {
      if (terminalSeen) return;
      terminalSeen = true;
      if (child === launched) child = null;
      if (stopping) return;
      lastError = `${kind}: ${detail}`;
      console.error(`==> codexpp tunnel ${lastError}`);
      scheduleRestart(profile, socketPath);
    };
    launched.once("error", (error) => { lastError = `spawn error: ${error.message}`; });
    launched.once("exit", (code, signal) => { lastError = `exit: ${code ?? signal ?? 'unknown'}`; });
    launched.once("close", (code) => terminal("close", code ?? "unknown"));
    try {
      await waitForHealth(launched);
      if (child !== launched || stopping) throw new Error("tunnel ownership changed during readiness");
      phase = "ready";
      return true;
    } catch (error) {
      lastError = error.message;
      if (child === launched) launched.kill();
      throw error;
    }
  }

  async function start(socketPath, { expectedBrokerInstanceId = null } = {}) {
    if (stopPromise) await stopPromise;
    if (child && phase === 'drain-blocked') return { running: true, ready: false, reason: 'Previous tunnel process has not closed; restart refused' };
    if (phase === "ready" && child) return { running: true, ready: true, instanceId };
    const config = settings();
    if (!config) return { running: false, ready: false, reason: "no tunnel configured" };
    if (!fs.existsSync(binaryPath())) return { running: false, ready: false, reason: "tunnel-client is not installed" };
    if (!fs.existsSync(nodePath())) return { running: false, ready: false, reason: "bundled node runtime is not installed" };
    if (!fs.existsSync(mcpServerPath())) return { running: false, ready: false, reason: "Codex++ Native v2 MCP server is not installed" };
    if (!fs.existsSync(path.join(dataDir(), "runtime-key"))) return { running: false, ready: false, reason: "no runtime key" };
    stopping = false;
    restarts = 0;
    instanceId = crypto.randomBytes(16).toString("hex");
    brokerInstanceId = expectedBrokerInstanceId;
    try {
      await probeMcp(socketPath);
      const profile = writeProfile(config.tunnelId, socketPath);
      await launch(profile, socketPath);
      return { running: true, ready: true, tunnelId: config.tunnelId, instanceId };
    } catch (error) {
      phase = "failed";
      lastError = error.message;
      return { running: Boolean(child), ready: false, reason: error.message, instanceId };
    }
  }

  function stop() {
    stopping = true;
    phase = "stopped";
    if (restartTimer) unschedule(restartTimer);
    restartTimer = null;
    const closing = child;
    if (!closing) return Promise.resolve();
    stopPromise = new Promise(resolve => {
      const timer = setTimeout(() => { phase = 'drain-blocked'; lastError = 'Tunnel process did not close after stop'; resolve({ drained: false }); }, dependencies.drainTimeoutMs ?? 3000);
      closing.once("close", () => { clearTimeout(timer); if (child === closing) child = null; phase = 'stopped'; resolve({ drained: true }); });
      closing.kill();
    }).finally(() => { stopPromise = null; });
    return stopPromise;
  }

  function status() {
    return { running: Boolean(child), ready: phase === "ready" && Boolean(child), phase, restarts, lastError, instanceId };
  }

  return { start, stop, status, mcpCommand, writeProfile, probeMcp };
}

const manager = createTunnelManager();

module.exports = {
  start: manager.start,
  stop: manager.stop,
  status: manager.status,
  mcpCommand: manager.mcpCommand,
  createTunnelManager,
  quotePosix,
  quoteWindows,
  commandLine,
};
