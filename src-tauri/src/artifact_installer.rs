// Cài đặt "artifact" từ bên ngoài — một URL người dùng cung cấp trỏ tới một
// manifest JSON mô tả HOẶC một plugin JS/TS (kind: "plugin", chạy trong
// webview), HOẶC một sidecar native (kind: "service", chạy như tiến trình
// riêng — xem service_host.rs). Đổi tên/refactor từ `plugin_installer.rs`
// (Phase 1, chỉ biết plugin) — xem docs/plans/native-sidecar-install.md cho
// bối cảnh đầy đủ và lý do gộp chung thay vì tách hai module song song.
//
// TẢI THẲNG BẰNG reqwest, không qua binding JS của `@tauri-apps/plugin-http`.
// Một gói (plugin bundle hay service binary) có thể vài MB; đẩy nó qua invoke
// dưới dạng JSON/base64 sẽ tốn thêm ~33% và giữ toàn bộ payload trong bộ nhớ ở
// cả hai phía không cần thiết. Rust tải thẳng xuống đĩa, JS chỉ nhận lại kết
// quả (bản ghi đã cài).
//
// RANH GIỚI TIN CẬY: mọi artifact hiện do chính người dùng phát hành (không mở
// cho bên thứ ba), nhưng "tải qua mạng rồi chạy trong cùng tiến trình app
// (plugin) hoặc như tiến trình con (service), không sandbox" vẫn là một lớp
// rủi ro khác hẳn "compile sẵn vào app" — một MITM hay một server lưu trữ bị
// chiếm có thể đổi nội dung mà người dùng không biết, dù chính họ đã tin tưởng
// URL gốc. `integrity`/`sha256` vì vậy là BẮT BUỘC, không phải tuỳ chọn.
// Nhánh plugin kiểm HAI LẦN (lúc cài, và lại một lần nữa mỗi khi đọc bundle để
// chạy — phòng trường hợp file trên đĩa bị sửa sau khi cài mà index.json
// không biết). Nhánh service chỉ kiểm một lần lúc cài — nó không được "đọc lại
// qua webview" như bundle JS, và bù lại bằng việc ghi ATOMIC (xem `stage_
// install_service`) để một app crash giữa chừng không bao giờ để lại một
// binary dở dang mà `sidecar_path` có thể vô tình chọn.
//
// `current_target_triple()` TÍNH Ở RUST — không nhận từ client/manifest, cùng
// nguyên tắc với `ALLOWED_SERVICES` ở service_host.rs: quyết định "chạy binary
// nào" luôn do host quyết, không phải webview hay server từ xa.
//
// Chia làm hai lớp có chủ ý: các hàm `stage_*`/`read_index`/`write_index`/
// `prepare_extensions_dir` nhận thẳng một `&Path` và không đụng gì tới Tauri —
// nhờ vậy test được bằng một thư mục tạm thật trên đĩa, không cần dựng một
// AppHandle giả (Tauri không cho dựng AppHandle độc lập ngoài một App thật, và
// không module nào khác trong crate này cố làm việc đó — xem cách
// secrets_vault.rs tách phần mật mã ra khỏi phần app_data_dir để giữ đúng quy
// ước này). Các `#[tauri::command]` chỉ còn là lớp vỏ mỏng: lấy đúng thư mục
// rồi gọi hàm pure. `installed_service_bin_path`/`installed_service_bin_path_at`
// theo đúng quy ước này để `service_host::sidecar_path` (một HÀM BIÊN GIỚI TIN
// CẬY khác) cũng test được phần "đọc index" của nó mà không cần AppHandle.

use digest::Digest;
use serde::de::{self, Deserializer};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::checksum::to_hex;

// ---------------------------------------------------------------------------
// Manifest thô lấy từ URL người dùng cung cấp
// ---------------------------------------------------------------------------

/// Nhánh plugin — hình dạng giữ NGUYÊN từ Phase 1 (`RemotePluginManifest`
/// cũ). Khác `PluginManifest` (định nghĩa ở TS, dùng cho plugin compile-time)
/// ở hai chỗ bắt buộc vì giới hạn của JSON: `icon` là TÊN icon (tra trong bảng
/// cố định ở `src/platform/installer.ts`), không phải component; và không có
/// `load` — thay vào đó là `entry`, URL tới đúng MỘT file bundle JS đã build
/// sẵn (xem lý do "một file duy nhất" ở installer.ts).
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct RemotePluginManifest {
    pub id: String,
    pub version: String,
    /// Dải version SDK, dạng "^M.m.p" — cùng cú pháp `satisfiesSdk` phía TS
    /// đã kiểm cho plugin compile-time.
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
    /// Tier B — sidecar plugin này gọi tới, khi `permissions` khai `'service'`.
    /// Bổ sung so với Phase 1 (nhánh plugin external-install từng chỉ hỗ trợ
    /// Tier A) — thiếu trường này, phía TS (`validateManifest()`) từ chối mọi
    /// plugin cài từ URL có khai `'service'` vì mismatch giữa `permissions` và
    /// `service`. `bin` ở đây vẫn phải nằm trong `ALLOWED_SERVICES`
    /// (service_host.rs) mới chạy được — trường này chỉ đi kèm allowlist
    /// METHOD, không tự cấp quyền chạy một bin mới.
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

/// Một target khả dụng của một service — một địa chỉ tải kèm checksum riêng
/// cho một target triple cụ thể (vd `x86_64-apple-darwin`).
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ServiceTarget {
    pub url: String,
    pub sha256: String,
}

/// Nhánh service — mô tả một phiên bản của một sidecar native. `bin` là TÊN
/// TRẦN, không đuôi mở rộng, không target triple (giống quy ước
/// `service.bin` phía plugin manifest ở `src/platform/types.ts`) — đuôi
/// `.exe` cho Windows do host tự thêm khi đặt tên file cuối cùng trên đĩa,
/// không lấy tên file từ URL (một URL kiểu CDN/redirect có thể không mang tên
/// file gốc nào đáng tin).
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct RemoteServiceManifest {
    pub bin: String,
    pub version: String,
    /// Phải khớp `service_host::SERVICE_PROTOCOL` để sidecar mới nói đúng
    /// khung JSONL host đang parse — không tự thi hành ở lớp cài đặt (đó là
    /// việc của lần gọi `service_call` đầu tiên, nơi cả hai phía tự khai
    /// protocol của mình), chỉ mang tính mô tả/tài liệu ở đây.
    pub protocol: u32,
    /// Khoá là target triple TÍNH THEO CHUẨN RUST (`x86_64-apple-darwin`,
    /// `aarch64-apple-darwin`, `x86_64-pc-windows-msvc`,
    /// `aarch64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`,
    /// `aarch64-unknown-linux-gnu`, …) — `current_target_triple()` bên dưới
    /// tính đúng dạng này để tra thẳng vào map, không đoán/thử biến thể khác.
    pub targets: HashMap<String, ServiceTarget>,
}

/// Manifest tổng quát — internally-tagged theo `kind`. KHÔNG cần tương thích
/// ngược ở đây (khác `InstalledArtifactRecord` bên dưới): đây là nội dung một
/// người TỰ XUẤT BẢN, tải mới mỗi lần fetch, không phải dữ liệu cũ đã nằm sẵn
/// trên máy người dùng — người viết manifest thêm `"kind": "plugin"` vào
/// manifest.json hiện có của họ là đủ để tiếp tục cài được sau bản nâng cấp
/// này.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RemoteArtifactManifest {
    Plugin(RemotePluginManifest),
    Service(RemoteServiceManifest),
}

// ---------------------------------------------------------------------------
// Bản ghi đã cài — lưu trong extensions/index.json
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct InstalledPluginRecord {
    pub manifest: RemotePluginManifest,
    /// URL gốc đã cài từ — dùng để kiểm bản mới khi người dùng bấm "Update".
    pub source_url: String,
    pub bundle_path: String,
    pub installed_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct InstalledServiceRecord {
    pub manifest: RemoteServiceManifest,
    pub source_url: String,
    pub bin_path: String,
    pub installed_at: i64,
}

/// Bản ghi tổng quát, lưu chung trong MỘT `extensions/index.json` cho cả hai
/// kind. **Reader tương thích ngược bắt buộc**: `index.json` của Phase 1
/// (mảng phẳng `InstalledPluginRecord`, KHÔNG có trường `kind`) phải đọc được
/// nguyên vẹn thành toàn bộ `Plugin(...)` — không mất một bản ghi plugin đã
/// cài nào của người dùng thật khi nâng cấp app.
///
/// `serde`'s derive cho enum có tag (`internally`/`adjacently tagged`) không
/// tự hỗ trợ "thiếu tag thì mặc định biến thể X" — nó luôn báo lỗi "missing
/// field kind" khi tag vắng mặt. Vì vậy `Deserialize` được viết TAY: peek qua
/// `serde_json::Value` trước, quyết định biến thể (mặc định `"plugin"` khi
/// không có trường `kind` — đúng thứ mọi bản ghi Phase 1 luôn là), rồi mới
/// deserialize phần còn lại đúng kiểu. `Serialize` vẫn dùng derive
/// (`#[serde(tag = "kind")]`) — chiều ghi luôn ghi tường minh cả `kind`, chỉ
/// chiều đọc cần khoan dung với dữ liệu cũ.
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
        // Vắng trường `kind` == một bản ghi Phase 1 == luôn là plugin. Đây
        // CHÍNH là dòng migration — không có bước "chuyển đổi" tách riêng nào
        // khác, đọc xong là đã ở đúng schema mới trong bộ nhớ.
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
    /// Khoá định danh trong index — id (plugin) hoặc bin (service). Chỉ hai
    /// kind khác nhau mới có thể trùng chuỗi này một cách vô hại (một plugin
    /// "redis" và một service "redis" không đụng nhau vì các hàm dùng khoá
    /// này luôn lọc kèm theo kind của chính biến thể).
    fn key(&self) -> &str {
        match self {
            InstalledArtifactRecord::Plugin(p) => &p.manifest.id,
            InstalledArtifactRecord::Service(s) => &s.manifest.bin,
        }
    }
}

/// Khoá ghi tuần tự cho index.json — hai lệnh install/uninstall chạy đồng thời
/// không được phép đọc-sửa-ghi chồng lên nhau. Dùng chung cho cả hai kind
/// (Phase 1 đã có sẵn, mở rộng phạm vi bao cả nhánh service).
#[derive(Default)]
pub struct InstalledIndex(tokio::sync::Mutex<()>);

// ---------------------------------------------------------------------------
// Thư mục trên đĩa
// ---------------------------------------------------------------------------

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn index_path(dir: &Path) -> PathBuf {
    dir.join("index.json")
}

/// `<app_data>/extensions/` — nguồn sự thật DUY NHẤT cho mọi thứ cài từ bên
/// ngoài (cả hai kind), thay `<app_data>/plugins/index.json` của Phase 1.
///
/// Quyết định về việc dời thư mục: CHỈ index.json dời sang chỗ mới; nội dung
/// bundle của plugin (`<app_data>/plugins/<id>/<version>/bundle.mjs`) ở
/// nguyên chỗ cũ — chỉ có metadata "cái gì đang được cài" là thứ cần một nơi
/// chung cho cả hai kind, còn NƠI LƯU chính artifact thì mỗi kind vẫn có
/// layout riêng (`plugins/` cho bundle JS, `services/` cho binary). Nhờ vậy
/// việc dời chỉ chạm một file duy nhất, không phải di trú toàn bộ cây thư mục
/// bundle đã cài (rủi ro I/O cao hơn hẳn cho lợi ích tương đương).
///
/// Di trú: nếu `extensions/index.json` CHƯA tồn tại nhưng
/// `plugins/index.json` (đường cũ) CÓ tồn tại, copy nó sang vị trí mới qua một
/// file `.tmp` cùng thư mục đích rồi `rename` — cùng khuôn atomic-write với
/// nhánh service bên dưới, để một crash giữa chừng chỉ để lại một `.tmp` mồ
/// côi (không phá index cũ, không phá index mới nếu index mới đã có). File cũ
/// KHÔNG bị xoá sau khi copy — không phải vì cần backward-compat lâu dài, mà
/// vì nó là một lưới an toàn miễn phí cho đúng lần nâng cấp đầu tiên: nếu
/// version app này có lỗi ở đâu đó sau bước copy, file cũ vẫn còn nguyên để
/// đọc lại thủ công.
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

/// Thư mục index đã sẵn sàng (đã tạo + di trú nếu cần) — dùng bởi các
/// `#[tauri::command]` bên dưới, và bởi `service_host::sidecar_path` (qua
/// `installed_service_bin_path`) để đọc phần `kind=service`.
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

// ---------------------------------------------------------------------------
// index.json — đọc/ghi thuần, không đụng Tauri
// ---------------------------------------------------------------------------

fn read_index(dir: &Path) -> Result<Vec<InstalledArtifactRecord>, String> {
    match std::fs::read_to_string(index_path(dir)) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| format!("index.json hỏng: {e}")),
        // Chưa cài gì bao giờ — danh sách rỗng, không phải lỗi.
        Err(_) => Ok(Vec::new()),
    }
}

fn write_index(dir: &Path, records: &[InstalledArtifactRecord]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(records).map_err(|e| e.to_string())?;
    std::fs::write(index_path(dir), json).map_err(|e| e.to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
    to_hex(&sha2::Sha256::digest(bytes))
}

fn is_kebab_ish(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

// ---------------------------------------------------------------------------
// Nhánh plugin — hành vi giữ NGUYÊN từ Phase 1
// ---------------------------------------------------------------------------

/// Kiểm tối thiểu ở tầng Rust — đủ để không tải/lưu một manifest rõ ràng hỏng
/// hoặc nguy hiểm (URL không mã hoá, integrity sai hình dạng). Kiểm ĐẦY ĐỦ
/// (allowlist native/http đúng cú pháp, dải sdk, route không đụng plugin
/// khác…) vẫn nằm ở `validateManifest` phía TS — nơi `PluginManifest` thật sự
/// được định nghĩa — chạy lại trước khi đăng ký vào registry.
fn validate_remote_plugin_manifest(m: &RemotePluginManifest) -> Result<(), String> {
    if !is_kebab_ish(&m.id) {
        return Err(format!("id \"{}\" phải là kebab-case", m.id));
    }
    if !m.entry.starts_with("https://") {
        return Err("entry phải là URL https".to_string());
    }
    if !is_sha256_hex(&m.integrity) {
        return Err("integrity phải là sha256 dạng hex, đủ 64 ký tự".to_string());
    }
    Ok(())
}

/// Cùng tinh thần kiểm tối thiểu như nhánh plugin — đủ để chặn một manifest rõ
/// ràng hỏng/nguy hiểm trước khi chạm mạng thêm lần nữa để tải binary.
fn validate_remote_service_manifest(m: &RemoteServiceManifest) -> Result<(), String> {
    if !is_kebab_ish(&m.bin) {
        return Err(format!("bin \"{}\" phải là kebab-case, không đuôi mở rộng", m.bin));
    }
    if m.version.trim().is_empty() {
        return Err("version không được rỗng".to_string());
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

/// Phần disk của việc cài plugin: kiểm checksum, ghi bundle, cập nhật index.
/// Nhận thẳng bytes đã tải — tách khỏi phần HTTP để test được bằng dữ liệu giả
/// lập mà không cần một server thật cho MỌI ca.
fn stage_install_plugin(
    index_dir: &Path,
    plugins_dir: &Path,
    manifest: RemotePluginManifest,
    source_url: String,
    bytes: &[u8],
) -> Result<InstalledArtifactRecord, String> {
    let actual = sha256_hex(bytes);
    if actual != manifest.integrity.to_lowercase() {
        return Err(format!(
            "Bundle không khớp checksum đã khai trong manifest — từ chối cài. \
             Khai: {}, thực tế: {actual}",
            manifest.integrity
        ));
    }

    let plugin_dir = plugins_dir.join(&manifest.id).join(&manifest.version);
    std::fs::create_dir_all(&plugin_dir).map_err(|e| e.to_string())?;
    let bundle_path = plugin_dir.join("bundle.mjs");
    std::fs::write(&bundle_path, bytes).map_err(|e| e.to_string())?;

    let id = manifest.id.clone();
    let record = InstalledArtifactRecord::Plugin(InstalledPluginRecord {
        manifest,
        source_url,
        bundle_path: bundle_path.to_string_lossy().into_owned(),
        installed_at: chrono::Utc::now().timestamp_millis(),
    });

    // Cài đè lên chính plugin đó (cùng id) thì thay hẳn bản ghi cũ — không giữ
    // lại hai bản ghi cho cùng một id, kể cả khác version. Chỉ lọc trong các
    // bản ghi PLUGIN — không đụng bản ghi service nào dù trùng chuỗi khoá.
    let mut records = read_index(index_dir)?;
    records.retain(|r| !matches!(r, InstalledArtifactRecord::Plugin(p) if p.manifest.id == id));
    records.push(record.clone());
    write_index(index_dir, &records)?;

    Ok(record)
}

fn final_bin_name(bin: &str) -> String {
    // Đuôi Windows do HOST quyết định, không lấy tên file từ URL — một URL
    // CDN/redirect không đảm bảo mang tên file gốc đáng tin nào.
    if cfg!(windows) && !bin.to_ascii_lowercase().ends_with(".exe") {
        format!("{bin}.exe")
    } else {
        bin.to_string()
    }
}

/// Phần disk của việc cài service: chọn target theo `target_triple` ĐÃ TÍNH
/// SẴN (không đoán/thử biến thể khác — sai/thiếu thì từ chối rõ ràng), kiểm
/// checksum, ghi ATOMIC (tải vào `.tmp` CÙNG thư mục đích rồi `rename`),
/// `chmod +x` sau khi rename xong (Unix), cập nhật index.
///
/// Ghi atomic ở đây (khác nhánh plugin, ghi thẳng): file này sẽ được SPAWN
/// như một tiến trình, một file dở dang do crash giữa chừng nguy hiểm hơn hẳn
/// một bundle JS dở dang (bundle JS dở dang chỉ hỏng lúc `import()`, không tự
/// ý chạy gì). `fs::rename` trong cùng thư mục đích là atomic trên cả ba OS
/// (cùng filesystem/volume — `bin_dir` chỉ vừa được tạo ngay phía trên, không
/// có khả năng nằm khác volume với chính nó); `sidecar_path()` chỉ bao giờ tìm
/// đúng TÊN FILE CUỐI CÙNG đã rename, nên một `.tmp` mồ côi (app crash giữa
/// `write` và `rename`) không bao giờ bị nó vô tình chọn — lần cài sau ghi đè
/// tmp cũ, không cần dọn tay.
fn stage_install_service(
    index_dir: &Path,
    services_dir: &Path,
    manifest: RemoteServiceManifest,
    source_url: String,
    target_triple: &str,
    bytes: &[u8],
) -> Result<InstalledArtifactRecord, String> {
    let target = manifest.targets.get(target_triple).ok_or_else(|| {
        let available: Vec<&str> = manifest.targets.keys().map(String::as_str).collect();
        format!(
            "Manifest không có bản cho nền tảng hiện tại (target đã tính: \"{target_triple}\"). \
             Các target manifest có: [{}]",
            available.join(", ")
        )
    })?;

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
    let record = InstalledArtifactRecord::Service(InstalledServiceRecord {
        manifest,
        source_url,
        bin_path: final_path.to_string_lossy().into_owned(),
        installed_at: chrono::Utc::now().timestamp_millis(),
    });

    // Cài đè cùng bin thì thay hẳn bản ghi cũ — theo quyết định đã chốt trong
    // plan (không giữ song song hai version; rollback = xoá cài lại thủ công).
    let mut records = read_index(index_dir)?;
    records.retain(|r| !matches!(r, InstalledArtifactRecord::Service(s) if s.manifest.bin == bin));
    records.push(record.clone());
    write_index(index_dir, &records)?;

    Ok(record)
}

/// Xoá một bản ghi (bằng id hoặc bin, tuỳ kind tìm thấy) khỏi index + dọn thư
/// mục trên đĩa tương ứng. Trả về `Some(bin)` khi bản ghi vừa gỡ là kind
/// service — để lớp gọi tự quyết định có cần `service_stop` hay không (chỉ
/// service mới có tiến trình đang chạy cần dừng).
fn stage_uninstall(
    index_dir: &Path,
    plugins_dir: &Path,
    services_dir: &Path,
    key: &str,
) -> Result<Option<String>, String> {
    let mut records = read_index(index_dir)?;
    let before = records.len();
    let mut removed: Option<InstalledArtifactRecord> = None;
    records.retain(|r| {
        if r.key() == key {
            removed = Some(r.clone());
            false
        } else {
            true
        }
    });
    if records.len() == before {
        return Err(format!("Không có mục \"{key}\" đang cài"));
    }
    // Index cập nhật xong mới là điều quan trọng — không xoá được thư mục
    // trên đĩa (Windows khoá file đang mở chẳng hạn) không nên chặn việc gỡ.
    write_index(index_dir, &records)?;

    match removed {
        Some(InstalledArtifactRecord::Plugin(_)) => {
            let _ = std::fs::remove_dir_all(plugins_dir.join(key));
            Ok(None)
        }
        Some(InstalledArtifactRecord::Service(s)) => {
            // KHÔNG đụng `service-data/<bin>/` (dữ liệu runtime của sidecar) —
            // theo quyết định đã chốt trong plan; chỉ xoá binary đã tải về.
            let _ = std::fs::remove_dir_all(services_dir.join(&s.manifest.bin));
            Ok(Some(s.manifest.bin))
        }
        None => Ok(None),
    }
}

/// Đọc lại nội dung bundle plugin đã cài, kiểm sha256 LẦN NỮA trước khi trả về
/// cho webview thực thi — phòng thủ chiều sâu, không phải kiểm tra thừa: file
/// trên đĩa có thể bị sửa sau khi cài (thủ công, hay bởi phần mềm khác) mà
/// index.json không biết. Chỉ có nghĩa với kind=plugin — service không có khái
/// niệm "đọc bundle để webview `import()`".
fn stage_read_bundle(index_dir: &Path, id: &str) -> Result<String, String> {
    let record = read_index(index_dir)?
        .into_iter()
        .find_map(|r| match r {
            InstalledArtifactRecord::Plugin(p) if p.manifest.id == id => Some(p),
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

/// Đường dẫn binary đã cài qua URL cho `bin`, THUẦN — nhận thẳng thư mục
/// `extensions/` thay vì `AppHandle`, để `service_host.rs`'s test (không dựng
/// được AppHandle giả — xem lời giải thích đầu file) kiểm được đúng thứ tự ưu
/// tiên "tải-về-trước" mà không cần chạy trong một app Tauri thật.
///
/// Trả `None` khi: không có bản ghi kind=service cho `bin`, HOẶC có bản ghi
/// nhưng file trên đĩa không còn (bị xoá/hỏng đĩa ngoài luồng cài đặt) — cả
/// hai ca đều phải rơi xuống fallback cạnh-exe ở lớp gọi, không phải panic hay
/// trả một đường dẫn không tồn tại.
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

// ---------------------------------------------------------------------------
// current_target_triple — TÍNH Ở RUST, không nhận từ client/manifest
// ---------------------------------------------------------------------------

/// Target triple của máy đang chạy app, dạng chuẩn Rust — dùng để tra thẳng
/// vào `RemoteServiceManifest.targets`. Không đoán/thử biến thể khác: một
/// combo OS/ARCH không nằm trong bảng dưới đây là một nền tảng app này chưa
/// hỗ trợ sidecar tải-về, và nên báo lỗi rõ ràng thay vì đoán bừa.
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

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/// Phần HTTP của việc fetch, tách khỏi kiểm tra scheme ở lệnh công khai bên
/// dưới — để test được bằng một server cục bộ thật (luôn là http, không có
/// TLS) mà không phải nới lỏng chính điều kiện https đang được kiểm.
async fn fetch_manifest_from(url: &str) -> Result<RemoteArtifactManifest, String> {
    let res = reqwest::get(url)
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

// ---------------------------------------------------------------------------
// #[tauri::command] — lớp vỏ mỏng
// ---------------------------------------------------------------------------

/// Lớp vỏ mỏng expose `current_target_triple()` cho TS đọc được — Settings UI
/// (nhánh xem trước manifest `kind=service`) hiển thị nó để người dùng tự xác
/// nhận có target khớp máy mình trước khi bấm cài, không đoán trước ở phía
/// webview (nguyên tắc "quyết định luôn do host" áp dụng cả cho việc hiển thị,
/// không chỉ việc thực thi).
#[tauri::command]
pub fn artifact_installer_current_target_triple() -> String {
    current_target_triple()
}

#[tauri::command]
pub async fn artifact_installer_fetch_manifest(url: String) -> Result<RemoteArtifactManifest, String> {
    if !url.starts_with("https://") {
        // Không chỉ để nhất quán: http không mã hoá thì kiểm checksum ở bước
        // tải bundle/binary sau đó cũng vô nghĩa — kẻ đứng giữa đổi được cả
        // hai.
        return Err("Chỉ chấp nhận URL https".to_string());
    }
    fetch_manifest_from(&url).await
}

#[tauri::command]
pub async fn artifact_installer_install(
    app: AppHandle,
    index_state: tauri::State<'_, InstalledIndex>,
    services: tauri::State<'_, crate::service_host::ServiceRegistry>,
    source_url: String,
) -> Result<InstalledArtifactRecord, String> {
    let _guard = index_state.0.lock().await;

    let manifest = artifact_installer_fetch_manifest(source_url.clone()).await?;
    let index_dir = extensions_dir(&app)?;

    let record = match manifest {
        RemoteArtifactManifest::Plugin(manifest) => {
            let res = reqwest::get(&manifest.entry)
                .await
                .map_err(|e| format!("Không tải được bundle: {e}"))?;
            if !res.status().is_success() {
                return Err(format!("Server trả về {} khi tải bundle", res.status()));
            }
            let bytes = res.bytes().await.map_err(|e| e.to_string())?;
            stage_install_plugin(&index_dir, &plugins_dir(&app)?, manifest, source_url, &bytes)?
        }
        RemoteArtifactManifest::Service(manifest) => {
            let triple = current_target_triple();
            let target = manifest.targets.get(&triple).cloned().ok_or_else(|| {
                let available: Vec<&str> = manifest.targets.keys().map(String::as_str).collect();
                format!(
                    "Manifest không có bản cho nền tảng hiện tại (target đã tính: \"{triple}\"). \
                     Các target manifest có: [{}]",
                    available.join(", ")
                )
            })?;
            let res = reqwest::get(&target.url)
                .await
                .map_err(|e| format!("Không tải được binary: {e}"))?;
            if !res.status().is_success() {
                return Err(format!("Server trả về {} khi tải binary", res.status()));
            }
            let bytes = res.bytes().await.map_err(|e| e.to_string())?;
            let bin = manifest.bin.clone();
            let record = stage_install_service(
                &index_dir,
                &services_dir(&app)?,
                manifest,
                source_url,
                &triple,
                &bytes,
            )?;
            // Cài đè một sidecar ĐANG CHẠY: dừng ngay để lần `service_call` kế
            // tiếp tự spawn lại đúng version mới (hành vi self-healing sẵn có
            // của `get_or_spawn`) — không làm việc này thì tiến trình cũ vẫn
            // sống và phục vụ version cũ cho tới khi app restart.
            let _ = crate::service_host::service_stop(services.clone(), bin).await;
            record
        }
    };

    Ok(record)
}

#[tauri::command]
pub fn artifact_installer_list(app: AppHandle) -> Result<Vec<InstalledArtifactRecord>, String> {
    read_index(&extensions_dir(&app)?)
}

#[tauri::command]
pub async fn artifact_installer_uninstall(
    app: AppHandle,
    index_state: tauri::State<'_, InstalledIndex>,
    services: tauri::State<'_, crate::service_host::ServiceRegistry>,
    key: String,
) -> Result<(), String> {
    let _guard = index_state.0.lock().await;
    let stopped_bin = stage_uninstall(
        &extensions_dir(&app)?,
        &plugins_dir(&app)?,
        &services_dir(&app)?,
        &key,
    )?;
    if let Some(bin) = stopped_bin {
        // Sidecar đang chạy (nếu có) bị dừng ngay — xem AC8.
        let _ = crate::service_host::service_stop(services.clone(), bin).await;
    }
    Ok(())
}

#[tauri::command]
pub fn artifact_installer_read_bundle(app: AppHandle, id: String) -> Result<String, String> {
    stage_read_bundle(&extensions_dir(&app)?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::get;
    use axum::Router;
    use tokio::net::TcpListener;
    use uuid::Uuid;

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
        }
    }

    fn service_manifest(bin: &str, triple: &str, url: &str, sha256: &str) -> RemoteServiceManifest {
        let mut targets = HashMap::new();
        targets.insert(triple.to_string(), ServiceTarget { url: url.into(), sha256: sha256.into() });
        RemoteServiceManifest { bin: bin.into(), version: "1.0.0".into(), protocol: 1, targets }
    }

    /// Thư mục tạm thật trên đĩa, riêng cho mỗi test — không cần AppHandle,
    /// chỉ cần đúng cái mà `stage_*` thực sự nhận: một `&Path`.
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

    // -- Task 1: migration reader --------------------------------------------

    /// Hình dạng JSON ĐÚNG NHƯ `plugin_installer.rs` (Phase 1) từng ghi ra:
    /// một mảng phẳng `InstalledPluginRecord`, không có trường `kind` nào cả.
    /// Không dùng dữ liệu bịa: đi qua đúng `InstalledPluginRecord` +
    /// `serde_json::to_string_pretty`, đúng những gì `write_index` bản cũ đã
    /// làm.
    #[test]
    fn doc_index_json_cu_khong_co_kind_tu_dong_thanh_toan_bo_plugin() {
        let old_record = InstalledPluginRecord {
            manifest: plugin_manifest("https://x/bundle.mjs", &"a".repeat(64)),
            source_url: "https://x/plugin.json".into(),
            bundle_path: "/app-data/plugins/demo/1.0.0/bundle.mjs".into(),
            installed_at: 1_700_000_000_000,
        };
        let legacy_json = serde_json::to_string_pretty(&vec![old_record.clone()]).unwrap();
        // Xác nhận trước hết rằng đây đúng là hình dạng KHÔNG có "kind" —
        // nếu giả định này sai thì cả bài test mất ý nghĩa.
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
    fn doc_index_json_moi_co_kind_o_moi_ban_ghi() {
        let dir = temp_dir("mixed-index");
        let plugin = InstalledArtifactRecord::Plugin(InstalledPluginRecord {
            manifest: plugin_manifest("https://x/a.mjs", &sha256_hex(b"a")),
            source_url: "https://x/a.json".into(),
            bundle_path: "/app-data/plugins/demo/1.0.0/bundle.mjs".into(),
            installed_at: 1,
        });
        let service = InstalledArtifactRecord::Service(InstalledServiceRecord {
            manifest: service_manifest("devtool-svc-demo", &current_target_triple(), "https://x/bin", &sha256_hex(b"b")),
            source_url: "https://x/b.json".into(),
            bin_path: "/app-data/services/devtool-svc-demo/1.0.0/devtool-svc-demo".into(),
            installed_at: 2,
        });
        write_index(&dir, &[plugin.clone(), service.clone()]).unwrap();

        let raw = std::fs::read_to_string(index_path(&dir)).unwrap();
        assert!(raw.contains("\"kind\": \"plugin\"") || raw.contains("\"kind\":\"plugin\""), "{raw}");
        assert!(raw.contains("\"kind\": \"service\"") || raw.contains("\"kind\":\"service\""), "{raw}");

        let records = read_index(&dir).unwrap();
        assert_eq!(records, vec![plugin, service]);
    }

    #[test]
    fn kind_la_bi_tu_choi_ro_rang_khong_panic() {
        let dir = temp_dir("bad-kind");
        std::fs::write(index_path(&dir), r#"[{"kind":"khong-ro","x":1}]"#).unwrap();
        let err = read_index(&dir).unwrap_err();
        assert!(err.contains("index.json hỏng"), "{err}");
    }

    // -- Nhánh plugin: không regress so với Phase 1 --------------------------

    #[test]
    fn tu_choi_id_khong_phai_kebab_case() {
        let mut m = plugin_manifest("https://x/a", &"a".repeat(64));
        m.id = "Demo_App".into();
        assert!(validate_remote_plugin_manifest(&m).is_err());
    }

    #[test]
    fn tu_choi_entry_khong_phai_https() {
        let m = plugin_manifest("http://x/a", &"a".repeat(64));
        assert!(validate_remote_plugin_manifest(&m).unwrap_err().contains("https"));
    }

    #[test]
    fn tu_choi_integrity_sai_hinh_dang() {
        for bad in ["", "khong-phai-hex", &"a".repeat(63), &"g".repeat(64)] {
            let m = plugin_manifest("https://x/a", bad);
            assert!(validate_remote_plugin_manifest(&m).is_err(), "{bad}");
        }
    }

    #[test]
    fn plugin_manifest_hop_le_qua_duoc_kiem() {
        let m = plugin_manifest("https://x/bundle.mjs", &"a".repeat(64));
        assert!(validate_remote_plugin_manifest(&m).is_ok());
    }

    #[tokio::test]
    async fn fetch_manifest_tu_choi_http() {
        let err = artifact_installer_fetch_manifest("http://example.com".into())
            .await
            .unwrap_err();
        assert!(err.contains("https"));
    }

    #[tokio::test]
    async fn fetch_manifest_plugin_that_qua_server_that() {
        let m = RemoteArtifactManifest::Plugin(plugin_manifest("https://x/bundle.mjs", &"b".repeat(64)));
        let url = serve_once(serde_json::to_string(&m).unwrap(), "application/json").await;

        let fetched = fetch_manifest_from(&url).await.unwrap();
        match fetched {
            RemoteArtifactManifest::Plugin(p) => assert_eq!(p.id, "demo"),
            other => panic!("phải là Plugin, ra {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_manifest_tu_choi_json_hong() {
        let url = serve_once("{khong-phai-json".into(), "application/json").await;
        let err = fetch_manifest_from(&url).await.unwrap_err();
        assert!(err.contains("Manifest không đúng định dạng"));
    }

    #[tokio::test]
    async fn fetch_manifest_thieu_kind_bi_tu_choi() {
        // Manifest KHÔNG có "kind" — khác `InstalledArtifactRecord` (index nội
        // bộ, phải khoan dung với dữ liệu Phase 1), một manifest TỰ XUẤT BẢN
        // qua mạng là nội dung MỚI mỗi lần fetch, nên bắt buộc "kind" tường
        // minh kể từ bản này — không có gánh nặng tương thích ngược nào ở đây.
        let json = r#"{"id":"demo","version":"1.0.0","sdk":"^1.0.0","entry":"https://x/a.mjs","integrity":"aa","label":"Demo","description":"x","icon":"puzzle","route":"/demo"}"#;
        let url = serve_once(json.to_string(), "application/json").await;
        let err = fetch_manifest_from(&url).await.unwrap_err();
        assert!(err.contains("Manifest không đúng định dạng"), "{err}");
    }

    #[test]
    fn cai_plugin_dung_checksum_thi_ghi_bundle_va_cap_nhat_index() {
        let index_dir = temp_dir("plugin-ok-index");
        let plugins_dir = temp_dir("plugin-ok-bundles");
        let bytes = b"export default 1;";
        let m = plugin_manifest("https://x/bundle.mjs", &sha256_hex(bytes));

        let record = stage_install_plugin(&index_dir, &plugins_dir, m, "https://x/plugin.json".into(), bytes).unwrap();

        match &record {
            InstalledArtifactRecord::Plugin(p) => assert_eq!(std::fs::read(&p.bundle_path).unwrap(), bytes),
            other => panic!("{other:?}"),
        }
        assert_eq!(read_index(&index_dir).unwrap(), vec![record]);
    }

    #[test]
    fn cai_plugin_sai_checksum_thi_tu_choi_va_khong_ghi_gi_xuong_dia() {
        let index_dir = temp_dir("plugin-bad-index");
        let plugins_dir = temp_dir("plugin-bad-bundles");
        let bytes = b"export default 1;";
        let m = plugin_manifest("https://x/bundle.mjs", &"0".repeat(64));

        let err = stage_install_plugin(&index_dir, &plugins_dir, m, "https://x/plugin.json".into(), bytes).unwrap_err();
        assert!(err.contains("không khớp checksum"), "{err}");

        assert!(read_index(&index_dir).unwrap().is_empty());
        assert!(!plugins_dir.join("demo").exists());
    }

    #[test]
    fn cai_de_cung_id_plugin_thi_thay_ban_ghi_cu_khong_cong_don() {
        let index_dir = temp_dir("plugin-overwrite-index");
        let plugins_dir = temp_dir("plugin-overwrite-bundles");
        let v1 = plugin_manifest("https://x/v1.mjs", &sha256_hex(b"v1"));
        stage_install_plugin(&index_dir, &plugins_dir, v1, "https://x/plugin.json".into(), b"v1").unwrap();

        let mut v2 = plugin_manifest("https://x/v2.mjs", &sha256_hex(b"v2"));
        v2.version = "2.0.0".into();
        stage_install_plugin(&index_dir, &plugins_dir, v2, "https://x/plugin.json".into(), b"v2").unwrap();

        let records = read_index(&index_dir).unwrap();
        assert_eq!(records.len(), 1, "phải chỉ còn một bản ghi cho cùng id");
        match &records[0] {
            InstalledArtifactRecord::Plugin(p) => assert_eq!(p.manifest.version, "2.0.0"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn doc_bundle_kiem_lai_checksum_bat_duoc_file_bi_sua_sau_khi_cai() {
        let index_dir = temp_dir("plugin-reread-index");
        let plugins_dir = temp_dir("plugin-reread-bundles");
        let bytes = b"export default 1;";
        let m = plugin_manifest("https://x/bundle.mjs", &sha256_hex(bytes));
        let record = stage_install_plugin(&index_dir, &plugins_dir, m, "https://x/plugin.json".into(), bytes).unwrap();
        let bundle_path = match &record {
            InstalledArtifactRecord::Plugin(p) => p.bundle_path.clone(),
            _ => unreachable!(),
        };

        assert_eq!(stage_read_bundle(&index_dir, "demo").unwrap(), "export default 1;");

        std::fs::write(&bundle_path, b"export default 999; // bi sua").unwrap();
        let err = stage_read_bundle(&index_dir, "demo").unwrap_err();
        assert!(err.contains("không còn khớp checksum"), "{err}");
    }

    #[test]
    fn go_plugin_xoa_ca_index_lan_thu_muc() {
        let index_dir = temp_dir("plugin-uninstall-index");
        let plugins_dir = temp_dir("plugin-uninstall-bundles");
        let services_dir = temp_dir("plugin-uninstall-services");
        let bytes = b"export default 1;";
        let m = plugin_manifest("https://x/bundle.mjs", &sha256_hex(bytes));
        stage_install_plugin(&index_dir, &plugins_dir, m, "https://x/plugin.json".into(), bytes).unwrap();

        let stopped = stage_uninstall(&index_dir, &plugins_dir, &services_dir, "demo").unwrap();
        assert!(stopped.is_none(), "gỡ plugin không cần service_stop");

        assert!(read_index(&index_dir).unwrap().is_empty());
        assert!(!plugins_dir.join("demo").exists());
    }

    #[test]
    fn go_muc_khong_ton_tai_thi_bao_loi_ro_rang() {
        let index_dir = temp_dir("uninstall-missing-index");
        let plugins_dir = temp_dir("uninstall-missing-plugins");
        let services_dir = temp_dir("uninstall-missing-services");
        let err = stage_uninstall(&index_dir, &plugins_dir, &services_dir, "khong-ton-tai").unwrap_err();
        assert!(err.contains("Không có mục"));
    }

    // -- Nhánh service --------------------------------------------------------

    #[test]
    fn cai_service_dung_target_thi_tai_ghi_atomic_chmod_va_cap_nhat_index() {
        let index_dir = temp_dir("svc-ok-index");
        let services_dir = temp_dir("svc-ok-bin");
        let triple = current_target_triple();
        let bytes = b"#!/bin/sh\necho hi\n";
        let m = service_manifest("devtool-svc-demo", &triple, "https://x/bin", &sha256_hex(bytes));

        let record = stage_install_service(&index_dir, &services_dir, m, "https://x/svc.json".into(), &triple, bytes).unwrap();

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
        // Không để lại .tmp mồ côi sau khi cài thành công.
        assert!(std::fs::read_dir(services_dir.join("devtool-svc-demo").join("1.0.0"))
            .unwrap()
            .all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".tmp")));
    }

    #[test]
    fn cai_service_sai_target_triple_thi_tu_choi_neu_ro_va_khong_ghi_gi() {
        let index_dir = temp_dir("svc-bad-triple-index");
        let services_dir = temp_dir("svc-bad-triple-bin");
        let bytes = b"binary";
        // Manifest chỉ có target cho một triple KHÁC triple máy đang chạy.
        let m = service_manifest("devtool-svc-demo", "khong-phai-triple-that", "https://x/bin", &sha256_hex(bytes));
        let triple = current_target_triple();

        let err = stage_install_service(&index_dir, &services_dir, m, "https://x/svc.json".into(), &triple, bytes).unwrap_err();
        assert!(err.contains(&triple), "lỗi phải nêu đúng triple đã tính: {err}");
        assert!(err.contains("không có bản"), "{err}");

        assert!(read_index(&index_dir).unwrap().is_empty());
        assert!(!services_dir.join("devtool-svc-demo").exists());
    }

    #[test]
    fn cai_service_sai_checksum_thi_tu_choi_xoa_tmp_khong_co_ban_ghi_moi() {
        let index_dir = temp_dir("svc-bad-checksum-index");
        let services_dir = temp_dir("svc-bad-checksum-bin");
        let triple = current_target_triple();
        let bytes = b"binary-that";
        let m = service_manifest("devtool-svc-demo", &triple, "https://x/bin", &"0".repeat(64));

        let err = stage_install_service(&index_dir, &services_dir, m, "https://x/svc.json".into(), &triple, bytes).unwrap_err();
        assert!(err.contains("không khớp checksum"), "{err}");

        assert!(read_index(&index_dir).unwrap().is_empty());
        // Checksum được kiểm TRƯỚC khi ghi bất cứ gì xuống đĩa — thư mục bin
        // không được tạo ra, không có .tmp mồ côi nào để "xoá" thêm bước nào.
        assert!(!services_dir.join("devtool-svc-demo").exists());
    }

    #[test]
    fn cai_de_cung_bin_thi_thay_han_ban_ghi_cu_khong_giu_song_song() {
        let index_dir = temp_dir("svc-overwrite-index");
        let services_dir = temp_dir("svc-overwrite-bin");
        let triple = current_target_triple();

        let bytes_v1 = b"v1";
        let m1 = service_manifest("devtool-svc-demo", &triple, "https://x/v1", &sha256_hex(bytes_v1));
        stage_install_service(&index_dir, &services_dir, m1, "https://x/svc.json".into(), &triple, bytes_v1).unwrap();

        let bytes_v2 = b"v2-bigger-binary";
        let mut m2 = service_manifest("devtool-svc-demo", &triple, "https://x/v2", &sha256_hex(bytes_v2));
        m2.version = "2.0.0".into();
        let record2 = stage_install_service(&index_dir, &services_dir, m2, "https://x/svc.json".into(), &triple, bytes_v2).unwrap();

        let records = read_index(&index_dir).unwrap();
        assert_eq!(records.len(), 1, "không giữ song song hai version");
        assert_eq!(records[0], record2);
        match &records[0] {
            InstalledArtifactRecord::Service(s) => assert_eq!(s.manifest.version, "2.0.0"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn go_service_xoa_index_va_thu_muc_nhung_khong_dung_service_data() {
        let index_dir = temp_dir("svc-uninstall-index");
        let plugins_dir = temp_dir("svc-uninstall-plugins");
        let services_dir = temp_dir("svc-uninstall-bin");
        let triple = current_target_triple();
        let bytes = b"binary";
        let m = service_manifest("devtool-svc-demo", &triple, "https://x/bin", &sha256_hex(bytes));
        stage_install_service(&index_dir, &services_dir, m, "https://x/svc.json".into(), &triple, bytes).unwrap();

        let stopped = stage_uninstall(&index_dir, &plugins_dir, &services_dir, "devtool-svc-demo").unwrap();
        assert_eq!(stopped, Some("devtool-svc-demo".to_string()), "gỡ service phải báo bin cần service_stop");

        assert!(read_index(&index_dir).unwrap().is_empty());
        assert!(!services_dir.join("devtool-svc-demo").exists());
    }

    #[test]
    fn installed_service_bin_path_at_tra_none_khi_khong_co_ban_ghi_hoac_file_mat() {
        let index_dir = temp_dir("svc-lookup-index");
        assert!(installed_service_bin_path_at(&index_dir, "devtool-svc-demo").is_none());

        let triple = current_target_triple();
        let services_dir = temp_dir("svc-lookup-bin");
        let bytes = b"binary";
        let m = service_manifest("devtool-svc-demo", &triple, "https://x/bin", &sha256_hex(bytes));
        stage_install_service(&index_dir, &services_dir, m, "https://x/svc.json".into(), &triple, bytes).unwrap();
        let found = installed_service_bin_path_at(&index_dir, "devtool-svc-demo");
        assert!(found.is_some());

        // File bị xoá ngoài luồng cài đặt (đĩa hỏng/thủ công) — index vẫn nói
        // đã cài, nhưng lookup phải trả None để lớp gọi rơi xuống fallback,
        // không trả một đường dẫn không tồn tại.
        std::fs::remove_file(found.unwrap()).unwrap();
        assert!(installed_service_bin_path_at(&index_dir, "devtool-svc-demo").is_none());
    }

    // -- Di trú extensions dir -------------------------------------------------

    #[test]
    fn di_tru_index_cu_tu_plugins_sang_extensions_khong_mat_du_lieu() {
        let app_data = temp_dir("migrate-app-data");
        let old_record = InstalledPluginRecord {
            manifest: plugin_manifest("https://x/bundle.mjs", &sha256_hex(b"legacy")),
            source_url: "https://x/plugin.json".into(),
            bundle_path: app_data.join("plugins/demo/1.0.0/bundle.mjs").to_string_lossy().into_owned(),
            installed_at: 42,
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

        // Chạy lại lần hai (khởi động app lần sau) không được ghi đè mất bản
        // ghi MỚI đã có ở vị trí đích — idempotent. Cài thêm một plugin id
        // KHÁC (không phải "demo") để phân biệt rõ "mất bản ghi migrate" với
        // "dedupe đúng theo id" (đã có test riêng cho dedupe ở trên).
        let mut second = plugin_manifest("https://x/v2.mjs", &sha256_hex(b"v2"));
        second.id = "second-plugin".into();
        stage_install_plugin(
            &extensions,
            &app_data.join("plugins"),
            second,
            "https://x/v2.json".into(),
            b"v2",
        )
        .unwrap();
        assert_eq!(prepare_extensions_dir(&app_data).unwrap(), extensions);
        assert_eq!(read_index(&extensions).unwrap().len(), 2, "chạy lại di trú không được xoá bản ghi migrate cũ lẫn bản ghi mới");
    }

    #[test]
    fn khong_co_index_cu_thi_extensions_dir_rong_khong_loi() {
        let app_data = temp_dir("no-legacy-app-data");
        let extensions = prepare_extensions_dir(&app_data).unwrap();
        assert!(!index_path(&extensions).exists());
        assert!(read_index(&extensions).unwrap().is_empty());
    }

    // -- current_target_triple --------------------------------------------------

    #[test]
    fn current_target_triple_dung_dinh_dang_chuan_rust() {
        let triple = current_target_triple();
        assert!(triple.contains('-'), "{triple}");
        let os_ok = triple.ends_with("apple-darwin")
            || triple.ends_with("pc-windows-msvc")
            || triple.ends_with("unknown-linux-gnu");
        assert!(os_ok, "{triple}");
    }
}
