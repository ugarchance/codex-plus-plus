// Keeps the OpenAI tunnel alive for the harness. The tunnel client is spawned as a child of the
// hub, so it lives and dies with the app instead of being supervised outside it.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const RESTART_DELAY_MS = 5_000;
const MAX_RESTARTS = 5;

let child = null;
let restarts = 0;
let stopping = false;

function userDir() {
  const { app } = require("electron");
  return path.join(app.getPath("userData"), "tunnel");
}

function binaryPath() {
  return path.join(userDir(), "bin", "tunnel-client");
}

function settings() {
  const file = path.join(userDir(), "config.json");
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return /^tunnel_[a-f0-9]{32}$/.test(parsed?.tunnelId ?? "") ? parsed : null;
  } catch {
    return null;
  }
}

function mcpCommand(socketPath) {
  const resources = process.resourcesPath;
  const node = path.join(resources, "cua_node", "bin", "node");
  const server = path.join(resources, "hub", "mcp-server.cjs");
  return `${node} ${server} --broker-socket '${socketPath}'`;
}

function writeProfile(tunnelId, socketPath) {
  const dir = userDir();
  const profile = path.join(dir, "profiles", "codexpp.json");
  fs.mkdirSync(path.dirname(profile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(profile, `${JSON.stringify({
    config_version: 1,
    admin_ui: { open_browser: false },
    control_plane: {
      api_key: `file:${path.join(dir, "runtime-key")}`,
      base_url: "https://api.openai.com",
      tunnel_id: tunnelId
    },
    health: { listen_addr: "127.0.0.1:0", url_file: path.join(dir, "health.url") },
    log: { file: path.join(dir, "tunnel.log"), format: "json", level: "info" },
    mcp: { commands: [{ channel: "main", command: mcpCommand(socketPath) }] }
  }, null, 1)}\n`, { mode: 0o600 });
  return profile;
}

function launch(profile) {
  child = spawn(binaryPath(), ["run", "--config", profile], { stdio: ["ignore", "pipe", "pipe"] });

  const note = (stream, prefix) => {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (/error|fatal/i.test(line)) console.error(`==> codexpp tunnel ${prefix}: ${line.slice(0, 300)}`);
      }
    });
  };
  note(child.stdout, "out");
  note(child.stderr, "err");

  child.on("exit", (code, signal) => {
    child = null;
    if (stopping) return;
    if (restarts >= MAX_RESTARTS) {
      console.error(`==> codexpp tunnel gave up after ${MAX_RESTARTS} restarts (last exit ${code ?? signal})`);
      return;
    }
    restarts += 1;
    console.error(`==> codexpp tunnel exited (${code ?? signal}); restarting ${restarts}/${MAX_RESTARTS}`);
    setTimeout(() => launch(profile), RESTART_DELAY_MS);
  });
}

async function start(socketPath) {
  if (child) return { running: true };
  const config = settings();
  if (!config) return { running: false, reason: "no tunnel configured" };
  if (!fs.existsSync(binaryPath())) return { running: false, reason: "tunnel-client is not installed" };
  if (!fs.existsSync(path.join(userDir(), "runtime-key"))) return { running: false, reason: "no runtime key" };

  stopping = false;
  restarts = 0;
  launch(writeProfile(config.tunnelId, socketPath));
  return { running: true, tunnelId: config.tunnelId };
}

function stop() {
  stopping = true;
  if (child) child.kill();
  child = null;
}

function status() {
  return { running: Boolean(child), restarts };
}

module.exports = { start, stop, status };
