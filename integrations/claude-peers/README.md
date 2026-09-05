# claude-peers

A dependency-free Node.js MCP stdio server that exposes local Claude Code
sessions as Codex tools. It communicates directly with Claude's peer sockets.

## Tools

| Tool | Behavior |
|---|---|
| `list_claude_sessions` | Lists live sessions, names, process IDs, working directories and socket availability. |
| `send_message_to_claude` | Sends a user prompt to a selected session. |
| `read_claude_messages` | Reads replies, optionally waiting or filtering by sender name. Unmatched messages remain in order. |
| `claude_peer_address` | Returns this server's peer name and address. |

Codex exposes these tools with the `mcp__claude_peers__` prefix.

## Installation

The Codex++ installers register the server automatically. Skip registration with
`SKIP_CLAUDE_PEERS=1` on macOS or `-SkipClaudePeers` on Windows. For manual setup:

```sh
node integrations/claude-peers/install.mjs --codex-home /path/to/.codex
```

The installer requires an existing `config.toml`, backs it up before each change,
copies the server to `$CODEX_HOME/mcp/claude-peers`, and manages the
`[mcp_servers.claude_peers]` table. Repeated installation leaves an identical
registration unchanged. Other tables and nested environment overrides survive
updates. Add `--remove` to remove the registration, its subtables and copied files.
Restart Codex to load the tools. Node.js must be available on PATH.

## Peer transport

The server registers itself under `~/.claude/sessions` with a JSON record and a
private key file. Supported Claude versions can discover it through `ListAgents`
and reply with `SendMessage`. Records are removed on normal shutdown. The socket
is `/tmp/cc-socks/<pid>.sock` on POSIX (or under `XDG_RUNTIME_DIR`) and
`\\.\pipe\cc-socks-<pid>` on Windows.

The two directions have different authentication behavior:

- Codex to Claude: an auth frame containing the destination's peer token precedes
  the user frame. The user frame carries `msgV`, `msg_id`, `priority: "next"` and
  a `cross-session-message` envelope with a reply address.
- Claude to Codex: the original live peer measurements observed no auth frame.
  Authentication is optional by default; `CLAUDE_PEERS_REQUIRE_AUTH=1` requires
  a matching auth frame and may prevent those Claude clients from replying.
- The receiver writes no acknowledgement. Empty connections are liveness probes
  and do not enter the inbox. Incoming UTF-8 can span multiple socket chunks.

Set `CLAUDE_PEERS_NAME` to change the default name `codex`, or
`CLAUDE_SESSIONS_DIR` to use another registry. The advertised peer version follows
the highest version recorded for Claude, with a `2.1.0` floor.

## Validation and limits

Run `node --test tools/test-claude-peers.mjs`. Tests use temporary configuration,
a private registry and mock peer sockets. On Windows they exercise real named
pipes and the installer's extracted registration function; they never contact
running Claude sessions or read real account credentials.

The original PR reported live Claude transport measurements. The merge review
verified Windows transport with mocks, not a live Windows Claude round trip.
Claude's peer protocol is internal and can change between releases. Remote/cloud
sessions are not supported. `delivered` means the socket write completed; it is
not confirmation that Claude accepted or acted on the prompt. Peer messages do
not grant user authorization for actions.
