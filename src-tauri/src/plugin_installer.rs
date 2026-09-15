// Cài đặt plugin từ bên ngoài — tải từ một URL người dùng cung cấp, xác minh
// checksum, lưu cục bộ, và đọc lại cho webview thực thi.
//
// TẢI THẲNG BẰNG reqwest, không qua binding JS của `@tauri-apps/plugin-http`.
// Một gói plugin có thể vài MB; đẩy nó qua invoke dưới dạng JSON/base64 sẽ tốn
// thêm ~33% và giữ toàn bộ payload trong bộ nhớ ở cả hai phía không cần
// thiết. Rust tải thẳng xuống đĩa, JS chỉ nhận lại kết quả (bản ghi đã cài).
//
// RANH GIỚI TIN CẬY: mọi plugin hiện do chính người dùng phát hành (không mở
// cho bên thứ ba), nhưng "tải qua mạng rồi chạy trong cùng tiến trình app,
// không sandbox" vẫn là một lớp rủi ro khác hẳn "compile sẵn vào app" — một
// MITM hay một server lưu trữ bị chiếm có thể đổi nội dung bundle mà người
// dùng không biết, dù chính họ đã tin tưởng URL gốc. `integrity` (sha256) vì
// vậy là BẮT BUỘC, không phải tuỳ chọn, và được kiểm HAI LẦN: lúc cài, và lại
// một lần nữa mỗi khi đọc bundle để chạy (phòng trường hợp file trên đĩa bị
// sửa sau khi cài mà index.json không biết).
//
// Chia làm hai lớp có chủ ý: các hàm `stage_*`/`read_index`/`write_index`
// nhận thẳng một `&Path` và không đụng gì tới Tauri — nhờ vậy test được bằng
// một thư mục tạm thật trên đĩa, không cần dựng một AppHandle giả (Tauri
// không cho dựng AppHandle độc lập ngoài một App thật, và không module nào
// khác trong crate này cố làm việc đó — xem cách secrets_vault.rs tách phần
// mật mã ra khỏi phần app_data_dir để giữ đúng quy ước này). Các `#[tauri::
// command]` chỉ còn là lớp vỏ mỏng: lấy `plugins_dir(&app)` rồi gọi hàm pure.

use digest::Digest;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::checksum::to_hex;

/// Manifest thô lấy từ URL người dùng cung cấp — mô tả một phiên bản của một
/// plugin cài từ bên ngoài.
///
/// Khác `PluginManifest` (định nghĩa ở TS, dùng cho plugin compile-time) ở
/// hai chỗ bắt buộc vì giới hạn của JSON: `icon` là TÊN icon (tra trong bảng
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
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct InstalledPluginRecord {
    pub manifest: RemotePluginManifest,
    /// URL gốc đã cài từ — dùng để kiểm bản mới khi người dùng bấm "Update".
    pub source_url: String,
    pub bundle_path: String,
    pub installed_at: i64,
}

/// Khoá ghi tuần tự cho index.json — hai lệnh install/uninstall chạy đồng thời
/// không được phép đọc-sửa-ghi chồng lên nhau.
#[derive(Default)]
pub struct InstalledIndex(tokio::sync::Mutex<()>);

fn plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn index_path(dir: &Path) -> PathBuf {
    dir.join("index.json")
}

fn read_index(dir: &Path) -> Result<Vec<InstalledPluginRecord>, String> {
    match std::fs::read_to_string(index_path(dir)) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| format!("index.json hỏng: {e}")),
        // Chưa cài plugin nào bao giờ — danh sách rỗng, không phải lỗi.
        Err(_) => Ok(Vec::new()),
    }
}

fn write_index(dir: &Path, records: &[InstalledPluginRecord]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(records).map_err(|e| e.to_string())?;
    std::fs::write(index_path(dir), json).map_err(|e| e.to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
    to_hex(&sha2::Sha256::digest(bytes))
}

/// Kiểm tối thiểu ở tầng Rust — đủ để không tải/lưu một manifest rõ ràng
/// hỏng hoặc nguy hiểm (URL không mã hoá, integrity sai hình dạng). Kiểm ĐẦY
/// ĐỦ (allowlist native/http đúng cú pháp, dải sdk, route không đụng plugin
/// khác…) vẫn nằm ở `validateManifest` phía TS — nơi `PluginManifest` thật sự
/// được định nghĩa — chạy lại trước khi đăng ký vào registry.
fn validate_remote_manifest(m: &RemotePluginManifest) -> Result<(), String> {
    let id_ok = !m.id.is_empty()
        && m.id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !id_ok {
        return Err(format!("id \"{}\" phải là kebab-case", m.id));
    }
    if !m.entry.starts_with("https://") {
        return Err("entry phải là URL https".to_string());
    }
    if m.integrity.len() != 64 || !m.integrity.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("integrity phải là sha256 dạng hex, đủ 64 ký tự".to_string());
    }
    Ok(())
}

/// Phần disk của việc cài: kiểm checksum, ghi bundle, cập nhật index. Nhận
/// thẳng bytes đã tải — tách khỏi phần HTTP để test được bằng dữ liệu giả lập
/// mà không cần một server thật cho MỌI ca (server thật chỉ cần cho
/// `fetch_manifest`, nơi hành vi HTTP là thứ đang kiểm).
fn stage_install(
    dir: &Path,
    manifest: RemotePluginManifest,
    source_url: String,
    bytes: &[u8],
) -> Result<InstalledPluginRecord, String> {
    let actual = sha256_hex(bytes);
    if actual != manifest.integrity.to_lowercase() {
        return Err(format!(
            "Bundle không khớp checksum đã khai trong manifest — từ chối cài. \
             Khai: {}, thực tế: {actual}",
            manifest.integrity
        ));
    }

    let plugin_dir = dir.join(&manifest.id).join(&manifest.version);
    std::fs::create_dir_all(&plugin_dir).map_err(|e| e.to_string())?;
    let bundle_path = plugin_dir.join("bundle.mjs");
    std::fs::write(&bundle_path, bytes).map_err(|e| e.to_string())?;

    let record = InstalledPluginRecord {
        manifest,
        source_url,
        bundle_path: bundle_path.to_string_lossy().into_owned(),
        installed_at: chrono::Utc::now().timestamp_millis(),
    };

    // Cài đè lên chính plugin đó (cùng id) thì thay hẳn bản ghi cũ — không
    // giữ lại hai bản ghi cho cùng một id, kể cả khác version.
    let mut records = read_index(dir)?;
    records.retain(|r| r.manifest.id != record.manifest.id);
    records.push(record.clone());
    write_index(dir, &records)?;

    Ok(record)
}

fn stage_uninstall(dir: &Path, id: &str) -> Result<(), String> {
    let mut records = read_index(dir)?;
    let before = records.len();
    records.retain(|r| r.manifest.id != id);
    if records.len() == before {
        return Err(format!("Không có plugin \"{id}\" đang cài"));
    }
    // Index cập nhật xong mới là điều quan trọng — không xoá được thư mục
    // trên đĩa (Windows khoá file đang mở chẳng hạn) không nên chặn việc gỡ.
    write_index(dir, &records)?;
    let _ = std::fs::remove_dir_all(dir.join(id));
    Ok(())
}

/// Đọc lại nội dung bundle đã cài, kiểm sha256 LẦN NỮA trước khi trả về cho
/// webview thực thi — phòng thủ chiều sâu, không phải kiểm tra thừa: file
/// trên đĩa có thể bị sửa sau khi cài (thủ công, hay bởi phần mềm khác) mà
/// index.json không biết.
fn stage_read_bundle(dir: &Path, id: &str) -> Result<String, String> {
    let record = read_index(dir)?
        .into_iter()
        .find(|r| r.manifest.id == id)
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

/// Phần HTTP của việc fetch, tách khỏi kiểm tra scheme ở lệnh công khai bên
/// dưới — để test được bằng một server cục bộ thật (luôn là http, không có
/// TLS) mà không phải nới lỏng chính điều kiện https đang được kiểm.
async fn fetch_manifest_from(url: &str) -> Result<RemotePluginManifest, String> {
    let res = reqwest::get(url)
        .await
        .map_err(|e| format!("Không tải được manifest: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Server trả về {} khi tải manifest", res.status()));
    }
    let manifest: RemotePluginManifest = res
        .json()
        .await
        .map_err(|e| format!("Manifest không đúng định dạng: {e}"))?;
    validate_remote_manifest(&manifest)?;
    Ok(manifest)
}

#[tauri::command]
pub async fn plugin_installer_fetch_manifest(url: String) -> Result<RemotePluginManifest, String> {
    if !url.starts_with("https://") {
        // Không chỉ để nhất quán: http không mã hoá thì kiểm checksum ở bước
        // tải bundle sau đó cũng vô nghĩa — kẻ đứng giữa đổi được cả hai.
        return Err("Chỉ chấp nhận URL https".to_string());
    }
    fetch_manifest_from(&url).await
}

#[tauri::command]
pub async fn plugin_installer_install(
    app: AppHandle,
    state: tauri::State<'_, InstalledIndex>,
    source_url: String,
) -> Result<InstalledPluginRecord, String> {
    let _guard = state.0.lock().await;

    let manifest = plugin_installer_fetch_manifest(source_url.clone()).await?;

    let res = reqwest::get(&manifest.entry)
        .await
        .map_err(|e| format!("Không tải được bundle: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Server trả về {} khi tải bundle", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;

    stage_install(&plugins_dir(&app)?, manifest, source_url, &bytes)
}

#[tauri::command]
pub fn plugin_installer_list(app: AppHandle) -> Result<Vec<InstalledPluginRecord>, String> {
    read_index(&plugins_dir(&app)?)
}

#[tauri::command]
pub async fn plugin_installer_uninstall(
    app: AppHandle,
    state: tauri::State<'_, InstalledIndex>,
    id: String,
) -> Result<(), String> {
    let _guard = state.0.lock().await;
    stage_uninstall(&plugins_dir(&app)?, &id)
}

#[tauri::command]
pub fn plugin_installer_read_bundle(app: AppHandle, id: String) -> Result<String, String> {
    stage_read_bundle(&plugins_dir(&app)?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::get;
    use axum::Router;
    use tokio::net::TcpListener;
    use uuid::Uuid;

    fn manifest(entry: &str, integrity: &str) -> RemotePluginManifest {
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

    /// Thư mục tạm thật trên đĩa, riêng cho mỗi test — không cần AppHandle,
    /// chỉ cần đúng cái mà `stage_*` thực sự nhận: một `&Path`. Không dọn dẹp
    /// chủ động: nằm trong thư mục tạm của OS, và mỗi lần gọi có tên duy nhất
    /// nên không ca nào giẫm lên ca khác.
    fn temp_plugins_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("devtool-plugin-installer-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Dựng một server thật (axum, đã là dependency của mockserver.rs) trả
    /// đúng nội dung được truyền vào — round-trip THẬT qua HTTP thay vì mô
    /// phỏng, cùng tinh thần với `tests/service_echo.rs` chạy binary thật.
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

    #[test]
    fn tu_choi_id_khong_phai_kebab_case() {
        let mut m = manifest("https://x/a", &"a".repeat(64));
        m.id = "Demo_App".into();
        assert!(validate_remote_manifest(&m).is_err());
    }

    #[test]
    fn tu_choi_entry_khong_phai_https() {
        let m = manifest("http://x/a", &"a".repeat(64));
        assert!(validate_remote_manifest(&m).unwrap_err().contains("https"));
    }

    #[test]
    fn tu_choi_integrity_sai_hinh_dang() {
        for bad in ["", "khong-phai-hex", &"a".repeat(63), &"g".repeat(64)] {
            let m = manifest("https://x/a", bad);
            assert!(validate_remote_manifest(&m).is_err(), "{bad}");
        }
    }

    #[test]
    fn manifest_hop_le_qua_duoc_ca_hai_kiem_tra() {
        // Chứng minh ba test từ chối ở trên đúng là do TỪNG trường riêng lẻ,
        // không phải một quy tắc mơ hồ nào khác vô tình khớp.
        let m = manifest("https://x/bundle.mjs", &"a".repeat(64));
        assert!(validate_remote_manifest(&m).is_ok());
    }

    #[tokio::test]
    async fn fetch_manifest_tu_choi_http() {
        let err = plugin_installer_fetch_manifest("http://example.com".into())
            .await
            .unwrap_err();
        assert!(err.contains("https"));
    }

    #[tokio::test]
    async fn fetch_manifest_that_qua_server_that() {
        let m = manifest("https://x/bundle.mjs", &"b".repeat(64));
        let url = serve_once(serde_json::to_string(&m).unwrap(), "application/json").await;

        // Server test cục bộ chỉ nói http — gọi thẳng phần fetch, không qua
        // cổng kiểm https của lệnh công khai (đã kiểm riêng ở trên).
        let fetched = fetch_manifest_from(&url).await.unwrap();
        assert_eq!(fetched.id, "demo");
    }

    #[tokio::test]
    async fn fetch_manifest_tu_choi_json_hong() {
        let url = serve_once("{khong-phai-json".into(), "application/json").await;
        let err = fetch_manifest_from(&url).await.unwrap_err();
        assert!(err.contains("Manifest không đúng định dạng"));
    }

    #[test]
    fn cai_dung_checksum_thi_ghi_bundle_va_cap_nhat_index() {
        let dir = temp_plugins_dir();
        let bytes = b"export default 1;";
        let m = manifest("https://x/bundle.mjs", &sha256_hex(bytes));

        let record = stage_install(&dir, m, "https://x/plugin.json".into(), bytes).unwrap();

        assert_eq!(std::fs::read(&record.bundle_path).unwrap(), bytes);
        assert_eq!(read_index(&dir).unwrap(), vec![record]);
    }

    #[test]
    fn cai_sai_checksum_thi_tu_choi_va_khong_ghi_gi_xuong_dia() {
        let dir = temp_plugins_dir();
        let bytes = b"export default 1;";
        // Checksum SAI có chủ ý — đây là ca cần kiểm nhất: bytes có thật,
        // nhưng không khớp với những gì manifest đã hứa.
        let m = manifest("https://x/bundle.mjs", &"0".repeat(64));

        let err = stage_install(&dir, m, "https://x/plugin.json".into(), bytes).unwrap_err();
        assert!(err.contains("không khớp checksum"), "{err}");

        assert!(read_index(&dir).unwrap().is_empty());
        assert!(!dir.join("demo").exists());
    }

    #[test]
    fn cai_de_cung_id_thi_thay_ban_ghi_cu_khong_cong_don() {
        let dir = temp_plugins_dir();
        let v1 = manifest("https://x/v1.mjs", &sha256_hex(b"v1"));
        stage_install(&dir, v1, "https://x/plugin.json".into(), b"v1").unwrap();

        let mut v2 = manifest("https://x/v2.mjs", &sha256_hex(b"v2"));
        v2.version = "2.0.0".into();
        stage_install(&dir, v2, "https://x/plugin.json".into(), b"v2").unwrap();

        let records = read_index(&dir).unwrap();
        assert_eq!(records.len(), 1, "phải chỉ còn một bản ghi cho cùng id");
        assert_eq!(records[0].manifest.version, "2.0.0");
    }

    #[test]
    fn doc_bundle_kiem_lai_checksum_bat_duoc_file_bi_sua_sau_khi_cai() {
        let dir = temp_plugins_dir();
        let bytes = b"export default 1;";
        let m = manifest("https://x/bundle.mjs", &sha256_hex(bytes));
        let record = stage_install(&dir, m, "https://x/plugin.json".into(), bytes).unwrap();

        // Đúng ngay sau khi cài.
        assert_eq!(stage_read_bundle(&dir, "demo").unwrap(), "export default 1;");

        // Sửa file trên đĩa mà không đi qua stage_install — mô phỏng việc bị
        // tác động ngoài luồng cài đặt bình thường.
        std::fs::write(&record.bundle_path, b"export default 999; // bi sua").unwrap();
        let err = stage_read_bundle(&dir, "demo").unwrap_err();
        assert!(err.contains("không còn khớp checksum"), "{err}");
    }

    #[test]
    fn go_plugin_xoa_ca_index_lan_thu_muc() {
        let dir = temp_plugins_dir();
        let bytes = b"export default 1;";
        let m = manifest("https://x/bundle.mjs", &sha256_hex(bytes));
        stage_install(&dir, m, "https://x/plugin.json".into(), bytes).unwrap();

        stage_uninstall(&dir, "demo").unwrap();

        assert!(read_index(&dir).unwrap().is_empty());
        assert!(!dir.join("demo").exists());
    }

    #[test]
    fn go_plugin_khong_ton_tai_thi_bao_loi_ro_rang() {
        let dir = temp_plugins_dir();
        let err = stage_uninstall(&dir, "khong-ton-tai").unwrap_err();
        assert!(err.contains("Không có plugin"));
    }
}
