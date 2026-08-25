// Which filesystem paths the frontend is allowed to name.
//
// `files::read_file_data_url` and `checksum::hash_file` take a raw path string
// because OS drag-and-drop hands the frontend a path rather than a readable
// File, and the `fs:scope-appdata-recursive` grant does not cover it. (Tauri
// does call `Scopes::allow_file` on drop, but `Scopes` only carries the
// asset-protocol scope, and only under the `protocol-asset` feature — it never
// reaches the fs plugin. So the fs plugin genuinely cannot serve these.)
//
// Taken literally, those two commands are a "read any file the user can read"
// primitive for whatever executes in the webview. Nothing untrusted runs there
// today, but that is a property of the current frontend rather than of the IPC
// boundary, and it is the kind of property one XSS undoes.
//
// So the boundary is made explicit here: Tauri delivers the native drag events
// to Rust, which records the paths involved; the commands then read only what
// the user actually dragged onto the window.
//
// Ordering note: Tauri runs its own built-in handler — the one that emits
// `tauri://drag-drop` to the webview — *before* any listener registered through
// `Builder::on_window_event`/`on_webview_event` (see `attach_window` and
// `attach_webview` in tauri's manager). Recording only on `Drop` would
// therefore race the frontend's invoke. `Enter` carries the same paths and
// fires when the pointer first enters the window, whole human-scale moments
// earlier, so recording on both closes that gap.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Paths the user has dragged onto the window this session.
#[derive(Default)]
pub struct DroppedPaths(Mutex<HashSet<PathBuf>>);

/// Above this many remembered paths the set is cleared rather than grown
/// without bound. A drag only ever needs the paths from the gesture in
/// progress; the history is kept solely so a re-read of an earlier drop still
/// works.
const MAX_REMEMBERED: usize = 1024;

impl DroppedPaths {
    /// Record paths from a native drag event. Canonicalised on the way in, so
    /// `/tmp/../tmp/x`, a trailing slash, or a symlinked alias cannot later be
    /// presented as a different path than the one that was authorised.
    pub fn remember<P: AsRef<Path>>(&self, paths: &[P]) {
        let mut set = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if set.len() >= MAX_REMEMBERED {
            set.clear();
        }
        for p in paths {
            if let Ok(c) = p.as_ref().canonicalize() {
                set.insert(c);
            }
        }
    }

    /// Was this path dragged onto the window? A path that cannot be
    /// canonicalised (deleted, unreadable, never existed) is not allowed —
    /// there is nothing to compare it against.
    pub fn is_allowed<P: AsRef<Path>>(&self, path: P) -> bool {
        let Ok(c) = path.as_ref().canonicalize() else {
            return false;
        };
        let set = self.0.lock().unwrap_or_else(|e| e.into_inner());
        set.contains(&c)
    }
}

/// Shown to the user when a command is handed a path they never dragged in.
/// Deliberately not echoing the path back into the UI.
pub const DENIED: &str =
    "That file was not dragged onto the app, so it was not read. Drag it in again.";

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmpdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("devtool-dropped-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn remembers_a_dropped_path_and_rejects_everything_else() {
        let dir = tmpdir("basic");
        let dropped = dir.join("dropped.png");
        let other = dir.join("secret.txt");
        fs::write(&dropped, b"x").unwrap();
        fs::write(&other, b"y").unwrap();

        let paths = DroppedPaths::default();
        assert!(!paths.is_allowed(&dropped), "nothing is allowed before a drag");

        paths.remember(&[dropped.clone()]);
        assert!(paths.is_allowed(&dropped));
        // The whole point: a sibling the user never dragged stays unreadable.
        assert!(!paths.is_allowed(&other));
    }

    #[test]
    fn traversal_cannot_disguise_an_unauthorised_path() {
        let dir = tmpdir("traversal");
        let dropped = dir.join("dropped.png");
        let other = dir.join("secret.txt");
        fs::write(&dropped, b"x").unwrap();
        fs::write(&other, b"y").unwrap();

        let paths = DroppedPaths::default();
        paths.remember(&[dropped.clone()]);

        // Same file by a noisier route is still the same file: allowed.
        let noisy = dir.join("..").join(dir.file_name().unwrap()).join("dropped.png");
        assert!(paths.is_allowed(noisy));

        // A different file reached by walking out and back is not.
        let escaped = dropped.parent().unwrap().join("./secret.txt");
        assert!(!paths.is_allowed(escaped));
    }

    #[test]
    fn a_path_that_does_not_exist_is_not_allowed() {
        let paths = DroppedPaths::default();
        assert!(!paths.is_allowed(std::env::temp_dir().join("devtool-nope-xyz")));
    }

    #[test]
    fn the_set_is_bounded() {
        let dir = tmpdir("bounded");
        let f = dir.join("f");
        std::fs::write(&f, b"x").unwrap();

        let paths = DroppedPaths::default();
        for _ in 0..(MAX_REMEMBERED + 8) {
            paths.remember(&[f.clone()]);
        }
        // One distinct path, so the cap is never reached and it stays allowed.
        assert!(paths.is_allowed(&f));
        assert!(paths.0.lock().unwrap().len() <= MAX_REMEMBERED);
    }
}
