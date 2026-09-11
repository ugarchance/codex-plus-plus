# Third-party notices

## tiktoken 1.0.22

The Web prompt budget uses `o200k_base` via the pinned `tiktoken` JS/WASM
package, as in the reference implementation. Upstream:
https://github.com/dqbd/tiktoken (package gitHead
`4c8b748e07992c00386f3180af5c574b27b65139`). MIT license, copyright (c) 2022
OpenAI, Shantanu Jain. The full notice is preserved in
`hub/LICENSES/tiktoken-MIT.txt` and shipped with the hub.

## codex-chatgpt-web

The ChatGPT Web v2 transport in this repository adapts protocol, browser-lifecycle,
compaction, model-capability and MCP-broker concepts from
[`miuuyy/codex-chatgpt-web`](https://github.com/miuuyy/codex-chatgpt-web), reviewed at
commit `e85e3693fdb4e3e033348c08df0298c20fcdb612`. The reference launcher was not
copied wholesale. Its license is reproduced below.

MIT License

Copyright (c) 2026 codex-chatgpt-web contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
