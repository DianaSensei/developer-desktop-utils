// Mock HTTP Server tool.
//
// Binds a real TCP listener and serves user-defined "stubs". Every incoming
// request funnels into a single catch-all axum handler which runs the matching
// engine (method + path + matchers, first-match-wins) and builds a response
// either from a static template (`{{ token }}` interpolation) or a sandboxed
// Rhai script. Requests are reported to the frontend in batches via a
// `mock:request-batch` event (a background task flushes a bounded buffer every
// ~250ms) so a flood of requests can't saturate the IPC bridge or the UI.
//
// The rule set lives behind an `Arc<RwLock<Arc<MockConfig>>>` shared with the
// running handler, so editing stubs hot-swaps them without restarting — and the
// handler only clones a cheap `Arc` per request, never the whole stub set.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Router;
use chrono::Utc;
use rhai::{Dynamic, Engine, Map as RhaiMap, Scope};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const MAX_BODY: usize = 10 * 1024 * 1024; // 10 MB request body cap
const LOG_BODY_CAP: usize = 8 * 1024; // truncate bodies in the log preview (keeps IPC light)
const LOG_BUFFER_CAP: usize = 1000; // max log entries buffered between flushes (drops oldest)
const LOG_FLUSH_MS: u64 = 250; // how often the buffered log is streamed to the UI

// ── Data types (serde camelCase to match the TS frontend) ───────────────────

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvPair {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Matcher {
    /// "query" | "header" | "body" | "path"
    pub target: String,
    /// "equals" | "contains" | "regex" | "exists"
    pub op: String,
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stub {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// HTTP method, or "ANY" to match all methods.
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub matchers: Vec<Matcher>,
    /// "static" | "script"
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default = "default_status")]
    pub status: u16,
    #[serde(default)]
    pub headers: Vec<KvPair>,
    #[serde(default)]
    pub body: String,
    /// "text" | "json" | "base64" — how `body` is interpreted in static mode.
    #[serde(default = "default_body_type")]
    pub body_type: String,
    /// Optional download filename for base64 bodies (sets Content-Disposition).
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub script: String,
    #[serde(default)]
    pub delay_ms: u64,
}

fn default_mode() -> String {
    "static".to_string()
}
fn default_status() -> u16 {
    200
}
fn default_body_type() -> String {
    "text".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockConfig {
    #[serde(default)]
    pub stubs: Vec<Stub>,
    #[serde(default = "default_not_found_status")]
    pub not_found_status: u16,
    #[serde(default = "default_not_found_body")]
    pub not_found_body: String,
    #[serde(default = "default_not_found_ct")]
    pub not_found_content_type: String,
}

fn default_not_found_status() -> u16 {
    404
}
fn default_not_found_body() -> String {
    "{\"error\":\"No matching stub\"}".to_string()
}
fn default_not_found_ct() -> String {
    "application/json".to_string()
}

impl Default for MockConfig {
    fn default() -> Self {
        MockConfig {
            stubs: Vec::new(),
            not_found_status: default_not_found_status(),
            not_found_body: default_not_found_body(),
            not_found_content_type: default_not_found_ct(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockStatus {
    pub running: bool,
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEntry {
    id: String,
    ts: i64,
    method: String,
    path: String,
    query: String,
    status: u16,
    matched_stub_id: Option<String>,
    duration_ms: u64,
    req_headers: Vec<KvPair>,
    req_body: String,
    res_body: String,
}

// What a stub (static or script) resolves to. `body` is raw bytes so binary /
// base64 downloads work; `log_body` is a human-readable form for the event log.
struct ResolvedResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    log_body: String,
}

// The normalized request seen by the matcher / templates / scripts.
#[derive(Clone)]
struct RequestCtx {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
    body: String,
}

// ── Managed state ────────────────────────────────────────────────────────────

struct RunningServer {
    // A watch channel shared by every bound listener's graceful-shutdown future
    // (the local option binds both IPv4 and IPv6). Flip it to stop them all.
    shutdown: tokio::sync::watch::Sender<bool>,
    host: String,
    port: u16,
}

#[derive(Clone)]
struct HandlerState {
    // Cheap to clone per request: shares the same lock + buffer.
    rules: Arc<RwLock<Arc<MockConfig>>>,
    log_buf: Arc<Mutex<VecDeque<LogEntry>>>,
}

#[derive(Default)]
pub struct MockState {
    rules: Arc<RwLock<Arc<MockConfig>>>,
    server: Mutex<Option<RunningServer>>,
    // Requests are buffered here and flushed to the UI in batches.
    log_buf: Arc<Mutex<VecDeque<LogEntry>>>,
}

// Background task: drain the request-log buffer every LOG_FLUSH_MS and emit it
// to the UI as one batched event. Bounds IPC traffic and UI re-renders to a few
// per second regardless of how many requests/second the server is handling.
fn spawn_log_flusher(
    app: AppHandle,
    buf: Arc<Mutex<VecDeque<LogEntry>>>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_millis(LOG_FLUSH_MS));
        loop {
            tokio::select! {
                _ = tick.tick() => {
                    let batch: Vec<LogEntry> = {
                        let mut b = match buf.lock() { Ok(b) => b, Err(_) => break };
                        if b.is_empty() { continue; }
                        b.drain(..).collect()
                    };
                    let _ = app.emit("mock:request-batch", batch);
                }
                _ = shutdown.changed() => {
                    if *shutdown.borrow() { break; }
                }
            }
        }
    });
}

// ── Matching engine ───────────────────────────────────────────────────────────

/// Match a request path against a stub pattern. Supports literal segments,
/// `:name` captures, and `*` wildcards (a trailing `*` matches the rest).
/// Returns the captured path params on success.
fn match_path(pattern: &str, path: &str) -> Option<HashMap<String, String>> {
    let pat: Vec<&str> = pattern.trim_matches('/').split('/').collect();
    let seg: Vec<&str> = path.trim_matches('/').split('/').collect();
    let mut params = HashMap::new();
    let mut i = 0;
    while i < pat.len() {
        let p = pat[i];
        if p == "*" {
            // Trailing wildcard swallows everything that remains.
            if i == pat.len() - 1 {
                return Some(params);
            }
            // Mid-path wildcard matches exactly one segment.
            if i >= seg.len() {
                return None;
            }
            i += 1;
            continue;
        }
        if i >= seg.len() {
            return None;
        }
        if let Some(name) = p.strip_prefix(':') {
            params.insert(name.to_string(), urldecode(seg[i]));
        } else if p != seg[i] {
            return None;
        }
        i += 1;
    }
    if seg.len() != pat.len() {
        return None;
    }
    Some(params)
}

// Compiled-regex cache so matcher patterns aren't recompiled on every request.
// Cleared whenever the rule set changes (patterns are bounded by the stub set).
static REGEX_CACHE: OnceLock<Mutex<HashMap<String, Option<regex::Regex>>>> = OnceLock::new();

fn regex_for(pattern: &str) -> Option<regex::Regex> {
    let cache = REGEX_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut c = cache.lock().unwrap();
    if let Some(r) = c.get(pattern) {
        return r.clone();
    }
    let compiled = regex::Regex::new(pattern).ok();
    c.insert(pattern.to_string(), compiled.clone());
    compiled
}

fn clear_regex_cache() {
    if let Some(c) = REGEX_CACHE.get() {
        c.lock().unwrap().clear();
    }
}

fn method_matches(stub: &Stub, method: &str) -> bool {
    let m = stub.method.trim();
    m.eq_ignore_ascii_case("ANY") || m == "*" || m.eq_ignore_ascii_case(method)
}

/// Resolve a dot/bracket-free JSON path (e.g. `user.name`, `items.0.id`) within
/// `body`, returning the leaf as a string (strings as-is, others as JSON).
fn json_field(body: &str, path: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let mut cur = &v;
    for seg in path.split('.') {
        if seg.is_empty() {
            continue;
        }
        cur = match cur {
            serde_json::Value::Array(_) => cur.get(seg.parse::<usize>().ok()?)?,
            _ => cur.get(seg)?,
        };
    }
    Some(match cur {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    })
}

fn matcher_passes(m: &Matcher, ctx: &RequestCtx, params: &HashMap<String, String>) -> bool {
    let body_key = m.key.trim();
    // The subject string the operator runs against. For body, an empty key means
    // the whole body; a non-empty key is read as a JSON field path.
    let subject: Option<String> = match m.target.as_str() {
        "query" => ctx.query.get(&m.key).cloned(),
        "header" => ctx.headers.get(&m.key.to_ascii_lowercase()).cloned(),
        "path" => params.get(&m.key).cloned(),
        "body" => {
            if body_key.is_empty() {
                Some(ctx.body.clone())
            } else {
                json_field(&ctx.body, body_key)
            }
        }
        _ => None,
    };

    match m.op.as_str() {
        "exists" => match m.target.as_str() {
            "body" if body_key.is_empty() => !ctx.body.is_empty(),
            _ => subject.is_some(),
        },
        "equals" => subject.as_deref() == Some(m.value.as_str()),
        "contains" => subject.map(|s| s.contains(&m.value)).unwrap_or(false),
        "regex" => match regex_for(&m.value) {
            Some(re) => subject.map(|s| re.is_match(&s)).unwrap_or(false),
            None => false,
        },
        _ => false,
    }
}

/// First-match-wins selection. Returns the matched stub plus captured params.
fn select_stub<'a>(cfg: &'a MockConfig, ctx: &RequestCtx) -> Option<(&'a Stub, HashMap<String, String>)> {
    for stub in &cfg.stubs {
        if !stub.enabled {
            continue;
        }
        if !method_matches(stub, &ctx.method) {
            continue;
        }
        let params = match match_path(&stub.path, &ctx.path) {
            Some(p) => p,
            None => continue,
        };
        if stub.matchers.iter().all(|m| matcher_passes(m, ctx, &params)) {
            return Some((stub, params));
        }
    }
    None
}

// ── Template interpolation ─────────────────────────────────────────────────────

fn rand_u64() -> u64 {
    static SEED: AtomicU64 = AtomicU64::new(0);
    let mut x = SEED.load(Ordering::Relaxed);
    if x == 0 {
        x = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9e3779b97f4a7c15)
            | 1;
    }
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    SEED.store(x, Ordering::Relaxed);
    x
}

fn eval_token(expr: &str, ctx: &RequestCtx, params: &HashMap<String, String>) -> Option<String> {
    let e = expr.trim();
    match e {
        "request.method" => Some(ctx.method.clone()),
        "request.path" => Some(ctx.path.clone()),
        "request.body" => Some(ctx.body.clone()),
        "uuid" => Some(Uuid::new_v4().to_string()),
        "now" => Some(Utc::now().timestamp_millis().to_string()),
        "now.iso" => Some(Utc::now().to_rfc3339()),
        _ => {
            if let Some(name) = e.strip_prefix("request.query.") {
                Some(ctx.query.get(name).cloned().unwrap_or_default())
            } else if let Some(name) = e.strip_prefix("request.header.") {
                Some(ctx.headers.get(&name.to_ascii_lowercase()).cloned().unwrap_or_default())
            } else if let Some(name) = e.strip_prefix("path.") {
                Some(params.get(name).cloned().unwrap_or_default())
            } else if let Some(args) = e.strip_prefix("randomInt(").and_then(|s| s.strip_suffix(')')) {
                let parts: Vec<&str> = args.split(',').collect();
                if parts.len() == 2 {
                    if let (Ok(a), Ok(b)) = (parts[0].trim().parse::<i64>(), parts[1].trim().parse::<i64>()) {
                        let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
                        let span = (hi - lo + 1).max(1) as u64;
                        return Some((lo + (rand_u64() % span) as i64).to_string());
                    }
                }
                None
            } else {
                None
            }
        }
    }
}

/// Replace `{{ token }}` occurrences. Unknown tokens are left verbatim so typos
/// are visible rather than silently dropped.
fn render(template: &str, ctx: &RequestCtx, params: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        if let Some(end) = after.find("}}") {
            let expr = &after[..end];
            match eval_token(expr, ctx, params) {
                Some(v) => out.push_str(&v),
                None => {
                    out.push_str("{{");
                    out.push_str(expr);
                    out.push_str("}}");
                }
            }
            rest = &after[end + 2..];
        } else {
            out.push_str(&rest[start..]);
            return out;
        }
    }
    out.push_str(rest);
    out
}

// ── Rhai scripting (sandboxed) ─────────────────────────────────────────────────

fn build_engine() -> Engine {
    let mut engine = Engine::new();
    engine.set_max_operations(500_000);
    engine.set_max_expr_depths(64, 64);
    engine.set_max_call_levels(64);
    engine.set_max_string_size(MAX_BODY);
    engine.set_max_array_size(100_000);
    engine.set_max_map_size(100_000);
    engine
}

fn req_to_rhai(ctx: &RequestCtx, params: &HashMap<String, String>) -> RhaiMap {
    let mut map = RhaiMap::new();
    map.insert("method".into(), ctx.method.clone().into());
    map.insert("path".into(), ctx.path.clone().into());
    map.insert("body".into(), ctx.body.clone().into());
    let to_map = |src: &HashMap<String, String>| -> Dynamic {
        let mut m = RhaiMap::new();
        for (k, v) in src {
            m.insert(k.clone().into(), v.clone().into());
        }
        Dynamic::from_map(m)
    };
    map.insert("query".into(), to_map(&ctx.query));
    map.insert("headers".into(), to_map(&ctx.headers));
    map.insert("params".into(), to_map(params));
    map
}

/// Run a stub script. The script receives `req` and returns either a string
/// (treated as a 200 body) or a map `#{ status, headers, body }`.
fn run_script(
    script: &str,
    ctx: &RequestCtx,
    params: &HashMap<String, String>,
) -> Result<ResolvedResponse, String> {
    let engine = build_engine();
    let mut scope = Scope::new();
    scope.push("req", req_to_rhai(ctx, params));

    let result: Dynamic = engine
        .eval_with_scope(&mut scope, script)
        .map_err(|e| e.to_string())?;

    if result.is_map() {
        let map = result.cast::<RhaiMap>();
        let status = map
            .get("status")
            .and_then(|d| d.as_int().ok())
            .map(|n| n.clamp(100, 599) as u16)
            .unwrap_or(200);
        let body = match map.get("body") {
            Some(d) if d.is_string() => d.clone().into_string().unwrap_or_default(),
            Some(d) => d.to_string(),
            None => String::new(),
        };
        let mut headers = Vec::new();
        if let Some(h) = map.get("headers") {
            if h.is_map() {
                let hm = h.clone().cast::<RhaiMap>();
                for (k, v) in hm {
                    headers.push((k.to_string(), v.to_string()));
                }
            }
        }
        Ok(ResolvedResponse {
            status,
            headers,
            body: body.clone().into_bytes(),
            log_body: body,
        })
    } else {
        let body = if result.is_string() {
            result.into_string().unwrap_or_default()
        } else {
            result.to_string()
        };
        Ok(ResolvedResponse {
            status: 200,
            headers: vec![],
            body: body.clone().into_bytes(),
            log_body: body,
        })
    }
}

// ── Response building ──────────────────────────────────────────────────────────

fn resolve(stub: &Stub, ctx: &RequestCtx, params: &HashMap<String, String>) -> ResolvedResponse {
    if stub.mode == "script" {
        return match run_script(&stub.script, ctx, params) {
            Ok(r) => r,
            Err(e) => {
                let msg = format!("Mock script error: {e}");
                ResolvedResponse {
                    status: 500,
                    headers: vec![("content-type".into(), "text/plain".into())],
                    body: msg.clone().into_bytes(),
                    log_body: msg,
                }
            }
        };
    }

    let mut headers: Vec<(String, String)> = stub
        .headers
        .iter()
        .filter(|h| h.enabled && !h.key.is_empty())
        .map(|h| (h.key.clone(), render(&h.value, ctx, params)))
        .collect();

    let has_ct = headers.iter().any(|(k, _)| k.eq_ignore_ascii_case("content-type"));
    let set_ct = |headers: &mut Vec<(String, String)>, ct: &str| {
        if !has_ct {
            headers.push(("content-type".into(), ct.into()));
        }
    };

    if stub.body_type == "base64" {
        // Decode to raw bytes and serve as a download (no template rendering).
        match base64_decode(&stub.body) {
            Ok(bytes) => {
                set_ct(&mut headers, "application/octet-stream");
                if !stub.file_name.is_empty() {
                    headers.push((
                        "content-disposition".into(),
                        format!("attachment; filename=\"{}\"", stub.file_name.replace('"', "")),
                    ));
                }
                let n = bytes.len();
                ResolvedResponse {
                    status: stub.status,
                    headers,
                    body: bytes,
                    log_body: format!("<binary {n} bytes>"),
                }
            }
            Err(e) => {
                let msg = format!("Invalid base64 body: {e}");
                ResolvedResponse {
                    status: 500,
                    headers: vec![("content-type".into(), "text/plain".into())],
                    body: msg.clone().into_bytes(),
                    log_body: msg,
                }
            }
        }
    } else {
        let body = render(&stub.body, ctx, params);
        set_ct(
            &mut headers,
            if stub.body_type == "json" {
                "application/json"
            } else {
                "text/plain; charset=utf-8"
            },
        );
        ResolvedResponse {
            status: stub.status,
            headers,
            body: body.clone().into_bytes(),
            log_body: body,
        }
    }
}

// ── HTTP utilities ─────────────────────────────────────────────────────────────

/// Decode standard / URL-safe base64 (RFC 4648), tolerating whitespace, missing
/// padding, and an optional `data:...;base64,` prefix.
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let s = match input.find(";base64,") {
        Some(i) => &input[i + 8..],
        None => input,
    };
    let val = |c: u8| -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' | b'-' => Some(62),
            b'/' | b'_' => Some(63),
            _ => None,
        }
    };
    let mut bits = 0u32;
    let mut nbits = 0u32;
    let mut out = Vec::with_capacity(s.len() / 4 * 3 + 3);
    for &c in s.as_bytes() {
        if c == b'=' || c.is_ascii_whitespace() {
            continue;
        }
        let v = val(c).ok_or_else(|| format!("invalid character '{}'", c as char))?;
        bits = (bits << 6) | v as u32;
        nbits += 6;
        if nbits >= 8 {
            nbits -= 8;
            out.push((bits >> nbits) as u8);
        }
    }
    Ok(out)
}

fn urldecode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => match u8::from_str_radix(&s[i + 1..i + 3], 16) {
                Ok(b) => {
                    out.push(b);
                    i += 3;
                }
                Err(_) => {
                    out.push(bytes[i]);
                    i += 1;
                }
            },
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn parse_query(q: Option<&str>) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(q) = q {
        for pair in q.split('&') {
            if pair.is_empty() {
                continue;
            }
            let mut it = pair.splitn(2, '=');
            let k = urldecode(it.next().unwrap_or(""));
            let v = urldecode(it.next().unwrap_or(""));
            map.entry(k).or_insert(v);
        }
    }
    map
}

fn truncate(s: &str) -> String {
    if s.len() > LOG_BODY_CAP {
        format!("{}… (truncated)", &s[..LOG_BODY_CAP])
    } else {
        s.to_string()
    }
}

// ── The catch-all handler ──────────────────────────────────────────────────────

async fn handle(State(hs): State<HandlerState>, req: Request) -> Response {
    let started = std::time::Instant::now();
    let (parts, body) = req.into_parts();

    let method = parts.method.to_string();
    let path = parts.uri.path().to_string();
    let query_raw = parts.uri.query().unwrap_or("").to_string();
    let query = parse_query(parts.uri.query());

    let mut headers = HashMap::new();
    let mut req_headers_log = Vec::new();
    for (name, value) in parts.headers.iter() {
        let v = value.to_str().unwrap_or("").to_string();
        headers.insert(name.as_str().to_ascii_lowercase(), v.clone());
        req_headers_log.push(KvPair {
            key: name.as_str().to_string(),
            value: v,
            enabled: true,
        });
    }

    let body_bytes = axum::body::to_bytes(body, MAX_BODY).await.unwrap_or_default();
    let body_str = String::from_utf8_lossy(&body_bytes).to_string();

    let ctx = RequestCtx {
        method: method.clone(),
        path: path.clone(),
        query,
        headers,
        body: body_str.clone(),
    };

    // Cheap Arc clone of the current rule set — never deep-clones the stubs, and
    // never holds the lock across the await below.
    let cfg = hs
        .rules
        .read()
        .map(|g| Arc::clone(&g))
        .unwrap_or_else(|_| Arc::new(MockConfig::default()));

    let (resolved, matched_id, delay_ms) = match select_stub(cfg.as_ref(), &ctx) {
        Some((stub, params)) => {
            let id = stub.id.clone();
            let delay = stub.delay_ms;
            (resolve(stub, &ctx, &params), Some(id), delay)
        }
        None => {
            let empty = HashMap::new();
            let body = render(&cfg.not_found_body, &ctx, &empty);
            (
                ResolvedResponse {
                    status: cfg.not_found_status,
                    headers: vec![("content-type".into(), cfg.not_found_content_type.clone())],
                    body: body.clone().into_bytes(),
                    log_body: body,
                },
                None,
                0,
            )
        }
    };

    if delay_ms > 0 {
        tokio::time::sleep(Duration::from_millis(delay_ms.min(60_000))).await;
    }

    // Emit a log entry for the live request view.
    let entry = LogEntry {
        id: Uuid::new_v4().to_string(),
        ts: Utc::now().timestamp_millis(),
        method,
        path,
        query: query_raw,
        status: resolved.status,
        matched_stub_id: matched_id,
        duration_ms: started.elapsed().as_millis() as u64,
        req_headers: req_headers_log,
        req_body: truncate(&body_str),
        res_body: truncate(&resolved.log_body),
    };
    // Push into the bounded buffer (drop oldest on overflow); the flusher streams
    // it to the UI in batches. This keeps the hot path lock-light and emit-free.
    if let Ok(mut buf) = hs.log_buf.lock() {
        if buf.len() >= LOG_BUFFER_CAP {
            buf.pop_front();
        }
        buf.push_back(entry);
    }

    // Build the axum response.
    let mut builder = Response::builder()
        .status(StatusCode::from_u16(resolved.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR));
    let mut has_ct = false;
    for (k, v) in &resolved.headers {
        if k.eq_ignore_ascii_case("content-type") {
            has_ct = true;
        }
        builder = builder.header(k, v);
    }
    if !has_ct {
        builder = builder.header("content-type", "text/plain; charset=utf-8");
    }
    builder
        .body(Body::from(resolved.body))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mock_start(
    app: AppHandle,
    state: tauri::State<'_, MockState>,
    config: MockConfig,
    host: String,
    port: u16,
) -> Result<MockStatus, String> {
    if port == 0 {
        return Err("Port must be between 1 and 65535".into());
    }
    let host = host.trim().to_string();
    if host.is_empty() {
        return Err("Host is required".into());
    }

    // Replace the shared rule set before (re)starting.
    *state.rules.write().map_err(|_| "lock poisoned")? = Arc::new(config);
    clear_regex_cache();

    // Stop an existing server first (restart semantics).
    if let Some(old) = state.server.lock().map_err(|_| "lock poisoned")?.take() {
        let _ = old.shutdown.send(true);
    }

    // Decide which socket addresses to bind. "Local" binds BOTH IPv4 127.0.0.1
    // and IPv6 ::1 so `localhost` works from every client (browsers, curl, and
    // the Rust-based API Client which often resolves localhost to ::1).
    let targets: Vec<std::net::SocketAddr> = if host == "127.0.0.1" || host.eq_ignore_ascii_case("localhost") {
        vec![
            (std::net::Ipv4Addr::LOCALHOST, port).into(),
            (std::net::Ipv6Addr::LOCALHOST, port).into(),
        ]
    } else if host == "0.0.0.0" {
        vec![(std::net::Ipv4Addr::UNSPECIFIED, port).into()]
    } else {
        match host.parse::<std::net::IpAddr>() {
            Ok(ip) => vec![std::net::SocketAddr::new(ip, port)],
            Err(_) => return Err(format!("Invalid host: {host}")),
        }
    };

    // Bind best-effort: as long as one address binds we run (e.g. IPv6 may be
    // unavailable). Only error when every target fails.
    let mut listeners = Vec::new();
    let mut last_err = String::new();
    for addr in &targets {
        match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => listeners.push(l),
            Err(e) => last_err = format!("{addr}: {e}"),
        }
    }
    if listeners.is_empty() {
        return Err(format!("Could not bind {host}:{port} — {last_err}"));
    }

    let handler_state = HandlerState {
        rules: state.rules.clone(),
        log_buf: state.log_buf.clone(),
    };
    let router = Router::new().fallback(handle).with_state(handler_state);

    let (tx, rx) = tokio::sync::watch::channel(false);
    for listener in listeners {
        let router = router.clone();
        let mut rx = rx.clone();
        tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = rx.wait_for(|stop| *stop).await;
                })
                .await;
        });
    }

    // Stream buffered request logs to the UI; stops with the server.
    spawn_log_flusher(app.clone(), state.log_buf.clone(), rx.clone());

    *state.server.lock().map_err(|_| "lock poisoned")? = Some(RunningServer {
        shutdown: tx,
        host: host.clone(),
        port,
    });

    Ok(MockStatus {
        running: true,
        host,
        port,
    })
}

#[tauri::command]
pub async fn mock_stop(state: tauri::State<'_, MockState>) -> Result<(), String> {
    if let Some(server) = state.server.lock().map_err(|_| "lock poisoned")?.take() {
        let _ = server.shutdown.send(true);
    }
    Ok(())
}

#[tauri::command]
pub async fn mock_status(state: tauri::State<'_, MockState>) -> Result<MockStatus, String> {
    let guard = state.server.lock().map_err(|_| "lock poisoned")?;
    Ok(match guard.as_ref() {
        Some(s) => MockStatus {
            running: true,
            host: s.host.clone(),
            port: s.port,
        },
        None => MockStatus {
            running: false,
            host: String::new(),
            port: 0,
        },
    })
}

#[tauri::command]
pub async fn mock_update_rules(
    state: tauri::State<'_, MockState>,
    config: MockConfig,
) -> Result<(), String> {
    *state.rules.write().map_err(|_| "lock poisoned")? = Arc::new(config);
    clear_regex_cache();
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleRequest {
    #[serde(default = "default_get")]
    pub method: String,
    #[serde(default = "default_root")]
    pub path: String,
    #[serde(default)]
    pub query: HashMap<String, String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub params: HashMap<String, String>,
    #[serde(default)]
    pub body: String,
}

fn default_get() -> String {
    "GET".to_string()
}
fn default_root() -> String {
    "/".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResult {
    pub ok: bool,
    pub status: u16,
    pub headers: Vec<KvPair>,
    pub body: String,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn mock_test_script(script: String, sample: SampleRequest) -> Result<ScriptResult, String> {
    let headers: HashMap<String, String> = sample
        .headers
        .into_iter()
        .map(|(k, v)| (k.to_ascii_lowercase(), v))
        .collect();
    let ctx = RequestCtx {
        method: sample.method,
        path: sample.path,
        query: sample.query,
        headers,
        body: sample.body,
    };
    match run_script(&script, &ctx, &sample.params) {
        Ok(r) => Ok(ScriptResult {
            ok: true,
            status: r.status,
            headers: r
                .headers
                .into_iter()
                .map(|(k, v)| KvPair {
                    key: k,
                    value: v,
                    enabled: true,
                })
                .collect(),
            body: String::from_utf8_lossy(&r.body).to_string(),
            error: None,
        }),
        Err(e) => Ok(ScriptResult {
            ok: false,
            status: 0,
            headers: vec![],
            body: String::new(),
            error: Some(e),
        }),
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> RequestCtx {
        let mut query = HashMap::new();
        query.insert("name".into(), "bob".into());
        let mut headers = HashMap::new();
        headers.insert("x-token".into(), "secret".into());
        RequestCtx {
            method: "GET".into(),
            path: "/users/42".into(),
            query,
            headers,
            body: "{\"hello\":\"world\"}".into(),
        }
    }

    #[test]
    fn path_literal_and_params() {
        assert!(match_path("/health", "/health").is_some());
        assert!(match_path("/health", "/nope").is_none());
        let p = match_path("/users/:id", "/users/42").unwrap();
        assert_eq!(p.get("id").unwrap(), "42");
        // extra trailing segment must not match a fixed-length pattern
        assert!(match_path("/users/:id", "/users/42/posts").is_none());
    }

    #[test]
    fn path_wildcards() {
        // trailing wildcard swallows the rest
        assert!(match_path("/assets/*", "/assets/js/app.js").is_some());
        // mid wildcard matches exactly one segment
        assert!(match_path("/a/*/c", "/a/b/c").is_some());
        assert!(match_path("/a/*/c", "/a/b/x/c").is_none());
    }

    #[test]
    fn path_param_is_urldecoded() {
        let p = match_path("/u/:name", "/u/john%20doe").unwrap();
        assert_eq!(p.get("name").unwrap(), "john doe");
    }

    #[test]
    fn method_matching() {
        let stub = Stub {
            id: "1".into(),
            enabled: true,
            method: "ANY".into(),
            path: "/".into(),
            matchers: vec![],
            mode: "static".into(),
            status: 200,
            headers: vec![],
            body: String::new(),
            body_type: "text".into(),
            file_name: String::new(),
            script: String::new(),
            delay_ms: 0,
        };
        assert!(method_matches(&stub, "DELETE"));
        let mut s2 = stub.clone();
        s2.method = "post".into();
        assert!(method_matches(&s2, "POST"));
        assert!(!method_matches(&s2, "GET"));
    }

    fn matcher(target: &str, op: &str, key: &str, value: &str) -> Matcher {
        Matcher {
            target: target.into(),
            op: op.into(),
            key: key.into(),
            value: value.into(),
        }
    }

    #[test]
    fn matcher_ops() {
        let c = ctx();
        let empty = HashMap::new();
        assert!(matcher_passes(&matcher("query", "equals", "name", "bob"), &c, &empty));
        assert!(!matcher_passes(&matcher("query", "equals", "name", "alice"), &c, &empty));
        assert!(matcher_passes(&matcher("header", "exists", "x-token", ""), &c, &empty));
        assert!(matcher_passes(&matcher("body", "contains", "", "world"), &c, &empty));
        assert!(matcher_passes(&matcher("body", "regex", "", "hel+o"), &c, &empty));
        assert!(!matcher_passes(&matcher("query", "exists", "missing", ""), &c, &empty));
    }

    #[test]
    fn body_json_field_matching() {
        let mut c = ctx();
        c.body = r#"{"user":{"name":"bob","age":30},"tags":["a","b"]}"#.into();
        let empty = HashMap::new();
        // nested object field equals
        assert!(matcher_passes(&matcher("body", "equals", "user.name", "bob"), &c, &empty));
        assert!(!matcher_passes(&matcher("body", "equals", "user.name", "alice"), &c, &empty));
        // numeric leaf is stringified
        assert!(matcher_passes(&matcher("body", "equals", "user.age", "30"), &c, &empty));
        // array index
        assert!(matcher_passes(&matcher("body", "equals", "tags.1", "b"), &c, &empty));
        // exists on a present / missing field
        assert!(matcher_passes(&matcher("body", "exists", "user.name", ""), &c, &empty));
        assert!(!matcher_passes(&matcher("body", "exists", "user.email", ""), &c, &empty));
        // non-JSON body with a field path simply doesn't match
        c.body = "plain text".into();
        assert!(!matcher_passes(&matcher("body", "equals", "user.name", "bob"), &c, &empty));
    }

    #[test]
    fn first_match_wins() {
        let mk = |id: &str, path: &str| Stub {
            id: id.into(),
            enabled: true,
            method: "GET".into(),
            path: path.into(),
            matchers: vec![],
            mode: "static".into(),
            status: 200,
            headers: vec![],
            body: String::new(),
            body_type: "text".into(),
            file_name: String::new(),
            script: String::new(),
            delay_ms: 0,
        };
        let cfg = MockConfig {
            stubs: vec![mk("a", "/users/:id"), mk("b", "/users/42")],
            ..Default::default()
        };
        let (stub, params) = select_stub(&cfg, &ctx()).unwrap();
        assert_eq!(stub.id, "a");
        assert_eq!(params.get("id").unwrap(), "42");
    }

    #[test]
    fn disabled_stub_is_skipped() {
        let mut s = Stub {
            id: "a".into(),
            enabled: false,
            method: "GET".into(),
            path: "/users/:id".into(),
            matchers: vec![],
            mode: "static".into(),
            status: 200,
            headers: vec![],
            body: String::new(),
            body_type: "text".into(),
            file_name: String::new(),
            script: String::new(),
            delay_ms: 0,
        };
        let cfg = MockConfig {
            stubs: vec![s.clone()],
            ..Default::default()
        };
        assert!(select_stub(&cfg, &ctx()).is_none());
        s.enabled = true;
        let cfg2 = MockConfig {
            stubs: vec![s],
            ..Default::default()
        };
        assert!(select_stub(&cfg2, &ctx()).is_some());
    }

    #[test]
    fn template_tokens() {
        let c = ctx();
        let mut params = HashMap::new();
        params.insert("id".into(), "42".into());
        assert_eq!(render("{{request.method}}", &c, &params), "GET");
        assert_eq!(render("id={{path.id}}", &c, &params), "id=42");
        assert_eq!(render("q={{request.query.name}}", &c, &params), "q=bob");
        assert_eq!(render("h={{request.header.x-token}}", &c, &params), "h=secret");
        // unknown token left verbatim
        assert_eq!(render("{{nope}}", &c, &params), "{{nope}}");
        // randomInt stays within range
        let v: i64 = render("{{randomInt(1,3)}}", &c, &params).parse().unwrap();
        assert!((1..=3).contains(&v));
    }

    #[test]
    fn script_returns_map() {
        let c = ctx();
        let params = HashMap::new();
        let r = run_script(
            r#"#{ status: 201, headers: #{ "x-test": "1" }, body: req.body }"#,
            &c,
            &params,
        )
        .unwrap();
        assert_eq!(r.status, 201);
        assert_eq!(r.body, c.body.as_bytes());
        assert!(r.headers.iter().any(|(k, v)| k == "x-test" && v == "1"));
    }

    #[test]
    fn script_returns_string() {
        let r = run_script(r#""hello""#, &ctx(), &HashMap::new()).unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(r.body, b"hello");
    }

    #[test]
    fn base64_decode_roundtrips() {
        // "Hello, mock!" base64-encoded, with embedded whitespace + data URL prefix.
        assert_eq!(base64_decode("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(base64_decode("aGVs\nbG8").unwrap(), b"hello"); // no padding + newline
        assert_eq!(
            base64_decode("data:image/png;base64,aGVsbG8=").unwrap(),
            b"hello"
        );
        assert!(base64_decode("not base64 ***").is_err());
    }

    #[test]
    fn base64_body_resolves_to_bytes_with_disposition() {
        let mut s = Stub {
            id: "f".into(),
            enabled: true,
            method: "GET".into(),
            path: "/file".into(),
            matchers: vec![],
            mode: "static".into(),
            status: 200,
            headers: vec![],
            body: "aGVsbG8=".into(),
            body_type: "base64".into(),
            file_name: "greeting.txt".into(),
            script: String::new(),
            delay_ms: 0,
        };
        let r = resolve(&s, &ctx(), &HashMap::new());
        assert_eq!(r.body, b"hello");
        assert!(r
            .headers
            .iter()
            .any(|(k, v)| k.eq_ignore_ascii_case("content-disposition") && v.contains("greeting.txt")));
        // json body type defaults the content-type
        s.body_type = "json".into();
        s.body = "{}".into();
        let r2 = resolve(&s, &ctx(), &HashMap::new());
        assert!(r2
            .headers
            .iter()
            .any(|(k, v)| k.eq_ignore_ascii_case("content-type") && v.contains("application/json")));
    }

    #[test]
    fn script_operation_cap_is_enforced() {
        // An unbounded loop must be terminated by the operations limit.
        let err = run_script("let x = 0; loop { x += 1; }", &ctx(), &HashMap::new());
        assert!(err.is_err());
    }

    #[test]
    fn query_parsing() {
        let q = parse_query(Some("a=1&b=hello%20world&c"));
        assert_eq!(q.get("a").unwrap(), "1");
        assert_eq!(q.get("b").unwrap(), "hello world");
        assert_eq!(q.get("c").unwrap(), "");
    }
}
