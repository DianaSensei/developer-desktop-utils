// Container runtime tool backend (Docker Engine API compatible daemons).
//
// Targets any daemon exposing a docker-compatible socket: Docker Desktop,
// Colima (docker runtime), Rancher Desktop (moby), OrbStack, Podman
// (docker-compat mode). Talks to the daemon over its Unix socket / Windows
// named pipe via `bollard`, never by shelling out to a CLI — same philosophy
// as kafka.rs (rskafka)/rabbit.rs (lapin)/redis_tool.rs (redis crate).
//
// Connection profiles are persisted to the app-data directory, same pattern
// as redis_tool.rs's `configs_path`/`load_configs`/`save_configs`.
//
// Long-lived streams (log tail, stats) use the same
// `Arc<Mutex<HashMap<String, Arc<Notify>>>>` registry-by-id pattern as
// redis_tool.rs's `PubSubRegistry` / rabbit.rs's `ConsumerRegistry` / kafka.rs's
// consumer registry — the frontend calls `*_stop(id)` (or drops the Channel)
// to cancel; the background task also unregisters itself when the stream ends.

use bollard::Docker;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use futures_util::StreamExt;

// ── Connection profile ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerConnection {
    pub id: String,
    pub name: String,
    /// Raw filesystem path to the daemon socket (unix) or the pipe name
    /// (windows) — no `unix://`/`npipe://` scheme prefix. e.g.
    /// `/Users/me/.colima/default/docker.sock` or `\\.\pipe\docker_engine`.
    pub socket_path: String,
}

fn configs_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("container-connections.json"))
        .map_err(|e| format!("Could not resolve app data directory: {e}"))
}

fn load_configs(app: &AppHandle) -> Vec<ContainerConnection> {
    let Ok(path) = configs_path(app) else { return Vec::new(); };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_configs(app: &AppHandle, configs: &[ContainerConnection]) -> Result<(), String> {
    let path = configs_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(configs).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_list_configs(app: AppHandle) -> Result<Vec<ContainerConnection>, String> {
    Ok(load_configs(&app))
}

#[tauri::command]
pub async fn container_save_config(
    app: AppHandle,
    mut config: ContainerConnection,
) -> Result<ContainerConnection, String> {
    if config.id.is_empty() {
        config.id = Uuid::new_v4().to_string();
    }
    let mut configs = load_configs(&app);
    if let Some(pos) = configs.iter().position(|c| c.id == config.id) {
        configs[pos] = config.clone();
    } else {
        configs.push(config.clone());
    }
    save_configs(&app, &configs)?;
    Ok(config)
}

#[tauri::command]
pub async fn container_delete_config(app: AppHandle, config_id: String) -> Result<(), String> {
    let mut configs = load_configs(&app);
    configs.retain(|c| c.id != config_id);
    save_configs(&app, &configs)
}

// ── Socket auto-detect ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedSocket {
    pub label: String,
    pub socket_path: String,
}

/// Best-effort probe of the well-known socket locations used by colima,
/// Docker Desktop, Rancher Desktop, OrbStack and Podman machine. Purely a
/// suggestion list for the "Add connection" form — nothing here is trusted
/// or connected to automatically.
#[tauri::command]
pub async fn container_detect_sockets() -> Result<Vec<DetectedSocket>, String> {
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

    Ok(found)
}

#[cfg(unix)]
fn dirs_home() -> std::path::PathBuf {
    std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_default()
}

/// Expands a leading `~` (or `~/...`) to the user's home directory, the same
/// shorthand every shell supports — the OS/bollard socket connector never
/// does this itself, so a path pasted straight from a terminal (`~/.colima/
/// default/docker.sock`) would otherwise fail to resolve.
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

// ── Connect ──────────────────────────────────────────────────────────────

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

#[tauri::command]
pub async fn container_test_connection(config: ContainerConnection) -> Result<(), String> {
    let docker = connect(&config)?;
    docker.ping().await.map_err(|e| e.to_string())?;
    Ok(())
}

// ── Containers ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn container_list(
    config: ContainerConnection,
    all: bool,
) -> Result<Vec<bollard::models::ContainerSummary>, String> {
    let docker = connect(&config)?;
    let opts = bollard::query_parameters::ListContainersOptions {
        all,
        ..Default::default()
    };
    docker.list_containers(Some(opts)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_inspect(
    config: ContainerConnection,
    container_id: String,
) -> Result<bollard::models::ContainerInspectResponse, String> {
    let docker = connect(&config)?;
    docker
        .inspect_container(&container_id, None)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_start(config: ContainerConnection, container_id: String) -> Result<(), String> {
    let docker = connect(&config)?;
    docker.start_container(&container_id, None).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn container_stop(config: ContainerConnection, container_id: String) -> Result<(), String> {
    let docker = connect(&config)?;
    docker.stop_container(&container_id, None).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn container_restart(config: ContainerConnection, container_id: String) -> Result<(), String> {
    let docker = connect(&config)?;
    docker.restart_container(&container_id, None).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_pause(config: ContainerConnection, container_id: String) -> Result<(), String> {
    let docker = connect(&config)?;
    docker.pause_container(&container_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_unpause(config: ContainerConnection, container_id: String) -> Result<(), String> {
    let docker = connect(&config)?;
    docker.unpause_container(&container_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_remove(
    config: ContainerConnection,
    container_id: String,
    force: bool,
) -> Result<(), String> {
    let docker = connect(&config)?;
    let opts = bollard::query_parameters::RemoveContainerOptions {
        force,
        ..Default::default()
    };
    docker.remove_container(&container_id, Some(opts)).await.map_err(|e| e.to_string())
}

// ── Container details (curated projection of the full inspect payload) ────
//
// `inspect_container` returns dozens of mostly-irrelevant fields (resolv.conf
// path, exec ids, graph driver internals, …). Rather than push that whole
// shape to the frontend as `unknown` and let a dialog component pick fields
// out of it by hand, project down to the handful actually worth showing —
// same reasoning as ContainerSummary/ImageSummary already being thin views
// over the raw Docker API shape, just curated instead of passthrough because
// the inspect payload is an order of magnitude bigger than a list summary.

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
}

#[tauri::command]
pub async fn container_details(
    config: ContainerConnection,
    container_id: String,
) -> Result<ContainerDetails, String> {
    let docker = connect(&config)?;
    let insp = docker
        .inspect_container(&container_id, None)
        .await
        .map_err(|e| e.to_string())?;

    let state = insp.state.unwrap_or_default();
    let cfg = insp.config.unwrap_or_default();
    let host_config = insp.host_config.unwrap_or_default();
    let net = insp.network_settings.unwrap_or_default();
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
    })
}

// ── Registry shared by logs + stats streams ─────────────────────────────────

#[derive(Default, Clone)]
pub struct StreamRegistry {
    inner: Arc<Mutex<HashMap<String, Arc<tokio::sync::Notify>>>>,
}

fn register_stream(registry: &StreamRegistry, id: &str) -> Arc<tokio::sync::Notify> {
    let notify = Arc::new(tokio::sync::Notify::new());
    registry.inner.lock().unwrap().insert(id.to_string(), notify.clone());
    notify
}

fn unregister_stream(registry: &StreamRegistry, id: &str) {
    registry.inner.lock().unwrap().remove(id);
}

#[tauri::command]
pub async fn container_logs_stop(registry: tauri::State<'_, StreamRegistry>, stream_id: String) -> Result<(), String> {
    if let Some(notify) = registry.inner.lock().unwrap().remove(&stream_id) {
        notify.notify_one();
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub stream: String, // "stdout" | "stderr"
    pub message: String,
}

#[tauri::command]
pub async fn container_logs_start(
    registry: tauri::State<'_, StreamRegistry>,
    config: ContainerConnection,
    container_id: String,
    tail: String,
    on_log: Channel<LogLine>,
) -> Result<String, String> {
    let docker = connect(&config)?;
    let opts = bollard::query_parameters::LogsOptions {
        follow: true,
        stdout: true,
        stderr: true,
        tail,
        timestamps: false,
        ..Default::default()
    };

    let id = Uuid::new_v4().to_string();
    let notify = register_stream(&registry, &id);
    let reg = registry.inner().clone();
    let id_task = id.clone();

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
                        let line = LogLine {
                            stream: stream_name.to_string(),
                            message: String::from_utf8_lossy(&bytes).to_string(),
                        };
                        if on_log.send(line).is_err() {
                            break; // frontend dropped the channel
                        }
                    }
                    Some(Err(_)) | None => break,
                }
            }
        }
        unregister_stream(&reg, &id_task);
    });

    Ok(id)
}

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

#[tauri::command]
pub async fn container_stats_start(
    registry: tauri::State<'_, StreamRegistry>,
    config: ContainerConnection,
    container_id: String,
    on_stat: Channel<StatsFrame>,
) -> Result<String, String> {
    let docker = connect(&config)?;
    let opts = bollard::query_parameters::StatsOptions {
        stream: true,
        ..Default::default()
    };

    let id = Uuid::new_v4().to_string();
    let notify = register_stream(&registry, &id);
    let reg = registry.inner().clone();
    let id_task = id.clone();

    tokio::spawn(async move {
        let mut stream = docker.stats(&container_id, Some(opts));
        loop {
            tokio::select! {
                _ = notify.notified() => break,
                next = stream.next() => match next {
                    Some(Ok(stats)) => {
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
                        let frame = StatsFrame {
                            cpu_percent: calc_cpu_percent(&stats),
                            mem_usage_bytes: mem_usage,
                            mem_limit_bytes: mem_limit,
                            net_rx_bytes: rx,
                            net_tx_bytes: tx,
                        };
                        if on_stat.send(frame).is_err() {
                            break;
                        }
                    }
                    Some(Err(_)) | None => break,
                }
            }
        }
        unregister_stream(&reg, &id_task);
    });

    Ok(id)
}

// ── Images ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn image_list(config: ContainerConnection) -> Result<Vec<bollard::models::ImageSummary>, String> {
    let docker = connect(&config)?;
    let opts = bollard::query_parameters::ListImagesOptions {
        all: false,
        ..Default::default()
    };
    docker.list_images(Some(opts)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn image_inspect(config: ContainerConnection, image_id: String) -> Result<bollard::models::ImageInspect, String> {
    let docker = connect(&config)?;
    docker.inspect_image(&image_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn image_remove(config: ContainerConnection, image_id: String, force: bool) -> Result<(), String> {
    let docker = connect(&config)?;
    let opts = bollard::query_parameters::RemoveImageOptions {
        force,
        ..Default::default()
    };
    docker.remove_image(&image_id, Some(opts), None).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullProgress {
    pub status: String,
    pub id: Option<String>,
    pub progress_current: Option<i64>,
    pub progress_total: Option<i64>,
}

#[tauri::command]
pub async fn image_pull(
    config: ContainerConnection,
    image: String,
    tag: String,
    on_progress: Channel<PullProgress>,
) -> Result<(), String> {
    let docker = connect(&config)?;
    let opts = bollard::query_parameters::CreateImageOptions {
        from_image: Some(image),
        tag: Some(tag),
        ..Default::default()
    };
    let mut stream = docker.create_image(Some(opts), None, None);
    while let Some(item) = stream.next().await {
        let info = item.map_err(|e| e.to_string())?;
        let _ = on_progress.send(PullProgress {
            status: info.status.unwrap_or_default(),
            id: info.id,
            progress_current: info.progress_detail.as_ref().and_then(|d| d.current),
            progress_total: info.progress_detail.as_ref().and_then(|d| d.total),
        });
    }
    Ok(())
}

// ── Image details (curated projection, same reasoning as ContainerDetails) ─

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

#[tauri::command]
pub async fn image_details(config: ContainerConnection, image_id: String) -> Result<ImageDetails, String> {
    let docker = connect(&config)?;
    let insp = docker.inspect_image(&image_id).await.map_err(|e| e.to_string())?;
    let cfg = insp.config.unwrap_or_default();

    Ok(ImageDetails {
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
    })
}

// ── Volumes ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn volume_list(config: ContainerConnection) -> Result<Vec<bollard::models::Volume>, String> {
    let docker = connect(&config)?;
    let resp = docker.list_volumes(None::<bollard::query_parameters::ListVolumesOptions>).await.map_err(|e| e.to_string())?;
    Ok(resp.volumes.unwrap_or_default())
}

#[tauri::command]
pub async fn volume_remove(config: ContainerConnection, name: String, force: bool) -> Result<(), String> {
    let docker = connect(&config)?;
    let opts = bollard::query_parameters::RemoveVolumeOptions {
        force,
        ..Default::default()
    };
    docker.remove_volume(&name, Some(opts)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn volume_create(config: ContainerConnection, name: String) -> Result<bollard::models::Volume, String> {
    let docker = connect(&config)?;
    let req = bollard::models::VolumeCreateRequest {
        name: Some(name),
        ..Default::default()
    };
    docker.create_volume(req).await.map_err(|e| e.to_string())
}

/// Per-volume disk usage (bytes), keyed by volume name — `docker system df`'s
/// numbers, which only exist because the daemon walks every volume's
/// mountpoint on disk; there's no cheaper way to get a real size. `bollard`'s
/// typed `df()` response (`bollard::models::SystemDataUsageResponse`, this
/// version) only carries the aggregate counters (ActiveCount/TotalCount/
/// Reclaimable/TotalSize) — it drops the per-item `Volumes[]` array the raw
/// `/system/df` JSON actually includes, so getting `UsageData.Size` per
/// volume means reading that JSON ourselves. Issued as a plain request over
/// the same Unix socket `connect()` uses (`hyperlocal`/`hyper-util`, both
/// already pulled in transitively by bollard's own "pipe" feature — see
/// Cargo.toml) rather than hand-rolling HTTP parsing.
#[cfg(unix)]
#[tauri::command]
pub async fn volume_sizes(config: ContainerConnection) -> Result<HashMap<String, i64>, String> {
    use http_body_util::{BodyExt, Full};
    use hyper_util::{client::legacy::Client, rt::TokioExecutor};

    let path = expand_socket_path(&config.socket_path);
    let client: Client<hyperlocal::UnixConnector, Full<bytes::Bytes>> =
        Client::builder(TokioExecutor::new()).build(hyperlocal::UnixConnector);
    let uri: hyper::Uri = hyperlocal::Uri::new(&path, "/system/df?type=volume").into();

    let resp = client.get(uri).await.map_err(|e| e.to_string())?;
    let body = resp
        .into_body()
        .collect()
        .await
        .map_err(|e| e.to_string())?
        .to_bytes();
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
/// Unix socket path is) — the Size column just shows unknown there.
#[cfg(windows)]
#[tauri::command]
pub async fn volume_sizes(_config: ContainerConnection) -> Result<HashMap<String, i64>, String> {
    Ok(HashMap::new())
}

// ── Networks ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn network_list(config: ContainerConnection) -> Result<Vec<bollard::models::Network>, String> {
    let docker = connect(&config)?;
    docker.list_networks(None::<bollard::query_parameters::ListNetworksOptions>).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn network_remove(config: ContainerConnection, name: String) -> Result<(), String> {
    let docker = connect(&config)?;
    docker.remove_network(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn network_create(config: ContainerConnection, name: String, driver: String) -> Result<(), String> {
    let docker = connect(&config)?;
    let req = bollard::models::NetworkCreateRequest {
        name,
        driver: Some(driver),
        ..Default::default()
    };
    docker.create_network(req).await.map_err(|e| e.to_string())?;
    Ok(())
}

// ── System overview ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn container_system_info(config: ContainerConnection) -> Result<bollard::models::SystemInfo, String> {
    let docker = connect(&config)?;
    docker.info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_system_df(config: ContainerConnection) -> Result<bollard::models::SystemDataUsageResponse, String> {
    let docker = connect(&config)?;
    docker.df(None).await.map_err(|e| e.to_string())
}
