# DevTool MCP server

Lets an MCP client (Claude Desktop, Claude Code, …) inspect and drive
DevTool's **API Client** tool — list/read/edit collections, requests,
scripts, and environments, and actually **send a request** through the same
engine the Send button uses, with the result landing in the UI and History
like any other send.

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

```bash
cd mcp-server
npm install
```

Then add it to your MCP client's config, pointing at this directory's
`src/index.js` with plain `node`:

**Claude Code** (`claude mcp add`):

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

| Tool | Does |
|---|---|
| `list_collections` | Tree of every collection (id/name/method/url only). |
| `get_collection` | One collection's own script/auth/headers/variables. |
| `get_request` | Full definition of one request. |
| `update_request` | Patch a request (url, method, headers, body, auth, script, tests, assertions, settings — any subset). |
| `create_request` | Add a new request to a collection/folder. |
| `delete_request` | Remove a request. |
| `set_node_script` | Set the pre/post-request script a collection or folder passes down to its requests. |
| `run_request` | Actually send a request — pre-request script → send → post-response script → tests/assertions → History. |
| `list_environments` | Every environment (global + collection-scoped). |
| `get_environment` | One environment's variables. |
| `update_environment` | Patch an environment (most often its `variables` array). |
| `set_active_environment` | Activate an environment, globally or for one collection. |

## Troubleshooting

- **"DevTool doesn't seem to have started its MCP bridge yet"** — the app
  isn't running, or hasn't finished starting. Open it and retry.
- **"Could not reach DevTool on 127.0.0.1:<port>"** — the app was closed
  after writing the discovery file (stale port). Restart the app.
- **"No response from DevTool — is the app open, on the API Client tool?"**
  — the app is running but nothing answered within 30s, almost always
  because a different tool is on screen. Switch to API Client.
