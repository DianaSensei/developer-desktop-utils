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
use crate::editor_view;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use crate::editor_history;
use crate::editor_fs::{DirListing, FileList, FileStat, FsError, FsResult, Roots};
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

fn history_dir(app: &AppHandle) -> FsResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|d| d.join(editor_history::HISTORY_DIR))
        .map_err(|e| FsError { code: "io", message: e.to_string() })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Local History: records a snapshot of `path` (see editor_history.rs).
/// `None` when it matched the newest snapshot and was skipped.
#[tauri::command]
pub async fn editor_history_add(
    app: AppHandle,
    path: String,
    content: String,
    source: Option<String>,
) -> FsResult<Option<editor_history::HistoryEntry>> {
    let (roots, dir) = (snapshot(&app), history_dir(&app)?);
    blocking(move || {
        let key = roots.history_path(&path)?;
        editor_history::add(&dir, &key, &content, source.as_deref().unwrap_or("save"), now_ms())
    })
    .await
}

#[tauri::command]
pub async fn editor_history_list(app: AppHandle, path: String) -> FsResult<Vec<editor_history::HistoryEntry>> {
    let (roots, dir) = (snapshot(&app), history_dir(&app)?);
    blocking(move || Ok(editor_history::list(&dir, &roots.history_path(&path)?))).await
}

#[tauri::command]
pub async fn editor_history_read(app: AppHandle, path: String, id: String) -> FsResult<String> {
    let (roots, dir) = (snapshot(&app), history_dir(&app)?);
    blocking(move || editor_history::read(&dir, &roots.history_path(&path)?, &id)).await
}

#[tauri::command]
pub async fn editor_history_delete(app: AppHandle, path: String, id: String) -> FsResult<()> {
    let (roots, dir) = (snapshot(&app), history_dir(&app)?);
    blocking(move || editor_history::delete(&dir, &roots.history_path(&path)?, &id)).await
}

#[tauri::command]
pub async fn editor_history_clear(app: AppHandle, path: String) -> FsResult<()> {
    let (roots, dir) = (snapshot(&app), history_dir(&app)?);
    blocking(move || editor_history::clear(&dir, &roots.history_path(&path)?)).await
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

/// The file as raw bytes (`Roots::read_framed`: length-prefixed JSON
/// metadata, then the UTF-8 text) — a 200 MB file must not be turned into a
/// JSON string to cross the IPC boundary.
#[tauri::command]
pub async fn editor_read_file(app: AppHandle, path: String) -> FsResult<tauri::ipc::Response> {
    let roots = snapshot(&app);
    let framed = blocking(move || roots.read_framed(&path)).await?;
    Ok(tauri::ipc::Response::new(framed))
}

fn header<'a>(request: &'a tauri::ipc::Request<'_>, name: &str) -> Option<&'a str> {
    request.headers().get(name).and_then(|v| v.to_str().ok())
}

/// Decodes the `x-path` header, which the frontend sends through
/// `encodeURIComponent` (header values must be ASCII; paths need not be).
fn percent_decode(s: &str) -> FsResult<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok());
            let Some(b) = hex else {
                return Err(FsError { code: "invalid_name", message: "Malformed path header.".into() });
            };
            out.push(b);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| FsError { code: "invalid_name", message: "Malformed path header.".into() })
}

/// Saves the raw request body (UTF-8 text) to the file named by the `x-path`
/// header. `x-bom: 1` prepends a BOM; `x-expected-modified` is the conflict
/// check (see `Roots::write_text`).
#[tauri::command]
pub async fn editor_write_file(app: AppHandle, request: tauri::ipc::Request<'_>) -> FsResult<FileStat> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err(FsError { code: "io", message: "Expected the file content as raw bytes.".into() });
    };
    let path = percent_decode(header(&request, "x-path").unwrap_or_default())?;
    let bom = header(&request, "x-bom") == Some("1");
    let expected = header(&request, "x-expected-modified").and_then(|v| v.parse::<u64>().ok());
    let body = body.clone();
    let roots = snapshot(&app);
    blocking(move || roots.write_bytes(&path, &body, bom, expected)).await
}

// ── Large-file viewer (editor_view.rs) ─────────────────────────────────────

/// Open viewers by id. Bounded: opening past the cap closes the oldest.
#[derive(Default)]
pub struct ViewerRegistry {
    viewers: Mutex<Vec<(u64, Arc<editor_view::Viewer>)>>,
    next: AtomicU64,
}

const MAX_VIEWERS: usize = 16;

fn viewer(app: &AppHandle, id: u64) -> FsResult<Arc<editor_view::Viewer>> {
    let reg = app.state::<ViewerRegistry>();
    let list = reg.viewers.lock().unwrap_or_else(|e| e.into_inner());
    list.iter()
        .find(|(i, _)| *i == id)
        .map(|(_, v)| v.clone())
        .ok_or_else(|| FsError { code: "not_found", message: "That viewer was closed.".into() })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerOpened {
    id: u64,
    status: editor_view::ViewStatus,
}

/// Opens a file in the read-only viewer and starts indexing its lines in the
/// background; poll `editor_view_status` for progress.
#[tauri::command]
pub async fn editor_view_open(app: AppHandle, path: String) -> FsResult<ViewerOpened> {
    let roots = snapshot(&app);
    let v = blocking(move || {
        let canonical = roots.resolve_file(&path)?;
        editor_view::Viewer::open(&canonical)
    })
    .await?;
    let v = Arc::new(v);
    let id = {
        let reg = app.state::<ViewerRegistry>();
        let id = reg.next.fetch_add(1, Ordering::Relaxed) + 1;
        let mut list = reg.viewers.lock().unwrap_or_else(|e| e.into_inner());
        while list.len() >= MAX_VIEWERS {
            let (_, old) = list.remove(0);
            old.close();
        }
        list.push((id, v.clone()));
        id
    };
    let status = v.status();
    let worker = v.clone();
    std::thread::spawn(move || {
        let _ = worker.extend();
    });
    Ok(ViewerOpened { id, status })
}

#[tauri::command]
pub fn editor_view_status(app: AppHandle, id: u64) -> FsResult<editor_view::ViewStatus> {
    Ok(viewer(&app, id)?.status())
}

#[tauri::command]
pub async fn editor_view_lines(app: AppHandle, id: u64, start: u64, count: u64) -> FsResult<Vec<editor_view::ViewLine>> {
    let v = viewer(&app, id)?;
    blocking(move || v.read_lines(start, count)).await
}

/// Indexes whatever was appended since the last pass (`tail -f`).
#[tauri::command]
pub async fn editor_view_refresh(app: AppHandle, id: u64) -> FsResult<editor_view::ViewStatus> {
    let v = viewer(&app, id)?;
    blocking(move || v.extend()).await
}

#[tauri::command]
pub async fn editor_view_search(
    app: AppHandle,
    id: u64,
    query: String,
    regex: bool,
    case_sensitive: bool,
    from_line: u64,
    max_hits: Option<usize>,
) -> FsResult<editor_view::SearchResult> {
    let v = viewer(&app, id)?;
    let max = max_hits.unwrap_or(200).min(1000);
    blocking(move || v.search(&query, regex, case_sensitive, from_line, max, std::time::Duration::from_millis(1500))).await
}

#[tauri::command]
pub fn editor_view_close(app: AppHandle, id: u64) {
    let reg = app.state::<ViewerRegistry>();
    let mut list = reg.viewers.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(pos) = list.iter().position(|(i, _)| *i == id) {
        let (_, v) = list.remove(pos);
        v.close();
    }
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
    let (roots, dir) = (snapshot(&app), history_dir(&app)?);
    blocking(move || {
        let from = roots.resolve_entry(&path)?;
        let to = roots.rename(&path, &new_name)?;
        // Best-effort: a failure here must not report the rename as failed.
        let _ = editor_history::relocate(&dir, &from.to_string_lossy(), &to);
        Ok(to)
    })
    .await
}

#[tauri::command]
pub async fn editor_move(app: AppHandle, path: String, target_dir: String) -> FsResult<String> {
    let (roots, dir) = (snapshot(&app), history_dir(&app)?);
    blocking(move || {
        let from = roots.resolve_entry(&path)?;
        let to = roots.move_into(&path, &target_dir)?;
        let _ = editor_history::relocate(&dir, &from.to_string_lossy(), &to);
        Ok(to)
    })
    .await
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

#[cfg(test)]
mod header_tests {
    use super::percent_decode;

    #[test]
    fn decodes_encode_uri_component_output() {
        assert_eq!(percent_decode("%2Fhome%2Fme%2Fghi%20ch%C3%BA.md").unwrap(), "/home/me/ghi chú.md");
        assert_eq!(percent_decode("C%3A%5Cws%5Ca.txt").unwrap(), "C:\\ws\\a.txt");
        assert!(percent_decode("%zz").is_err());
        assert!(percent_decode("%C3").is_err(), "not UTF-8");
    }
}
