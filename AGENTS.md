# Working rules

## The one rule

**Go from the most general to the most specific, and write down every step.**

When something does not work, do not start changing code. Narrow it down:

1. State what you observe, precisely. "The menu is empty" is not the same as
   "the block runs but nothing reaches the DOM".
2. Find the widest layer that could explain it, and rule that layer in or out
   with a measurement — not with a guess.
3. Only then go one layer deeper.
4. Log each step with the evidence that closed it. The log is the deliverable;
   the fix is a side effect.

Trial-and-error edits look faster and are not. Every time this rule was skipped
in this repo, the result was code that ran, logged, pushed into an array — and
changed nothing on screen.

Measurements beat opinions. A throwaway script that spawns `codex app-server`
against a temporary `CODEX_HOME` answers "does this even work" in a minute and
risks nothing.

## Finding code in the minified bundle

`webview/assets/app-initial-*.js` is 14 MB, one line, names minified. Poking at
it with `grep` is a waste of time. Work from general to specific:

**1. Set up a parser and read with your eyes.** Install `acorn` +
`acorn-walk` + `prettier` somewhere temporary (not under `patch/`). Acorn
parses the 14 MB file in about three seconds.

**2. Start from a constant string.** User-visible text, React `key` values,
i18n ids, error messages — these are not minified. `sign-in-openai`, or
`does not match AppServerManager hostId`. Careful: strings in this bundle are
written as **template literals**, so in the AST they are `TemplateElement`
nodes, not `Literal`.

**3. Extract the enclosing function.** Take the ancestor chain with
`walk.ancestor`, cut the `[start, end]` range of the nearest function node out
of the file, format it with `prettier`, write it to disk. Now you have a
readable thousand-line component. For an anonymous class, wrap the slice in
`const X = ...;` before handing it to prettier.

**4. Read the data flow, don't guess.** This bundle went through the React
Compiler: every value is wrapped in `t[N]` memo slots and half the blocks look
like `if (t[k] !== dep) { ... } else { ... }`. What you are looking for:

- Which array or variable does the value go into?
- Is that variable **actually rendered**? Follow it all the way to the
  `children:[...]` array.
- Is there an **early `return`** in the function? A block running does not mean
  it is rendered.

**5. Extract the dependencies too.** Look up a name (`Mcl`, `GV`, `KV`) in the
AST again and format it the same way. Read the component's prop contract off
its destructuring line.

**6. Count the call sites.** Whether a branch is dead or live only becomes
clear from its callers. `sidebarFooter` appeared in eight places; the single
meaningful call site said which branch was the dead one.

## Writing anchors

An anchor must be based on **meaning, not on a minified name**. In order of
preference:

1. Protocol constant / React key / i18n id / untranslated error string
2. Prop destructuring signature (`{accountIcon:X,accountLabel:Y,...}`)
3. Structural pattern (a `children` array of nine elements in a fixed order)

Minified names must be the **output** of a patch, not its input: capture them
from a pattern and write them back into the injection. `matchOnce` forces every
pattern to exactly one match; 0 or 2 matches means the patch quietly went to
the wrong place. When a pattern legitimately has N matches, assert N
explicitly — never take "the first one".

Things that have bitten us here, all worth checking before you trust a patch:

- The identifier pattern in a regex is `[A-Za-z_$][\w$]*`. `\w` does not match
  `$`, and this bundle has names like `$5`.
- Search in a **window**, not in the whole file. Once you have the anchor
  point, slice into the component body with `source.slice(index, index + N)`
  and resolve sub-patterns there. The same pattern can appear dozens of times
  in 14 MB.
- Do not use `String.replace` with a short fragment to finish a patch. Splice
  by index on the match you already validated, or you will hit an earlier
  occurrence somewhere else in the file.
- Injected helpers are only visible inside the closure they land in. Code that
  a distant chunk has to call belongs on `globalThis`, defined at the top of
  the file, not next to the component.
- When a glob matches more than one file, narrow it with the patch's `select`
  field — a string only the intended file contains. Do not narrow with a
  hashed filename; those change on every release.
- Every patch needs a `marker` that is present after it is applied and absent
  before, so re-running the installer is a no-op.

## Patching the UI

- A synthetic `.click()` does nothing in React. Drive the real thing with CDP
  `Input.dispatchMouseEvent`.
- Radix menu items select on `pointerup`, not on `click`. A nested button
  inside a menu row has to stop `pointerdown`, `pointerup`, `mousedown`,
  `mouseup` and `click`, and it is still worth keeping a short time guard so
  one gesture cannot trigger two actions.
- Do not lean on Tailwind variants that may not exist in the prebuilt CSS
  (named groups, arbitrary values). Hover state via `useState` and an inline
  style always works.
- Two chart color tokens can resolve to the same value. Check the computed
  color before assuming a palette looks varied.

## When the app signs itself out

Two auth surfaces have to agree, and the renderer is only one of them:

- The renderer decides "am I signed in" from `authMode`, which arrives in the
  `account/updated` notification.
- The **main process** fetches `chatgpt.com/backend-api/...` on its own and
  only attaches a token when `authMethod === "chatgpt"`. Without it the account
  lookup reports `authenticatedAccountPresent=false` and the UI falls back to
  the sign-in screen a few seconds later — long enough that it looks unrelated
  to the switch that caused it.

The app's stdout log is where this shows up: `desktop_fetch_auth_401`,
`account_info_token_unavailable`, `auth_status_result`. Read the log before
theorising about React.

## Verification

Applying the patch is not enough on its own:

- `node --check`, or parse with acorn, for syntax
- Start the app with `--remote-debugging-port`, open the menu over CDP, read
  the real text out of the DOM, take a screenshot
- Wait and look again. Some failures land seconds after the action.

Practical notes:

- The debugging port sometimes binds to IPv4 and sometimes to IPv6 — try both
  `127.0.0.1` and `[::1]`.
- `open -a` only passes `--args` when it actually launches a new instance. To
  be sure the flags land, run `Contents/MacOS/Codex++` directly.
- If `~/Library/Application Support/CodexPP/SingletonLock` goes stale the app
  says "Opening in existing browser session." and exits; delete the lock file
  if the pid it points at is not alive.
- Write throwaway scripts to files. Long inline `node -e` snippets get mangled
  by shell quoting.

## Limits

- `/Applications/ChatGPT.app` is read-only. Never modify it.
- Never print token values — key names, hashes and boolean comparisons only.
- Back up `~/.codex/auth.json` and the account store before any test that can
  write to them, and restore them afterwards.
- Do not push to GitHub without explicit approval.
