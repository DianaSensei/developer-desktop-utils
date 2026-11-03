// Local History for the Text Editor (VS Code's Timeline "Local History"):
// when the user turns it on, every save stores a snapshot of the file, which
// they can later view, restore from, or delete.
//
// Layout: `<app_data>/editor-history/<key>/` per file, where `<key>` is the
// SHA-256 of the file's canonical path (no path characters reach the file
// system), holding `index.json` and one `<id>.txt` per snapshot.
//
// Every command takes the *file path* and re-checks it against `Roots`
// (editor_fs.rs) first, so history can only be read or written for a file the
// editor may open right now — the same boundary as reading the file itself.

use crate::checksum::to_hex;
use crate::editor_fs::{FsError, FsResult, MAX_TEXT_BYTES};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::path::{Path, PathBuf};

pub const HISTORY_DIR: &str = "editor-history";
/// Snapshots kept per file; the oldest go first (VS Code's maxFileEntries).
pub const MAX_ENTRIES: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    /// Milliseconds since the Unix epoch.
    pub ts: u64,
    pub size: u64,
    /// SHA-256 of the content, to skip a snapshot identical to the last one.
    pub hash: String,
    /// `save` (the content just saved), `previous` (what was on disk before
    /// the first recorded save) or `restore` (content replaced by a restore).
    pub source: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Index {
    path: String,
    entries: Vec<HistoryEntry>,
}

fn sha256_hex(data: &[u8]) -> String {
    to_hex(sha2::Sha256::digest(data).as_ref())
}

/// Folder holding one file's history.
fn file_dir(base: &Path, canonical_path: &str) -> PathBuf {
    base.join(&sha256_hex(canonical_path.as_bytes())[..32])
}

fn read_index(dir: &Path) -> Index {
    std::fs::read_to_string(dir.join("index.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_index(dir: &Path, index: &Index) -> FsResult<()> {
    let json = serde_json::to_string(index).map_err(|e| FsError { code: "io", message: e.to_string() })?;
    let tmp = dir.join(".index.tmp");
    crate::private_file::write(&tmp, json)?;
    std::fs::rename(&tmp, dir.join("index.json"))?;
    Ok(())
}

fn check_id(id: &str) -> FsResult<()> {
    let ok = !id.is_empty() && id.len() <= 40 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(FsError { code: "invalid_name", message: "Invalid snapshot id.".into() })
    }
}

/// Records a snapshot unless it matches the newest one. Returns the entry
/// written, or `None` when skipped as a duplicate.
pub fn add(base: &Path, canonical_path: &str, content: &str, source: &str, now_ms: u64) -> FsResult<Option<HistoryEntry>> {
    if content.len() as u64 > MAX_TEXT_BYTES {
        return Err(FsError { code: "too_large", message: "The file is too large for Local History.".into() });
    }
    let source = match source {
        "save" | "previous" | "restore" => source,
        _ => "save",
    };
    let dir = file_dir(base, canonical_path);
    std::fs::create_dir_all(&dir)?;
    let mut index = read_index(&dir);
    let hash = sha256_hex(content.as_bytes());
    if index.entries.last().is_some_and(|e| e.hash == hash) {
        return Ok(None);
    }
    // Millisecond timestamp plus a counter keeps ids unique and sortable even
    // for two saves in the same millisecond.
    let mut id = format!("{now_ms:013}");
    let mut n = 0;
    while index.entries.iter().any(|e| e.id == id) {
        n += 1;
        id = format!("{now_ms:013}-{n}");
    }
    let tmp = dir.join(format!(".{id}.tmp"));
    crate::private_file::write(&tmp, content)?;
    std::fs::rename(&tmp, dir.join(format!("{id}.txt")))?;
    let entry = HistoryEntry { id, ts: now_ms, size: content.len() as u64, hash, source: source.to_string() };
    index.path = canonical_path.to_string();
    index.entries.push(entry.clone());
    while index.entries.len() > MAX_ENTRIES {
        let old = index.entries.remove(0);
        let _ = std::fs::remove_file(dir.join(format!("{}.txt", old.id)));
    }
    write_index(&dir, &index)?;
    Ok(Some(entry))
}

/// Newest first.
pub fn list(base: &Path, canonical_path: &str) -> Vec<HistoryEntry> {
    let mut entries = read_index(&file_dir(base, canonical_path)).entries;
    entries.reverse();
    entries
}

pub fn read(base: &Path, canonical_path: &str, id: &str) -> FsResult<String> {
    check_id(id)?;
    let path = file_dir(base, canonical_path).join(format!("{id}.txt"));
    let bytes = std::fs::read(path)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub fn delete(base: &Path, canonical_path: &str, id: &str) -> FsResult<()> {
    check_id(id)?;
    let dir = file_dir(base, canonical_path);
    let mut index = read_index(&dir);
    index.entries.retain(|e| e.id != id);
    let _ = std::fs::remove_file(dir.join(format!("{id}.txt")));
    if index.entries.is_empty() {
        let _ = std::fs::remove_dir_all(&dir);
        return Ok(());
    }
    write_index(&dir, &index)
}

/// Every snapshot of one file.
pub fn clear(base: &Path, canonical_path: &str) -> FsResult<()> {
    match std::fs::remove_dir_all(file_dir(base, canonical_path)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// After a rename/move: history filed under `from` (or below it, for a
/// folder) follows to `to`.
pub fn relocate(base: &Path, from: &str, to: &str) -> FsResult<()> {
    let Ok(read) = std::fs::read_dir(base) else { return Ok(()) };
    let from_path = Path::new(from);
    for entry in read.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let mut index = read_index(&dir);
        let old = Path::new(&index.path);
        let Ok(rest) = old.strip_prefix(from_path) else { continue };
        let new_path = if rest.as_os_str().is_empty() { PathBuf::from(to) } else { Path::new(to).join(rest) };
        let new_path = new_path.to_string_lossy().into_owned();
        let new_dir = file_dir(base, &new_path);
        if new_dir.exists() {
            // Something already has history there (an older file of that
            // name): keep both by merging, oldest first, within the cap.
            let mut target = read_index(&new_dir);
            for e in index.entries.drain(..) {
                let _ = std::fs::rename(dir.join(format!("{}.txt", e.id)), new_dir.join(format!("{}.txt", e.id)));
                if !target.entries.iter().any(|t| t.id == e.id) {
                    target.entries.push(e);
                }
            }
            target.entries.sort_by(|a, b| a.id.cmp(&b.id));
            while target.entries.len() > MAX_ENTRIES {
                let gone = target.entries.remove(0);
                let _ = std::fs::remove_file(new_dir.join(format!("{}.txt", gone.id)));
            }
            target.path = new_path;
            write_index(&new_dir, &target)?;
            let _ = std::fs::remove_dir_all(&dir);
        } else {
            std::fs::rename(&dir, &new_dir)?;
            index.path = new_path;
            write_index(&new_dir, &index)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("devtool-history-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn records_lists_newest_first_and_reads_back() {
        let b = base("basic");
        let e1 = add(&b, "/ws/a.txt", "one", "previous", 1_000).unwrap().unwrap();
        let e2 = add(&b, "/ws/a.txt", "two", "save", 2_000).unwrap().unwrap();
        assert_eq!(list(&b, "/ws/a.txt").iter().map(|e| e.id.clone()).collect::<Vec<_>>(), vec![e2.id.clone(), e1.id.clone()]);
        assert_eq!(read(&b, "/ws/a.txt", &e1.id).unwrap(), "one");
        assert_eq!(list(&b, "/ws/a.txt")[1].source, "previous");
        // Another file has its own history.
        assert!(list(&b, "/ws/b.txt").is_empty());
        let _ = std::fs::remove_dir_all(&b);
    }

    #[test]
    fn skips_a_snapshot_identical_to_the_newest() {
        let b = base("dedup");
        assert!(add(&b, "/f", "same", "save", 1).unwrap().is_some());
        assert!(add(&b, "/f", "same", "save", 2).unwrap().is_none());
        assert!(add(&b, "/f", "changed", "save", 3).unwrap().is_some());
        assert!(add(&b, "/f", "same", "save", 4).unwrap().is_some(), "only the newest is compared");
        assert_eq!(list(&b, "/f").len(), 3);
        let _ = std::fs::remove_dir_all(&b);
    }

    #[test]
    fn same_millisecond_saves_get_distinct_ids() {
        let b = base("ids");
        let a = add(&b, "/f", "a", "save", 5).unwrap().unwrap();
        let c = add(&b, "/f", "c", "save", 5).unwrap().unwrap();
        assert_ne!(a.id, c.id);
        let _ = std::fs::remove_dir_all(&b);
    }

    #[test]
    fn keeps_at_most_max_entries_deleting_the_oldest_files() {
        let b = base("cap");
        for i in 0..(MAX_ENTRIES as u64 + 5) {
            add(&b, "/f", &format!("v{i}"), "save", 1_000 + i).unwrap();
        }
        let entries = list(&b, "/f");
        assert_eq!(entries.len(), MAX_ENTRIES);
        assert_eq!(read(&b, "/f", &entries[0].id).unwrap(), format!("v{}", MAX_ENTRIES + 4));
        let files = std::fs::read_dir(file_dir(&b, "/f")).unwrap().filter(|e| {
            e.as_ref().unwrap().path().extension().is_some_and(|x| x == "txt")
        }).count();
        assert_eq!(files, MAX_ENTRIES);
        let _ = std::fs::remove_dir_all(&b);
    }

    #[test]
    fn delete_and_clear() {
        let b = base("delete");
        let e = add(&b, "/f", "x", "save", 1).unwrap().unwrap();
        add(&b, "/f", "y", "save", 2).unwrap();
        delete(&b, "/f", &e.id).unwrap();
        assert_eq!(list(&b, "/f").len(), 1);
        assert_eq!(read(&b, "/f", &e.id).unwrap_err().code, "not_found");
        clear(&b, "/f").unwrap();
        assert!(list(&b, "/f").is_empty());
        let _ = std::fs::remove_dir_all(&b);
    }

    #[test]
    fn history_follows_a_renamed_file_or_folder() {
        let b = base("relocate");
        add(&b, "/ws/old.txt", "f", "save", 1).unwrap();
        add(&b, "/ws/dir/inner.txt", "i", "save", 1).unwrap();
        add(&b, "/ws/dirty.txt", "not under /ws/dir", "save", 1).unwrap();
        relocate(&b, "/ws/old.txt", "/ws/new.txt").unwrap();
        relocate(&b, "/ws/dir", "/ws/moved").unwrap();
        assert!(list(&b, "/ws/old.txt").is_empty());
        assert_eq!(list(&b, "/ws/new.txt").len(), 1);
        assert_eq!(read(&b, "/ws/moved/inner.txt", &list(&b, "/ws/moved/inner.txt")[0].id).unwrap(), "i");
        assert_eq!(list(&b, "/ws/dirty.txt").len(), 1, "a sibling with a shared prefix stays");
        let _ = std::fs::remove_dir_all(&b);
    }

    #[test]
    fn ids_cannot_name_another_path() {
        let b = base("ids-bad");
        for bad in ["", "../x", "a/b", "a.txt", "..", &"9".repeat(41)] {
            assert_eq!(read(&b, "/f", bad).unwrap_err().code, "invalid_name", "{bad:?}");
            assert_eq!(delete(&b, "/f", bad).unwrap_err().code, "invalid_name", "{bad:?}");
        }
    }
}
