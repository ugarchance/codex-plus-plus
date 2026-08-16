# Contributing to Codex++

Thank you for contributing to Codex++. Before proposing changes, please review our development rules and patching methodology.

## Development Methodology

All binary patching and reverse engineering in this repository strictly follows the guidelines in [AGENTS.md](AGENTS.md).

Key principles:

1. **Meaning-Based Anchors**:
   - Anchors must target semantic, unminified constructs: protocol constants, React keys, i18n identifiers, prop destructuring signatures, or fixed structural sequences.
   - Never anchor against minified variable or function names (e.g. `Mcl`, `$5`), which change on every release.

2. **Single Match Enforcement (`matchOnce`)**:
   - Every patch anchor must resolve to exactly one location in the target file.
   - If an anchor matches zero times or more than once, the patch fails immediately rather than silently injecting into the wrong location.

3. **Marker Idempotence**:
   - Every patch must define a unique `marker` string that is present after application and absent before.
   - Re-running the patch installer must be safe and idempotent (a no-op if already applied).

4. **Bounded Search Windows**:
   - Once an anchor is located, search sub-patterns within a narrow slice (`source.slice(index, index + N)`) rather than searching across the entire bundle.

## Pull Request Checklist

Before submitting a pull request, ensure all of the following checks pass:

- [ ] **Syntax Validation**: Run `node --check` across all `.mjs` and `.cjs` files (e.g., in `patch/`, `hub/`, and `tools/`).
- [ ] **Patch Dry Run**: Verify patch CLI arguments and help flags (`node patch/apply.mjs --help`).
- [ ] **Smoke Test**: Follow the step-by-step verification procedure in [docs/SMOKE-TEST.md](docs/SMOKE-TEST.md) using `--remote-debugging-port` and Chrome DevTools Protocol (CDP) to confirm the DOM renders correctly and no auth regressions occur.
- [ ] **Clean Changes**: Verify no sensitive credentials, auth tokens, or temporary files (`*.log`, `.DS_Store`) are included in the diff.
