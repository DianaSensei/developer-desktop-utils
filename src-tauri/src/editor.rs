// Tauri commands for the Text Editor tool. The filesystem rules live in
// editor_fs.rs; this file only owns the state, persistence and the native
// folder picker.
//
// Why the picker is opened from Rust rather than by the webview's
// `dialog.open`: a root is a grant (everything under it becomes editable),
// so only a folder the user chose in the OS dialog may become one. If the
// webview picked the folder and then told Rust "add this root", any script in
// the webview could name any folder. Reopening a recent folder is allowed
// because that list is also written only here, after a pick. The same goes
// for single files chosen in the Save As / Open File dialogs.

use crate::editor_backup;
use crate::editor_fs::{DirListing, FileContent, FileList, FileStat, FsError, FsResult, Roots};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const ROOTS_FILE: &str = "editor-roots.json";

/// Authorised workspace folders; loaded from disk on first use.
#[derive(Default)]
pub struct EditorState(Mutex<Option<Roots>>);

fn roots_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(ROOTS_FILE))
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct Saved {
    #[serde(default)]
    roots: Vec<String>,
    #[serde(default)]
    files: Vec<String>,
}

fn load(app: &AppHandle) -> Roots {
    let saved = roots_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| parse_saved(&s))
        .unwrap_or_default();
    Roots::from_saved(saved.roots, saved.files)
}

/// The first version stored a bare array of folder paths; read that too.
fn parse_saved(s: &str) -> Saved {
    if let Ok(saved) = serde_json::from_str::<Saved>(s) {
        return saved;
    }
    let roots = serde_json::from_str::<Vec<String>>(s).unwrap_or_default();
    Saved { roots, files: Vec::new() }
}

fn persist(app: &AppHandle, roots: &Roots) {
    let Some(path) = roots_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let saved = Saved { roots: roots.list(), files: roots.list_authorised_files() };
    if let Ok(json) = serde_json::to_string(&saved) {
        // Best-effort: failing to remember a folder only means picking it
        // again after a restart.
        let _ = std::fs::write(path, json);
    }
}

/// A copy of the (lazily loaded) roots. The lock is held only for the clone,
/// never across filesystem work.
fn snapshot(app: &AppHandle) -> Roots {
    let state = app.state::<EditorState>();
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    guard.get_or_insert_with(|| load(app)).clone()
}

fn mutate<T>(app: &AppHandle, f: impl FnOnce(&mut Roots) -> T) -> T {
    let state = app.state::<EditorState>();
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let roots = guard.get_or_insert_with(|| load(app));
    let out = f(roots);
    persist(app, roots);
    out
}

/// Filesystem calls block; keep them off the async runtime's worker threads.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> FsResult<T> + Send + 'static) -> FsResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| FsError { code: "io", message: e.to_string() })?
}

/// Opens the OS folder picker and, if the user chose a folder, makes it a
/// workspace root. `None` when the dialog was cancelled.
#[tauri::command]
pub async fn editor_pick_folder(app: AppHandle) -> FsResult<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().set_title("Open Folder").pick_folder(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = rx.await.map_err(|e| FsError { code: "io", message: e.to_string() })?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked
        .into_path()
        .map_err(|e| FsError { code: "io", message: e.to_string() })?;
    let added = mutate(&app, |roots| roots.add(&path))?;
    Ok(Some(added.to_string_lossy().into_owned()))
}

/// Writes an untitled buffer to a path the user picks in the OS Save dialog
/// and authorises that file. `None` when the dialog was cancelled.
#[tauri::command]
pub async fn editor_save_as(
    app: AppHandle,
    content: String,
    suggested_name: Option<String>,
    bom: Option<bool>,
) -> FsResult<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file().set_title("Save As");
    if let Some(name) = suggested_name.filter(|n| !n.trim().is_empty()) {
        dialog = dialog.set_file_name(name);
    }
    dialog.save_file(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = rx.await.map_err(|e| FsError { code: "io", message: e.to_string() })?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked
        .into_path()
        .map_err(|e| FsError { code: "io", message: e.to_string() })?;
    let app2 = app.clone();
    let saved = blocking(move || mutate(&app2, |roots| roots.save_chosen(&path, &content, bom.unwrap_or(false)))).await?;
    Ok(Some(saved))
}

/// Opens one file through the OS dialog and authorises it.
#[tauri::command]
pub async fn editor_pick_file(app: AppHandle) -> FsResult<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().set_title("Open File").pick_file(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = rx.await.map_err(|e| FsError { code: "io", message: e.to_string() })?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked
        .into_path()
        .map_err(|e| FsError { code: "io", message: e.to_string() })?;
    let added = mutate(&app, |roots| roots.add_file(&path))?;
    Ok(Some(added.to_string_lossy().into_owned()))
}

/// Single files authorised through Save As / Open File (oldest first).
#[tauri::command]
pub fn editor_authorised_files(app: AppHandle) -> Vec<String> {
    snapshot(&app).list_authorised_files()
}

fn backup_dir(app: &AppHandle) -> FsResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|d| d.join(editor_backup::BACKUP_DIR))
        .map_err(|e| FsError { code: "io", message: e.to_string() })
}

/// Saves the content of an untitled tab (see editor_backup.rs).
#[tauri::command]
pub async fn editor_backup_write(app: AppHandle, key: String, content: String) -> FsResult<()> {
    let dir = backup_dir(&app)?;
    blocking(move || editor_backup::write(&dir, &key, &content)).await
}

#[tauri::command]
pub async fn editor_backup_read(app: AppHandle, key: String) -> FsResult<Option<String>> {
    let dir = backup_dir(&app)?;
    blocking(move || editor_backup::read(&dir, &key)).await
}

#[tauri::command]
pub async fn editor_backup_delete(app: AppHandle, key: String) -> FsResult<()> {
    let dir = backup_dir(&app)?;
    blocking(move || editor_backup::delete(&dir, &key)).await
}

#[tauri::command]
pub async fn editor_backup_list(app: AppHandle) -> FsResult<Vec<String>> {
    let dir = backup_dir(&app)?;
    blocking(move || editor_backup::list(&dir)).await
}

/// Every folder ever opened (oldest first) that still exists.
#[tauri::command]
pub fn editor_roots(app: AppHandle) -> Vec<String> {
    snapshot(&app).list()
}

/// Drops a folder from the recent list, revoking access to it.
#[tauri::command]
pub fn editor_forget_root(app: AppHandle, path: String) -> bool {
    mutate(&app, |roots| roots.remove(Path::new(&path)))
}

#[tauri::command]
pub async fn editor_list_dir(app: AppHandle, path: String) -> FsResult<DirListing> {
    let roots = snapshot(&app);
    blocking(move || roots.list_dir(&path)).await
}

#[tauri::command]
pub async fn editor_list_files(app: AppHandle, root: String, limit: Option<usize>) -> FsResult<FileList> {
    let roots = snapshot(&app);
    blocking(move || roots.list_files(&root, limit)).await
}

#[tauri::command]
pub async fn editor_stat(app: AppHandle, path: String) -> FsResult<FileStat> {
    let roots = snapshot(&app);
    blocking(move || roots.stat(&path)).await
}

#[tauri::command]
pub async fn editor_read_file(app: AppHandle, path: String) -> FsResult<FileContent> {
    let roots = snapshot(&app);
    blocking(move || roots.read_text(&path)).await
}

#[tauri::command]
pub async fn editor_write_file(
    app: AppHandle,
    path: String,
    content: String,
    bom: Option<bool>,
    expected_modified: Option<u64>,
) -> FsResult<FileStat> {
    let roots = snapshot(&app);
    blocking(move || roots.write_text(&path, &content, bom.unwrap_or(false), expected_modified)).await
}

#[tauri::command]
pub async fn editor_create_file(app: AppHandle, dir: String, name: String) -> FsResult<String> {
    let roots = snapshot(&app);
    blocking(move || roots.create_file(&dir, &name)).await
}

#[tauri::command]
pub async fn editor_create_dir(app: AppHandle, dir: String, name: String) -> FsResult<String> {
    let roots = snapshot(&app);
    blocking(move || roots.create_dir(&dir, &name)).await
}

#[tauri::command]
pub async fn editor_rename(app: AppHandle, path: String, new_name: String) -> FsResult<String> {
    let roots = snapshot(&app);
    blocking(move || roots.rename(&path, &new_name)).await
}

#[tauri::command]
pub async fn editor_move(app: AppHandle, path: String, target_dir: String) -> FsResult<String> {
    let roots = snapshot(&app);
    blocking(move || roots.move_into(&path, &target_dir)).await
}

#[tauri::command]
pub async fn editor_delete(app: AppHandle, path: String) -> FsResult<()> {
    let roots = snapshot(&app);
    blocking(move || roots.delete(&path)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_both_saved_formats() {
        let old = parse_saved(r#"["/a","/b"]"#);
        assert_eq!(old.roots, vec!["/a", "/b"]);
        assert!(old.files.is_empty());
        let new = parse_saved(r#"{"roots":["/a"],"files":["/f.txt"]}"#);
        assert_eq!(new.roots, vec!["/a"]);
        assert_eq!(new.files, vec!["/f.txt"]);
        let junk = parse_saved("not json");
        assert!(junk.roots.is_empty() && junk.files.is_empty());
    }
}
