// Claude Manager — read-only monitor for Claude Code's local data.
//
// One "profile" is one Claude Code config directory (`~/.claude`, or
// whatever `CLAUDE_CONFIG_DIR` points at for a second account). For each
// profile this reads:
//
//   <dir>/projects/<project>/<session>.jsonl      session transcripts
//   <dir>/projects/<project>/<session>/subagents/ subagent transcripts
//   <dir>/sessions/<pid>.json                     live-process registry
//   <dir>/.claude.json  (or ~/.claude.json)       signed-in account
//
// and returns per-session metadata plus token usage in hourly buckets.
// Nothing is written, nothing leaves the machine, and `.credentials.json`
// is never opened. Message bodies are not returned either — only a short
// title per session.
//
// Transcripts are append-only and can be very large, so parsed state is
// cached per file and a growing file is read from where the last scan
// stopped.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

const TITLE_MAX_CHARS: usize = 140;
const MS_PER_HOUR: i64 = 3_600_000;

// ── Wire types ──────────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    email: Option<String>,
    organization: Option<String>,
    display_name: Option<String>,
}

/// Token usage of one model within one clock hour (UTC), for one session.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageBucket {
    /// Hours since the Unix epoch. The frontend regroups by local day.
    hour: i64,
    model: String,
    input: u64,
    output: u64,
    cache_write_5m: u64,
    cache_write_1h: u64,
    cache_read: u64,
    requests: u64,
}

/// A running Claude Code process attached to a session.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveInfo {
    pid: u32,
    /// As Claude Code reports it ("busy", "idle", …); passed through.
    status: Option<String>,
    kind: Option<String>,
    name: Option<String>,
    entrypoint: Option<String>,
    updated_at: Option<i64>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    id: String,
    /// Folder name under `projects/` (the cwd with separators replaced).
    project: String,
    cwd: Option<String>,
    git_branch: Option<String>,
    title: Option<String>,
    version: Option<String>,
    started_at: Option<i64>,
    last_activity_at: Option<i64>,
    /// Prompts typed by the user (tool results excluded).
    prompts: u64,
    subagents: u64,
    /// "user" | "assistant" — who wrote the last conversation line.
    last_role: Option<String>,
    last_stop_reason: Option<String>,
    live: Option<LiveInfo>,
    buckets: Vec<UsageBucket>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSnapshot {
    config_dir: String,
    exists: bool,
    account: Option<Account>,
    sessions: Vec<SessionInfo>,
}

// ── Transcript lines (only the fields we read) ──────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Line {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    cwd: Option<String>,
    git_branch: Option<String>,
    version: Option<String>,
    session_id: Option<String>,
    request_id: Option<String>,
    is_meta: Option<bool>,
    ai_title: Option<String>,
    custom_title: Option<String>,
    summary: Option<String>,
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Message {
    id: Option<String>,
    model: Option<String>,
    stop_reason: Option<String>,
    usage: Option<Usage>,
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
}

#[derive(Deserialize, Default)]
struct Usage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
    cache_creation: Option<CacheCreation>,
}

#[derive(Deserialize, Default)]
struct CacheCreation {
    #[serde(default)]
    ephemeral_5m_input_tokens: u64,
    #[serde(default)]
    ephemeral_1h_input_tokens: u64,
}

// ── Per-file parsed state ───────────────────────────────────────────────

#[derive(Clone, Debug, Default)]
struct MsgUsage {
    hour: i64,
    model: String,
    input: u64,
    output: u64,
    cache_write_5m: u64,
    cache_write_1h: u64,
    cache_read: u64,
}

#[derive(Clone, Debug, Default)]
struct FileState {
    /// Bytes consumed so far; always ends on a line boundary.
    offset: u64,
    mtime_ms: i64,
    /// `sessionId` from the lines; names the parent for old-style
    /// `agent-*.jsonl` files that sit beside their session.
    session_id: Option<String>,
    cwd: Option<String>,
    git_branch: Option<String>,
    version: Option<String>,
    custom_title: Option<String>,
    ai_title: Option<String>,
    summary: Option<String>,
    first_prompt: Option<String>,
    started_at: Option<i64>,
    last_activity_at: Option<i64>,
    prompts: u64,
    last_role: Option<String>,
    last_stop_reason: Option<String>,
    /// Keyed by API message id. One response is written as several lines
    /// (one per content block) that repeat the id, and a resumed session
    /// copies earlier messages into its new file — both must count once.
    messages: HashMap<String, MsgUsage>,
    anonymous: u64,
}

pub(crate) fn parse_ts(raw: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|t| t.timestamp_millis())
}

fn truncate_title(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= TITLE_MAX_CHARS {
        return flat;
    }
    let mut out: String = flat.chars().take(TITLE_MAX_CHARS).collect();
    out.push('…');
    out
}

/// The text of a prompt the user typed, or `None` for tool results and
/// harness-injected messages (those start with an XML-style tag).
fn prompt_text(content: &Content) -> Option<&str> {
    let text = match content {
        Content::Text(s) => Some(s.as_str()),
        Content::Blocks(blocks) => blocks
            .iter()
            .find(|b| b.kind.as_deref() == Some("text"))
            .and_then(|b| b.text.as_deref()),
        Content::Other(_) => None,
    }?;
    let trimmed = text.trim();
    (!trimmed.is_empty() && !trimmed.starts_with('<')).then_some(trimmed)
}

impl FileState {
    fn apply(&mut self, line: Line) {
        if self.session_id.is_none() {
            self.session_id = line.session_id;
        }
        if let Some(t) = line.custom_title {
            self.custom_title = Some(t);
        }
        if let Some(t) = line.ai_title {
            self.ai_title = Some(t);
        }
        if let Some(t) = line.summary {
            self.summary = Some(t);
        }
        if line.cwd.is_some() {
            self.cwd = line.cwd;
        }
        if line.git_branch.is_some() {
            self.git_branch = line.git_branch;
        }
        if line.version.is_some() {
            self.version = line.version;
        }

        let kind = line.kind.as_deref().unwrap_or("");
        if kind != "user" && kind != "assistant" {
            return;
        }
        let ts = line.timestamp.as_deref().and_then(parse_ts);
        if let Some(ts) = ts {
            self.started_at = Some(self.started_at.map_or(ts, |s| s.min(ts)));
            self.last_activity_at = Some(self.last_activity_at.map_or(ts, |s| s.max(ts)));
        }
        self.last_role = Some(kind.to_string());
        let Some(message) = line.message else { return };

        if kind == "user" {
            self.last_stop_reason = None;
            if line.is_meta == Some(true) {
                return;
            }
            if let Some(text) = message.content.as_ref().and_then(prompt_text) {
                self.prompts += 1;
                if self.first_prompt.is_none() {
                    self.first_prompt = Some(truncate_title(text));
                }
            }
            return;
        }

        self.last_stop_reason = message.stop_reason;
        let (Some(usage), Some(model)) = (message.usage, message.model) else { return };
        // Claude Code's own placeholder replies (errors, interrupts).
        if model.starts_with('<') {
            return;
        }
        let total_write = usage.cache_creation_input_tokens;
        let (w5, w1) = match usage.cache_creation {
            Some(c) if c.ephemeral_5m_input_tokens + c.ephemeral_1h_input_tokens > 0 => {
                (c.ephemeral_5m_input_tokens, c.ephemeral_1h_input_tokens)
            }
            // Older transcripts carry only the total; 5 minutes was the
            // only TTL Claude Code used then.
            _ => (total_write, 0),
        };
        let key = match (message.id, line.request_id) {
            (Some(id), _) => id,
            (None, Some(req)) => req,
            (None, None) => {
                self.anonymous += 1;
                format!("anon-{}", self.anonymous)
            }
        };
        // Later lines of the same response repeat or extend the usage.
        self.messages.insert(
            key,
            MsgUsage {
                hour: ts.unwrap_or(0).div_euclid(MS_PER_HOUR),
                model,
                input: usage.input_tokens,
                output: usage.output_tokens,
                cache_write_5m: w5,
                cache_write_1h: w1,
                cache_read: usage.cache_read_input_tokens,
            },
        );
    }

    fn title(&self) -> Option<String> {
        self.custom_title
            .clone()
            .or_else(|| self.ai_title.clone())
            .or_else(|| self.summary.clone())
            .map(|t| truncate_title(&t))
            .or_else(|| self.first_prompt.clone())
    }
}

pub(crate) fn mtime_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as i64)
}

/// Reads `path` into `state`, continuing from `state.offset`. A trailing
/// line without a newline is left for the next call (still being written).
fn read_into(path: &Path, state: &mut FileState) -> std::io::Result<()> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(state.offset))?;
    let mut reader = BufReader::with_capacity(256 * 1024, file);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        let n = reader.read_until(b'\n', &mut buf)?;
        if n == 0 || buf.last() != Some(&b'\n') {
            break;
        }
        state.offset += n as u64;
        if let Ok(line) = serde_json::from_slice::<Line>(&buf) {
            state.apply(line);
        }
    }
    Ok(())
}

type Cache = Mutex<HashMap<PathBuf, FileState>>;

fn cache() -> &'static Cache {
    static CACHE: OnceLock<Cache> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// Parsed state of `path`, re-reading only what changed since last time.
fn load_file(path: &Path, cache: &Cache) -> Option<FileState> {
    let meta = fs::metadata(path).ok()?;
    let (len, mtime) = (meta.len(), mtime_ms(&meta));
    let previous = cache.lock().ok()?.get(path).cloned();
    let mut state = match previous {
        Some(s) if s.offset == len && s.mtime_ms == mtime => return Some(s),
        // Grew: keep what we have and read the new tail.
        Some(s) if s.offset <= len => s,
        // Shrank (rewritten or truncated): start over.
        _ => FileState::default(),
    };
    read_into(path, &mut state).ok()?;
    state.mtime_ms = mtime;
    if let Ok(mut map) = cache.lock() {
        map.insert(path.to_path_buf(), state.clone());
    }
    Some(state)
}

// ── Directory walk ──────────────────────────────────────────────────────

fn jsonl_files(dir: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "jsonl") && p.is_file())
        .collect();
    out.sort();
    out
}

fn file_stem(path: &Path) -> String {
    path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

struct SessionFiles {
    id: String,
    project: String,
    main: Option<FileState>,
    subagents: Vec<FileState>,
}

fn entry<'a>(out: &'a mut HashMap<String, SessionFiles>, id: String, project: &str) -> &'a mut SessionFiles {
    out.entry(id.clone()).or_insert_with(|| SessionFiles {
        id,
        project: project.to_string(),
        main: None,
        subagents: Vec::new(),
    })
}

fn collect_project(project_dir: &Path, cache: &Cache, out: &mut HashMap<String, SessionFiles>) {
    let project = project_dir
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    for path in jsonl_files(project_dir) {
        let Some(state) = load_file(&path, cache) else { continue };
        let stem = file_stem(&path);
        if stem.starts_with("agent-") {
            // Old layout: the subagent sits beside its session and names
            // the parent in `sessionId`.
            let parent = state.session_id.clone().unwrap_or(stem);
            entry(out, parent, &project).subagents.push(state);
        } else {
            entry(out, stem, &project).main = Some(state);
        }
    }
    // Current layout: <session>/subagents/agent-*.jsonl
    for sub in fs::read_dir(project_dir).into_iter().flatten().flatten() {
        let agents_dir = sub.path().join("subagents");
        if !agents_dir.is_dir() {
            continue;
        }
        let parent = sub.file_name().to_string_lossy().into_owned();
        for path in jsonl_files(&agents_dir) {
            if let Some(state) = load_file(&path, cache) {
                entry(out, parent.clone(), &project).subagents.push(state);
            }
        }
    }
}

fn build_session(files: SessionFiles, seen: &mut HashSet<String>) -> SessionInfo {
    let mut buckets: HashMap<(i64, String), UsageBucket> = HashMap::new();
    let mut add = |state: &FileState| {
        for (id, m) in &state.messages {
            if !seen.insert(id.clone()) {
                continue;
            }
            let b = buckets.entry((m.hour, m.model.clone())).or_insert_with(|| UsageBucket {
                hour: m.hour,
                model: m.model.clone(),
                ..Default::default()
            });
            b.input += m.input;
            b.output += m.output;
            b.cache_write_5m += m.cache_write_5m;
            b.cache_write_1h += m.cache_write_1h;
            b.cache_read += m.cache_read;
            b.requests += 1;
        }
    };
    if let Some(main) = &files.main {
        add(main);
    }
    for sub in &files.subagents {
        add(sub);
    }
    let mut buckets: Vec<UsageBucket> = buckets.into_values().collect();
    buckets.sort_by(|a, b| a.hour.cmp(&b.hour).then_with(|| a.model.cmp(&b.model)));

    // A session known only through its subagents still gets a row.
    let main = files.main.unwrap_or_default();
    let latest_sub = files.subagents.iter().filter_map(|s| s.last_activity_at).max();
    SessionInfo {
        id: files.id,
        project: files.project,
        title: main.title(),
        cwd: main.cwd.or_else(|| files.subagents.iter().find_map(|s| s.cwd.clone())),
        git_branch: main.git_branch,
        version: main.version,
        started_at: main
            .started_at
            .or_else(|| files.subagents.iter().filter_map(|s| s.started_at).min()),
        last_activity_at: main.last_activity_at.max(latest_sub),
        prompts: main.prompts,
        subagents: files.subagents.len() as u64,
        last_role: main.last_role,
        last_stop_reason: main.last_stop_reason,
        live: None,
        buckets,
    }
}

// ── Live-process registry ───────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryEntry {
    pid: u32,
    session_id: String,
    cwd: Option<String>,
    started_at: Option<i64>,
    version: Option<String>,
    kind: Option<String>,
    entrypoint: Option<String>,
    name: Option<String>,
    status: Option<String>,
    updated_at: Option<i64>,
}

fn read_registry(config_dir: &Path) -> Vec<RegistryEntry> {
    fs::read_dir(config_dir.join("sessions"))
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .filter_map(|p| serde_json::from_slice(&fs::read(p).ok()?).ok())
        .collect()
}

fn alive_pids(pids: &[u32]) -> HashSet<u32> {
    if pids.is_empty() {
        return HashSet::new();
    }
    let wanted: Vec<sysinfo::Pid> = pids.iter().map(|p| sysinfo::Pid::from_u32(*p)).collect();
    let mut sys = sysinfo::System::new();
    sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&wanted),
        true,
        sysinfo::ProcessRefreshKind::nothing(),
    );
    pids.iter()
        .copied()
        .filter(|p| sys.process(sysinfo::Pid::from_u32(*p)).is_some())
        .collect()
}

// ── Account ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlobalConfig {
    oauth_account: Option<OauthAccount>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OauthAccount {
    email_address: Option<String>,
    organization_name: Option<String>,
    display_name: Option<String>,
}

pub(crate) fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Claude Code keeps its global config inside the directory when
/// `CLAUDE_CONFIG_DIR` is set, and beside it (`~/.claude.json`) for the
/// default directory.
fn read_account(config_dir: &Path, home: Option<&Path>) -> Option<Account> {
    let mut candidates = vec![config_dir.join(".claude.json")];
    if let Some(home) = home {
        if config_dir == home.join(".claude") {
            candidates.push(home.join(".claude.json"));
        }
    }
    candidates.into_iter().find_map(|path| {
        let config: GlobalConfig = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
        let a = config.oauth_account?;
        Some(Account {
            email: a.email_address,
            organization: a.organization_name,
            display_name: a.display_name,
        })
    })
}

// ── Scan ────────────────────────────────────────────────────────────────

pub(crate) fn expand_home(raw: &str, home: Option<&Path>) -> PathBuf {
    let trimmed = raw.trim();
    match (trimmed.strip_prefix('~'), home) {
        (Some(rest), Some(home)) if rest.is_empty() || rest.starts_with(['/', '\\']) => {
            home.join(rest.trim_start_matches(['/', '\\']))
        }
        _ => PathBuf::from(trimmed),
    }
}

fn scan_profile(
    raw_dir: &str,
    home: Option<&Path>,
    cache: &Cache,
    is_alive: &dyn Fn(&[u32]) -> HashSet<u32>,
) -> ProfileSnapshot {
    let dir = expand_home(raw_dir, home);
    let mut snapshot = ProfileSnapshot { config_dir: raw_dir.to_string(), ..Default::default() };
    if !dir.is_dir() {
        return snapshot;
    }
    snapshot.exists = true;
    snapshot.account = read_account(&dir, home);

    let mut by_id: HashMap<String, SessionFiles> = HashMap::new();
    for project in fs::read_dir(dir.join("projects")).into_iter().flatten().flatten() {
        if project.path().is_dir() {
            collect_project(&project.path(), cache, &mut by_id);
        }
    }

    // Oldest first, so a message copied into a resumed session stays with
    // the session that originally paid for it.
    let mut files: Vec<SessionFiles> = by_id.into_values().collect();
    files.sort_by_key(|f| (f.main.as_ref().and_then(|m| m.started_at).unwrap_or(i64::MAX), f.id.clone()));
    let mut seen = HashSet::new();
    let mut sessions: Vec<SessionInfo> =
        files.into_iter().map(|f| build_session(f, &mut seen)).collect();

    let registry = read_registry(&dir);
    let alive = is_alive(&registry.iter().map(|r| r.pid).collect::<Vec<_>>());
    for entry in registry.into_iter().filter(|r| alive.contains(&r.pid)) {
        let live = LiveInfo {
            pid: entry.pid,
            status: entry.status,
            kind: entry.kind,
            name: entry.name,
            entrypoint: entry.entrypoint,
            updated_at: entry.updated_at,
        };
        match sessions.iter_mut().find(|s| s.id == entry.session_id) {
            Some(session) => session.live = Some(live),
            // Started but nothing written to the transcript yet.
            None => sessions.push(SessionInfo {
                id: entry.session_id,
                cwd: entry.cwd,
                version: entry.version,
                started_at: entry.started_at,
                last_activity_at: entry.updated_at.or(entry.started_at),
                live: Some(live),
                ..Default::default()
            }),
        }
    }

    sessions.sort_by_key(|s| std::cmp::Reverse(s.last_activity_at));
    snapshot.sessions = sessions;
    snapshot
}

/// Scans each config directory. `~` expands to the home directory.
#[tauri::command]
pub async fn claude_monitor_scan(dirs: Vec<String>) -> Result<Vec<ProfileSnapshot>, String> {
    tokio::task::spawn_blocking(move || {
        let home = home_dir();
        dirs.iter()
            .map(|d| scan_profile(d, home.as_deref(), cache(), &alive_pids))
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

// ── Detection ───────────────────────────────────────────────────────────
//
// Account switchers and agent orchestrators keep one config directory per
// account wherever they like, and point Claude Code at it through
// `CLAUDE_CONFIG_DIR`. Detection therefore does not rely on a list of known
// tools. It recognises a config directory by its contents, and looks in
// three places: the standard locations, the environment of running
// processes, and a bounded walk of the home folder.

/// How deep below the home folder the walk goes (`~/.tool/accounts/work`
/// is depth 3).
const HOME_SCAN_DEPTH: usize = 4;
/// How deep below a folder the user picked.
const CUSTOM_SCAN_DEPTH: usize = 3;
/// Directories read per walk, so a huge home folder cannot stall a scan.
const SCAN_BUDGET: usize = 20_000;

/// Never hold a config directory; large enough to be worth not entering.
const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "target", ".cache", "Caches", ".npm", ".cargo", ".rustup", ".gradle",
    ".m2", ".Trash", "Trash", ".venv", "venv", "__pycache__", ".nvm", ".pyenv", "DerivedData", "Pods",
];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    /// `~`-shortened when under the home folder.
    config_dir: String,
    /// "default" | "env" | "process" | "scan" | "custom"
    source: &'static str,
    /// Looks like a Claude Code config directory. Only `false` for a folder
    /// the user named in which nothing was found.
    valid: bool,
    email: Option<String>,
    sessions: u64,
}

/// Transcripts are named after the session's UUID, or `agent-<id>`.
fn is_transcript_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".jsonl") else { return false };
    stem.starts_with("agent-")
        || (stem.len() == 36 && stem.bytes().filter(|b| *b == b'-').count() == 4)
}

fn count_transcripts(config_dir: &Path) -> u64 {
    fs::read_dir(config_dir.join("projects"))
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(|project| fs::read_dir(project.path()).into_iter().flatten().flatten())
        .filter(|e| is_transcript_name(&e.file_name().to_string_lossy()))
        .count() as u64
}

/// A `projects` folder alone is too common a name, so it must come with
/// transcripts or with Claude Code's own config / credential file. The
/// credential file is only checked for existence, never opened.
fn looks_like_config_dir(dir: &Path) -> bool {
    dir.join("projects").is_dir()
        && (dir.join(".claude.json").is_file()
            || dir.join(".credentials.json").is_file()
            || count_transcripts(dir) > 0)
}

fn shorten(path: &Path, home: Option<&Path>) -> String {
    match home.and_then(|h| path.strip_prefix(h).ok()) {
        Some(rest) if rest.as_os_str().is_empty() => "~".to_string(),
        Some(rest) => format!("~/{}", rest.to_string_lossy().replace('\\', "/")),
        None => path.to_string_lossy().into_owned(),
    }
}

/// Breadth-first, so the shallow, likely places are covered before the
/// budget runs out. Does not enter a config directory it has found.
fn find_config_dirs(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut queue = std::collections::VecDeque::from([(root.to_path_buf(), 0usize)]);
    let mut budget = SCAN_BUDGET;
    while let Some((dir, depth)) = queue.pop_front() {
        if looks_like_config_dir(&dir) {
            found.push(dir);
            continue;
        }
        if depth == max_depth || budget == 0 {
            continue;
        }
        budget -= 1;
        let mut children: Vec<PathBuf> = fs::read_dir(&dir)
            .into_iter()
            .flatten()
            .flatten()
            // `file_type` does not follow symlinks, so links are not entered.
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .filter(|e| !SKIP_DIRS.contains(&e.file_name().to_string_lossy().as_ref()))
            .map(|e| e.path())
            .collect();
        children.sort();
        queue.extend(children.into_iter().map(|c| (c, depth + 1)));
    }
    found
}

/// `CLAUDE_CONFIG_DIR` of every process whose environment the OS lets us
/// read — how a directory used by another tool is found while that tool
/// has Claude running. Only that one variable is looked at.
fn process_config_dirs() -> Vec<PathBuf> {
    let mut sys = sysinfo::System::new();
    sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        sysinfo::ProcessRefreshKind::nothing().with_environ(sysinfo::UpdateKind::Always),
    );
    sys.processes()
        .values()
        .flat_map(|p| p.environ())
        .filter_map(|kv| kv.to_str()?.strip_prefix("CLAUDE_CONFIG_DIR=").map(PathBuf::from))
        .collect()
}

struct Collector<'a> {
    home: Option<&'a Path>,
    seen: HashSet<PathBuf>,
    out: Vec<Detected>,
}

impl Collector<'_> {
    /// First source to name a directory wins; later ones are duplicates.
    fn add(&mut self, dir: &Path, source: &'static str, valid: bool) {
        let canonical = fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
        if !self.seen.insert(canonical) {
            return;
        }
        self.out.push(Detected {
            config_dir: shorten(dir, self.home),
            source,
            valid,
            email: read_account(dir, self.home).and_then(|a| a.email),
            sessions: count_transcripts(dir),
        });
    }
}

/// Everything detection can find without being told where to look.
/// `env_dirs` are `CLAUDE_CONFIG_DIR` values, with where each was seen.
fn detect_auto(home: Option<&Path>, env_dirs: &[(PathBuf, &'static str)]) -> Vec<Detected> {
    let mut c = Collector { home, seen: HashSet::new(), out: Vec::new() };
    if let Some(home) = home {
        // The two places Claude Code itself uses.
        for dir in [home.join(".claude"), home.join(".config").join("claude")] {
            if dir.join("projects").is_dir() {
                c.add(&dir, "default", true);
            }
        }
    }
    for (dir, source) in env_dirs {
        // A directory Claude was started with is one even before it has data.
        if dir.is_dir() {
            c.add(dir, source, true);
        }
    }
    if let Some(home) = home {
        for dir in find_config_dirs(home, HOME_SCAN_DEPTH) {
            c.add(&dir, "scan", true);
        }
    }
    c.out
}

/// Checks folders the user named: each one itself, then the folders below
/// it. A folder with nothing in it comes back once, marked not valid.
fn detect_in_roots(roots: &[String], home: Option<&Path>) -> Vec<Detected> {
    let mut c = Collector { home, seen: HashSet::new(), out: Vec::new() };
    for raw in roots {
        let root = expand_home(raw, home);
        if looks_like_config_dir(&root) {
            c.add(&root, "custom", true);
            continue;
        }
        let inside = find_config_dirs(&root, CUSTOM_SCAN_DEPTH);
        if inside.is_empty() {
            c.add(&root, "custom", false);
        }
        for dir in inside {
            c.add(&dir, "scan", true);
        }
    }
    c.out
}

/// Finds Claude Code config directories. With no `roots`: the standard
/// locations, `CLAUDE_CONFIG_DIR` of this app and of running processes,
/// and a bounded walk of the home folder. With `roots`: those folders and
/// what is below them.
#[tauri::command]
pub async fn claude_monitor_detect(roots: Option<Vec<String>>) -> Result<Vec<Detected>, String> {
    tokio::task::spawn_blocking(move || {
        let home = home_dir();
        match roots.filter(|r| !r.is_empty()) {
            Some(roots) => detect_in_roots(&roots, home.as_deref()),
            None => {
                let mut env_dirs: Vec<(PathBuf, &'static str)> = std::env::var_os("CLAUDE_CONFIG_DIR")
                    .map(|d| (PathBuf::from(d), "env"))
                    .into_iter()
                    .collect();
                env_dirs.extend(process_config_dirs().into_iter().map(|d| (d, "process")));
                detect_auto(home.as_deref(), &env_dirs)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("claude-monitor-{tag}-{}", uuid::Uuid::new_v4()));
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

    fn user(ts: &str, text: &str) -> String {
        format!(
            r#"{{"type":"user","timestamp":"{ts}","sessionId":"s1","cwd":"/work/app","gitBranch":"main","version":"2.1.0","message":{{"role":"user","content":"{text}"}}}}"#
        ) + "\n"
    }

    fn assistant(ts: &str, id: &str, model: &str, input: u64, output: u64, stop: &str) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{ts}","sessionId":"s1","requestId":"req-{id}","message":{{"id":"{id}","model":"{model}","stop_reason":"{stop}","content":[{{"type":"text","text":"ok"}}],"usage":{{"input_tokens":{input},"output_tokens":{output},"cache_creation_input_tokens":30,"cache_read_input_tokens":40,"cache_creation":{{"ephemeral_5m_input_tokens":10,"ephemeral_1h_input_tokens":20}}}}}}}}"#
        ) + "\n"
    }

    fn scan(dir: &TempDir, cache: &Cache, alive: &[u32]) -> ProfileSnapshot {
        let alive: HashSet<u32> = alive.iter().copied().collect();
        scan_profile(&dir.0.to_string_lossy(), None, cache, &|pids| {
            pids.iter().copied().filter(|p| alive.contains(p)).collect()
        })
    }

    #[test]
    fn missing_directory_is_reported_not_an_error() {
        let snap = scan_profile("/definitely/not/here", None, &Cache::default(), &|_| HashSet::new());
        assert!(!snap.exists);
        assert!(snap.sessions.is_empty());
    }

    #[test]
    fn counts_each_response_once_and_buckets_by_hour_and_model() {
        let dir = TempDir::new("usage");
        let body = [
            user("2026-11-01T10:00:00Z", "fix the login bug"),
            // One response written as two lines: the later line wins.
            assistant("2026-11-01T10:00:05Z", "m1", "claude-opus-5-5", 100, 5, "tool_use"),
            assistant("2026-11-01T10:00:06Z", "m1", "claude-opus-5-5", 100, 50, "tool_use"),
            assistant("2026-11-01T11:30:00Z", "m2", "claude-haiku-5-5", 7, 3, "end_turn"),
            r#"{"type":"ai-title","aiTitle":"Fix login bug","sessionId":"s1"}"#.to_string() + "\n",
        ]
        .concat();
        dir.write("projects/-work-app/s1.jsonl", &body);

        let snap = scan(&dir, &Cache::default(), &[]);
        assert!(snap.exists);
        let s = &snap.sessions[0];
        assert_eq!(s.id, "s1");
        assert_eq!(s.project, "-work-app");
        assert_eq!(s.title.as_deref(), Some("Fix login bug"));
        assert_eq!(s.cwd.as_deref(), Some("/work/app"));
        assert_eq!(s.git_branch.as_deref(), Some("main"));
        assert_eq!(s.prompts, 1);
        assert_eq!(s.last_role.as_deref(), Some("assistant"));
        assert_eq!(s.last_stop_reason.as_deref(), Some("end_turn"));
        assert_eq!(s.buckets.len(), 2);
        let opus = &s.buckets[0];
        assert_eq!((opus.model.as_str(), opus.requests), ("claude-opus-5-5", 1));
        assert_eq!((opus.input, opus.output), (100, 50));
        assert_eq!((opus.cache_write_5m, opus.cache_write_1h, opus.cache_read), (10, 20, 40));
        assert_eq!(s.buckets[1].hour, opus.hour + 1);
    }

    #[test]
    fn title_falls_back_to_the_first_typed_prompt() {
        let dir = TempDir::new("title");
        let body = [
            user("2026-11-01T10:00:00Z", "<command-name>/clear</command-name>"),
            user("2026-11-01T10:00:01Z", "add   dark\\nmode"),
        ]
        .concat();
        dir.write("projects/p/s1.jsonl", &body);
        let snap = scan(&dir, &Cache::default(), &[]);
        assert_eq!(snap.sessions[0].title.as_deref(), Some("add dark mode"));
        assert_eq!(snap.sessions[0].prompts, 1);
    }

    #[test]
    fn appended_lines_are_read_incrementally() {
        let dir = TempDir::new("append");
        let cache = Cache::default();
        let path = dir.write(
            "projects/p/s1.jsonl",
            &assistant("2026-11-01T10:00:00Z", "m1", "claude-opus-5-5", 1, 1, "end_turn"),
        );
        assert_eq!(scan(&dir, &cache, &[]).sessions[0].buckets[0].requests, 1);
        let first_offset = cache.lock().unwrap()[&path].offset;

        // A complete line plus one still being written.
        let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(assistant("2026-11-01T10:01:00Z", "m2", "claude-opus-5-5", 2, 2, "end_turn").as_bytes())
            .unwrap();
        file.write_all(br#"{"type":"assistant","timest"#).unwrap();
        drop(file);

        let snap = scan(&dir, &cache, &[]);
        assert_eq!(snap.sessions[0].buckets[0].requests, 2);
        assert_eq!(snap.sessions[0].buckets[0].input, 3);
        let state = cache.lock().unwrap()[&path].clone();
        assert!(state.offset > first_offset);
        assert!(state.offset < fs::metadata(&path).unwrap().len(), "partial line must not be consumed");
    }

    #[test]
    fn subagents_roll_up_and_resumed_copies_are_not_double_counted() {
        let dir = TempDir::new("agents");
        let original = assistant("2026-11-01T10:00:00Z", "m1", "claude-opus-5-5", 100, 10, "end_turn");
        dir.write("projects/p/s1.jsonl", &[user("2026-11-01T09:59:00Z", "start"), original.clone()].concat());
        dir.write(
            "projects/p/s1/subagents/agent-a.jsonl",
            &assistant("2026-11-01T10:05:00Z", "m-sub", "claude-haiku-5-5", 9, 9, "end_turn"),
        );
        // A resumed session starts with a copy of the earlier response.
        dir.write(
            "projects/p/s2.jsonl",
            &[
                original,
                user("2026-11-02T08:00:00Z", "continue"),
                assistant("2026-11-02T08:00:05Z", "m3", "claude-opus-5-5", 5, 5, "end_turn"),
            ]
            .concat(),
        );

        let snap = scan(&dir, &Cache::default(), &[]);
        let by_id = |id: &str| snap.sessions.iter().find(|s| s.id == id).unwrap();
        let s1 = by_id("s1");
        assert_eq!(s1.subagents, 1);
        assert_eq!(s1.buckets.iter().map(|b| b.requests).sum::<u64>(), 2);
        assert!(s1.buckets.iter().any(|b| b.model == "claude-haiku-5-5"));
        let s2 = by_id("s2");
        assert_eq!(s2.buckets.iter().map(|b| b.requests).sum::<u64>(), 1, "m1 belongs to s1");
        // Most recently active first.
        assert_eq!(snap.sessions[0].id, "s2");
    }

    #[test]
    fn live_registry_marks_running_sessions_and_ignores_dead_pids() {
        let dir = TempDir::new("live");
        dir.write("projects/p/s1.jsonl", &user("2026-11-01T10:00:00Z", "hello"));
        dir.write("sessions/11.json", r#"{"pid":11,"sessionId":"s1","status":"busy","kind":"interactive","name":"app"}"#);
        dir.write("sessions/12.json", r#"{"pid":12,"sessionId":"gone","status":"idle"}"#);
        dir.write("sessions/13.json", r#"{"pid":13,"sessionId":"fresh","cwd":"/work/new","startedAt":5,"status":"idle"}"#);

        let snap = scan(&dir, &Cache::default(), &[11, 13]);
        let live = |id: &str| snap.sessions.iter().find(|s| s.id == id).and_then(|s| s.live.clone());
        assert_eq!(live("s1").unwrap().status.as_deref(), Some("busy"));
        assert!(snap.sessions.iter().all(|s| s.id != "gone"));
        let fresh = snap.sessions.iter().find(|s| s.id == "fresh").unwrap();
        assert_eq!(fresh.cwd.as_deref(), Some("/work/new"));
        assert_eq!(fresh.live.as_ref().unwrap().pid, 13);
    }

    #[test]
    fn account_comes_from_the_config_beside_or_inside_the_directory() {
        let home = TempDir::new("home");
        home.write(".claude/projects/p/s.jsonl", "");
        home.write(".claude.json", r#"{"oauthAccount":{"emailAddress":"a@example.com","organizationName":"Acme"},"projects":{}}"#);
        home.write(".claude-work/projects/p/s.jsonl", "");
        home.write(".claude-work/.claude.json", r#"{"oauthAccount":{"emailAddress":"b@example.com"}}"#);
        home.write(".claude-empty/readme.txt", "");


        let scan_home = |dir: &str| scan_profile(dir, Some(&home.0), &Cache::default(), &|_| HashSet::new());
        let default = scan_home("~/.claude");
        assert_eq!(default.config_dir, "~/.claude");
        let account = default.account.unwrap();
        assert_eq!(account.email.as_deref(), Some("a@example.com"));
        assert_eq!(account.organization.as_deref(), Some("Acme"));
        assert_eq!(scan_home("~/.claude-work").account.unwrap().email.as_deref(), Some("b@example.com"));
    }

    const UUID_A: &str = "0a0a0a0a-1111-2222-3333-444444444444.jsonl";

    fn dirs(found: &[Detected]) -> Vec<(&str, &str)> {
        found.iter().map(|d| (d.config_dir.as_str(), d.source)).collect()
    }

    #[test]
    fn detects_directories_wherever_other_tools_keep_them() {
        let home = TempDir::new("detect");
        home.write(&format!(".claude/projects/p/{UUID_A}"), "");
        home.write(".claude.json", r#"{"oauthAccount":{"emailAddress":"a@example.com"}}"#);
        // A switcher's per-account directories, three levels down.
        home.write(&format!(".switcher/instances/work/projects/p/{UUID_A}"), "");
        home.write(".switcher/instances/work/.claude.json", r#"{"oauthAccount":{"emailAddress":"w@example.com"}}"#);
        // Signed in but never used: no transcripts yet.
        home.write(".switcher/instances/fresh/.credentials.json", "{}");
        fs::create_dir_all(home.0.join(".switcher/instances/fresh/projects")).unwrap();
        // Named by a running process, still empty.
        fs::create_dir_all(home.0.join("agents/acct-b")).unwrap();
        // Not config directories: a plain `projects` folder, and one that
        // only sits inside a skipped folder.
        home.write("code/projects/site/data.jsonl", "");
        home.write(&format!("node_modules/x/projects/p/{UUID_A}"), "");

        let env = [(home.0.join("agents/acct-b"), "process"), (home.0.join(".claude"), "env")];
        let found = detect_auto(Some(&home.0), &env);
        assert_eq!(
            dirs(&found),
            vec![
                ("~/.claude", "default"),
                ("~/agents/acct-b", "process"),
                ("~/.switcher/instances/fresh", "scan"),
                ("~/.switcher/instances/work", "scan"),
            ]
        );
        assert!(found.iter().all(|d| d.valid));
        assert_eq!(found[0].email.as_deref(), Some("a@example.com"));
        assert_eq!(found[0].sessions, 1);
        assert_eq!(found[3].email.as_deref(), Some("w@example.com"));
    }

    #[test]
    fn a_named_folder_is_checked_itself_then_searched() {
        let home = TempDir::new("roots");
        home.write(&format!("acct/one/projects/p/{UUID_A}"), "");
        home.write(&format!("acct/two/projects/p/{UUID_A}"), "");
        fs::create_dir_all(home.0.join("empty")).unwrap();

        let roots = |list: &[&str]| -> Vec<String> { list.iter().map(|s| s.to_string()).collect() };
        let exact = detect_in_roots(&roots(&["~/acct/one"]), Some(&home.0));
        assert_eq!(dirs(&exact), vec![("~/acct/one", "custom")]);

        let parent = detect_in_roots(&roots(&["~/acct", "~/acct/one"]), Some(&home.0));
        assert_eq!(dirs(&parent), vec![("~/acct/one", "scan"), ("~/acct/two", "scan")]);

        let nothing = detect_in_roots(&roots(&["~/empty", "/definitely/not/here"]), Some(&home.0));
        assert_eq!(nothing.len(), 2);
        assert!(nothing.iter().all(|d| !d.valid && d.source == "custom"));
    }

    #[test]
    fn the_walk_stops_at_its_depth_limit() {
        let home = TempDir::new("depth");
        home.write(&format!("a/b/c/d/e/projects/p/{UUID_A}"), "");
        assert!(find_config_dirs(&home.0, HOME_SCAN_DEPTH).is_empty());
        assert_eq!(find_config_dirs(&home.0, 5).len(), 1);
    }
}
