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
// Bước 1 (xong): config CRUD, detect-sockets, test-connection, list/inspect,
// lifecycle (start/stop/restart/pause/unpause/remove) — mọi method ở đây là
// MỘT-LẦN (đi qua `handle()`), không có method stream nào trong bước này.
// Bước 2 (xong): container details/resources, image/volume/network CRUD +
// details, prune, system info/df — vẫn toàn method MỘT-LẦN, port nguyên vẹn
// logic từ `container_tool.rs` (không đoán lại).
// Bước 3 (đây): log/stats streaming, port nguyên vẹn từ
// `container_tool::container_logs_start`/`container_stats_start`/
// `container_stats_snapshot` (xem đó, dòng ~627-833). `logs-start` và
// `stats-start` là method STREAM (giao thức giống hệt `pubsub-subscribe` của
// devtool-svc-redis.rs: sự kiện đầu `{"type":"subscribed","subscriptionId":…}`,
// lỗi giữa chừng đi qua như một SỰ KIỆN STREAM bình thường KHÔNG BAO GIỜ dùng
// `Response::err`, xem comment `send_pubsub_error` ở đó để hiểu đầy đủ lý do
// — sidecar này port lại thành `send_stream_error`). `logs-unsubscribe`/
// `stats-unsubscribe` là method một-lần mirror `unsubscribe` của Redis.
// `stats-snapshot` là method một-lần (KHÔNG phải stream) trả một lần
// `HashMap<containerId, StatsFrame>`. Registry nội bộ DÙNG CHUNG cho cả logs
// và stats (một `HashMap<subscriptionId, Notify>` duy nhất) — xem comment đầy
// đủ ở mục "Logs/Stats streaming" bên dưới cho lý do không tách hai registry.

use bollard::Docker;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
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
    /// Một-trong-nhiều sự kiện của cùng một lời gọi stream (`logs-start`/
    /// `stats-start`) — không bao giờ đi kèm `done: true` ở hai method này
    /// (một tail log/stats sống tới khi bị dừng tay bằng `*-unsubscribe`),
    /// giống hệt `Response::event` của devtool-svc-redis.rs.
    fn event(id: String, result: serde_json::Value) -> Self {
        Self { protocol: SERVICE_PROTOCOL, id, result: Some(result), error: None, stream: true, done: false }
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

// ── Container details (curated projection) — port nguyên vẹn từ
//    container_tool.rs, xem đó cho giải thích lý do curate thay vì passthrough ─

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerMountInfo {
    #[serde(rename = "type")]
    pub typ: Option<String>,
    pub name: Option<String>,
    pub source: Option<String>,
    pub destination: Option<String>,
    pub mode: Option<String>,
    pub rw: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerPortBinding {
    pub container_port: String,
    pub host_ip: Option<String>,
    pub host_port: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerNetworkInfo {
    pub name: String,
    pub ip_address: Option<String>,
    pub gateway: Option<String>,
    pub mac_address: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerResources {
    /// CPU quota in units of 1e-9 CPUs — `--cpus` as the daemon stores it.
    pub nano_cpus: Option<i64>,
    pub cpu_shares: Option<i64>,
    pub cpu_period: Option<i64>,
    pub cpu_quota: Option<i64>,
    pub cpuset_cpus: Option<String>,
    pub memory_bytes: Option<i64>,
    pub memory_reservation_bytes: Option<i64>,
    /// Total memory + swap. `-1` is docker's "unlimited swap" sentinel and is
    /// passed through as-is rather than normalised away.
    pub memory_swap_bytes: Option<i64>,
    pub blkio_weight: Option<u16>,
    pub pids_limit: Option<i64>,
    pub restart_policy: Option<String>,
    pub restart_max_retry: Option<i64>,
}

/// `0` is what the daemon reports for an unset limit; treat it as absent so
/// the form renders an empty field instead of a literal zero limit.
fn nonzero(v: Option<i64>) -> Option<i64> {
    v.filter(|&n| n != 0)
}

fn resources_from_host_config(hc: &bollard::models::HostConfig) -> ContainerResources {
    let restart_policy = hc.restart_policy.clone().unwrap_or_default();
    ContainerResources {
        nano_cpus: nonzero(hc.nano_cpus),
        cpu_shares: nonzero(hc.cpu_shares),
        cpu_period: nonzero(hc.cpu_period),
        cpu_quota: nonzero(hc.cpu_quota),
        cpuset_cpus: hc.cpuset_cpus.clone().filter(|s| !s.is_empty()),
        memory_bytes: nonzero(hc.memory),
        memory_reservation_bytes: nonzero(hc.memory_reservation),
        memory_swap_bytes: nonzero(hc.memory_swap),
        blkio_weight: hc.blkio_weight.filter(|&w| w != 0),
        pids_limit: nonzero(hc.pids_limit),
        restart_policy: restart_policy.name.map(|n| n.to_string()),
        restart_max_retry: restart_policy.maximum_retry_count,
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerDetails {
    pub id: String,
    pub name: String,
    pub image: String,
    pub platform: Option<String>,
    pub created: Option<String>,
    pub status: Option<String>,
    pub running: bool,
    pub paused: bool,
    pub restarting: bool,
    pub exit_code: Option<i64>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub health_status: Option<String>,
    pub command: Option<String>,
    pub entrypoint: Vec<String>,
    pub restart_policy: Option<String>,
    pub restart_max_retry: Option<i64>,
    pub env: Vec<String>,
    pub labels: HashMap<String, String>,
    pub mounts: Vec<ContainerMountInfo>,
    pub ports: Vec<ContainerPortBinding>,
    pub networks: Vec<ContainerNetworkInfo>,
    pub resources: ContainerResources,
}

async fn container_details(docker: &Docker, container_id: &str) -> Result<ContainerDetails, String> {
    let insp = docker.inspect_container(container_id, None).await.map_err(|e| e.to_string())?;

    let state = insp.state.unwrap_or_default();
    let cfg = insp.config.unwrap_or_default();
    let host_config = insp.host_config.unwrap_or_default();
    let net = insp.network_settings.unwrap_or_default();
    let resources = resources_from_host_config(&host_config);
    let restart_policy = host_config.restart_policy.unwrap_or_default();

    let mounts = insp
        .mounts
        .unwrap_or_default()
        .into_iter()
        .map(|m| ContainerMountInfo {
            typ: m.typ,
            name: m.name,
            source: m.source,
            destination: m.destination,
            mode: m.mode,
            rw: m.rw,
        })
        .collect();

    let ports = net
        .ports
        .unwrap_or_default()
        .into_iter()
        .flat_map(|(container_port, bindings)| {
            bindings.unwrap_or_default().into_iter().map(move |b| ContainerPortBinding {
                container_port: container_port.clone(),
                host_ip: b.host_ip,
                host_port: b.host_port,
            })
        })
        .collect();

    let mut networks: Vec<ContainerNetworkInfo> = net
        .networks
        .unwrap_or_default()
        .into_iter()
        .map(|(name, ep)| ContainerNetworkInfo {
            name,
            ip_address: ep.ip_address,
            gateway: ep.gateway,
            mac_address: ep.mac_address,
        })
        .collect();
    networks.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(ContainerDetails {
        id: insp.id.unwrap_or_default(),
        name: insp.name.unwrap_or_default().trim_start_matches('/').to_string(),
        image: insp.image.unwrap_or_default(),
        platform: insp.platform,
        created: insp.created,
        status: state.status.map(|s| s.to_string()),
        running: state.running.unwrap_or(false),
        paused: state.paused.unwrap_or(false),
        restarting: state.restarting.unwrap_or(false),
        exit_code: state.exit_code,
        started_at: state.started_at,
        finished_at: state.finished_at,
        health_status: state.health.and_then(|h| h.status).map(|s| s.to_string()),
        command: cfg.cmd.map(|c| c.join(" ")),
        entrypoint: cfg.entrypoint.unwrap_or_default(),
        restart_policy: restart_policy.name.map(|n| n.to_string()),
        restart_max_retry: restart_policy.maximum_retry_count,
        env: cfg.env.unwrap_or_default(),
        labels: cfg.labels.unwrap_or_default(),
        mounts,
        ports,
        networks,
        resources,
    })
}

// ── Resource management (docker update) — port nguyên vẹn từ container_tool.rs ─

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerResourceUpdate {
    pub nano_cpus: Option<i64>,
    pub cpu_shares: Option<i64>,
    pub cpu_period: Option<i64>,
    pub cpu_quota: Option<i64>,
    pub cpuset_cpus: Option<String>,
    pub memory_bytes: Option<i64>,
    pub memory_reservation_bytes: Option<i64>,
    pub memory_swap_bytes: Option<i64>,
    pub blkio_weight: Option<u16>,
    pub pids_limit: Option<i64>,
    pub restart_policy: Option<String>,
    pub restart_max_retry: Option<i64>,
}

fn restart_policy_from_name(name: &str, max_retry: Option<i64>) -> Result<bollard::models::RestartPolicy, String> {
    use bollard::models::RestartPolicyNameEnum as E;
    let variant = match name {
        "" => E::EMPTY,
        "no" => E::NO,
        "always" => E::ALWAYS,
        "unless-stopped" => E::UNLESS_STOPPED,
        "on-failure" => E::ON_FAILURE,
        other => return Err(format!("Unknown restart policy \"{other}\"")),
    };
    Ok(bollard::models::RestartPolicy {
        name: Some(variant),
        // Docker rejects a non-zero retry count on anything but on-failure.
        maximum_retry_count: if matches!(variant, E::ON_FAILURE) { max_retry.or(Some(0)) } else { Some(0) },
    })
}

// ── Images — port nguyên vẹn từ container_tool.rs ───────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullProgress {
    pub status: String,
    pub id: Option<String>,
    pub progress_current: Option<i64>,
    pub progress_total: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageDetails {
    pub id: String,
    pub repo_tags: Vec<String>,
    pub repo_digests: Vec<String>,
    pub created: Option<String>,
    pub size: i64,
    pub architecture: Option<String>,
    pub os: Option<String>,
    pub author: Option<String>,
    pub cmd: Vec<String>,
    pub entrypoint: Vec<String>,
    pub env: Vec<String>,
    pub working_dir: Option<String>,
    pub exposed_ports: Vec<String>,
    pub labels: HashMap<String, String>,
    pub layer_count: usize,
}

// ── Network / volume details (curated projections) — port nguyên vẹn ───────

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkIpamConfig {
    pub subnet: Option<String>,
    pub ip_range: Option<String>,
    pub gateway: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkDetails {
    pub id: String,
    pub name: String,
    pub driver: Option<String>,
    pub scope: Option<String>,
    pub created: Option<String>,
    pub internal: bool,
    pub attachable: bool,
    pub ingress: bool,
    pub ipv6: bool,
    pub ipam_driver: Option<String>,
    pub ipam_config: Vec<NetworkIpamConfig>,
    pub options: HashMap<String, String>,
    pub labels: HashMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeDetails {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub created_at: Option<String>,
    pub scope: Option<String>,
    pub labels: HashMap<String, String>,
    pub options: HashMap<String, String>,
    /// From the daemon's UsageData, which most drivers leave unset — `-1` is
    /// docker's own "not available" marker and is passed through as such.
    pub size_bytes: Option<i64>,
    pub ref_count: Option<i64>,
}

// ── Prune (reclaiming disk) — port nguyên vẹn. Một shape chung cho cả bốn
//    endpoint, xem container_tool.rs cho lý do gộp. ─────────────────────────

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneResult {
    pub deleted: usize,
    pub space_reclaimed: i64,
}

/// Per-volume disk usage (bytes), keyed by volume name — port nguyên vẹn từ
/// `container_tool::volume_sizes` (bản Unix). Raw request thủ công qua
/// `hyperlocal`/`hyper-util` trên CÙNG Unix socket `connect()` dùng, vì
/// bollard's typed `df()` response (`SystemDataUsageResponse`) chỉ mang
/// counter tổng hợp, KHÔNG có mảng `Volumes[]` per-item mà `/system/df` JSON
/// thô thực sự trả về — xem comment đầy đủ ở container_tool.rs.
#[cfg(unix)]
async fn volume_sizes(config: &ContainerConnection) -> Result<HashMap<String, i64>, String> {
    use http_body_util::{BodyExt, Full};
    use hyper_util::{client::legacy::Client, rt::TokioExecutor};

    let path = expand_socket_path(&config.socket_path);
    let client: Client<hyperlocal::UnixConnector, Full<bytes::Bytes>> =
        Client::builder(TokioExecutor::new()).build(hyperlocal::UnixConnector);
    let uri: hyper::Uri = hyperlocal::Uri::new(&path, "/system/df?type=volume").into();

    let resp = client.get(uri).await.map_err(|e| e.to_string())?;
    let body = resp.into_body().collect().await.map_err(|e| e.to_string())?.to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;

    let mut sizes = HashMap::new();
    if let Some(volumes) = json.get("Volumes").and_then(|v| v.as_array()) {
        for v in volumes {
            let name = v.get("Name").and_then(|n| n.as_str());
            let size = v.get("UsageData").and_then(|u| u.get("Size")).and_then(|s| s.as_i64());
            if let (Some(name), Some(size)) = (name, size) {
                sizes.insert(name.to_string(), size);
            }
        }
    }
    Ok(sizes)
}

/// Windows named-pipe transport isn't wired up for this raw request (only the
/// Unix socket path is) — port nguyên vẹn từ container_tool.rs: the Size
/// column just shows unknown there.
#[cfg(windows)]
async fn volume_sizes(_config: &ContainerConnection) -> Result<HashMap<String, i64>, String> {
    Ok(HashMap::new())
}

// ── Logs/Stats streaming — Bước 3 ────────────────────────────────────────────
//
// QUYẾT ĐỊNH THIẾT KẾ: MỘT registry nội bộ dùng chung cho cả logs-start VÀ
// stats-start (khác với việc có thể tách hai registry riêng). Lý do: registry
// chỉ cần biết "notify để dừng task nền của subscriptionId này" — nó không
// cần biết subscriptionId đó là một tail log hay một stats stream để làm việc
// đó. subscriptionId do chính sidecar sinh (`Uuid::new_v4()`) nên không có
// khả năng đụng độ giữa hai loại dù dùng chung một map. Tách hai registry chỉ
// thêm một tham số "loại nào" phải xuyên suốt mọi lời gọi mà không mua thêm
// tính đúng đắn nào — `unsubscribe`/`unregister` không bao giờ cần phân biệt.
// `logs-unsubscribe` và `stats-unsubscribe` vẫn là HAI method riêng ở tầng
// giao thức (mirror rõ ràng phía client — một tool có thể dừng đúng loại nó
// đang giữ mà không cần biết registry dùng chung phía dưới), nhưng cả hai gọi
// xuống CÙNG một hàm `unregister_stream`.

#[derive(Default)]
struct StreamRegistry {
    inner: Mutex<HashMap<String, Arc<tokio::sync::Notify>>>,
}

static STREAM_REGISTRY: OnceLock<StreamRegistry> = OnceLock::new();

fn stream_registry() -> &'static StreamRegistry {
    STREAM_REGISTRY.get_or_init(StreamRegistry::default)
}

fn register_stream(id: &str) -> Arc<tokio::sync::Notify> {
    let notify = Arc::new(tokio::sync::Notify::new());
    stream_registry().inner.lock().unwrap().insert(id.to_string(), notify.clone());
    notify
}

fn unregister_stream(id: &str) {
    stream_registry().inner.lock().unwrap().remove(id);
}

/// Dừng một subscription đang chạy (logs hoặc stats, registry dùng chung) —
/// gọi từ cả `logs-unsubscribe` và `stats-unsubscribe` trong `handle()`. No-op
/// (vẫn `Ok`) nếu `subscriptionId` không tồn tại, giống `unsubscribe` của
/// devtool-svc-redis.rs — không có gì để dừng không phải là lỗi.
fn unsubscribe_stream(subscription_id: &str) {
    if let Some(notify) = stream_registry().inner.lock().unwrap().remove(subscription_id) {
        notify.notify_one();
    }
}

/// Gửi lỗi giữa chừng của một method STREAM như một SỰ KIỆN STREAM bình
/// thường (`Response::event`, `error: None` ở tầng khung), KHÔNG BAO GIỜ dùng
/// `Response::err` — `service_host.rs::dispatch()` âm thầm bỏ qua một
/// `ServiceResponse` mang `error: Some(...)` cho một `Waiter::Stream` (xem
/// comment đầy đủ ở `send_pubsub_error`, devtool-svc-redis.rs). Payload
/// `{"type":"error","message":...}` đi qua đúng con đường event mà phía client
/// đang đợi (`"subscribed"` hoặc `"error"`).
fn send_stream_error(tx: &mpsc::UnboundedSender<Response>, id: &str, message: impl Into<String>) {
    let _ = tx.send(Response::event(id.to_string(), serde_json::json!({ "type": "error", "message": message.into() })));
}

/// Port nguyên vẹn từ `container_tool::LogLine` — xem đó cho giải thích đầy
/// đủ. `stream`/`message`/`timestamp` giữ nguyên tên field.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub stream: String, // "stdout" | "stderr"
    pub message: String,
    pub timestamp: Option<String>,
}

/// Port nguyên vẹn từ `container_tool::split_timestamp` — xem đó cho chú
/// thích đầy đủ.
fn split_timestamp(line: &str) -> (Option<String>, &str) {
    let Some((head, rest)) = line.split_once(' ') else { return (None, line) };
    let looks_like_ts = head.len() >= 20
        && head.as_bytes()[4] == b'-'
        && head.contains('T')
        && head[..4].chars().all(|c| c.is_ascii_digit());
    if looks_like_ts {
        (Some(head.to_string()), rest)
    } else {
        (None, line)
    }
}

/// Port nguyên vẹn từ `container_tool::StatsFrame`/`calc_cpu_percent`/
/// `stats_to_frame` — xem đó cho chú thích đầy đủ.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsFrame {
    pub cpu_percent: f64,
    pub mem_usage_bytes: u64,
    pub mem_limit_bytes: u64,
    pub net_rx_bytes: u64,
    pub net_tx_bytes: u64,
}

fn calc_cpu_percent(stats: &bollard::models::ContainerStatsResponse) -> f64 {
    let cpu = stats.cpu_stats.as_ref();
    let precpu = stats.precpu_stats.as_ref();
    let (Some(cpu), Some(precpu)) = (cpu, precpu) else { return 0.0 };
    let cpu_total = cpu.cpu_usage.as_ref().and_then(|u| u.total_usage).unwrap_or(0) as f64;
    let precpu_total = precpu.cpu_usage.as_ref().and_then(|u| u.total_usage).unwrap_or(0) as f64;
    let system = cpu.system_cpu_usage.unwrap_or(0) as f64;
    let presystem = precpu.system_cpu_usage.unwrap_or(0) as f64;
    let cpu_delta = cpu_total - precpu_total;
    let system_delta = system - presystem;
    let online_cpus = cpu.online_cpus.filter(|&n| n > 0).unwrap_or(1) as f64;
    if system_delta > 0.0 && cpu_delta > 0.0 {
        (cpu_delta / system_delta) * online_cpus * 100.0
    } else {
        0.0
    }
}

fn stats_to_frame(stats: &bollard::models::ContainerStatsResponse) -> StatsFrame {
    let mem_usage = stats.memory_stats.as_ref().and_then(|m| m.usage).unwrap_or(0);
    let mem_limit = stats.memory_stats.as_ref().and_then(|m| m.limit).unwrap_or(0);
    let (rx, tx) = stats
        .networks
        .as_ref()
        .map(|nets| {
            nets.values().fold((0u64, 0u64), |(rx, tx), n| {
                (rx + n.rx_bytes.unwrap_or(0), tx + n.tx_bytes.unwrap_or(0))
            })
        })
        .unwrap_or((0, 0));
    StatsFrame {
        cpu_percent: calc_cpu_percent(stats),
        mem_usage_bytes: mem_usage,
        mem_limit_bytes: mem_limit,
        net_rx_bytes: rx,
        net_tx_bytes: tx,
    }
}

const SNAPSHOT_TIMEOUT_SECS: u64 = 10;

/// `logs-start` là method STREAM — mirror `handle_pubsub_subscribe` của
/// devtool-svc-redis.rs: mở `docker.logs(..., follow: true)` thật, đăng ký
/// vào registry nội bộ, gửi sự kiện đầu `{"type":"subscribed",
/// "subscriptionId":...}` rồi spawn một task nền phát mỗi dòng log nhận được
/// như `{"type":"line", stream, message, timestamp}` — task tự dừng khi
/// `notify` báo (từ `logs-unsubscribe`) hoặc khi `tx.send` bắt đầu lỗi (writer
/// task đã thoát vì host đóng ống).
async fn handle_logs_start(id: String, params: serde_json::Value, tx: mpsc::UnboundedSender<Response>) {
    let config_id: String = match param(&params, "configId") {
        Ok(v) => v,
        Err(e) => return send_stream_error(&tx, &id, e),
    };
    let container_id: String = match param(&params, "containerId") {
        Ok(v) => v,
        Err(e) => return send_stream_error(&tx, &id, e),
    };
    let tail: String = opt_param(&params, "tail").unwrap_or_else(|| "all".to_string());
    let since: i32 = opt_param(&params, "since").unwrap_or(0);
    let until: i32 = opt_param(&params, "until").unwrap_or(0);
    let timestamps: bool = opt_param(&params, "timestamps").unwrap_or(false);

    let config = match find_config(&config_id) {
        Ok(c) => c,
        Err(e) => return send_stream_error(&tx, &id, e),
    };
    let docker = match connect(&config) {
        Ok(d) => d,
        Err(e) => return send_stream_error(&tx, &id, e),
    };

    let opts = bollard::query_parameters::LogsOptions {
        follow: true,
        stdout: true,
        stderr: true,
        tail,
        since,
        until,
        timestamps,
    };

    let subscription_id = Uuid::new_v4().to_string();
    let notify = register_stream(&subscription_id);

    if tx
        .send(Response::event(id.clone(), serde_json::json!({ "type": "subscribed", "subscriptionId": subscription_id })))
        .is_err()
    {
        unregister_stream(&subscription_id);
        return;
    }

    tokio::spawn(async move {
        let mut stream = docker.logs(&container_id, Some(opts));
        loop {
            tokio::select! {
                _ = notify.notified() => break,
                next = stream.next() => match next {
                    Some(Ok(out)) => {
                        let (stream_name, bytes) = match out {
                            bollard::container::LogOutput::StdOut { message } => ("stdout", message),
                            bollard::container::LogOutput::StdErr { message } => ("stderr", message),
                            bollard::container::LogOutput::Console { message } => ("stdout", message),
                            bollard::container::LogOutput::StdIn { message } => ("stdin", message),
                        };
                        let raw = String::from_utf8_lossy(&bytes).to_string();
                        let raw = raw.strip_suffix('\n').unwrap_or(&raw);
                        let (ts, message) = if timestamps { split_timestamp(raw) } else { (None, raw) };
                        let line = LogLine { stream: stream_name.to_string(), message: message.to_string(), timestamp: ts };
                        let mut event = serde_json::to_value(&line).unwrap();
                        event.as_object_mut().unwrap().insert("type".to_string(), serde_json::json!("line"));
                        if tx.send(Response::event(id.clone(), event)).is_err() {
                            break; // writer task đã thoát — không còn ai đọc
                        }
                    }
                    Some(Err(e)) => {
                        send_stream_error(&tx, &id, e.to_string());
                        break;
                    }
                    None => break,
                }
            }
        }
        unregister_stream(&subscription_id);
    });
}

/// `stats-start` là method STREAM — cùng cấu trúc `handle_logs_start`, mở
/// `docker.stats(..., stream: true)` và phát mỗi frame như `{"type":"frame",
/// ...StatsFrame}`.
async fn handle_stats_start(id: String, params: serde_json::Value, tx: mpsc::UnboundedSender<Response>) {
    let config_id: String = match param(&params, "configId") {
        Ok(v) => v,
        Err(e) => return send_stream_error(&tx, &id, e),
    };
    let container_id: String = match param(&params, "containerId") {
        Ok(v) => v,
        Err(e) => return send_stream_error(&tx, &id, e),
    };
    let config = match find_config(&config_id) {
        Ok(c) => c,
        Err(e) => return send_stream_error(&tx, &id, e),
    };
    let docker = match connect(&config) {
        Ok(d) => d,
        Err(e) => return send_stream_error(&tx, &id, e),
    };

    let opts = bollard::query_parameters::StatsOptions { stream: true, ..Default::default() };

    let subscription_id = Uuid::new_v4().to_string();
    let notify = register_stream(&subscription_id);

    if tx
        .send(Response::event(id.clone(), serde_json::json!({ "type": "subscribed", "subscriptionId": subscription_id })))
        .is_err()
    {
        unregister_stream(&subscription_id);
        return;
    }

    tokio::spawn(async move {
        let mut stream = docker.stats(&container_id, Some(opts));
        loop {
            tokio::select! {
                _ = notify.notified() => break,
                next = stream.next() => match next {
                    Some(Ok(stats)) => {
                        let mut event = serde_json::to_value(stats_to_frame(&stats)).unwrap();
                        event.as_object_mut().unwrap().insert("type".to_string(), serde_json::json!("frame"));
                        if tx.send(Response::event(id.clone(), event)).is_err() {
                            break;
                        }
                    }
                    Some(Err(e)) => {
                        send_stream_error(&tx, &id, e.to_string());
                        break;
                    }
                    None => break,
                }
            }
        }
        unregister_stream(&subscription_id);
    });
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

        "details" => {
            let config_id: String = param(&params, "configId")?;
            let container_id: String = param(&params, "containerId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let details = container_details(&docker, &container_id).await?;
            Ok(serde_json::to_value(details).unwrap())
        }

        "resources" => {
            let config_id: String = param(&params, "configId")?;
            let container_id: String = param(&params, "containerId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let insp = docker.inspect_container(&container_id, None).await.map_err(|e| e.to_string())?;
            let resources = resources_from_host_config(&insp.host_config.unwrap_or_default());
            Ok(serde_json::to_value(resources).unwrap())
        }

        "update-resources" => {
            let config_id: String = param(&params, "configId")?;
            let container_id: String = param(&params, "containerId")?;
            let resources: ContainerResourceUpdate = param(&params, "resources")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let restart_policy = match &resources.restart_policy {
                Some(name) => Some(restart_policy_from_name(name, resources.restart_max_retry)?),
                None => None,
            };
            let body = bollard::models::ContainerUpdateBody {
                nano_cpus: resources.nano_cpus,
                cpu_shares: resources.cpu_shares,
                cpu_period: resources.cpu_period,
                cpu_quota: resources.cpu_quota,
                cpuset_cpus: resources.cpuset_cpus.clone(),
                memory: resources.memory_bytes,
                memory_reservation: resources.memory_reservation_bytes,
                memory_swap: resources.memory_swap_bytes,
                blkio_weight: resources.blkio_weight,
                pids_limit: resources.pids_limit,
                restart_policy,
                ..Default::default()
            };
            docker.update_container(&container_id, body).await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        // ── Images ───────────────────────────────────────────────────────────

        "image-list" => {
            let config_id: String = param(&params, "configId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let opts = bollard::query_parameters::ListImagesOptions { all: false, ..Default::default() };
            let images = docker.list_images(Some(opts)).await.map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(images).unwrap())
        }

        "image-inspect" => {
            let config_id: String = param(&params, "configId")?;
            let image_id: String = param(&params, "imageId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let insp = docker.inspect_image(&image_id).await.map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(insp).unwrap())
        }

        "image-remove" => {
            let config_id: String = param(&params, "configId")?;
            let image_id: String = param(&params, "imageId")?;
            let force: bool = opt_param(&params, "force").unwrap_or(false);
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let opts = bollard::query_parameters::RemoveImageOptions { force, ..Default::default() };
            docker.remove_image(&image_id, Some(opts), None).await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        // `image-pull` is a MỘT-LẦN method here (Bước 2): it awaits the whole
        // pull and returns once done, without per-chunk progress events — the
        // Channel-based `container_tool::image_pull` streams `PullProgress`
        // per event but the STREAM protocol (Waiter::Stream/EventSink) for
        // this sidecar is Bước 3's job (log/stats). Consuming the whole
        // stream here and discarding intermediate frames keeps behaviour
        // correct (the pull still fully completes or fails) while deferring
        // live progress UI to Bước 3.
        "image-pull" => {
            let config_id: String = param(&params, "configId")?;
            let image: String = param(&params, "image")?;
            let tag: String = param(&params, "tag")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let opts = bollard::query_parameters::CreateImageOptions {
                from_image: Some(image),
                tag: Some(tag),
                ..Default::default()
            };
            let mut stream = docker.create_image(Some(opts), None, None);
            while let Some(item) = stream.next().await {
                item.map_err(|e| e.to_string())?;
            }
            Ok(serde_json::Value::Null)
        }

        "image-details" => {
            let config_id: String = param(&params, "configId")?;
            let image_id: String = param(&params, "imageId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let insp = docker.inspect_image(&image_id).await.map_err(|e| e.to_string())?;
            let cfg = insp.config.unwrap_or_default();
            let details = ImageDetails {
                id: insp.id.unwrap_or_default(),
                repo_tags: insp.repo_tags.unwrap_or_default(),
                repo_digests: insp.repo_digests.unwrap_or_default(),
                created: insp.created,
                size: insp.size.unwrap_or(0),
                architecture: insp.architecture,
                os: insp.os,
                author: insp.author,
                cmd: cfg.cmd.unwrap_or_default(),
                entrypoint: cfg.entrypoint.unwrap_or_default(),
                env: cfg.env.unwrap_or_default(),
                working_dir: cfg.working_dir,
                exposed_ports: cfg.exposed_ports.unwrap_or_default(),
                labels: cfg.labels.unwrap_or_default(),
                layer_count: insp.root_fs.and_then(|r| r.layers).map(|l| l.len()).unwrap_or(0),
            };
            Ok(serde_json::to_value(details).unwrap())
        }

        "image-tag" => {
            let config_id: String = param(&params, "configId")?;
            let image_id: String = param(&params, "imageId")?;
            let repo: String = param(&params, "repo")?;
            let tag: String = param(&params, "tag")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let opts = bollard::query_parameters::TagImageOptions { repo: Some(repo), tag: Some(tag) };
            docker.tag_image(&image_id, Some(opts)).await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        // ── Volumes ──────────────────────────────────────────────────────────

        "volume-list" => {
            let config_id: String = param(&params, "configId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let resp = docker
                .list_volumes(None::<bollard::query_parameters::ListVolumesOptions>)
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(resp.volumes.unwrap_or_default()).unwrap())
        }

        "volume-remove" => {
            let config_id: String = param(&params, "configId")?;
            let name: String = param(&params, "name")?;
            let force: bool = opt_param(&params, "force").unwrap_or(false);
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let opts = bollard::query_parameters::RemoveVolumeOptions { force, ..Default::default() };
            docker.remove_volume(&name, Some(opts)).await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        "volume-create" => {
            let config_id: String = param(&params, "configId")?;
            let name: String = param(&params, "name")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let req = bollard::models::VolumeCreateRequest { name: Some(name), ..Default::default() };
            let vol = docker.create_volume(req).await.map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(vol).unwrap())
        }

        "volume-sizes" => {
            let config_id: String = param(&params, "configId")?;
            let config = find_config(&config_id)?;
            let sizes = volume_sizes(&config).await?;
            Ok(serde_json::to_value(sizes).unwrap())
        }

        "volume-details" => {
            let config_id: String = param(&params, "configId")?;
            let name: String = param(&params, "name")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let vol = docker.inspect_volume(&name).await.map_err(|e| e.to_string())?;
            let usage = vol.usage_data;
            let details = VolumeDetails {
                name: vol.name,
                driver: vol.driver,
                mountpoint: vol.mountpoint,
                created_at: vol.created_at.map(|d| d.to_string()),
                scope: vol.scope.map(|s| s.to_string()),
                labels: vol.labels,
                options: vol.options,
                size_bytes: usage.as_ref().map(|u| u.size),
                ref_count: usage.as_ref().map(|u| u.ref_count),
            };
            Ok(serde_json::to_value(details).unwrap())
        }

        // ── Networks ─────────────────────────────────────────────────────────

        "network-list" => {
            let config_id: String = param(&params, "configId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let networks = docker
                .list_networks(None::<bollard::query_parameters::ListNetworksOptions>)
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(networks).unwrap())
        }

        "network-remove" => {
            let config_id: String = param(&params, "configId")?;
            let name: String = param(&params, "name")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            docker.remove_network(&name).await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        "network-create" => {
            let config_id: String = param(&params, "configId")?;
            let name: String = param(&params, "name")?;
            let driver: String = param(&params, "driver")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let req = bollard::models::NetworkCreateRequest { name, driver: Some(driver), ..Default::default() };
            docker.create_network(req).await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        "network-details" => {
            let config_id: String = param(&params, "configId")?;
            let network_id: String = param(&params, "networkId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let net = docker
                .inspect_network(&network_id, None::<bollard::query_parameters::InspectNetworkOptions>)
                .await
                .map_err(|e| e.to_string())?;
            let ipam = net.ipam.unwrap_or_default();
            let details = NetworkDetails {
                id: net.id.unwrap_or_default(),
                name: net.name.unwrap_or_default(),
                driver: net.driver,
                scope: net.scope,
                created: net.created.map(|d| d.to_string()),
                internal: net.internal.unwrap_or(false),
                attachable: net.attachable.unwrap_or(false),
                ingress: net.ingress.unwrap_or(false),
                ipv6: net.enable_ipv6.unwrap_or(false),
                ipam_driver: ipam.driver,
                ipam_config: ipam
                    .config
                    .unwrap_or_default()
                    .into_iter()
                    .map(|c| NetworkIpamConfig { subnet: c.subnet, ip_range: c.ip_range, gateway: c.gateway })
                    .collect(),
                options: net.options.unwrap_or_default(),
                labels: net.labels.unwrap_or_default(),
            };
            Ok(serde_json::to_value(details).unwrap())
        }

        // ── Prune ────────────────────────────────────────────────────────────

        "container-prune" => {
            let config_id: String = param(&params, "configId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let resp = docker
                .prune_containers(None::<bollard::query_parameters::PruneContainersOptions>)
                .await
                .map_err(|e| e.to_string())?;
            let result = PruneResult {
                deleted: resp.containers_deleted.map(|v| v.len()).unwrap_or(0),
                space_reclaimed: resp.space_reclaimed.unwrap_or(0),
            };
            Ok(serde_json::to_value(result).unwrap())
        }

        "image-prune" => {
            let config_id: String = param(&params, "configId")?;
            let dangling_only: bool = param(&params, "danglingOnly")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let mut filters: HashMap<String, Vec<String>> = HashMap::new();
            filters.insert("dangling".to_string(), vec![if dangling_only { "true" } else { "false" }.to_string()]);
            let opts = bollard::query_parameters::PruneImagesOptions { filters: Some(filters) };
            let resp = docker.prune_images(Some(opts)).await.map_err(|e| e.to_string())?;
            let result = PruneResult {
                deleted: resp.images_deleted.map(|v| v.len()).unwrap_or(0),
                space_reclaimed: resp.space_reclaimed.unwrap_or(0),
            };
            Ok(serde_json::to_value(result).unwrap())
        }

        "volume-prune" => {
            let config_id: String = param(&params, "configId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let resp = docker
                .prune_volumes(None::<bollard::query_parameters::PruneVolumesOptions>)
                .await
                .map_err(|e| e.to_string())?;
            let result = PruneResult {
                deleted: resp.volumes_deleted.map(|v| v.len()).unwrap_or(0),
                space_reclaimed: resp.space_reclaimed.unwrap_or(0),
            };
            Ok(serde_json::to_value(result).unwrap())
        }

        "network-prune" => {
            let config_id: String = param(&params, "configId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let resp = docker
                .prune_networks(None::<bollard::query_parameters::PruneNetworksOptions>)
                .await
                .map_err(|e| e.to_string())?;
            let result = PruneResult {
                deleted: resp.networks_deleted.map(|v| v.len()).unwrap_or(0),
                space_reclaimed: 0,
            };
            Ok(serde_json::to_value(result).unwrap())
        }

        // ── System ───────────────────────────────────────────────────────────

        "system-info" => {
            let config_id: String = param(&params, "configId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let info = docker.info().await.map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(info).unwrap())
        }

        "system-df" => {
            let config_id: String = param(&params, "configId")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let df = docker.df(None).await.map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(df).unwrap())
        }

        // ── Bước 3: logs/stats — phần một-lần của method dispatch ────────────
        // `logs-start`/`stats-start` (stream) KHÔNG đi qua đây — xem
        // `handle_logs_start`/`handle_stats_start`.

        "logs-unsubscribe" => {
            let subscription_id: String = param(&params, "subscriptionId")?;
            unsubscribe_stream(&subscription_id);
            Ok(serde_json::Value::Null)
        }

        "stats-unsubscribe" => {
            let subscription_id: String = param(&params, "subscriptionId")?;
            unsubscribe_stream(&subscription_id);
            Ok(serde_json::Value::Null)
        }

        // Port nguyên vẹn từ `container_tool::container_stats_snapshot` — MỘT
        // lần lấy mẫu CPU/memory/network cho một danh sách container (bảng
        // containers cần một giá trị mỗi vài giây, không phải một stream sống
        // riêng cho mỗi hàng). Container lỗi/timeout đơn giản vắng mặt khỏi map.
        "stats-snapshot" => {
            let config_id: String = param(&params, "configId")?;
            let container_ids: Vec<String> = param(&params, "containerIds")?;
            let config = find_config(&config_id)?;
            let docker = connect(&config)?;
            let futures = container_ids.into_iter().map(|cid| {
                let docker = docker.clone();
                async move {
                    let opts = bollard::query_parameters::StatsOptions { stream: false, one_shot: false };
                    let frame = tokio::time::timeout(
                        std::time::Duration::from_secs(SNAPSHOT_TIMEOUT_SECS),
                        docker.stats(&cid, Some(opts)).next(),
                    )
                    .await
                    .ok()
                    .flatten()
                    .and_then(|r| r.ok())
                    .map(|stats| stats_to_frame(&stats));
                    frame.map(|f| (cid, f))
                }
            });
            let frames = futures_util::future::join_all(futures).await;
            let map: HashMap<String, StatsFrame> = frames.into_iter().flatten().collect();
            Ok(serde_json::to_value(map).unwrap())
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
    // `logs-start`/`stats-start` KHÔNG đi qua `handle()` (một-lần) — chúng cần
    // giữ `tx` để phát nhiều sự kiện theo thời gian, xem
    // `handle_logs_start`/`handle_stats_start`. Mọi method khác vẫn đi qua
    // đường một-lần cũ, không đổi hành vi.
    if req.method == "logs-start" {
        handle_logs_start(req.id, req.params, tx.clone()).await;
        return;
    }
    if req.method == "stats-start" {
        handle_stats_start(req.id, req.params, tx.clone()).await;
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

    // ── Bước 2: đường lỗi cho container details/resources, image/volume/
    //    network CRUD+details, prune, system-info/df — mọi test ở đây chỉ cần
    //    xác nhận thiếu tham số/config không tồn tại trả lỗi rõ ràng, KHÔNG
    //    panic; xác nhận thật với daemon thật (image-list/volume-list/
    //    network-list/system-info/system-df/details/resources) làm riêng qua
    //    script JSONL tạm, không phải trong test suite này.

    #[tokio::test]
    async fn details_thieu_config_id_tra_ve_loi_ro_rang() {
        let res = handle("details", serde_json::json!({ "containerId": "x" })).await;
        assert!(res.unwrap_err().contains("configId"));
    }

    #[tokio::test]
    async fn details_config_khong_ton_tai_tra_ve_loi_ro_rang() {
        let res = handle("details", serde_json::json!({ "configId": "khong-ton-tai", "containerId": "x" })).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn resources_thieu_container_id_tra_ve_loi_ro_rang() {
        let res = handle("resources", serde_json::json!({ "configId": "x" })).await;
        assert!(res.unwrap_err().contains("containerId"));
    }

    #[tokio::test]
    async fn update_resources_thieu_resources_tra_ve_loi_ro_rang() {
        let res =
            handle("update-resources", serde_json::json!({ "configId": "x", "containerId": "y" })).await;
        assert!(res.unwrap_err().contains("resources"));
    }

    #[tokio::test]
    async fn image_list_thieu_config_id_tra_ve_loi_ro_rang() {
        let res = handle("image-list", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("configId"));
    }

    #[tokio::test]
    async fn image_inspect_thieu_image_id_tra_ve_loi_ro_rang() {
        let res = handle("image-inspect", serde_json::json!({ "configId": "x" })).await;
        assert!(res.unwrap_err().contains("imageId"));
    }

    #[tokio::test]
    async fn image_remove_config_khong_ton_tai_tra_ve_loi_ro_rang() {
        let res =
            handle("image-remove", serde_json::json!({ "configId": "khong-ton-tai", "imageId": "x" })).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn image_pull_thieu_tag_tra_ve_loi_ro_rang() {
        let res = handle("image-pull", serde_json::json!({ "configId": "x", "image": "y" })).await;
        assert!(res.unwrap_err().contains("tag"));
    }

    #[tokio::test]
    async fn image_details_thieu_image_id_tra_ve_loi_ro_rang() {
        let res = handle("image-details", serde_json::json!({ "configId": "x" })).await;
        assert!(res.unwrap_err().contains("imageId"));
    }

    #[tokio::test]
    async fn image_tag_thieu_repo_tra_ve_loi_ro_rang() {
        let res = handle("image-tag", serde_json::json!({ "configId": "x", "imageId": "y", "tag": "z" })).await;
        assert!(res.unwrap_err().contains("repo"));
    }

    #[tokio::test]
    async fn volume_list_thieu_config_id_tra_ve_loi_ro_rang() {
        let res = handle("volume-list", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("configId"));
    }

    #[tokio::test]
    async fn volume_remove_thieu_name_tra_ve_loi_ro_rang() {
        let res = handle("volume-remove", serde_json::json!({ "configId": "x" })).await;
        assert!(res.unwrap_err().contains("name"));
    }

    #[tokio::test]
    async fn volume_create_thieu_name_tra_ve_loi_ro_rang() {
        let res = handle("volume-create", serde_json::json!({ "configId": "x" })).await;
        assert!(res.unwrap_err().contains("name"));
    }

    #[tokio::test]
    async fn volume_sizes_thieu_config_id_tra_ve_loi_ro_rang() {
        let res = handle("volume-sizes", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("configId"));
    }

    #[tokio::test]
    async fn volume_details_config_khong_ton_tai_tra_ve_loi_ro_rang() {
        let res =
            handle("volume-details", serde_json::json!({ "configId": "khong-ton-tai", "name": "x" })).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn network_list_thieu_config_id_tra_ve_loi_ro_rang() {
        let res = handle("network-list", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("configId"));
    }

    #[tokio::test]
    async fn network_remove_thieu_name_tra_ve_loi_ro_rang() {
        let res = handle("network-remove", serde_json::json!({ "configId": "x" })).await;
        assert!(res.unwrap_err().contains("name"));
    }

    #[tokio::test]
    async fn network_create_thieu_driver_tra_ve_loi_ro_rang() {
        let res = handle("network-create", serde_json::json!({ "configId": "x", "name": "y" })).await;
        assert!(res.unwrap_err().contains("driver"));
    }

    #[tokio::test]
    async fn network_details_thieu_network_id_tra_ve_loi_ro_rang() {
        let res = handle("network-details", serde_json::json!({ "configId": "x" })).await;
        assert!(res.unwrap_err().contains("networkId"));
    }

    #[tokio::test]
    async fn container_prune_thieu_config_id_tra_ve_loi_ro_rang() {
        let res = handle("container-prune", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("configId"));
    }

    #[tokio::test]
    async fn image_prune_thieu_dangling_only_tra_ve_loi_ro_rang() {
        let res = handle("image-prune", serde_json::json!({ "configId": "x" })).await;
        assert!(res.unwrap_err().contains("danglingOnly"));
    }

    #[tokio::test]
    async fn volume_prune_config_khong_ton_tai_tra_ve_loi_ro_rang() {
        let res = handle("volume-prune", serde_json::json!({ "configId": "khong-ton-tai" })).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn network_prune_config_khong_ton_tai_tra_ve_loi_ro_rang() {
        let res = handle("network-prune", serde_json::json!({ "configId": "khong-ton-tai" })).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn system_info_thieu_config_id_tra_ve_loi_ro_rang() {
        let res = handle("system-info", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("configId"));
    }

    #[tokio::test]
    async fn system_df_config_khong_ton_tai_tra_ve_loi_ro_rang() {
        let res = handle("system-df", serde_json::json!({ "configId": "khong-ton-tai" })).await;
        assert!(res.is_err());
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

    // ── Bước 3: đường lỗi cho logs-start/stats-start (stream), *-unsubscribe,
    //    stats-snapshot — mirror phong cách `pubsub_subscribe_*` của
    //    devtool-svc-redis.rs. Xác nhận thật với daemon thật (nhận sự kiện
    //    "subscribed"/"line"/"frame") làm riêng qua script JSONL tạm, không
    //    phải trong test suite này.

    #[tokio::test]
    async fn logs_start_thieu_config_id_bao_loi_qua_stream_event_khong_phai_response_err() {
        // Lỗi phải đi qua như một SỰ KIỆN STREAM (`response.error.is_none()`,
        // `stream: true`, payload `{"type":"error",...}`) — KHÔNG phải
        // `response.error: Some(...)` ở tầng khung tin nhắn, vì
        // `service_host.rs::dispatch()` âm thầm bỏ qua lỗi tầng khung cho một
        // `Waiter::Stream` (xem comment ở `send_stream_error`).
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_logs_start("req-1".to_string(), serde_json::json!({ "containerId": "x" }), tx).await;
        let response = rx.recv().await.expect("phải gửi đúng một sự kiện lỗi");
        assert_eq!(response.id, "req-1");
        assert!(response.error.is_none(), "lỗi phải đi qua stream event, không phải response.error");
        assert!(response.stream);
        let event = response.result.expect("sự kiện lỗi phải mang result");
        assert_eq!(event["type"], "error");
        assert!(event["message"].as_str().unwrap().contains("configId"));
    }

    #[tokio::test]
    async fn logs_start_thieu_container_id_bao_loi_ro_rang() {
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_logs_start("req-2".to_string(), serde_json::json!({ "configId": "x" }), tx).await;
        let response = rx.recv().await.expect("phải gửi đúng một sự kiện lỗi");
        assert!(response.error.is_none());
        let event = response.result.unwrap();
        assert_eq!(event["type"], "error");
        assert!(event["message"].as_str().unwrap().contains("containerId"));
    }

    #[tokio::test]
    async fn logs_start_config_khong_ton_tai_bao_loi_ro_rang() {
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_logs_start(
            "req-3".to_string(),
            serde_json::json!({ "configId": "khong-ton-tai-chac-chan", "containerId": "x" }),
            tx,
        )
        .await;
        let response = rx.recv().await.expect("phải gửi đúng một sự kiện lỗi");
        assert!(response.error.is_none());
        assert_eq!(response.result.unwrap()["type"], "error");
    }

    #[tokio::test]
    async fn stats_start_thieu_config_id_bao_loi_qua_stream_event() {
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_stats_start("req-4".to_string(), serde_json::json!({ "containerId": "x" }), tx).await;
        let response = rx.recv().await.expect("phải gửi đúng một sự kiện lỗi");
        assert!(response.error.is_none());
        assert!(response.stream);
        let event = response.result.unwrap();
        assert_eq!(event["type"], "error");
        assert!(event["message"].as_str().unwrap().contains("configId"));
    }

    #[tokio::test]
    async fn stats_start_thieu_container_id_bao_loi_ro_rang() {
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_stats_start("req-5".to_string(), serde_json::json!({ "configId": "x" }), tx).await;
        let response = rx.recv().await.expect("phải gửi đúng một sự kiện lỗi");
        assert!(response.error.is_none());
        assert!(response.result.unwrap()["message"].as_str().unwrap().contains("containerId"));
    }

    #[tokio::test]
    async fn stats_start_config_khong_ton_tai_bao_loi_ro_rang() {
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_stats_start(
            "req-6".to_string(),
            serde_json::json!({ "configId": "khong-ton-tai-chac-chan", "containerId": "x" }),
            tx,
        )
        .await;
        let response = rx.recv().await.expect("phải gửi đúng một sự kiện lỗi");
        assert!(response.error.is_none());
        assert_eq!(response.result.unwrap()["type"], "error");
    }

    #[tokio::test]
    async fn logs_unsubscribe_id_khong_ton_tai_van_ok_khong_panic() {
        let res = handle("logs-unsubscribe", serde_json::json!({ "subscriptionId": "khong-ton-tai" })).await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn logs_unsubscribe_thao_dung_entry_khoi_registry_va_bao_notify() {
        let id = "logs-sub-test-1".to_string();
        let notify = register_stream(&id);
        let notified = tokio::spawn({
            let notify = notify.clone();
            async move { notify.notified().await }
        });
        let res = handle("logs-unsubscribe", serde_json::json!({ "subscriptionId": id })).await;
        assert!(res.is_ok());
        tokio::time::timeout(std::time::Duration::from_secs(2), notified).await.expect("notify phải bắn").unwrap();
        assert!(!stream_registry().inner.lock().unwrap().contains_key(&id));
    }

    #[tokio::test]
    async fn stats_unsubscribe_id_khong_ton_tai_van_ok_khong_panic() {
        let res = handle("stats-unsubscribe", serde_json::json!({ "subscriptionId": "khong-ton-tai" })).await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn stats_unsubscribe_thao_dung_entry_khoi_registry_va_bao_notify() {
        let id = "stats-sub-test-1".to_string();
        let notify = register_stream(&id);
        let notified = tokio::spawn({
            let notify = notify.clone();
            async move { notify.notified().await }
        });
        let res = handle("stats-unsubscribe", serde_json::json!({ "subscriptionId": id })).await;
        assert!(res.is_ok());
        tokio::time::timeout(std::time::Duration::from_secs(2), notified).await.expect("notify phải bắn").unwrap();
        assert!(!stream_registry().inner.lock().unwrap().contains_key(&id));
    }

    #[tokio::test]
    async fn logs_unsubscribe_thieu_subscription_id_tra_ve_loi_ro_rang() {
        let res = handle("logs-unsubscribe", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("subscriptionId"));
    }

    #[tokio::test]
    async fn stats_unsubscribe_thieu_subscription_id_tra_ve_loi_ro_rang() {
        let res = handle("stats-unsubscribe", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("subscriptionId"));
    }

    #[tokio::test]
    async fn stats_snapshot_thieu_config_id_tra_ve_loi_ro_rang() {
        let res = handle("stats-snapshot", serde_json::json!({ "containerIds": [] })).await;
        assert!(res.unwrap_err().contains("configId"));
    }

    #[tokio::test]
    async fn stats_snapshot_thieu_container_ids_tra_ve_loi_ro_rang() {
        let res = handle("stats-snapshot", serde_json::json!({ "configId": "x" })).await;
        assert!(res.unwrap_err().contains("containerIds"));
    }

    #[tokio::test]
    async fn stats_snapshot_config_khong_ton_tai_tra_ve_loi_ro_rang() {
        let res = handle(
            "stats-snapshot",
            serde_json::json!({ "configId": "khong-ton-tai-chac-chan", "containerIds": ["x"] }),
        )
        .await;
        assert!(res.is_err());
    }

    #[test]
    fn split_timestamp_tach_dung_dinh_dang_rfc3339() {
        let (ts, rest) = split_timestamp("2026-08-26T09:41:02.123456789Z hello world");
        assert_eq!(ts.as_deref(), Some("2026-08-26T09:41:02.123456789Z"));
        assert_eq!(rest, "hello world");
    }

    #[test]
    fn split_timestamp_khong_tach_dong_khong_bat_dau_bang_timestamp() {
        let (ts, rest) = split_timestamp("hello world");
        assert_eq!(ts, None);
        assert_eq!(rest, "hello world");
    }
}
