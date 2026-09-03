// devtool-mcp-server — MCP stdio server bundled with the DevTool app as a
// Tauri sidecar (see tauri.conf.json's bundle.externalBin), so someone who
// installed DevTool from a binary (dmg/msi/deb/AppImage) can point their MCP
// client straight at it — no Node.js / npm install needed.
//
// It never runs inside the app itself. The app's Tauri backend
// (mcp_bridge.rs) starts a small loopback HTTP control server on launch and
// writes its port + auth token to `<app_data_dir>/mcp-bridge.json` for this
// process to read. Every MCP tool call this process receives over stdio is
// forwarded there as a `POST /call`, which the app hands to the running
// webview to answer — so a call only succeeds while DevTool is open with the
// API Client tool on screen. See src-tauri/src/mcp_bridge.rs for the full
// design, and src/components/tools/apiclient/mcpBridge.ts for what each tool
// actually does.
//
// Built on rmcp (the official Rust MCP SDK) for the protocol itself —
// JSON-RPC framing, capability negotiation, tool routing all come from the
// crate rather than being hand-rolled. What IS hand-rolled: talking to
// mcp_bridge.rs. That's a single localhost POST, so a minimal async
// HTTP/1.1 client over a raw `tokio::net::TcpStream` (tokio is already a
// dependency of rmcp itself, and of the main app) is less risk than pulling
// in a full HTTP client crate for one call shape.

use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::time::Duration;

use rmcp::handler::server::router::tool::{ToolRoute, ToolRouter};
use rmcp::handler::server::tool::ToolCallContext;
use rmcp::model::{
    CallToolRequestParam, CallToolResult, Content, ErrorData as McpError, Implementation,
    ListToolsResult, PaginatedRequestParam, ProtocolVersion, ServerCapabilities, ServerInfo,
    Tool, ToolsCapability,
};
use rmcp::service::RequestContext;
use rmcp::transport::io::stdio;
use rmcp::{RoleServer, ServerHandler, ServiceExt};

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

// Must match `identifier` in tauri.conf.json — Tauri's app_data_dir is keyed
// off it, and mcp_bridge.rs writes its discovery file there.
const APP_IDENTIFIER: &str = "com.desktop-devtool-app";
// How long to wait for a reply from the bridge — matches CALL_TIMEOUT in
// mcp_bridge.rs (30s) plus slack for the local round-trip.
const CALL_TIMEOUT: Duration = Duration::from_secs(35);

// ── locating the running app ─────────────────────────────────────────────

// Tauri's app_data_dir() resolution, per platform — mirrors what
// mcp_bridge.rs's write_discovery_file() actually resolves to at runtime
// (this binary has no AppHandle of its own to ask, since it's a separate
// process the MCP client spawns directly).
fn app_data_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join("Library/Application Support").join(APP_IDENTIFIER)
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        PathBuf::from(appdata).join(APP_IDENTIFIER)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let base = std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_default();
            format!("{home}/.local/share")
        });
        PathBuf::from(base).join(APP_IDENTIFIER)
    }
}

#[derive(Deserialize)]
struct BridgeInfo {
    port: u16,
    token: String,
}

fn read_bridge_info() -> Result<BridgeInfo, String> {
    let path = app_data_dir().join("mcp-bridge.json");
    let text = std::fs::read_to_string(&path).map_err(|_| {
        format!(
            "DevTool doesn't seem to have started its MCP bridge yet (no file at {}). Open the DevTool app and try again.",
            path.display()
        )
    })?;
    serde_json::from_str(&text)
        .map_err(|_| "DevTool's MCP bridge file is malformed — restart the app.".to_string())
}

// Decodes an HTTP/1.1 chunked body: repeated `<hex size>\r\n<data>\r\n`,
// terminated by a zero-size chunk. Malformed input just stops decoding at
// whatever chunk it can't parse, rather than panicking — the caller's JSON
// parse of the (possibly incomplete) result surfaces that as an error.
fn dechunk(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len());
    let mut pos = 0;
    while pos < input.len() {
        let Some(line_end) = input[pos..].windows(2).position(|w| w == b"\r\n") else { break };
        let size_line = String::from_utf8_lossy(&input[pos..pos + line_end]);
        let Ok(size) = usize::from_str_radix(size_line.trim(), 16) else { break };
        pos += line_end + 2;
        if size == 0 {
            break;
        }
        if pos + size > input.len() {
            break;
        }
        out.extend_from_slice(&input[pos..pos + size]);
        pos += size + 2; // skip the chunk's trailing \r\n
    }
    out
}

async fn http_post_json(port: u16, token: &str, body: &Value) -> Result<Value, String> {
    let payload = serde_json::to_vec(body).map_err(|e| e.to_string())?;
    let mut stream = tokio::time::timeout(Duration::from_secs(5), TcpStream::connect(("127.0.0.1", port)))
        .await
        .map_err(|_| format!("Timed out connecting to DevTool on 127.0.0.1:{port}."))?
        .map_err(|e| format!("Could not reach DevTool on 127.0.0.1:{port} ({e}). Is the app open?"))?;

    let request = format!(
        "POST /call HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len(),
    );
    stream.write_all(request.as_bytes()).await.map_err(|e| e.to_string())?;
    stream.write_all(&payload).await.map_err(|e| e.to_string())?;

    let mut raw = Vec::new();
    tokio::time::timeout(CALL_TIMEOUT, stream.read_to_end(&mut raw))
        .await
        .map_err(|_| "Timed out waiting for DevTool's response.".to_string())?
        .map_err(|e| e.to_string())?;

    let split_at = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| "Malformed HTTP response from DevTool's MCP bridge.".to_string())?;
    let (head, rest) = raw.split_at(split_at);
    let raw_body = &rest[4..];
    let head_str = String::from_utf8_lossy(head);
    let status: u16 = head_str
        .lines()
        .next()
        .unwrap_or("")
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    // axum's `Json` responses always send Content-Length (verified against a
    // real axum server, not chunked), but decode chunked too just in case —
    // cheap insurance for a binary that ships to every install of the app.
    let is_chunked = head_str
        .lines()
        .any(|l| l.to_ascii_lowercase().starts_with("transfer-encoding") && l.to_ascii_lowercase().contains("chunked"));
    let body_bytes = if is_chunked { dechunk(raw_body) } else { raw_body.to_vec() };

    let json: Value = serde_json::from_slice(&body_bytes)
        .map_err(|_| format!("DevTool's MCP bridge returned a non-JSON response (HTTP {status})."))?;

    if !(200..300).contains(&status) {
        let msg = json.get("error").and_then(|e| e.as_str()).unwrap_or("");
        return Err(if msg.is_empty() {
            format!("DevTool's MCP bridge returned HTTP {status}.")
        } else {
            msg.to_string()
        });
    }
    if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
        return Err(err.to_string());
    }
    Ok(json.get("result").cloned().unwrap_or(Value::Null))
}

async fn call_bridge(tool: &str, args: Value) -> Result<Value, String> {
    let info = read_bridge_info()?;
    http_post_json(info.port, &info.token, &json!({ "tool": tool, "args": args })).await
}

async fn call_tool(name: &str, args: Value) -> CallToolResult {
    match call_bridge(name, args).await {
        Ok(v) => {
            let text = serde_json::to_string_pretty(&v).unwrap_or_else(|_| v.to_string());
            CallToolResult::success(vec![Content::text(text)])
        }
        Err(e) => CallToolResult::error(vec![Content::text(e)]),
    }
}

// ── tool catalogue ───────────────────────────────────────────────────────
// Kept in sync by hand with the actual handlers in
// src/components/tools/apiclient/mcpBridge.ts.

fn kv_array_schema() -> Value {
    json!({
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "id": { "type": "string" },
                "key": { "type": "string" },
                "value": { "type": "string" },
                "enabled": { "type": "boolean" }
            },
            "required": ["id", "key", "value", "enabled"]
        }
    })
}

fn nullable_string() -> Value {
    json!({ "type": ["string", "null"] })
}

fn tool_definitions() -> Vec<Value> {
    let where_schema = json!({ "type": "string", "enum": ["before", "after", "inside"], "default": "inside" });

    vec![
        json!({
            "name": "list_collections",
            "description": "List every collection open in DevTool's API Client, with their folder/request tree (id, name, method, url — no bodies/scripts/secrets).",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "get_collection",
            "description": "Get one collection by id, including its own script/auth/headers/variables (not its requests' bodies — use get_request for those).",
            "inputSchema": { "type": "object", "properties": { "collectionId": { "type": "string" } }, "required": ["collectionId"] }
        }),
        json!({
            "name": "get_request",
            "description": "Get the full definition of one request by id: method, url, params, headers, body, auth, pre/post-request script, tests, assertions, settings.",
            "inputSchema": { "type": "object", "properties": { "requestId": { "type": "string" } }, "required": ["requestId"] }
        }),
        json!({
            "name": "update_request",
            "description": "Patch a request in place. `patch` is a partial ApiRequest object — only the fields you include are changed (e.g. { \"url\": \"...\", \"method\": \"POST\", \"body\": { \"mode\": \"json\", \"raw\": \"...\", \"form\": [] } }). Set patch.script = { req, res } to edit its pre/post-request script.",
            "inputSchema": {
                "type": "object",
                "properties": { "requestId": { "type": "string" }, "patch": { "type": "object" } },
                "required": ["requestId", "patch"]
            }
        }),
        json!({
            "name": "create_request",
            "description": "Create a new request in a collection (optionally inside a folder) and return it. `request` is a partial ApiRequest used as the initial values.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "folderId": { "type": "string" }, "request": { "type": "object" } },
                "required": ["collectionId"]
            }
        }),
        json!({
            "name": "run_request",
            "description": "Actually send a request through DevTool (same engine as the Send button): runs its pre-request script, sends it, runs the post-response script, evaluates tests/assertions, and appends it to History. Returns the response, tests, console logs, and any transport/script error. Pass environmentId to force a specific environment (omit for the currently active one, null for \"No Environment\").",
            "inputSchema": {
                "type": "object",
                "properties": { "requestId": { "type": "string" }, "environmentId": nullable_string() },
                "required": ["requestId"]
            }
        }),
        json!({
            "name": "add_folder",
            "description": "Create a folder in a collection (optionally nested inside another folder) and return its id.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "name": { "type": "string" }, "parentId": { "type": "string" } },
                "required": ["collectionId"]
            }
        }),
        json!({
            "name": "rename_item",
            "description": "Rename a request or folder by id.",
            "inputSchema": { "type": "object", "properties": { "itemId": { "type": "string" }, "name": { "type": "string" } }, "required": ["itemId", "name"] }
        }),
        json!({
            "name": "delete_item",
            "description": "Delete a request or a folder (and everything inside it) by id.",
            "inputSchema": { "type": "object", "properties": { "itemId": { "type": "string" } }, "required": ["itemId"] }
        }),
        json!({
            "name": "clone_item",
            "description": "Duplicate a request or folder as a new sibling right after it.",
            "inputSchema": { "type": "object", "properties": { "itemId": { "type": "string" } }, "required": ["itemId"] }
        }),
        json!({
            "name": "move_item",
            "description": "Move (cut) a request or folder to a new spot. `targetId` may be a collection id (moves to its root), or a request/folder id combined with `where`: \"before\"/\"after\" that sibling, or \"inside\" it (folders only).",
            "inputSchema": {
                "type": "object",
                "properties": { "sourceId": { "type": "string" }, "targetId": { "type": "string" }, "where": where_schema.clone() },
                "required": ["sourceId", "targetId"]
            }
        }),
        json!({
            "name": "copy_item",
            "description": "Copy (not cut) a request or folder to a new spot — same targeting as move_item, but the source is left in place.",
            "inputSchema": {
                "type": "object",
                "properties": { "sourceId": { "type": "string" }, "targetId": { "type": "string" }, "where": where_schema },
                "required": ["sourceId", "targetId"]
            }
        }),
        json!({
            "name": "add_collection",
            "description": "Create a new, empty collection and return its id.",
            "inputSchema": { "type": "object", "properties": { "name": { "type": "string" } } }
        }),
        json!({
            "name": "rename_collection",
            "description": "Rename a collection by id.",
            "inputSchema": { "type": "object", "properties": { "collectionId": { "type": "string" }, "name": { "type": "string" } }, "required": ["collectionId", "name"] }
        }),
        json!({
            "name": "delete_collection",
            "description": "Delete a collection (and everything inside it) by id. Also drops any environments scoped to it.",
            "inputSchema": { "type": "object", "properties": { "collectionId": { "type": "string" } }, "required": ["collectionId"] }
        }),
        json!({
            "name": "clone_collection",
            "description": "Duplicate a whole collection (deep copy, fresh ids for everything inside) right after the original.",
            "inputSchema": { "type": "object", "properties": { "collectionId": { "type": "string" } }, "required": ["collectionId"] }
        }),
        json!({
            "name": "set_collection_variables",
            "description": "Replace a collection's Collection Variables (shared defaults available to every request in it, regardless of active environment). Pass the full array you want it to end up with.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "variables": kv_array_schema() },
                "required": ["collectionId", "variables"]
            }
        }),
        json!({
            "name": "set_node_script",
            "description": "Set the pre/post-request script inherited by every request under a collection or folder (Bruno-style). Pass nodeId=null (or omit it) for the collection's own root script; pass a folder id for that folder's script. A request's OWN script is a field on it instead — see update_request's patch.script.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "collectionId": { "type": "string" },
                    "nodeId": nullable_string(),
                    "script": {
                        "type": "object",
                        "properties": { "req": { "type": "string" }, "res": { "type": "string" } },
                        "required": ["req", "res"]
                    }
                },
                "required": ["collectionId", "script"]
            }
        }),
        json!({
            "name": "set_node_auth",
            "description": "Set the auth inherited by every request under a collection or folder that has auth.type=\"inherit\" (Bruno-style). Pass nodeId=null (or omit it) for the collection root; pass a folder id for that folder. A request's OWN auth is a field on it instead — see update_request's patch.auth.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "nodeId": nullable_string(), "auth": { "type": "object" } },
                "required": ["collectionId", "auth"]
            }
        }),
        json!({
            "name": "set_node_headers",
            "description": "Set the headers added to every request under a collection or folder (Bruno-style; a request's own header of the same name overrides it). Pass nodeId=null (or omit it) for the collection root; pass a folder id for that folder. A request's OWN headers are a field on it instead — see update_request's patch.headers.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "nodeId": nullable_string(), "headers": kv_array_schema() },
                "required": ["collectionId", "headers"]
            }
        }),
        json!({
            "name": "list_environments",
            "description": "List every environment (global and collection-scoped) with id, name, and owning collectionId (null = global).",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "get_environment",
            "description": "Get one environment by id, including its variables (values are returned as stored — a variable marked secret is not masked here, unlike the UI's quick-view).",
            "inputSchema": { "type": "object", "properties": { "environmentId": { "type": "string" } }, "required": ["environmentId"] }
        }),
        json!({
            "name": "update_environment",
            "description": "Patch an environment. `patch` is a partial Environment object, most commonly { \"variables\": [...] } — pass the full variables array you want it to end up with.",
            "inputSchema": {
                "type": "object",
                "properties": { "environmentId": { "type": "string" }, "patch": { "type": "object" } },
                "required": ["environmentId", "patch"]
            }
        }),
        json!({
            "name": "set_active_environment",
            "description": "Activate an environment. scope=\"global\" sets the active Global environment; scope=\"collection\" (default) sets the active environment for one collection — pass collectionId in that case. environmentId=null clears it (\"No Environment\").",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "scope": { "type": "string", "enum": ["global", "collection"], "default": "collection" },
                    "collectionId": { "type": "string" },
                    "environmentId": nullable_string()
                },
                "required": ["environmentId"]
            }
        }),
        json!({
            "name": "add_environment",
            "description": "Create a new environment and return its id. Omit collectionId for a global environment; pass one to scope it to that collection.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "name": { "type": "string" }, "variables": kv_array_schema() }
            }
        }),
        json!({
            "name": "duplicate_environment",
            "description": "Clone an environment (same scope, \"<name> copy\", fresh ids for every variable row) and return the new id.",
            "inputSchema": { "type": "object", "properties": { "environmentId": { "type": "string" } }, "required": ["environmentId"] }
        }),
        json!({
            "name": "delete_environment",
            "description": "Delete an environment by id. Clears it from wherever it was the active choice.",
            "inputSchema": { "type": "object", "properties": { "environmentId": { "type": "string" } }, "required": ["environmentId"] }
        }),
        json!({
            "name": "import_environment",
            "description": "Create an environment with a name, scope, and full variable set in one call (e.g. importing one from another tool). Returns the new id.",
            "inputSchema": {
                "type": "object",
                "properties": { "name": { "type": "string" }, "collectionId": nullable_string(), "variables": kv_array_schema() },
                "required": ["name"]
            }
        }),
    ]
}

// ── rmcp server wiring ───────────────────────────────────────────────────
// Converts each raw `tool_definitions()` entry into a rmcp `Tool` + a
// dynamic route that forwards straight to `call_tool` — one generic
// dispatcher rather than a hand-written method per tool, since every tool
// here has the same shape (take a JSON args object, forward it to the
// bridge, return its result as text).

#[derive(Clone)]
struct DevToolServer {
    tool_router: ToolRouter<Self>,
}

fn build_router() -> ToolRouter<DevToolServer> {
    let mut router = ToolRouter::new();
    for def in tool_definitions() {
        let name = def.get("name").and_then(Value::as_str).unwrap_or("").to_string();
        let description = def.get("description").and_then(Value::as_str).unwrap_or("").to_string();
        let schema = match def.get("inputSchema").cloned().unwrap_or_else(|| json!({})) {
            Value::Object(m) => m,
            _ => Default::default(),
        };
        let tool = Tool {
            name: name.clone().into(),
            title: None,
            description: Some(description.into()),
            input_schema: std::sync::Arc::new(schema),
            output_schema: None,
            annotations: None,
            icons: None,
            meta: None,
        };
        router.add_route(ToolRoute::new_dyn(tool, move |context: ToolCallContext<'_, DevToolServer>| {
            let name = name.clone();
            let args = context.arguments.clone().map(Value::Object).unwrap_or_else(|| json!({}));
            Box::pin(async move { Ok(call_tool(&name, args).await) })
                as Pin<Box<dyn Future<Output = Result<CallToolResult, McpError>> + Send>>
        }));
    }
    router
}

impl ServerHandler for DevToolServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::default(),
            instructions: Some(
                "Drives DevTool's API Client tool — collections, requests, scripts, \
                 environments — and can actually send a request. Only answers while the \
                 DevTool desktop app is open with the API Client tool on screen."
                    .to_string(),
            ),
            capabilities: ServerCapabilities {
                tools: Some(ToolsCapability { list_changed: None }),
                ..Default::default()
            },
            server_info: Implementation {
                name: "devtool-api-client".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                ..Default::default()
            },
        }
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParam>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListToolsResult, McpError>> + Send + '_ {
        std::future::ready(Ok(ListToolsResult { tools: self.tool_router.list_all(), next_cursor: None }))
    }

    fn call_tool(
        &self,
        request: CallToolRequestParam,
        context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<CallToolResult, McpError>> + Send + '_ {
        self.tool_router.call(ToolCallContext::new(self, request, context))
    }
}

#[tokio::main]
async fn main() {
    let server = DevToolServer { tool_router: build_router() };
    match server.serve(stdio()).await {
        Ok(service) => {
            if let Err(e) = service.waiting().await {
                eprintln!("devtool-mcp-server: {e}");
            }
        }
        Err(e) => eprintln!("devtool-mcp-server: failed to start: {e}"),
    }
}
