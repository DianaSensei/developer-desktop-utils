// Backups of the Text Editor's untitled tabs ("hot exit"): every untitled
// buffer — open, or closed but kept under Recently closed — lives in its own
// file in `<app_data>/editor-backups/<key>.txt`, so it survives closing the
// tab, the app, or a crash, without bloating the shared settings store (the
// store plugin rewrites its whole JSON file on every change).
//
// The webview only ever names a *key*; the directory is fixed here and the
// key is restricted to `[A-Za-z0-9_-]{1,64}`, so these commands cannot reach
// any other path.

use crate::editor_fs::{FsError, FsResult};
use std::path::{Path, PathBuf};

pub const BACKUP_DIR: &str = "editor-backups";
/// One backup larger than this is refused (the tab still works; only the
/// automatic copy is skipped).
pub const MAX_BACKUP_BYTES: usize = 20 * 1024 * 1024;

fn check_key(key: &str) -> FsResult<()> {
    let ok = !key.is_empty()
        && key.len() <= 64
        && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if ok {
        Ok(())
    } else {
        Err(FsError { code: "invalid_name", message: "Invalid backup key.".into() })
    }
}

fn file_for(dir: &Path, key: &str) -> FsResult<PathBuf> {
    check_key(key)?;
    Ok(dir.join(format!("{key}.txt")))
}

/// Writes atomically (temp file + rename) so a crash mid-write leaves the
/// previous backup intact rather than a truncated one. Owner-only on Unix:
/// a scratch buffer is as likely as anything to hold a pasted secret.
pub fn write(dir: &Path, key: &str, content: &str) -> FsResult<()> {
    if content.len() > MAX_BACKUP_BYTES {
        return Err(FsError { code: "too_large", message: "This tab is too large to back up automatically.".into() });
    }
    let target = file_for(dir, key)?;
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".{key}.tmp"));
    crate::private_file::write(&tmp, content)?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

/// `None` when there is no backup under that key.
pub fn read(dir: &Path, key: &str) -> FsResult<Option<String>> {
    let path = file_for(dir, key)?;
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete(dir: &Path, key: &str) -> FsResult<()> {
    let path = file_for(dir, key)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Keys of every backup on disk (for cleaning up orphans).
pub fn list(dir: &Path) -> FsResult<Vec<String>> {
    let Ok(read) = std::fs::read_dir(dir) else { return Ok(Vec::new()) };
    let mut keys: Vec<String> = read
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let key = name.strip_suffix(".txt")?.to_string();
            check_key(&key).ok().map(|_| key)
        })
        .collect();
    keys.sort();
    Ok(keys)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("devtool-backup-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn round_trips_lists_and_deletes() {
        let dir = tmpdir("rt");
        assert_eq!(read(&dir, "abc").unwrap(), None);
        assert!(list(&dir).unwrap().is_empty(), "a missing folder lists as empty");
        write(&dir, "abc", "hello\nworld").unwrap();
        write(&dir, "x-1_y", "second").unwrap();
        write(&dir, "abc", "hello again").unwrap();
        assert_eq!(read(&dir, "abc").unwrap().as_deref(), Some("hello again"));
        assert_eq!(list(&dir).unwrap(), vec!["abc", "x-1_y"]);
        delete(&dir, "abc").unwrap();
        delete(&dir, "abc").unwrap(); // idempotent
        assert_eq!(list(&dir).unwrap(), vec!["x-1_y"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn keys_cannot_name_another_path() {
        let dir = tmpdir("keys");
        for bad in ["", "../x", "a/b", "a\\b", "..", "a.b", "nul\0", &"k".repeat(65)] {
            assert_eq!(write(&dir, bad, "x").unwrap_err().code, "invalid_name", "{bad:?}");
            assert_eq!(read(&dir, bad).unwrap_err().code, "invalid_name", "{bad:?}");
            assert_eq!(delete(&dir, bad).unwrap_err().code, "invalid_name", "{bad:?}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_oversized_backups() {
        let dir = tmpdir("big");
        let big = "x".repeat(MAX_BACKUP_BYTES + 1);
        assert_eq!(write(&dir, "big", &big).unwrap_err().code, "too_large");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
