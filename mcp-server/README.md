# DevTool MCP server (Node — source-build setup)

> **Just installed DevTool from a binary (dmg/msi/deb/AppImage)?** You don't
> need this directory or Node.js at all — the app already bundles a
> self-contained MCP server. Open the API Client tool → Collections' **More**
> menu (⋮) → **MCP for Claude Code…** for a ready-to-paste `claude mcp add`
> command pointed at it. This `mcp-server/` directory is the Node
> reimplementation used when developing DevTool itself from source (paired
> with the repo's checked-in `.mcp.json`) — read on only if that's you, or if
> you're on a `tauri dev` build where the bundled sidecar isn't built yet.

Lets an MCP client (Claude Desktop, Claude Code, …) inspect and drive
DevTool's **API Client** tool — list/read/edit collections, requests,
scripts, and environments, and actually **send a request** through the same
engine the Send button uses, with the result landing in the UI and History
like any other send. Same tool set, same wire protocol to the app, as the
bundled Rust sidecar (`src-tauri/src/bin/devtool-mcp-server.rs`) — this is
just the version that needs no separate build step while iterating on this
repo's source.

## How it works

This is a small stdio MCP server. Your MCP client spawns it directly; it
never runs inside the DevTool app itself. Every tool call it receives is
forwarded over HTTP to a loopback-only control server the DevTool desktop app
starts on launch (`src-tauri/src/mcp_bridge.rs`), which hands it to the
running webview — so a call only succeeds while:

- the DevTool desktop app is **open**, and
- the **API Client** tool is the one currently on screen (that's where the
  live store this bridges into is mounted).

Anything else — app closed, or you're on a different tool — comes back as a
clear error telling you so, not a hang.

The two processes find each other automatically: on launch, DevTool writes
its bridge's port and a random auth token to
`<app data dir>/mcp-bridge.json` (same directory Tauri already uses for this
app's other persisted files); this server re-reads that file on every call,
so restarting DevTool (new port/token) doesn't require restarting this
server too.

**Excluded on purpose:** the Vault (API Client's local secret store) isn't
exposed here — the UI itself keeps Vault values out of generated code, cURL
export, and history, and an MCP client reading/writing it would defeat that
boundary.

## Setup

### Claude Code — zero-config

The repo root ships a checked-in `.mcp.json` pointing at this server via
`${CLAUDE_PROJECT_DIR}`, so **no `claude mcp add` and no path-typing needed.**
Just:

```bash
cd mcp-server
npm install
```

then open Claude Code anywhere inside this repo. The first time, it prompts
you to approve the project's MCP server (`devtool-api-client`) — approve it
once and it's available in every future session opened here. Skip straight
to opening DevTool below.

### Claude Code (manual) / Claude Desktop

If you'd rather not use the checked-in `.mcp.json` (e.g. registering it
globally instead of per-project), install the same way and add it to your
client's config, pointing at this directory's `src/index.js` with plain
`node`:

```bash
cd mcp-server
npm install
```

**Claude Code** (`claude mcp add`, e.g. with `--scope user` for every project):

```bash
claude mcp add devtool-api-client -- node /absolute/path/to/developer-desktop-utils/mcp-server/src/index.js
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "devtool-api-client": {
      "command": "node",
      "args": ["/absolute/path/to/developer-desktop-utils/mcp-server/src/index.js"]
    }
  }
}
```

Restart your MCP client, open DevTool, switch to the **API Client** tool,
and the tools below become available.

## Tools

Requests & running:

| Tool | Does |
|---|---|
| `list_collections` | Tree of every collection (id/name/method/url only). |
| `get_collection` | One collection's own script/auth/headers/variables. |
| `get_request` | Full definition of one request. |
| `update_request` | Patch a request — url, method, params, headers, body, auth, **script** (pre/post-request), tests, assertions, settings: any subset. |
| `create_request` | Add a new request to a collection/folder. |
| `run_request` | Actually send a request — pre-request script → send → post-response script → tests/assertions → History. |

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
| `set_node_script` | Set the pre/post-request **script** a collection or folder passes down to its requests (`nodeId=null` = the collection root). |
| `set_node_auth` | Set the auth a collection or folder passes down to requests with `auth.type: "inherit"`. |
| `set_node_headers` | Set the headers a collection or folder adds to every request under it. |

Environments:

| Tool | Does |
|---|---|
| `list_environments` / `get_environment` | Read environments and their variables. |
| `add_environment` / `duplicate_environment` / `delete_environment` / `import_environment` | Environment lifecycle. |
| `update_environment` | Patch an environment (most often its `variables` array). |
| `set_active_environment` | Activate an environment, globally or for one collection. |

A request's own script/auth/headers/body/tests/assertions all live on the
request itself — edit those through `update_request`'s `patch`, not the
`set_node_*` tools (those are only for what a collection/folder passes down).

## Troubleshooting

- **"DevTool doesn't seem to have started its MCP bridge yet"** — the app
  isn't running, or hasn't finished starting. Open it and retry.
- **"Could not reach DevTool on 127.0.0.1:<port>"** — the app was closed
  after writing the discovery file (stale port). Restart the app.
- **"No response from DevTool — is the app open, on the API Client tool?"**
  — the app is running but nothing answered within 30s, almost always
  because a different tool is on screen. Switch to API Client.
