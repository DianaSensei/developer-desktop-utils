// Sự đồng ý của người dùng để chạy một sidecar KHÔNG nằm trong
// `ALLOWED_SERVICES` (xem service_host.rs).
//
// Vì sao không chỉ thêm tên vào danh sách khi build app: mỗi plugin mới kèm
// sidecar sẽ buộc phải phát hành lại app. Vì sao cũng không để manifest tự khai
// được chạy: manifest do webview đọc — thứ ta đang muốn giới hạn. Nên quyết
// định được trao cho NGƯỜI DÙNG, qua một hộp thoại native do Rust bật; webview
// chỉ kích hoạt được câu hỏi, không trả lời thay được.
//
// ── Lưu ở đâu, và vì sao KHÔNG phải một file trong app_data ──────────────────
//
// Capability mặc định cấp cho webview `fs:allow-write-file` trên
// `fs:scope-appdata-recursive`, nên MỌI thứ nằm trong app_data — kể cả một file
// "đã tin cậy" hay `extensions/index.json` — webview tự ghi được, tức là tự cấp
// quyền được. Quyết định vì thế nằm trong keychain của hệ điều hành, chỗ webview
// không với tới (cùng nơi `secrets_vault.rs` cất khoá). Nơi nào không có
// keychain thì quyết định chỉ sống trong phiên chạy và app hỏi lại lần sau —
// thất bại theo hướng AN TOÀN (hỏi thừa), khác với vault ghi khoá ra file.
//
// ── Gắn với NỘI DUNG, không chỉ với tên ──────────────────────────────────────
//
// Mỗi mục là (bin, sha256 của file sẽ chạy). Binary bị thay hoặc cập nhật sang
// bản khác thì mã băm đổi và app hỏi lại; tên cũ không mang quyền sang nội dung
// mới.

use std::future::Future;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex as AsyncMutex;

const KEYRING_SERVICE: &str = "devtool";
const KEYRING_USER: &str = "trusted-services";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrustEntry {
    pub bin: String,
    pub sha256: String,
}

/// Nơi bền vững giữ các quyết định. Tách thành trait để test không đụng
/// keychain thật.
pub trait TrustBackend: Send + Sync {
    fn load(&self) -> Result<Vec<TrustEntry>, String>;
    fn save(&self, entries: &[TrustEntry]) -> Result<(), String>;
}

pub struct KeyringBackend;

impl TrustBackend for KeyringBackend {
    fn load(&self) -> Result<Vec<TrustEntry>, String> {
        let entry =
            keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
            Err(keyring::Error::NoEntry) => Ok(Vec::new()),
            Err(e) => Err(e.to_string()),
        }
    }

    fn save(&self, entries: &[TrustEntry]) -> Result<(), String> {
        let entry =
            keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
        let json = serde_json::to_string(entries).map_err(|e| e.to_string())?;
        entry.set_password(&json).map_err(|e| e.to_string())
    }
}

/// In-memory backend for tests elsewhere in the crate (the real one is the keychain).
#[cfg(test)]
#[derive(Default)]
pub(crate) struct MemoryBackend(Mutex<Vec<TrustEntry>>);

#[cfg(test)]
impl TrustBackend for MemoryBackend {
    fn load(&self) -> Result<Vec<TrustEntry>, String> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn save(&self, entries: &[TrustEntry]) -> Result<(), String> {
        *self.0.lock().unwrap() = entries.to_vec();
        Ok(())
    }
}

pub struct ServiceTrust {
    backend: Box<dyn TrustBackend>,
    /// `None` cho tới lần đọc đầu tiên. Luôn là nguồn sự thật trong phiên, kể cả
    /// khi `backend.save` thất bại.
    entries: Mutex<Option<Vec<TrustEntry>>>,
    /// Chỉ cho MỘT câu hỏi chạy tại một thời điểm — hai lời gọi đồng thời tới
    /// cùng sidecar chưa tin cậy không được bật hai hộp thoại.
    gate: AsyncMutex<()>,
}

impl Default for ServiceTrust {
    fn default() -> Self {
        Self::new(Box::new(KeyringBackend))
    }
}

impl ServiceTrust {
    pub fn new(backend: Box<dyn TrustBackend>) -> Self {
        Self {
            backend,
            entries: Mutex::new(None),
            gate: AsyncMutex::new(()),
        }
    }

    fn with_entries<R>(&self, f: impl FnOnce(&mut Vec<TrustEntry>) -> R) -> R {
        let mut guard = self.entries.lock().unwrap();
        // Không đọc được keychain → coi như chưa tin ai (an toàn), không lỗi.
        let entries = guard.get_or_insert_with(|| self.backend.load().unwrap_or_default());
        f(entries)
    }

    pub fn is_trusted(&self, bin: &str, sha256: &str) -> bool {
        self.with_entries(|e| e.iter().any(|t| t.bin == bin && t.sha256 == sha256))
    }

    /// Ghi nhận một quyết định cho phép. Mỗi `bin` giữ đúng một mã băm (bản mới
    /// thay bản cũ). Ghi keychain là cố gắng tối đa: thất bại thì quyết định vẫn
    /// có hiệu lực trong phiên này.
    fn grant(&self, bin: &str, sha256: &str) {
        let snapshot = self.with_entries(|e| {
            e.retain(|t| t.bin != bin);
            e.push(TrustEntry {
                bin: bin.to_string(),
                sha256: sha256.to_string(),
            });
            e.clone()
        });
        if let Err(e) = self.backend.save(&snapshot) {
            eprintln!("service_trust: không lưu được quyết định vào keychain ({e}); chỉ có hiệu lực trong phiên này");
        }
    }

    /// Thu hồi — gọi khi gỡ cài đặt. Chỉ GIẢM quyền nên an toàn để mọi nơi gọi.
    pub fn revoke(&self, bin: &str) {
        let snapshot = self.with_entries(|e| {
            e.retain(|t| t.bin != bin);
            e.clone()
        });
        let _ = self.backend.save(&snapshot);
    }

    /// Đảm bảo `(bin, sha256)` đã được tin cậy, hỏi người dùng nếu chưa. `ask`
    /// chỉ chạy khi thật sự cần hỏi.
    pub async fn ensure<F, Fut>(&self, bin: &str, sha256: &str, ask: F) -> Result<(), String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = bool>,
    {
        if self.is_trusted(bin, sha256) {
            return Ok(());
        }
        let _gate = self.gate.lock().await;
        // Người đến trước có thể đã được cho phép trong lúc ta chờ cổng.
        if self.is_trusted(bin, sha256) {
            return Ok(());
        }
        if ask().await {
            self.grant(bin, sha256);
            Ok(())
        } else {
            Err(format!("Bạn đã từ chối cho chạy chương trình \"{bin}\"."))
        }
    }
}

/// Ngôn ngữ của hộp thoại — theo ngôn ngữ người dùng chọn trong app (khoá
/// `devtool-locale` của `app-settings.json`, cùng khoá `LocaleContext.tsx` ghi).
/// Thiếu hoặc lạ thì tiếng Anh. File nằm trong app_data nên webview ghi được,
/// nhưng nó chỉ đổi được NGÔN NGỮ của câu hỏi, không đổi được câu trả lời.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    Vi,
    En,
}

pub fn locale_from_settings(app_settings_json: &str) -> Locale {
    let v: serde_json::Value = serde_json::from_str(app_settings_json).unwrap_or_default();
    match v.get("devtool-locale").and_then(|l| l.as_str()) {
        Some("vi") => Locale::Vi,
        _ => Locale::En,
    }
}

/// Hộp thoại native: tiêu đề, nội dung, nút đồng ý, nút từ chối.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsentDialog {
    pub title: String,
    pub message: String,
    pub allow: String,
    pub deny: String,
}

/// Cách gọi thư mục home theo quy ước của từng hệ điều hành.
const HOME_MARK: &str = if cfg!(windows) { "%USERPROFILE%" } else { "~" };

/// Thư mục home thay bằng `~` (macOS, Linux) hoặc `%USERPROFILE%` (Windows) —
/// ngắn hơn, và không lộ tên tài khoản khi người dùng chụp màn hình gửi đi.
fn shorten_home(path: &str, home: Option<&str>, mark: &str) -> String {
    match home.filter(|h| !h.is_empty()) {
        // `get` rather than slicing: a non-ASCII account name ("Thông") must not panic
        // when the cut falls inside a character of a path that does not match.
        Some(h)
            if path
                .get(..h.len())
                .is_some_and(|p| p.eq_ignore_ascii_case(h)) =>
        {
            format!("{mark}{}", &path[h.len()..])
        }
        _ => path.to_string(),
    }
}

/// Thư mục chứa file, rút gọn: với bản cài qua URL là `~/…/services/<bin>/<version>`.
/// Làm việc trên chuỗi, chấp nhận cả `/` lẫn `\`, và giữ đúng dấu phân cách của
/// đường dẫn — để kết quả giống nhau dù đường dẫn đến từ macOS, Linux hay Windows.
fn short_location(path: &str, home: Option<&str>, mark: &str) -> String {
    let sep = if path.contains('\\') && !path.contains('/') {
        '\\'
    } else {
        '/'
    };
    let dir = match path.rfind(['/', '\\']) {
        Some(i) => &path[..i],
        None => path,
    };
    let dir = shorten_home(dir, home, mark);
    let parts: Vec<&str> = dir.split(['/', '\\']).collect();
    match parts.iter().position(|p| *p == "services") {
        Some(i) if i > 1 => format!("{mark}{sep}…{sep}{}", parts[i..].join(&sep.to_string())),
        _ => dir,
    }
}

/// Đủ để đối chiếu bằng mắt mà không phải đọc 64 ký tự.
fn short_hash(sha256: &str) -> String {
    if sha256.len() <= 20 {
        return sha256.to_string();
    }
    format!("{}…{}", &sha256[..12], &sha256[sha256.len() - 6..])
}

/// Nguồn không có `https://` và query; dài thì giữ host và tên file cuối.
fn short_source(url: &str) -> String {
    let bare = url.split(['?', '#']).next().unwrap_or(url);
    let bare = bare
        .strip_prefix("https://")
        .or_else(|| bare.strip_prefix("http://"))
        .unwrap_or(bare);
    if bare.chars().count() <= 60 {
        return bare.to_string();
    }
    let host = bare.split('/').next().unwrap_or(bare);
    let last = bare.rsplit('/').next().unwrap_or("");
    format!("{host}/…/{last}")
}

/// Nội dung hộp thoại xin phép. Theo quy ước hộp thoại quyền của macOS: tiêu đề
/// là một câu hỏi có tên chương trình; thân là một câu giải thích, ba dòng nhận
/// diện (ở đâu, mã băm, từ đâu) và một câu nhắc; nút nói rõ hành động.
pub fn consent_dialog(
    locale: Locale,
    bin: &str,
    path: &std::path::Path,
    sha256: &str,
    source: Option<&str>,
    home: Option<&str>,
) -> ConsentDialog {
    let name = bin.strip_prefix("devtool-svc-").unwrap_or(bin);
    let location = short_location(&path.to_string_lossy(), home, HOME_MARK);
    let hash = short_hash(sha256);
    let source = source.map(short_source);
    match locale {
        Locale::Vi => {
            let mut message = format!(
                "Một plugin muốn chạy chương trình này trên máy bạn, với toàn quyền của tài khoản bạn.\n\n\
                 Thư mục: {location}\nSHA-256: {hash}"
            );
            if let Some(src) = &source {
                message.push_str(&format!("\nNguồn: {src}"));
            }
            message.push_str("\n\nChỉ cho phép nếu bạn tin nguồn này. Nếu chương trình thay đổi, DevTool sẽ hỏi lại.");
            ConsentDialog {
                title: format!("Cho phép “{name}” chạy?"),
                message,
                allow: "Cho phép".into(),
                deny: "Không cho phép".into(),
            }
        }
        Locale::En => {
            let mut message = format!(
                "A plugin wants to run this program on your computer, with your full user permissions.\n\n\
                 Folder: {location}\nSHA-256: {hash}"
            );
            if let Some(src) = &source {
                message.push_str(&format!("\nSource: {src}"));
            }
            message.push_str("\n\nAllow it only if you trust its source. DevTool will ask again if the program changes.");
            ConsentDialog {
                title: format!("Allow “{name}” to run?"),
                message,
                allow: "Allow".into(),
                deny: "Don’t Allow".into(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[derive(Default, Clone)]
    struct Mem(Arc<Mutex<Vec<TrustEntry>>>);
    impl TrustBackend for Mem {
        fn load(&self) -> Result<Vec<TrustEntry>, String> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn save(&self, entries: &[TrustEntry]) -> Result<(), String> {
            *self.0.lock().unwrap() = entries.to_vec();
            Ok(())
        }
    }

    struct Broken;
    impl TrustBackend for Broken {
        fn load(&self) -> Result<Vec<TrustEntry>, String> {
            Err("no keychain".into())
        }
        fn save(&self, _: &[TrustEntry]) -> Result<(), String> {
            Err("no keychain".into())
        }
    }

    #[tokio::test]
    async fn hoi_mot_lan_roi_nho_ca_qua_lan_khoi_dong_lai() {
        let backend = Mem::default();
        let asked = Arc::new(AtomicUsize::new(0));

        let trust = ServiceTrust::new(Box::new(backend.clone()));
        let a = asked.clone();
        trust
            .ensure("devtool-svc-x", "aa", || async move {
                a.fetch_add(1, Ordering::SeqCst);
                true
            })
            .await
            .unwrap();
        let a = asked.clone();
        trust
            .ensure("devtool-svc-x", "aa", || async move {
                a.fetch_add(1, Ordering::SeqCst);
                true
            })
            .await
            .unwrap();
        assert_eq!(asked.load(Ordering::SeqCst), 1);

        // "Khởi động lại": một ServiceTrust mới đọc lại từ backend.
        let restarted = ServiceTrust::new(Box::new(backend));
        assert!(restarted.is_trusted("devtool-svc-x", "aa"));
    }

    #[tokio::test]
    async fn tu_choi_thi_loi_va_khong_ghi_nho() {
        let trust = ServiceTrust::new(Box::new(Mem::default()));
        let err = trust
            .ensure("devtool-svc-x", "aa", || async { false })
            .await
            .unwrap_err();
        assert!(err.contains("từ chối"), "{err}");
        assert!(!trust.is_trusted("devtool-svc-x", "aa"));
    }

    #[tokio::test]
    async fn doi_noi_dung_binary_thi_hoi_lai() {
        let trust = ServiceTrust::new(Box::new(Mem::default()));
        trust
            .ensure("devtool-svc-x", "aa", || async { true })
            .await
            .unwrap();
        // Cùng tên, mã băm khác → quyền cũ không áp dụng.
        assert!(!trust.is_trusted("devtool-svc-x", "bb"));
        let err = trust
            .ensure("devtool-svc-x", "bb", || async { false })
            .await
            .unwrap_err();
        assert!(err.contains("từ chối"));
        // Và cho phép bản mới thì bản cũ không còn được tin.
        trust
            .ensure("devtool-svc-x", "bb", || async { true })
            .await
            .unwrap();
        assert!(!trust.is_trusted("devtool-svc-x", "aa"));
    }

    #[tokio::test]
    async fn khong_co_keychain_thi_van_chay_trong_phien_va_hoi_lai_lan_sau() {
        let trust = ServiceTrust::new(Box::new(Broken));
        trust
            .ensure("devtool-svc-x", "aa", || async { true })
            .await
            .unwrap();
        assert!(trust.is_trusted("devtool-svc-x", "aa"));
        // Phiên mới (không đọc được gì từ backend hỏng) → chưa tin ai.
        let next = ServiceTrust::new(Box::new(Broken));
        assert!(!next.is_trusted("devtool-svc-x", "aa"));
    }

    #[tokio::test]
    async fn hai_loi_goi_dong_thoi_chi_bat_mot_hop_thoai() {
        let trust = Arc::new(ServiceTrust::new(Box::new(Mem::default())));
        let asked = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..5 {
            let (t, a) = (trust.clone(), asked.clone());
            tasks.push(tokio::spawn(async move {
                t.ensure("devtool-svc-x", "aa", || async move {
                    a.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(std::time::Duration::from_millis(30)).await;
                    true
                })
                .await
            }));
        }
        for t in tasks {
            t.await.unwrap().unwrap();
        }
        assert_eq!(asked.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn thu_hoi_xoa_quyen() {
        let backend = Mem::default();
        let trust = ServiceTrust::new(Box::new(backend.clone()));
        trust.grant("devtool-svc-x", "aa");
        trust.revoke("devtool-svc-x");
        assert!(!trust.is_trusted("devtool-svc-x", "aa"));
        assert!(backend.load().unwrap().is_empty());
    }

    #[test]
    fn hop_thoai_gon_va_du_thong_tin_de_quyet_dinh() {
        let path = std::path::Path::new(
            "/Users/an/Library/Application Support/com.x/services/devtool-svc-service-list-automation/0.1.0/devtool-svc-service-list-automation",
        );
        let sha = "2009009a8a4529e8aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4529e8";
        let src = "https://github.com/DianaSensei/mm-service-list-automation/releases/download/service-list-automation-v0.1.0/service-list-automation-service.manifest.json?x=1";
        let d = consent_dialog(
            Locale::Vi,
            "devtool-svc-service-list-automation",
            path,
            sha,
            Some(src),
            Some("/Users/an"),
        );
        assert_eq!(d.title, "Cho phép “service-list-automation” chạy?");
        assert_eq!(
            (d.allow.as_str(), d.deny.as_str()),
            ("Cho phép", "Không cho phép")
        );
        assert!(
            d.message
                .contains("Thư mục: ~/…/services/devtool-svc-service-list-automation/0.1.0"),
            "{}",
            d.message
        );
        assert!(
            d.message.contains("SHA-256: 2009009a8a45…4529e8"),
            "{}",
            d.message
        );
        assert!(
            d.message
                .contains("Nguồn: github.com/…/service-list-automation-service.manifest.json"),
            "{}",
            d.message
        );
        assert!(!d.message.contains("/Users/an"), "home must not appear");
        assert!(d.message.contains("toàn quyền"));

        let en = consent_dialog(Locale::En, "devtool-svc-x", path, sha, None, None);
        assert_eq!(en.title, "Allow “x” to run?");
        assert!(!en.message.contains("Source:"));
        assert_eq!(en.deny, "Don’t Allow");
    }

    #[test]
    fn duong_dan_rut_gon_dung_cho_ca_ba_he_dieu_hanh() {
        let bin = "devtool-svc-x";
        // macOS
        assert_eq!(
            short_location(
                &format!("/Users/an/Library/Application Support/com.x/services/{bin}/0.1.0/{bin}"),
                Some("/Users/an"),
                "~"
            ),
            format!("~/…/services/{bin}/0.1.0")
        );
        // Linux
        assert_eq!(
            short_location(
                &format!("/home/an/.local/share/com.x/services/{bin}/0.1.0/{bin}"),
                Some("/home/an"),
                "~"
            ),
            format!("~/…/services/{bin}/0.1.0")
        );
        // Windows: backslashes kept, home written the Windows way, drive letter case ignored
        assert_eq!(
            short_location(
                &format!(r"C:\Users\An\AppData\Roaming\com.x\services\{bin}\0.1.0\{bin}.exe"),
                Some(r"c:\users\an"),
                "%USERPROFILE%"
            ),
            format!(r"%USERPROFILE%\…\services\{bin}\0.1.0")
        );
        // Not an installed sidecar (a dev build beside the exe): the folder, home shortened.
        assert_eq!(
            short_location(
                "/Users/an/dev/target/debug/devtool-svc-x",
                Some("/Users/an"),
                "~"
            ),
            "~/dev/target/debug"
        );
    }

    #[test]
    fn ngon_ngu_theo_lua_chon_trong_app() {
        assert_eq!(
            locale_from_settings(r#"{"devtool-locale":"vi"}"#),
            Locale::Vi
        );
        assert_eq!(
            locale_from_settings(r#"{"devtool-locale":"en"}"#),
            Locale::En
        );
        assert_eq!(locale_from_settings("{}"), Locale::En);
        assert_eq!(locale_from_settings("hỏng"), Locale::En);
    }

    #[test]
    fn rut_gon_khong_lam_hong_gia_tri_ngan() {
        assert_eq!(short_hash("abc"), "abc");
        assert_eq!(short_source("https://h/m.json"), "h/m.json");
        assert_eq!(shorten_home("/opt/x", Some("/Users/a"), "~"), "/opt/x");
        // Non-ASCII account names: matching and non-matching paths, no panic.
        assert_eq!(
            shorten_home("/Users/Thông/x", Some("/Users/Thông"), "~"),
            "~/x"
        );
        assert_eq!(
            shorten_home("/Users/ăn/x", Some("/Users/a"), "~"),
            "/Users/ăn/x"
        );
    }
}
