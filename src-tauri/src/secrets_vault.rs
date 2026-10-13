// Encrypted secret store for TOTP seeds, bearer tokens and similar values.
//
// Key model: data lives in `<app_data>/secrets.enc`, encrypted with
// AES-256-GCM. The 32-byte key is kept in the OS keychain (Keychain on
// macOS, Credential Manager on Windows, Secret Service on Linux), not next
// to the data.
//
// Fallback (fails open): when no keychain is available (e.g. Linux without
// Secret Service), the key is stored in `<app_data>/secrets.key` with mode
// 0600. Anyone who can read the app data directory can then read the
// secrets, including code in the webview (its fs scope covers app data); it
// only protects a copied `secrets.enc`. Failing closed would
// break 2FA and JWT tools on those machines. The active mode is reported by
// `secret_vault_status` and shown in Settings.
//
// The vault is never re-initialized automatically when it cannot be
// decrypted (e.g. the keychain entry was deleted); commands return an error
// instead. `secret_vault_reset` discards it on explicit user request.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
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

/// Where the key comes from. Shown to the user because the two modes
/// protect very differently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum KeyMode {
    /// Key stored in the OS keychain (preferred).
    Keychain,
    /// Key stored in a 0600 file next to the data.
    File,
}

#[derive(Debug, Serialize)]
pub struct VaultStatus {
    pub encrypted: bool,
    pub key_mode: KeyMode,
    /// `false` when a vault exists but the current key cannot open it, which
    /// usually means the keychain entry was deleted or replaced.
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
    // Held for the whole command, including key resolution: two first-time
    // writes racing could otherwise each create a different key and leave
    // `secrets.enc` encrypted with a key that no longer matches.
    write_lock: Mutex<()>,
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

fn write_key_file(path: &Path, key: &[u8]) -> Result<(), String> {
    crate::private_file::write(path, BASE64.encode(key)).map_err(|e| e.to_string())
}

fn decode_key(raw: &str) -> Option<[u8; KEY_LEN]> {
    let bytes = BASE64.decode(raw.trim()).ok()?;
    <[u8; KEY_LEN]>::try_from(bytes.as_slice()).ok()
}

/// Returns the key, creating it if needed. Cached in state because keychain
/// access can be slow and the vault is used on every tool operation.
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
                // A malformed keychain entry is reported rather than overwritten,
                // which would make existing data unreadable.
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
                // Keychain write failed; fall back to the key file.
            }
            Err(_) => {
                // No Secret Service, locked, or denied; fall back to the key file.
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

/// Encrypts `entries` with a fresh nonce. Reusing a nonce with the same key
/// breaks GCM entirely.
fn seal(key: &[u8; KEY_LEN], entries: &Entries) -> Result<VaultFile, String> {
    let nonce = random_bytes(NONCE_LEN)?;
    let plain = serde_json::to_vec(entries).map_err(|e| e.to_string())?;
    let ciphertext = cipher(key)?
        .encrypt(&nonce_of(&nonce)?, plain.as_ref())
        .map_err(|e| e.to_string())?;
    Ok(VaultFile {
        version: FORMAT_VERSION,
        nonce: BASE64.encode(&nonce),
        ciphertext: BASE64.encode(&ciphertext),
    })
}

/// Decrypts a vault file. Fails if it was sealed with another key or modified.
fn open(key: &[u8; KEY_LEN], file: &VaultFile) -> Result<Entries, String> {
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

fn read_entries(app: &AppHandle, key: &[u8; KEY_LEN]) -> Result<Entries, String> {
    let path = app_data(app)?.join(VAULT_FILE);
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(_) => return Ok(Entries::new()),
    };
    let file: VaultFile = serde_json::from_str(&raw).map_err(|e| format!("Kho bí mật hỏng: {e}"))?;
    open(key, &file)
}

fn write_entries(app: &AppHandle, key: &[u8; KEY_LEN], entries: &Entries) -> Result<(), String> {
    let json = serde_json::to_string(&seal(key, entries)?).map_err(|e| e.to_string())?;
    let dir = app_data(app)?;
    // Atomic write (temp file, then rename) so a crash cannot leave a
    // truncated vault.
    let tmp_path = dir.join(format!("{VAULT_FILE}.tmp"));
    crate::private_file::write(&tmp_path, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, dir.join(VAULT_FILE)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_vault_get(
    app: AppHandle,
    state: tauri::State<'_, VaultState>,
    key: String,
) -> Result<Option<String>, String> {
    let _guard = state.write_lock.lock().map_err(|e| e.to_string())?;
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
    let _guard = state.write_lock.lock().map_err(|e| e.to_string())?;
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
    let _guard = state.write_lock.lock().map_err(|e| e.to_string())?;
    let (k, _) = key_for(&app, &state)?;
    let mut entries = read_entries(&app, &k)?;
    if entries.remove(&key).is_some() {
        write_entries(&app, &k, &entries)?;
    }
    Ok(())
}

#[tauri::command]
pub fn secret_vault_keys(app: AppHandle, state: tauri::State<'_, VaultState>) -> Result<Vec<String>, String> {
    let _guard = state.write_lock.lock().map_err(|e| e.to_string())?;
    let (k, _) = key_for(&app, &state)?;
    Ok(read_entries(&app, &k)?.into_keys().collect())
}

/// Clears all entries but keeps the key. Used by the frontend's dev mode.
#[tauri::command]
pub fn secret_vault_clear(app: AppHandle, state: tauri::State<'_, VaultState>) -> Result<(), String> {
    let _guard = state.write_lock.lock().map_err(|e| e.to_string())?;
    let (k, _) = key_for(&app, &state)?;
    write_entries(&app, &k, &Entries::new())
}

/// Deletes the vault and its key. Only for when the vault can no longer be
/// decrypted and the user accepts losing its contents.
#[tauri::command]
pub fn secret_vault_reset(app: AppHandle, state: tauri::State<'_, VaultState>) -> Result<(), String> {
    let _guard = state.write_lock.lock().map_err(|e| e.to_string())?;
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
    let _guard = state.write_lock.lock().map_err(|e| e.to_string())?;
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

    #[test]
    fn encrypt_then_decrypt_round_trips() {
        let k = key();
        let mut entries = Entries::new();
        entries.insert("2fa/accounts".into(), "JBSWY3DPEHPK3PXP".into());

        let restored = open(&k, &seal(&k, &entries).unwrap()).unwrap();
        assert_eq!(restored, entries);
    }

    #[test]
    fn ciphertext_does_not_contain_plaintext() {
        let k = key();
        let mut entries = Entries::new();
        entries.insert("2fa/accounts".into(), "JBSWY3DPEHPK3PXP".into());

        let file = seal(&k, &entries).unwrap();
        // Key names must not leak either: they reveal which plugins hold
        // secrets.
        assert!(!file.ciphertext.contains("JBSWY3DPEHPK3PXP"));
        assert!(!file.ciphertext.contains("2fa"));
    }

    #[test]
    fn wrong_key_cannot_decrypt() {
        let mut entries = Entries::new();
        entries.insert("a".into(), "b".into());
        let file = seal(&key(), &entries).unwrap();
        assert!(open(&key(), &file).is_err());
    }

    #[test]
    fn every_write_uses_a_new_nonce() {
        // Nonce reuse with the same key breaks GCM, so guard it with a test.
        let k = key();
        let entries = Entries::new();
        let a = seal(&k, &entries).unwrap();
        let b = seal(&k, &entries).unwrap();
        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.ciphertext, b.ciphertext);
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        // GCM is authenticated: a modified byte must fail decryption.
        let k = key();
        let mut entries = Entries::new();
        entries.insert("a".into(), "b".into());
        let mut file = seal(&k, &entries).unwrap();

        let mut raw = BASE64.decode(&file.ciphertext).unwrap();
        raw[0] ^= 0xff;
        file.ciphertext = BASE64.encode(&raw);

        assert!(open(&k, &file).is_err());
    }

    #[test]
    fn unknown_format_version_is_rejected() {
        let k = key();
        let mut file = seal(&k, &Entries::new()).unwrap();
        file.version = FORMAT_VERSION + 1;
        assert!(open(&k, &file).is_err());
    }

    #[test]
    fn key_of_wrong_length_is_rejected() {
        assert!(decode_key(&BASE64.encode([0u8; 16])).is_none());
        assert!(decode_key("khong-phai-base64!!").is_none());
        assert!(decode_key(&BASE64.encode([0u8; KEY_LEN])).is_some());
    }
}
