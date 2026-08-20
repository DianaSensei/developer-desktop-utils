// Docker Compose management — shells out to the `docker compose` CLI.
//
// Compose has no daemon-side API: interpolation, `depends_on` ordering,
// `profiles`, `extends`, and image builds are all client-side logic inside
// the `docker compose` CLI itself (which then calls the Docker Engine API
// many times). There is no Rust crate that reimplements this faithfully, so
// unlike container_tool.rs (which talks straight to the Docker Engine API
// via `bollard`), this module is a deliberate, isolated exception to the
// "never shell out" convention used elsewhere in this codebase — it is the
// only way to get behavior that actually matches `docker compose` itself.
//
// Every invocation sets `DOCKER_HOST` from the selected container_tool
// connection so compose targets the same daemon (colima / Docker Desktop /
// Rancher Desktop / OrbStack / podman docker-compat) the user picked in the
// Containers view, rather than whatever the shell's ambient docker context is.
//
// Requires the `docker` CLI + compose plugin (or standalone `docker-compose`)
// on PATH — colima itself does not bundle these, they are a separate install
// (e.g. `brew install docker docker-compose`). A missing binary surfaces as a
// clear error rather than a silent failure.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

use crate::container_tool::{docker_host_url, ContainerConnection, LogLine};

// ── Known projects (compose file bookmarks) ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeProject {
    pub id: String,
    pub name: String,
    pub connection_id: String,
    /// One or more `-f` files (override files supported by listing more than one).
    pub compose_files: Vec<String>,
    /// Working directory compose resolves relative build contexts / .env from.
    pub working_dir: String,
}

fn projects_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("compose-projects.json"))
        .map_err(|e| format!("Could not resolve app data directory: {e}"))
}

fn load_projects(app: &AppHandle) -> Vec<ComposeProject> {
    let Ok(path) = projects_path(app) else { return Vec::new(); };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_projects(app: &AppHandle, projects: &[ComposeProject]) -> Result<(), String> {
    let path = projects_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(projects).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn compose_list_known(app: AppHandle) -> Result<Vec<ComposeProject>, String> {
    Ok(load_projects(&app))
}

#[tauri::command]
pub async fn compose_add_project(
    app: AppHandle,
    mut project: ComposeProject,
) -> Result<ComposeProject, String> {
    if project.compose_files.is_empty() {
        return Err("Provide at least one compose file".to_string());
    }
    if project.id.is_empty() {
        project.id = Uuid::new_v4().to_string();
    }
    let mut projects = load_projects(&app);
    if let Some(pos) = projects.iter().position(|p| p.id == project.id) {
        projects[pos] = project.clone();
    } else {
        projects.push(project.clone());
    }
    save_projects(&app, &projects)?;
    Ok(project)
}

#[tauri::command]
pub async fn compose_remove_project(app: AppHandle, project_id: String) -> Result<(), String> {
    let mut projects = load_projects(&app);
    projects.retain(|p| p.id != project_id);
    save_projects(&app, &projects)
}

// ── Running `docker compose` ────────────────────────────────────────────────

fn compose_command(connection: &ContainerConnection, compose_files: &[String], working_dir: &str) -> Command {
    let mut cmd = Command::new("docker");
    cmd.env("DOCKER_HOST", docker_host_url(connection));
    cmd.arg("compose");
    for f in compose_files {
        cmd.arg("-f").arg(f);
    }
    if !working_dir.is_empty() {
        cmd.current_dir(working_dir);
    }
    cmd
}

async fn run_compose(mut cmd: Command, args: &[&str]) -> Result<String, String> {
    cmd.args(args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let output = cmd.output().await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "docker CLI not found on PATH. Compose management needs the Docker CLI + Compose \
             plugin installed separately (e.g. `brew install docker docker-compose`) — colima \
             itself only provides the daemon, not the client tools.".to_string()
        } else {
            e.to_string()
        }
    })?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() {
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

// ── Project listing / status ────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct ComposeProjectStatus {
    pub name: String,
    pub status: String,
    #[serde(default, rename = "ConfigFiles")]
    pub config_files: String,
}

/// Projects the daemon already knows about (running or stopped containers
/// carrying compose labels) — independent of the "known projects" bookmark
/// list, mirrors what `docker compose ls --all` shows in a terminal.
#[tauri::command]
pub async fn compose_list_projects(connection: ContainerConnection) -> Result<Vec<ComposeProjectStatus>, String> {
    let mut cmd = Command::new("docker");
    cmd.env("DOCKER_HOST", docker_host_url(&connection));
    cmd.args(["compose", "ls", "--all", "--format", "json"]);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let output = cmd.output().await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "docker CLI not found on PATH. Install the Docker CLI + Compose plugin to manage Compose projects.".to_string()
        } else {
            e.to_string()
        }
    })?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(stdout.trim()).map_err(|e| format!("Could not parse `docker compose ls` output: {e}"))
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct ComposeServiceStatus {
    #[serde(default, rename = "ID")]
    pub id: String,
    pub name: String,
    pub service: String,
    pub state: String,
    #[serde(default)]
    pub health: String,
    #[serde(default)]
    pub publishers: serde_json::Value,
}

#[tauri::command]
pub async fn compose_ps(
    connection: ContainerConnection,
    compose_files: Vec<String>,
    working_dir: String,
) -> Result<Vec<ComposeServiceStatus>, String> {
    let mut cmd = compose_command(&connection, &compose_files, &working_dir);
    cmd.args(["ps", "--all", "--format", "json"]);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let output = cmd.output().await.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    // `docker compose ps --format json` emits one JSON object per line (JSONL),
    // not a JSON array.
    stdout
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).map_err(|e| format!("Could not parse compose ps line: {e}")))
        .collect()
}

#[tauri::command]
pub async fn compose_up(
    connection: ContainerConnection,
    compose_files: Vec<String>,
    working_dir: String,
) -> Result<String, String> {
    let cmd = compose_command(&connection, &compose_files, &working_dir);
    run_compose(cmd, &["up", "-d", "--remove-orphans"]).await
}

#[tauri::command]
pub async fn compose_down(
    connection: ContainerConnection,
    compose_files: Vec<String>,
    working_dir: String,
    remove_volumes: bool,
) -> Result<String, String> {
    let cmd = compose_command(&connection, &compose_files, &working_dir);
    if remove_volumes {
        run_compose(cmd, &["down", "-v"]).await
    } else {
        run_compose(cmd, &["down"]).await
    }
}

#[tauri::command]
pub async fn compose_restart(
    connection: ContainerConnection,
    compose_files: Vec<String>,
    working_dir: String,
    service: Option<String>,
) -> Result<String, String> {
    let cmd = compose_command(&connection, &compose_files, &working_dir);
    match service {
        Some(s) => run_compose(cmd, &["restart", &s]).await,
        None => run_compose(cmd, &["restart"]).await,
    }
}

#[tauri::command]
pub async fn compose_stop(
    connection: ContainerConnection,
    compose_files: Vec<String>,
    working_dir: String,
    service: Option<String>,
) -> Result<String, String> {
    let cmd = compose_command(&connection, &compose_files, &working_dir);
    match service {
        Some(s) => run_compose(cmd, &["stop", &s]).await,
        None => run_compose(cmd, &["stop"]).await,
    }
}

#[tauri::command]
pub async fn compose_pull(
    connection: ContainerConnection,
    compose_files: Vec<String>,
    working_dir: String,
) -> Result<String, String> {
    let cmd = compose_command(&connection, &compose_files, &working_dir);
    run_compose(cmd, &["pull"]).await
}

/// Renders the fully-interpolated/merged compose config (env vars resolved,
/// override files merged) as JSON — used for a read-only preview before `up`.
#[tauri::command]
pub async fn compose_config(
    connection: ContainerConnection,
    compose_files: Vec<String>,
    working_dir: String,
) -> Result<serde_json::Value, String> {
    let mut cmd = compose_command(&connection, &compose_files, &working_dir);
    cmd.args(["config", "--format", "json"]);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let output = cmd.output().await.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("Could not parse `docker compose config` output: {e}"))
}

// ── Log streaming (follow) ──────────────────────────────────────────────────

/// Tracks running `docker compose logs -f` child processes so they can be
/// killed. Same by-id registry shape as container_tool::StreamRegistry, but
/// keyed to a live child process (has to be killed, not just have its reader
/// loop cancelled — the process itself keeps running on the daemon side of
/// nothing, but the CLI's own follow loop needs a hard kill to stop).
#[derive(Default, Clone)]
pub struct ComposeLogRegistry {
    inner: Arc<Mutex<HashMap<String, tokio::process::Child>>>,
}

#[tauri::command]
pub async fn compose_logs_start(
    registry: tauri::State<'_, ComposeLogRegistry>,
    connection: ContainerConnection,
    compose_files: Vec<String>,
    working_dir: String,
    service: Option<String>,
    on_log: Channel<LogLine>,
) -> Result<String, String> {
    let mut cmd = compose_command(&connection, &compose_files, &working_dir);
    cmd.arg("logs").arg("-f").arg("--no-color").arg("--tail").arg("200");
    if let Some(s) = &service {
        cmd.arg(s);
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "docker CLI not found on PATH. Install the Docker CLI + Compose plugin to view Compose logs.".to_string()
        } else {
            e.to_string()
        }
    })?;
    let stdout = child.stdout.take().ok_or("Could not capture compose logs output")?;

    let id = Uuid::new_v4().to_string();
    registry.inner.lock().unwrap().insert(id.clone(), child);

    let reg = registry.inner.clone();
    let id_task = id.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let out = LogLine { stream: "stdout".to_string(), message: line };
            if on_log.send(out).is_err() {
                break; // frontend dropped the channel
            }
        }
        reg.lock().unwrap().remove(&id_task);
    });

    Ok(id)
}

#[tauri::command]
pub async fn compose_logs_stop(registry: tauri::State<'_, ComposeLogRegistry>, stream_id: String) -> Result<(), String> {
    if let Some(mut child) = registry.inner.lock().unwrap().remove(&stream_id) {
        let _ = child.start_kill();
    }
    Ok(())
}
