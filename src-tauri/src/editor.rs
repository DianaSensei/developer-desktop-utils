// Tauri commands for the Text Editor tool. The filesystem rules live in
// editor_fs.rs; this file only owns the state, persistence and the native
// folder picker.
//
// Why the picker is opened from Rust rather than by the webview's
// `dialog.open`: a root is a grant (everything under it becomes editable),
// so only a folder the user chose in the OS dialog may become one. If the
// webview picked the folder and then told Rust "add this root", any script in
// the webview could name any folder. Reopening a recent folder is allowed
// because that list is also written only here, after a pick.

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

fn load(app: &AppHandle) -> Roots {
    let saved: Vec<String> = roots_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    Roots::from_saved(saved)
}

fn persist(app: &AppHandle, roots: &Roots) {
    let Some(path) = roots_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string(&roots.list()) {
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
