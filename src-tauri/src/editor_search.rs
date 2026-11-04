// "Search" (⌘⇧F) for the Text Editor: find text in every file under the
// opened folders, like VS Code's search view.
//
// Boundary: the folders searched are the authorised roots (editor_fs.rs);
// the webview may narrow the set but every one it names goes through
// `Roots::resolve`, so nothing outside the opened folders is read. Folders
// in `WALK_SKIP_DIRS` are never entered and symlinked folders are not
// followed, as in Quick Open. Read-only: replacing is done by the frontend
// through the ordinary write command.
//
// Matching is per line (like VS Code without multiline). Files that look
// binary (a NUL in the first 8 KB) or are larger than MAX_SEARCH_FILE_BYTES
// are skipped. A newer search, the result cap or the time budget stops the
// walk; the reply says so.

use crate::editor_fs::{FsError, FsResult, Roots, WALK_SKIP_DIRS};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// Files above this are not searched.
pub const MAX_SEARCH_FILE_BYTES: u64 = 50 * 1024 * 1024;
/// Default and hard cap on matches returned.
pub const DEFAULT_MAX_RESULTS: usize = 10_000;
pub const HARD_MAX_RESULTS: usize = 50_000;
/// Files looked at before the walk gives up (and says so).
pub const MAX_SEARCH_FILES: usize = 100_000;
/// Stop after this long; the reply is marked truncated.
pub const SEARCH_BUDGET: Duration = Duration::from_secs(15);
/// Characters of context kept before a match in its preview.
const PREVIEW_BEFORE: usize = 40;
/// Characters kept after the start of a match.
const PREVIEW_AFTER: usize = 220;

static SEARCH_EPOCH: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchQuery {
    pub query: String,
    pub regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
    /// Comma-separated globs; empty = every file.
    pub include: String,
    /// Comma-separated globs.
    pub exclude: String,
    /// Skip what the root's `.gitignore` lists.
    pub use_ignore_files: bool,
    pub max_results: Option<usize>,
    /// Folders to search (each must be an opened folder); empty = all.
    pub roots: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LineMatch {
    /// 1-based.
    pub line: u32,
    /// Offset of the match in the line, in UTF-16 code units (JS string index).
    pub column: usize,
    /// Match length in UTF-16 code units.
    pub length: usize,
    /// The line, leading whitespace dropped and long lines cut around the match.
    pub preview: String,
    /// Offset of the match in `preview`, UTF-16 code units.
    pub preview_column: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMatches {
    pub path: String,
    pub root: String,
    /// Relative to the root, `/`-separated.
    pub rel: String,
    pub matches: Vec<LineMatch>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutput {
    pub files: Vec<FileMatches>,
    pub match_count: usize,
    pub files_searched: usize,
    /// Stopped early: result cap, file cap or time budget.
    pub truncated: bool,
    /// A newer search started; these results are stale.
    pub cancelled: bool,
    pub elapsed_ms: u64,
}

/// Starts a new search generation; any running search notices and stops.
pub fn next_epoch() -> u64 {
    SEARCH_EPOCH.fetch_add(1, Ordering::SeqCst) + 1
}

/// Stops whatever search is running.
pub fn cancel() {
    next_epoch();
}

fn invalid(e: impl ToString) -> FsError {
    FsError { code: "invalid_regex", message: e.to_string() }
}

/// The matcher for a query: literal text is escaped, whole word wraps it in
/// word boundaries.
pub fn build_matcher(q: &SearchQuery) -> FsResult<Option<Regex>> {
    if q.query.is_empty() {
        return Ok(None);
    }
    let mut pattern = if q.regex { q.query.clone() } else { regex::escape(&q.query) };
    if q.whole_word {
        pattern = format!(r"\b(?:{pattern})\b");
    }
    RegexBuilder::new(&pattern)
        .case_insensitive(!q.case_sensitive)
        .size_limit(1 << 22)
        .build()
        .map(Some)
        .map_err(invalid)
}

// ── Globs ───────────────────────────────────────────────────────────────

/// Splits on commas outside `{…}`.
fn split_globs(spec: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut depth = 0i32;
    for ch in spec.chars() {
        match ch {
            '{' => { depth += 1; cur.push(ch); }
            '}' => { depth -= 1; cur.push(ch); }
            ',' if depth <= 0 => { out.push(std::mem::take(&mut cur)); }
            _ => cur.push(ch),
        }
    }
    out.push(cur);
    out.into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
}

/// One glob as a regex over a root-relative `/` path. VS Code-like:
/// `*.ts` and `docs` match at any depth, `/docs` only at the root, and a
/// pattern that matches a folder also matches everything inside it.
pub fn glob_to_regex(glob: &str) -> String {
    let mut g = glob.replace('\\', "/");
    if let Some(rest) = g.strip_prefix("./") {
        g = rest.to_string();
    }
    let anchored = g.starts_with('/');
    let g = g.trim_start_matches('/');
    let g = if g.ends_with('/') { format!("{g}**") } else { g.to_string() };
    let mut re = String::from("^");
    if !anchored && !g.starts_with("**") {
        re.push_str("(?:.*/)?");
    }
    let chars: Vec<char> = g.chars().collect();
    let mut i = 0;
    let mut in_brace = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '*' if chars.get(i + 1) == Some(&'*') => {
                i += 1;
                if chars.get(i + 1) == Some(&'/') {
                    i += 1;
                    re.push_str("(?:.*/)?");
                } else {
                    re.push_str(".*");
                }
            }
            '*' => re.push_str("[^/]*"),
            '?' => re.push_str("[^/]"),
            '{' => { in_brace += 1; re.push_str("(?:"); }
            '}' if in_brace > 0 => { in_brace -= 1; re.push(')'); }
            ',' if in_brace > 0 => re.push('|'),
            '[' => {
                // Character class: copied, `!` negation becomes `^`.
                let mut j = i + 1;
                let mut class = String::from("[");
                if chars.get(j) == Some(&'!') { class.push('^'); j += 1; }
                while j < chars.len() && chars[j] != ']' {
                    if chars[j] == '\\' { class.push('\\'); }
                    class.push(chars[j]);
                    j += 1;
                }
                if j < chars.len() {
                    class.push(']');
                    re.push_str(&class);
                    i = j;
                } else {
                    re.push_str(r"\[");
                }
            }
            _ => re.push_str(&regex::escape(&c.to_string())),
        }
        i += 1;
    }
    re.push_str("(?:/.*)?$");
    re
}

#[derive(Debug, Default, Clone)]
pub struct GlobSet(Vec<Regex>);

impl GlobSet {
    pub fn new(spec: &str) -> FsResult<Self> {
        Self::from_globs(split_globs(spec).iter().map(String::as_str))
    }

    fn from_globs<'a>(globs: impl Iterator<Item = &'a str>) -> FsResult<Self> {
        let mut out = Vec::new();
        for g in globs {
            let re = RegexBuilder::new(&glob_to_regex(g))
                .case_insensitive(true)
                .build()
                .map_err(|e| FsError { code: "invalid_regex", message: format!("Bad pattern “{g}”: {e}") })?;
            out.push(re);
        }
        Ok(Self(out))
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn matches(&self, rel: &str) -> bool {
        self.0.iter().any(|r| r.is_match(rel))
    }
}

/// The root's `.gitignore`, as globs (negations and nested ignore files are
/// not supported; comments and blanks skipped).
fn gitignore(root: &Path) -> GlobSet {
    let Ok(text) = std::fs::read_to_string(root.join(".gitignore")) else { return GlobSet::default() };
    let lines: Vec<String> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with('!'))
        .map(|l| {
            // `foo/bar` (a slash inside) is relative to the root in git.
            let inner = l.trim_end_matches('/');
            if inner.contains('/') && !l.starts_with('/') && !l.starts_with("**") { format!("/{l}") } else { l.to_string() }
        })
        .collect();
    GlobSet::from_globs(lines.iter().map(String::as_str)).unwrap_or_default()
}

// ── Matching one file ───────────────────────────────────────────────────

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Every match of `re` in `text`, line by line, up to `limit`.
pub fn search_text(text: &str, re: &Regex, limit: usize) -> Vec<LineMatch> {
    let mut out = Vec::new();
    for (idx, raw) in text.split('\n').enumerate() {
        if out.len() >= limit {
            break;
        }
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        for m in re.find_iter(line) {
            if m.start() == m.end() {
                continue;
            }
            if out.len() >= limit {
                break;
            }
            out.push(line_match(line, idx, m.start(), m.end()));
        }
    }
    out
}

fn line_match(line: &str, idx: usize, start: usize, end: usize) -> LineMatch {
    // Leading whitespace is dropped; a long line is cut to a window around
    // the match, on character boundaries.
    let indent = line.len() - line.trim_start().len();
    let mut from = indent.min(start);
    let before = line[from..start].chars().count();
    if before > PREVIEW_BEFORE {
        from = line[..start].char_indices().rev().nth(PREVIEW_BEFORE - 1).map(|(i, _)| i).unwrap_or(from);
    }
    let to = line[start..].char_indices().nth(PREVIEW_AFTER).map(|(i, _)| start + i).unwrap_or(line.len()).max(end);
    let mut preview = String::new();
    if from > indent {
        preview.push('…');
    }
    preview.push_str(&line[from..to]);
    let lead = if from > indent { 1 } else { 0 };
    LineMatch {
        line: (idx + 1) as u32,
        column: utf16_len(&line[..start]),
        length: utf16_len(&line[start..end]),
        preview_column: lead + utf16_len(&line[from..start]),
        preview,
    }
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(8192)].contains(&0)
}

fn rel_of(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .map(|r| r.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
        .unwrap_or_else(|_| path.to_string_lossy().into_owned())
}

// ── Walk ────────────────────────────────────────────────────────────────

/// Runs a search. `epoch` comes from `next_epoch()`; a newer one stops it.
pub fn search(roots: &Roots, q: &SearchQuery, epoch: u64) -> FsResult<SearchOutput> {
    let started = Instant::now();
    let Some(re) = build_matcher(q)? else { return Ok(SearchOutput::default()) };
    let include = GlobSet::new(&q.include)?;
    let exclude = GlobSet::new(&q.exclude)?;
    let limit = q.max_results.unwrap_or(DEFAULT_MAX_RESULTS).clamp(1, HARD_MAX_RESULTS);

    let wanted: Vec<String> = if q.roots.is_empty() { roots.list() } else { q.roots.clone() };
    let mut resolved: Vec<(String, PathBuf)> = Vec::new();
    for r in &wanted {
        let p = roots.resolve(r)?;
        // Only whole opened folders may be searched, not any folder in them.
        if roots.list().iter().any(|x| Path::new(x) == p) || q.roots.is_empty() {
            resolved.push((r.clone(), p));
        } else {
            return Err(FsError { code: "denied", message: "Only opened folders can be searched.".into() });
        }
    }

    let mut out = SearchOutput::default();
    let stale = || SEARCH_EPOCH.load(Ordering::SeqCst) != epoch;
    'roots: for (root_str, root) in resolved {
        let ignore = if q.use_ignore_files { gitignore(&root) } else { GlobSet::default() };
        let skip = |rel: &str| exclude.matches(rel) || (!ignore.is_empty() && ignore.matches(rel));
        let mut stack = vec![root.clone()];
        while let Some(dir) = stack.pop() {
            let Ok(read) = std::fs::read_dir(&dir) else { continue };
            let mut entries: Vec<_> = read.flatten().collect();
            entries.sort_by_key(|e| e.file_name());
            let mut subdirs = Vec::new();
            for item in entries {
                let Ok(ft) = item.file_type() else { continue };
                let path = item.path();
                let name = item.file_name();
                let rel = rel_of(&path, &root);
                if ft.is_dir() {
                    if !WALK_SKIP_DIRS.iter().any(|s| name == *s) && !skip(&rel) {
                        subdirs.push(path);
                    }
                    continue;
                }
                if !ft.is_file() || skip(&rel) || (!include.is_empty() && !include.matches(&rel)) {
                    continue;
                }
                if out.files_searched >= MAX_SEARCH_FILES || started.elapsed() > SEARCH_BUDGET {
                    out.truncated = true;
                    break 'roots;
                }
                if out.files_searched % 64 == 0 && stale() {
                    out.cancelled = true;
                    break 'roots;
                }
                out.files_searched += 1;
                let Ok(meta) = item.metadata() else { continue };
                if meta.len() > MAX_SEARCH_FILE_BYTES {
                    continue;
                }
                let Ok(bytes) = std::fs::read(&path) else { continue };
                if looks_binary(&bytes) {
                    continue;
                }
                let text = String::from_utf8_lossy(&bytes);
                let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
                let matches = search_text(text, &re, limit - out.match_count);
                if matches.is_empty() {
                    continue;
                }
                out.match_count += matches.len();
                out.files.push(FileMatches { path: path.to_string_lossy().into_owned(), root: root_str.clone(), rel, matches });
                if out.match_count >= limit {
                    out.truncated = true;
                    break 'roots;
                }
            }
            subdirs.reverse();
            stack.extend(subdirs);
        }
    }
    out.elapsed_ms = started.elapsed().as_millis() as u64;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn q(query: &str) -> SearchQuery {
        SearchQuery { query: query.into(), use_ignore_files: true, ..Default::default() }
    }

    #[test]
    fn globs_follow_vscode_rules() {
        let set = |s: &str| GlobSet::new(s).unwrap();
        assert!(set("*.ts").matches("src/a/b.ts"));
        assert!(!set("*.ts").matches("src/a/b.tsx"));
        assert!(set("*.{ts,tsx}").matches("b.tsx"));
        assert!(set("docs").matches("docs/guide.md"));
        assert!(set("docs").matches("a/docs/guide.md"));
        assert!(!set("docs").matches("mydocs/guide.md"));
        assert!(set("/docs").matches("docs/x"));
        assert!(!set("/docs").matches("a/docs/x"));
        assert!(set("src/**/*.test.ts").matches("src/a/b/c.test.ts"));
        assert!(set("src/**/*.test.ts").matches("src/c.test.ts"));
        assert!(set("dist/, *.min.js").matches("lib/x.min.js"));
        assert!(set("file[0-9].txt").matches("file3.txt"));
        assert!(!set("file[!0-9].txt").matches("file3.txt"));
    }

    #[test]
    fn matches_with_utf16_columns_and_previews() {
        let re = build_matcher(&SearchQuery { query: "needle".into(), ..Default::default() }).unwrap().unwrap();
        let text = "a\n    😀 Needle and needle\r\nnone";
        let hits = search_text(text, &re, 100);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].line, 2);
        // "    😀 " = 4 spaces + surrogate pair (2) + space = 7 UTF-16 units.
        assert_eq!(hits[0].column, 7);
        assert_eq!(hits[0].length, 6);
        assert_eq!(hits[0].preview, "😀 Needle and needle");
        assert_eq!(hits[0].preview_column, 3);
        assert_eq!(hits[1].column, 18);
    }

    #[test]
    fn long_lines_are_cut_around_the_match() {
        let re = build_matcher(&q("X")).unwrap().unwrap();
        let line = format!("{}X{}", "a".repeat(100), "b".repeat(500));
        let hit = &search_text(&line, &re, 10)[0];
        assert!(hit.preview.starts_with('…'));
        assert_eq!(hit.preview.chars().nth(hit.preview_column), Some('X'));
        assert!(hit.preview.chars().count() < 300);
    }

    #[test]
    fn whole_word_case_and_regex() {
        let hits = |query: SearchQuery, t: &str| search_text(t, &build_matcher(&query).unwrap().unwrap(), 100).len();
        assert_eq!(hits(SearchQuery { query: "id".into(), whole_word: true, ..Default::default() }, "id idx uid id"), 2);
        assert_eq!(hits(SearchQuery { query: "ID".into(), case_sensitive: true, ..Default::default() }, "id ID"), 1);
        assert_eq!(hits(SearchQuery { query: r"\d+".into(), regex: true, ..Default::default() }, "a1 b22"), 2);
        assert!(build_matcher(&SearchQuery { query: "(".into(), regex: true, ..Default::default() }).is_err());
    }

    #[test]
    fn walks_opened_folders_with_include_exclude_and_gitignore() {
        let dir = std::env::temp_dir().join(format!("devtool-search-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let ws = dir.join("ws");
        fs::create_dir_all(ws.join("src/deep")).unwrap();
        fs::create_dir_all(ws.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(ws.join("build")).unwrap();
        fs::write(ws.join("src/a.ts"), "const token = 1;\n").unwrap();
        fs::write(ws.join("src/deep/b.md"), "token here\nand token there").unwrap();
        fs::write(ws.join("node_modules/pkg/i.js"), "token").unwrap();
        fs::write(ws.join("build/out.js"), "token").unwrap();
        fs::write(ws.join("bin.dat"), b"token\0\0").unwrap();
        fs::write(ws.join(".gitignore"), "# out\nbuild/\n").unwrap();
        let mut roots = Roots::default();
        roots.add(&ws).unwrap();

        let res = search(&roots, &q("token"), next_epoch()).unwrap();
        let rels: Vec<_> = res.files.iter().map(|f| f.rel.as_str()).collect();
        assert_eq!(rels, vec!["src/a.ts", "src/deep/b.md"]);
        assert_eq!(res.match_count, 3);

        let only_md = search(&roots, &SearchQuery { include: "*.md".into(), ..q("token") }, next_epoch()).unwrap();
        assert_eq!(only_md.files.len(), 1);
        let no_src = search(&roots, &SearchQuery { exclude: "src".into(), use_ignore_files: false, ..q("token") }, next_epoch()).unwrap();
        assert_eq!(no_src.files.iter().map(|f| f.rel.as_str()).collect::<Vec<_>>(), vec!["build/out.js"]);
        let capped = search(&roots, &SearchQuery { max_results: Some(2), ..q("token") }, next_epoch()).unwrap();
        assert!(capped.truncated);
        assert_eq!(capped.match_count, 2);

        // A folder that is not opened cannot be named.
        let outside = search(&roots, &SearchQuery { roots: vec![dir.to_string_lossy().into_owned()], ..q("token") }, next_epoch());
        assert!(outside.is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
