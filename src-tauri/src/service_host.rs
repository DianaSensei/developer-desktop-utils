// Host for tier-B service plugins: each sidecar runs as its own process.
//
// Why a separate process instead of more Tauri commands: commands are
// registered at compile time by `generate_handler!`, and the release profile
// uses `panic = "abort"`, so a panic in service code would take down the whole
// app. A crashed sidecar only loses itself and is respawned on the next call.
//
// Protocol: JSON lines over stdin/stdout. Every response line carries the `id`
// of the request it answers. Two call styles:
//   - one-shot (`service_call`): exactly one response line per request;
//   - stream (`service_stream_start`/`_stop`): many lines with the same `id`
//     until the sidecar sends `done: true` or the host stops routing them.
//
// One reader task per sidecar demultiplexes responses by `id`, so concurrent
// calls to one sidecar do not block each other and a late response after a
// timeout matches no waiter and is dropped.
//
// Sidecar contract:
//   1. answer every stdin line with at least one JSON line carrying its `id`;
//   2. exit when stdin closes (this is how sidecars are cleaned up even if the
//      app is killed);
//   3. write nothing else to stdout (logs go to stderr).
//
// Trust boundary: the webview names the binary, but permission to run it is
// decided in Rust:
//   - `ALLOWED_SERVICES`: DevTool's own sidecars, fixed at build time, run
//     without asking;
//   - any other valid name requires the user's consent through a native
//     dialog showing the path and SHA-256 (`service_trust.rs`).

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{oneshot, Mutex as AsyncMutex};
use tokio::time::timeout;

/// Message framing version. Must match `SERVICE_PROTOCOL` in
/// src/platform/service.ts.
pub const SERVICE_PROTOCOL: u32 = 1;

// Same value as `mcp_bridge.rs`'s `CALL_TIMEOUT` by coincidence; they time
// out different things and can change independently.
const CALL_TIMEOUT: Duration = Duration::from_secs(30);

/// DevTool's own sidecars, which run without a consent prompt. Any other
/// name needs user consent (see `service_trust.rs`); adding a plugin does not
/// require editing this list. Not every entry is bundled (see
/// `BUNDLED_SERVICES`).
///
/// `devtool-svc-echo` is a minimal example sidecar used by
/// `tests/service_echo.rs` to exercise one-shot and stream calls end to end.
///
/// The redis/container/rabbit/kafka sidecars now ship from the
/// `developer-desktop-miniapp` repo (see
/// docs/decisions/architecture/optional-broker-plugins.md). Their names stay
/// here so existing users are not prompted for consent after upgrading.
const ALLOWED_SERVICES: &[&str] = &["devtool-svc-echo", "devtool-svc-redis", "devtool-svc-container", "devtool-svc-rabbit", "devtool-svc-kafka"];

/// The subset of `ALLOWED_SERVICES` shipped with the app. Must match
/// `bundle.externalBin` in tauri.conf.json and
/// `scripts/prepare-service-sidecars.mjs`. The rest are installed by URL.
#[cfg(test)]
const BUNDLED_SERVICES: &[&str] = &["devtool-svc-echo"];

#[derive(Debug, Deserialize)]
pub struct ServiceRequest {
    pub protocol: u32,
    pub id: String,
    pub plugin: String,
    pub bin: String,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

fn is_false(b: &bool) -> bool {
    !*b
}

// Responses are parsed into this type before being forwarded, so a sidecar
// returning malformed JSON is rejected here rather than in the webview.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceResponse {
    pub protocol: u32,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// One event of a stream rather than a one-shot response. Defaults to
    /// false, so sidecars unaware of streams stay compatible.
    #[serde(default, skip_serializing_if = "is_false")]
    pub stream: bool,
    /// Last line of a stream; no more events follow for this `id`.
    /// Ignored for one-shot calls.
    #[serde(default, skip_serializing_if = "is_false")]
    pub done: bool,
}

impl ServiceResponse {
    fn err(id: &str, message: impl Into<String>) -> Self {
        Self {
            protocol: SERVICE_PROTOCOL,
            id: id.to_string(),
            result: None,
            error: Some(message.into()),
            stream: false,
            done: false,
        }
    }
}

/// Valid name for a sidecar outside `ALLOWED_SERVICES`: `devtool-svc-` plus
/// kebab-case, with nothing that could escape the services directory.
pub fn is_valid_service_name(bin: &str) -> bool {
    const PREFIX: &str = "devtool-svc-";
    let Some(rest) = bin.strip_prefix(PREFIX) else { return false };
    bin.len() <= 64
        && !rest.is_empty()
        && !rest.starts_with('-')
        && !rest.ends_with('-')
        && !rest.contains("--")
        && rest.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Why a request is rejected before reaching any process: protocol mismatch,
/// or a name that cannot be a sidecar. Valid names outside
/// `ALLOWED_SERVICES` pass here; `ensure_trusted` asks the user before spawn.
pub fn reject_reason(request: &ServiceRequest) -> Option<String> {
    if request.protocol != SERVICE_PROTOCOL {
        return Some(format!(
            "lệch protocol: client {}, host {SERVICE_PROTOCOL}",
            request.protocol
        ));
    }
    if !ALLOWED_SERVICES.contains(&request.bin.as_str()) && !is_valid_service_name(&request.bin) {
        return Some(format!(
            "dịch vụ \"{}\" không nằm trong allowlist của host và không phải tên sidecar hợp lệ \
             (cần dạng devtool-svc-<ten-kebab-case>)",
            request.bin
        ));
    }
    None
}

/// Where a response with a matching `id` goes. `Once` resolves a single
/// time; `Stream` lives until `done`, an `error`, or `service_stream_stop`.
enum Waiter {
    Once(oneshot::Sender<ServiceResponse>),
    Stream(Box<dyn EventSink>),
}

/// Destination for stream events. Abstracted from `tauri::ipc::Channel`,
/// which can only be created inside a running app, so tests can collect
/// events in memory.
trait EventSink: Send {
    fn send(&self, value: serde_json::Value);
}

struct ChannelSink(Channel<serde_json::Value>);

impl EventSink for ChannelSink {
    fn send(&self, value: serde_json::Value) {
        let _ = self.0.send(value);
    }
}

type Waiters = Arc<StdMutex<HashMap<String, Waiter>>>;

struct RunningSidecar {
    child: AsyncMutex<Child>,
    stdin: AsyncMutex<ChildStdin>,
    waiters: Waiters,
}

#[derive(Default, Clone)]
pub struct ServiceRegistry {
    running: Arc<AsyncMutex<HashMap<String, Arc<RunningSidecar>>>>,
    pub trust: Arc<crate::service_trust::ServiceTrust>,
}

/// Looks for the sidecar next to the executable. `dir` is a parameter so
/// tests do not depend on `current_exe()`.
fn resolve_beside_dir(dir: &std::path::Path, bin: &str) -> Result<std::path::PathBuf, String> {
    let name = if cfg!(windows) { format!("{bin}.exe") } else { bin.to_string() };
    let path = dir.join(name);
    if !path.exists() {
        return Err(format!(
            "Không thấy sidecar \"{bin}\" cạnh app, và cũng chưa cài qua Settings → Extensions. \
             Nhiều khả năng đây là bản dev (`tauri dev`), vốn chỉ build bin mặc định (`devtool`) \
             chứ không build các sidecar. Chạy `cargo build --bin {bin}` để nó nằm cạnh trong \
             target/debug rồi thử lại, hoặc cài sidecar này qua URL trong Settings."
        ));
    }
    Ok(path)
}

/// Resolves the binary to spawn for `bin`. A URL-installed copy recorded in
/// `extensions/index.json` (whose file still exists) always wins over the
/// copy bundled next to the executable. Do not reverse this order: it lets a
/// sidecar be dropped from `bundle.externalBin` without changing this code.
fn resolve_sidecar_path(
    index_dir: Option<&std::path::Path>,
    beside_dir: &std::path::Path,
    bin: &str,
) -> Result<std::path::PathBuf, String> {
    if let Some(dir) = index_dir {
        if let Some(path) = crate::artifact_installer::installed_service_bin_path_at(dir, bin) {
            return Ok(path);
        }
    }
    resolve_beside_dir(beside_dir, bin)
}

/// The two places a sidecar can live: the install index (if readable) and
/// the directory of the executable. A failure to open the index is ignored
/// so the bundled fallback still works.
fn sidecar_dirs(app: &AppHandle) -> Result<(Option<std::path::PathBuf>, std::path::PathBuf), String> {
    let index_dir = crate::artifact_installer::extensions_dir(app).ok();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let beside_dir = exe
        .parent()
        .ok_or("Không xác định được thư mục cài đặt của app")?
        .to_path_buf();
    Ok((index_dir, beside_dir))
}

fn sidecar_path(app: &AppHandle, bin: &str) -> Result<std::path::PathBuf, String> {
    // Trust boundary: decides which binary is actually spawned for `bin`.
    let (index_dir, beside_dir) = sidecar_dirs(app)?;
    resolve_sidecar_path(index_dir.as_deref(), &beside_dir, bin)
}

/// Routes one parsed response to its waiter.
fn dispatch(waiters: &Waiters, response: ServiceResponse) {
    let mut w = waiters.lock().unwrap();
    // Remove first and reinsert for streams; the borrow checker does not
    // allow holding the entry across both.
    let Some(waiter) = w.remove(&response.id) else {
        // Nobody waits for this id (timed out, or garbage); drop it.
        return;
    };
    match waiter {
        Waiter::Once(tx) => {
            let _ = tx.send(response);
        }
        Waiter::Stream(sink) => {
            if response.error.is_some() || response.done {
                // An error ends the stream.
                return;
            }
            sink.send(response.result.unwrap_or(serde_json::Value::Null));
            w.insert(response.id, Waiter::Stream(sink));
        }
    }
}

/// Reads one sidecar's stdout for the life of the process. Stops when stdout
/// closes or a line is not valid protocol JSON (after which line boundaries
/// cannot be trusted). `on_ended` runs once when the loop stops.
async fn reader_loop(
    mut lines: Lines<BufReader<ChildStdout>>,
    waiters: Waiters,
    on_ended: impl FnOnce() + Send + 'static,
) {
    while let Ok(Some(line)) = lines.next_line().await {
        match serde_json::from_str::<ServiceResponse>(&line) {
            Ok(response) => dispatch(&waiters, response),
            Err(_) => break,
        }
    }
    // Fail pending one-shot calls now instead of letting them time out.
    // Streams simply stop receiving events.
    let mut w = waiters.lock().unwrap();
    for (_, waiter) in w.drain() {
        if let Waiter::Once(tx) = waiter {
            let _ = tx.send(ServiceResponse::err("", "Sidecar đã thoát hoặc nói sai giao thức"));
        }
    }
    drop(w);
    on_ended();
}

/// Spawns a process and its reader loop. Takes a `Command` so tests can use
/// `cat` or `sh` instead of a real sidecar.
fn spawn_process(
    command: &mut Command,
    on_ended: impl FnOnce() + Send + 'static,
) -> Result<Arc<RunningSidecar>, String> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        // Belt and braces: kill the child when the handle drops. The
        // stdin-EOF rule still matters because a killed parent may never
        // drop the registry.
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdin = child.stdin.take().ok_or("Sidecar không mở được stdin")?;
    let stdout = child.stdout.take().ok_or("Sidecar không mở được stdout")?;
    let waiters: Waiters = Arc::default();

    tokio::spawn(reader_loop(BufReader::new(stdout).lines(), waiters.clone(), on_ended));

    Ok(Arc::new(RunningSidecar {
        child: AsyncMutex::new(child),
        stdin: AsyncMutex::new(stdin),
        waiters,
    }))
}

/// Private data directory for one sidecar: `<app_data>/service-data/<bin>`.
/// The sidecar only learns this path through `DEVTOOL_SERVICE_DATA_DIR`, so
/// it never sees the app data root or another sidecar's directory.
fn service_data_dir(app_data_dir: &std::path::Path, bin: &str) -> std::path::PathBuf {
    app_data_dir.join("service-data").join(bin)
}

/// Shows the native consent dialog. The webview has no way to answer it.
async fn ask_user(app: &AppHandle, dialog: crate::service_trust::ConsentDialog) -> bool {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let (tx, rx) = oneshot::channel();
    app.dialog()
        .message(dialog.message)
        .title(dialog.title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(dialog.allow, dialog.deny))
        .show(move |allowed| {
            let _ = tx.send(allowed);
        });
    rx.await.unwrap_or(false)
}

/// UI language for the consent dialog, read from `app-settings.json` (the
/// key `LocaleContext.tsx` writes).
fn ui_locale_at(app_data: Option<&std::path::Path>) -> crate::service_trust::Locale {
    app_data
        .and_then(|d| std::fs::read_to_string(d.join("app-settings.json")).ok())
        .map(|raw| crate::service_trust::locale_from_settings(&raw))
        .unwrap_or(crate::service_trust::Locale::En)
}

/// Decision logic of `ensure_trusted` with every app dependency passed in,
/// so the whole flow is testable.
async fn ensure_trusted_with<F, Fut>(
    trust: &crate::service_trust::ServiceTrust,
    bin: &str,
    index_dir: Option<&std::path::Path>,
    beside_dir: &std::path::Path,
    app_data: Option<&std::path::Path>,
    home: Option<&str>,
    ask: F,
) -> Result<(), String>
where
    F: FnOnce(crate::service_trust::ConsentDialog) -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    if ALLOWED_SERVICES.contains(&bin) {
        return Ok(());
    }
    let path = resolve_sidecar_path(index_dir, beside_dir, bin)?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Không đọc được \"{}\": {e}", path.display()))?;
    let sha256 = crate::artifact_installer::sha256_hex(&bytes);
    let source = index_dir.and_then(|d| crate::artifact_installer::installed_service_source_url_at(d, bin));
    let dialog = crate::service_trust::consent_dialog(ui_locale_at(app_data), bin, &path, &sha256, source.as_deref(), home);
    trust.ensure(bin, &sha256, || ask(dialog)).await
}

/// DevTool's own sidecars run without asking; any other sidecar needs consent
/// for the exact file about to run (hashed now, not at install time).
async fn ensure_trusted(app: &AppHandle, registry: &ServiceRegistry, bin: &str) -> Result<(), String> {
    let (index_dir, beside_dir) = sidecar_dirs(app)?;
    let app_data = app.path().app_data_dir().ok();
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok();
    ensure_trusted_with(
        &registry.trust,
        bin,
        index_dir.as_deref(),
        &beside_dir,
        app_data.as_deref(),
        home.as_deref(),
        |dialog| ask_user(app, dialog),
    )
    .await
}

async fn get_or_spawn(app: &AppHandle, registry: &ServiceRegistry, bin: &str) -> Result<Arc<RunningSidecar>, String> {
    // Fast path. Do not hold the registry lock while a consent dialog may be
    // open; other sidecars must stay callable.
    if let Some(running) = registry.running.lock().await.get(bin) {
        return Ok(running.clone());
    }
    ensure_trusted(app, registry, bin).await?;

    let mut map = registry.running.lock().await;
    if let Some(running) = map.get(bin) {
        return Ok(running.clone());
    }

    let mut command = Command::new(sidecar_path(app, bin)?);
    // Sidecars have no `AppHandle`, so persistent data goes in their own
    // directory passed through the environment.
    if let Ok(app_data) = app.path().app_data_dir() {
        let dir = service_data_dir(&app_data, bin);
        if std::fs::create_dir_all(&dir).is_ok() {
            command.env("DEVTOOL_SERVICE_DATA_DIR", dir);
        }
    }
    let cleanup_registry = registry.clone();
    let cleanup_bin = bin.to_string();
    let running = spawn_process(&mut command, move || {
        // `on_ended` is a plain closure, so removal (which needs the async
        // lock) runs in its own task. A call that races it writes to a
        // closed stdin and gets an error.
        tokio::spawn(async move {
            cleanup_registry.running.lock().await.remove(&cleanup_bin);
        });
    })
    .map_err(|e| format!("Không chạy được sidecar \"{bin}\": {e}"))?;

    map.insert(bin.to_string(), running.clone());
    Ok(running)
}

async fn write_line(running: &RunningSidecar, line: &str) -> Result<(), String> {
    let mut stdin = running.stdin.lock().await;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("Không ghi được xuống sidecar: {e}"))?;
    stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())
}

fn encode(request: &ServiceRequest) -> Result<String, String> {
    serde_json::to_string(&serde_json::json!({
        "protocol": request.protocol,
        "id": request.id,
        "plugin": request.plugin,
        "method": request.method,
        "params": request.params,
    }))
    .map_err(|e| e.to_string())
}

/// One-shot request/response. The waiter is registered before writing so a
/// fast response cannot arrive before anyone is waiting.
async fn call_once(running: &RunningSidecar, request: &ServiceRequest, limit: Duration) -> ServiceResponse {
    let line = match encode(request) {
        Ok(l) => l,
        Err(e) => return ServiceResponse::err(&request.id, e),
    };

    let (tx, rx) = oneshot::channel();
    running.waiters.lock().unwrap().insert(request.id.clone(), Waiter::Once(tx));

    if let Err(e) = write_line(running, &line).await {
        running.waiters.lock().unwrap().remove(&request.id);
        return ServiceResponse::err(&request.id, e);
    }

    match timeout(limit, rx).await {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => ServiceResponse::err(&request.id, "Sidecar đã thoát trước khi trả lời"),
        Err(_) => {
            // The sidecar is not killed: a late response for this id finds no
            // waiter and is dropped, and other calls are unaffected.
            running.waiters.lock().unwrap().remove(&request.id);
            ServiceResponse::err(&request.id, format!("Sidecar không trả lời trong {}s", limit.as_secs()))
        }
    }
}

#[tauri::command]
pub async fn service_call(
    app: AppHandle,
    state: tauri::State<'_, ServiceRegistry>,
    request: ServiceRequest,
) -> Result<ServiceResponse, String> {
    if let Some(reason) = reject_reason(&request) {
        return Ok(ServiceResponse::err(&request.id, reason));
    }
    let running = match get_or_spawn(&app, &state, &request.bin).await {
        Ok(r) => r,
        Err(e) => return Ok(ServiceResponse::err(&request.id, e)),
    };
    Ok(call_once(&running, &request, CALL_TIMEOUT).await)
}

/// Starts a stream: writes the request and routes every event with
/// `request.id` to `channel` until `done` or `service_stream_stop`. Returns
/// right after writing; a stream may stay silent for a long time.
#[tauri::command]
pub async fn service_stream_start(
    app: AppHandle,
    state: tauri::State<'_, ServiceRegistry>,
    request: ServiceRequest,
    channel: Channel<serde_json::Value>,
) -> Result<(), String> {
    if let Some(reason) = reject_reason(&request) {
        return Err(reason);
    }
    let running = get_or_spawn(&app, &state, &request.bin).await?;
    let line = encode(&request)?;

    running
        .waiters
        .lock()
        .unwrap()
        .insert(request.id.clone(), Waiter::Stream(Box::new(ChannelSink(channel))));

    if let Err(e) = write_line(&running, &line).await {
        running.waiters.lock().unwrap().remove(&request.id);
        return Err(e);
    }
    Ok(())
}

/// Stops routing events for one stream. The sidecar is not notified; a
/// sidecar that needs cleanup should expose its own method (e.g.
/// `unsubscribe`) for the client to call first.
#[tauri::command]
pub async fn service_stream_stop(
    state: tauri::State<'_, ServiceRegistry>,
    bin: String,
    id: String,
) -> Result<(), String> {
    if let Some(running) = state.running.lock().await.get(&bin) {
        running.waiters.lock().unwrap().remove(&id);
    }
    Ok(())
}

#[tauri::command]
pub async fn service_stop(state: tauri::State<'_, ServiceRegistry>, bin: String) -> Result<(), String> {
    if let Some(running) = state.running.lock().await.remove(&bin) {
        kill(running).await;
    }
    Ok(())
}

async fn kill(running: Arc<RunningSidecar>) {
    // Closing stdin lets a well-behaved sidecar exit on its own.
    drop(running.stdin.lock().await);
    let _ = running.child.lock().await.kill().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(bin: &str, protocol: u32) -> ServiceRequest {
        ServiceRequest {
            protocol,
            id: "1".into(),
            plugin: "demo".into(),
            bin: bin.into(),
            method: "ping".into(),
            params: serde_json::Value::Null,
        }
    }

    #[test]
    fn service_data_dir_is_per_bin() {
        let root = std::path::Path::new("/app-data");
        assert_eq!(service_data_dir(root, "devtool-svc-redis"), root.join("service-data").join("devtool-svc-redis"));
        // Different sidecars never share a directory.
        assert_ne!(
            service_data_dir(root, "devtool-svc-redis"),
            service_data_dir(root, "devtool-svc-kafka"),
        );
    }

    #[test]
    fn rejects_names_that_cannot_be_sidecars() {
        // A name that could escape the services directory never reaches the
        // consent prompt.
        for bad in ["/bin/sh", "sh", "devtool-svc-", "devtool-svc-../x", "devtool-svc-a/b", "devtool-svc-A", "devtool-svc--x", "devtool-svc-x-"] {
            let reason = reject_reason(&request(bad, SERVICE_PROTOCOL)).unwrap_or_else(|| panic!("{bad} phải bị từ chối"));
            assert!(reason.contains("allowlist"), "{reason}");
        }
    }

    #[test]
    fn valid_name_outside_allowlist_goes_to_consent() {
        // Not rejected outright: the user decides (service_trust).
        assert!(reject_reason(&request("devtool-svc-service-list-automation", SERVICE_PROTOCOL)).is_none());
        assert!(!ALLOWED_SERVICES.contains(&"devtool-svc-service-list-automation"));
        assert!(is_valid_service_name("devtool-svc-redis"));
    }

    // ── ensure_trusted_with: the consent decision, end to end, without an app ──

    fn fake_installed_sidecar(bin: &str, contents: &[u8]) -> (std::path::PathBuf, std::path::PathBuf) {
        let root = temp_dir("trust");
        let bin_path = root.join(bin);
        std::fs::write(&bin_path, contents).unwrap();
        let extensions = root.join("extensions");
        std::fs::create_dir_all(&extensions).unwrap();
        write_fake_service_index(&extensions, bin, &bin_path);
        (root, extensions)
    }

    fn memory_trust() -> crate::service_trust::ServiceTrust {
        crate::service_trust::ServiceTrust::new(Box::new(crate::service_trust::MemoryBackend::default()))
    }

    #[tokio::test]
    async fn bundled_sidecar_never_asks() {
        let trust = memory_trust();
        // Not even a file is needed: a bundled name never reaches the question.
        let nowhere = std::path::Path::new("/nonexistent");
        let r = ensure_trusted_with(&trust, "devtool-svc-echo", None, nowhere, None, None, |_| async {
            panic!("must not ask for a bundled sidecar")
        })
        .await;
        assert!(r.is_ok());
    }

    #[tokio::test]
    async fn installed_sidecar_asks_once_with_full_dialog() {
        let bin = "devtool-svc-trusttest";
        let (root, extensions) = fake_installed_sidecar(bin, b"binary v1");
        let trust = memory_trust();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));

        for _ in 0..2 {
            let seen = seen.clone();
            ensure_trusted_with(&trust, bin, Some(&extensions), &root, None, None, move |d| async move {
                seen.lock().unwrap().push(d);
                true
            })
            .await
            .unwrap();
        }
        let dialogs = seen.lock().unwrap();
        assert_eq!(dialogs.len(), 1, "allowed once, then remembered");
        assert_eq!(dialogs[0].title, "Allow “trusttest” to run?");
        let sha = crate::artifact_installer::sha256_hex(b"binary v1");
        assert!(dialogs[0].message.contains(&sha[..12]), "{}", dialogs[0].message);
        assert!(dialogs[0].message.contains("Source:"), "the install source comes from the index");
    }

    #[tokio::test]
    async fn denied_sidecar_does_not_run_and_changed_file_asks_again() {
        let bin = "devtool-svc-trusttest2";
        let (root, extensions) = fake_installed_sidecar(bin, b"v1");
        let trust = memory_trust();
        let denied = ensure_trusted_with(&trust, bin, Some(&extensions), &root, None, None, |_| async { false }).await;
        assert!(denied.unwrap_err().contains("từ chối"));

        ensure_trusted_with(&trust, bin, Some(&extensions), &root, None, None, |_| async { true }).await.unwrap();
        // Same name, new bytes: the earlier answer does not carry over.
        std::fs::write(root.join(bin), b"v2").unwrap();
        let asked = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let a = asked.clone();
        ensure_trusted_with(&trust, bin, Some(&extensions), &root, None, None, move |_| async move {
            a.store(true, std::sync::atomic::Ordering::SeqCst);
            true
        })
        .await
        .unwrap();
        assert!(asked.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[tokio::test]
    async fn missing_sidecar_fails_without_prompt() {
        let trust = memory_trust();
        let empty = temp_dir("trust-missing");
        let r = ensure_trusted_with(&trust, "devtool-svc-khong-co", None, &empty, None, None, |_| async {
            panic!("nothing to ask about")
        })
        .await;
        assert!(r.is_err());
    }

    #[tokio::test]
    async fn consent_dialog_follows_app_language() {
        let bin = "devtool-svc-trusttest3";
        let (root, extensions) = fake_installed_sidecar(bin, b"x");
        std::fs::write(root.join("app-settings.json"), r#"{"devtool-locale":"vi"}"#).unwrap();
        let trust = memory_trust();
        let title = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let t = title.clone();
        ensure_trusted_with(&trust, bin, Some(&extensions), &root, Some(&root), None, move |d| async move {
            *t.lock().unwrap() = d.title;
            true
        })
        .await
        .unwrap();
        assert_eq!(*title.lock().unwrap(), "Cho phép “trusttest3” chạy?");
        assert_eq!(ui_locale_at(None), crate::service_trust::Locale::En);
        assert_eq!(ui_locale_at(Some(&temp_dir("no-settings"))), crate::service_trust::Locale::En);
    }

    #[test]
    fn protocol_is_checked_before_allowlist() {
        let reason = reject_reason(&request("/bin/sh", 99)).expect("phải bị từ chối");
        assert!(reason.contains("protocol"), "{reason}");
    }

    #[test]
    fn bundled_services_are_listed_in_external_bin() {
        // A bundled entry missing from bundle.externalBin works on a dev
        // machine but fails for users. Only bundled services are checked;
        // URL-installed ones are intentionally absent.
        let conf = include_str!("../tauri.conf.json");
        for bin in BUNDLED_SERVICES {
            assert!(
                conf.contains(&format!("binaries/{bin}")),
                "\"{bin}\" nằm trong ALLOWED_SERVICES nhưng thiếu trong bundle.externalBin"
            );
        }
    }

    /// `cat` echoes the request line, which already has `protocol` and `id`,
    /// so it behaves as a valid sidecar.
    #[cfg(unix)]
    #[tokio::test]
    async fn round_trip_through_real_pipe() {
        let mut cmd = Command::new("cat");
        let running = spawn_process(&mut cmd, || {}).expect("spawn cat");

        let req = request("cat", SERVICE_PROTOCOL);
        let response = call_once(&running, &req, Duration::from_secs(5)).await;

        assert_eq!(response.id, "1");
        assert_eq!(response.protocol, SERVICE_PROTOCOL);
        assert!(response.error.is_none(), "{response:?}");
        kill(running).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn concurrent_calls_get_their_own_responses() {
        // `cat` echoes each line, so each id must get its own response even
        // when sent at the same time.
        let mut cmd = Command::new("cat");
        let running = spawn_process(&mut cmd, || {}).expect("spawn cat");

        let mut a = request("cat", SERVICE_PROTOCOL);
        a.id = "a".into();
        let mut b = request("cat", SERVICE_PROTOCOL);
        b.id = "b".into();

        let (ra, rb) = tokio::join!(
            call_once(&running, &a, Duration::from_secs(5)),
            call_once(&running, &b, Duration::from_secs(5)),
        );
        assert_eq!(ra.id, "a");
        assert_eq!(rb.id, "b");
        kill(running).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timeout_does_not_affect_other_calls() {
        // The first line is never answered and the second is echoed: a timed
        // out call must not affect the next one.
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg("read -r first; sleep 5 & read -r second; echo \"$second\"");
        let running = spawn_process(&mut cmd, || {}).expect("spawn sh");

        let mut a = request("sh", SERVICE_PROTOCOL);
        a.id = "cham".into();
        let err = call_once(&running, &a, Duration::from_millis(200)).await;
        assert!(err.error.unwrap().contains("không trả lời"));

        let mut b = request("sh", SERVICE_PROTOCOL);
        b.id = "nhanh".into();
        let ok = call_once(&running, &b, Duration::from_secs(5)).await;
        assert_eq!(ok.id, "nhanh");
        assert!(ok.error.is_none());

        kill(running).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn exited_sidecar_fails_call_without_hanging() {
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg("exit 0");
        let running = spawn_process(&mut cmd, || {}).expect("spawn sh");

        let req = request("sh", SERVICE_PROTOCOL);
        let response = call_once(&running, &req, Duration::from_secs(5)).await;
        assert!(response.error.is_some());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn malformed_json_stops_reader_and_fails_pending_call() {
        // A non-JSON line stops the reader.
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg("read -r _; printf 'khong-phai-json\\n'");
        let running = spawn_process(&mut cmd, || {}).expect("spawn sh");

        let req = request("sh", SERVICE_PROTOCOL);
        let response = call_once(&running, &req, Duration::from_secs(5)).await;
        assert!(response.error.is_some());
    }

    /// In-memory replacement for `tauri::ipc::Channel`.
    struct CollectSink(Arc<StdMutex<Vec<serde_json::Value>>>);
    impl EventSink for CollectSink {
        fn send(&self, value: serde_json::Value) {
            self.0.lock().unwrap().push(value);
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stream_receives_events_until_done() {
        // Fake sidecar: read one line, emit two events and `done` for its id.
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg(
            r#"read -r _; \
               printf '{"protocol":1,"id":"s","stream":true,"result":1}\n'; \
               printf '{"protocol":1,"id":"s","stream":true,"result":2}\n'; \
               printf '{"protocol":1,"id":"s","stream":true,"done":true}\n'"#,
        );
        let running = spawn_process(&mut cmd, || {}).expect("spawn sh");

        let collected = Arc::new(StdMutex::new(Vec::new()));
        let mut req = request("sh", SERVICE_PROTOCOL);
        req.id = "s".into();
        let line = encode(&req).unwrap();
        running
            .waiters
            .lock()
            .unwrap()
            .insert(req.id.clone(), Waiter::Stream(Box::new(CollectSink(collected.clone()))));
        write_line(&running, &line).await.unwrap();

        // Poll until the waiter is removed instead of a fixed sleep.
        for _ in 0..100 {
            if !running.waiters.lock().unwrap().contains_key("s") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(!running.waiters.lock().unwrap().contains_key("s"), "waiter phải tự gỡ sau done");
        assert_eq!(*collected.lock().unwrap(), vec![serde_json::json!(1), serde_json::json!(2)]);
        kill(running).await;
    }

    #[test]
    fn stopped_stream_receives_no_events() {
        let waiters: Waiters = Arc::default();
        let collected = Arc::new(StdMutex::new(Vec::new()));
        waiters
            .lock()
            .unwrap()
            .insert("s".into(), Waiter::Stream(Box::new(CollectSink(collected.clone()))));

        // Simulates `service_stream_stop`.
        waiters.lock().unwrap().remove("s");

        dispatch(
            &waiters,
            ServiceResponse { protocol: SERVICE_PROTOCOL, id: "s".into(), result: Some(serde_json::json!(1)), error: None, stream: true, done: false },
        );
        assert!(collected.lock().unwrap().is_empty(), "đã dừng thì không còn nhận sự kiện nào nữa");
    }

    #[test]
    fn late_response_without_waiter_is_dropped() {
        // A late response matches no waiter.
        let waiters: Waiters = Arc::default();
        dispatch(&waiters, ServiceResponse::err("khong-ai-cho", "trễ"));
        assert!(waiters.lock().unwrap().is_empty());
    }

    #[test]
    fn response_omits_empty_fields() {
        let json = serde_json::to_string(&ServiceResponse::err("7", "hỏng")).unwrap();
        assert!(json.contains("\"error\":\"hỏng\""), "{json}");
        assert!(!json.contains("result"));
        assert!(!json.contains("stream"));
        assert!(!json.contains("done"));
    }

    // -- sidecar_path: installed copy first, bundled copy second -------------

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("devtool-sidecar-path-test-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Writes an `extensions/index.json` using artifact_installer's own types.
    fn write_fake_service_index(extensions_dir: &std::path::Path, bin: &str, bin_path: &std::path::Path) {
        let mut targets = HashMap::new();
        targets.insert(
            crate::artifact_installer::current_target_triple(),
            crate::artifact_installer::ServiceTarget { url: "https://x/bin".into(), sha256: "0".repeat(64) },
        );
        let record = crate::artifact_installer::InstalledArtifactRecord::Service(
            crate::artifact_installer::InstalledServiceRecord {
                manifest: crate::artifact_installer::RemoteServiceManifest {
                    bin: bin.into(),
                    version: "1.0.0".into(),
                    protocol: SERVICE_PROTOCOL,
                    targets,
                },
                source_url: "https://x/svc.json".into(),
                bin_path: bin_path.to_string_lossy().into_owned(),
                installed_at: 1,
                market_id: None,
            },
        );
        std::fs::write(
            extensions_dir.join("index.json"),
            serde_json::to_string_pretty(&vec![record]).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn installed_copy_wins_over_bundled_copy() {
        let extensions_dir = temp_dir("extensions");
        let beside_dir = temp_dir("beside-exe");
        let installed_bin = temp_dir("installed-bin-dir").join("devtool-svc-demo");
        std::fs::write(&installed_bin, b"noi dung ban tai ve").unwrap();
        // Different contents beside the exe so picking the wrong copy shows.
        std::fs::write(beside_dir.join("devtool-svc-demo"), b"noi dung ban canh exe").unwrap();
        write_fake_service_index(&extensions_dir, "devtool-svc-demo", &installed_bin);

        let resolved = resolve_sidecar_path(Some(&extensions_dir), &beside_dir, "devtool-svc-demo").unwrap();
        assert_eq!(resolved, installed_bin);
    }

    #[test]
    fn without_installed_copy_uses_bundled_copy() {
        let extensions_dir = temp_dir("extensions-empty");
        let beside_dir = temp_dir("beside-exe-only");
        let beside_bin = beside_dir.join("devtool-svc-demo");
        std::fs::write(&beside_bin, b"ban dong goi san").unwrap();

        let resolved = resolve_sidecar_path(Some(&extensions_dir), &beside_dir, "devtool-svc-demo").unwrap();
        assert_eq!(resolved, beside_bin);
    }

    #[test]
    fn missing_everywhere_returns_error() {
        let extensions_dir = temp_dir("extensions-empty-2");
        let beside_dir = temp_dir("beside-empty");
        let err = resolve_sidecar_path(Some(&extensions_dir), &beside_dir, "devtool-svc-khong-ton-tai").unwrap_err();
        assert!(err.contains("Không thấy sidecar"), "{err}");
    }

    #[test]
    fn missing_installed_file_falls_back_to_bundled_copy() {
        // The index points at a missing file: fall back to the bundled copy.
        let extensions_dir = temp_dir("extensions-dangling");
        let beside_dir = temp_dir("beside-fallback");
        let beside_bin = beside_dir.join("devtool-svc-demo");
        std::fs::write(&beside_bin, b"ban dong goi san").unwrap();
        let missing = temp_dir("missing-parent").join("devtool-svc-demo");
        write_fake_service_index(&extensions_dir, "devtool-svc-demo", &missing);

        let resolved = resolve_sidecar_path(Some(&extensions_dir), &beside_dir, "devtool-svc-demo").unwrap();
        assert_eq!(resolved, beside_bin);
    }

    /// Installs a fake binary (an `sh` script running `cat`), resolves it, and
    /// calls it through `spawn_process`/`call_once`.
    #[cfg(unix)]
    #[tokio::test]
    async fn installed_fake_sidecar_resolves_and_answers() {
        use std::os::unix::fs::PermissionsExt;

        let extensions_dir = temp_dir("rt-extensions");
        let beside_dir = temp_dir("rt-beside");
        let bin_dir = temp_dir("rt-bin-dir");
        let installed_bin = bin_dir.join("devtool-svc-demo");
        std::fs::write(&installed_bin, "#!/bin/sh\ncat\n").unwrap();
        let mut perms = std::fs::metadata(&installed_bin).unwrap().permissions();
        perms.set_mode(perms.mode() | 0o111);
        std::fs::set_permissions(&installed_bin, perms).unwrap();
        write_fake_service_index(&extensions_dir, "devtool-svc-demo", &installed_bin);

        let resolved = resolve_sidecar_path(Some(&extensions_dir), &beside_dir, "devtool-svc-demo").unwrap();
        assert_eq!(resolved, installed_bin);

        let mut cmd = Command::new(&resolved);
        let running = spawn_process(&mut cmd, || {}).expect("spawn binary vừa cài");
        let req = request("devtool-svc-demo", SERVICE_PROTOCOL);
        let response = call_once(&running, &req, Duration::from_secs(5)).await;
        assert_eq!(response.id, "1");
        assert!(response.error.is_none(), "{response:?}");
        kill(running).await;
    }
}
