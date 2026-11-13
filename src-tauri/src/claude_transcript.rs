// Claude Manager — reading and searching session transcripts.
//
// Unlike `claude_monitor_scan`, these commands return conversation text, so
// they run only when the user opens a session or searches. Text is returned
// one page at a time and each entry is capped, because a single transcript
// can hold megabytes of tool output.

use crate::claude_monitor::{expand_home, home_dir, mtime_ms, parse_ts};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

const PAGE_SIZE: usize = 300;
/// Entries shown before the one a search hit points at.
const CONTEXT_BEFORE: usize = 40;
const ENTRY_MAX_CHARS: usize = 20_000;
const SNIPPET_RADIUS: usize = 80;
const MAX_HITS: usize = 200;
const MAX_HITS_PER_SESSION: usize = 20;
const MIN_QUERY_CHARS: usize = 2;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Line {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    is_meta: Option<bool>,
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Message {
    model: Option<String>,
    content: Option<Content>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Content {
    Text(String),
    Blocks(Vec<Block>),
    Other(serde::de::IgnoredAny),
}

#[derive(Deserialize)]
struct Block {
    #[serde(rename = "type")]
    kind: Option<String>,
    text: Option<String>,
    name: Option<String>,
    input: Option<serde_json::Value>,
    content: Option<serde_json::Value>,
}

/// One thing said or done in a session, with its full text.
struct RawEntry {
    /// "user" | "assistant" | "tool_use" | "tool_result" | "meta"
    kind: &'static str,
    ts: Option<i64>,
    text: String,
    tool: Option<String>,
    model: Option<String>,
}

/// Text of a `tool_result` block: a string, or a list of text blocks.
fn result_text(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(items) => items
            .iter()
            .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Harness-injected user messages (commands, reminders) open with a tag.
fn user_kind(text: &str, is_meta: bool) -> &'static str {
    if is_meta || text.trim_start().starts_with('<') {
        "meta"
    } else {
        "user"
    }
}

fn entries_of_line(raw: &[u8], out: &mut Vec<RawEntry>) {
    let Ok(line) = serde_json::from_slice::<Line>(raw) else { return };
    let role = match line.kind.as_deref() {
        Some("user") => "user",
        Some("assistant") => "assistant",
        _ => return,
    };
    let ts = line.timestamp.as_deref().and_then(parse_ts);
    let is_meta = line.is_meta == Some(true);
    let Some(message) = line.message else { return };
    let model = message.model;
    let mut push = |kind: &'static str, text: String, tool: Option<String>| {
        if !text.trim().is_empty() || tool.is_some() {
            out.push(RawEntry { kind, ts, text, tool, model: model.clone() });
        }
    };
    match message.content {
        Some(Content::Text(text)) => {
            let kind = if role == "user" { user_kind(&text, is_meta) } else { "assistant" };
            push(kind, text, None);
        }
        Some(Content::Blocks(blocks)) => {
            for block in blocks {
                match block.kind.as_deref() {
                    Some("text") => {
                        let text = block.text.unwrap_or_default();
                        let kind = if role == "user" { user_kind(&text, is_meta) } else { "assistant" };
                        push(kind, text, None);
                    }
                    Some("tool_use") => {
                        let input = block
                            .input
                            .map(|v| serde_json::to_string_pretty(&v).unwrap_or_default())
                            .unwrap_or_default();
                        push("tool_use", input, Some(block.name.unwrap_or_default()));
                    }
                    Some("tool_result") => {
                        push("tool_result", block.content.as_ref().map(result_text).unwrap_or_default(), None);
                    }
                    // Thinking blocks carry no readable text.
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

fn read_entries(path: &Path) -> std::io::Result<Vec<RawEntry>> {
    let mut reader = BufReader::with_capacity(256 * 1024, File::open(path)?);
    let mut out = Vec::new();
    let mut buf = Vec::new();
    loop {
        buf.clear();
        if reader.read_until(b'\n', &mut buf)? == 0 {
            break;
        }
        entries_of_line(&buf, &mut out);
    }
    Ok(out)
}

/// A folder or file name taken from the UI must stay inside its parent.
fn safe_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', '\0'])
}

fn transcript_path(dir: &str, project: &str, session: &str) -> Result<PathBuf, String> {
    if !safe_name(project) || !safe_name(session) {
        return Err("invalid session reference".into());
    }
    Ok(expand_home(dir, home_dir().as_deref())
        .join("projects")
        .join(project)
        .join(format!("{session}.jsonl")))
}

fn truncate_chars(text: &str, max: usize) -> (String, bool) {
    match text.char_indices().nth(max) {
        Some((cut, _)) => (text[..cut].to_string(), true),
        None => (text.to_string(), false),
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Position in the whole transcript; stable across pages and searches.
    index: usize,
    kind: &'static str,
    ts: Option<i64>,
    text: String,
    /// The text was cut at `ENTRY_MAX_CHARS`.
    truncated: bool,
    tool: Option<String>,
    model: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptPage {
    entries: Vec<Entry>,
    /// Index of the first entry returned; 0 means nothing earlier.
    start: usize,
    total: usize,
}

/// Which page of a transcript to return.
#[derive(Deserialize, Default, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct PageAt {
    /// The page ending just before this entry (scrolling up).
    before: Option<usize>,
    /// The page starting at this entry (scrolling down).
    from: Option<usize>,
    /// The page showing this entry with some context above it (a search hit).
    around: Option<usize>,
}

/// The last page, unless `at` asks for another one.
fn page_of(all: Vec<RawEntry>, at: PageAt) -> TranscriptPage {
    let total = all.len();
    let forward = at.around.map(|i| i.min(total).saturating_sub(CONTEXT_BEFORE)).or(at.from.map(|i| i.min(total)));
    let (start, end) = match forward {
        Some(start) => (start, (start + PAGE_SIZE).min(total)),
        None => {
            let before = at.before;
            let end = before.unwrap_or(total).min(total);
            (end.saturating_sub(PAGE_SIZE), end)
        }
    };
    let entries = all
        .into_iter()
        .enumerate()
        .skip(start)
        .take(end - start)
        .map(|(index, e)| {
            let (text, truncated) = truncate_chars(&e.text, ENTRY_MAX_CHARS);
            Entry { index, kind: e.kind, ts: e.ts, text, truncated, tool: e.tool, model: e.model }
        })
        .collect();
    TranscriptPage { entries, start, total }
}

/// One page of a session's conversation, newest page by default.
#[tauri::command]
pub async fn claude_monitor_transcript(
    dir: String,
    project: String,
    session: String,
    at: Option<PageAt>,
) -> Result<TranscriptPage, String> {
    tokio::task::spawn_blocking(move || {
        let path = transcript_path(&dir, &project, &session)?;
        let all = read_entries(&path).map_err(|e| e.to_string())?;
        Ok(page_of(all, at.unwrap_or_default()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// Position of the directory in the `dirs` argument.
    dir_index: usize,
    project: String,
    session: String,
    /// Entry to open the transcript at.
    index: usize,
    kind: &'static str,
    ts: Option<i64>,
    before: String,
    matched: String,
    after: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    hits: Vec<SearchHit>,
    /// More matches exist than were returned.
    capped: bool,
}

fn flatten(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `radius` characters on each side of the match, cut on char boundaries.
fn snippet(text: &str, start: usize, end: usize) -> (String, String, String) {
    let head = &text[..start];
    let from = head.char_indices().rev().nth(SNIPPET_RADIUS - 1).map_or(0, |(i, _)| i);
    let tail = &text[end..];
    let to = tail.char_indices().nth(SNIPPET_RADIUS).map_or(tail.len(), |(i, _)| i);
    let mut before = flatten(&text[from..start]);
    let mut after = flatten(&tail[..to]);
    // Whitespace next to the match is meaningful: keep one space.
    if text[from..start].ends_with(char::is_whitespace) {
        before.push(' ');
    }
    if tail.starts_with(char::is_whitespace) {
        after.insert(0, ' ');
    }
    if from > 0 {
        before.insert(0, '…');
    }
    if to < tail.len() {
        after.push('…');
    }
    (before, text[start..end].to_string(), after)
}

/// Main transcripts of one config directory, most recently written first.
fn transcripts_newest_first(config_dir: &Path) -> Vec<(String, String, PathBuf)> {
    let mut files: Vec<(i64, String, String, PathBuf)> = Vec::new();
    for project in fs::read_dir(config_dir.join("projects")).into_iter().flatten().flatten() {
        let project_name = project.file_name().to_string_lossy().into_owned();
        for file in fs::read_dir(project.path()).into_iter().flatten().flatten() {
            let path = file.path();
            let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            if path.extension().is_some_and(|e| e == "jsonl") && !stem.starts_with("agent-") {
                let modified = file.metadata().map(|m| mtime_ms(&m)).unwrap_or(0);
                files.push((modified, project_name.clone(), stem, path));
            }
        }
    }
    files.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.3.cmp(&b.3)));
    files.into_iter().map(|(_, project, session, path)| (project, session, path)).collect()
}

fn search_dirs(dirs: &[PathBuf], query: &str) -> Result<SearchResult, String> {
    let query = query.trim();
    if query.chars().count() < MIN_QUERY_CHARS {
        return Ok(SearchResult { hits: Vec::new(), capped: false });
    }
    let pattern = regex::RegexBuilder::new(&regex::escape(query))
        .case_insensitive(true)
        .build()
        .map_err(|e| e.to_string())?;
    let mut hits = Vec::new();
    let mut capped = false;
    'dirs: for (dir_index, dir) in dirs.iter().enumerate() {
        for (project, session, path) in transcripts_newest_first(dir) {
            let Ok(entries) = read_entries(&path) else { continue };
            let mut in_session = 0;
            for (index, entry) in entries.iter().enumerate() {
                // Tool input and output would drown the conversation in hits.
                if entry.kind != "user" && entry.kind != "assistant" {
                    continue;
                }
                let Some(found) = pattern.find(&entry.text) else { continue };
                if hits.len() == MAX_HITS {
                    capped = true;
                    break 'dirs;
                }
                if in_session == MAX_HITS_PER_SESSION {
                    capped = true;
                    break;
                }
                in_session += 1;
                let (before, matched, after) = snippet(&entry.text, found.start(), found.end());
                hits.push(SearchHit {
                    dir_index,
                    project: project.clone(),
                    session: session.clone(),
                    index,
                    kind: entry.kind,
                    ts: entry.ts,
                    before,
                    matched,
                    after,
                });
            }
        }
    }
    hits.sort_by_key(|h| std::cmp::Reverse(h.ts));
    Ok(SearchResult { hits, capped })
}

/// Case-insensitive search of what the user and Claude wrote, across the
/// given config directories. Tool calls and their output are not searched.
#[tauri::command]
pub async fn claude_monitor_search(dirs: Vec<String>, query: String) -> Result<SearchResult, String> {
    tokio::task::spawn_blocking(move || {
        let home = home_dir();
        let dirs: Vec<PathBuf> = dirs.iter().map(|d| expand_home(d, home.as_deref())).collect();
        search_dirs(&dirs, &query)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("claude-transcript-{tag}-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn write(&self, rel: &str, body: &str) -> PathBuf {
            let path = self.0.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, body).unwrap();
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn line(value: serde_json::Value) -> String {
        format!("{value}\n")
    }

    fn user(text: &str) -> String {
        line(serde_json::json!({"type":"user","timestamp":"2026-11-01T10:00:00Z","message":{"role":"user","content":text}}))
    }

    fn assistant(blocks: serde_json::Value) -> String {
        line(serde_json::json!({"type":"assistant","timestamp":"2026-11-01T10:00:05Z",
            "message":{"role":"assistant","model":"claude-opus-5-5","content":blocks}}))
    }

    #[test]
    fn splits_a_conversation_into_readable_entries() {
        let dir = TempDir::new("entries");
        let body = [
            user("<system-reminder>ignore</system-reminder>"),
            user("Fix the Login bug"),
            assistant(serde_json::json!([
                {"type":"thinking","thinking":""},
                {"type":"text","text":"Looking at it."},
                {"type":"tool_use","name":"Read","input":{"file_path":"/a.ts"}}
            ])),
            line(serde_json::json!({"type":"user","message":{"role":"user","content":[
                {"type":"tool_result","content":[{"type":"text","text":"file body"}]}]}})),
            line(serde_json::json!({"type":"ai-title","aiTitle":"x"})),
            "not json\n".to_string(),
        ]
        .concat();
        let path = dir.write("s.jsonl", &body);
        let entries = read_entries(&path).unwrap();
        let kinds: Vec<&str> = entries.iter().map(|e| e.kind).collect();
        assert_eq!(kinds, vec!["meta", "user", "assistant", "tool_use", "tool_result"]);
        assert_eq!(entries[1].text, "Fix the Login bug");
        assert_eq!(entries[2].model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(entries[3].tool.as_deref(), Some("Read"));
        assert!(entries[3].text.contains("\"file_path\": \"/a.ts\""));
        assert_eq!(entries[4].text, "file body");
    }

    #[test]
    fn pages_from_the_end_and_around_a_hit() {
        let raw = |n: usize| -> Vec<RawEntry> {
            (0..n)
                .map(|i| RawEntry { kind: "user", ts: None, text: format!("m{i}"), tool: None, model: None })
                .collect()
        };
        let at = |before, from, around| PageAt { before, from, around };
        let last = page_of(raw(700), PageAt::default());
        assert_eq!((last.start, last.entries.len(), last.total), (400, 300, 700));
        assert_eq!(last.entries[0].index, 400);

        let earlier = page_of(raw(700), at(Some(last.start), None, None));
        assert_eq!((earlier.start, earlier.entries.len()), (100, 300));
        let first = page_of(raw(700), at(Some(earlier.start), None, None));
        assert_eq!((first.start, first.entries.len()), (0, 100));

        let around = page_of(raw(700), at(None, None, Some(500)));
        assert_eq!(around.start, 500 - CONTEXT_BEFORE);
        assert!(around.entries.iter().any(|e| e.index == 500));
        let later = page_of(raw(700), at(None, Some(690), None));
        assert_eq!((later.start, later.entries.len()), (690, 10));
        assert_eq!(page_of(raw(3), at(None, None, Some(99))).entries.len(), 3);
        assert!(page_of(raw(0), PageAt::default()).entries.is_empty());
    }

    #[test]
    fn long_entries_are_cut_on_a_character_boundary() {
        let text = "é".repeat(ENTRY_MAX_CHARS + 5);
        let page = page_of(vec![RawEntry { kind: "user", ts: None, text, tool: None, model: None }], PageAt::default());
        assert!(page.entries[0].truncated);
        assert_eq!(page.entries[0].text.chars().count(), ENTRY_MAX_CHARS);
    }

    #[test]
    fn rejects_names_that_would_leave_the_projects_folder() {
        assert!(transcript_path("~/.claude", "..", "s").is_err());
        assert!(transcript_path("~/.claude", "p", "../../etc/passwd").is_err());
        assert!(transcript_path("~/.claude", "p/q", "s").is_err());
        assert!(transcript_path("/cfg", "-work-app", "abc").unwrap().ends_with("projects/-work-app/abc.jsonl"));
    }

    #[test]
    fn search_is_case_insensitive_and_skips_tool_traffic() {
        let dir = TempDir::new("search");
        dir.write(
            "projects/p/s1.jsonl",
            &[
                user("Please fix the LOGIN   bug in checkout"),
                assistant(serde_json::json!([
                    {"type":"text","text":"The login handler đăng nhập fails."},
                    {"type":"tool_use","name":"Grep","input":{"pattern":"login"}}
                ])),
            ]
            .concat(),
        );
        dir.write("projects/p/agent-x.jsonl", &user("login in a subagent"));
        dir.write("projects/q/s2.jsonl", &user("nothing relevant"));

        let result = search_dirs(std::slice::from_ref(&dir.0), "Login").unwrap();
        assert!(!result.capped);
        assert_eq!(result.hits.len(), 2, "tool input and subagent files are not searched");
        let hit = result.hits.iter().find(|h| h.kind == "user").unwrap();
        assert_eq!((hit.project.as_str(), hit.session.as_str(), hit.index), ("p", "s1", 0));
        assert_eq!((hit.before.as_str(), hit.matched.as_str(), hit.after.as_str()),
            ("Please fix the ", "LOGIN", " bug in checkout"));

        assert_eq!(search_dirs(std::slice::from_ref(&dir.0), "đăng nhập").unwrap().hits.len(), 1);
        assert!(search_dirs(std::slice::from_ref(&dir.0), "x").unwrap().hits.is_empty(), "too short");
        assert!(search_dirs(std::slice::from_ref(&dir.0), "a.c").unwrap().hits.is_empty(), "query is literal");
    }

    #[test]
    fn search_caps_hits_per_session() {
        let dir = TempDir::new("cap");
        let body: String = (0..MAX_HITS_PER_SESSION + 5).map(|i| user(&format!("needle {i}"))).collect();
        dir.write("projects/p/s1.jsonl", &body);
        let result = search_dirs(std::slice::from_ref(&dir.0), "needle").unwrap();
        assert_eq!(result.hits.len(), MAX_HITS_PER_SESSION);
        assert!(result.capped);
    }

    #[test]
    fn snippets_are_trimmed_with_ellipses() {
        let text = format!("{} needle {}", "a".repeat(200), "b".repeat(200));
        let at = text.find("needle").unwrap();
        let (before, matched, after) = snippet(&text, at, at + 6);
        assert_eq!(matched, "needle");
        assert!(before.starts_with('…') && before.ends_with("a "));
        assert!(after.starts_with(" b") && after.ends_with('…'));
        assert_eq!(before.chars().count(), SNIPPET_RADIUS + 1);
    }
}
