// User consent for running a sidecar that is not in `ALLOWED_SERVICES`
// (see service_host.rs).
//
// A build-time allowlist would require an app release for every new
// sidecar, and the manifest cannot grant itself permission because the
// webview controls it. So the user decides, through a native dialog raised
// by Rust; the webview can trigger the question but cannot answer it.
//
// Storage: decisions live in the OS keychain, not in app_data. The webview
// has write access to app_data (`fs:scope-appdata-recursive`), so any file
// there could be edited to grant trust. Without a keychain, decisions last
// for the session only and the user is asked again next time (fails safe).
//
// Each entry is (bin, sha256 of the file that runs). A replaced or updated
// binary has a different hash and triggers a new prompt.

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

/// Persistent store for decisions; a trait so tests avoid the real keychain.
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
    /// `None` until first loaded. The in-memory copy is authoritative for the
    /// session, even if `backend.save` fails.
    entries: Mutex<Option<Vec<TrustEntry>>>,
    /// Serializes prompts so concurrent calls for the same sidecar show a
    /// single dialog.
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
        // An unreadable keychain means nothing is trusted yet.
        let entries = guard.get_or_insert_with(|| self.backend.load().unwrap_or_default());
        f(entries)
    }

    pub fn is_trusted(&self, bin: &str, sha256: &str) -> bool {
        self.with_entries(|e| e.iter().any(|t| t.bin == bin && t.sha256 == sha256))
    }

    /// Records an allow decision; one hash per `bin`. Saving to the keychain
    /// is best effort; the decision holds for this session regardless.
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

    /// Revokes trust (on uninstall). Only removes permission.
    pub fn revoke(&self, bin: &str) {
        let snapshot = self.with_entries(|e| {
            e.retain(|t| t.bin != bin);
            e.clone()
        });
        let _ = self.backend.save(&snapshot);
    }

    /// Ensures `(bin, sha256)` is trusted, asking the user if not. `ask` only
    /// runs when a prompt is needed.
    pub async fn ensure<F, Fut>(&self, bin: &str, sha256: &str, ask: F) -> Result<(), String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = bool>,
    {
        if self.is_trusted(bin, sha256) {
            return Ok(());
        }
        let _gate = self.gate.lock().await;
        // Another caller may have been granted while we waited.
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

/// Dialog language, from the `devtool-locale` key of `app-settings.json`
/// (written by `LocaleContext.tsx`); English when missing or unknown. The
/// webview can edit that file, but it only changes the wording.
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

/// Native dialog text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsentDialog {
    pub title: String,
    pub message: String,
    pub allow: String,
    pub deny: String,
}

/// How each OS writes the home directory.
const HOME_MARK: &str = if cfg!(windows) { "%USERPROFILE%" } else { "~" };

/// Replaces the home directory with `~` or `%USERPROFILE%`: shorter, and
/// keeps the account name out of screenshots.
fn shorten_home(path: &str, home: Option<&str>, mark: &str) -> String {
    match home.filter(|h| !h.is_empty()) {
        // `get` instead of slicing so a non-ASCII account name cannot panic
        // on a char boundary.
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

/// Containing folder, shortened (`~/…/services/<bin>/<version>` for URL
/// installs). Works on strings with either separator so the output is the
/// same whichever OS produced the path.
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

/// Enough to compare by eye without reading all 64 characters.
fn short_hash(sha256: &str) -> String {
    if sha256.len() <= 20 {
        return sha256.to_string();
    }
    format!("{}…{}", &sha256[..12], &sha256[sha256.len() - 6..])
}

/// Source without scheme or query; long URLs keep the host and last segment.
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

/// Consent dialog text, following macOS permission dialogs: the title asks a
/// question naming the program, the body explains and lists location, hash
/// and source, and the buttons name the action.
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

        // A new instance simulates a restart.
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
        // Same name, different hash: earlier consent does not apply.
        assert!(!trust.is_trusted("devtool-svc-x", "bb"));
        let err = trust
            .ensure("devtool-svc-x", "bb", || async { false })
            .await
            .unwrap_err();
        assert!(err.contains("từ chối"));
        // Allowing the new hash drops the old one.
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
        // A new session with a broken backend trusts nothing.
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
