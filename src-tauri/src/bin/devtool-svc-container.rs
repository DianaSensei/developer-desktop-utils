// Plugin dịch vụ (tier B) cho Container Manager — Bước 1 của Phase 2 (xem
// docs/decisions/platform-plugin-architecture.md, mục "Ba tier" và "Cách ly
// dữ liệu"). Port từ src-tauri/src/container_tool.rs, giữ nguyên HÌNH DẠNG dữ
// liệu (JSON camelCase, struct `ContainerConnection`) nhưng KHÔNG đụng file
// đó — nó vẫn chạy production (Tier A) song song cho tới Bước 4/5 cắt hẳn,
// đúng mẫu `devtool-svc-redis.rs` đã làm cho Redis.
//
// Khác với bản Tier A (`container_tool.rs`) đúng những chỗ là hệ quả của việc
// chạy như tiến trình riêng, không có `AppHandle`:
//   - Config CRUD đọc/ghi `<DEVTOOL_SERVICE_DATA_DIR>/connections.json` (biến
//     môi trường `service_host.rs::get_or_spawn` set khi spawn) thay vì
//     `plugin_data::plugin_data_dir(app, "container-manager")` — thư mục này
//     ĐÃ được cách ly riêng cho sidecar này
//     (`<app_data>/service-data/devtool-svc-container/`), KHÁC
//     `plugin-data/container-manager/connections.json` mà Tier A dùng, có
//     chủ ý — xem "Cách ly dữ liệu" trong ADR. KHÔNG di trú dữ liệu cũ: chỉ
//     là cấu hình kết nối (socket path), người dùng tự nhập lại được.
//   - main() spawn một task async cho mỗi dòng stdin vào, một task riêng sở
//     hữu stdout qua kênh mpsc — y hệt cấu trúc `devtool-svc-redis.rs`, vì
//     nhiều lời gọi có thể chồng lên nhau trên CÙNG một sidecar (host demux
//     theo `id`, xem `service_host.rs`).
//
// Bước 1 (đây): config CRUD, detect-sockets, test-connection, list/inspect,
// lifecycle (start/stop/restart/pause/unpause/remove) — mọi method ở đây là
// MỘT-LẦN (đi qua `handle()`), không có method stream nào trong bước này.
// Bước 2 (sau): image/volume/network/prune/system-info. Bước 3 (sau):
// log/stats streaming (sẽ cần giao thức STREAM giống `pubsub-subscribe` của
// devtool-svc-redis — lỗi giữa chừng của method stream phải tự mã hoá vào
// giao thức ứng dụng của chính sidecar này, KHÔNG dùng `Response::err`, xem
// comment `send_pubsub_error` ở devtool-svc-redis.rs để hiểu lý do).

use bollard::Docker;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;
use uuid::Uuid;

const SERVICE_PROTOCOL: u32 = 1;

// ── Khung tin nhắn (giống devtool-svc-redis, lặp lại có chủ ý — xem lý do ở đó) ─

#[derive(Deserialize)]
struct Request {
    protocol: u32,
    id: String,
    #[serde(default)]
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Serialize)]
struct Response {
    protocol: u32,
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    stream: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    done: bool,
}

impl Response {
    fn once(id: String, result: serde_json::Value) -> Self {
        Self { protocol: SERVICE_PROTOCOL, id, result: Some(result), error: None, stream: false, done: false }
    }
    fn ok(id: String) -> Self {
        Self::once(id, serde_json::Value::Null)
    }
    fn err(id: String, message: impl Into<String>) -> Self {
        Self { protocol: SERVICE_PROTOCOL, id, result: None, error: Some(message.into()), stream: false, done: false }
    }
}

// ── Connection profile — giữ nguyên hình dạng camelCase của container_tool.rs ─

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerConnection {
    pub id: String,
    pub name: String,
    /// Raw filesystem path to the daemon socket (unix) or the pipe name
    /// (windows) — no `unix://`/`npipe://` scheme prefix, giống hệt
    /// container_tool.rs.
    pub socket_path: String,
}

// ── Config persistence ───────────────────────────────────────────────────────
//
// Lưu trong thư mục RIÊNG của sidecar này (`DEVTOOL_SERVICE_DATA_DIR` —
// `<app_data>/service-data/devtool-svc-container/`), KHÁC
// `plugin-data/container-manager/connections.json` mà `container_tool.rs`
// (Tier A, vẫn đang chạy song song) đang dùng. Cách ly bằng thư mục, không
// phải bằng tên file — xem module doc comment ở trên và ADR mục "Cách ly dữ
// liệu".

fn app_data_dir() -> Result<PathBuf, String> {
    std::env::var("DEVTOOL_SERVICE_DATA_DIR")
        .map(PathBuf::from)
        .map_err(|_| "DEVTOOL_SERVICE_DATA_DIR không được set — sidecar phải chạy qua service_host.rs".to_string())
}

fn configs_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("connections.json"))
}

fn load_configs() -> Vec<ContainerConnection> {
    let Ok(path) = configs_path() else { return Vec::new() };
    std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_configs(configs: &[ContainerConnection]) -> Result<(), String> {
    let path = configs_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(configs).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn find_config(config_id: &str) -> Result<ContainerConnection, String> {
    load_configs().into_iter().find(|c| c.id == config_id).ok_or_else(|| format!("Connection '{}' not found", config_id))
}

// ── Socket auto-detect — port nguyên vẹn từ container_tool.rs ──────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedSocket {
    pub label: String,
    pub socket_path: String,
}

/// Best-effort probe of the well-known socket locations used by colima,
/// Docker Desktop, Rancher Desktop, OrbStack and Podman machine — port
/// nguyên vẹn từ `container_tool::container_detect_sockets`, xem đó cho chú
/// thích đầy đủ.
fn detect_sockets() -> Vec<DetectedSocket> {
    let mut found = Vec::new();

    if let Ok(host) = std::env::var("DOCKER_HOST") {
        let path = host
            .strip_prefix("unix://")
            .or_else(|| host.strip_prefix("npipe://"))
            .unwrap_or(&host);
        if !path.is_empty() {
            found.push(DetectedSocket { label: "DOCKER_HOST env".to_string(), socket_path: path.to_string() });
        }
    }

    #[cfg(unix)]
    {
        let home = dirs_home();
        let candidates: Vec<(String, std::path::PathBuf)> = {
            let mut v = vec![
                ("Docker Desktop".to_string(), home.join(".docker/run/docker.sock")),
                ("System default".to_string(), std::path::PathBuf::from("/var/run/docker.sock")),
                ("Rancher Desktop".to_string(), home.join(".rd/docker.sock")),
                ("OrbStack".to_string(), home.join(".orbstack/run/docker.sock")),
                (
                    "Podman machine".to_string(),
                    home.join(".local/share/containers/podman/machine/podman.sock"),
                ),
            ];
            // Colima profiles live under ~/.colima/<profile>/docker.sock — glob them.
            if let Ok(entries) = std::fs::read_dir(home.join(".colima")) {
                for entry in entries.flatten() {
                    let profile_sock = entry.path().join("docker.sock");
                    if profile_sock.exists() {
                        let profile = entry.file_name().to_string_lossy().to_string();
                        v.push((format!("Colima ({profile})"), profile_sock));
                    }
                }
            }
            v
        };
        for (label, path) in candidates {
            if path.exists() {
                found.push(DetectedSocket { label, socket_path: path.to_string_lossy().to_string() });
            }
        }
    }

    #[cfg(windows)]
    {
        // Named pipes can't be cheaply `exists()`-checked without opening them,
        // so just offer the well-known pipe names as candidates.
        found.push(DetectedSocket {
            label: "Docker Desktop".to_string(),
            socket_path: r"\\.\pipe\docker_engine".to_string(),
        });
        found.push(DetectedSocket {
            label: "Rancher Desktop".to_string(),
            socket_path: r"\\.\pipe\rancher_desktop_engine".to_string(),
        });
    }

    found
}

#[cfg(unix)]
fn dirs_home() -> std::path::PathBuf {
    std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_default()
}

/// Expands a leading `~` (or `~/...`) to the user's home directory — port
/// nguyên vẹn từ `container_tool::expand_socket_path`.
#[cfg(unix)]
fn expand_socket_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        let home = dirs_home();
        if !home.as_os_str().is_empty() {
            return home.join(rest).to_string_lossy().to_string();
        }
    } else if path == "~" {
        let home = dirs_home();
        if !home.as_os_str().is_empty() {
            return home.to_string_lossy().to_string();
        }
    }
    path.to_string()
}

#[cfg(windows)]
fn expand_socket_path(path: &str) -> String {
    path.to_string()
}

// ── Connect — port nguyên vẹn từ container_tool.rs ──────────────────────────

const CONNECT_TIMEOUT_SECS: u64 = 6;

#[cfg(unix)]
fn connect(c: &ContainerConnection) -> Result<Docker, String> {
    let path = expand_socket_path(&c.socket_path);
    Docker::connect_with_unix(&path, CONNECT_TIMEOUT_SECS, bollard::API_DEFAULT_VERSION)
        .map_err(|e| e.to_string())
}

#[cfg(windows)]
fn connect(c: &ContainerConnection) -> Result<Docker, String> {
    Docker::connect_with_named_pipe(&c.socket_path, CONNECT_TIMEOUT_SECS, bollard::API_DEFAULT_VERSION)
        .map_err(|e| e.to_string())
}

// ── Params helpers — giống devtool-svc-redis.rs ─────────────────────────────

fn param<T: serde::de::DeserializeOwned>(params: &serde_json::Value, field: &str) -> Result<T, String> {
    params
        .get(field)
        .cloned()
        .ok_or_else(|| format!("thiếu tham số \"{field}\""))
        .and_then(|v| serde_json::from_value(v).map_err(|e| format!("tham số \"{field}\" sai kiểu: {e}")))
}

fn opt_param<T: serde::de::DeserializeOwned>(params: &serde_json::Value, field: &str) -> Option<T> {
    params.get(field).cloned().and_then(|v| serde_json::from_value(v).ok())
}

// ── Method dispatch ───────────────────────────────────────────────────────────

async fn handle(method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
    match method {
        "list-configs" => Ok(serde_json::to_value(load_configs()).unwrap()),

        "save-config" => {
            let mut config: ContainerConnection = param(&params, "config")?;
            if config.id.is_empty() {
                config.id = Uuid::new_v4().to_string();
            }
            let mut configs = load_configs();
            if let Some(pos) = configs.iter().position(|c| c.id == config.id) {
                configs[pos] = config.clone();
            } else {
                configs.push(config.clone());
            }
            save_configs(&configs)?;
            Ok(serde_json::to_value(config).unwrap())
        }

        "delete-config" => {
            let config_id: String = param(&params, "configId")?;
            let mut configs = load_configs();
            configs.retain(|c| c.id != config_id);
            save_configs(&configs)?;
            Ok(serde_json::Value::Null)
        }

        "detect-sockets" => Ok(serde_json::to_value(detect_sockets()).unwrap()),

        "test-connection" => {
            let config: ContainerConnection = param(&params, "config")?;
            let docker = connect(&config)?;
            docker.ping().await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        "list" => {
            let config_id: String = param(&params, "configId")?;
            let all: bool = opt_param(&params, "all").unwrap_or(false);
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let opts = bollard::query_parameters::ListContainersOptions { all, ..Default::default() };
            let containers = docker.list_containers(Some(opts)).await.map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(containers).unwrap())
        }

        "inspect" => {
            let config_id: String = param(&params, "configId")?;
            let container_id: String = param(&params, "containerId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let insp = docker.inspect_container(&container_id, None).await.map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(insp).unwrap())
        }

        "start" => {
            let config_id: String = param(&params, "configId")?;
            let container_id: String = param(&params, "containerId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            docker.start_container(&container_id, None).await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        "stop" => {
            let config_id: String = param(&params, "configId")?;
            let container_id: String = param(&params, "containerId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            docker.stop_container(&container_id, None).await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        "restart" => {
            let config_id: String = param(&params, "configId")?;
            let container_id: String = param(&params, "containerId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            docker.restart_container(&container_id, None).await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        "pause" => {
            let config_id: String = param(&params, "configId")?;
            let container_id: String = param(&params, "containerId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            docker.pause_container(&container_id).await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        "unpause" => {
            let config_id: String = param(&params, "configId")?;
            let container_id: String = param(&params, "containerId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            docker.unpause_container(&container_id).await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        "remove" => {
            let config_id: String = param(&params, "configId")?;
            let container_id: String = param(&params, "containerId")?;
            let force: bool = opt_param(&params, "force").unwrap_or(false);
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let opts = bollard::query_parameters::RemoveContainerOptions { force, ..Default::default() };
            docker.remove_container(&container_id, Some(opts)).await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        other => Err(format!("method không hỗ trợ: \"{other}\"")),
    }
}

// ── main: đọc stdin, spawn một task async cho mỗi dòng, một task khác sở hữu
//    stdout để mọi phản hồi ghi ra không bị xen lẫn giữa hai task — y hệt
//    cấu trúc devtool-svc-redis.rs. ─────────────────────────────────────────

#[tokio::main]
async fn main() {
    let (tx, mut rx) = mpsc::unbounded_channel::<Response>();

    let writer = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(response) = rx.recv().await {
            let Ok(json) = serde_json::to_string(&response) else { continue };
            if stdout.write_all(json.as_bytes()).await.is_err() { break; }
            if stdout.write_all(b"\n").await.is_err() { break; }
            if stdout.flush().await.is_err() { break; }
        }
    });

    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let tx = tx.clone();
        tokio::spawn(async move {
            handle_line(&line, &tx).await;
        });
    }

    drop(tx);
    let _ = writer.await;
}

async fn handle_line(line: &str, tx: &mpsc::UnboundedSender<Response>) {
    let req: Request = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => {
            let _ = tx.send(Response::err(String::new(), format!("JSON không hợp lệ: {e}")));
            return;
        }
    };
    if req.protocol != SERVICE_PROTOCOL {
        let _ = tx.send(Response::err(req.id, format!("lệch protocol: client {}, sidecar {SERVICE_PROTOCOL}", req.protocol)));
        return;
    }
    let response = match handle(&req.method, req.params).await {
        Ok(value) if value.is_null() => Response::ok(req.id),
        Ok(value) => Response::once(req.id, value),
        Err(e) => Response::err(req.id, e),
    };
    let _ = tx.send(response);
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Test riêng cho phần hạ tầng chỉ có ở sidecar (không có trong container_tool.rs) ─

    #[test]
    fn app_data_dir_bao_loi_ro_rang_khi_thieu_bien_moi_truong() {
        // Không set biến môi trường trong test này — nhưng test khác trong
        // cùng binary CÓ THỂ chạy song song và set nó, nên chỉ assert khi
        // biến thực sự vắng mặt để tránh test chập chờn.
        if std::env::var("DEVTOOL_SERVICE_DATA_DIR").is_err() {
            assert!(app_data_dir().unwrap_err().contains("DEVTOOL_SERVICE_DATA_DIR"));
        }
    }

    #[cfg(unix)]
    #[test]
    fn expand_socket_path_mo_rong_tilde() {
        if let Some(home) = std::env::var_os("HOME") {
            let home = std::path::PathBuf::from(home);
            assert_eq!(expand_socket_path("~/docker.sock"), home.join("docker.sock").to_string_lossy());
            assert_eq!(expand_socket_path("~"), home.to_string_lossy());
        }
    }

    #[cfg(unix)]
    #[test]
    fn expand_socket_path_khong_dung_giu_nguyen() {
        assert_eq!(expand_socket_path("/var/run/docker.sock"), "/var/run/docker.sock");
    }

    #[tokio::test]
    async fn method_khong_ho_tro_tra_ve_loi_khong_phai_panic() {
        let res = handle("khong-ton-tai", serde_json::Value::Null).await;
        assert!(res.unwrap_err().contains("khong-ton-tai"));
    }

    #[tokio::test]
    async fn thieu_tham_so_bat_buoc_tra_ve_loi_ro_rang() {
        let res = handle("inspect", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("configId"));
    }

    #[tokio::test]
    async fn config_id_khong_ton_tai_tra_ve_loi_ro_rang() {
        // configs_path() phụ thuộc DEVTOOL_SERVICE_DATA_DIR; nếu thiếu, load_configs()
        // rơi về rỗng và find_config vẫn phải trả lỗi rõ ràng, không panic.
        let res = handle("inspect", serde_json::json!({ "configId": "khong-ton-tai", "containerId": "x" })).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn list_thieu_config_id_tra_ve_loi_ro_rang() {
        let res = handle("list", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("configId"));
    }

    #[tokio::test]
    async fn start_thieu_container_id_tra_ve_loi_ro_rang() {
        let res = handle("start", serde_json::json!({ "configId": "x" })).await;
        assert!(res.unwrap_err().contains("containerId"));
    }

    #[test]
    fn detect_sockets_khong_panic_va_tra_ve_vec() {
        // Best-effort probe, không đảm bảo tìm thấy gì trên máy CI — chỉ cần
        // không panic và trả về một Vec hợp lệ (có thể rỗng).
        let found = detect_sockets();
        assert!(found.len() < 1000); // sanity: không phải giá trị rác/loop vô hạn
    }

    /// `handle_line` trả về qua kênh `tx` — test dựng một kênh riêng và đọc
    /// lại đúng một `Response`, giống mẫu ở devtool-svc-redis.rs.
    async fn call_handle_line(line: &str) -> Response {
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_line(line, &tx).await;
        drop(tx);
        rx.recv().await.expect("handle_line phải gửi đúng một response")
    }

    #[tokio::test]
    async fn handle_line_tra_response_hop_le_cho_method_mot_lan() {
        let line = serde_json::json!({
            "protocol": SERVICE_PROTOCOL, "id": "1", "method": "delete-config",
            "params": { "configId": "khong-quan-trong" },
        })
        .to_string();
        let response = call_handle_line(&line).await;
        assert_eq!(response.id, "1");
        assert_eq!(response.protocol, SERVICE_PROTOCOL);
    }

    #[tokio::test]
    async fn lech_protocol_bi_tu_choi_truoc_khi_cham_toi_method() {
        let line = serde_json::json!({ "protocol": 99, "id": "1", "method": "list-configs", "params": null }).to_string();
        let response = call_handle_line(&line).await;
        assert!(response.error.unwrap().contains("lệch protocol"));
    }

    #[tokio::test]
    async fn json_hong_khong_panic_tra_ve_loi() {
        let response = call_handle_line("{khong-phai-json").await;
        assert!(response.error.unwrap().contains("JSON không hợp lệ"));
    }

    #[tokio::test]
    async fn method_la_tra_ve_loi_ro_rang() {
        let line = serde_json::json!({ "protocol": SERVICE_PROTOCOL, "id": "9", "method": "khong-ton-tai", "params": null }).to_string();
        let response = call_handle_line(&line).await;
        assert!(response.error.unwrap().contains("khong-ton-tai"));
    }
}
