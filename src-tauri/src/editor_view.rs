// Read-only viewer for files too large to edit (multi-GB logs, CSV exports).
//
// Nothing loads the whole file: a background pass records the byte offset of
// every `CHECKPOINT`-th line (a sparse index — 100 M lines cost ~800 KB), and
// reads seek to the nearest checkpoint and walk forward from there. Lines
// are read with a bounded buffer, so a pathological single 2 GB line cannot
// exhaust memory: only its first `MAX_LINE_BYTES` are kept.
//
// The same index serves `tail -f`: `extend` scans only the bytes appended
// since the last pass, and starts over if the file shrank (truncated or
// rotated).
//
// Pure std + regex/memchr; editor.rs owns the registry and the Tauri side.

use crate::editor_fs::{FsError, FsResult};
use serde::Serialize;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// A checkpoint every this many lines.
pub const CHECKPOINT: u64 = 1024;
/// Longer lines are cut to this many bytes when shown.
pub const MAX_LINE_BYTES: usize = 8 * 1024;
/// Longer lines are only searched up to this many bytes.
pub const MAX_SEARCH_LINE_BYTES: usize = 256 * 1024;
/// Most lines one `read_lines` call returns.
pub const MAX_LINES_PER_READ: u64 = 2_000;
const SCAN_BUF: usize = 1024 * 1024;

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ViewStatus {
    /// File size when last scanned.
    pub size: u64,
    /// Lines known so far (the final count once `done`).
    pub lines: u64,
    pub scanned: u64,
    pub done: bool,
    /// NUL bytes in the first 8 KiB — shown as text anyway, but the UI warns.
    pub binary: bool,
    /// Bumped whenever the index restarts (file truncated/rotated).
    pub generation: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ViewLine {
    pub text: String,
    /// The line was longer than shown.
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// 0-based line number.
    pub line: u64,
    /// Character offset of the match within `preview`.
    pub column: usize,
    /// Character offset of the match within the whole line.
    pub line_column: usize,
    pub length: usize,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    /// Where to continue (line after the last one examined); `None` at EOF.
    pub next_line: Option<u64>,
    /// Stopped by the time budget or `max_hits` rather than by EOF.
    pub partial: bool,
}

#[derive(Debug, Default)]
struct Index {
    /// `checkpoints[i]` = byte offset where line `i * CHECKPOINT` starts.
    checkpoints: Vec<u64>,
    /// Newlines seen so far.
    newlines: u64,
    /// Bytes scanned so far.
    scanned: u64,
    /// The last scanned byte was a newline (or nothing scanned yet).
    at_line_start: bool,
    done: bool,
    generation: u64,
}

impl Index {
    fn fresh(generation: u64) -> Self {
        Self { checkpoints: vec![0], at_line_start: true, generation, ..Default::default() }
    }

    fn lines(&self) -> u64 {
        // A trailing partial line counts; an empty file has zero lines.
        self.newlines + u64::from(!self.at_line_start)
    }
}

pub struct Viewer {
    pub path: PathBuf,
    binary: bool,
    index: Mutex<Index>,
    /// One `extend` pass at a time (the first full pass and tail refreshes).
    scanning: Mutex<()>,
    /// Set by a newer search on the same viewer, so the older one stops.
    search_epoch: AtomicU64,
    closed: AtomicBool,
}

fn lock(m: &Mutex<Index>) -> std::sync::MutexGuard<'_, Index> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Reads one line (without its `\n` / `\r\n`), keeping at most `keep` bytes.
/// `None` at EOF. The rest of an over-long line is consumed but not stored.
fn next_line<R: BufRead>(r: &mut R, keep: usize) -> std::io::Result<Option<(Vec<u8>, bool)>> {
    let mut out = Vec::new();
    let mut truncated = false;
    let mut any = false;
    loop {
        let buf = r.fill_buf()?;
        if buf.is_empty() {
            break;
        }
        any = true;
        let (chunk, found) = match memchr::memchr(b'\n', buf) {
            Some(i) => (&buf[..i], Some(i)),
            None => (buf, None),
        };
        let room = keep.saturating_sub(out.len());
        if chunk.len() > room {
            truncated = true;
        }
        out.extend_from_slice(&chunk[..chunk.len().min(room)]);
        let used = found.map_or(buf.len(), |i| i + 1);
        r.consume(used);
        if found.is_some() {
            break;
        }
    }
    if !any {
        return Ok(None);
    }
    if !truncated && out.last() == Some(&b'\r') {
        out.pop();
    }
    Ok(Some((out, truncated)))
}

impl Viewer {
    pub fn open(path: &Path) -> FsResult<Self> {
        let mut f = File::open(path)?;
        if f.metadata()?.is_dir() {
            return Err(FsError { code: "is_dir", message: "That is a folder.".into() });
        }
        let mut head = vec![0u8; 8192];
        let n = f.read(&mut head)?;
        Ok(Self {
            path: path.to_path_buf(),
            binary: head[..n].contains(&0),
            index: Mutex::new(Index::fresh(0)),
            scanning: Mutex::new(()),
            search_epoch: AtomicU64::new(0),
            closed: AtomicBool::new(false),
        })
    }

    pub fn close(&self) {
        self.closed.store(true, Ordering::Relaxed);
    }

    pub fn status(&self) -> ViewStatus {
        let size = std::fs::metadata(&self.path).map(|m| m.len()).unwrap_or(0);
        let ix = lock(&self.index);
        ViewStatus {
            size,
            lines: ix.lines(),
            scanned: ix.scanned,
            done: ix.done,
            binary: self.binary,
            generation: ix.generation,
        }
    }

    /// Indexes from where the last pass stopped to the current end of file
    /// (the whole file the first time; only appended bytes for `tail -f`).
    /// Starts over if the file is now shorter than what was indexed.
    pub fn extend(&self) -> FsResult<ViewStatus> {
        let _one_pass = self.scanning.lock().unwrap_or_else(|e| e.into_inner());
        let mut f = File::open(&self.path)?;
        let size = f.metadata()?.len();
        let (mut pos, mut newlines) = {
            let mut ix = lock(&self.index);
            if size < ix.scanned {
                let generation = ix.generation + 1;
                *ix = Index::fresh(generation);
            }
            ix.done = false;
            (ix.scanned, ix.newlines)
        };
        f.seek(SeekFrom::Start(pos))?;
        let mut buf = vec![0u8; SCAN_BUF];
        let mut fresh_checkpoints = Vec::new();
        while pos < size {
            if self.closed.load(Ordering::Relaxed) {
                break;
            }
            let want = ((size - pos) as usize).min(SCAN_BUF);
            let n = f.read(&mut buf[..want])?;
            if n == 0 {
                break;
            }
            for i in memchr::memchr_iter(b'\n', &buf[..n]) {
                newlines += 1;
                if newlines.is_multiple_of(CHECKPOINT) {
                    fresh_checkpoints.push(pos + i as u64 + 1);
                }
            }
            let at_start = buf[n - 1] == b'\n';
            pos += n as u64;
            // Publish progress per chunk so reads can start before the end.
            let mut ix = lock(&self.index);
            ix.checkpoints.append(&mut fresh_checkpoints);
            ix.newlines = newlines;
            ix.scanned = pos;
            ix.at_line_start = at_start;
        }
        let mut ix = lock(&self.index);
        ix.done = pos >= size;
        drop(ix);
        Ok(self.status())
    }

    /// A reader positioned at the start of line `line` (or at EOF).
    fn reader_at(&self, line: u64) -> FsResult<BufReader<File>> {
        let (offset, skip) = {
            let ix = lock(&self.index);
            let cp = ((line / CHECKPOINT) as usize).min(ix.checkpoints.len().saturating_sub(1));
            (ix.checkpoints.get(cp).copied().unwrap_or(0), line - cp as u64 * CHECKPOINT)
        };
        let mut f = File::open(&self.path)?;
        f.seek(SeekFrom::Start(offset))?;
        let mut r = BufReader::with_capacity(256 * 1024, f);
        for _ in 0..skip {
            if next_line(&mut r, 0)?.is_none() {
                break;
            }
        }
        Ok(r)
    }

    /// Up to `count` lines from `start` (0-based), lossily decoded.
    pub fn read_lines(&self, start: u64, count: u64) -> FsResult<Vec<ViewLine>> {
        let count = count.min(MAX_LINES_PER_READ);
        let mut r = self.reader_at(start)?;
        let mut out = Vec::with_capacity(count as usize);
        for _ in 0..count {
            match next_line(&mut r, MAX_LINE_BYTES)? {
                Some((bytes, truncated)) => out.push(ViewLine { text: String::from_utf8_lossy(&bytes).into_owned(), truncated }),
                None => break,
            }
        }
        Ok(out)
    }

    /// Searches from line `from`, stopping at EOF, after `max_hits`, after
    /// `budget`, or when a newer search on this viewer starts.
    pub fn search(
        &self,
        query: &str,
        is_regex: bool,
        case_sensitive: bool,
        from: u64,
        max_hits: usize,
        budget: Duration,
    ) -> FsResult<SearchResult> {
        let epoch = self.search_epoch.fetch_add(1, Ordering::SeqCst) + 1;
        if query.is_empty() {
            return Ok(SearchResult { hits: Vec::new(), next_line: None, partial: false });
        }
        let pattern = if is_regex { query.to_string() } else { regex::escape(query) };
        let re = regex::bytes::RegexBuilder::new(&pattern)
            .case_insensitive(!case_sensitive)
            .size_limit(1 << 20)
            .build()
            .map_err(|e| FsError { code: "invalid_regex", message: e.to_string() })?;
        let started = Instant::now();
        let mut r = self.reader_at(from)?;
        let mut line = from;
        let mut hits = Vec::new();
        loop {
            let Some((bytes, _)) = next_line(&mut r, MAX_SEARCH_LINE_BYTES)? else {
                return Ok(SearchResult { hits, next_line: None, partial: false });
            };
            if let Some(m) = re.find(&bytes) {
                // ~80 bytes of context before, ~200 after, moved to UTF-8
                // character boundaries so no character is cut in half.
                let mut preview_start = m.start().saturating_sub(80);
                while preview_start > 0 && bytes[preview_start] & 0xC0 == 0x80 {
                    preview_start -= 1;
                }
                let mut preview_end = (m.end() + 200).min(bytes.len());
                while preview_end < bytes.len() && bytes[preview_end] & 0xC0 == 0x80 {
                    preview_end += 1;
                }
                let lead = String::from_utf8_lossy(&bytes[preview_start..m.start()]);
                let matched = String::from_utf8_lossy(&bytes[m.start()..m.end()]);
                let tail = String::from_utf8_lossy(&bytes[m.end()..preview_end]);
                hits.push(SearchHit {
                    line,
                    line_column: String::from_utf8_lossy(&bytes[..m.start()]).chars().count(),
                    column: lead.chars().count(),
                    length: matched.chars().count(),
                    preview: format!("{lead}{matched}{tail}"),
                });
            }
            line += 1;
            let superseded = self.search_epoch.load(Ordering::SeqCst) != epoch;
            if hits.len() >= max_hits || superseded || self.closed.load(Ordering::Relaxed)
                || (line.is_multiple_of(4096) && started.elapsed() > budget)
            {
                return Ok(SearchResult { hits, next_line: Some(line), partial: true });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn file(name: &str, content: &[u8]) -> PathBuf {
        let p = std::env::temp_dir().join(format!("devtool-view-{name}-{}", std::process::id()));
        std::fs::write(&p, content).unwrap();
        p
    }

    fn texts(v: &[ViewLine]) -> Vec<&str> {
        v.iter().map(|l| l.text.as_str()).collect()
    }

    #[test]
    fn counts_lines_with_and_without_a_final_newline() {
        for (content, lines) in [(&b""[..], 0), (b"a", 1), (b"a\n", 1), (b"a\nb", 2), (b"a\r\nb\r\n", 2), (b"\n\n", 2)] {
            let p = file("count", content);
            let v = Viewer::open(&p).unwrap();
            let st = v.extend().unwrap();
            assert!(st.done);
            assert_eq!(st.lines, lines, "{content:?}");
            let _ = std::fs::remove_file(p);
        }
    }

    #[test]
    fn reads_any_range_across_checkpoints() {
        let mut content = String::new();
        let total = CHECKPOINT * 5 + 17;
        for i in 0..total {
            content.push_str(&format!("line {i}\r\n"));
        }
        let p = file("range", content.as_bytes());
        let v = Viewer::open(&p).unwrap();
        assert_eq!(v.extend().unwrap().lines, total);
        assert_eq!(texts(&v.read_lines(0, 2).unwrap()), vec!["line 0", "line 1"]);
        let mid = CHECKPOINT * 3 - 1;
        assert_eq!(texts(&v.read_lines(mid, 3).unwrap()), vec![
            format!("line {mid}"), format!("line {}", mid + 1), format!("line {}", mid + 2),
        ]);
        let last = v.read_lines(total - 1, 10).unwrap();
        assert_eq!(texts(&last), vec![format!("line {}", total - 1)]);
        assert!(v.read_lines(total + 5, 10).unwrap().is_empty());
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn a_huge_line_is_cut_not_loaded() {
        let mut content = vec![b'x'; MAX_LINE_BYTES * 3];
        content.extend_from_slice(b"\nnext\n");
        let p = file("long", &content);
        let v = Viewer::open(&p).unwrap();
        v.extend().unwrap();
        let lines = v.read_lines(0, 2).unwrap();
        assert_eq!(lines[0].text.len(), MAX_LINE_BYTES);
        assert!(lines[0].truncated);
        assert_eq!(lines[1], ViewLine { text: "next".into(), truncated: false });
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn invalid_utf8_is_shown_lossily_and_nul_flags_binary() {
        let p = file("lossy", b"caf\xe9\nok\n");
        let v = Viewer::open(&p).unwrap();
        v.extend().unwrap();
        assert_eq!(v.read_lines(0, 1).unwrap()[0].text, "caf\u{fffd}");
        assert!(!v.status().binary);
        let b = file("nul", b"a\0b\n");
        assert!(Viewer::open(&b).unwrap().status().binary);
        let _ = std::fs::remove_file(p);
        let _ = std::fs::remove_file(b);
    }

    #[test]
    fn tail_follows_appends_and_restarts_after_truncation() {
        let p = file("tail", b"one\ntwo\n");
        let v = Viewer::open(&p).unwrap();
        assert_eq!(v.extend().unwrap().lines, 2);
        std::fs::OpenOptions::new().append(true).open(&p).unwrap().write_all(b"three\nfou").unwrap();
        let st = v.extend().unwrap();
        assert_eq!(st.lines, 4);
        assert_eq!(texts(&v.read_lines(2, 5).unwrap()), vec!["three", "fou"]);
        std::fs::OpenOptions::new().append(true).open(&p).unwrap().write_all(b"r\n").unwrap();
        assert_eq!(v.extend().unwrap().lines, 4, "a completed partial line is still one line");
        assert_eq!(texts(&v.read_lines(3, 1).unwrap()), vec!["four"]);
        std::fs::write(&p, b"new\n").unwrap();
        let st = v.extend().unwrap();
        assert_eq!((st.lines, st.generation), (1, 1));
        assert_eq!(texts(&v.read_lines(0, 5).unwrap()), vec!["new"]);
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn searches_plain_or_regex_and_continues() {
        let mut content = String::new();
        for i in 0..5000 {
            content.push_str(if i % 1000 == 7 { "INFO all good\n" } else { "noise\n" });
        }
        content.push_str("ERROR disk full at 99%\n");
        let p = file("search", content.as_bytes());
        let v = Viewer::open(&p).unwrap();
        v.extend().unwrap();
        let r = v.search("error", false, false, 0, 10, Duration::from_secs(5)).unwrap();
        assert_eq!(r.hits.len(), 1);
        assert_eq!(r.hits[0].line, 5000);
        assert_eq!((r.hits[0].column, r.hits[0].length), (0, 5));
        let deep = format!("{}needle\n", "é".repeat(200));
        let pd = file("deep", deep.as_bytes());
        let vd = Viewer::open(&pd).unwrap();
        vd.extend().unwrap();
        let hd = &vd.search("needle", false, true, 0, 1, Duration::from_secs(5)).unwrap().hits[0];
        assert_eq!((hd.line_column, hd.column), (200, 40), "line offset vs. preview offset (80 bytes = 40 × é)");
        assert!(!hd.preview.contains('\u{fffd}'), "preview edges stay on character boundaries");
        let odd = format!("x{}needle\n", "é".repeat(200));
        let po = file("odd", odd.as_bytes());
        let vo = Viewer::open(&po).unwrap();
        vo.extend().unwrap();
        let ho = &vo.search("needle", false, true, 0, 1, Duration::from_secs(5)).unwrap().hits[0];
        assert!(!ho.preview.contains('\u{fffd}'));
        let _ = std::fs::remove_file(po);
        let _ = std::fs::remove_file(pd);
        assert_eq!(r.next_line, None);
        assert!(v.search("error", false, true, 0, 10, Duration::from_secs(5)).unwrap().hits.is_empty(), "case-sensitive");
        let first = v.search(r"INFO \w+", true, true, 0, 2, Duration::from_secs(5)).unwrap();
        assert_eq!(first.hits.iter().map(|h| h.line).collect::<Vec<_>>(), vec![7, 1007]);
        assert!(first.partial);
        let rest = v.search(r"INFO \w+", true, true, first.next_line.unwrap(), 10, Duration::from_secs(5)).unwrap();
        assert_eq!(rest.hits.len(), 3);
        // A literal query with regex characters is literal.
        assert_eq!(v.search("99%", false, true, 0, 10, Duration::from_secs(5)).unwrap().hits.len(), 1);
        assert_eq!(v.search("(", true, true, 0, 1, Duration::from_secs(5)).unwrap_err().code, "invalid_regex");
        let _ = std::fs::remove_file(p);
    }
}
