# Codex++ home isolation

Codex++ sets `CODEX_HOME` to `<user-data-dir>/codex-home` before loading its hub
or starting the upstream app server. On Windows the default is
`%LOCALAPPDATA%\CodexPP\codex-home`; on macOS it is
`~/Library/Application Support/CodexPP/codex-home`.

The original CLI retains its existing home. Switching providers, models, effort,
or accounts in Codex++ changes only the private copy. Claude peers registration
and removal also target the private copy. Reinstallation preserves that home.

## One-time import

The installer imports from the inherited `CODEX_HOME`, falling back to
`~/.codex`. Direct application launches perform the same import if necessary.
The first import can take time and disk space proportional to existing history
and installed skills/plugins. It copies authentication, configuration, model
cache, project/UI preferences, history indexes, transcripts, skills, rules,
memories, plugins, automations, attachments, and MCP installation files.

Thread state and thread history databases use consistent SQLite snapshots,
including committed WAL data. Imported transcript paths in the thread database
point to the private copies. Logs, active job queues, locks, sandbox credentials,
temporary files, and symbolic links are not imported. Existing absolute paths
in user-authored configuration remain as configured.

An import completes in a staging directory before becoming the live home. A
failed import stops startup instead of falling back to the CLI home. Partial
staging directories are retained for diagnosis. A completed import is recorded
by `.codexpp-home.json`; subsequent starts do not recopy or overwrite settings.
An existing, nonempty home without this marker requires manual reconciliation.

The original home is read only during import. The two histories do not
synchronize afterward. Both applications can still operate on the same project
files when the user opens the same project in both.

SQLite migration requires a Node.js build with `node:sqlite` (the Windows
validation used Node.js 22.22.3). An installed, initialized home does not require
the Electron runtime to expose SQLite.

Windows performs its own sandbox setup for the new home. Complete the setup
banner in Codex++ if it appears; the original sandbox credentials and setup
marker are not reused. This does not change the original CLI's model or login.
