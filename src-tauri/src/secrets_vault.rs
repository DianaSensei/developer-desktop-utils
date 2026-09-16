// Kho bí mật có mã hoá — nơi cất seed TOTP, bearer token và mọi thứ tương tự.
//
// Bối cảnh: bí mật đã được tách khỏi `app-settings.json` (mặt phẳng khoá mà mọi
// module trong webview đọc được) từ trước, nhưng vẫn nằm TRẦN trên đĩa. Module
// này đóng nốt lỗ hổng đó.
//
// ── Mô hình khoá ─────────────────────────────────────────────────────────────
//
// Nội dung nằm trong `<app_data>/secrets.enc`, mã hoá AES-256-GCM. Khoá 32 byte
// KHÔNG nằm cạnh dữ liệu — nó ở keychain của hệ điều hành (Keychain trên macOS,
// Credential Manager trên Windows, Secret Service trên Linux). Đó là điểm mấu
// chốt: mã hoá mà cất khoá ngay cạnh file là nghi thức, không phải bảo vệ.
//
// ── Đường dự phòng, và vì sao nó FAIL-OPEN ───────────────────────────────────
//
// Không phải máy Linux nào cũng có Secret Service đang chạy (máy chủ không màn
// hình, phiên không có gnome-keyring). Khi đó khoá rơi về `<app_data>/secrets.key`
// với quyền 0600. Chọn như vậy là CÓ ĐÁNH ĐỔI, nói thẳng ra: ở chế độ này, ai
// đọc được thư mục app data thì đọc được cả khoá lẫn dữ liệu — nó chỉ chặn được
// việc chép nguyên file `secrets.enc` đi nơi khác, không chặn được kẻ tấn công
// tại chỗ. Lựa chọn còn lại là fail-closed, tức 2FA và JWT ngừng hoạt động hoàn
// toàn trên những máy đó; với một công cụ dev chạy cục bộ, im lặng làm hỏng
// tính năng là cái giá cao hơn. Đổi lại, chế độ đang dùng KHÔNG được giấu:
// `secret_vault_status` trả ra để Settings hiển thị.
//
// ── Không tự xoá khi không giải mã được ──────────────────────────────────────
//
// Nếu người dùng xoá mục trong keychain, blob trở thành không đọc được. Khi đó
// các lệnh ở đây báo lỗi rõ ràng chứ TUYỆT ĐỐI không tự khởi tạo lại kho: âm
// thầm vứt dữ liệu người dùng để "trở lại hoạt động" là hỏng tệ hơn nhiều so
// với một thông báo lỗi. `secret_vault_reset` tồn tại cho trường hợp người dùng
// chủ động chọn bỏ.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use aes_gcm::aead::{Aead, KeyInit, Nonce};
use aes_gcm::Aes256Gcm;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const KEYRING_SERVICE: &str = "devtool";
const KEYRING_USER: &str = "secret-vault-key";
const VAULT_FILE: &str = "secrets.enc";
const KEY_FILE: &str = "secrets.key";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const FORMAT_VERSION: u32 = 1;

/// Khoá đến từ đâu. Hiện cho người dùng thấy, vì hai chế độ có mức bảo vệ khác
/// hẳn nhau và họ có quyền biết máy mình đang ở chế độ nào.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum KeyMode {
    /// Khoá trong keychain của OS — chế độ mong muốn.
    Keychain,
    /// Khoá trong file 0600 cạnh dữ liệu. Chỉ chặn việc chép file đi nơi khác.
    File,
}

#[derive(Debug, Serialize)]
pub struct VaultStatus {
    pub encrypted: bool,
    pub key_mode: KeyMode,
    /// `false` khi có blob trên đĩa nhưng khoá hiện tại không mở được nó —
    /// dấu hiệu keychain đã bị xoá hoặc đổi.
    pub readable: bool,
}

#[derive(Serialize, Deserialize)]
struct VaultFile {
    version: u32,
    nonce: String,
    ciphertext: String,
}

#[derive(Default)]
pub struct VaultState {
    key: Mutex<Option<([u8; KEY_LEN], KeyMode)>>,
}

fn random_bytes(len: usize) -> Result<Vec<u8>, String> {
    let mut buf = vec![0u8; len];
    getrandom::fill(&mut buf).map_err(|e| format!("Không lấy được số ngẫu nhiên từ hệ điều hành: {e}"))?;
    Ok(buf)
}

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn write_key_file(path: &PathBuf, key: &[u8]) -> Result<(), String> {
    std::fs::write(path, BASE64.encode(key)).map_err(|e| e.to_string())?;
    // Cùng cách xử lý như file token của mcp_bridge: trên unix siết về chủ sở
    // hữu; ACL mặc định của Windows đã giới hạn theo user.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn decode_key(raw: &str) -> Option<[u8; KEY_LEN]> {
    let bytes = BASE64.decode(raw.trim()).ok()?;
    <[u8; KEY_LEN]>::try_from(bytes.as_slice()).ok()
}

/// Lấy khoá, tạo mới nếu chưa có. Kết quả được nhớ trong state: trên macOS mỗi
/// lần chạm Keychain là một lần gọi hệ thống có thể chậm, và kho bị đọc/ghi ở
/// mọi thao tác của tool.
fn key_for(app: &AppHandle, state: &VaultState) -> Result<([u8; KEY_LEN], KeyMode), String> {
    if let Some(cached) = *state.key.lock().map_err(|e| e.to_string())? {
        return Ok(cached);
    }

    let resolved = load_or_create_key(app)?;
    *state.key.lock().map_err(|e| e.to_string())? = Some(resolved);
    Ok(resolved)
}

fn load_or_create_key(app: &AppHandle) -> Result<([u8; KEY_LEN], KeyMode), String> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        match entry.get_password() {
            Ok(existing) => {
                if let Some(key) = decode_key(&existing) {
                    return Ok((key, KeyMode::Keychain));
                }
                // Mục trong keychain hỏng/không đúng độ dài: ghi đè bằng khoá
                // mới sẽ vứt mất dữ liệu đang có, nên báo lỗi để người dùng
                // quyết định (giữ nguyên hay reset).
                return Err(
                    "Mục khoá trong keychain không hợp lệ. Xoá mục \"devtool / secret-vault-key\" \
                     rồi mở lại app để tạo kho mới (dữ liệu bí mật cũ sẽ không đọc lại được)."
                        .to_string(),
                );
            }
            Err(keyring::Error::NoEntry) => {
                let key = random_bytes(KEY_LEN)?;
                if entry.set_password(&BASE64.encode(&key)).is_ok() {
                    return Ok((<[u8; KEY_LEN]>::try_from(key.as_slice()).unwrap(), KeyMode::Keychain));
                }
                // Ghi vào keychain hỏng → rơi xuống đường file bên dưới.
            }
            Err(_) => {
                // Không có Secret Service / bị khoá / bị từ chối → đường file.
            }
        }
    }

    let path = app_data(app)?.join(KEY_FILE);
    if let Ok(existing) = std::fs::read_to_string(&path) {
        if let Some(key) = decode_key(&existing) {
            return Ok((key, KeyMode::File));
        }
    }
    let key = random_bytes(KEY_LEN)?;
    write_key_file(&path, &key)?;
    Ok((<[u8; KEY_LEN]>::try_from(key.as_slice()).unwrap(), KeyMode::File))
}

fn cipher(key: &[u8; KEY_LEN]) -> Result<Aes256Gcm, String> {
    Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())
}

fn nonce_of(bytes: &[u8]) -> Result<Nonce<Aes256Gcm>, String> {
    Nonce::<Aes256Gcm>::try_from(bytes).map_err(|_| format!("nonce phải dài đúng {NONCE_LEN} byte"))
}

type Entries = BTreeMap<String, String>;

fn read_entries(app: &AppHandle, key: &[u8; KEY_LEN]) -> Result<Entries, String> {
    let path = app_data(app)?.join(VAULT_FILE);
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(_) => return Ok(Entries::new()),
    };
    let file: VaultFile = serde_json::from_str(&raw).map_err(|e| format!("Kho bí mật hỏng: {e}"))?;
    if file.version != FORMAT_VERSION {
        return Err(format!(
            "Kho bí mật ở định dạng v{} còn bản app này đọc v{FORMAT_VERSION}",
            file.version
        ));
    }
    let nonce = BASE64.decode(&file.nonce).map_err(|e| e.to_string())?;
    let ciphertext = BASE64.decode(&file.ciphertext).map_err(|e| e.to_string())?;
    let plain = cipher(key)?
        .decrypt(&nonce_of(&nonce)?, ciphertext.as_ref())
        .map_err(|_| {
            "Không giải mã được kho bí mật bằng khoá hiện tại — nhiều khả năng mục trong keychain \
             đã bị xoá hoặc thay. Dữ liệu cũ không khôi phục được nếu không có khoá gốc."
                .to_string()
        })?;
    serde_json::from_slice(&plain).map_err(|e| e.to_string())
}

fn write_entries(app: &AppHandle, key: &[u8; KEY_LEN], entries: &Entries) -> Result<(), String> {
    // Nonce MỚI cho mỗi lần ghi. Dùng lại nonce với cùng một khoá trong GCM là
    // hỏng hoàn toàn về mặt mật mã, không chỉ là yếu đi.
    let nonce = random_bytes(NONCE_LEN)?;
    let plain = serde_json::to_vec(entries).map_err(|e| e.to_string())?;
    let ciphertext = cipher(key)?
        .encrypt(&nonce_of(&nonce)?, plain.as_ref())
        .map_err(|e| e.to_string())?;

    let file = VaultFile {
        version: FORMAT_VERSION,
        nonce: BASE64.encode(&nonce),
        ciphertext: BASE64.encode(&ciphertext),
    };
    let path = app_data(app)?.join(VAULT_FILE);
    std::fs::write(&path, serde_json::to_string(&file).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command]
pub fn secret_vault_get(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    key: String,
) -> Result<Option<String>, String> {
    let (k, _) = key_for(&app, &state)?;
    Ok(read_entries(&app, &k)?.get(&key).cloned())
}

#[tauri::command]
pub fn secret_vault_set(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let (k, _) = key_for(&app, &state)?;
    let mut entries = read_entries(&app, &k)?;
    entries.insert(key, value);
    write_entries(&app, &k, &entries)
}

#[tauri::command]
pub fn secret_vault_delete(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    key: String,
) -> Result<(), String> {
    let (k, _) = key_for(&app, &state)?;
    let mut entries = read_entries(&app, &k)?;
    if entries.remove(&key).is_some() {
        write_entries(&app, &k, &entries)?;
    }
    Ok(())
}

#[tauri::command]
pub fn secret_vault_keys(app: AppHandle, state: tauri::State<'_, VaultState>) -> Result<Vec<String>, String> {
    let (k, _) = key_for(&app, &state)?;
    Ok(read_entries(&app, &k)?.into_keys().collect())
}

/// Xoá toàn bộ nội dung, GIỮ nguyên khoá. Dùng bởi nhánh DEV của frontend.
#[tauri::command]
pub fn secret_vault_clear(app: AppHandle, state: tauri::State<'_, VaultState>) -> Result<(), String> {
    let (k, _) = key_for(&app, &state)?;
    write_entries(&app, &k, &Entries::new())
}

/// Bỏ cả kho lẫn khoá và bắt đầu lại. Chỉ dành cho trường hợp kho không còn
/// giải mã được và người dùng CHỦ ĐỘNG chấp nhận mất dữ liệu cũ.
#[tauri::command]
pub fn secret_vault_reset(app: AppHandle, state: tauri::State<'_, VaultState>) -> Result<(), String> {
    let dir = app_data(&app)?;
    let _ = std::fs::remove_file(dir.join(VAULT_FILE));
    let _ = std::fs::remove_file(dir.join(KEY_FILE));
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        let _ = entry.delete_credential();
    }
    *state.key.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
pub fn secret_vault_status(app: AppHandle, state: tauri::State<'_, VaultState>) -> Result<VaultStatus, String> {
    let (k, mode) = key_for(&app, &state)?;
    Ok(VaultStatus {
        encrypted: true,
        key_mode: mode,
        readable: read_entries(&app, &k).is_ok(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> [u8; KEY_LEN] {
        <[u8; KEY_LEN]>::try_from(random_bytes(KEY_LEN).unwrap().as_slice()).unwrap()
    }

    /// Bản rút gọn của cặp write/read, không cần AppHandle — đủ để kiểm phần
    /// mật mã, là phần duy nhất ở đây có thể sai một cách âm thầm.
    fn seal(k: &[u8; KEY_LEN], entries: &Entries) -> VaultFile {
        let nonce = random_bytes(NONCE_LEN).unwrap();
        let ciphertext = cipher(k)
            .unwrap()
            .encrypt(&nonce_of(&nonce).unwrap(), serde_json::to_vec(entries).unwrap().as_ref())
            .unwrap();
        VaultFile {
            version: FORMAT_VERSION,
            nonce: BASE64.encode(&nonce),
            ciphertext: BASE64.encode(&ciphertext),
        }
    }

    fn open(k: &[u8; KEY_LEN], file: &VaultFile) -> Result<Entries, String> {
        let nonce = BASE64.decode(&file.nonce).unwrap();
        let ciphertext = BASE64.decode(&file.ciphertext).unwrap();
        let plain = cipher(k)
            .unwrap()
            .decrypt(&nonce_of(&nonce).unwrap(), ciphertext.as_ref())
            .map_err(|_| "không giải mã được".to_string())?;
        Ok(serde_json::from_slice(&plain).unwrap())
    }

    #[test]
    fn ma_hoa_roi_giai_ma_lai_dung_nguyen_ven() {
        let k = key();
        let mut entries = Entries::new();
        entries.insert("2fa/accounts".into(), "JBSWY3DPEHPK3PXP".into());

        let restored = open(&k, &seal(&k, &entries)).unwrap();
        assert_eq!(restored, entries);
    }

    #[test]
    fn ban_ma_khong_chua_ban_ro() {
        let k = key();
        let mut entries = Entries::new();
        entries.insert("2fa/accounts".into(), "JBSWY3DPEHPK3PXP".into());

        let file = seal(&k, &entries);
        // Cả giá trị lẫn TÊN khoá đều phải biến mất: tên khoá tiết lộ người dùng
        // có bí mật của plugin nào.
        assert!(!file.ciphertext.contains("JBSWY3DPEHPK3PXP"));
        assert!(!file.ciphertext.contains("2fa"));
    }

    #[test]
    fn khoa_khac_thi_khong_mo_duoc() {
        let mut entries = Entries::new();
        entries.insert("a".into(), "b".into());
        let file = seal(&key(), &entries);
        assert!(open(&key(), &file).is_err());
    }

    #[test]
    fn moi_lan_ghi_dung_mot_nonce_khac() {
        // Dùng lại nonce với cùng khoá trong GCM là hỏng hoàn toàn về mặt mật
        // mã, nên đây là bất biến đáng khoá bằng test.
        let k = key();
        let entries = Entries::new();
        let a = seal(&k, &entries);
        let b = seal(&k, &entries);
        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.ciphertext, b.ciphertext);
    }

    #[test]
    fn ban_ma_bi_sua_thi_bi_tu_choi() {
        // GCM có xác thực: sửa một byte phải làm hỏng cả lần giải mã, chứ không
        // trả ra bản rõ méo mó.
        let k = key();
        let mut entries = Entries::new();
        entries.insert("a".into(), "b".into());
        let mut file = seal(&k, &entries);

        let mut raw = BASE64.decode(&file.ciphertext).unwrap();
        raw[0] ^= 0xff;
        file.ciphertext = BASE64.encode(&raw);

        assert!(open(&k, &file).is_err());
    }

    #[test]
    fn khoa_sai_do_dai_bi_tu_choi_khi_giai_ma_base64() {
        assert!(decode_key(&BASE64.encode([0u8; 16])).is_none());
        assert!(decode_key("khong-phai-base64!!").is_none());
        assert!(decode_key(&BASE64.encode([0u8; KEY_LEN])).is_some());
    }
}
