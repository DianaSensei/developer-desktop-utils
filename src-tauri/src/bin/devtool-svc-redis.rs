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
// Bước 1 chỉ port: CRUD cấu hình kết nối, connect/test, overview (INFO+DBSIZE),
// và duyệt key (scan/summary/get/set/ttl/delete/rename/memory-usage). CLI
// exec, admin (client-list/slowlog/config get-set), và Pub/Sub streaming là
// Bước 2/3 — vẫn nằm ở redis_tool.rs cho tới lúc đó.

use std::path::PathBuf;

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

fn value_to_status_string(v: Value) -> String {
    match v {
        Value::Nil => "none".to_string(),
        Value::SimpleString(s) => s,
        Value::Okay => "OK".to_string(),
        Value::BulkString(b) => String::from_utf8_lossy(&b).into_owned(),
        other => format!("{other:?}"),
    }
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

        other => Err(format!("method không hỗ trợ: \"{other}\"")),
    }
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
            let response = handle_line(&line).await;
            let _ = tx.send(response);
        });
    }

    drop(tx);
    let _ = writer.await;
}

async fn handle_line(line: &str) -> Response {
    let req: Request = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => return Response::err(String::new(), format!("JSON không hợp lệ: {e}")),
    };
    if req.protocol != SERVICE_PROTOCOL {
        return Response::err(req.id, format!("lệch protocol: client {}, sidecar {SERVICE_PROTOCOL}", req.protocol));
    }
    match handle(&req.method, req.params).await {
        Ok(value) if value.is_null() => Response::ok(req.id),
        Ok(value) => Response::once(req.id, value),
        Err(e) => Response::err(req.id, e),
    }
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
        let response = handle_line(&line).await;
        assert_eq!(response.id, "1");
        assert_eq!(response.protocol, SERVICE_PROTOCOL);
    }

    #[tokio::test]
    async fn lech_protocol_bi_tu_choi_truoc_khi_cham_toi_method() {
        let line = serde_json::json!({ "protocol": 99, "id": "1", "method": "list-configs", "params": null }).to_string();
        let response = handle_line(&line).await;
        assert!(response.error.unwrap().contains("lệch protocol"));
    }

    #[tokio::test]
    async fn json_hong_khong_panic_tra_ve_loi() {
        let response = handle_line("{khong-phai-json").await;
        assert!(response.error.unwrap().contains("JSON không hợp lệ"));
    }
}
