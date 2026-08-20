// Redis tool backend.
//
// Connection profiles are persisted to the app-data directory (keeping the
// password out of localStorage), same pattern as rabbit.rs. Every command opens
// a fresh multiplexed connection, SELECTs the requested db, runs its work and
// drops the connection — there is no long-lived pool/registry, mirroring how
// rabbit.rs's AMQP commands (publish/rpc_call) each open their own connection.
// Key browsing always goes through SCAN/HSCAN/SSCAN/ZSCAN (never KEYS/SMEMBERS/
// HGETALL unbounded), so a huge keyspace or a huge collection can't block the
// server or stall the UI.

use redis::Value;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};

// ── Connection profile ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub use_tls: bool,
}

// ── Config persistence ──────────────────────────────────────────────────────

fn configs_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("redis-connections.json"))
        .map_err(|e| format!("Could not resolve app data directory: {e}"))
}

fn load_configs(app: &AppHandle) -> Vec<RedisConnection> {
    let Ok(path) = configs_path(app) else { return Vec::new(); };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_configs(app: &AppHandle, configs: &[RedisConnection]) -> Result<(), String> {
    let path = configs_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(configs).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn find_config(app: &AppHandle, config_id: &str) -> Result<RedisConnection, String> {
    load_configs(app)
        .into_iter()
        .find(|c| c.id == config_id)
        .ok_or_else(|| format!("Connection '{}' not found", config_id))
}

#[tauri::command]
pub async fn redis_list_configs(app: AppHandle) -> Result<Vec<RedisConnection>, String> {
    Ok(load_configs(&app))
}

#[tauri::command]
pub async fn redis_save_config(
    app: AppHandle,
    mut config: RedisConnection,
) -> Result<RedisConnection, String> {
    if config.id.is_empty() {
        config.id = Uuid::new_v4().to_string();
    }
    let mut configs = load_configs(&app);
    if let Some(pos) = configs.iter().position(|c| c.id == config.id) {
        configs[pos] = config.clone();
    } else {
        configs.push(config.clone());
    }
    save_configs(&app, &configs)?;
    Ok(config)
}

#[tauri::command]
pub async fn redis_delete_config(app: AppHandle, config_id: String) -> Result<(), String> {
    let mut configs = load_configs(&app);
    configs.retain(|c| c.id != config_id);
    save_configs(&app, &configs)
}

// ── Connection ────────────────────────────────────────────────────────────

// Db is selected explicitly per-command (SELECT after connecting), not encoded
// in the URL — every command takes its own `db` argument so the UI's db
// switcher and the CLI console always agree on which db they're talking to.
fn redis_url(c: &RedisConnection) -> String {
    let scheme = if c.use_tls { "rediss" } else { "redis" };
    let enc = |s: &str| utf8_percent_encode(s, NON_ALPHANUMERIC).to_string();
    let username = c.username.as_deref().unwrap_or("");
    let password = c.password.as_deref().unwrap_or("");
    let auth = if !password.is_empty() {
        format!("{}:{}@", enc(username), enc(password))
    } else {
        String::new()
    };
    format!("{scheme}://{auth}{}:{}/0", c.host, c.port)
}

async fn connect(c: &RedisConnection, db: u8) -> Result<redis::aio::MultiplexedConnection, String> {
    let client = redis::Client::open(redis_url(c)).map_err(|e| e.to_string())?;
    let mut con = client
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| e.to_string())?;
    if db != 0 {
        redis::cmd("SELECT")
            .arg(db)
            .query_async::<()>(&mut con)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(con)
}

#[tauri::command]
pub async fn redis_test_connection(config: RedisConnection) -> Result<(), String> {
    let mut con = connect(&config, 0).await?;
    let pong: String = redis::cmd("PING")
        .query_async(&mut con)
        .await
        .map_err(|e| e.to_string())?;
    if pong.eq_ignore_ascii_case("PONG") {
        Ok(())
    } else {
        Err(format!("Unexpected PING reply: {pong}"))
    }
}

// ── Overview (INFO + DBSIZE) ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisOverview {
    pub info: String,
    pub dbsize: i64,
}

#[tauri::command]
pub async fn redis_overview(app: AppHandle, config_id: String, db: u8) -> Result<RedisOverview, String> {
    let config = find_config(&app, &config_id)?;
    let mut con = connect(&config, db).await?;
    let info: String = redis::cmd("INFO")
        .query_async(&mut con)
        .await
        .map_err(|e| e.to_string())?;
    let dbsize: i64 = redis::cmd("DBSIZE")
        .query_async(&mut con)
        .await
        .map_err(|e| e.to_string())?;
    Ok(RedisOverview { info, dbsize })
}

// ── Key browsing ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanPage {
    pub cursor: u64,
    pub keys: Vec<String>,
}

#[tauri::command]
pub async fn redis_scan_keys(
    app: AppHandle,
    config_id: String,
    db: u8,
    cursor: u64,
    pattern: String,
    count: i64,
) -> Result<ScanPage, String> {
    let config = find_config(&app, &config_id)?;
    let mut con = connect(&config, db).await?;
    let pattern = if pattern.trim().is_empty() { "*".to_string() } else { pattern };
    let (next, keys): (u64, Vec<String>) = redis::cmd("SCAN")
        .arg(cursor)
        .arg("MATCH")
        .arg(pattern)
        .arg("COUNT")
        .arg(count)
        .query_async(&mut con)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ScanPage { cursor: next, keys })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeySummary {
    pub key: String,
    #[serde(rename = "type")]
    pub kind: String,
    /// Milliseconds until expiry; -1 = no expiry, -2 = key does not exist.
    pub ttl_ms: i64,
}

#[tauri::command]
pub async fn redis_key_summary(
    app: AppHandle,
    config_id: String,
    db: u8,
    keys: Vec<String>,
) -> Result<Vec<KeySummary>, String> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let config = find_config(&app, &config_id)?;
    let mut con = connect(&config, db).await?;
    let mut pipe = redis::pipe();
    for k in &keys {
        pipe.cmd("TYPE").arg(k);
        pipe.cmd("PTTL").arg(k);
    }
    let results: Vec<Value> = pipe.query_async(&mut con).await.map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(keys.len());
    for (i, key) in keys.into_iter().enumerate() {
        let kind = value_to_status_string(results.get(i * 2).cloned().unwrap_or(Value::Nil));
        let ttl_ms = value_to_i64(results.get(i * 2 + 1).cloned().unwrap_or(Value::Nil)).unwrap_or(-1);
        out.push(KeySummary { key, kind, ttl_ms });
    }
    Ok(out)
}

/// Elements fetched per collection key before flagging the result truncated —
/// keeps a single GET/HSCAN/SSCAN/ZSCAN/LRANGE call cheap even against a huge
/// key, instead of pulling the whole thing into memory (HGETALL/SMEMBERS with
/// no bound can block the server and this app on a key with millions of
/// entries).
const VALUE_CAP: i64 = 2000;

// `rename_all` on the enum only renames the variant tag ("String" → "string");
// each struct variant needs its own `rename_all` to camelCase its fields too
// (e.g. `ttl_ms` → `ttlMs`) — verified against serde_json's actual output,
// since the two don't compose automatically.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum KeyValue {
    None,
    #[serde(rename_all = "camelCase")]
    String { value: String, ttl_ms: i64 },
    #[serde(rename_all = "camelCase")]
    Hash { fields: Vec<(String, String)>, ttl_ms: i64, truncated: bool },
    #[serde(rename_all = "camelCase")]
    List { items: Vec<String>, ttl_ms: i64, truncated: bool },
    #[serde(rename_all = "camelCase")]
    Set { members: Vec<String>, ttl_ms: i64, truncated: bool },
    #[serde(rename_all = "camelCase")]
    Zset { members: Vec<(String, f64)>, ttl_ms: i64, truncated: bool },
    #[serde(rename_all = "camelCase")]
    Unsupported { redis_type: String, ttl_ms: i64 },
}

#[tauri::command]
pub async fn redis_get_key(
    app: AppHandle,
    config_id: String,
    db: u8,
    key: String,
) -> Result<KeyValue, String> {
    let config = find_config(&app, &config_id)?;
    let mut con = connect(&config, db).await?;

    let kind: String = redis::cmd("TYPE")
        .arg(&key)
        .query_async(&mut con)
        .await
        .map_err(|e| e.to_string())?;
    if kind == "none" {
        return Ok(KeyValue::None);
    }
    let ttl_ms: i64 = redis::cmd("PTTL")
        .arg(&key)
        .query_async(&mut con)
        .await
        .map_err(|e| e.to_string())?;

    match kind.as_str() {
        "string" => {
            let value: String = redis::cmd("GET")
                .arg(&key)
                .query_async(&mut con)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValue::String { value, ttl_ms })
        }
        "hash" => {
            let (next, flat): (u64, Vec<String>) = redis::cmd("HSCAN")
                .arg(&key)
                .arg(0)
                .arg("COUNT")
                .arg(VALUE_CAP)
                .query_async(&mut con)
                .await
                .map_err(|e| e.to_string())?;
            let fields = flat.chunks(2).filter(|c| c.len() == 2).map(|c| (c[0].clone(), c[1].clone())).collect();
            Ok(KeyValue::Hash { fields, ttl_ms, truncated: next != 0 })
        }
        "list" => {
            let len: i64 = redis::cmd("LLEN")
                .arg(&key)
                .query_async(&mut con)
                .await
                .map_err(|e| e.to_string())?;
            let items: Vec<String> = redis::cmd("LRANGE")
                .arg(&key)
                .arg(0)
                .arg(VALUE_CAP - 1)
                .query_async(&mut con)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValue::List { truncated: len > VALUE_CAP, items, ttl_ms })
        }
        "set" => {
            let (next, members): (u64, Vec<String>) = redis::cmd("SSCAN")
                .arg(&key)
                .arg(0)
                .arg("COUNT")
                .arg(VALUE_CAP)
                .query_async(&mut con)
                .await
                .map_err(|e| e.to_string())?;
            Ok(KeyValue::Set { truncated: next != 0, members, ttl_ms })
        }
        "zset" => {
            let (next, flat): (u64, Vec<String>) = redis::cmd("ZSCAN")
                .arg(&key)
                .arg(0)
                .arg("COUNT")
                .arg(VALUE_CAP)
                .query_async(&mut con)
                .await
                .map_err(|e| e.to_string())?;
            let members = flat
                .chunks(2)
                .filter(|c| c.len() == 2)
                .map(|c| (c[0].clone(), c[1].parse::<f64>().unwrap_or(0.0)))
                .collect();
            Ok(KeyValue::Zset { truncated: next != 0, members, ttl_ms })
        }
        other => Ok(KeyValue::Unsupported { redis_type: other.to_string(), ttl_ms }),
    }
}

#[tauri::command]
pub async fn redis_set_string(
    app: AppHandle,
    config_id: String,
    db: u8,
    key: String,
    value: String,
    ttl_seconds: Option<i64>,
) -> Result<(), String> {
    let config = find_config(&app, &config_id)?;
    let mut con = connect(&config, db).await?;
    let mut cmd = redis::cmd("SET");
    cmd.arg(&key).arg(&value);
    if let Some(t) = ttl_seconds {
        if t > 0 {
            cmd.arg("EX").arg(t);
        }
    }
    cmd.query_async::<()>(&mut con).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_set_ttl(
    app: AppHandle,
    config_id: String,
    db: u8,
    key: String,
    ttl_seconds: Option<i64>,
) -> Result<(), String> {
    let config = find_config(&app, &config_id)?;
    let mut con = connect(&config, db).await?;
    match ttl_seconds {
        Some(t) if t > 0 => redis::cmd("EXPIRE").arg(&key).arg(t).query_async::<()>(&mut con).await,
        _ => redis::cmd("PERSIST").arg(&key).query_async::<()>(&mut con).await,
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_delete_keys(
    app: AppHandle,
    config_id: String,
    db: u8,
    keys: Vec<String>,
) -> Result<i64, String> {
    if keys.is_empty() {
        return Ok(0);
    }
    let config = find_config(&app, &config_id)?;
    let mut con = connect(&config, db).await?;
    let mut cmd = redis::cmd("DEL");
    for k in &keys {
        cmd.arg(k);
    }
    cmd.query_async(&mut con).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_rename_key(
    app: AppHandle,
    config_id: String,
    db: u8,
    old_key: String,
    new_key: String,
) -> Result<(), String> {
    let config = find_config(&app, &config_id)?;
    let mut con = connect(&config, db).await?;
    redis::cmd("RENAMENX")
        .arg(&old_key)
        .arg(&new_key)
        .query_async::<i64>(&mut con)
        .await
        .map_err(|e| e.to_string())
        .and_then(|renamed| {
            if renamed == 1 {
                Ok(())
            } else {
                Err(format!("A key named '{new_key}' already exists"))
            }
        })
}

// ── Generic command execution (CLI console + type-editor mutations) ─────────

/// A JSON-friendly mirror of `redis::Value`, recursive so nested arrays/maps
/// round-trip. Binary payloads are decoded lossily (`String::from_utf8_lossy`)
/// — good enough for a developer tool's CLI/inspector; exact byte-for-byte
/// binary editing is out of scope.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "data")]
pub enum RedisReply {
    Nil,
    Int(i64),
    Bulk(String),
    Status(String),
    Array(Vec<RedisReply>),
    Error(String),
}

fn value_to_reply(v: Value) -> RedisReply {
    match v {
        Value::Nil => RedisReply::Nil,
        Value::Int(i) => RedisReply::Int(i),
        Value::BulkString(b) => RedisReply::Bulk(String::from_utf8_lossy(&b).into_owned()),
        Value::SimpleString(s) => RedisReply::Status(s),
        Value::Okay => RedisReply::Status("OK".to_string()),
        Value::Double(d) => RedisReply::Bulk(d.to_string()),
        Value::Boolean(b) => RedisReply::Int(if b { 1 } else { 0 }),
        Value::VerbatimString { text, .. } => RedisReply::Bulk(text),
        Value::Array(items) | Value::Set(items) => RedisReply::Array(items.into_iter().map(value_to_reply).collect()),
        Value::Map(pairs) => RedisReply::Array(
            pairs
                .into_iter()
                .flat_map(|(k, v)| [value_to_reply(k), value_to_reply(v)])
                .collect(),
        ),
        Value::Push { data, .. } => RedisReply::Array(data.into_iter().map(value_to_reply).collect()),
        Value::BigNumber(n) => RedisReply::Bulk(format!("{n:?}")),
        Value::Attribute { data, .. } => value_to_reply(*data),
        Value::ServerError(e) => RedisReply::Error(e.to_string()),
        // `Value` is #[non_exhaustive] — new RESP3 variants land here rather
        // than failing to compile on a crate upgrade.
        _ => RedisReply::Bulk(String::new()),
    }
}

fn value_to_status_string(v: Value) -> String {
    match value_to_reply(v) {
        RedisReply::Status(s) | RedisReply::Bulk(s) => s,
        RedisReply::Nil => "none".to_string(),
        other => format!("{other:?}"),
    }
}

fn value_to_i64(v: Value) -> Option<i64> {
    match v {
        Value::Int(i) => Some(i),
        Value::BulkString(b) => String::from_utf8_lossy(&b).parse().ok(),
        _ => None,
    }
}

/// Run an arbitrary Redis command against the given db. Backs both the CLI
/// Console (typed by the user) and the key editors' mutate actions (HSET,
/// SADD, LPUSH, ZADD, EXPIRE, …), so the Rust surface doesn't need one
/// bespoke command per Redis command. `SELECT` inside `args` is a no-op in
/// effect — the connection already SELECTs `db` first — so switching db from
/// a typed `SELECT n` here won't stick across calls; use the db switcher.
#[tauri::command]
pub async fn redis_exec(
    app: AppHandle,
    config_id: String,
    db: u8,
    args: Vec<String>,
) -> Result<RedisReply, String> {
    if args.is_empty() {
        return Err("Empty command".to_string());
    }
    let config = find_config(&app, &config_id)?;
    let mut con = connect(&config, db).await?;
    let mut cmd = redis::cmd(&args[0]);
    for a in &args[1..] {
        cmd.arg(a);
    }
    let value: Value = cmd.query_async(&mut con).await.map_err(|e| e.to_string())?;
    Ok(value_to_reply(value))
}
