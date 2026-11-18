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
/// "Show full line" reads at most this many bytes of one line.
pub const MAX_FULL_LINE_BYTES: usize = 4 * 1024 * 1024;
/// Longer lines are only searched up to this many bytes (the same as "show
/// full line" can display, so every hit can be shown).
pub const MAX_SEARCH_LINE_BYTES: usize = MAX_FULL_LINE_BYTES;
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
    /// Matching lines from `from` to EOF, when asked for and counted within
    /// the budget.
    pub total: Option<u64>,
    /// Matching lines seen by this call (≥ `hits.len()` when counting): a
    /// count cut short by the budget continues from `next_line` and adds up.
    pub matched: u64,
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

    /// One line (0-based) with up to `MAX_FULL_LINE_BYTES` of it, for lines
    /// `read_lines` cut short. `None` past the end. `truncated` is still set
    /// for a line longer than that.
    pub fn read_full_line(&self, line: u64) -> FsResult<Option<ViewLine>> {
        let mut r = self.reader_at(line)?;
        Ok(next_line(&mut r, MAX_FULL_LINE_BYTES)?
            .map(|(bytes, truncated)| ViewLine { text: String::from_utf8_lossy(&bytes).into_owned(), truncated }))
    }

    /// Searches from line `from`. Hits stop at `max_hits`; past that, with
    /// `count_total`, the scan goes on only to count matching lines (`total`).
    /// `max_hits` 0 with `count_total` is a pure count, resumable from
    /// `next_line` when the budget runs out. The
    /// whole call also stops at `budget` or when a newer search on this
    /// viewer starts.
    ///
    /// The regex runs over 4 MB blocks of whole lines rather than line by
    /// line, so the scan is regex/memchr's own speed (GB/s, literal
    /// prefilters included); a block-level match is then re-checked against
    /// its line alone, which keeps per-line semantics (`^`/`$` at line ends,
    /// nothing spans a newline). The leftmost match in the block can't skip a
    /// line that matches on its own, as any such match is also a block match.
    #[allow(clippy::too_many_arguments)] // mirrors the Tauri command's arguments
    pub fn search(
        &self,
        query: &str,
        is_regex: bool,
        case_sensitive: bool,
        from: u64,
        max_hits: usize,
        count_total: bool,
        budget: Duration,
    ) -> FsResult<SearchResult> {
        let epoch = self.search_epoch.fetch_add(1, Ordering::SeqCst) + 1;
        if query.is_empty() {
            return Ok(SearchResult { hits: Vec::new(), next_line: None, partial: false, total: Some(0), matched: 0 });
        }
        let pattern = if is_regex { query.to_string() } else { regex::escape(query) };
        let re = regex::bytes::RegexBuilder::new(&pattern)
            .case_insensitive(!case_sensitive)
            .multi_line(true)
            .crlf(true)
            .size_limit(1 << 20)
            .build()
            .map_err(|e| FsError { code: "invalid_regex", message: e.to_string() })?;
        let started = Instant::now();
        let mut r = self.reader_at(from)?;
        let mut scan = Scan { re: &re, max_hits, hits: Vec::new(), matched: 0, next_line: None };
        let mut line = from;
        // Allocated once (zeroed by the allocator); the unsearched tail of a
        // block moves to the front with a memmove — no per-byte work here, so
        // even a debug build scans at regex/memchr speed.
        let mut buf = vec![0u8; SEARCH_CHUNK];
        let mut filled = 0;
        let mut eof = false;
        let mut first_block = true;
        loop {
            let superseded = self.search_epoch.load(Ordering::SeqCst) != epoch;
            // At least one block per call, so a search always gets further.
            let out_of_time = !first_block && started.elapsed() > budget;
            first_block = false;
            if superseded || self.closed.load(Ordering::Relaxed) || out_of_time {
                // Out of time while still collecting: resume at the next
                // unexamined line. Out of time while only counting: the hits
                // are complete, the total is unknown.
                let next_line = if scan.hits.len() < max_hits || max_hits == 0 { Some(line) } else { scan.next_line };
                return Ok(SearchResult { hits: scan.hits, next_line, partial: true, total: None, matched: scan.matched });
            }
            if scan.hits.len() >= max_hits && !count_total {
                return Ok(SearchResult {
                    hits: scan.hits,
                    next_line: scan.next_line,
                    partial: true,
                    total: None,
                    matched: scan.matched,
                });
            }
            // Top up the block to SEARCH_CHUNK bytes.
            while !eof && filled < SEARCH_CHUNK {
                let n = r.read(&mut buf[filled..])?;
                filled += n;
                eof = n == 0;
            }
            if filled == 0 {
                break;
            }
            let data = &buf[..filled];
            match (eof, memchr::memrchr(b'\n', data)) {
                // Whole lines up to the last newline; the rest waits for more.
                (false, Some(i)) => {
                    line = scan.block(&data[..=i], line);
                    buf.copy_within(i + 1..filled, 0);
                    filled -= i + 1;
                }
                // The end of the file: whatever is left is the last lines.
                (true, _) => {
                    line = scan.block(data, line);
                    filled = 0;
                }
                // One line longer than a block: search its first
                // SEARCH_CHUNK bytes, skip the rest.
                (false, None) => {
                    line = scan.block(data, line);
                    filled = 0;
                    next_line(&mut r, 0)?;
                }
            }
        }
        // At EOF: every matching line was seen (and counted).
        let next_line = if scan.matched > scan.hits.len() as u64 { scan.next_line } else { None };
        Ok(SearchResult {
            next_line,
            partial: next_line.is_some(),
            hits: scan.hits,
            total: Some(scan.matched),
            matched: scan.matched,
        })
    }
}

/// Bytes the search reads at a time; also the longest line it searches whole.
const SEARCH_CHUNK: usize = MAX_SEARCH_LINE_BYTES;

struct Scan<'a> {
    re: &'a regex::bytes::Regex,
    max_hits: usize,
    hits: Vec<SearchHit>,
    /// Matching lines seen (all of them, not only the ones kept as hits).
    matched: u64,
    /// The line after the last kept hit, once `max_hits` is reached.
    next_line: Option<u64>,
}

impl Scan<'_> {
    /// Searches `block` (whole lines; the last may lack its newline), whose
    /// first line is `line`. Returns the line number after the block.
    fn block(&mut self, block: &[u8], line: u64) -> u64 {
        let mut pos = 0;
        let mut counted = 0;
        let mut cur = line;
        while pos < block.len() {
            let Some(m) = self.re.find_at(block, pos) else { break };
            // An empty match right after the block's final newline (`^$`)
            // is on the next block's first line, not on one of these.
            if m.start() == block.len() && block.last() == Some(&b'\n') {
                break;
            }
            let ls = memchr::memrchr(b'\n', &block[..m.start()]).map_or(0, |i| i + 1);
            let le = memchr::memchr(b'\n', &block[m.start()..]).map_or(block.len(), |i| m.start() + i);
            cur += memchr::memchr_iter(b'\n', &block[counted..ls]).count() as u64;
            counted = ls;
            let mut text = &block[ls..le];
            if text.last() == Some(&b'\r') {
                text = &text[..text.len() - 1];
            }
            if let Some(lm) = self.re.find(text) {
                self.matched += 1;
                if self.hits.len() < self.max_hits {
                    self.hits.push(hit(text, cur, lm.start(), lm.end()));
                    if self.hits.len() == self.max_hits {
                        self.next_line = Some(cur + 1);
                    }
                }
            }
            pos = le + 1;
        }
        let mut end = cur + memchr::memchr_iter(b'\n', &block[counted..]).count() as u64;
        if block.last().is_some_and(|&b| b != b'\n') {
            end += 1; // a last line without its newline (EOF, or cut short)
        }
        end
    }
}

/// A hit with ~80 bytes of context before the match and ~200 after, moved to
/// UTF-8 character boundaries so no character is cut in half.
fn hit(bytes: &[u8], line: u64, start: usize, end: usize) -> SearchHit {
    let mut preview_start = start.saturating_sub(80);
    while preview_start > 0 && bytes[preview_start] & 0xC0 == 0x80 {
        preview_start -= 1;
    }
    let mut preview_end = (end + 200).min(bytes.len());
    while preview_end < bytes.len() && bytes[preview_end] & 0xC0 == 0x80 {
        preview_end += 1;
    }
    let lead = String::from_utf8_lossy(&bytes[preview_start..start]);
    let matched = String::from_utf8_lossy(&bytes[start..end]);
    let tail = String::from_utf8_lossy(&bytes[end..preview_end]);
    SearchHit {
        line,
        line_column: String::from_utf8_lossy(&bytes[..start]).chars().count(),
        column: lead.chars().count(),
        length: matched.chars().count(),
        preview: format!("{lead}{matched}{tail}"),
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
    fn a_cut_line_can_be_read_whole() {
        let mut content = b"first
".to_vec();
        content.extend(std::iter::repeat_n(b'y', MAX_LINE_BYTES * 3));
        content.extend_from_slice(b"END
last
");
        let p = file("full", &content);
        let v = Viewer::open(&p).unwrap();
        v.extend().unwrap();
        assert!(v.read_lines(1, 1).unwrap()[0].truncated);
        let full = v.read_full_line(1).unwrap().unwrap();
        assert!(!full.truncated);
        assert_eq!(full.text.len(), MAX_LINE_BYTES * 3 + 3);
        assert!(full.text.ends_with("yEND"));
        assert_eq!(v.read_full_line(2).unwrap().unwrap().text, "last");
        assert!(v.read_full_line(3).unwrap().is_none());
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
        let r = v.search("error", false, false, 0, 10, false, Duration::from_secs(5)).unwrap();
        assert_eq!(r.hits.len(), 1);
        assert_eq!(r.hits[0].line, 5000);
        assert_eq!((r.hits[0].column, r.hits[0].length), (0, 5));
        let deep = format!("{}needle\n", "é".repeat(200));
        let pd = file("deep", deep.as_bytes());
        let vd = Viewer::open(&pd).unwrap();
        vd.extend().unwrap();
        let hd = &vd.search("needle", false, true, 0, 1, false, Duration::from_secs(5)).unwrap().hits[0];
        assert_eq!((hd.line_column, hd.column), (200, 40), "line offset vs. preview offset (80 bytes = 40 × é)");
        assert!(!hd.preview.contains('\u{fffd}'), "preview edges stay on character boundaries");
        let odd = format!("x{}needle\n", "é".repeat(200));
        let po = file("odd", odd.as_bytes());
        let vo = Viewer::open(&po).unwrap();
        vo.extend().unwrap();
        let ho = &vo.search("needle", false, true, 0, 1, false, Duration::from_secs(5)).unwrap().hits[0];
        assert!(!ho.preview.contains('\u{fffd}'));
        let _ = std::fs::remove_file(po);
        let _ = std::fs::remove_file(pd);
        assert_eq!(r.next_line, None);
        assert!(v.search("error", false, true, 0, 10, false, Duration::from_secs(5)).unwrap().hits.is_empty(), "case-sensitive");
        let first = v.search(r"INFO \w+", true, true, 0, 2, false, Duration::from_secs(5)).unwrap();
        assert_eq!(first.hits.iter().map(|h| h.line).collect::<Vec<_>>(), vec![7, 1007]);
        assert!(first.partial);
        let rest = v.search(r"INFO \w+", true, true, first.next_line.unwrap(), 10, false, Duration::from_secs(5)).unwrap();
        assert_eq!(rest.hits.len(), 3);
        // A literal query with regex characters is literal.
        assert_eq!(v.search("99%", false, true, 0, 10, false, Duration::from_secs(5)).unwrap().hits.len(), 1);
        assert_eq!(v.search("(", true, true, 0, 1, false, Duration::from_secs(5)).unwrap_err().code, "invalid_regex");
        let _ = std::fs::remove_file(p);
    }

    /// The block scan must agree with searching line by line, across block
    /// boundaries, CRLF, empty lines, a line longer than a block and a last
    /// line without its newline.
    #[test]
    fn block_search_matches_a_line_by_line_reference() {
        let mut lines: Vec<String> = Vec::new();
        let mut x: u64 = 0x2545F4914F6CDD1D;
        for i in 0..120_000u64 {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            lines.push(match x % 9 {
                0 => String::new(),
                1 => format!("ERROR code={} at {}", x % 1000, i),
                2 => "  error: Disk Full\r".to_string(),
                3 => "x".repeat((x % 300) as usize),
                _ => format!("info line {i} value={}", x % 97),
            });
        }
        lines[60_000] = format!("{}MARK{}ERROR past the limit", "z".repeat(MAX_SEARCH_LINE_BYTES - 100), "z".repeat(2000));
        let mut content = lines.join("\n");
        content.push_str("\nlast ERROR without newline");
        lines.push("last ERROR without newline".into());
        let p = file("blocks", content.as_bytes());
        let v = Viewer::open(&p).unwrap();
        assert_eq!(v.extend().unwrap().lines, lines.len() as u64);

        for (q, is_re, cs) in [
            ("ERROR", false, true),
            ("error", false, false),
            (r"^\s*error:", true, false),
            (r"Full$", true, true),
            (r"=\d+$", true, true),
            (r"^$", true, true),
            (r"value=9\d\s", true, true),
        ] {
            let pat = if is_re { q.to_string() } else { regex::escape(q) };
            let re = regex::RegexBuilder::new(&pat).case_insensitive(!cs).build().unwrap();
            let want: Vec<u64> = lines
                .iter()
                .enumerate()
                .filter(|(_, l)| {
                    let l = l.strip_suffix('\r').unwrap_or(l);
                    // The huge line is only searched up to the limit.
                    re.is_match(&l[..l.len().min(MAX_SEARCH_LINE_BYTES)])
                })
                .map(|(i, _)| i as u64)
                .collect();
            let all = v.search(q, is_re, cs, 0, usize::MAX, false, Duration::from_secs(60)).unwrap();
            let got: Vec<u64> = all.hits.iter().map(|h| h.line).collect();
            assert_eq!(got, want, "{q}");
            assert_eq!(all.total, Some(want.len() as u64), "{q}");
            assert!(!all.partial && all.next_line.is_none());

            // Paged with a total, then continued from next_line.
            // A pure count, cut into pieces by a zero budget, adds up.
            let (mut from, mut sum) = (0, 0);
            loop {
                let c = v.search(q, is_re, cs, from, 0, true, Duration::ZERO).unwrap();
                assert!(c.hits.is_empty());
                sum += c.matched;
                match c.next_line {
                    Some(n) => from = n,
                    None => {
                        assert_eq!(c.total.map(|_| sum), Some(want.len() as u64), "{q} count");
                        break;
                    }
                }
            }
            let page = v.search(q, is_re, cs, 0, 50, true, Duration::from_secs(60)).unwrap();
            assert_eq!(page.total, Some(want.len() as u64), "{q} total");
            if want.len() > 50 {
                assert!(page.partial);
                assert_eq!(page.next_line, Some(want[49] + 1));
                let rest = v.search(q, is_re, cs, page.next_line.unwrap(), 50, false, Duration::from_secs(60)).unwrap();
                assert_eq!(rest.hits.iter().map(|h| h.line).collect::<Vec<_>>(), want[50..want.len().min(100)]);
            }
        }
        // A hit's columns are within its own line, past the huge line too.
        let h = v.search("MARK", false, true, 0, 1, false, Duration::from_secs(60)).unwrap();
        assert_eq!(h.hits[0].line, 60_000);
        assert_eq!(h.hits[0].line_column, MAX_SEARCH_LINE_BYTES - 100);
        assert!(v.search("past the limit", false, true, 0, 1, false, Duration::from_secs(60)).unwrap().hits.is_empty());
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn an_exhausted_budget_resumes_where_it_stopped() {
        let content = "noise\n".repeat(3_000_000) + "needle\n";
        let p = file("budget", content.as_bytes());
        let v = Viewer::open(&p).unwrap();
        v.extend().unwrap();
        let mut from = 0;
        let mut calls = 0;
        loop {
            calls += 1;
            let r = v.search("needle", false, true, from, 10, true, Duration::ZERO).unwrap();
            if let Some(h) = r.hits.first() {
                assert_eq!(h.line, 3_000_000);
                break;
            }
            assert!(r.partial && r.total.is_none());
            let next = r.next_line.unwrap();
            assert!(next > from, "progress");
            from = next;
            assert!(calls < 100);
        }
        let _ = std::fs::remove_file(p);
    }
}
