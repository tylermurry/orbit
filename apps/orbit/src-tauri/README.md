# Orbit Tauri shell (`src-tauri`)

Rust backend for the Orbit desktop app. The UI talks to it only through `OrbitHost` (`src/host/types.ts`),
implemented for Tauri in `src/host/tauriHost.ts`. Dialogs use `@tauri-apps/plugin-dialog`; everything else is a command below.

## Commands (JS args are camelCase, Rust args snake_case; results camelCase)

| Command | Args | Returns |
| --- | --- | --- |
| `read_file` | `path` | `FileSnapshot` (BOM stripped; sha256 of raw bytes) |
| `stat_file` | `path` | `FileStat` |
| `write_file_atomic` | `path, text, expected` | `WriteResult` (never rejects; failures are `{ok:false,reason:'error'}`) |
| `initial_file` | - | first non-flag CLI arg ending `.json`, else `ORBIT_FILE`; absolute path or `null` |
| `git_context` | `path` | `GitContext` |
| `git_list_refs` | `repoRoot` | `GitRef[]` (HEAD, local branches, tags peeled to commits) |
| `git_read_file_at` | `repoRoot, rev, relPath` | `GitFileAtRevision`; rejects with an actionable message for unresolvable revs |

| `mcp_status` | - | `McpStatus` `{enabled, running, url?, port?, token, error?}` |
| `mcp_set_enabled` | `enabled` | `McpStatus` (starts/stops the server, persists the flag) |
| `mcp_regenerate_token` | - | `McpStatus` (rejects when `ORBIT_MCP_TOKEN` fixes the token) |
| `mcp_respond` | `requestId, response` | nothing; completes a pending `mcp:request` (`{result}` or `{error:{code,message,data?}}`) |

## MCP server (`src/mcp.rs`)

Orbit embeds an MCP server (Streamable HTTP, spec 2025-06-18; also negotiates 2025-11-25, 2025-03-26, 2024-11-05) so AI agents can
act on the document open in the running app. Contract with the UI: `src/mcp/bridge.ts`.

- **Endpoint**: `POST http://127.0.0.1:<port>/mcp`, one JSON-RPC message per request. Requests get `200 application/json`; notifications and
  client responses get `202`; batch arrays get `-32600` and bad JSON `-32700` (HTTP 400). `GET`/`DELETE` are `405` (no SSE stream, stateless), other paths `404`,
  bodies over 4 MB `413`. `Mcp-Session-Id` is issued on `initialize` but never required. An unsupported `MCP-Protocol-Version` header is `400`.
- **Handled in Rust**: `initialize` (echoes a supported `protocolVersion`, else `2025-06-18`), `ping`, `notifications/*`. Only `tools/list` and `tools/call` are
  forwarded to the UI; other methods are `-32601`.
- **Auth**: `Authorization: Bearer <token>` (constant-time compare), else `401` with `WWW-Authenticate: Bearer`. The token is `ORBIT_MCP_TOKEN` if set, otherwise a
  random 32-byte hex token persisted in `<app config dir>/mcp.json` (mode 0600) together with the `enabled` flag, created on first run.
- **Origin rule**: a request carrying `Origin` is rejected with `403` unless it is `http://localhost[:port]`, `http://127.0.0.1[:port]`, `tauri://localhost`,
  `http://tauri.localhost` (or `https://tauri.localhost`). `null` is rejected. Requests without `Origin` (CLI agents) are fine. CORS headers are only ever echoed for allowed origins.
- **Binding and ports**: `127.0.0.1` only. Port is `ORBIT_MCP_PORT` or `47821`; if busy the next 9 ports are tried. The chosen port is in `mcp_status`; if all are busy `status.error` says so.
- **Enable/disable**: enabled by default; `mcp_set_enabled` persists the flag and starts/stops the listener thread. `ORBIT_MCP_DISABLED=1` forces it off.
- **Event bridge**: for `tools/list` / `tools/call` Rust emits the Tauri event `mcp:request` (`{requestId, method, params}`) to the `main` window and waits up to 60 s for the UI to call
  `mcp_respond(requestId, response)`. On timeout the client gets JSON-RPC `-32001 "Orbit UI did not respond (is a window open?)"`. `mcp:status` (an `McpStatus`) is emitted on every status change.
- **Logging**: one stderr line per request (`[orbit-mcp] POST tools/call <tool name>`); tokens and arguments are never logged.
- **Tests**: `handle_request` takes a `Forwarder` trait object so the protocol is unit-tested without Tauri; one test does a real TCP round trip.

## Atomic write and conflict semantics

`expected` is encoded as a tagged object (tauriHost maps the `OrbitHost` tri-state onto it):

| TS value | Wire | Behaviour |
| --- | --- | --- |
| `undefined` | `{kind:'any'}` | write unconditionally |
| `null` | `{kind:'absent'}` | write only if the file does not exist (published with `link(2)` so a racing creator is never clobbered) |
| `string` | `{kind:'sha256',value}` | write only if on-disk sha256 equals value |

On mismatch (including the file having appeared or disappeared) nothing is written and `{ok:false,reason:'conflict',current}` is returned.
Otherwise the text is written to a temp file in the same directory (`.<name>.orbit-tmp-*`), fsynced, given the existing file's permissions,
and renamed over the target (replace semantics on Windows); the directory is fsynced on Unix. Symlinks are written through.
Temp files are removed on every failure path. No other file is ever touched.

## Read-only Git guarantee

Git is invoked as `git -c core.fsmonitor=false --no-pager --literal-pathspecs -C <dir> ...` with `GIT_OPTIONAL_LOCKS=0` and
`GIT_TERMINAL_PROMPT=0`. Only `rev-parse`, `symbolic-ref` (read form, unborn branch only), `for-each-ref`, `log --no-walk`, `ls-tree`, `show`
and `merge-base` are used - never `status`, `add`, `checkout`, `fetch`. The single write is `git_tag_proposal`: `git tag [-f] orbit/proposal/<branch> <HEAD>`,
called only by the MCP tool `mark_proposal`; `tests/git.rs` checks it adds that ref and changes nothing else. `workingTreeDiffers` compares file bytes with `git show HEAD:<path>`; the index is never consulted.
`tests/git.rs` (AC-13) snapshots every file under `.git` and the worktree (bytes and mtimes) before/after exercising every function
on dirty, detached, packed-refs and unborn repos, and a control test proves the harness detects `git status` rewriting the index.

Unavailable reasons: `git-missing`, `not-a-repo`, `error`. Handled: unborn HEAD, detached HEAD, untracked file, shallow clone, unresolvable rev.

## Development

```
npm run dev -w @orbit/app      # tauri dev (Vite on :1420)
npm run build -w @orbit/app    # tauri build
cargo test --manifest-path src-tauri/Cargo.toml
```
