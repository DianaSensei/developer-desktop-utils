// Filesystem core for the Text Editor tool (see editor.rs for the Tauri
// commands that wrap it).
//
// The editor needs more than the fs plugin's per-file scope offers: list a
// folder, create, rename, move and delete inside it. Handing the webview a
// "do anything to any path" command set would undo the boundary dropped.rs
// draws for the read commands, so the same idea is applied here at folder
// granularity: a path is only touched when it sits inside a *workspace root*,
// and a root only ever enters `Roots` through the native folder picker
// (editor::editor_pick_folder) — never from a path string the webview sends.
// Single files can be authorised the same way: one the user chose in the
// native Save As or Open File dialog may be read and written (not deleted,
// renamed or listed around), so an untitled tab saved outside any open folder
// keeps working as a normal file tab.
//
// Containment is checked on canonical paths, so `..`, a trailing slash, or a
// symlink pointing outside the root cannot be used to escape it. Operations
// that act on an entry *itself* rather than on what it points to (delete,
// rename, move) resolve only the parent, so deleting a symlink removes the
// link, not its target. A symlink inside a root that points elsewhere is
// listed but cannot be opened.
//
// Kept free of Tauri types so it can be unit tested on machines without the
// WebKit/GTK toolchain the full crate needs.

use serde::Serialize;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Above this many remembered roots (or single files) the oldest is dropped.
pub const MAX_ROOTS: usize = 64;
/// Files larger than this are not loaded into the editor.
pub const MAX_TEXT_BYTES: u64 = 10 * 1024 * 1024;
/// A folder listing stops after this many entries (and says so).
pub const MAX_DIR_ENTRIES: usize = 5_000;
/// Quick Open's file walk stops after this many files (and says so).
pub const MAX_WALK_FILES: usize = 20_000;
/// Directories Quick Open does not descend into: VCS metadata and the usual
/// dependency/build output trees, which dwarf the source in most projects.
pub const WALK_SKIP_DIRS: &[&str] = &[
    ".git", ".hg", ".svn", "node_modules", "target", "__pycache__", ".venv", ".next", ".turbo",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FsError {
    /// Stable machine-readable reason; the frontend branches on it.
    pub code: &'static str,
    pub message: String,
}

impl FsError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
    fn denied() -> Self {
        Self::new(
            "denied",
            "That path is outside the folders opened in the editor. Open its folder first.",
        )
    }
    fn invalid_name(why: &str) -> Self {
        Self::new("invalid_name", why)
    }
}

impl From<io::Error> for FsError {
    fn from(e: io::Error) -> Self {
        match e.kind() {
            io::ErrorKind::NotFound => Self::new("not_found", e.to_string()),
            io::ErrorKind::AlreadyExists => Self::new("exists", e.to_string()),
            io::ErrorKind::PermissionDenied => Self::new("permission", e.to_string()),
            _ => Self::new("io", e.to_string()),
        }
    }
}

pub type FsResult<T> = Result<T, FsError>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    /// Milliseconds since the Unix epoch; 0 when the platform cannot say.
    pub modified: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub entries: Vec<DirEntry>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    /// Empty when `binary` is true.
    pub content: String,
    pub binary: bool,
    /// The file started with a UTF-8 byte-order mark (stripped from `content`).
    pub bom: bool,
    pub size: u64,
    pub modified: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub size: u64,
    pub modified: u64,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkEntry {
    pub path: String,
    /// Relative to the root, always `/`-separated (for display and fuzzy match).
    pub rel: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileList {
    pub files: Vec<WalkEntry>,
    pub truncated: bool,
}

/// Canonicalises `p`, and on Windows drops the `\\?\` verbatim prefix for
/// ordinary drive paths so what the UI shows (and sends back) is `C:\...`.
pub fn canon(p: &Path) -> io::Result<PathBuf> {
    let c = p.canonicalize()?;
    #[cfg(windows)]
    {
        let s = c.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            let b = rest.as_bytes();
            if b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic() {
                return Ok(PathBuf::from(rest.to_string()));
            }
        }
    }
    Ok(c)
}

fn to_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn millis(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// One path component the user typed (a new file/folder name).
fn check_component(name: &str) -> FsResult<()> {
    if name.is_empty() || name.trim().is_empty() {
        return Err(FsError::invalid_name("A name is required."));
    }
    if name == "." || name == ".." {
        return Err(FsError::invalid_name("\".\" and \"..\" are not valid names."));
    }
    if name.contains('\0') || name.contains('/') || name.contains('\\') {
        return Err(FsError::invalid_name("A name cannot contain / or \\."));
    }
    if name.len() > 255 {
        return Err(FsError::invalid_name("That name is too long."));
    }
    Ok(())
}

/// A relative path the user typed when creating ("src/util/x.ts" creates the
/// folders on the way, as in VS Code). Split on both separators and checked
/// component by component, so it can never climb out of the parent.
fn split_relative(input: &str) -> FsResult<Vec<&str>> {
    let parts: Vec<&str> = input.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return Err(FsError::invalid_name("A name is required."));
    }
    for p in &parts {
        check_component(p)?;
    }
    Ok(parts)
}

/// Folders the user has opened through the native picker, plus single files
/// chosen in a native Save As / Open File dialog.
#[derive(Debug, Default, Clone)]
pub struct Roots {
    roots: Vec<PathBuf>,
    files: Vec<PathBuf>,
}

impl Roots {
    pub fn from_saved(
        paths: impl IntoIterator<Item = String>,
        files: impl IntoIterator<Item = String>,
    ) -> Self {
        let mut r = Self::default();
        for p in paths {
            // A folder deleted or unmounted since is dropped silently.
            let _ = r.add(Path::new(&p));
        }
        for f in files {
            let _ = r.add_file(Path::new(&f));
        }
        r
    }

    pub fn list(&self) -> Vec<String> {
        self.roots.iter().map(|p| to_string(p)).collect()
    }

    pub fn list_authorised_files(&self) -> Vec<String> {
        self.files.iter().map(|p| to_string(p)).collect()
    }

    /// Authorises one existing file (most recent last). A file already inside
    /// a root needs no entry of its own.
    pub fn add_file(&mut self, p: &Path) -> FsResult<PathBuf> {
        let c = canon(p)?;
        if !c.is_file() {
            return Err(FsError::new("is_dir", "Only a file can be opened on its own."));
        }
        if self.within(&c) {
            return Ok(c);
        }
        self.files.retain(|f| f != &c);
        self.files.push(c.clone());
        if self.files.len() > MAX_ROOTS {
            let excess = self.files.len() - MAX_ROOTS;
            self.files.drain(0..excess);
        }
        Ok(c)
    }

    /// Writes `content` to a path the user just chose in the native Save As
    /// dialog (which already confirmed any overwrite), then authorises it.
    /// Only ever called by Rust with the dialog's answer.
    pub fn save_chosen(&mut self, p: &Path, content: &str, bom: bool) -> FsResult<String> {
        let mut data = Vec::with_capacity(content.len() + 3);
        if bom {
            data.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        }
        data.extend_from_slice(content.as_bytes());
        std::fs::write(p, data)?;
        Ok(to_string(&self.add_file(p)?))
    }

    /// Adds a folder (most recent last). Returns its canonical form.
    pub fn add(&mut self, p: &Path) -> FsResult<PathBuf> {
        let c = canon(p)?;
        if !c.is_dir() {
            return Err(FsError::new("not_dir", "Only folders can be opened as a workspace."));
        }
        self.roots.retain(|r| r != &c);
        self.roots.push(c.clone());
        if self.roots.len() > MAX_ROOTS {
            let excess = self.roots.len() - MAX_ROOTS;
            self.roots.drain(0..excess);
        }
        Ok(c)
    }

    pub fn remove(&mut self, p: &Path) -> bool {
        let before = self.roots.len();
        let c = canon(p).unwrap_or_else(|_| p.to_path_buf());
        self.roots.retain(|r| r != &c && r.as_path() != p);
        self.roots.len() != before
    }

    fn within(&self, c: &Path) -> bool {
        self.roots.iter().any(|r| c.starts_with(r))
    }

    fn is_root(&self, c: &Path) -> bool {
        self.roots.iter().any(|r| r == c)
    }

    /// An existing path, fully resolved (symlinks followed), inside a root.
    pub fn resolve(&self, p: &str) -> FsResult<PathBuf> {
        let c = canon(Path::new(p)).map_err(|e| {
            if e.kind() == io::ErrorKind::NotFound { FsError::from(e) } else { FsError::denied() }
        })?;
        if self.within(&c) { Ok(c) } else { Err(FsError::denied()) }
    }

    /// Like `resolve`, but also accepts a single authorised file — for the
    /// operations an open file tab needs (read, write, stat) and nothing more.
    fn resolve_file(&self, p: &str) -> FsResult<PathBuf> {
        match self.resolve(p) {
            Ok(c) => Ok(c),
            Err(e) if e.code == "denied" => {
                let c = canon(Path::new(p)).map_err(|_| FsError::denied())?;
                if self.files.contains(&c) { Ok(c) } else { Err(e) }
            }
            Err(e) => Err(e),
        }
    }

    /// The entry itself (not what a symlink points to): canonical parent +
    /// file name. The parent must be inside a root and the entry must not be
    /// a root, so a workspace folder cannot be deleted/renamed from the tree.
    pub fn resolve_entry(&self, p: &str) -> FsResult<PathBuf> {
        let path = Path::new(p);
        let name = match path.components().next_back() {
            Some(Component::Normal(n)) => n.to_owned(),
            _ => return Err(FsError::denied()),
        };
        let parent = path.parent().ok_or_else(FsError::denied)?;
        let parent = canon(parent).map_err(FsError::from)?;
        let entry = parent.join(name);
        // Before the containment check, whose "outside" answer would be
        // technically right but less useful for a root.
        if self.is_root(&entry) {
            return Err(FsError::new("root", "A workspace folder cannot be changed from inside itself."));
        }
        if !self.within(&parent) {
            return Err(FsError::denied());
        }
        // Must exist (as a link or a file); `symlink_metadata` does not follow.
        std::fs::symlink_metadata(&entry)?;
        Ok(entry)
    }

    pub fn list_dir(&self, dir: &str) -> FsResult<DirListing> {
        let dir = self.resolve(dir)?;
        let mut entries = Vec::new();
        let mut truncated = false;
        for item in std::fs::read_dir(&dir)? {
            let Ok(item) = item else { continue };
            if entries.len() >= MAX_DIR_ENTRIES {
                truncated = true;
                break;
            }
            let path = item.path();
            let Ok(link_meta) = std::fs::symlink_metadata(&path) else { continue };
            let is_symlink = link_meta.file_type().is_symlink();
            // Follow the link for "is it a folder" so it gets a chevron; a
            // dangling link shows as a file.
            let meta = if is_symlink { std::fs::metadata(&path).unwrap_or(link_meta) } else { link_meta };
            entries.push(DirEntry {
                name: item.file_name().to_string_lossy().into_owned(),
                path: to_string(&path),
                is_dir: meta.is_dir(),
                is_symlink,
                size: if meta.is_dir() { 0 } else { meta.len() },
                modified: millis(&meta),
            });
        }
        // Folders first, then case-insensitive by name — VS Code's default.
        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.name.cmp(&b.name))
        });
        Ok(DirListing { entries, truncated })
    }

    pub fn stat(&self, p: &str) -> FsResult<FileStat> {
        let c = self.resolve_file(p)?;
        let meta = std::fs::metadata(&c)?;
        Ok(FileStat { size: meta.len(), modified: millis(&meta), is_dir: meta.is_dir() })
    }

    pub fn read_text(&self, p: &str) -> FsResult<FileContent> {
        let c = self.resolve_file(p)?;
        let meta = std::fs::metadata(&c)?;
        if meta.is_dir() {
            return Err(FsError::new("is_dir", "That is a folder."));
        }
        let size = meta.len();
        let modified = millis(&meta);
        if size > MAX_TEXT_BYTES {
            return Err(FsError::new(
                "too_large",
                format!("The file is too large to open in the editor ({size} bytes; limit {MAX_TEXT_BYTES})."),
            ));
        }
        let bytes = std::fs::read(&c)?;
        // NUL in the first 8 KiB is the usual "this is binary" heuristic (git
        // uses the same); invalid UTF-8 anywhere is treated the same way,
        // since saving it back would corrupt it.
        let head = &bytes[..bytes.len().min(8192)];
        if head.contains(&0) {
            return Ok(FileContent { content: String::new(), binary: true, bom: false, size, modified });
        }
        let (body, bom) = match bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
            Some(rest) => (rest, true),
            None => (&bytes[..], false),
        };
        match std::str::from_utf8(body) {
            Ok(s) => Ok(FileContent { content: s.to_string(), binary: false, bom, size, modified }),
            Err(_) => Ok(FileContent { content: String::new(), binary: true, bom: false, size, modified }),
        }
    }

    /// Overwrites an existing file. With `expected_modified`, refuses when the
    /// file changed on disk since it was read (someone else wrote it), so the
    /// editor can ask instead of silently discarding that change.
    pub fn write_text(
        &self,
        p: &str,
        content: &str,
        bom: bool,
        expected_modified: Option<u64>,
    ) -> FsResult<FileStat> {
        let c = self.resolve_file(p)?;
        let meta = std::fs::metadata(&c)?;
        if meta.is_dir() {
            return Err(FsError::new("is_dir", "That is a folder."));
        }
        if let Some(expected) = expected_modified {
            let now = millis(&meta);
            if expected != 0 && now != 0 && now != expected {
                return Err(FsError::new("conflict", "The file was changed on disk after it was opened."));
            }
        }
        let mut data = Vec::with_capacity(content.len() + 3);
        if bom {
            data.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        }
        data.extend_from_slice(content.as_bytes());
        // In place rather than write-temp-and-rename: keeps the file's
        // permissions, owner, hard links and any watcher on it intact.
        std::fs::write(&c, data)?;
        let meta = std::fs::metadata(&c)?;
        Ok(FileStat { size: meta.len(), modified: millis(&meta), is_dir: false })
    }

    fn create(&self, dir: &str, name: &str, folder: bool) -> FsResult<String> {
        let dir = self.resolve(dir)?;
        if !dir.is_dir() {
            return Err(FsError::new("not_dir", "New items can only be created inside a folder."));
        }
        let parts = split_relative(name)?;
        let (leaf, folders) = parts.split_last().ok_or_else(|| FsError::invalid_name("A name is required."))?;
        // Intermediate folders one level at a time, re-checking containment at
        // each step: one may already exist as a symlink leading out of the
        // root, and `create_dir_all` would happily build inside its target
        // before anything could object.
        let mut parent = dir;
        for folder_name in folders {
            let next = parent.join(folder_name);
            match std::fs::symlink_metadata(&next) {
                Ok(_) => {
                    let c = canon(&next)?;
                    if !self.within(&c) {
                        return Err(FsError::denied());
                    }
                    if !c.is_dir() {
                        return Err(FsError::new("not_dir", format!("\"{folder_name}\" is a file, not a folder.")));
                    }
                    parent = c;
                }
                Err(_) => {
                    std::fs::create_dir(&next)?;
                    parent = next;
                }
            }
        }
        let target = parent.join(leaf);
        if std::fs::symlink_metadata(&target).is_ok() {
            return Err(FsError::new("exists", format!("\"{}\" already exists.", parts.join("/"))));
        }
        if folder {
            std::fs::create_dir(&target)?;
        } else {
            std::fs::OpenOptions::new().write(true).create_new(true).open(&target)?;
        }
        Ok(to_string(&target))
    }

    pub fn create_file(&self, dir: &str, name: &str) -> FsResult<String> {
        self.create(dir, name, false)
    }

    pub fn create_dir(&self, dir: &str, name: &str) -> FsResult<String> {
        self.create(dir, name, true)
    }

    /// Renames within the same folder.
    pub fn rename(&self, p: &str, new_name: &str) -> FsResult<String> {
        check_component(new_name)?;
        let src = self.resolve_entry(p)?;
        let dst = src.with_file_name(new_name);
        if dst == src {
            return Ok(to_string(&src));
        }
        if std::fs::symlink_metadata(&dst).is_ok() && !same_file(&src, &dst) {
            return Err(FsError::new("exists", format!("\"{new_name}\" already exists.")));
        }
        std::fs::rename(&src, &dst)?;
        Ok(to_string(&dst))
    }

    /// Moves an entry into another folder (drag and drop in the tree).
    pub fn move_into(&self, p: &str, target_dir: &str) -> FsResult<String> {
        let src = self.resolve_entry(p)?;
        let dir = self.resolve(target_dir)?;
        if !dir.is_dir() {
            return Err(FsError::new("not_dir", "Items can only be moved into a folder."));
        }
        if dir.starts_with(&src) {
            return Err(FsError::new("invalid_move", "A folder cannot be moved into itself."));
        }
        let name = src.file_name().ok_or_else(FsError::denied)?;
        let dst = dir.join(name);
        if dst == src {
            return Ok(to_string(&src));
        }
        if std::fs::symlink_metadata(&dst).is_ok() {
            return Err(FsError::new(
                "exists",
                format!("\"{}\" already exists in the destination folder.", name.to_string_lossy()),
            ));
        }
        std::fs::rename(&src, &dst)?;
        Ok(to_string(&dst))
    }

    /// Permanently deletes a file, a symlink (not its target) or a folder
    /// with everything in it. The UI confirms first.
    pub fn delete(&self, p: &str) -> FsResult<()> {
        let entry = self.resolve_entry(p)?;
        let meta = std::fs::symlink_metadata(&entry)?;
        if meta.is_dir() {
            std::fs::remove_dir_all(&entry)?;
        } else {
            std::fs::remove_file(&entry)?;
        }
        Ok(())
    }

    /// Every file under `root` for Quick Open, skipping `WALK_SKIP_DIRS` and
    /// never following symlinked folders (no cycles, no escaping the root).
    pub fn list_files(&self, root: &str, limit: Option<usize>) -> FsResult<FileList> {
        let root = self.resolve(root)?;
        let cap = limit.unwrap_or(MAX_WALK_FILES).min(MAX_WALK_FILES);
        let mut files = Vec::new();
        let mut truncated = false;
        let mut stack = vec![root.clone()];
        'walk: while let Some(dir) = stack.pop() {
            let Ok(read) = std::fs::read_dir(&dir) else { continue };
            let mut subdirs = Vec::new();
            for item in read.flatten() {
                let Ok(ft) = item.file_type() else { continue };
                let name = item.file_name();
                let path = item.path();
                if ft.is_dir() {
                    if !WALK_SKIP_DIRS.iter().any(|s| name == *s) {
                        subdirs.push(path);
                    }
                    continue;
                }
                if files.len() >= cap {
                    truncated = true;
                    break 'walk;
                }
                let rel = path
                    .strip_prefix(&root)
                    .map(|r| r.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
                    .unwrap_or_else(|_| name.to_string_lossy().into_owned());
                files.push(WalkEntry { path: to_string(&path), rel });
            }
            // Reverse so popping visits folders in name order.
            subdirs.sort();
            subdirs.reverse();
            stack.extend(subdirs);
        }
        files.sort_by(|a, b| a.rel.cmp(&b.rel));
        Ok(FileList { files, truncated })
    }
}

/// Two names for one file — a case-only rename on a case-insensitive
/// filesystem ("readme.md" → "README.md") must not count as "already exists".
fn same_file(a: &Path, b: &Path) -> bool {
    match (canon(a), canon(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn tmp(name: &str) -> Tmp {
        let dir = std::env::temp_dir().join(format!("devtool-editor-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Tmp(canon(&dir).unwrap())
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    fn workspace(name: &str) -> (Tmp, PathBuf, Roots) {
        let t = tmp(name);
        let root = t.0.join("ws");
        fs::create_dir_all(&root).unwrap();
        let mut roots = Roots::default();
        let root = roots.add(&root).unwrap();
        (t, root, roots)
    }

    #[test]
    fn nothing_is_reachable_without_a_root() {
        let t = tmp("noroot");
        let f = t.0.join("a.txt");
        fs::write(&f, "x").unwrap();
        let roots = Roots::default();
        assert_eq!(roots.read_text(&s(&f)).unwrap_err().code, "denied");
        assert_eq!(roots.list_dir(&s(&t.0)).unwrap_err().code, "denied");
    }

    #[test]
    fn a_sibling_of_the_root_stays_out_of_reach() {
        let (t, root, roots) = workspace("sibling");
        let outside = t.0.join("secret.txt");
        fs::write(&outside, "secret").unwrap();
        assert_eq!(roots.read_text(&s(&outside)).unwrap_err().code, "denied");
        // `..` walking out of the root resolves to the same outside file.
        let sneaky = root.join("..").join("secret.txt");
        assert_eq!(roots.read_text(&s(&sneaky)).unwrap_err().code, "denied");
        assert_eq!(roots.delete(&s(&sneaky)).unwrap_err().code, "denied");
        assert!(outside.exists());
    }

    #[test]
    fn a_folder_with_a_shared_prefix_is_not_inside() {
        let (t, _root, roots) = workspace("prefix");
        // ".../ws-evil" starts with the string ".../ws" but not the path.
        let evil = t.0.join("ws-evil");
        fs::create_dir_all(&evil).unwrap();
        fs::write(evil.join("x"), "x").unwrap();
        assert_eq!(roots.list_dir(&s(&evil)).unwrap_err().code, "denied");
    }

    #[test]
    fn lists_folders_first_case_insensitively() {
        let (_t, root, roots) = workspace("list");
        fs::write(root.join("b.txt"), "b").unwrap();
        fs::write(root.join("A.txt"), "a").unwrap();
        fs::create_dir(root.join("zdir")).unwrap();
        fs::create_dir(root.join("Cdir")).unwrap();
        let listing = roots.list_dir(&s(&root)).unwrap();
        let names: Vec<_> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["Cdir", "zdir", "A.txt", "b.txt"]);
        assert!(listing.entries[0].is_dir);
        assert!(!listing.truncated);
    }

    #[test]
    fn reads_and_writes_text_round_trip() {
        let (_t, root, roots) = workspace("rw");
        let f = root.join("a.txt");
        fs::write(&f, "héllo\r\nworld").unwrap();
        let read = roots.read_text(&s(&f)).unwrap();
        assert_eq!(read.content, "héllo\r\nworld");
        assert!(!read.binary);
        assert!(!read.bom);
        let stat = roots.write_text(&s(&f), "new", false, Some(read.modified)).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "new");
        assert_eq!(stat.size, 3);
    }

    #[test]
    fn keeps_a_bom_across_a_save() {
        let (_t, root, roots) = workspace("bom");
        let f = root.join("bom.txt");
        fs::write(&f, [0xEF, 0xBB, 0xBF, b'h', b'i']).unwrap();
        let read = roots.read_text(&s(&f)).unwrap();
        assert!(read.bom);
        assert_eq!(read.content, "hi");
        roots.write_text(&s(&f), "yo", true, None).unwrap();
        assert_eq!(fs::read(&f).unwrap(), vec![0xEF, 0xBB, 0xBF, b'y', b'o']);
    }

    #[test]
    fn binary_files_are_flagged_not_decoded() {
        let (_t, root, roots) = workspace("bin");
        let f = root.join("img.bin");
        fs::write(&f, [0x89, b'P', b'N', b'G', 0, 1, 2]).unwrap();
        let read = roots.read_text(&s(&f)).unwrap();
        assert!(read.binary);
        assert!(read.content.is_empty());
        let latin1 = root.join("latin1.txt");
        fs::write(&latin1, [b'c', b'a', 0xE9]).unwrap();
        assert!(roots.read_text(&s(&latin1)).unwrap().binary);
    }

    #[test]
    fn a_stale_save_is_a_conflict() {
        let (_t, root, roots) = workspace("conflict");
        let f = root.join("a.txt");
        fs::write(&f, "x").unwrap();
        let read = roots.read_text(&s(&f)).unwrap();
        let err = roots.write_text(&s(&f), "mine", false, Some(read.modified + 1)).unwrap_err();
        assert_eq!(err.code, "conflict");
        assert_eq!(fs::read_to_string(&f).unwrap(), "x");
        // Without an expectation (Overwrite) it goes through.
        roots.write_text(&s(&f), "mine", false, None).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "mine");
    }

    #[test]
    fn writing_never_creates_a_file() {
        let (_t, root, roots) = workspace("nocreate");
        let err = roots.write_text(&s(&root.join("new.txt")), "x", false, None).unwrap_err();
        assert_eq!(err.code, "not_found");
    }

    #[test]
    fn creates_files_and_nested_folders() {
        let (_t, root, roots) = workspace("create");
        let f = roots.create_file(&s(&root), "src/util/x.ts").unwrap();
        assert!(Path::new(&f).is_file());
        assert!(f.ends_with("x.ts"));
        let d = roots.create_dir(&s(&root), "docs").unwrap();
        assert!(Path::new(&d).is_dir());
        assert_eq!(roots.create_file(&s(&root), "src/util/x.ts").unwrap_err().code, "exists");
        assert_eq!(roots.create_dir(&s(&root), "docs").unwrap_err().code, "exists");
    }

    #[test]
    fn names_cannot_climb_out() {
        let (_t, root, roots) = workspace("names");
        for bad in ["..", "../x", "a/../../x", ".", "", "   ", "a\0b"] {
            let err = roots.create_file(&s(&root), bad).unwrap_err();
            assert_eq!(err.code, "invalid_name", "{bad:?} should be rejected");
        }
        fs::write(root.join("a.txt"), "").unwrap();
        for bad in ["../evil", "x/y", "..", ""] {
            let err = roots.rename(&s(&root.join("a.txt")), bad).unwrap_err();
            assert_eq!(err.code, "invalid_name", "{bad:?} should be rejected");
        }
    }

    #[test]
    fn renames_in_place_and_refuses_to_clobber() {
        let (_t, root, roots) = workspace("rename");
        fs::write(root.join("a.txt"), "a").unwrap();
        fs::write(root.join("b.txt"), "b").unwrap();
        assert_eq!(roots.rename(&s(&root.join("a.txt")), "b.txt").unwrap_err().code, "exists");
        let new = roots.rename(&s(&root.join("a.txt")), "c.txt").unwrap();
        assert_eq!(fs::read_to_string(&new).unwrap(), "a");
        assert!(!root.join("a.txt").exists());
    }

    #[test]
    fn the_root_itself_cannot_be_deleted_or_renamed() {
        let (_t, root, roots) = workspace("rootsafe");
        assert_eq!(roots.delete(&s(&root)).unwrap_err().code, "root");
        assert_eq!(roots.rename(&s(&root), "other").unwrap_err().code, "root");
        assert!(root.exists());
    }

    #[test]
    fn deletes_files_and_folders() {
        let (_t, root, roots) = workspace("delete");
        fs::create_dir_all(root.join("d/e")).unwrap();
        fs::write(root.join("d/e/f.txt"), "x").unwrap();
        fs::write(root.join("g.txt"), "x").unwrap();
        roots.delete(&s(&root.join("g.txt"))).unwrap();
        roots.delete(&s(&root.join("d"))).unwrap();
        assert!(!root.join("g.txt").exists());
        assert!(!root.join("d").exists());
        assert_eq!(roots.delete(&s(&root.join("g.txt"))).unwrap_err().code, "not_found");
    }

    #[test]
    fn moves_into_a_folder_but_not_into_itself() {
        let (_t, root, roots) = workspace("move");
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::create_dir_all(root.join("dest")).unwrap();
        fs::write(root.join("f.txt"), "x").unwrap();
        let moved = roots.move_into(&s(&root.join("f.txt")), &s(&root.join("dest"))).unwrap();
        assert!(Path::new(&moved).exists());
        assert!(!root.join("f.txt").exists());
        let err = roots.move_into(&s(&root.join("a")), &s(&root.join("a/b"))).unwrap_err();
        assert_eq!(err.code, "invalid_move");
        fs::write(root.join("f.txt"), "y").unwrap();
        let err = roots.move_into(&s(&root.join("f.txt")), &s(&root.join("dest"))).unwrap_err();
        assert_eq!(err.code, "exists");
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_be_used_to_escape() {
        let (t, root, roots) = workspace("symlink");
        let outside_dir = t.0.join("outside");
        fs::create_dir_all(&outside_dir).unwrap();
        let secret = outside_dir.join("secret.txt");
        fs::write(&secret, "secret").unwrap();
        std::os::unix::fs::symlink(&secret, root.join("link.txt")).unwrap();
        std::os::unix::fs::symlink(&outside_dir, root.join("linkdir")).unwrap();

        // Listed, so the tree is honest about what is there…
        let names: Vec<_> = roots.list_dir(&s(&root)).unwrap().entries.into_iter().map(|e| e.name).collect();
        assert!(names.contains(&"link.txt".to_string()));
        // …but neither read, written, listed through, nor created through.
        assert_eq!(roots.read_text(&s(&root.join("link.txt"))).unwrap_err().code, "denied");
        assert_eq!(roots.write_text(&s(&root.join("link.txt")), "x", false, None).unwrap_err().code, "denied");
        assert_eq!(roots.list_dir(&s(&root.join("linkdir"))).unwrap_err().code, "denied");
        assert_eq!(roots.create_file(&s(&root), "linkdir/new.txt").unwrap_err().code, "denied");
        assert_eq!(roots.create_file(&s(&root), "linkdir/sub/new.txt").unwrap_err().code, "denied");
        assert!(!outside_dir.join("new.txt").exists());
        assert!(!outside_dir.join("sub").exists(), "no folder may be built through the link");

        // Deleting the link removes the link, never the target.
        roots.delete(&s(&root.join("link.txt"))).unwrap();
        roots.delete(&s(&root.join("linkdir"))).unwrap();
        assert!(secret.exists());
        assert_eq!(fs::read_to_string(&secret).unwrap(), "secret");
    }

    #[test]
    fn walks_files_skipping_heavy_folders() {
        let (_t, root, roots) = workspace("walk");
        fs::create_dir_all(root.join("src/deep")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join("src/deep/a.rs"), "").unwrap();
        fs::write(root.join("README.md"), "").unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "").unwrap();
        fs::write(root.join(".git/HEAD"), "").unwrap();
        let list = roots.list_files(&s(&root), None).unwrap();
        let rels: Vec<_> = list.files.iter().map(|f| f.rel.as_str()).collect();
        assert_eq!(rels, vec!["README.md", "src/deep/a.rs"]);
        assert!(!list.truncated);
        let capped = roots.list_files(&s(&root), Some(1)).unwrap();
        assert_eq!(capped.files.len(), 1);
        assert!(capped.truncated);
    }

    #[test]
    fn a_file_chosen_in_save_as_is_readable_and_writable_but_nothing_around_it() {
        let t = tmp("single");
        let mut roots = Roots::default();
        let chosen = t.0.join("notes.txt");
        let sibling = t.0.join("other.txt");
        fs::write(&sibling, "secret").unwrap();
        let path = roots.save_chosen(&chosen, "hello", false).unwrap();
        assert_eq!(fs::read_to_string(&chosen).unwrap(), "hello");
        assert_eq!(roots.read_text(&path).unwrap().content, "hello");
        roots.write_text(&path, "edited", false, None).unwrap();
        assert_eq!(roots.stat(&path).unwrap().size, 6);
        // Only that file: not its siblings, its folder, or delete/rename.
        assert_eq!(roots.read_text(&s(&sibling)).unwrap_err().code, "denied");
        assert_eq!(roots.list_dir(&s(&t.0)).unwrap_err().code, "denied");
        assert_eq!(roots.delete(&path).unwrap_err().code, "denied");
        assert_eq!(roots.rename(&path, "x.txt").unwrap_err().code, "denied");
        assert_eq!(roots.create_file(&s(&t.0), "new.txt").unwrap_err().code, "denied");
        assert!(chosen.exists());
        // Survives a restart through the saved list.
        let restored = Roots::from_saved(Vec::<String>::new(), roots.list_authorised_files());
        assert_eq!(restored.read_text(&path).unwrap().content, "edited");
    }

    #[test]
    fn a_file_inside_a_root_gets_no_separate_entry() {
        let (_t, root, mut roots) = workspace("inside");
        fs::write(root.join("a.txt"), "").unwrap();
        roots.add_file(&root.join("a.txt")).unwrap();
        assert!(roots.list_authorised_files().is_empty());
    }

    #[test]
    fn roots_are_deduplicated_capped_and_forgettable() {
        let t = tmp("roots");
        let a = t.0.join("a");
        fs::create_dir_all(&a).unwrap();
        let mut roots = Roots::default();
        roots.add(&a).unwrap();
        roots.add(&a.join(".")).unwrap();
        assert_eq!(roots.list().len(), 1);
        assert!(roots.add(&t.0.join("missing")).is_err());
        let f = t.0.join("file.txt");
        fs::write(&f, "").unwrap();
        assert_eq!(roots.add(&f).unwrap_err().code, "not_dir");
        assert!(roots.remove(&a));
        assert!(roots.list().is_empty());

        let saved = vec![s(&a), s(&t.0.join("gone"))];
        let restored = Roots::from_saved(saved, Vec::<String>::new());
        assert_eq!(restored.list(), vec![s(&canon(&a).unwrap())]);
    }
}
