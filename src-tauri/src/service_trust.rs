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
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
            Err(keyring::Error::NoEntry) => Ok(Vec::new()),
            Err(e) => Err(e.to_string()),
        }
    }

    fn save(&self, entries: &[TrustEntry]) -> Result<(), String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
        let json = serde_json::to_string(entries).map_err(|e| e.to_string())?;
        entry.set_password(&json).map_err(|e| e.to_string())
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
        Self { backend, entries: Mutex::new(None), gate: AsyncMutex::new(()) }
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
            e.push(TrustEntry { bin: bin.to_string(), sha256: sha256.to_string() });
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

/// Nội dung hộp thoại. Nêu những gì người dùng cần để quyết định: cái gì sẽ
/// chạy, ở đâu, từ nguồn nào.
pub fn consent_message(bin: &str, path: &std::path::Path, sha256: &str, source: Option<&str>) -> String {
    let mut msg = format!(
        "Một plugin muốn chạy chương trình native \"{bin}\" trên máy của bạn.\n\n\
         Đường dẫn: {}\nSHA-256: {sha256}\n",
        path.display()
    );
    if let Some(source) = source {
        msg.push_str(&format!("Nguồn ghi trong danh sách cài đặt: {source}\n"));
    }
    msg.push_str(
        "\nChương trình này chạy với đầy đủ quyền của bạn, không có sandbox. \
         Chỉ cho phép nếu bạn tin nguồn của nó.",
    );
    msg
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
        trust.ensure("devtool-svc-x", "aa", || async move { a.fetch_add(1, Ordering::SeqCst); true }).await.unwrap();
        let a = asked.clone();
        trust.ensure("devtool-svc-x", "aa", || async move { a.fetch_add(1, Ordering::SeqCst); true }).await.unwrap();
        assert_eq!(asked.load(Ordering::SeqCst), 1);

        // "Khởi động lại": một ServiceTrust mới đọc lại từ backend.
        let restarted = ServiceTrust::new(Box::new(backend));
        assert!(restarted.is_trusted("devtool-svc-x", "aa"));
    }

    #[tokio::test]
    async fn tu_choi_thi_loi_va_khong_ghi_nho() {
        let trust = ServiceTrust::new(Box::new(Mem::default()));
        let err = trust.ensure("devtool-svc-x", "aa", || async { false }).await.unwrap_err();
        assert!(err.contains("từ chối"), "{err}");
        assert!(!trust.is_trusted("devtool-svc-x", "aa"));
    }

    #[tokio::test]
    async fn doi_noi_dung_binary_thi_hoi_lai() {
        let trust = ServiceTrust::new(Box::new(Mem::default()));
        trust.ensure("devtool-svc-x", "aa", || async { true }).await.unwrap();
        // Cùng tên, mã băm khác → quyền cũ không áp dụng.
        assert!(!trust.is_trusted("devtool-svc-x", "bb"));
        let err = trust.ensure("devtool-svc-x", "bb", || async { false }).await.unwrap_err();
        assert!(err.contains("từ chối"));
        // Và cho phép bản mới thì bản cũ không còn được tin.
        trust.ensure("devtool-svc-x", "bb", || async { true }).await.unwrap();
        assert!(!trust.is_trusted("devtool-svc-x", "aa"));
    }

    #[tokio::test]
    async fn khong_co_keychain_thi_van_chay_trong_phien_va_hoi_lai_lan_sau() {
        let trust = ServiceTrust::new(Box::new(Broken));
        trust.ensure("devtool-svc-x", "aa", || async { true }).await.unwrap();
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
    fn hop_thoai_neu_du_thong_tin_de_quyet_dinh() {
        let m = consent_message("devtool-svc-x", std::path::Path::new("/p/x"), "abc123", Some("https://h/m.json"));
        for needle in ["devtool-svc-x", "/p/x", "abc123", "https://h/m.json", "sandbox"] {
            assert!(m.contains(needle), "thiếu {needle}: {m}");
        }
        assert!(!consent_message("b", std::path::Path::new("/p"), "s", None).contains("Nguồn"));
    }
}
