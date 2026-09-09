# MCP for DevTool's API Client, Mock Server, Redis Client, and Kafka Explorer

Lets an MCP client (Claude Code, Claude Desktop, …) inspect and drive four
DevTool tools from one server:

- **API Client** — list/read/edit collections, requests, scripts, and
  environments, and actually **send a request** through the same engine the
  Send button uses, with the result landing in the UI and History like any
  other send.
- **Mock Server** — list/read/edit stubs and the fallback response, **start/
  stop** the server, test a response script before saving it, and read the
  request log — all through the same state the UI edits.
- **Redis Client** and **Kafka Explorer** — **connection management only**:
  list/add/update/delete/test saved connection profiles, plus connect/
  disconnect. No key/pub-sub/admin tools for Redis, no topic/consumer-group/
  produce/consume tools for Kafka — deliberately scoped to connection setup,
  not data access.

67 tools total; see the full list further down. Three of those
(`devtool_mcp_status`, `devtool_mcp_set_background`,
`devtool_mcp_set_tool_enabled`) manage the MCP integration itself — see
"DevTool MCP management" below.

## How it works

A small MCP-over-stdio server — `devtool-mcp-server`
(`src-tauri/src/bin/devtool-mcp-server.rs`) — runs as its own process; your
MCP client spawns it directly, and it never runs inside the DevTool app
itself. Every tool call (other than `get_scripting_reference`, answered
locally — see below) is forwarded over HTTP to a loopback-only control
server the DevTool desktop app starts on launch (`src-tauri/src/
mcp_bridge.rs`), which hands it to the running webview — so a call only
succeeds while the DevTool desktop app is **open**, and one of these two is
true:

- **Default** — **the tool that owns the call** is the one currently on
  screen: an API Client tool (`list_collections`, `run_request`, etc.)
  needs the API Client tool open; `mock_*` needs Mock Server open; `redis_*`
  needs Redis Client open; `kafka_*` needs Kafka Explorer open (that's where
  each tool's live state is mounted).
- **Settings → MCP → Background MCP bridge** (off by default) — turn this
  on and all four tools answer regardless of which one is on screen, or even
  while you're on a completely different tool. Off by default per this
  app's "no silent network calls" rule — it's an explicit opt-in, not
  something that starts listening on its own.

There's a third, stricter layer on top of both: **Settings → MCP → Per-tool
MCP access** — a kill switch per tool (all on by default). A tool switched
off there never answers any of its MCP calls, on screen or in the
background; it's the only way to make one tool permanently unreachable over
MCP while leaving the others working normally.

Anything else — app closed, a tool switched off, or neither on-screen/
background condition above holds — comes back as a clear error telling you
so, not a hang. The four bridges
(`src/components/tools/apiclient/mcpBridge.ts`,
`src/components/tools/mockserver/mcpBridge.ts`,
`src/components/tools/redis/mcpBridge.ts`, and
`src/components/tools/kafka/mcpBridge.ts`) listen on the same underlying
event but never collide: each ignores tool names it doesn't own, and by
default only one tool's own bridge is ever mounted at a time anyway (React
Router mounts one tool's component tree at a time) — the background bridge
(`src/components/McpBackgroundBridge.tsx`) is the one case where all four
are deliberately mounted together, sharing the exact same
store/state each tool's own UI reads (see `apiclient/mcpRuntimeContext.tsx`,
`mockserver/mcpRuntimeContext.tsx`, `redis/mcpRuntimeContext.tsx`,
`kafka/mcpRuntimeContext.tsx`) so a UI edit and an MCP edit can't silently
clobber each other.

A fifth listener, `src/components/McpManageBridge.tsx`, is **always**
mounted regardless of the Background MCP bridge setting or the per-tool
toggles — see "DevTool MCP management" below. It only answers three tool
names of its own (`devtool_mcp_status`, `devtool_mcp_set_background`,
`devtool_mcp_set_tool_enabled`) and, like the other four, ignores
everything else.

The two processes find each other automatically: on launch, DevTool writes
its bridge's port and a random auth token to `<app data dir>/mcp-bridge.json`
(same directory Tauri already uses for this app's other persisted files);
`devtool-mcp-server` re-reads that file on every call, so restarting DevTool
(new port/token) doesn't require restarting the MCP server too.

**Excluded on purpose:** the Vault (API Client's local secret store) isn't
exposed here — the UI itself keeps Vault values out of generated code, cURL
export, and history, and an MCP client reading/writing it would defeat that
boundary. Redis/Kafka connection passwords are a different case: they're
part of the saved connection profile itself (same as API Client's Basic
Auth password), stored in plain JSON in the app data dir and already
returned unmasked by the app's own `redis_list_configs`/`kafka_list_configs`
commands — so `redis_list_connections`/`kafka_list_connections` return them
unmasked too, for the same reason `get_request` doesn't mask `auth.password`.

## Setup — installed the app from a binary?

You don't need to build anything — `devtool-mcp-server` ships inside the
app (a Tauri sidecar, `bundle.externalBin`).

1. Open the **MCP for Claude Code…** dialog — either **API Client** →
   Collections' **More** menu (⋮), or **Mock Server** → toolbar **MCP**
   button. Same dialog either way.
2. Copy the `claude mcp add` command it shows (it's already pointed at your
   install's copy of the binary) and run it once in a terminal.
3. Open a new Claude Code (or Claude Desktop) session and use it.

One registration covers all four tools — it's the same `devtool-mcp-server`
process either way, so there's nothing separate to set up for Mock Server's
`mock_*`, Redis Client's `redis_*`, or Kafka Explorer's `kafka_*` tools.

The same dialog also has the **Background MCP bridge** toggle and the
**Per-tool MCP access** list — the exact settings Settings → MCP has, just
reachable without leaving the tool. Flip either from either place; each is
one shared value, so both stay in sync immediately and neither depends on
whether API Client or Mock Server has ever been opened before.

By default an MCP client only gets an answer while the tool it's asking
about is the one on screen (see "How it works" above), and every tool
starts out enabled — off by default/on by default respectively, so nothing
changes here unless you opt in (or explicitly turn a tool off).

## Setup — developing DevTool from source

The repo root ships a checked-in `.mcp.json` that runs the same binary via
`cargo run --release --bin devtool-mcp-server`, so Claude Code picks it up
with zero manual setup: open Claude Code anywhere inside this repo, approve
the project's MCP server prompt once, and it's available in every future
session opened here (requires the same Rust toolchain building the app
already needs — nothing extra to install). The first call compiles the
binary (a few seconds); every call after that is instant.

To register it manually instead (e.g. globally, with `--scope user`):

```bash
claude mcp add devtool-api-client --scope user -- cargo run --quiet --release --bin devtool-mcp-server --manifest-path /absolute/path/to/developer-desktop-utils/src-tauri/Cargo.toml
```

Or build once and point at the plain binary:

```bash
cargo build --release --bin devtool-mcp-server --manifest-path src-tauri/Cargo.toml
claude mcp add devtool-api-client -- /absolute/path/to/developer-desktop-utils/src-tauri/target/release/devtool-mcp-server
```

## Tools

Requests & running:

| Tool | Does |
|---|---|
| `list_collections` | Tree of every collection (id/name/method/url only). |
| `get_collection` | One collection's own script/auth/headers/variables, plus a summarized item tree (id/name/method/url — not every request's full body/script/tests, which would multiply token cost with collection size). |
| `get_request` | Full definition of one request. |
| `update_request` | Patch a request — url, method, params, headers, body, auth, **script** (pre/post-request), tests, assertions, settings: any subset. For the nested fields (`script`, `auth`, `body`, `settings`) a partial object merges onto the existing one instead of replacing it — e.g. `patch: { script: { req: "..." } }` changes only the pre-request script and leaves the post-response script (`res`) as-is. |
| `create_request` | Add a new request to a collection/folder. |
| `run_request` | Actually send a request — pre-request script → send → post-response script → tests/assertions → History. Response bodies over 20,000 chars come back truncated (`bodyTruncated`/`bodyFullLength`); binary responses omit the base64 payload (`bodyBase64Omitted`); console logs are capped at 200 entries (`logsTruncated`/`logsFullCount`) with each entry cut at 2,000 chars — all since raw/unbounded output isn't useful to an MCP client and is expensive in tokens. |

Folders & tree structure:

| Tool | Does |
|---|---|
| `add_folder` | Create a folder in a collection (optionally nested). |
| `rename_item` | Rename a request or folder. |
| `delete_item` | Delete a request or a folder (and its contents). |
| `clone_item` | Duplicate a request or folder as a sibling. |
| `move_item` / `copy_item` | Move or copy a request/folder to a new spot in the tree. |

Collections:

| Tool | Does |
|---|---|
| `add_collection` / `rename_collection` / `delete_collection` / `clone_collection` | Collection lifecycle. |
| `set_collection_variables` | Replace a collection's Collection Variables. |
| `set_node_script` | Set the pre/post-request **script** a collection or folder passes down to its requests (`nodeId=null` = the collection root). Same partial-merge behavior as `update_request`'s `patch.script` — pass just `{ req: "..." }` to change one side only. |
| `set_node_auth` | Set the auth a collection or folder passes down to requests with `auth.type: "inherit"`. Same partial-merge behavior as `update_request`'s `patch.auth`. |
| `set_node_headers` | Set the headers a collection or folder adds to every request under it. |

Environments:

| Tool | Does |
|---|---|
| `list_environments` / `get_environment` | Read environments and their variables. |
| `add_environment` / `duplicate_environment` / `delete_environment` / `import_environment` | Environment lifecycle. Omit `collectionId` for a global environment, or pass one to scope it to that collection (Bruno-style) — a collection can have any number of its own scoped environments. |
| `update_environment` | Patch an environment — `variables` replaces the entire array, `name` renames it, `collectionId` moves it between global and a collection's scope. |
| `set_environment_variable` / `delete_environment_variable` | Add/edit or remove ONE variable by key, leaving the rest of the environment untouched — cheaper than resending the whole `variables` array through `update_environment` for a small change. |
| `set_active_environment` | Activate an environment, globally or for one collection. |

A request's own script/auth/headers/body/tests/assertions all live on the
request itself — edit those through `update_request`'s `patch`, not the
`set_node_*` tools (those are only for what a collection/folder passes down).

Mock Server (each of these needs the **Mock Server** tool open, not API Client):

| Tool | Does |
|---|---|
| `mock_get_config` | Bind (host/port), fallback response, running status, and a summarized stub list (id/enabled/name/method/path/mode/status — not matchers/headers/body/script). |
| `mock_get_stub` | One stub's full definition. |
| `mock_add_stub` / `mock_update_stub` / `mock_delete_stub` / `mock_duplicate_stub` | Stub lifecycle. `mock_update_stub` takes a partial-Stub `patch`, same shape as `update_request`. |
| `mock_move_stub` | Reorder a stub up/down — stub order matters, first match wins. |
| `mock_set_fallback` | Patch the "no stub matched" response (status/body/content-type). |
| `mock_set_bind` | Set host/port for the next `mock_start` (doesn't hot-swap a running server). |
| `mock_start` / `mock_stop` / `mock_status` | Server lifecycle. `mock_start` uses the current stub list + bind address. |
| `mock_test_script` | Run a stub's Rhai response script against a synthetic request — for iterating before saving it. |
| `mock_get_request_log` | Recent requests the server handled (newest first, capped, bodies truncated past 5,000 chars). |
| `mock_clear_request_log` | Clear the request log. |

Redis Client (each needs the **Redis Client** tool open, not API Client —
connection management only, no key/pub-sub/admin tools):

| Tool | Does |
|---|---|
| `redis_list_connections` / `redis_get_connection` | Read saved connection profiles (id/name/host/port/username/password/useTls), unmasked. |
| `redis_add_connection` / `redis_update_connection` / `redis_delete_connection` | Connection profile lifecycle. `redis_update_connection` takes a partial patch — flat fields, no nested merge needed. |
| `redis_test_connection` | Verify a saved connection is reachable, without marking it as connected. |
| `redis_connect` / `redis_disconnect` | Mark a saved connection as active (same as the Connect/Disconnect buttons); `redis_connect` can also set the active logical db (0–15). |
| `redis_connection_status` | Current selected/connected connection id and db. |

Kafka Explorer (each needs the **Kafka Explorer** tool open, not API Client —
connection management only, no topic/consumer-group/produce/consume tools):

| Tool | Does |
|---|---|
| `kafka_list_connections` / `kafka_get_connection` | Read saved broker profiles (id/name/bootstrapServers/saslMechanism/saslUsername/saslPassword/sslEnabled), unmasked. |
| `kafka_add_connection` / `kafka_update_connection` / `kafka_delete_connection` | Broker profile lifecycle. `kafka_update_connection` takes a partial patch — flat fields, no nested merge needed. |
| `kafka_test_connection` | Verify a saved broker is reachable, without marking it as connected. |
| `kafka_connect` / `kafka_disconnect` | Mark a saved broker as active (same as the Connect/Disconnect buttons); stops any realtime consumers running against the previously-connected broker. |
| `kafka_connection_status` | Current selected/connected broker id. |

DevTool MCP management (always answers, regardless of the Background MCP
bridge setting or the per-tool toggles — that's the point):

| Tool | Does |
|---|---|
| `devtool_mcp_status` | Current MCP integration state: whether the Background MCP bridge is on, the per-tool `toolsEnabled` map (api-client/mock-server/redis-client/kafka-explorer), plus the mock server's running status/URL. Call this first if a call unexpectedly times out. |
| `devtool_mcp_set_background` | Turn the Background MCP bridge on or off (mirrors Settings → MCP → Background MCP bridge). Lets a caller enable "answer regardless of which tool is on screen / focus" mode itself, without asking the user to click the toggle. |
| `devtool_mcp_set_tool_enabled` | Turn one tool's MCP access on or off (mirrors Settings → MCP → Per-tool MCP access). A disabled tool never answers any of its calls, on screen or in the background — stricter than, and independent of, the background bridge. |

Reference:

| Tool | Does |
|---|---|
| `get_scripting_reference` | Read-only, covers both tools. API Client: the `dt`/`req`/`res`/`pm` JS scripting API, variable precedence, Assertion operators, and the `Auth`/`RequestBody`/`RequestSettings`/`KeyValue` field shapes `update_request`/`set_node_auth`/`set_node_headers` expect. Mock Server: the Rhai response-script API (a separate language from the API Client's) and the `Stub`/`Matcher`/`MockConfig` field shapes the `mock_*` tools expect. Answered locally — no bridge round-trip, works even with the app closed. Call it before writing or editing a script, auth, assertions, or a stub. |

## Troubleshooting

- **"DevTool doesn't seem to have started its MCP bridge yet"** — the app
  isn't running, or hasn't finished starting. Open it and retry.
- **"Could not reach DevTool on 127.0.0.1:\<port\>"** — the app was closed
  after writing the discovery file (stale port). Restart the app.
- **"No response from DevTool — open the app with the tool that owns this
  call on screen, or turn on Settings → MCP → Background MCP bridge…"** —
  the app is running but nothing answered within 30s. Two possible causes,
  check both:
  - A different tool is on screen and the background bridge is off. Either
    switch to the owning tool (API Client for its tools, Mock Server for
    `mock_*`, Redis Client for `redis_*`, Kafka Explorer for `kafka_*`), or
    call `devtool_mcp_set_background` with `enabled: true` (or turn on
    Settings → MCP → Background MCP bridge by hand) so it stops mattering
    which tool is on screen or whether the app window is focused.
  - The owning tool is switched off in **Settings → MCP → Per-tool MCP
    access**. Call `devtool_mcp_status` to check `toolsEnabled`, then
    `devtool_mcp_set_tool_enabled` with `{ tool, enabled: true }` (or flip it
    by hand) — this is independent of the background bridge, so it stays
    the cause even with that toggle on.
