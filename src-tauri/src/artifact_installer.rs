// Installs external artifacts from a user-supplied manifest URL. A manifest
// describes either a JS plugin (`kind: "plugin"`, runs in the webview) or a
// native sidecar (`kind: "service"`, runs as a child process, see
// service_host.rs).
//
// Downloads go through reqwest straight to disk rather than through the JS
// HTTP plugin, so multi-megabyte payloads are not base64-encoded over IPC.
//
// Trust boundary: downloaded code runs unsandboxed, so a compromised host or
// MITM could swap it. `integrity`/`sha256` are therefore mandatory. Plugin
// bundles are verified at install time and again on every load; service
// binaries are verified once at install and written atomically so a crash
// never leaves a partial binary where `sidecar_path` would find it.
//
// `current_target_triple()` is computed here, never taken from the client or
// manifest: the host alone decides which binary runs.
//
// The `stage_*`, `read_index`, `write_index` and `prepare_extensions_dir`
// functions take plain paths and do not touch Tauri, so they are tested
// against real temp directories. The `#[tauri::command]` functions are thin
// wrappers that resolve directories and call them.

use digest::Digest;
use serde::de::{self, Deserializer};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::checksum::to_hex;

// ---------------------------------------------------------------------------
// Size-capped download
// ---------------------------------------------------------------------------

/// Upper bound for a single artifact download. Without a cap, a compromised
/// host could exhaust memory before the checksum check runs.
const MAX_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;

/// Client for manifest and artifact downloads. Follows at most 10 redirects
/// and never from https to another scheme: the manifest carries the
/// checksums, so a plain-http hop would let a network attacker swap both.
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if is_scheme_downgrade(attempt.previous(), attempt.url()) {
                attempt.error("refusing redirect from https to a non-https URL")
            } else if attempt.previous().len() > 10 {
                attempt.error("too many redirects")
            } else {
                attempt.follow()
            }
        }))
        // Tests talk to a local http server; real builds only ever speak https.
        .https_only(!cfg!(test))
        .build()
        .map_err(|e| e.to_string())
}

fn is_scheme_downgrade(previous: &[reqwest::Url], next: &reqwest::Url) -> bool {
    next.scheme() != "https" && previous.iter().any(|u| u.scheme() == "https")
}

/// Downloads `url`, rejecting early when `Content-Length` exceeds `max_bytes`
/// and counting bytes while streaming, since the header can be missing or
/// wrong.
async fn download_capped(url: &str, max_bytes: u64) -> Result<Vec<u8>, String> {
    let res = http_client()?.get(url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Server trả về {}", res.status()));
    }
    if let Some(len) = res.content_length() {
        if len > max_bytes {
            return Err(format!("File quá lớn ({len} byte; trần {max_bytes} byte) — từ chối tải."));
        }
    }

    let mut res = res;
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        if buf.len() as u64 + chunk.len() as u64 > max_bytes {
            return Err(format!("File vượt trần {max_bytes} byte giữa lúc tải — từ chối, dừng tải tiếp."));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

// ---------------------------------------------------------------------------
// Remote manifests
// ---------------------------------------------------------------------------

/// Plugin manifest. Differs from the TS `PluginManifest` because it is JSON:
/// `icon` is a name looked up in `src/platform/installer.ts`, and `entry` is
/// the URL of a single prebuilt JS bundle instead of a `load` function.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct RemotePluginManifest {
    pub id: String,
    pub version: String,
    /// SDK version range, "^M.m.p", checked by `satisfiesSdk` on the TS side.
    pub sdk: String,
    pub entry: String,
    pub integrity: String,
    pub label: String,
    pub description: String,
    pub icon: String,
    #[serde(default)]
    pub keywords: Vec<String>,
    pub route: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub commands: Vec<String>,
    #[serde(default)]
    pub hosts: Vec<String>,
    /// Sidecar this plugin calls when `permissions` includes `'service'`. Only
    /// declares the method allowlist; the binary runs only if it is the
    /// bundled copy or the user consents to its current hash
    /// (service_host.rs, service_trust.rs).
    #[serde(default)]
    pub service: Option<RemoteServiceDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteServiceDescriptor {
    pub bin: String,
    pub methods: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

/// Download URL and checksum of a service build for one target triple.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ServiceTarget {
    pub url: String,
    pub sha256: String,
}

/// One version of a native sidecar. `bin` is the bare name (no extension, no
/// triple); the host adds `.exe` on Windows instead of trusting the URL's
/// file name.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct RemoteServiceManifest {
    pub bin: String,
    pub version: String,
    /// Expected to match `service_host::SERVICE_PROTOCOL`. Informational only:
    /// it is never compared with anything at install or call time.
    pub protocol: u32,
    /// Keyed by Rust target triple (`x86_64-apple-darwin`,
    /// `aarch64-unknown-linux-gnu`, ...), exactly as `current_target_triple()`
    /// formats it.
    pub targets: HashMap<String, ServiceTarget>,
}

/// Remote manifest, tagged by `kind`. Unlike `InstalledArtifactRecord`, no
/// backward compatibility is needed: manifests are fetched fresh each time.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RemoteArtifactManifest {
    Plugin(RemotePluginManifest),
    Service(RemoteServiceManifest),
}

// Installed records, stored in extensions/index.json

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct InstalledPluginRecord {
    pub manifest: RemotePluginManifest,
    /// Manifest URL the plugin was installed from; used to check for updates.
    pub source_url: String,
    pub bundle_path: String,
    pub installed_at: i64,
    /// Marketplace the plugin was installed from, `None` for a pasted URL or a
    /// record that predates markets. Part of the plugin's identity: two markets
    /// may publish the same `manifest.id`, so plugin lookups match on
    /// `(manifest.id, market_id)`.
    #[serde(default)]
    pub market_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct InstalledServiceRecord {
    pub manifest: RemoteServiceManifest,
    pub source_url: String,
    pub bin_path: String,
    pub installed_at: i64,
    /// Display only; services are matched by `bin` alone, so a later install
    /// of the same `bin` from any source replaces the earlier record.
    #[serde(default)]
    pub market_id: Option<String>,
}

/// Installed record. Both kinds share one `extensions/index.json`.
///
/// `Deserialize` is hand-written because records written before services
/// existed have no `kind` field and must still load as `Plugin`. serde's
/// tagged-enum derive cannot default a missing tag. `Serialize` always writes
/// `kind`.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InstalledArtifactRecord {
    Plugin(InstalledPluginRecord),
    Service(InstalledServiceRecord),
}

impl<'de> Deserialize<'de> for InstalledArtifactRecord {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        // A missing `kind` means a legacy record, which is always a plugin.
        let kind = value
            .get("kind")
            .and_then(|k| k.as_str())
            .unwrap_or("plugin")
            .to_string();
        match kind.as_str() {
            "plugin" => Ok(InstalledArtifactRecord::Plugin(
                serde_json::from_value(value).map_err(de::Error::custom)?,
            )),
            "service" => Ok(InstalledArtifactRecord::Service(
                serde_json::from_value(value).map_err(de::Error::custom)?,
            )),
            other => Err(de::Error::custom(format!(
                "kind \"{other}\" không nhận diện được (chỉ \"plugin\" hoặc \"service\")"
            ))),
        }
    }
}

impl InstalledArtifactRecord {
    /// Index key: plugin id or service bin. Callers always filter by kind too,
    /// so a plugin and a service with the same name do not collide.
    fn key(&self) -> &str {
        match self {
            InstalledArtifactRecord::Plugin(p) => &p.manifest.id,
            InstalledArtifactRecord::Service(s) => &s.manifest.bin,
        }
    }

    /// Market the record was installed from (identity for plugins, display only
    /// for services).
    fn market_id(&self) -> Option<&str> {
        match self {
            InstalledArtifactRecord::Plugin(p) => p.market_id.as_deref(),
            InstalledArtifactRecord::Service(s) => s.market_id.as_deref(),
        }
    }
}

/// On-disk directory for a plugin: `plugins_dir/<id>/` without a market
/// (the original layout, so existing installs need no migration), or
/// `plugins_dir/by-market/<market_id>/<id>/`.
fn plugin_disk_dir(plugins_dir: &Path, market_id: Option<&str>, id: &str) -> PathBuf {
    match market_id {
        Some(m) => plugins_dir.join("by-market").join(m).join(id),
        None => plugins_dir.join(id),
    }
}

/// Serializes index.json read-modify-write across install/uninstall/list.
#[derive(Default)]
pub struct InstalledIndex(tokio::sync::Mutex<()>);

// Directories

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn index_path(dir: &Path) -> PathBuf {
    dir.join("index.json")
}

/// `<app_data>/extensions/`, the single index of external installs for both
/// kinds. Plugin bundles stay under `plugins/` and service binaries under
/// `services/`; only the index lives here.
///
/// Migration: if `extensions/index.json` is missing but the legacy
/// `plugins/index.json` exists, copy it via a temp file and rename. The
/// legacy file is left on disk for manual recovery; nothing reads it again.
fn prepare_extensions_dir(app_data: &Path) -> Result<PathBuf, String> {
    let dir = app_data.join("extensions");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let new_index = index_path(&dir);
    if !new_index.exists() {
        let legacy_index = app_data.join("plugins").join("index.json");
        if legacy_index.exists() {
            let tmp = dir.join("index.json.migrating.tmp");
            std::fs::copy(&legacy_index, &tmp).map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, &new_index).map_err(|e| e.to_string())?;
        }
    }
    Ok(dir)
}

/// Index directory, created and migrated if needed. Also used by
/// `service_host::sidecar_path` via `installed_service_bin_path`.
pub fn extensions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    prepare_extensions_dir(&app_data_dir(app)?)
}

fn plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join("plugins");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn services_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join("services");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// index.json (no Tauri dependency)

fn read_index(dir: &Path) -> Result<Vec<InstalledArtifactRecord>, String> {
    match std::fs::read_to_string(index_path(dir)) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| format!("index.json hỏng: {e}")),
        // Nothing installed yet.
        Err(_) => Ok(Vec::new()),
    }
}

/// Writes atomically (temp file, then rename) so a crash never leaves a
/// truncated index.
fn write_index(dir: &Path, records: &[InstalledArtifactRecord]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(records).map_err(|e| e.to_string())?;
    let final_path = index_path(dir);
    let tmp_path = dir.join("index.json.tmp");
    std::fs::write(&tmp_path, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &final_path).map_err(|e| e.to_string())
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    to_hex(&sha2::Sha256::digest(bytes))
}

fn is_kebab_ish(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// A value that is joined into an install path (`version`, `market_id`)
/// must stay a single directory name: semver characters only, so no `/`,
/// `\`, drive prefix (`C:`), absolute path or `..` can redirect the write
/// or the later `remove_dir_all` outside the extensions directory.
fn is_safe_path_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.starts_with('.')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+' | '_'))
}

fn validate_market_id(market_id: Option<&str>) -> Result<(), String> {
    match market_id {
        Some(m) if !is_safe_path_segment(m) => Err(format!("market_id \"{m}\" không hợp lệ")),
        _ => Ok(()),
    }
}

fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

// Plugins

/// Minimal Rust-side checks: https entry and well-formed integrity. Full
/// validation (allowlists, SDK range, route conflicts) runs again in
/// `validateManifest` on the TS side before registration.
fn validate_remote_plugin_manifest(m: &RemotePluginManifest) -> Result<(), String> {
    if !is_kebab_ish(&m.id) {
        return Err(format!("id \"{}\" phải là kebab-case", m.id));
    }
    if !is_safe_path_segment(&m.version) {
        return Err(format!("version \"{}\" không hợp lệ (chỉ chữ, số và . - + _)", m.version));
    }
    if !m.entry.starts_with("https://") {
        return Err("entry phải là URL https".to_string());
    }
    if !is_sha256_hex(&m.integrity) {
        return Err("integrity phải là sha256 dạng hex, đủ 64 ký tự".to_string());
    }
    Ok(())
}

/// Minimal checks before downloading the binary.
fn validate_remote_service_manifest(m: &RemoteServiceManifest) -> Result<(), String> {
    if !is_kebab_ish(&m.bin) {
        return Err(format!("bin \"{}\" phải là kebab-case, không đuôi mở rộng", m.bin));
    }
    if !is_safe_path_segment(&m.version) {
        return Err(format!("version \"{}\" không hợp lệ (chỉ chữ, số và . - + _)", m.version));
    }
    if m.targets.is_empty() {
        return Err("targets không được rỗng".to_string());
    }
    for (triple, target) in &m.targets {
        if !target.url.starts_with("https://") {
            return Err(format!("target \"{triple}\": url phải là https"));
        }
        if !is_sha256_hex(&target.sha256) {
            return Err(format!("target \"{triple}\": sha256 phải là hex đủ 64 ký tự"));
        }
    }
    Ok(())
}

/// Verifies the checksum, writes the bundle, and updates the index. Takes the
/// downloaded bytes so it can be tested without a server.
fn stage_install_plugin(
    index_dir: &Path,
    plugins_dir: &Path,
    manifest: RemotePluginManifest,
    source_url: String,
    market_id: Option<String>,
    bytes: &[u8],
) -> Result<InstalledArtifactRecord, String> {
    validate_remote_plugin_manifest(&manifest)?;
    validate_market_id(market_id.as_deref())?;
    let actual = sha256_hex(bytes);
    if actual != manifest.integrity.to_lowercase() {
        return Err(format!(
            "Bundle không khớp checksum đã khai trong manifest — từ chối cài. \
             Khai: {}, thực tế: {actual}",
            manifest.integrity
        ));
    }

    let plugin_dir = plugin_disk_dir(plugins_dir, market_id.as_deref(), &manifest.id).join(&manifest.version);
    std::fs::create_dir_all(&plugin_dir).map_err(|e| e.to_string())?;
    let bundle_path = plugin_dir.join("bundle.mjs");
    // Atomic write: `artifact_installer_read_bundle` reads without the index
    // lock, so an in-place write could be observed half-done. The read-time
    // checksum would catch that, but atomic writes avoid it altogether.
    let tmp_path = plugin_dir.join("bundle.mjs.tmp");
    std::fs::write(&tmp_path, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &bundle_path).map_err(|e| e.to_string())?;

    let id = manifest.id.clone();
    let new_version = manifest.version.clone();
    let record = InstalledArtifactRecord::Plugin(InstalledPluginRecord {
        manifest,
        source_url,
        bundle_path: bundle_path.to_string_lossy().into_owned(),
        installed_at: chrono::Utc::now().timestamp_millis(),
        market_id: market_id.clone(),
    });

    // Reinstalling the same (id, market_id) replaces the old record, whatever
    // the version. A different market's plugin with the same id is kept.
    let mut old_version: Option<String> = None;
    let mut records = read_index(index_dir)?;
    records.retain(|r| match r {
        InstalledArtifactRecord::Plugin(p) if p.manifest.id == id && p.market_id == market_id => {
            old_version = Some(p.manifest.version.clone());
            false
        }
        _ => true,
    });
    records.push(record.clone());
    write_index(index_dir, &records)?;

    // Remove the previous version's directory once the index is written.
    // Best effort: a failed delete (e.g. a locked file on Windows) does not
    // fail the install.
    // An index written before versions were validated may hold an unsafe
    // one; never let it steer a delete.
    if let Some(old_version) = old_version.filter(|v| is_safe_path_segment(v)) {
        if old_version != new_version {
            let _ = std::fs::remove_dir_all(plugin_disk_dir(plugins_dir, market_id.as_deref(), &id).join(&old_version));
        }
    }

    Ok(record)
}

/// The manifest's build for `triple`. Other triples are never tried.
fn target_for<'a>(manifest: &'a RemoteServiceManifest, triple: &str) -> Result<&'a ServiceTarget, String> {
    manifest.targets.get(triple).ok_or_else(|| {
        let mut available: Vec<&str> = manifest.targets.keys().map(String::as_str).collect();
        available.sort_unstable();
        format!(
            "Manifest không có bản cho nền tảng hiện tại (target đã tính: \"{triple}\"). \
             Các target manifest có: [{}]",
            available.join(", ")
        )
    })
}

fn final_bin_name(bin: &str) -> String {
    // The host picks the extension; a CDN URL may not carry a trustworthy name.
    if cfg!(windows) && !bin.to_ascii_lowercase().ends_with(".exe") {
        format!("{bin}.exe")
    } else {
        bin.to_string()
    }
}

/// Selects the build for `target_triple` (no fallback to other triples),
/// verifies its checksum, writes it atomically, marks it executable on Unix,
/// and updates the index.
///
/// Atomic writes matter more here than for bundles because the file is
/// spawned. `sidecar_path()` only looks for the final file name, so a
/// leftover `.tmp` from a crash is never executed.
fn stage_install_service(
    index_dir: &Path,
    services_dir: &Path,
    manifest: RemoteServiceManifest,
    source_url: String,
    market_id: Option<String>,
    target_triple: &str,
    bytes: &[u8],
) -> Result<InstalledArtifactRecord, String> {
    validate_remote_service_manifest(&manifest)?;
    validate_market_id(market_id.as_deref())?;
    let target = target_for(&manifest, target_triple)?;

    let actual = sha256_hex(bytes);
    if actual != target.sha256.to_lowercase() {
        return Err(format!(
            "Binary không khớp checksum đã khai cho target \"{target_triple}\" — từ chối cài. \
             Khai: {}, thực tế: {actual}",
            target.sha256
        ));
    }

    let bin_dir = services_dir.join(&manifest.bin).join(&manifest.version);
    std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
    let file_name = final_bin_name(&manifest.bin);
    let final_path = bin_dir.join(&file_name);
    let tmp_path = bin_dir.join(format!("{file_name}.tmp"));
    std::fs::write(&tmp_path, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &final_path).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&final_path)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(perms.mode() | 0o111);
        std::fs::set_permissions(&final_path, perms).map_err(|e| e.to_string())?;
    }

    let bin = manifest.bin.clone();
    let new_version = manifest.version.clone();
    let record = InstalledArtifactRecord::Service(InstalledServiceRecord {
        manifest,
        source_url,
        bin_path: final_path.to_string_lossy().into_owned(),
        installed_at: chrono::Utc::now().timestamp_millis(),
        market_id,
    });

    // Reinstalling the same bin replaces the old record; versions are not kept
    // side by side.
    let mut old_version: Option<String> = None;
    let mut records = read_index(index_dir)?;
    records.retain(|r| match r {
        InstalledArtifactRecord::Service(s) if s.manifest.bin == bin => {
            old_version = Some(s.manifest.version.clone());
            false
        }
        _ => true,
    });
    records.push(record.clone());
    write_index(index_dir, &records)?;

    // Remove the previous version's directory. The caller has already stopped
    // the running sidecar, so no process holds the old binary.
    if let Some(old_version) = old_version.filter(|v| is_safe_path_segment(v)) {
        if old_version != new_version {
            let _ = std::fs::remove_dir_all(services_dir.join(&bin).join(&old_version));
        }
    }

    Ok(record)
}

/// Removes a record from the index and deletes its files. Returns
/// `Some(bin)` for a service so the caller can stop the running process.
fn stage_uninstall(
    index_dir: &Path,
    plugins_dir: &Path,
    services_dir: &Path,
    key: &str,
    market_id: Option<&str>,
) -> Result<Option<String>, String> {
    if !is_kebab_ish(key) {
        return Err(format!("\"{key}\" không phải id hợp lệ"));
    }
    validate_market_id(market_id)?;
    let mut records = read_index(index_dir)?;
    let before = records.len();
    let mut removed: Option<InstalledArtifactRecord> = None;
    records.retain(|r| {
        // Plugins match on (id, market_id); services on bin only (see the record
        // structs).
        let matches = match r {
            InstalledArtifactRecord::Plugin(_) => r.key() == key && r.market_id() == market_id,
            InstalledArtifactRecord::Service(_) => r.key() == key,
        };
        if matches {
            removed = Some(r.clone());
            false
        } else {
            true
        }
    });
    if records.len() == before {
        return Err(format!("Không có mục \"{key}\" đang cài"));
    }
    // Update the index first; failing to delete files (e.g. locked on Windows)
    // should not block the uninstall.
    write_index(index_dir, &records)?;

    match removed {
        Some(InstalledArtifactRecord::Plugin(_)) => {
            let _ = std::fs::remove_dir_all(plugin_disk_dir(plugins_dir, market_id, key));
            Ok(None)
        }
        Some(InstalledArtifactRecord::Service(s)) => {
            // Only the binary is removed; `service-data/<bin>/` is left intact.
            let _ = std::fs::remove_dir_all(services_dir.join(&s.manifest.bin));
            Ok(Some(s.manifest.bin))
        }
        None => Ok(None),
    }
}

/// Reads an installed bundle and re-verifies its sha256 before the webview
/// executes it, in case the file changed on disk after install.
fn stage_read_bundle(index_dir: &Path, id: &str, market_id: Option<&str>) -> Result<String, String> {
    let record = read_index(index_dir)?
        .into_iter()
        .find_map(|r| match r {
            InstalledArtifactRecord::Plugin(p) if p.manifest.id == id && p.market_id.as_deref() == market_id => Some(p),
            _ => None,
        })
        .ok_or_else(|| format!("Không có plugin \"{id}\" đang cài"))?;

    let bytes =
        std::fs::read(&record.bundle_path).map_err(|e| format!("Không đọc được bundle: {e}"))?;
    if sha256_hex(&bytes) != record.manifest.integrity.to_lowercase() {
        return Err(
            "Bundle trên đĩa không còn khớp checksum lúc cài — có thể đã bị sửa. \
             Gỡ và cài lại plugin này."
                .to_string(),
        );
    }
    String::from_utf8(bytes).map_err(|e| format!("Bundle không phải UTF-8 hợp lệ: {e}"))
}

/// Path of the URL-installed binary for `bin`. Takes the index directory
/// instead of an `AppHandle` so it can be tested.
///
/// Returns `None` when there is no service record for `bin` or its file is
/// gone, so the caller falls back to the bundled sidecar.
pub fn installed_service_bin_path_at(index_dir: &Path, bin: &str) -> Option<PathBuf> {
    let records = read_index(index_dir).ok()?;
    records.into_iter().find_map(|r| match r {
        InstalledArtifactRecord::Service(s) if s.manifest.bin == bin => {
            let path = PathBuf::from(&s.bin_path);
            path.exists().then_some(path)
        }
        _ => None,
    })
}

/// Manifest URL the service was installed from, shown in the consent dialog.
/// index.json is writable by the webview, so this is informational only; the
/// trust decision is based on the binary's path and SHA-256.
pub fn installed_service_source_url_at(index_dir: &Path, bin: &str) -> Option<String> {
    read_index(index_dir).ok()?.into_iter().find_map(|r| match r {
        InstalledArtifactRecord::Service(s) if s.manifest.bin == bin => Some(s.source_url),
        _ => None,
    })
}

// Target triple

/// Rust target triple of this machine, used as the key into
/// `RemoteServiceManifest.targets`. Unsupported OS/arch combinations produce
/// a triple no manifest lists, so installation fails with a clear error.
pub fn current_target_triple() -> String {
    let arch = std::env::consts::ARCH;
    let os_suffix = match std::env::consts::OS {
        "macos" => "apple-darwin",
        "windows" => "pc-windows-msvc",
        "linux" => "unknown-linux-gnu",
        other => other,
    };
    format!("{arch}-{os_suffix}")
}

// HTTP

/// Fetches and validates a manifest. The https check lives in the command
/// below so this can be tested against a local http server.
async fn fetch_manifest_from(url: &str) -> Result<RemoteArtifactManifest, String> {
    let res = http_client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Không tải được manifest: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Server trả về {} khi tải manifest", res.status()));
    }
    let manifest: RemoteArtifactManifest = res
        .json()
        .await
        .map_err(|e| format!("Manifest không đúng định dạng: {e}"))?;
    match &manifest {
        RemoteArtifactManifest::Plugin(m) => validate_remote_plugin_manifest(m)?,
        RemoteArtifactManifest::Service(m) => validate_remote_service_manifest(m)?,
    }
    Ok(manifest)
}

// Tauri commands

/// Exposes the computed triple so Settings can show which build will be
/// installed.
#[tauri::command]
pub fn artifact_installer_current_target_triple() -> String {
    current_target_triple()
}

#[tauri::command]
pub async fn artifact_installer_fetch_manifest(url: String) -> Result<RemoteArtifactManifest, String> {
    if !url.starts_with("https://") {
        // Over plain http an attacker could swap both the manifest and its
        // checksums.
        return Err("Chỉ chấp nhận URL https".to_string());
    }
    fetch_manifest_from(&url).await
}

/// The manifest is fetched again at install time, so the source can serve
/// something other than what the user approved in the preview (different
/// permissions, hosts, bundle). The webview passes the previewed manifest;
/// any difference refuses the install.
fn check_matches_preview(
    expected: Option<&RemoteArtifactManifest>,
    fetched: &RemoteArtifactManifest,
) -> Result<(), String> {
    match expected {
        Some(e) if e != fetched => {
            Err("Manifest đã thay đổi kể từ lúc xem trước — mở lại để xem bản mới rồi mới cài.".to_string())
        }
        _ => Ok(()),
    }
}

#[tauri::command]
pub async fn artifact_installer_install(
    app: AppHandle,
    index_state: tauri::State<'_, InstalledIndex>,
    services: tauri::State<'_, crate::service_host::ServiceRegistry>,
    source_url: String,
    market_id: Option<String>,
    expected_manifest: Option<RemoteArtifactManifest>,
) -> Result<InstalledArtifactRecord, String> {
    let _guard = index_state.0.lock().await;

    let manifest = artifact_installer_fetch_manifest(source_url.clone()).await?;
    check_matches_preview(expected_manifest.as_ref(), &manifest)?;
    let index_dir = extensions_dir(&app)?;

    let record = match manifest {
        RemoteArtifactManifest::Plugin(manifest) => {
            let bytes = download_capped(&manifest.entry, MAX_DOWNLOAD_BYTES)
                .await
                .map_err(|e| format!("Không tải được bundle: {e}"))?;
            stage_install_plugin(&index_dir, &plugins_dir(&app)?, manifest, source_url, market_id, &bytes)?
        }
        RemoteArtifactManifest::Service(manifest) => {
            let triple = current_target_triple();
            let target = target_for(&manifest, &triple)?.clone();
            let bytes = download_capped(&target.url, MAX_DOWNLOAD_BYTES)
                .await
                .map_err(|e| format!("Không tải được binary: {e}"))?;
            let bin = manifest.bin.clone();
            // Stop the running sidecar before replacing files: the next
            // `service_call` respawns the new version, and Windows cannot delete
            // a binary that is still running.
            let _ = crate::service_host::service_stop(services.clone(), bin).await;
            stage_install_service(
                &index_dir,
                &services_dir(&app)?,
                manifest,
                source_url,
                market_id,
                &triple,
                &bytes,
            )?
        }
    };

    Ok(record)
}

#[tauri::command]
pub async fn artifact_installer_list(
    app: AppHandle,
    index_state: tauri::State<'_, InstalledIndex>,
) -> Result<Vec<InstalledArtifactRecord>, String> {
    // Take the lock so `list` never observes an install or uninstall
    // midway through its steps.
    let _guard = index_state.0.lock().await;
    read_index(&extensions_dir(&app)?)
}

#[tauri::command]
pub async fn artifact_installer_uninstall(
    app: AppHandle,
    index_state: tauri::State<'_, InstalledIndex>,
    services: tauri::State<'_, crate::service_host::ServiceRegistry>,
    key: String,
    market_id: Option<String>,
) -> Result<(), String> {
    let _guard = index_state.0.lock().await;
    let stopped_bin = stage_uninstall(
        &extensions_dir(&app)?,
        &plugins_dir(&app)?,
        &services_dir(&app)?,
        &key,
        market_id.as_deref(),
    )?;
    if let Some(bin) = stopped_bin {
        let _ = crate::service_host::service_stop(services.clone(), bin.clone()).await;
        // Uninstalling also revokes consent; a reinstall asks again.
        services.trust.revoke(&bin);
    }
    Ok(())
}

#[tauri::command]
pub fn artifact_installer_read_bundle(app: AppHandle, id: String, market_id: Option<String>) -> Result<String, String> {
    stage_read_bundle(&extensions_dir(&app)?, &id, market_id.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::get;
    use axum::Router;
    use tokio::net::TcpListener;
    use uuid::Uuid;

    #[test]
    fn redirect_from_https_to_http_is_a_downgrade() {
        let url = |s: &str| reqwest::Url::parse(s).unwrap();
        let https = [url("https://example.com/a.json")];
        assert!(is_scheme_downgrade(&https, &url("http://example.com/a.json")));
        assert!(!is_scheme_downgrade(&https, &url("https://cdn.example.com/a.json")));
        // Local http test servers never started on https.
        assert!(!is_scheme_downgrade(&[url("http://127.0.0.1:1/a.json")], &url("http://127.0.0.1:1/b.json")));
    }

    fn plugin_manifest(entry: &str, integrity: &str) -> RemotePluginManifest {
        RemotePluginManifest {
            id: "demo".into(),
            version: "1.0.0".into(),
            sdk: "^1.0.0".into(),
            entry: entry.into(),
            integrity: integrity.into(),
            label: "Demo".into(),
            description: "x".into(),
            icon: "puzzle".into(),
            keywords: vec![],
            route: "/demo".into(),
            permissions: vec![],
            commands: vec![],
            hosts: vec![],
            service: None,
        }
    }

    fn service_manifest(bin: &str, triple: &str, url: &str, sha256: &str) -> RemoteServiceManifest {
        let mut targets = HashMap::new();
        targets.insert(triple.to_string(), ServiceTarget { url: url.into(), sha256: sha256.into() });
        RemoteServiceManifest { bin: bin.into(), version: "1.0.0".into(), protocol: 1, targets }
    }

    /// Fresh temp directory per test.
    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("devtool-artifact-installer-test-{label}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    async fn serve_once(body: String, content_type: &'static str) -> String {
        let app = Router::new().route(
            "/",
            get(move || async move { ([(axum::http::header::CONTENT_TYPE, content_type)], body) }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        format!("http://{addr}/")
    }

    // -- Index reader --------------------------------------------------------
    #[test]
    fn service_source_url_is_read_from_index() {
        let dir = temp_dir("source-url");
        assert_eq!(installed_service_source_url_at(&dir, "devtool-svc-x"), None, "no index yet");
        let record = InstalledArtifactRecord::Service(InstalledServiceRecord {
            manifest: RemoteServiceManifest {
                bin: "devtool-svc-x".into(),
                version: "1.0.0".into(),
                protocol: 1,
                targets: HashMap::new(),
            },
            source_url: "https://example.com/svc.json".into(),
            bin_path: dir.join("x").to_string_lossy().into_owned(),
            installed_at: 0,
            market_id: None,
        });
        write_index(&dir, &[record]).unwrap();
        assert_eq!(installed_service_source_url_at(&dir, "devtool-svc-x").as_deref(), Some("https://example.com/svc.json"));
        assert_eq!(installed_service_source_url_at(&dir, "devtool-svc-y"), None);
    }

    #[test]
    fn legacy_index_without_kind_loads_as_plugins() {
        let old_record = InstalledPluginRecord {
            manifest: plugin_manifest("https://x/bundle.mjs", &"a".repeat(64)),
            source_url: "https://x/plugin.json".into(),
            bundle_path: "/app-data/plugins/demo/1.0.0/bundle.mjs".into(),
            installed_at: 1_700_000_000_000,
            market_id: None,
        };
        let legacy_json = serde_json::to_string_pretty(&vec![old_record.clone()]).unwrap();
        assert!(!legacy_json.contains("\"kind\""), "{legacy_json}");

        let dir = temp_dir("legacy-index");
        std::fs::write(index_path(&dir), &legacy_json).unwrap();

        let records = read_index(&dir).unwrap();
        assert_eq!(records.len(), 1, "không được mất bản ghi nào khi đọc index cũ");
        match &records[0] {
            InstalledArtifactRecord::Plugin(p) => assert_eq!(p, &old_record),
            other => panic!("bản ghi cũ không có kind phải mặc định thành Plugin, ra {other:?}"),
        }
    }

    #[test]
    fn index_writes_kind_on_every_record() {
        let dir = temp_dir("mixed-index");
        let plugin = InstalledArtifactRecord::Plugin(InstalledPluginRecord {
            manifest: plugin_manifest("https://x/a.mjs", &sha256_hex(b"a")),
            source_url: "https://x/a.json".into(),
            bundle_path: "/app-data/plugins/demo/1.0.0/bundle.mjs".into(),
            installed_at: 1,
            market_id: None,
        });
        let service = InstalledArtifactRecord::Service(InstalledServiceRecord {
            manifest: service_manifest("devtool-svc-demo", &current_target_triple(), "https://x/bin", &sha256_hex(b"b")),
            source_url: "https://x/b.json".into(),
            bin_path: "/app-data/services/devtool-svc-demo/1.0.0/devtool-svc-demo".into(),
            installed_at: 2,
            market_id: None,
        });
        write_index(&dir, &[plugin.clone(), service.clone()]).unwrap();

        let raw = std::fs::read_to_string(index_path(&dir)).unwrap();
        assert!(raw.contains("\"kind\": \"plugin\"") || raw.contains("\"kind\":\"plugin\""), "{raw}");
        assert!(raw.contains("\"kind\": \"service\"") || raw.contains("\"kind\":\"service\""), "{raw}");

        let records = read_index(&dir).unwrap();
        assert_eq!(records, vec![plugin, service]);
    }

    #[test]
    fn unknown_kind_is_rejected() {
        let dir = temp_dir("bad-kind");
        std::fs::write(index_path(&dir), r#"[{"kind":"khong-ro","x":1}]"#).unwrap();
        let err = read_index(&dir).unwrap_err();
        assert!(err.contains("index.json hỏng"), "{err}");
    }

    // -- Plugins ---------------------------------------------------------------

    #[test]
    fn rejects_non_kebab_case_id() {
        let mut m = plugin_manifest("https://x/a", &"a".repeat(64));
        m.id = "Demo_App".into();
        assert!(validate_remote_plugin_manifest(&m).is_err());
    }

    #[test]
    fn rejects_non_https_entry() {
        let m = plugin_manifest("http://x/a", &"a".repeat(64));
        assert!(validate_remote_plugin_manifest(&m).unwrap_err().contains("https"));
    }

    #[test]
    fn rejects_malformed_integrity() {
        for bad in ["", "khong-phai-hex", &"a".repeat(63), &"g".repeat(64)] {
            let m = plugin_manifest("https://x/a", bad);
            assert!(validate_remote_plugin_manifest(&m).is_err(), "{bad}");
        }
    }

    #[test]
    fn valid_plugin_manifest_passes() {
        let m = plugin_manifest("https://x/bundle.mjs", &"a".repeat(64));
        assert!(validate_remote_plugin_manifest(&m).is_ok());
    }

    #[tokio::test]
    async fn fetch_manifest_rejects_http() {
        let err = artifact_installer_fetch_manifest("http://example.com".into())
            .await
            .unwrap_err();
        assert!(err.contains("https"));
    }

    #[tokio::test]
    async fn fetch_manifest_reads_plugin_from_server() {
        let m = RemoteArtifactManifest::Plugin(plugin_manifest("https://x/bundle.mjs", &"b".repeat(64)));
        let url = serve_once(serde_json::to_string(&m).unwrap(), "application/json").await;

        let fetched = fetch_manifest_from(&url).await.unwrap();
        match fetched {
            RemoteArtifactManifest::Plugin(p) => assert_eq!(p.id, "demo"),
            other => panic!("phải là Plugin, ra {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_manifest_rejects_malformed_json() {
        let url = serve_once("{khong-phai-json".into(), "application/json").await;
        let err = fetch_manifest_from(&url).await.unwrap_err();
        assert!(err.contains("Manifest không đúng định dạng"));
    }

    #[tokio::test]
    async fn fetch_manifest_requires_kind() {
        // Published manifests must declare `kind`; only the installed index
        // tolerates its absence.
        let json = r#"{"id":"demo","version":"1.0.0","sdk":"^1.0.0","entry":"https://x/a.mjs","integrity":"aa","label":"Demo","description":"x","icon":"puzzle","route":"/demo"}"#;
        let url = serve_once(json.to_string(), "application/json").await;
        let err = fetch_manifest_from(&url).await.unwrap_err();
        assert!(err.contains("Manifest không đúng định dạng"), "{err}");
    }

    #[test]
    fn plugin_with_matching_checksum_is_installed() {
        let index_dir = temp_dir("plugin-ok-index");
        let plugins_dir = temp_dir("plugin-ok-bundles");
        let bytes = b"export default 1;";
        let m = plugin_manifest("https://x/bundle.mjs", &sha256_hex(bytes));

        let record = stage_install_plugin(&index_dir, &plugins_dir, m, "https://x/plugin.json".into(), None, bytes).unwrap();

        match &record {
            InstalledArtifactRecord::Plugin(p) => assert_eq!(std::fs::read(&p.bundle_path).unwrap(), bytes),
            other => panic!("{other:?}"),
        }
        assert_eq!(read_index(&index_dir).unwrap(), vec![record]);
    }

    #[test]
    fn plugin_with_wrong_checksum_is_rejected_without_writing() {
        let index_dir = temp_dir("plugin-bad-index");
        let plugins_dir = temp_dir("plugin-bad-bundles");
        let bytes = b"export default 1;";
        let m = plugin_manifest("https://x/bundle.mjs", &"0".repeat(64));

        let err = stage_install_plugin(&index_dir, &plugins_dir, m, "https://x/plugin.json".into(), None, bytes).unwrap_err();
        assert!(err.contains("không khớp checksum"), "{err}");

        assert!(read_index(&index_dir).unwrap().is_empty());
        assert!(!plugins_dir.join("demo").exists());
    }

    #[test]
    fn reinstalling_a_plugin_replaces_its_record() {
        let index_dir = temp_dir("plugin-overwrite-index");
        let plugins_dir = temp_dir("plugin-overwrite-bundles");
        let v1 = plugin_manifest("https://x/v1.mjs", &sha256_hex(b"v1"));
        stage_install_plugin(&index_dir, &plugins_dir, v1, "https://x/plugin.json".into(), None, b"v1").unwrap();

        let mut v2 = plugin_manifest("https://x/v2.mjs", &sha256_hex(b"v2"));
        v2.version = "2.0.0".into();
        stage_install_plugin(&index_dir, &plugins_dir, v2, "https://x/plugin.json".into(), None, b"v2").unwrap();

        let records = read_index(&index_dir).unwrap();
        assert_eq!(records.len(), 1, "phải chỉ còn một bản ghi cho cùng id");
        match &records[0] {
            InstalledArtifactRecord::Plugin(p) => assert_eq!(p.manifest.version, "2.0.0"),
            other => panic!("{other:?}"),
        }
        assert!(
            !plugins_dir.join("demo").join("1.0.0").exists(),
            "thư mục version CŨ phải bị dọn sau khi update, không mồ côi trên đĩa"
        );
        assert!(
            plugins_dir.join("demo").join("2.0.0").join("bundle.mjs").exists(),
            "thư mục version MỚI phải còn nguyên"
        );
    }

    /// Two markets publishing the same plugin id keep separate records and
    /// directories, and uninstalling one leaves the other.
    #[test]
    fn same_plugin_id_from_two_markets_coexists() {
        let index_dir = temp_dir("plugin-multi-market-index");
        let plugins_dir = temp_dir("plugin-multi-market-bundles");

        let official = plugin_manifest("https://official.example.com/demo.mjs", &sha256_hex(b"official"));
        stage_install_plugin(
            &index_dir,
            &plugins_dir,
            official,
            "https://official.example.com/plugin.json".into(),
            Some("official".into()),
            b"official",
        )
        .unwrap();

        let mut fork = plugin_manifest("https://fork.example.com/demo.mjs", &sha256_hex(b"fork"));
        fork.label = "Demo (fork)".into();
        stage_install_plugin(
            &index_dir,
            &plugins_dir,
            fork,
            "https://fork.example.com/plugin.json".into(),
            Some("custom-fork".into()),
            b"fork",
        )
        .unwrap();

        // Reinstalling from the same market still replaces its record.
        let mut official_v2 = plugin_manifest("https://official.example.com/demo-v2.mjs", &sha256_hex(b"official-v2"));
        official_v2.version = "2.0.0".into();
        stage_install_plugin(
            &index_dir,
            &plugins_dir,
            official_v2,
            "https://official.example.com/plugin.json".into(),
            Some("official".into()),
            b"official-v2",
        )
        .unwrap();

        let records = read_index(&index_dir).unwrap();
        assert_eq!(records.len(), 2, "hai market khác nhau phải giữ hai bản ghi riêng");
        let by_market: std::collections::HashMap<_, _> = records
            .iter()
            .map(|r| match r {
                InstalledArtifactRecord::Plugin(p) => (p.market_id.clone(), p.manifest.version.clone()),
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(by_market.get(&Some("official".to_string())), Some(&"2.0.0".to_string()));
        assert_eq!(by_market.get(&Some("custom-fork".to_string())), Some(&"1.0.0".to_string()));

        assert!(plugins_dir.join("by-market").join("official").join("demo").join("2.0.0").join("bundle.mjs").exists());
        assert!(plugins_dir.join("by-market").join("custom-fork").join("demo").join("1.0.0").join("bundle.mjs").exists());

        // Uninstalling "official" leaves "custom-fork" alone.
        let services_dir = temp_dir("plugin-multi-market-services");
        stage_uninstall(&index_dir, &plugins_dir, &services_dir, "demo", Some("official")).unwrap();
        let remaining = read_index(&index_dir).unwrap();
        assert_eq!(remaining.len(), 1);
        match &remaining[0] {
            InstalledArtifactRecord::Plugin(p) => assert_eq!(p.market_id.as_deref(), Some("custom-fork")),
            other => panic!("{other:?}"),
        }
        assert!(!plugins_dir.join("by-market").join("official").join("demo").exists());
        assert!(plugins_dir.join("by-market").join("custom-fork").join("demo").join("1.0.0").join("bundle.mjs").exists());
    }

    #[test]
    fn reading_a_modified_bundle_fails_checksum() {
        let index_dir = temp_dir("plugin-reread-index");
        let plugins_dir = temp_dir("plugin-reread-bundles");
        let bytes = b"export default 1;";
        let m = plugin_manifest("https://x/bundle.mjs", &sha256_hex(bytes));
        let record = stage_install_plugin(&index_dir, &plugins_dir, m, "https://x/plugin.json".into(), None, bytes).unwrap();
        let bundle_path = match &record {
            InstalledArtifactRecord::Plugin(p) => p.bundle_path.clone(),
            _ => unreachable!(),
        };

        assert_eq!(stage_read_bundle(&index_dir, "demo", None).unwrap(), "export default 1;");

        std::fs::write(&bundle_path, b"export default 999; // bi sua").unwrap();
        let err = stage_read_bundle(&index_dir, "demo", None).unwrap_err();
        assert!(err.contains("không còn khớp checksum"), "{err}");
    }

    #[test]
    fn uninstalling_plugin_removes_record_and_files() {
        let index_dir = temp_dir("plugin-uninstall-index");
        let plugins_dir = temp_dir("plugin-uninstall-bundles");
        let services_dir = temp_dir("plugin-uninstall-services");
        let bytes = b"export default 1;";
        let m = plugin_manifest("https://x/bundle.mjs", &sha256_hex(bytes));
        stage_install_plugin(&index_dir, &plugins_dir, m, "https://x/plugin.json".into(), None, bytes).unwrap();

        let stopped = stage_uninstall(&index_dir, &plugins_dir, &services_dir, "demo", None).unwrap();
        assert!(stopped.is_none(), "gỡ plugin không cần service_stop");

        assert!(read_index(&index_dir).unwrap().is_empty());
        assert!(!plugins_dir.join("demo").exists());
    }

    #[test]
    fn uninstalling_unknown_key_fails() {
        let index_dir = temp_dir("uninstall-missing-index");
        let plugins_dir = temp_dir("uninstall-missing-plugins");
        let services_dir = temp_dir("uninstall-missing-services");
        let err = stage_uninstall(&index_dir, &plugins_dir, &services_dir, "khong-ton-tai", None).unwrap_err();
        assert!(err.contains("Không có mục"));
    }

    // -- Services --------------------------------------------------------------

    #[test]
    fn service_is_written_atomically_and_made_executable() {
        let index_dir = temp_dir("svc-ok-index");
        let services_dir = temp_dir("svc-ok-bin");
        let triple = current_target_triple();
        let bytes = b"#!/bin/sh\necho hi\n";
        let m = service_manifest("devtool-svc-demo", &triple, "https://x/bin", &sha256_hex(bytes));

        let record = stage_install_service(&index_dir, &services_dir, m, "https://x/svc.json".into(), None, &triple, bytes).unwrap();

        let bin_path = match &record {
            InstalledArtifactRecord::Service(s) => s.bin_path.clone(),
            other => panic!("{other:?}"),
        };
        assert_eq!(std::fs::read(&bin_path).unwrap(), bytes);
        assert!(!bin_path.ends_with(".tmp"), "không được để lại tên .tmp trong bản ghi");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&bin_path).unwrap().permissions().mode();
            assert_ne!(mode & 0o111, 0, "phải có quyền thực thi sau khi cài");
        }

        assert_eq!(read_index(&index_dir).unwrap(), vec![record]);
        // No leftover .tmp after a successful install.
        assert!(std::fs::read_dir(services_dir.join("devtool-svc-demo").join("1.0.0"))
            .unwrap()
            .all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".tmp")));
    }

    #[test]
    fn service_without_build_for_this_triple_is_rejected() {
        let index_dir = temp_dir("svc-bad-triple-index");
        let services_dir = temp_dir("svc-bad-triple-bin");
        let bytes = b"binary";
        // The manifest only has a build for a different triple.
        let m = service_manifest("devtool-svc-demo", "khong-phai-triple-that", "https://x/bin", &sha256_hex(bytes));
        let triple = current_target_triple();

        let err = stage_install_service(&index_dir, &services_dir, m, "https://x/svc.json".into(), None, &triple, bytes).unwrap_err();
        assert!(err.contains(&triple), "lỗi phải nêu đúng triple đã tính: {err}");
        assert!(err.contains("không có bản"), "{err}");

        assert!(read_index(&index_dir).unwrap().is_empty());
        assert!(!services_dir.join("devtool-svc-demo").exists());
    }

    #[test]
    fn service_with_wrong_checksum_is_rejected_without_writing() {
        let index_dir = temp_dir("svc-bad-checksum-index");
        let services_dir = temp_dir("svc-bad-checksum-bin");
        let triple = current_target_triple();
        let bytes = b"binary-that";
        let m = service_manifest("devtool-svc-demo", &triple, "https://x/bin", &"0".repeat(64));

        let err = stage_install_service(&index_dir, &services_dir, m, "https://x/svc.json".into(), None, &triple, bytes).unwrap_err();
        assert!(err.contains("không khớp checksum"), "{err}");

        assert!(read_index(&index_dir).unwrap().is_empty());
        // The checksum is verified before anything is written.
        assert!(!services_dir.join("devtool-svc-demo").exists());
    }

    #[test]
    fn reinstalling_a_service_replaces_its_record() {
        let index_dir = temp_dir("svc-overwrite-index");
        let services_dir = temp_dir("svc-overwrite-bin");
        let triple = current_target_triple();

        let bytes_v1 = b"v1";
        let m1 = service_manifest("devtool-svc-demo", &triple, "https://x/v1", &sha256_hex(bytes_v1));
        stage_install_service(&index_dir, &services_dir, m1, "https://x/svc.json".into(), None, &triple, bytes_v1).unwrap();

        let bytes_v2 = b"v2-bigger-binary";
        let mut m2 = service_manifest("devtool-svc-demo", &triple, "https://x/v2", &sha256_hex(bytes_v2));
        m2.version = "2.0.0".into();
        let record2 = stage_install_service(&index_dir, &services_dir, m2, "https://x/svc.json".into(), None, &triple, bytes_v2).unwrap();

        let records = read_index(&index_dir).unwrap();
        assert_eq!(records.len(), 1, "không giữ song song hai version");
        assert_eq!(records[0], record2);
        match &records[0] {
            InstalledArtifactRecord::Service(s) => assert_eq!(s.manifest.version, "2.0.0"),
            other => panic!("{other:?}"),
        }
        assert!(
            !services_dir.join("devtool-svc-demo").join("1.0.0").exists(),
            "thư mục version CŨ phải bị dọn sau khi update, không mồ côi trên đĩa"
        );
        assert!(
            services_dir.join("devtool-svc-demo").join("2.0.0").exists(),
            "thư mục version MỚI phải còn nguyên"
        );
    }

    #[test]
    fn uninstalling_service_removes_record_and_binary() {
        let index_dir = temp_dir("svc-uninstall-index");
        let plugins_dir = temp_dir("svc-uninstall-plugins");
        let services_dir = temp_dir("svc-uninstall-bin");
        let triple = current_target_triple();
        let bytes = b"binary";
        let m = service_manifest("devtool-svc-demo", &triple, "https://x/bin", &sha256_hex(bytes));
        stage_install_service(&index_dir, &services_dir, m, "https://x/svc.json".into(), None, &triple, bytes).unwrap();

        let stopped = stage_uninstall(&index_dir, &plugins_dir, &services_dir, "devtool-svc-demo", None).unwrap();
        assert_eq!(stopped, Some("devtool-svc-demo".to_string()), "gỡ service phải báo bin cần service_stop");

        assert!(read_index(&index_dir).unwrap().is_empty());
        assert!(!services_dir.join("devtool-svc-demo").exists());
    }

    #[test]
    fn installed_service_bin_path_at_is_none_without_record_or_file() {
        let index_dir = temp_dir("svc-lookup-index");
        assert!(installed_service_bin_path_at(&index_dir, "devtool-svc-demo").is_none());

        let triple = current_target_triple();
        let services_dir = temp_dir("svc-lookup-bin");
        let bytes = b"binary";
        let m = service_manifest("devtool-svc-demo", &triple, "https://x/bin", &sha256_hex(bytes));
        stage_install_service(&index_dir, &services_dir, m, "https://x/svc.json".into(), None, &triple, bytes).unwrap();
        let found = installed_service_bin_path_at(&index_dir, "devtool-svc-demo");
        assert!(found.is_some());

        // The file was removed outside the installer: lookup must return None
        // so the caller falls back.
        std::fs::remove_file(found.unwrap()).unwrap();
        assert!(installed_service_bin_path_at(&index_dir, "devtool-svc-demo").is_none());
    }

    // -- Extensions directory migration ----------------------------------------

    #[test]
    fn legacy_index_is_migrated_without_loss() {
        let app_data = temp_dir("migrate-app-data");
        let old_record = InstalledPluginRecord {
            manifest: plugin_manifest("https://x/bundle.mjs", &sha256_hex(b"legacy")),
            source_url: "https://x/plugin.json".into(),
            bundle_path: app_data.join("plugins/demo/1.0.0/bundle.mjs").to_string_lossy().into_owned(),
            installed_at: 42,
            market_id: None,
        };
        let legacy_plugins_dir = app_data.join("plugins");
        std::fs::create_dir_all(&legacy_plugins_dir).unwrap();
        std::fs::write(
            index_path(&legacy_plugins_dir),
            serde_json::to_string_pretty(&vec![old_record.clone()]).unwrap(),
        )
        .unwrap();

        let extensions = prepare_extensions_dir(&app_data).unwrap();
        assert!(index_path(&extensions).exists(), "phải copy index cũ sang vị trí mới");
        assert!(index_path(&legacy_plugins_dir).exists(), "không xoá file cũ — giữ làm lưới an toàn");

        let records = read_index(&extensions).unwrap();
        assert_eq!(records, vec![InstalledArtifactRecord::Plugin(old_record)]);

        // Running the migration again must not overwrite the new index. A
        // second plugin with a different id distinguishes this from dedupe.
        let mut second = plugin_manifest("https://x/v2.mjs", &sha256_hex(b"v2"));
        second.id = "second-plugin".into();
        stage_install_plugin(
            &extensions,
            &app_data.join("plugins"),
            second,
            "https://x/v2.json".into(),
            None,
            b"v2",
        )
        .unwrap();
        assert_eq!(prepare_extensions_dir(&app_data).unwrap(), extensions);
        assert_eq!(read_index(&extensions).unwrap().len(), 2, "chạy lại di trú không được xoá bản ghi migrate cũ lẫn bản ghi mới");
    }

    #[test]
    fn no_legacy_index_gives_empty_extensions_dir() {
        let app_data = temp_dir("no-legacy-app-data");
        let extensions = prepare_extensions_dir(&app_data).unwrap();
        assert!(!index_path(&extensions).exists());
        assert!(read_index(&extensions).unwrap().is_empty());
    }

    // -- current_target_triple --------------------------------------------------

    #[test]
    fn current_target_triple_has_rust_format() {
        let triple = current_target_triple();
        assert!(triple.contains('-'), "{triple}");
        let os_ok = triple.ends_with("apple-darwin")
            || triple.ends_with("pc-windows-msvc")
            || triple.ends_with("unknown-linux-gnu");
        assert!(os_ok, "{triple}");
    }

    // -- write_index -----------------------------------------------------------

    #[test]
    fn write_index_leaves_no_temp_file() {
        let dir = temp_dir("write-index-atomic");
        let plugin = InstalledArtifactRecord::Plugin(InstalledPluginRecord {
            manifest: plugin_manifest("https://x/a.mjs", &sha256_hex(b"a")),
            source_url: "https://x/a.json".into(),
            bundle_path: "/app-data/plugins/demo/1.0.0/bundle.mjs".into(),
            installed_at: 1,
            market_id: None,
        });
        write_index(&dir, std::slice::from_ref(&plugin)).unwrap();

        assert!(index_path(&dir).exists());
        assert!(!dir.join("index.json.tmp").exists());
        assert_eq!(read_index(&dir).unwrap(), vec![plugin]);
    }

    // -- download_capped -------------------------------------------------------

    /// `Content-Length` over the cap is rejected before reading the body.
    #[tokio::test]
    async fn download_capped_rejects_large_content_length() {
        let url = serve_once("x".repeat(1000), "text/plain").await;
        let err = download_capped(&url, 100).await.unwrap_err();
        assert!(err.contains("quá lớn"), "{err}");
    }

    /// Without a trustworthy `Content-Length`, the streamed total is capped.
    #[tokio::test]
    async fn download_capped_rejects_stream_over_cap() {
        let app = Router::new().route(
            "/",
            get(|| async {
                // A streamed body has no Content-Length.
                let stream = futures_util::stream::iter(vec![Ok::<_, std::io::Error>(
                    axum::body::Bytes::from("x".repeat(1000)),
                )]);
                axum::body::Body::from_stream(stream)
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let err = download_capped(&format!("http://{addr}/"), 100).await.unwrap_err();
        assert!(err.contains("vượt trần"), "{err}");
    }

    #[tokio::test]
    async fn download_capped_accepts_body_within_cap() {
        let url = serve_once("hello".into(), "text/plain").await;
        let bytes = download_capped(&url, 100).await.unwrap();
        assert_eq!(bytes, b"hello");
    }
    #[test]
    fn version_and_market_id_must_be_a_single_path_segment() {
        for ok in ["1.0.0", "1.1.0-beta.1", "2.0.0+build.5", "1_0"] {
            assert!(is_safe_path_segment(ok), "{ok}");
        }
        for bad in ["", ".", "..", "../..", "../../victim", "/home/u/Documents", "a/b", "a\\b", "C:", "C:\\x", ".hidden", "1.0.0 "] {
            assert!(!is_safe_path_segment(bad), "{bad:?}");
            let mut m = plugin_manifest("https://x/a.mjs", &"a".repeat(64));
            m.version = bad.into();
            assert!(validate_remote_plugin_manifest(&m).is_err(), "plugin version {bad:?}");
            let mut s = service_manifest("devtool-svc-demo", "t", "https://x/bin", &"a".repeat(64));
            s.version = bad.into();
            assert!(validate_remote_service_manifest(&s).is_err(), "service version {bad:?}");
        }
        assert!(validate_market_id(Some("custom-1700000000-ab12")).is_ok());
        assert!(validate_market_id(Some("../escape")).is_err());
    }

    /// A manifest whose version points outside the plugins directory must
    /// not write there, and a later update must not delete it.
    #[test]
    fn plugin_version_cannot_escape_the_plugins_dir() {
        let index_dir = temp_dir("plugin-traversal-index");
        let plugins_dir = temp_dir("plugin-traversal-bundles");
        let victim = temp_dir("plugin-traversal-victim");
        std::fs::write(victim.join("thesis.docx"), b"keep").unwrap();

        let mut evil = plugin_manifest("https://x/a.mjs", &sha256_hex(b"a"));
        evil.version = victim.to_string_lossy().into_owned();
        let err = stage_install_plugin(&index_dir, &plugins_dir, evil, "https://x/p.json".into(), None, b"a").unwrap_err();
        assert!(err.contains("version"), "{err}");
        assert!(!victim.join("bundle.mjs").exists());

        let mut relative = plugin_manifest("https://x/a.mjs", &sha256_hex(b"a"));
        relative.version = "../../escape".into();
        assert!(stage_install_plugin(&index_dir, &plugins_dir, relative, "https://x/p.json".into(), None, b"a").is_err());

        let m = plugin_manifest("https://x/a.mjs", &sha256_hex(b"a"));
        assert!(stage_install_plugin(&index_dir, &plugins_dir, m, "https://x/p.json".into(), Some("../x".into()), b"a").is_err());
        assert!(read_index(&index_dir).unwrap().is_empty());
    }

    /// An index written by an older build may already hold an unsafe version;
    /// updating must not `remove_dir_all` through it.
    #[test]
    fn update_never_deletes_through_an_unsafe_recorded_version() {
        let index_dir = temp_dir("plugin-legacy-unsafe-index");
        let plugins_dir = temp_dir("plugin-legacy-unsafe-bundles");
        let victim = temp_dir("plugin-legacy-unsafe-victim");
        std::fs::write(victim.join("thesis.docx"), b"keep").unwrap();

        let mut legacy = plugin_manifest("https://x/a.mjs", &sha256_hex(b"a"));
        legacy.version = victim.to_string_lossy().into_owned();
        let record = InstalledArtifactRecord::Plugin(InstalledPluginRecord {
            manifest: legacy,
            source_url: "https://x/p.json".into(),
            bundle_path: victim.join("bundle.mjs").to_string_lossy().into_owned(),
            installed_at: 0,
            market_id: None,
        });
        write_index(&index_dir, &[record]).unwrap();

        let mut v2 = plugin_manifest("https://x/v2.mjs", &sha256_hex(b"v2"));
        v2.version = "2.0.0".into();
        stage_install_plugin(&index_dir, &plugins_dir, v2, "https://x/p.json".into(), None, b"v2").unwrap();
        assert!(victim.join("thesis.docx").exists(), "the unsafe recorded path must not be deleted");
    }

    #[test]
    fn service_version_cannot_escape_the_services_dir() {
        let index_dir = temp_dir("svc-traversal-index");
        let services_dir = temp_dir("svc-traversal-bins");
        let triple = current_target_triple();
        let mut m = service_manifest("devtool-svc-demo", &triple, "https://x/bin", &sha256_hex(b"b"));
        m.version = "../../../home/u/.local/bin".into();
        let err = stage_install_service(&index_dir, &services_dir, m, "https://x/s.json".into(), None, &triple, b"b").unwrap_err();
        assert!(err.contains("version"), "{err}");
        assert!(read_index(&index_dir).unwrap().is_empty());
    }

    #[test]
    fn uninstall_rejects_ids_and_market_ids_that_are_not_path_safe() {
        let index_dir = temp_dir("uninstall-unsafe-index");
        let plugins_dir = temp_dir("uninstall-unsafe-plugins");
        let services_dir = temp_dir("uninstall-unsafe-services");
        assert!(stage_uninstall(&index_dir, &plugins_dir, &services_dir, "../x", None).is_err());
        assert!(stage_uninstall(&index_dir, &plugins_dir, &services_dir, "demo", Some("../x")).is_err());
    }
    #[test]
    fn install_refuses_a_manifest_that_changed_since_the_preview() {
        let previewed = RemoteArtifactManifest::Plugin(plugin_manifest("https://x/a.mjs", &"a".repeat(64)));
        assert!(check_matches_preview(None, &previewed).is_ok());
        assert!(check_matches_preview(Some(&previewed), &previewed).is_ok());

        let mut widened = plugin_manifest("https://x/a.mjs", &"a".repeat(64));
        widened.permissions = vec!["secrets".into(), "http".into()];
        widened.hosts = vec!["*".into()];
        let widened = RemoteArtifactManifest::Plugin(widened);
        assert!(check_matches_preview(Some(&previewed), &widened).is_err());

        // The webview sends back what the fetch command serialized.
        let round_trip: RemoteArtifactManifest =
            serde_json::from_str(&serde_json::to_string(&previewed).unwrap()).unwrap();
        assert!(check_matches_preview(Some(&round_trip), &previewed).is_ok());
    }
}
