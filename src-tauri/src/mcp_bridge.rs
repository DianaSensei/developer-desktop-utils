// MCP (Model Context Protocol) bridge — local control channel + the tool
// REGISTRY that makes DevTool's MCP surface plugin-driven instead of a
// hardcoded list.
//
// A standalone MCP stdio server (src/bin/devtool-mcp-server.rs, run by
// Claude Desktop/Code — NOT by this app) can't reach into the running
// webview directly, so this module runs a small loopback-only HTTP server
// the sidecar calls into, exposing two things:
//
//   - `GET /tools` — the tool catalogue: name/description/inputSchema for
//     every tool CURRENTLY registered. Each tool is bundled with and
//     registered by its own owner's frontend bridge (e.g.
//     src/components/tools/apiclient/mcpBridge.ts calls
//     `mcp_register_tools` once on mount with API Client's own tool defs;
//     a Tier-B plugin installed from developer-desktop-util-plugin —
//     Redis/RabbitMQ/Container Manager, Kafka Explorer — does the exact
//     same from ITS OWN mcpBridge.ts). This module has no compiled-in
//     knowledge of what tools exist — it only stores whatever's been
//     registered, keyed by the registering plugin's id so a second
//     registration (re-mount) cleanly replaces the first instead of
//     duplicating entries.
//   - `POST /call` — a tool CALL is handed to the frontend as an `mcp:call`
//     event, answered over the `mcp_respond` command by whichever bridge
//     owns that tool name — so an MCP tool call runs through the exact
//     same store/engine the user's own UI uses, and shows up in the UI/
//     History like any other action, same as before this registry existed.
//
// Loopback-only (127.0.0.1, OS-assigned port), gated by a random token
// written alongside the port to `<app_data_dir>/mcp-bridge.json` on
// startup — the sidecar reads that file to find both. `/call` only emits
// the event and waits (CALL_TIMEOUT below) — it has no idea whether
// anything is actually listening for it. By default, a tool call only
// succeeds while the app is running AND the tool that owns it is the one
// currently mounted, because that's the only time its frontend bridge is
// registered (and hence able to answer `mcp:call`). Settings → MCP →
// "Background MCP bridge" (McpBackgroundBridge.tsx, off by default) mounts
// every eligible bridge unconditionally instead, so a call succeeds
// regardless of which tool is on screen — any other case (app closed,
// both the specific tool AND the background setting are off) just times
// out with a clear error.

use std::collections::HashMap;
use std::io::{Error as IoError, ErrorKind};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json};
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;
use uuid::Uuid;

const CALL_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Default)]
pub struct McpBridgeState {
    inner: Arc<Mutex<Inner>>,
}

#[derive(Default)]
struct Inner {
    token: String,
    pending: HashMap<String, oneshot::Sender<CallOutcome>>,
    /// Registered MCP tools, keyed by the REGISTERING plugin's id (not by
    /// tool name — a plugin registers its whole list in one call, and a
    /// re-registration, e.g. its bridge re-mounting, replaces its own
    /// entry wholesale rather than appending duplicates). Flattened into a
    /// single list by `GET /tools` — see `list_tools_http` below.
    tools: HashMap<String, Vec<ToolDef>>,
}

/// One MCP tool's catalogue entry — name/description/JSON-Schema, no
/// handler. The actual call still goes through `POST /call` → `mcp:call` →
/// whichever bridge answers that tool name; this is ONLY what
/// `devtool-mcp-server.rs` needs to advertise it to an MCP client via
/// `list_tools`. Matches the shape that process's `fetch_registered_tools()`
/// expects verbatim (plain fields, no envelope).
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ToolDef {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "empty_schema", rename = "inputSchema")]
    pub input_schema: serde_json::Value,
}

fn empty_schema() -> serde_json::Value {
    serde_json::json!({ "type": "object", "properties": {} })
}

struct CallOutcome {
    result: Option<serde_json::Value>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct McpCallEvent {
    id: String,
    tool: String,
    args: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct CallRequest {
    tool: String,
    #[serde(default)]
    args: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct DiscoveryFile {
    port: u16,
    token: String,
}

fn check_auth(state: &McpBridgeState, headers: &HeaderMap) -> bool {
    let expected = state.inner.lock().unwrap().token.clone();
    let got = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    !expected.is_empty() && got == expected
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn call(
    State((app, state)): State<(AppHandle, McpBridgeState)>,
    headers: HeaderMap,
    Json(body): Json<CallRequest>,
) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "unauthorized" }))).into_response();
    }

    let id = Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    {
        let mut inner = state.inner.lock().unwrap();
        inner.pending.insert(id.clone(), tx);
    }

    let event = McpCallEvent { id: id.clone(), tool: body.tool, args: body.args };
    if app.emit("mcp:call", event).is_err() {
        state.inner.lock().unwrap().pending.remove(&id);
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": "DevTool's window isn't available" })),
        ).into_response();
    }

    match tokio::time::timeout(CALL_TIMEOUT, rx).await {
        Ok(Ok(outcome)) => {
            if let Some(err) = outcome.error {
                (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": err }))).into_response()
            } else {
                (StatusCode::OK, Json(serde_json::json!({ "result": outcome.result }))).into_response()
            }
        }
        Ok(Err(_)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "bridge dropped the call" })),
        ).into_response(),
        Err(_) => {
            state.inner.lock().unwrap().pending.remove(&id);
            (
                StatusCode::GATEWAY_TIMEOUT,
                Json(serde_json::json!({
                    "error": "No response from DevTool — open the app with the tool that owns this call on screen, or turn on Settings → MCP → Background MCP bridge to skip that requirement."
                })),
            ).into_response()
        }
    }
}

async fn list_tools_http(State((_app, state)): State<(AppHandle, McpBridgeState)>, headers: HeaderMap) -> impl IntoResponse {
    if !check_auth(&state, &headers) {
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "unauthorized" }))).into_response();
    }
    let tools: Vec<ToolDef> = state.inner.lock().unwrap().tools.values().flatten().cloned().collect();
    (StatusCode::OK, Json(tools)).into_response()
}

/// Called once by a tool's own frontend bridge when it mounts (e.g.
/// `apiclient/mcpBridge.ts`, or a Tier-B plugin's own `mcpBridge.ts` —
/// compiled-in or installed from developer-desktop-util-plugin, no
/// difference to this registry). `plugin_id` scopes the entry so a second
/// call from the SAME plugin (its bridge re-mounting) replaces its list
/// wholesale rather than duplicating tool names in `GET /tools`.
#[tauri::command]
pub fn mcp_register_tools(state: tauri::State<'_, McpBridgeState>, plugin_id: String, tools: Vec<ToolDef>) {
    state.inner.lock().unwrap().tools.insert(plugin_id, tools);
}

/// Called on unmount by a bridge that only wants to answer calls while its
/// own tool is on screen (the common case — see this module's own doc
/// comment on the "on screen" default). A bridge that stays registered
/// unconditionally (Settings → MCP → Background MCP bridge; the platform's
/// own meta-tools in McpManageBridge.tsx) simply never calls this.
#[tauri::command]
pub fn mcp_unregister_tools(state: tauri::State<'_, McpBridgeState>, plugin_id: String) {
    state.inner.lock().unwrap().tools.remove(&plugin_id);
}

// Answers a pending `/call` with the result the frontend's handler produced
// (or an error message) — the other half of the request/response pair the
// HTTP handler above is blocked waiting on.
#[tauri::command]
pub fn mcp_respond(
    state: tauri::State<'_, McpBridgeState>,
    id: String,
    result: Option<serde_json::Value>,
    error: Option<String>,
) {
    if let Some(tx) = state.inner.lock().unwrap().pending.remove(&id) {
        let _ = tx.send(CallOutcome { result, error });
    }
}

// Resolves the absolute path to the bundled `devtool-mcp-server` sidecar next
// to this app's own executable — where Tauri's `bundle.externalBin` places it
// on every platform (macOS: Contents/MacOS/, alongside the main binary, not
// Contents/Resources/; Windows/Linux: the install directory). Used by the
// API Client Sidebar's "MCP for Claude Code…" dialog to show a
// ready-to-paste `claude mcp add` command without the user having to hunt
// for the install path themselves. Returns an error in a
// dev build (`tauri dev`), where the sidecar isn't bundled next to anything —
// run it via `cargo run --bin devtool-mcp-server` instead while developing
// (see the checked-in .mcp.json, which does exactly that).
#[tauri::command]
pub fn mcp_sidecar_path() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("Could not resolve the app's install directory")?;
    let name = if cfg!(windows) { "devtool-mcp-server.exe" } else { "devtool-mcp-server" };
    let path = dir.join(name);
    if !path.exists() {
        return Err(
            "No bundled MCP sidecar found next to this app — this is likely a dev build (`tauri dev`). \
             Run it via `cargo run --bin devtool-mcp-server` instead while developing \
             (see the checked-in .mcp.json, which does exactly that)."
                .to_string(),
        );
    }
    Ok(path.to_string_lossy().into_owned())
}

fn write_discovery_file(app: &AppHandle, port: u16, token: &str) -> std::io::Result<()> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| IoError::new(ErrorKind::Other, e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("mcp-bridge.json");
    let json = serde_json::to_string_pretty(&DiscoveryFile { port, token: token.to_string() })?;
    std::fs::write(&path, json)?;
    // Best-effort: keep the token file readable only by the current user on
    // unix. Windows ACLs already default to the owning user.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

// Starts the loopback control server and writes its port + token to
// `<app_data_dir>/mcp-bridge.json` for the sidecar to discover. Called once
// from main.rs's `.setup()`.
pub fn start(app: &AppHandle) {
    let token = Uuid::new_v4().simple().to_string();
    let state = McpBridgeState::default();
    state.inner.lock().unwrap().token = token.clone();
    app.manage(state.clone());

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0);
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("mcp bridge: failed to bind loopback port: {e}");
                return;
            }
        };
        let port = match listener.local_addr() {
            Ok(a) => a.port(),
            Err(e) => {
                eprintln!("mcp bridge: failed to read bound port: {e}");
                return;
            }
        };

        if let Err(e) = write_discovery_file(&app_handle, port, &token) {
            eprintln!("mcp bridge: failed to write discovery file: {e}");
        }

        let router = Router::new()
            .route("/health", get(health))
            .route("/call", post(call))
            .route("/tools", get(list_tools_http))
            .with_state((app_handle.clone(), state));

        let _ = axum::serve(listener, router).await;
    });
}
