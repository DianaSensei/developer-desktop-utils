// MCP (Model Context Protocol) bridge — local control channel.
//
// A standalone MCP stdio server (see mcp-server/, run by Claude Desktop/Code —
// NOT by this app) can't reach into the running webview directly, so this
// module runs a small loopback-only HTTP server the sidecar calls into. Each
// call is handed to the frontend as an `mcp:call` event, and the frontend
// (src/components/tools/apiclient/mcpBridge.ts, wired up from ApiClient.tsx)
// answers over the `mcp_respond` command — so an MCP tool call runs through
// the exact same API Client store and request-sending engine the user's own
// UI uses, and shows up in the UI/History like any other action.
//
// Loopback-only (127.0.0.1, OS-assigned port), gated by a random token
// written alongside the port to `<app_data_dir>/mcp-bridge.json` on
// startup — the sidecar reads that file to find both. Only useful while the
// app is running AND the API Client tool is the one currently mounted; any
// other case just times out with a clear error (see CALL_TIMEOUT below).

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
                    "error": "No response from DevTool — is the app open, on the API Client tool?"
                })),
            ).into_response()
        }
    }
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
// Settings UI to show a ready-to-paste `claude mcp add` command without the
// user having to hunt for the install path themselves. Returns an error in a
// dev build (`tauri dev`), where the sidecar isn't bundled next to anything —
// see scripts/prepare-mcp-sidecar.mjs / mcp-server/ for that workflow instead.
#[tauri::command]
pub fn mcp_sidecar_path() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("Could not resolve the app's install directory")?;
    let name = if cfg!(windows) { "devtool-mcp-server.exe" } else { "devtool-mcp-server" };
    let path = dir.join(name);
    if !path.exists() {
        return Err(
            "No bundled MCP sidecar found next to this app — this is likely a dev build (`tauri dev`). \
             Use the Node-based setup in mcp-server/ instead while developing."
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
            .with_state((app_handle.clone(), state));

        let _ = axum::serve(listener, router).await;
    });
}
