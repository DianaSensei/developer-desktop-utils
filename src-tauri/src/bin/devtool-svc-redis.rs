// Plugin dịch vụ (tier B) cho Redis Client — Bước 1 của Phase 2 (xem
// docs/decisions/platform-plugin-architecture.md, mục "Việc còn lại").
//
// Port từ src-tauri/src/redis_tool.rs, giữ nguyên HÌNH DẠNG dữ liệu (JSON
// camelCase, ngữ nghĩa SCAN/VALUE_CAP) nhưng ĐỔI chỗ lưu cấu hình kết nối một
// cách có chủ ý — xem "Cách ly dữ liệu" dưới. Khác với bản Tier A đúng hai
// chỗ, cả hai đều là hệ quả của việc chạy như tiến trình riêng:
//   - Không có `AppHandle` → thư mục dữ liệu đọc từ biến môi trường
//     `DEVTOOL_SERVICE_DATA_DIR` mà `service_host.rs::get_or_spawn` set khi
//     spawn — thư mục này ĐÃ được cách ly riêng cho sidecar này
//     (`<app_data>/service-data/devtool-svc-redis`), sidecar không có cách
//     nào biết tới app_data gốc hay thư mục của sidecar khác.
//   - Nhiều lời gọi có thể chồng lên nhau trên CÙNG một sidecar (host demux
//     theo `id`, xem service_host.rs) — main() vì vậy KHÔNG đọc-xử lý-trả lời
//     tuần tự như devtool-svc-echo, mà spawn một task async cho mỗi dòng vào,
//     tất cả ghi ra CÙNG MỘT ống qua một mpsc channel (một task riêng sở hữu
//     stdout, tránh hai response ghi xen kẽ làm hỏng ranh giới dòng).
//
// Bước 1 (xong): CRUD cấu hình kết nối, connect/test, overview (INFO+DBSIZE),
// và duyệt key (scan/summary/get/set/ttl/delete/rename/memory-usage).
//
// Bước 2 (đây): CLI exec (`exec`) + admin (`client-list`/`slowlog`/
// `config-get`/`config-set`) — method một-lần, đi qua `handle()` như mọi
// method Bước 1.
//
// Bước 3 (đây): Pub/Sub qua giao thức STREAM. Method `pubsub-subscribe` KHÔNG
// đi qua `handle()` (một-lần) — nó mở một Pub/Sub connection thật rồi phát
// NHIỀU sự kiện `Response::event(id, …)` cho CÙNG một `request.id`, không bao
// giờ tự kết bằng `done: true` (một subscription sống tới khi bị dừng tay).
// Sự kiện đầu tiên mang `{ "type": "subscribed", "subscriptionId": … }` — một
// id NỘI BỘ do chính sidecar sinh ra, khác `request.id` của khung JSONL (một
// `request.id` ứng với một lần gọi `pubsub-subscribe`; dừng phải đến từ một
// request KHÁC, method `unsubscribe`, mang đúng `subscriptionId` đó). Registry
// nội bộ (`REGISTRY`, `Arc<Mutex<HashMap<subscriptionId, Notify>>>`) theo dõi
// mọi subscription đang chạy để `unsubscribe` có thể dừng đúng cái cần dừng —
// nhiều subscription có thể chạy đồng thời trên cùng sidecar.
//
// `service_stream_stop` (host) gỡ waiter phía HOST, không truyền tín hiệu
// xuống sidecar (xem service_host.rs) — nên task nền của một subscription chỉ
// tự dừng khi chính nó phát hiện KHÔNG CÒN AI ĐỌC PHẢN HỒI: task nền gửi mọi
// sự kiện qua kênh `tx` dùng chung với writer task sở hữu stdout; writer task
// thoát vòng lặp ngay khi một lần ghi ra stdout thất bại (host đã đóng ống —
// ví dụ bị kill) và khi đó DROP `rx`, nên `tx.send(...)` của task nền bắt đầu
// trả lỗi — đó là tín hiệu THẬT duy nhất để tự dừng, không phải một "unsubscribe"
// nào gọi tới. Gọi `unsubscribe` là cách CHỦ ĐỘNG dừng sạch trước khi đóng app.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use futures_util::StreamExt;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use redis::Value;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;
use uuid::Uuid;

const SERVICE_PROTOCOL: u32 = 1;

// ── Khung tin nhắn (giống devtool-svc-echo, lặp lại có chủ ý — xem lý do ở đó) ─

#[derive(Deserialize)]
struct Request {
    protocol: u32,
    id: String,
    #[serde(default)]
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Serialize)]
struct Response {
    protocol: u32,
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    stream: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    done: bool,
}

impl Response {
    fn once(id: String, result: serde_json::Value) -> Self {
        Self { protocol: SERVICE_PROTOCOL, id, result: Some(result), error: None, stream: false, done: false }
    }
    fn ok(id: String) -> Self {
        Self::once(id, serde_json::Value::Null)
    }
    fn err(id: String, message: impl Into<String>) -> Self {
        Self { protocol: SERVICE_PROTOCOL, id, result: None, error: Some(message.into()), stream: false, done: false }
    }
    /// Một-trong-nhiều sự kiện của cùng một lời gọi stream (Pub/Sub) — không
    /// bao giờ đi kèm `done: true` ở sidecar này, khác `tick-stream` của
    /// devtool-svc-echo (stream hữu hạn). Dừng là việc của registry + method
    /// `unsubscribe`, không phải một dòng `done` tự nhiên.
    fn event(id: String, result: serde_json::Value) -> Self {
        Self { protocol: SERVICE_PROTOCOL, id, result: Some(result), error: None, stream: true, done: false }
    }
}

// ── Connection profile — giữ nguyên hình dạng camelCase của redis_tool.rs ────

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

// ── Config persistence ───────────────────────────────────────────────────────
//
// Lưu trong thư mục RIÊNG của sidecar này (`DEVTOOL_SERVICE_DATA_DIR` —
// `<app_data>/service-data/devtool-svc-redis/`), KHÔNG phải cùng chỗ với file
// `redis-connections.json` mà `redis_tool.rs` (Tier A, vẫn đang chạy song
// song) đang dùng. Cách ly bằng thư mục, không phải bằng tên file: sidecar
// này không biết và không có cách nào đọc/ghi ra ngoài thư mục của chính nó.
// Hệ quả: cấu hình lưu qua Tier A hiện tại và qua sidecar này (chưa có
// `plugin.ts` nào gọi tới nó) là HAI bản riêng biệt cho tới khi Bước 4/5 của
// Phase 2 (xem docs/decisions/platform-plugin-architecture.md) chuyển hẳn
// frontend sang sidecar này — lúc đó cần một bước di trú (copy nội dung
// `redis-connections.json` cũ vào `connections.json` trong thư mục mới) để
// không mất cấu hình người dùng đã lưu qua Tier A.

fn app_data_dir() -> Result<PathBuf, String> {
    std::env::var("DEVTOOL_SERVICE_DATA_DIR")
        .map(PathBuf::from)
        .map_err(|_| "DEVTOOL_SERVICE_DATA_DIR không được set — sidecar phải chạy qua service_host.rs".to_string())
}

fn configs_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("connections.json"))
}

fn load_configs() -> Vec<RedisConnection> {
    let Ok(path) = configs_path() else { return Vec::new() };
    std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_configs(configs: &[RedisConnection]) -> Result<(), String> {
    let path = configs_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(configs).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn find_config(config_id: &str) -> Result<RedisConnection, String> {
    load_configs().into_iter().find(|c| c.id == config_id).ok_or_else(|| format!("Connection '{}' not found", config_id))
}

// ── Connection ────────────────────────────────────────────────────────────

fn redis_url(c: &RedisConnection) -> String {
    let scheme = if c.use_tls { "rediss" } else { "redis" };
    let enc = |s: &str| utf8_percent_encode(s, NON_ALPHANUMERIC).to_string();
    let username = c.username.as_deref().unwrap_or("");
    let password = c.password.as_deref().unwrap_or("");
    let auth = if !password.is_empty() { format!("{}:{}@", enc(username), enc(password)) } else { String::new() };
    format!("{scheme}://{auth}{}:{}/0", c.host, c.port)
}

const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(6);

async fn connect(c: &RedisConnection, db: u8) -> Result<redis::aio::MultiplexedConnection, String> {
    let client = redis::Client::open(redis_url(c)).map_err(|e| e.to_string())?;
    let mut con = tokio::time::timeout(CONNECT_TIMEOUT, client.get_multiplexed_async_connection())
        .await
        .map_err(|_| format!("Connection to {}:{} timed out after {}s", c.host, c.port, CONNECT_TIMEOUT.as_secs()))?
        .map_err(|e| e.to_string())?;
    if db != 0 {
        redis::cmd("SELECT").arg(db).query_async::<()>(&mut con).await.map_err(|e| e.to_string())?;
    }
    Ok(con)
}

// ── Overview ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RedisOverview {
    info: String,
    dbsize: i64,
}

// ── Key browsing ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanPage {
    cursor: u64,
    keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeySummary {
    key: String,
    #[serde(rename = "type")]
    kind: String,
    ttl_ms: i64,
}

const VALUE_CAP: i64 = 2000;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum KeyValue {
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
    Stream { entries: Vec<(String, Vec<(String, String)>)>, ttl_ms: i64, truncated: bool },
    #[serde(rename_all = "camelCase")]
    Unsupported { redis_type: String, ttl_ms: i64 },
}

fn value_to_i64(v: Value) -> Option<i64> {
    match v {
        Value::Int(i) => Some(i),
        Value::BulkString(b) => String::from_utf8_lossy(&b).parse().ok(),
        _ => None,
    }
}

// ── Generic command execution (CLI console + type-editor mutations) — Bước 2 ─

/// Port nguyên vẹn từ `redis_tool.rs`'s `RedisReply`/`value_to_reply` — xem
/// đó cho chú thích đầy đủ (binary payload decode lossy có chủ ý, `Value` là
/// `#[non_exhaustive]` nên nhánh `_` bắt các biến thể RESP3 mới thay vì vỡ
/// build khi crate `redis` nâng version).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "data")]
enum RedisReply {
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
            pairs.into_iter().flat_map(|(k, v)| [value_to_reply(k), value_to_reply(v)]).collect(),
        ),
        Value::Push { data, .. } => RedisReply::Array(data.into_iter().map(value_to_reply).collect()),
        Value::BigNumber(n) => RedisReply::Bulk(format!("{n:?}")),
        Value::Attribute { data, .. } => value_to_reply(*data),
        Value::ServerError(e) => RedisReply::Error(e.to_string()),
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

// ── Server admin — Bước 2 ────────────────────────────────────────────────────

/// Port nguyên vẹn từ `redis_tool.rs` — một dòng `SLOWLOG GET` là một mảng
/// lồng `[id, timestamp, duration_micros, [cmd_args…], client_addr, client_name]`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SlowLogEntry {
    id: i64,
    timestamp: i64,
    duration_micros: i64,
    command: Vec<String>,
    client_addr: Option<String>,
    client_name: Option<String>,
}

// ── Pub/Sub — Bước 3 ─────────────────────────────────────────────────────────
//
// Registry nội bộ theo dõi các subscription đang chạy, tách biệt khỏi
// `Waiters` phía service_host.rs (đó là registry của HOST theo `request.id`
// của MỘT LẦN GỌI; đây là registry của SIDECAR theo `subscriptionId` NỘI BỘ,
// sống xuyên suốt nhiều lần gọi — một `unsubscribe` request khác hẳn request
// đã gọi `pubsub-subscribe` mới dừng đúng subscription này).
#[derive(Default)]
struct PubSubRegistry {
    inner: Mutex<HashMap<String, Arc<tokio::sync::Notify>>>,
}

static REGISTRY: OnceLock<PubSubRegistry> = OnceLock::new();

fn registry() -> &'static PubSubRegistry {
    REGISTRY.get_or_init(PubSubRegistry::default)
}

// ── Params helpers ───────────────────────────────────────────────────────────

fn param<T: serde::de::DeserializeOwned>(params: &serde_json::Value, field: &str) -> Result<T, String> {
    params
        .get(field)
        .cloned()
        .ok_or_else(|| format!("thiếu tham số \"{field}\""))
        .and_then(|v| serde_json::from_value(v).map_err(|e| format!("tham số \"{field}\" sai kiểu: {e}")))
}

fn opt_param<T: serde::de::DeserializeOwned>(params: &serde_json::Value, field: &str) -> Option<T> {
    params.get(field).cloned().and_then(|v| serde_json::from_value(v).ok())
}

// ── Method dispatch ───────────────────────────────────────────────────────────

async fn handle(method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
    match method {
        "list-configs" => Ok(serde_json::to_value(load_configs()).unwrap()),

        "save-config" => {
            let mut config: RedisConnection = param(&params, "config")?;
            if config.id.is_empty() {
                config.id = Uuid::new_v4().to_string();
            }
            let mut configs = load_configs();
            if let Some(pos) = configs.iter().position(|c| c.id == config.id) {
                configs[pos] = config.clone();
            } else {
                configs.push(config.clone());
            }
            save_configs(&configs)?;
            Ok(serde_json::to_value(config).unwrap())
        }

        "delete-config" => {
            let config_id: String = param(&params, "configId")?;
            let mut configs = load_configs();
            configs.retain(|c| c.id != config_id);
            save_configs(&configs)?;
            Ok(serde_json::Value::Null)
        }

        "test-connection" => {
            let config: RedisConnection = param(&params, "config")?;
            let mut con = connect(&config, 0).await?;
            let pong: String = redis::cmd("PING").query_async(&mut con).await.map_err(|e| e.to_string())?;
            if pong.eq_ignore_ascii_case("PONG") {
                Ok(serde_json::Value::Null)
            } else {
                Err(format!("Unexpected PING reply: {pong}"))
            }
        }

        "overview" => {
            let config_id: String = param(&params, "configId")?;
            let db: u8 = param(&params, "db")?;
            let config = find_config(&config_id)?;
            let mut con = connect(&config, db).await?;
            let info: String = redis::cmd("INFO").query_async(&mut con).await.map_err(|e| e.to_string())?;
            let dbsize: i64 = redis::cmd("DBSIZE").query_async(&mut con).await.map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(RedisOverview { info, dbsize }).unwrap())
        }

        "scan-keys" => {
            let config_id: String = param(&params, "configId")?;
            let db: u8 = param(&params, "db")?;
            let cursor: u64 = param(&params, "cursor")?;
            let pattern: String = param(&params, "pattern")?;
            let count: i64 = param(&params, "count")?;
            let config = find_config(&config_id)?;
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
            Ok(serde_json::to_value(ScanPage { cursor: next, keys }).unwrap())
        }

        "key-summary" => {
            let config_id: String = param(&params, "configId")?;
            let db: u8 = param(&params, "db")?;
            let keys: Vec<String> = param(&params, "keys")?;
            if keys.is_empty() {
                return Ok(serde_json::to_value(Vec::<KeySummary>::new()).unwrap());
            }
            let config = find_config(&config_id)?;
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
            Ok(serde_json::to_value(out).unwrap())
        }

        "get-key" => {
            let config_id: String = param(&params, "configId")?;
            let db: u8 = param(&params, "db")?;
            let key: String = param(&params, "key")?;
            let config = find_config(&config_id)?;
            let mut con = connect(&config, db).await?;

            let kind: String = redis::cmd("TYPE").arg(&key).query_async(&mut con).await.map_err(|e| e.to_string())?;
            if kind == "none" {
                return Ok(serde_json::to_value(KeyValue::None).unwrap());
            }
            let ttl_ms: i64 = redis::cmd("PTTL").arg(&key).query_async(&mut con).await.map_err(|e| e.to_string())?;

            let value = match kind.as_str() {
                "string" => {
                    let value: String = redis::cmd("GET").arg(&key).query_async(&mut con).await.map_err(|e| e.to_string())?;
                    KeyValue::String { value, ttl_ms }
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
                    KeyValue::Hash { fields, ttl_ms, truncated: next != 0 }
                }
                "list" => {
                    let len: i64 = redis::cmd("LLEN").arg(&key).query_async(&mut con).await.map_err(|e| e.to_string())?;
                    let items: Vec<String> = redis::cmd("LRANGE")
                        .arg(&key)
                        .arg(0)
                        .arg(VALUE_CAP - 1)
                        .query_async(&mut con)
                        .await
                        .map_err(|e| e.to_string())?;
                    KeyValue::List { truncated: len > VALUE_CAP, items, ttl_ms }
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
                    KeyValue::Set { truncated: next != 0, members, ttl_ms }
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
                    KeyValue::Zset { truncated: next != 0, members, ttl_ms }
                }
                "stream" => {
                    let len: i64 = redis::cmd("XLEN").arg(&key).query_async(&mut con).await.map_err(|e| e.to_string())?;
                    let raw: Vec<(String, Vec<String>)> = redis::cmd("XRANGE")
                        .arg(&key)
                        .arg("-")
                        .arg("+")
                        .arg("COUNT")
                        .arg(VALUE_CAP)
                        .query_async(&mut con)
                        .await
                        .map_err(|e| e.to_string())?;
                    let entries = raw
                        .into_iter()
                        .map(|(id, flat)| {
                            let fields = flat.chunks(2).filter(|c| c.len() == 2).map(|c| (c[0].clone(), c[1].clone())).collect();
                            (id, fields)
                        })
                        .collect();
                    KeyValue::Stream { entries, ttl_ms, truncated: len > VALUE_CAP }
                }
                other => KeyValue::Unsupported { redis_type: other.to_string(), ttl_ms },
            };
            Ok(serde_json::to_value(value).unwrap())
        }

        "memory-usage" => {
            let config_id: String = param(&params, "configId")?;
            let db: u8 = param(&params, "db")?;
            let key: String = param(&params, "key")?;
            let config = find_config(&config_id)?;
            let mut con = connect(&config, db).await?;
            let usage: Option<i64> =
                redis::cmd("MEMORY").arg("USAGE").arg(&key).query_async(&mut con).await.map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(usage).unwrap())
        }

        "set-string" => {
            let config_id: String = param(&params, "configId")?;
            let db: u8 = param(&params, "db")?;
            let key: String = param(&params, "key")?;
            let value: String = param(&params, "value")?;
            let ttl_seconds: Option<i64> = opt_param(&params, "ttlSeconds");
            let config = find_config(&config_id)?;
            let mut con = connect(&config, db).await?;
            let mut cmd = redis::cmd("SET");
            cmd.arg(&key).arg(&value);
            if let Some(t) = ttl_seconds {
                if t > 0 {
                    cmd.arg("EX").arg(t);
                }
            }
            cmd.query_async::<()>(&mut con).await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        "set-ttl" => {
            let config_id: String = param(&params, "configId")?;
            let db: u8 = param(&params, "db")?;
            let key: String = param(&params, "key")?;
            let ttl_seconds: Option<i64> = opt_param(&params, "ttlSeconds");
            let config = find_config(&config_id)?;
            let mut con = connect(&config, db).await?;
            match ttl_seconds {
                Some(t) if t > 0 => redis::cmd("EXPIRE").arg(&key).arg(t).query_async::<()>(&mut con).await,
                _ => redis::cmd("PERSIST").arg(&key).query_async::<()>(&mut con).await,
            }
            .map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        "delete-keys" => {
            let config_id: String = param(&params, "configId")?;
            let db: u8 = param(&params, "db")?;
            let keys: Vec<String> = param(&params, "keys")?;
            if keys.is_empty() {
                return Ok(serde_json::json!(0));
            }
            let config = find_config(&config_id)?;
            let mut con = connect(&config, db).await?;
            let mut cmd = redis::cmd("DEL");
            for k in &keys {
                cmd.arg(k);
            }
            let deleted: i64 = cmd.query_async(&mut con).await.map_err(|e| e.to_string())?;
            Ok(serde_json::json!(deleted))
        }

        "rename-key" => {
            let config_id: String = param(&params, "configId")?;
            let db: u8 = param(&params, "db")?;
            let old_key: String = param(&params, "oldKey")?;
            let new_key: String = param(&params, "newKey")?;
            let config = find_config(&config_id)?;
            let mut con = connect(&config, db).await?;
            let renamed: i64 = redis::cmd("RENAMENX")
                .arg(&old_key)
                .arg(&new_key)
                .query_async(&mut con)
                .await
                .map_err(|e| e.to_string())?;
            if renamed == 1 {
                Ok(serde_json::Value::Null)
            } else {
                Err(format!("A key named '{new_key}' already exists"))
            }
        }

        // ── Bước 2: CLI exec + admin ─────────────────────────────────────────

        "exec" => {
            let config_id: String = param(&params, "configId")?;
            let db: u8 = param(&params, "db")?;
            let args: Vec<String> = param(&params, "args")?;
            if args.is_empty() {
                return Err("Empty command".to_string());
            }
            let config = find_config(&config_id)?;
            let mut con = connect(&config, db).await?;
            let mut cmd = redis::cmd(&args[0]);
            for a in &args[1..] {
                cmd.arg(a);
            }
            let value: Value = cmd.query_async(&mut con).await.map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(value_to_reply(value)).unwrap())
        }

        "client-list" => {
            let config_id: String = param(&params, "configId")?;
            let config = find_config(&config_id)?;
            let mut con = connect(&config, 0).await?;
            let raw: String = redis::cmd("CLIENT").arg("LIST").query_async(&mut con).await.map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            for line in raw.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let mut row = BTreeMap::new();
                for kv in line.split_whitespace() {
                    if let Some((k, v)) = kv.split_once('=') {
                        row.insert(k.to_string(), v.to_string());
                    }
                }
                out.push(row);
            }
            let out: Vec<BTreeMap<String, String>> = out;
            Ok(serde_json::to_value(out).unwrap())
        }

        "slowlog" => {
            let config_id: String = param(&params, "configId")?;
            let count: i64 = param(&params, "count")?;
            let config = find_config(&config_id)?;
            let mut con = connect(&config, 0).await?;
            let value: Value = redis::cmd("SLOWLOG").arg("GET").arg(count).query_async(&mut con).await.map_err(|e| e.to_string())?;
            let Value::Array(entries) = value else { return Ok(serde_json::to_value(Vec::<SlowLogEntry>::new()).unwrap()) };
            let mut out = Vec::with_capacity(entries.len());
            for entry in entries {
                let Value::Array(fields) = entry else { continue };
                let id = fields.first().cloned().and_then(value_to_i64).unwrap_or(0);
                let timestamp = fields.get(1).cloned().and_then(value_to_i64).unwrap_or(0);
                let duration_micros = fields.get(2).cloned().and_then(value_to_i64).unwrap_or(0);
                let command = match fields.get(3) {
                    Some(Value::Array(args)) => args.iter().cloned().map(value_to_status_string).collect(),
                    _ => Vec::new(),
                };
                let client_addr = fields.get(4).cloned().map(value_to_status_string).filter(|s| !s.is_empty());
                let client_name = fields.get(5).cloned().map(value_to_status_string).filter(|s| !s.is_empty());
                out.push(SlowLogEntry { id, timestamp, duration_micros, command, client_addr, client_name });
            }
            Ok(serde_json::to_value(out).unwrap())
        }

        "config-get" => {
            let config_id: String = param(&params, "configId")?;
            let pattern: String = param(&params, "pattern")?;
            let config = find_config(&config_id)?;
            let mut con = connect(&config, 0).await?;
            let pattern = if pattern.trim().is_empty() { "*".to_string() } else { pattern };
            let flat: Vec<String> = redis::cmd("CONFIG").arg("GET").arg(pattern).query_async(&mut con).await.map_err(|e| e.to_string())?;
            let out: Vec<(String, String)> = flat.chunks(2).filter(|c| c.len() == 2).map(|c| (c[0].clone(), c[1].clone())).collect();
            Ok(serde_json::to_value(out).unwrap())
        }

        "config-set" => {
            let config_id: String = param(&params, "configId")?;
            let param_name: String = param(&params, "param")?;
            let value: String = param(&params, "value")?;
            let config = find_config(&config_id)?;
            let mut con = connect(&config, 0).await?;
            redis::cmd("CONFIG").arg("SET").arg(&param_name).arg(&value).query_async::<()>(&mut con).await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        // ── Bước 3: Pub/Sub — one-shot phần của method dispatch ──────────────
        // `pubsub-subscribe` (stream) KHÔNG đi qua đây — xem `handle_pubsub_subscribe`.

        "unsubscribe" => {
            let subscription_id: String = param(&params, "subscriptionId")?;
            if let Some(notify) = registry().inner.lock().unwrap().remove(&subscription_id) {
                notify.notify_one();
            }
            Ok(serde_json::Value::Null)
        }

        "publish" => {
            let config_id: String = param(&params, "configId")?;
            let channel: String = param(&params, "channel")?;
            let message: String = param(&params, "message")?;
            let config = find_config(&config_id)?;
            let mut con = connect(&config, 0).await?;
            let n: i64 = redis::cmd("PUBLISH").arg(&channel).arg(&message).query_async(&mut con).await.map_err(|e| e.to_string())?;
            Ok(serde_json::json!(n))
        }

        other => Err(format!("method không hỗ trợ: \"{other}\"")),
    }
}

/// `pubsub-subscribe` là method STREAM — không trả một `Ok(Value)` đơn lẻ như
/// `handle()`, vì nó phải phát nhiều sự kiện cho cùng một `request.id` theo
/// thời gian. Mở kết nối Pub/Sub thật (`get_async_pubsub`, giống
/// `redis_pubsub_subscribe` cũ ở `redis_tool.rs`), đăng ký subscription vào
/// `REGISTRY`, gửi một sự kiện "subscribed" mang `subscriptionId` NỘI BỘ rồi
/// spawn một task nền phát mỗi message Pub/Sub nhận được như một sự kiện
/// riêng — task đó tự dừng khi `tx.send(...)` bắt đầu lỗi (writer task đã
/// thoát vì ghi stdout lỗi), hoặc khi `unsubscribe` báo `notify`.
async fn handle_pubsub_subscribe(id: String, params: serde_json::Value, tx: mpsc::UnboundedSender<Response>) {
    let channels: Vec<String> = opt_param(&params, "channels").unwrap_or_default();
    let patterns: Vec<String> = opt_param(&params, "patterns").unwrap_or_default();
    if channels.is_empty() && patterns.is_empty() {
        let _ = tx.send(Response::err(id, "Provide at least one channel or pattern".to_string()));
        return;
    }
    let config_id: String = match param(&params, "configId") {
        Ok(v) => v,
        Err(e) => {
            let _ = tx.send(Response::err(id, e));
            return;
        }
    };
    let config = match find_config(&config_id) {
        Ok(c) => c,
        Err(e) => {
            let _ = tx.send(Response::err(id, e));
            return;
        }
    };
    let client = match redis::Client::open(redis_url(&config)) {
        Ok(c) => c,
        Err(e) => {
            let _ = tx.send(Response::err(id, e.to_string()));
            return;
        }
    };
    let mut pubsub = match tokio::time::timeout(CONNECT_TIMEOUT, client.get_async_pubsub()).await {
        Ok(Ok(p)) => p,
        Ok(Err(e)) => {
            let _ = tx.send(Response::err(id, e.to_string()));
            return;
        }
        Err(_) => {
            let _ = tx.send(Response::err(
                id,
                format!("Connection to {}:{} timed out after {}s", config.host, config.port, CONNECT_TIMEOUT.as_secs()),
            ));
            return;
        }
    };

    for ch in &channels {
        if let Err(e) = pubsub.subscribe(ch).await {
            let _ = tx.send(Response::err(id, e.to_string()));
            return;
        }
    }
    for pat in &patterns {
        if let Err(e) = pubsub.psubscribe(pat).await {
            let _ = tx.send(Response::err(id, e.to_string()));
            return;
        }
    }

    let subscription_id = Uuid::new_v4().to_string();
    let notify = Arc::new(tokio::sync::Notify::new());
    registry().inner.lock().unwrap().insert(subscription_id.clone(), notify.clone());

    if tx
        .send(Response::event(id.clone(), serde_json::json!({ "type": "subscribed", "subscriptionId": subscription_id })))
        .is_err()
    {
        registry().inner.lock().unwrap().remove(&subscription_id);
        return;
    }

    tokio::spawn(async move {
        let mut stream = pubsub.into_on_message();
        loop {
            tokio::select! {
                _ = notify.notified() => break,
                next = stream.next() => match next {
                    Some(msg) => {
                        let event = serde_json::json!({
                            "type": "message",
                            "channel": msg.get_channel_name(),
                            "pattern": msg.get_pattern::<String>().ok(),
                            "payload": msg.get_payload::<String>().unwrap_or_default(),
                        });
                        if tx.send(Response::event(id.clone(), event)).is_err() {
                            // Writer task đã thoát (ghi stdout lỗi) — không còn
                            // ai đọc phản hồi nữa, tự dừng thay vì trôi vô hạn.
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
        registry().inner.lock().unwrap().remove(&subscription_id);
    });
}

// ── main: đọc stdin, spawn một task async cho mỗi dòng, một task khác sở hữu
//    stdout để mọi phản hồi ghi ra không bị xen lẫn giữa hai task. ──────────

#[tokio::main]
async fn main() {
    let (tx, mut rx) = mpsc::unbounded_channel::<Response>();

    let writer = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(response) = rx.recv().await {
            let Ok(json) = serde_json::to_string(&response) else { continue };
            if stdout.write_all(json.as_bytes()).await.is_err() { break; }
            if stdout.write_all(b"\n").await.is_err() { break; }
            if stdout.flush().await.is_err() { break; }
        }
    });

    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let tx = tx.clone();
        tokio::spawn(async move {
            handle_line(&line, &tx).await;
        });
    }

    drop(tx);
    let _ = writer.await;
    // Lưu ý: nếu có subscription Pub/Sub đang chạy, task nền của nó vẫn giữ
    // một bản sao `tx` nên `writer` (và do đó main()) sẽ KHÔNG tự thoát chỉ vì
    // stdin đóng — `service_host.rs` spawn sidecar với `kill_on_drop(true)`
    // (xem đó), nên tiến trình vẫn bị buộc dừng khi host kill/drop child
    // handle bất kể trạng thái kênh nội bộ này.
}

/// `pubsub-subscribe` KHÔNG đi qua `handle()` (một-lần) — nó cần giữ `tx` để
/// phát nhiều sự kiện theo thời gian, xem `handle_pubsub_subscribe`. Mọi
/// method khác vẫn đi qua đường một-lần cũ, không đổi hành vi.
async fn handle_line(line: &str, tx: &mpsc::UnboundedSender<Response>) {
    let req: Request = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => {
            let _ = tx.send(Response::err(String::new(), format!("JSON không hợp lệ: {e}")));
            return;
        }
    };
    if req.protocol != SERVICE_PROTOCOL {
        let _ = tx.send(Response::err(req.id, format!("lệch protocol: client {}, sidecar {SERVICE_PROTOCOL}", req.protocol)));
        return;
    }
    if req.method == "pubsub-subscribe" {
        handle_pubsub_subscribe(req.id, req.params, tx.clone()).await;
        return;
    }
    let response = match handle(&req.method, req.params).await {
        Ok(value) if value.is_null() => Response::ok(req.id),
        Ok(value) => Response::once(req.id, value),
        Err(e) => Response::err(req.id, e),
    };
    let _ = tx.send(response);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn(host: &str, port: u16, username: Option<&str>, password: Option<&str>, use_tls: bool) -> RedisConnection {
        RedisConnection {
            id: "id".to_string(),
            name: "name".to_string(),
            host: host.to_string(),
            port,
            username: username.map(str::to_string),
            password: password.map(str::to_string),
            use_tls,
        }
    }

    // Mười test đầu là bằng chứng safety-net: y hệt characterization test của
    // redis_tool.rs (giữ nguyên tên và nội dung có chủ ý — đây là bằng chứng
    // hành vi không đổi khi port sang tiến trình riêng).

    #[test]
    fn redis_url_plain_no_auth() {
        assert_eq!(redis_url(&conn("localhost", 6379, None, None, false)), "redis://localhost:6379/0");
    }

    #[test]
    fn redis_url_uses_rediss_scheme_for_tls() {
        assert_eq!(redis_url(&conn("localhost", 6380, None, None, true)), "rediss://localhost:6380/0");
    }

    #[test]
    fn redis_url_includes_auth_when_password_set() {
        assert_eq!(
            redis_url(&conn("localhost", 6379, Some("alice"), Some("secret"), false)),
            "redis://alice:secret@localhost:6379/0"
        );
    }

    #[test]
    fn redis_url_omits_auth_when_password_empty() {
        assert_eq!(redis_url(&conn("localhost", 6379, Some("alice"), None, false)), "redis://localhost:6379/0");
    }

    #[test]
    fn redis_url_percent_encodes_special_chars_in_credentials() {
        assert_eq!(
            redis_url(&conn("localhost", 6379, Some("a b"), Some("p@ss/word"), false)),
            "redis://a%20b:p%40ss%2Fword@localhost:6379/0"
        );
    }

    #[test]
    fn value_to_status_string_prefers_status_or_bulk_text() {
        assert_eq!(value_to_status_string(Value::Okay), "OK");
        assert_eq!(value_to_status_string(Value::BulkString(b"abc".to_vec())), "abc");
    }

    #[test]
    fn value_to_status_string_nil_is_none_literal() {
        assert_eq!(value_to_status_string(Value::Nil), "none");
    }

    #[test]
    fn value_to_i64_parses_int_variant() {
        assert_eq!(value_to_i64(Value::Int(123)), Some(123));
    }

    #[test]
    fn value_to_i64_parses_numeric_bulk_string() {
        assert_eq!(value_to_i64(Value::BulkString(b"456".to_vec())), Some(456));
    }

    #[test]
    fn value_to_i64_none_for_non_numeric_bulk_string() {
        assert_eq!(value_to_i64(Value::BulkString(b"not-a-number".to_vec())), None);
    }

    // ── Test riêng cho phần hạ tầng chỉ có ở sidecar (không có trong redis_tool.rs) ─

    #[test]
    fn app_data_dir_bao_loi_ro_rang_khi_thieu_bien_moi_truong() {
        // Không set biến môi trường trong test này — nhưng test khác trong
        // cùng binary CÓ THỂ chạy song song và set nó (không có ở đây), nên chỉ
        // assert khi biến thực sự vắng mặt để tránh test chập chờn.
        if std::env::var("DEVTOOL_SERVICE_DATA_DIR").is_err() {
            assert!(app_data_dir().unwrap_err().contains("DEVTOOL_SERVICE_DATA_DIR"));
        }
    }

    #[tokio::test]
    async fn method_khong_ho_tro_tra_ve_loi_khong_phai_panic() {
        let res = handle("khong-ton-tai", serde_json::Value::Null).await;
        assert!(res.unwrap_err().contains("khong-ton-tai"));
    }

    #[tokio::test]
    async fn thieu_tham_so_bat_buoc_tra_ve_loi_ro_rang() {
        let res = handle("overview", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("configId"));
    }

    #[tokio::test]
    async fn config_id_khong_ton_tai_tra_ve_loi_ro_rang() {
        // configs_path() phụ thuộc DEVTOOL_SERVICE_DATA_DIR; nếu thiếu, find_config
        // vẫn phải trả lỗi rõ ràng (load_configs() rơi về rỗng), không panic.
        let res = handle("overview", serde_json::json!({ "configId": "khong-ton-tai", "db": 0 })).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn delete_keys_rong_tra_ve_khong_can_config() {
        // Nhánh sớm-thoát khi `keys` rỗng — không cần configId hợp lệ, y hệt
        // hành vi gốc `redis_delete_keys` (kiểm bằng cách KHÔNG set configId).
        let res = handle("delete-keys", serde_json::json!({ "configId": "x", "db": 0, "keys": [] })).await;
        assert_eq!(res.unwrap(), serde_json::json!(0));
    }

    #[tokio::test]
    async fn key_summary_rong_tra_ve_mang_rong_khong_can_config() {
        let res = handle("key-summary", serde_json::json!({ "configId": "x", "db": 0, "keys": [] })).await;
        assert_eq!(res.unwrap(), serde_json::json!([]));
    }

    /// `handle_line` giờ trả về qua kênh `tx` thay vì trực tiếp (cần vậy để
    /// `pubsub-subscribe` phát nhiều sự kiện) — test dựng một kênh riêng và
    /// đọc lại đúng một `Response` cho các method một-lần.
    async fn call_handle_line(line: &str) -> Response {
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_line(line, &tx).await;
        drop(tx);
        rx.recv().await.expect("handle_line phải gửi đúng một response cho method một-lần")
    }

    #[tokio::test]
    async fn handle_line_tra_null_cho_ket_qua_null_thanh_response_khong_result() {
        let line = serde_json::json!({
            "protocol": SERVICE_PROTOCOL, "id": "1", "method": "delete-config",
            "params": { "configId": "khong-quan-trong" },
        })
        .to_string();
        // delete-config không cần config tồn tại (retain là no-op nếu không có) —
        // nhưng vẫn cần DEVTOOL_SERVICE_DATA_DIR để ghi lại file, nên test này chỉ
        // xác nhận KHÔNG panic và trả về một Response hợp lệ (lỗi hay không tuỳ
        // môi trường chạy test có set biến hay không).
        let response = call_handle_line(&line).await;
        assert_eq!(response.id, "1");
        assert_eq!(response.protocol, SERVICE_PROTOCOL);
    }

    #[tokio::test]
    async fn lech_protocol_bi_tu_choi_truoc_khi_cham_toi_method() {
        let line = serde_json::json!({ "protocol": 99, "id": "1", "method": "list-configs", "params": null }).to_string();
        let response = call_handle_line(&line).await;
        assert!(response.error.unwrap().contains("lệch protocol"));
    }

    #[tokio::test]
    async fn json_hong_khong_panic_tra_ve_loi() {
        let response = call_handle_line("{khong-phai-json").await;
        assert!(response.error.unwrap().contains("JSON không hợp lệ"));
    }

    // ── Bước 2: value_to_reply / RedisReply — port test từ redis_tool.rs ──────

    #[test]
    fn value_to_reply_maps_scalars() {
        assert!(matches!(value_to_reply(Value::Nil), RedisReply::Nil));
        assert!(matches!(value_to_reply(Value::Int(42)), RedisReply::Int(42)));
        assert!(matches!(value_to_reply(Value::Okay), RedisReply::Status(s) if s == "OK"));
        match value_to_reply(Value::SimpleString("PONG".to_string())) {
            RedisReply::Status(s) => assert_eq!(s, "PONG"),
            other => panic!("unexpected {other:?}"),
        }
        match value_to_reply(Value::BulkString(b"hello".to_vec())) {
            RedisReply::Bulk(s) => assert_eq!(s, "hello"),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn value_to_reply_maps_boolean_to_int() {
        assert!(matches!(value_to_reply(Value::Boolean(true)), RedisReply::Int(1)));
        assert!(matches!(value_to_reply(Value::Boolean(false)), RedisReply::Int(0)));
    }

    #[test]
    fn value_to_reply_maps_array_recursively() {
        let v = Value::Array(vec![Value::Int(1), Value::BulkString(b"two".to_vec())]);
        match value_to_reply(v) {
            RedisReply::Array(items) => {
                assert_eq!(items.len(), 2);
                assert!(matches!(items[0], RedisReply::Int(1)));
                match &items[1] {
                    RedisReply::Bulk(s) => assert_eq!(s, "two"),
                    other => panic!("unexpected {other:?}"),
                }
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn value_to_reply_flattens_map_into_kv_pairs() {
        let v = Value::Map(vec![(Value::BulkString(b"k".to_vec()), Value::Int(1))]);
        match value_to_reply(v) {
            RedisReply::Array(items) => assert_eq!(items.len(), 2),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn value_to_reply_unwraps_attribute() {
        let v = Value::Attribute { data: Box::new(Value::Int(7)), attributes: vec![] };
        assert!(matches!(value_to_reply(v), RedisReply::Int(7)));
    }

    #[test]
    fn value_to_status_string_falls_back_to_debug_for_other_variants() {
        let s = value_to_status_string(Value::Int(5));
        assert_eq!(s, format!("{:?}", RedisReply::Int(5)));
    }

    #[tokio::test]
    async fn exec_voi_args_rong_tra_ve_loi_khong_can_config() {
        let res = handle("exec", serde_json::json!({ "configId": "x", "db": 0, "args": [] })).await;
        assert_eq!(res.unwrap_err(), "Empty command");
    }

    #[tokio::test]
    async fn exec_thieu_tham_so_tra_ve_loi_ro_rang() {
        let res = handle("exec", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("configId"));
    }

    #[tokio::test]
    async fn slowlog_thieu_tham_so_tra_ve_loi_ro_rang() {
        let res = handle("slowlog", serde_json::json!({ "configId": "x" })).await;
        assert!(res.unwrap_err().contains("count"));
    }

    #[tokio::test]
    async fn config_get_thieu_tham_so_tra_ve_loi_ro_rang() {
        let res = handle("config-get", serde_json::json!({ "configId": "x" })).await;
        assert!(res.unwrap_err().contains("pattern"));
    }

    // ── Bước 3: registry + validation của pubsub-subscribe/unsubscribe ───────

    #[tokio::test]
    async fn unsubscribe_id_khong_ton_tai_van_ok_khong_panic() {
        // Gỡ một subscriptionId chưa từng đăng ký là no-op (giống bản Tier A) —
        // không có gì để dừng nhưng vẫn phải trả Ok, không lỗi/panic.
        let res = handle("unsubscribe", serde_json::json!({ "subscriptionId": "khong-ton-tai" })).await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn unsubscribe_thao_dung_entry_khoi_registry_va_bao_notify() {
        let id = "sub-test-1".to_string();
        let notify = Arc::new(tokio::sync::Notify::new());
        registry().inner.lock().unwrap().insert(id.clone(), notify.clone());

        let notified = tokio::spawn({
            let notify = notify.clone();
            async move { notify.notified().await }
        });

        let res = handle("unsubscribe", serde_json::json!({ "subscriptionId": id })).await;
        assert!(res.is_ok());
        // notify_one() đã được gọi bên trong handle("unsubscribe", …) — task
        // đang chờ notified() phải hoàn tất, không treo.
        tokio::time::timeout(std::time::Duration::from_secs(2), notified).await.expect("notify phải bắn").unwrap();
        assert!(!registry().inner.lock().unwrap().contains_key(&id));
    }

    #[tokio::test]
    async fn pubsub_subscribe_khong_channel_khong_pattern_bao_loi_ro_rang() {
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_pubsub_subscribe("req-1".to_string(), serde_json::json!({ "channels": [], "patterns": [] }), tx).await;
        let response = rx.recv().await.expect("phải gửi đúng một response lỗi");
        assert_eq!(response.id, "req-1");
        assert!(response.error.unwrap().contains("channel or pattern"));
        assert!(!response.stream);
    }

    #[tokio::test]
    async fn pubsub_subscribe_thieu_config_id_bao_loi_ro_rang() {
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_pubsub_subscribe("req-2".to_string(), serde_json::json!({ "channels": ["ch"] }), tx).await;
        let response = rx.recv().await.expect("phải gửi đúng một response lỗi");
        assert!(response.error.unwrap().contains("configId"));
    }

    #[tokio::test]
    async fn pubsub_subscribe_config_khong_ton_tai_bao_loi_ro_rang() {
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_pubsub_subscribe(
            "req-3".to_string(),
            serde_json::json!({ "channels": ["ch"], "configId": "khong-ton-tai-chac-chan" }),
            tx,
        )
        .await;
        let response = rx.recv().await.expect("phải gửi đúng một response lỗi");
        assert!(response.error.is_some());
    }
}
