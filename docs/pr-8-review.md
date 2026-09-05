# PR #8 merge review — 2026-09-05

1. **Repository state:** inspected PR head `45b6b26` against main `8ea92b0`.
   The feature adds an MCP server and installer hooks; it does not alter bundle
   patches. Merged current main and retained both changelog additions.
2. **Transport boundary:** spawned the real Node MCP process with a temporary
   session registry and a mock peer. All four tools were listed, the destination
   received auth/user frames, and empty probes did not create inbox entries.
   No real Claude session was contacted.
3. **Inbox semantics:** sent alpha/beta/alpha, read beta, then read alpha. The
   original server returned no alpha messages because filtering discarded their
   envelopes. Preserving the original queued records restores names and order.
4. **Stream boundary:** split the UTF-8 bytes of `café` across writes. The original
   returned replacement characters. Socket UTF-8 decoding now preserves bytes
   across chunks. Listener startup also waits for the listening event before
   publishing its address and registry entry.
5. **Configuration boundary:** isolated install/remove tests reproduced a marker
   inside a comment being treated as a real table, orphaned environment subtables,
   and same-second backups overwriting each other. Table scanning now excludes
   strings/comments, recognizes quoted keys and indented/array tables, preserves
   unrelated configuration, and creates unique exclusive backups. Updates retain
   environment overrides; removal includes owned subtables.
6. **Windows installer boundary:** parse both PowerShell scripts and invoke only
   the extracted registration function against a temporary CODEX_HOME. Verify
   the skip switch and installed server. This does not run the desktop installer.
7. **Documentation and CI:** translate integration documentation to English,
   distinguish authentication direction, and add cross-platform integration tests
   plus integration syntax checks to CI.

Before fixes, five of six regression cases failed; the mock transport case passed.
Final validation includes those regressions plus quoted keys, array tables,
environment preservation and Windows installer behavior. Live Windows Claude
interoperability remains unverified; mock named-pipe tests are not that claim.
