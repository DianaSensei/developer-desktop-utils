// Plugin dịch vụ (tier B) cho RabbitMQ Client — Bước 1+2 gộp của Phase 2 (xem
// docs/decisions/platform-plugin-architecture.md, mục "Ba tier" và "Cách ly
// dữ liệu"). Port từ src-tauri/src/rabbit.rs, giữ nguyên HÌNH DẠNG dữ liệu
// (JSON camelCase, struct `RabbitConnection`/`PublishProps`/`PublishOutcome`/
// ...) nhưng KHÔNG đụng file đó — nó vẫn chạy production (Tier A) song song
// cho tới Bước 4/5 cắt hẳn, đúng mẫu `devtool-svc-redis.rs`/
// `devtool-svc-container.rs` đã làm cho Redis/Container.
//
// Khác với bản Tier A (`rabbit.rs`) đúng những chỗ là hệ quả của việc chạy
// như tiến trình riêng, không có `AppHandle`:
//   - Config CRUD đọc/ghi `<DEVTOOL_SERVICE_DATA_DIR>/connections.json` (biến
//     môi trường `service_host.rs::get_or_spawn` set khi spawn) thay vì
//     `plugin_data::plugin_data_dir(app, "rabbit-client")` — thư mục này ĐÃ
//     được cách ly riêng cho sidecar này
//     (`<app_data>/service-data/devtool-svc-rabbit/`), KHÁC
//     `plugin-data/rabbit-client/connections.json` mà Tier A dùng, có chủ ý —
//     xem "Cách ly dữ liệu" trong ADR. KHÔNG di trú dữ liệu cũ: chỉ là cấu
//     hình kết nối (host/port/thông tin đăng nhập/TLS), người dùng tự nhập
//     lại được.
//   - main() spawn một task async cho mỗi dòng stdin vào, một task riêng sở
//     hữu stdout qua kênh mpsc — y hệt cấu trúc `devtool-svc-redis.rs`/
//     `devtool-svc-container.rs`, vì nhiều lời gọi có thể chồng lên nhau trên
//     CÙNG một sidecar (host demux theo `id`, xem `service_host.rs`).
//
// Bước 1+2 (đây, gộp vì RabbitMQ nhỏ hơn Redis/Container — chỉ 12 command
// tổng): config CRUD, `amqp-test`, `rpc-call`, `publish` (full-feature:
// properties + mandatory + publisher confirms), `amqp-queues-info`/
// `amqp-exchanges-info` (passive declare cho count, dùng ở chế độ
// `amqp_only`), `amqp-declare-queue`/`amqp-declare-exchange`/`amqp-bind-queue`.
// Mọi method ở bước này là MỘT-LẦN (đi qua `handle()`), không có method
// stream nào.
//
// Bước 3 (đây): `consume-start` (method STREAM) + `consume-stop` (một-lần).
// Port từ `rabbit_consume_start`/`rabbit_consume_stop` của rabbit.rs (dòng
// ~556-659) — giữ NGUYÊN logic ba `ack_mode` ("peek"/"consume"/"respond") và
// việc giữ `_keep_conn`/`channel` sống trong task nền suốt vòng đời consumer.
// Giao thức stream mirror `handle_logs_start` của `devtool-svc-container.rs`
// (chính nó mirror `handle_pubsub_subscribe` của `devtool-svc-redis.rs`): sự
// kiện đầu `{"type":"subscribed","subscriptionId":...}`, mỗi message nhận
// được là `{"type":"message", ...ConsumedMessage}`, lỗi giữa chừng qua
// `send_stream_error` (SỰ KIỆN STREAM bình thường) KHÔNG BAO GIỜ dùng
// `Response::err` — `service_host.rs::dispatch()` âm thầm bỏ payload của một
// response mang `error: Some` cho một `Waiter::Stream`. Đăng ký/gỡ đăng ký
// dùng CÙNG một `StreamRegistry` kiểu `Arc<Mutex<HashMap<id, Notify>>>` như
// hai sidecar kia — subscriptionId do chính sidecar sinh (`Uuid::new_v4()`)
// nên một registry chung là đủ dù sau này có thêm method stream khác.

use base64::Engine;
use futures_util::StreamExt;
use lapin::options::{
    BasicAckOptions, BasicConsumeOptions, BasicPublishOptions, BasicQosOptions, ConfirmSelectOptions,
    ExchangeDeclareOptions, QueueBindOptions, QueueDeclareOptions,
};
use lapin::tcp::{OwnedIdentity, OwnedTLSConfig};
use lapin::types::{AMQPValue, FieldTable};
use lapin::{BasicProperties, Connection, ConnectionProperties, ExchangeKind};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;
use uuid::Uuid;

const SERVICE_PROTOCOL: u32 = 1;

// ── Khung tin nhắn (giống devtool-svc-redis/devtool-svc-container, lặp lại có
//    chủ ý — xem lý do ở đó) ───────────────────────────────────────────────

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
    /// Một-trong-nhiều sự kiện của cùng một lời gọi stream (`consume-start`) —
    /// không bao giờ đi kèm `done: true`: một consumer sống tới khi bị dừng
    /// tay bằng `consume-stop`, giống `logs-start`/`stats-start` của
    /// `devtool-svc-container.rs`.
    fn event(id: String, result: serde_json::Value) -> Self {
        Self { protocol: SERVICE_PROTOCOL, id, result: Some(result), error: None, stream: true, done: false }
    }
}

// ── Connection profile — giữ nguyên hình dạng camelCase của rabbit.rs ───────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RabbitConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub vhost: String,
    pub username: String,
    pub password: String,
    pub use_tls: bool,
    /// AMQP port (default 5672) — used by publish / consume / request-response.
    #[serde(default = "default_amqp_port")]
    pub amqp_port: u16,
    /// Extra AMQP endpoints to try, in order, if the primary host can't be reached
    /// (HA clusters / no load balancer). Each entry is `host` or `host:port`;
    /// without a port it falls back to `amqp_port`. The frontend sends `null` when
    /// empty, so accept that as an empty list (plain `default` only covers a
    /// *missing* field, not an explicit `null`).
    #[serde(default, deserialize_with = "null_as_default")]
    pub extra_hosts: Vec<String>,
    /// Custom CA certificate (PEM) to trust — for self-signed / private brokers.
    #[serde(default)]
    pub tls_ca_pem: Option<String>,
    /// Client identity for mutual-TLS: a PKCS#12 bundle, base64-encoded.
    #[serde(default)]
    pub client_pkcs12_b64: Option<String>,
    #[serde(default)]
    pub client_pkcs12_password: Option<String>,
    /// AMQP heartbeat interval in seconds (omitted → server default).
    #[serde(default)]
    pub heartbeat: Option<u16>,
    /// Client-provided connection name (shows in the broker's Connections list).
    #[serde(default)]
    pub connection_name: Option<String>,
    /// AMQP-only mode: the broker exposes no management HTTP API, so the tool
    /// works off typed queue/exchange names (passive declare for counts) and
    /// declares/binds over AMQP instead of the REST API.
    #[serde(default)]
    pub amqp_only: bool,
}

fn default_amqp_port() -> u16 {
    5672
}

/// Deserialize a value that may be `null` into `T::default()` (e.g. a `null` JSON
/// array field → an empty `Vec`). Plain `#[serde(default)]` only handles a field
/// that is *absent*, not one explicitly set to `null`.
fn null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcReply {
    pub payload: String,
    pub correlation_id: Option<String>,
    pub content_type: Option<String>,
}

/// AMQP message properties supplied by the publish form.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishProps {
    pub content_type: Option<String>,
    pub content_encoding: Option<String>,
    pub correlation_id: Option<String>,
    pub reply_to: Option<String>,
    pub message_id: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub app_id: Option<String>,
    pub user_id: Option<String>,
    pub expiration: Option<String>,
    pub priority: Option<u8>,
    pub persistent: Option<bool>,
    pub headers: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishOutcome {
    pub confirmed: bool,
    pub routed: bool,
    pub return_reason: Option<String>,
}

/// Port nguyên vẹn từ `rabbit.rs::ConsumedMessage` — một message nhận được từ
/// `consume-start`, phát như sự kiện `{"type":"message", ...}`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsumedMessage {
    pub payload: String,
    pub exchange: String,
    pub routing_key: String,
    pub redelivered: bool,
    pub delivery_tag: u64,
    pub correlation_id: Option<String>,
    pub content_type: Option<String>,
    pub message_id: Option<String>,
    pub headers: BTreeMap<String, String>,
}

/// Port nguyên vẹn từ `rabbit.rs::ReplyOptions` — cấu hình auto-reply cho
/// `ackMode: "respond"` (tool đóng vai RPC server).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyOptions {
    /// Reply with the request's own body instead of `payload`.
    pub echo: bool,
    pub payload: String,
    pub content_type: Option<String>,
}

// ── Config persistence ───────────────────────────────────────────────────────
//
// Lưu trong thư mục RIÊNG của sidecar này (`DEVTOOL_SERVICE_DATA_DIR` —
// `<app_data>/service-data/devtool-svc-rabbit/`), KHÁC
// `plugin-data/rabbit-client/connections.json` mà `rabbit.rs` (Tier A, vẫn
// đang chạy song song) đang dùng. Cách ly bằng thư mục, không phải bằng tên
// file — xem module doc comment ở trên và ADR mục "Cách ly dữ liệu".

fn app_data_dir() -> Result<PathBuf, String> {
    std::env::var("DEVTOOL_SERVICE_DATA_DIR")
        .map(PathBuf::from)
        .map_err(|_| "DEVTOOL_SERVICE_DATA_DIR không được set — sidecar phải chạy qua service_host.rs".to_string())
}

fn configs_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("connections.json"))
}

fn load_configs() -> Vec<RabbitConnection> {
    let Ok(path) = configs_path() else { return Vec::new() };
    std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_configs(configs: &[RabbitConnection]) -> Result<(), String> {
    let path = configs_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(configs).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn find_config(config_id: &str) -> Result<RabbitConnection, String> {
    load_configs().into_iter().find(|c| c.id == config_id).ok_or_else(|| format!("Connection '{}' not found", config_id))
}

// ── Params helpers — giống devtool-svc-redis.rs / devtool-svc-container.rs ──

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

// ── AMQP connection — port nguyên vẹn từ rabbit.rs ──────────────────────────

fn nonempty(o: &Option<String>) -> Option<String> {
    o.as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Build the AMQP URI for a specific endpoint. vhost "/" is percent-encoded to
/// "%2F" as RabbitMQ requires. Credentials/vhost come from the profile; only the
/// host:port varies across an HA cluster's endpoints.
fn amqp_uri_for(config: &RabbitConnection, host: &str, port: u16) -> String {
    let scheme = if config.use_tls { "amqps" } else { "amqp" };
    let user = utf8_percent_encode(&config.username, NON_ALPHANUMERIC);
    let pass = utf8_percent_encode(&config.password, NON_ALPHANUMERIC);
    let vhost = utf8_percent_encode(&config.vhost, NON_ALPHANUMERIC);
    let mut uri = format!("{scheme}://{user}:{pass}@{host}:{port}/{vhost}");
    if let Some(hb) = config.heartbeat {
        uri.push_str(&format!("?heartbeat={hb}"));
    }
    uri
}

/// The ordered list of `(host, port)` endpoints to try: the primary first, then
/// each `extra_hosts` entry (`host` or `host:port`, defaulting to `amqp_port`).
/// Blank entries are skipped.
fn endpoints(config: &RabbitConnection) -> Vec<(String, u16)> {
    let mut out = vec![(config.host.clone(), config.amqp_port)];
    for raw in &config.extra_hosts {
        let entry = raw.trim();
        if entry.is_empty() {
            continue;
        }
        // Split host:port on the LAST ':' so IPv6-in-brackets still parses host-only.
        match entry.rsplit_once(':') {
            Some((h, p)) if !h.is_empty() && p.parse::<u16>().is_ok() => {
                out.push((h.to_string(), p.parse().unwrap()));
            }
            _ => out.push((entry.to_string(), config.amqp_port)),
        }
    }
    out
}

fn build_identity(config: &RabbitConnection) -> Result<Option<OwnedIdentity>, String> {
    match nonempty(&config.client_pkcs12_b64) {
        None => Ok(None),
        Some(b64) => {
            let der = base64::engine::general_purpose::STANDARD
                .decode(b64.replace(['\n', '\r', ' '], ""))
                .map_err(|e| format!("Client identity (PKCS#12) is not valid base64: {e}"))?;
            Ok(Some(OwnedIdentity::PKCS12 {
                der,
                password: config.client_pkcs12_password.clone().unwrap_or_default(),
            }))
        }
    }
}

/// How long to wait for the TCP+TLS+AMQP handshake before giving up. Without a
/// bound, a wrong host/port, a firewall that drops packets, or an unreachable
/// cluster node makes the handshake hang for the OS default (tens of seconds) or
/// indefinitely, so Test/publish/consume appear frozen with no error.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Open an AMQP connection using the profile's TLS/heartbeat/connection-name
/// settings, integrated with the app's tokio runtime. Tries each endpoint in turn
/// (primary, then `extra_hosts`) so an HA cluster stays reachable when a node is
/// down; returns on the first success, or the collected errors if all fail.
async fn connect_amqp(config: &RabbitConnection) -> Result<Connection, String> {
    let mut options = ConnectionProperties::default();
    if let Some(name) = nonempty(&config.connection_name) {
        options = options.with_connection_name(name.into());
    }
    let mut errors: Vec<String> = Vec::new();
    for (host, port) in endpoints(config) {
        let uri = amqp_uri_for(config, &host, port);
        let tls = OwnedTLSConfig {
            identity: build_identity(config)?,
            cert_chain: nonempty(&config.tls_ca_pem),
        };
        // lapin 4 owns the executor/reactor internally; the default runtime is
        // tokio (the `tokio` default feature). Its concrete type is private, so
        // build it inline rather than naming it. One runtime per attempt.
        let runtime = lapin::runtime::default_runtime()
            .map_err(|e| format!("AMQP runtime init failed: {e}"))?;
        match tokio::time::timeout(
            CONNECT_TIMEOUT,
            Connection::connect_with_config(&uri, options.clone(), tls, runtime),
        )
        .await
        {
            Ok(Ok(conn)) => return Ok(conn),
            Ok(Err(e)) => errors.push(format!("{host}:{port}: {e}")),
            Err(_) => errors.push(format!("{host}:{port}: timed out after {}s", CONNECT_TIMEOUT.as_secs())),
        }
    }
    Err(format!(
        "AMQP connect failed (tried {} endpoint(s)): {}. Check the host(s), AMQP port, TLS setting and that the broker is reachable.",
        errors.len(),
        errors.join("; "),
    ))
}

fn to_field_table(headers: &BTreeMap<String, String>) -> FieldTable {
    let mut ft = FieldTable::default();
    for (k, v) in headers {
        ft.insert(k.clone().into(), AMQPValue::LongString(v.clone().into()));
    }
    ft
}

/// Port nguyên vẹn từ `rabbit.rs::amqp_value_to_string` — dùng để đọc header
/// của một message đã nhận (chiều ngược `to_field_table`).
fn amqp_value_to_string(v: &AMQPValue) -> String {
    match v {
        AMQPValue::LongString(s) => s.to_string(),
        AMQPValue::Boolean(b) => b.to_string(),
        AMQPValue::ShortShortInt(i) => i.to_string(),
        AMQPValue::ShortShortUInt(i) => i.to_string(),
        AMQPValue::ShortInt(i) => i.to_string(),
        AMQPValue::ShortUInt(i) => i.to_string(),
        AMQPValue::LongInt(i) => i.to_string(),
        AMQPValue::LongUInt(i) => i.to_string(),
        AMQPValue::LongLongInt(i) => i.to_string(),
        other => format!("{other:?}"),
    }
}

/// Port nguyên vẹn từ `rabbit.rs::message_from_delivery`.
fn message_from_delivery(d: &lapin::message::Delivery) -> ConsumedMessage {
    let p = &d.properties;
    let mut headers = BTreeMap::new();
    if let Some(h) = p.headers().as_ref() {
        for (k, v) in h.inner() {
            headers.insert(k.to_string(), amqp_value_to_string(v));
        }
    }
    ConsumedMessage {
        payload: String::from_utf8_lossy(&d.data).to_string(),
        exchange: d.exchange.to_string(),
        routing_key: d.routing_key.to_string(),
        redelivered: d.redelivered,
        delivery_tag: d.delivery_tag,
        correlation_id: p.correlation_id().as_ref().map(|s| s.to_string()),
        content_type: p.content_type().as_ref().map(|s| s.to_string()),
        message_id: p.message_id().as_ref().map(|s| s.to_string()),
        headers,
    }
}

fn build_properties(p: &PublishProps) -> BasicProperties {
    let mut props = BasicProperties::default();
    if let Some(v) = nonempty(&p.content_type) {
        props = props.with_content_type(v.into());
    }
    if let Some(v) = nonempty(&p.content_encoding) {
        props = props.with_content_encoding(v.into());
    }
    if let Some(v) = nonempty(&p.correlation_id) {
        props = props.with_correlation_id(v.into());
    }
    if let Some(v) = nonempty(&p.reply_to) {
        props = props.with_reply_to(v.into());
    }
    if let Some(v) = nonempty(&p.message_id) {
        props = props.with_message_id(v.into());
    }
    if let Some(v) = nonempty(&p.kind) {
        props = props.with_type(v.into());
    }
    if let Some(v) = nonempty(&p.app_id) {
        props = props.with_app_id(v.into());
    }
    if let Some(v) = nonempty(&p.user_id) {
        props = props.with_user_id(v.into());
    }
    if let Some(v) = nonempty(&p.expiration) {
        props = props.with_expiration(v.into());
    }
    if let Some(pr) = p.priority {
        props = props.with_priority(pr);
    }
    if p.persistent.unwrap_or(false) {
        props = props.with_delivery_mode(2); // 2 = persistent
    }
    if let Some(h) = &p.headers {
        if !h.is_empty() {
            props = props.with_headers(to_field_table(h));
        }
    }
    props
}

/// A mandatory publish is "routed" unless the broker returned it as unroutable.
fn routed_from(mandatory: bool, returned: bool) -> bool {
    !(mandatory && returned)
}

// ── AMQP topology (for brokers with no management HTTP API) — port nguyên vẹn ─

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueAmqpInfo {
    pub name: String,
    pub exists: bool,
    pub messages: Option<u32>,
    pub consumers: Option<u32>,
    /// Set only for unexpected errors (a missing queue is reported via `exists`).
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeAmqpInfo {
    pub name: String,
    pub exists: bool,
    pub error: Option<String>,
}

/// A failed passive declare raises a channel-level NOT_FOUND that closes the
/// channel, so each probe runs on its own fresh channel.
fn is_not_found(msg: &str) -> bool {
    msg.contains("NOT_FOUND") || msg.contains("404") || msg.contains("no queue") || msg.contains("no exchange")
}

// ── Consumer streaming — Bước 3 ─────────────────────────────────────────────
//
// Registry nội bộ theo dõi các consumer đang chạy, tách biệt khỏi `Waiters`
// phía service_host.rs (đó là registry của HOST theo `request.id` của MỘT
// LẦN GỌI `consume-start`; đây là registry của SIDECAR theo `consumerId` NỘI
// BỘ, sống xuyên suốt nhiều lần gọi — một `consume-stop` request khác hẳn
// request đã gọi `consume-start` mới dừng đúng consumer này). Cùng cấu trúc
// `PubSubRegistry` của devtool-svc-redis.rs / `StreamRegistry` của
// devtool-svc-container.rs — chỉ một method stream ở sidecar này nên một
// registry riêng là đủ, không cần dùng chung với method khác.
#[derive(Default)]
struct ConsumerStreamRegistry {
    inner: Mutex<HashMap<String, Arc<tokio::sync::Notify>>>,
}

static STREAM_REGISTRY: OnceLock<ConsumerStreamRegistry> = OnceLock::new();

fn stream_registry() -> &'static ConsumerStreamRegistry {
    STREAM_REGISTRY.get_or_init(ConsumerStreamRegistry::default)
}

/// Gửi lỗi giữa chừng của `consume-start` như một SỰ KIỆN STREAM bình thường
/// (`Response::event`, `error: None` ở tầng khung), KHÔNG BAO GIỜ dùng
/// `Response::err` — `service_host.rs::dispatch()` âm thầm bỏ qua một
/// `ServiceResponse` mang `error: Some(...)` cho một `Waiter::Stream` (xem
/// comment đầy đủ ở `send_pubsub_error`, devtool-svc-redis.rs). Payload
/// `{"type":"error","message":...}` đi qua đúng con đường event mà phía
/// client đang đợi (`"subscribed"` hoặc `"error"`).
fn send_stream_error(tx: &mpsc::UnboundedSender<Response>, id: &str, message: impl Into<String>) {
    let _ = tx.send(Response::event(id.to_string(), serde_json::json!({ "type": "error", "message": message.into() })));
}

/// `consume-start` là method STREAM — mirror `handle_logs_start` của
/// devtool-svc-container.rs / `handle_pubsub_subscribe` của
/// devtool-svc-redis.rs: mở connection+channel AMQP thật, `basic_qos`,
/// `basic_consume`, đăng ký vào registry nội bộ, gửi sự kiện đầu
/// `{"type":"subscribed","subscriptionId":...}` rồi spawn một task nền phát
/// mỗi message nhận được như `{"type":"message", ...ConsumedMessage}`. Port
/// ĐÚNG logic ack/reply theo `ackMode` từ `rabbit_consume_start`
/// (rabbit.rs dòng ~556-648): "peek" không ack (để lại unacked, bounded bởi
/// prefetch), "consume" ack không reply, "respond" ack + publish reply qua
/// direct reply-to nếu `reply` có mặt (echo body gốc hay payload tuỳ chỉnh,
/// set correlation_id/content_type từ request gốc). GIỮ `_keep_conn`/`channel`
/// sống trong task nền suốt vòng đời consumer — drop sớm đóng kết nối AMQP
/// ngay khi hàm return, lỗi dễ mắc nhất khi port ẩu.
async fn handle_consume_start(id: String, params: serde_json::Value, tx: mpsc::UnboundedSender<Response>) {
    let config_id: String = match param(&params, "configId") {
        Ok(v) => v,
        Err(e) => return send_stream_error(&tx, &id, e),
    };
    let queue: String = match param(&params, "queue") {
        Ok(v) => v,
        Err(e) => return send_stream_error(&tx, &id, e),
    };
    let ack_mode: String = match param(&params, "ackMode") {
        Ok(v) => v,
        Err(e) => return send_stream_error(&tx, &id, e),
    };
    let prefetch: u16 = match param(&params, "prefetch") {
        Ok(v) => v,
        Err(e) => return send_stream_error(&tx, &id, e),
    };
    let reply: Option<ReplyOptions> = opt_param(&params, "reply");

    let config = match find_config(&config_id) {
        Ok(c) => c,
        Err(e) => return send_stream_error(&tx, &id, e),
    };
    let conn = match connect_amqp(&config).await {
        Ok(c) => c,
        Err(e) => return send_stream_error(&tx, &id, e),
    };
    let channel = match conn.create_channel().await {
        Ok(c) => c,
        Err(e) => return send_stream_error(&tx, &id, e.to_string()),
    };

    let prefetch = prefetch.clamp(1, 500);
    if let Err(e) = channel.basic_qos(prefetch, BasicQosOptions::default()).await {
        return send_stream_error(&tx, &id, e.to_string());
    }

    let should_ack = ack_mode != "peek"; // consume + respond both ack
    let should_reply = ack_mode == "respond" && reply.is_some();
    let mut consumer = match channel
        .basic_consume(
            queue.clone().into(),
            "devtool-consumer".into(),
            BasicConsumeOptions::default(), // manual ack
            FieldTable::default(),
        )
        .await
    {
        Ok(c) => c,
        Err(e) => return send_stream_error(&tx, &id, format!("Consume failed: {e}")),
    };

    let consumer_id = Uuid::new_v4().to_string();
    let notify = Arc::new(tokio::sync::Notify::new());
    stream_registry().inner.lock().unwrap().insert(consumer_id.clone(), notify.clone());

    if tx
        .send(Response::event(id.clone(), serde_json::json!({ "type": "subscribed", "subscriptionId": consumer_id })))
        .is_err()
    {
        stream_registry().inner.lock().unwrap().remove(&consumer_id);
        return;
    }

    tokio::spawn(async move {
        // Giữ connection (và channel) sống suốt vòng đời consumer; channel còn
        // dùng để publish reply ở chế độ "respond". Drop sớm (không giữ biến
        // này) đóng kết nối AMQP ngay khi task return.
        let _keep_conn = conn;
        let channel = channel;
        loop {
            tokio::select! {
                _ = notify.notified() => break,
                next = consumer.next() => match next {
                    Some(Ok(delivery)) => {
                        let message = message_from_delivery(&delivery);
                        let event = {
                            let mut v = serde_json::to_value(&message).unwrap();
                            v.as_object_mut().unwrap().insert("type".to_string(), serde_json::json!("message"));
                            v
                        };
                        if tx.send(Response::event(id.clone(), event)).is_err() {
                            break; // writer task đã thoát — không còn ai đọc
                        }
                        if should_reply {
                            if let (Some(rep), Some(reply_to)) =
                                (reply.as_ref(), delivery.properties.reply_to().as_ref())
                            {
                                let body: Vec<u8> = if rep.echo {
                                    delivery.data.clone()
                                } else {
                                    rep.payload.clone().into_bytes()
                                };
                                let mut rprops = BasicProperties::default();
                                if let Some(cid) = delivery.properties.correlation_id().as_ref() {
                                    rprops = rprops.with_correlation_id(cid.clone());
                                }
                                if let Some(ct) = rep.content_type.as_ref().filter(|s| !s.trim().is_empty()) {
                                    rprops = rprops.with_content_type(ct.clone().into());
                                }
                                let _ = channel
                                    .basic_publish(
                                        "".into(),
                                        reply_to.as_str().into(),
                                        BasicPublishOptions::default(),
                                        &body,
                                        rprops,
                                    )
                                    .await;
                            }
                        }
                        if should_ack {
                            let _ = delivery.ack(BasicAckOptions::default()).await;
                        }
                        // peek mode: leave unacked (bounded by prefetch)
                    }
                    Some(Err(_)) | None => break,
                }
            }
        }
        stream_registry().inner.lock().unwrap().remove(&consumer_id);
    });
}

// ── Method dispatch ───────────────────────────────────────────────────────────

async fn handle(method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
    match method {
        "list-configs" => Ok(serde_json::to_value(load_configs()).unwrap()),

        "save-config" => {
            let mut config: RabbitConnection = param(&params, "config")?;
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

        "amqp-test" => {
            let config: RabbitConnection = param(&params, "config")?;
            let conn = connect_amqp(&config).await?;
            // A channel open confirms the connection is usable, not just the TCP/TLS handshake.
            conn.create_channel().await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        "rpc-call" => {
            let config_id: String = param(&params, "configId")?;
            let exchange: String = param(&params, "exchange")?;
            let routing_key: String = param(&params, "routingKey")?;
            let payload: String = param(&params, "payload")?;
            let correlation_id: Option<String> = opt_param(&params, "correlationId");
            let content_type: Option<String> = opt_param(&params, "contentType");
            let headers: Option<BTreeMap<String, String>> = opt_param(&params, "headers");
            let timeout_ms: u64 = param(&params, "timeoutMs")?;

            let config = find_config(&config_id)?;
            let conn = connect_amqp(&config).await?;
            let channel = conn.create_channel().await.map_err(|e| e.to_string())?;

            // Consume the direct reply-to pseudo-queue BEFORE publishing. Requires no-ack.
            let mut consumer = channel
                .basic_consume(
                    "amq.rabbitmq.reply-to".into(),
                    "devtool-rpc".into(),
                    BasicConsumeOptions { no_ack: true, ..Default::default() },
                    FieldTable::default(),
                )
                .await
                .map_err(|e| e.to_string())?;

            let corr = correlation_id
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| Uuid::new_v4().to_string());

            let mut props = BasicProperties::default()
                .with_reply_to("amq.rabbitmq.reply-to".into())
                .with_correlation_id(corr.into());
            if let Some(ct) = nonempty(&content_type) {
                props = props.with_content_type(ct.into());
            }
            if let Some(hs) = headers {
                if !hs.is_empty() {
                    props = props.with_headers(to_field_table(&hs));
                }
            }

            channel
                .basic_publish(
                    exchange.into(),
                    routing_key.into(),
                    BasicPublishOptions::default(),
                    payload.as_bytes(),
                    props,
                )
                .await
                .map_err(|e| format!("Publish failed: {e}"))?
                .await
                .map_err(|e| format!("Publish not confirmed: {e}"))?;

            match tokio::time::timeout(Duration::from_millis(timeout_ms), consumer.next()).await {
                Ok(Some(Ok(delivery))) => Ok(serde_json::to_value(RpcReply {
                    payload: String::from_utf8_lossy(&delivery.data).to_string(),
                    correlation_id: delivery.properties.correlation_id().as_ref().map(|s| s.to_string()),
                    content_type: delivery.properties.content_type().as_ref().map(|s| s.to_string()),
                })
                .unwrap()),
                Ok(Some(Err(e))) => Err(format!("Error receiving reply: {e}")),
                Ok(None) => Err("Reply stream closed before a reply arrived".to_string()),
                Err(_) => Err(format!(
                    "No reply within {timeout_ms} ms. Check the routing key reaches a responder that replies to reply_to."
                )),
            }
        }

        "publish" => {
            let config_id: String = param(&params, "configId")?;
            let exchange: String = param(&params, "exchange")?;
            let routing_key: String = param(&params, "routingKey")?;
            let payload: String = param(&params, "payload")?;
            let properties: PublishProps = opt_param(&params, "properties").unwrap_or_default();
            let mandatory: bool = opt_param(&params, "mandatory").unwrap_or(false);
            let confirm: bool = opt_param(&params, "confirm").unwrap_or(false);

            let config = find_config(&config_id)?;
            let conn = connect_amqp(&config).await?;
            let channel = conn.create_channel().await.map_err(|e| e.to_string())?;

            // Publisher confirms are also how we learn whether a mandatory message was
            // returned as unroutable, so enable them when either is requested.
            let use_confirm = confirm || mandatory;
            if use_confirm {
                channel
                    .confirm_select(ConfirmSelectOptions::default())
                    .await
                    .map_err(|e| e.to_string())?;
            }

            let props = build_properties(&properties);
            let publish = channel
                .basic_publish(
                    exchange.into(),
                    routing_key.into(),
                    BasicPublishOptions { mandatory, ..Default::default() },
                    payload.as_bytes(),
                    props,
                )
                .await
                .map_err(|e| format!("Publish failed: {e}"))?;

            if use_confirm {
                let confirmation = publish.await.map_err(|e| format!("Publish not confirmed: {e}"))?;
                let confirmed = confirmation.is_ack();
                let returned = confirmation.take_message();
                let return_reason = returned
                    .as_ref()
                    .map(|m| format!("{} {}", m.reply_code, m.reply_text.as_str()));
                Ok(serde_json::to_value(PublishOutcome {
                    confirmed,
                    routed: routed_from(mandatory, returned.is_some()),
                    return_reason,
                })
                .unwrap())
            } else {
                let _ = publish.await; // flush
                Ok(serde_json::to_value(PublishOutcome { confirmed: false, routed: true, return_reason: None }).unwrap())
            }
        }

        "amqp-queues-info" => {
            let config_id: String = param(&params, "configId")?;
            let names: Vec<String> = param(&params, "names")?;
            let config = find_config(&config_id)?;
            let conn = connect_amqp(&config).await?;
            let mut out = Vec::with_capacity(names.len());
            for name in names {
                let channel = match conn.create_channel().await {
                    Ok(ch) => ch,
                    Err(e) => {
                        out.push(QueueAmqpInfo { name, exists: false, messages: None, consumers: None, error: Some(e.to_string()) });
                        continue;
                    }
                };
                match channel
                    .queue_declare(
                        name.clone().into(),
                        QueueDeclareOptions { passive: true, ..Default::default() },
                        FieldTable::default(),
                    )
                    .await
                {
                    Ok(q) => {
                        out.push(QueueAmqpInfo {
                            name,
                            exists: true,
                            messages: Some(q.message_count()),
                            consumers: Some(q.consumer_count()),
                            error: None,
                        });
                        let _ = channel.close(200, "ok".into()).await;
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        let not_found = is_not_found(&msg);
                        out.push(QueueAmqpInfo {
                            name,
                            exists: false,
                            messages: None,
                            consumers: None,
                            error: if not_found { None } else { Some(msg) },
                        });
                        // Channel is already closed by the broker on error.
                    }
                }
            }
            Ok(serde_json::to_value(out).unwrap())
        }

        "amqp-exchanges-info" => {
            let config_id: String = param(&params, "configId")?;
            let names: Vec<String> = param(&params, "names")?;
            let config = find_config(&config_id)?;
            let conn = connect_amqp(&config).await?;
            let mut out = Vec::with_capacity(names.len());
            for name in names {
                let channel = match conn.create_channel().await {
                    Ok(ch) => ch,
                    Err(e) => {
                        out.push(ExchangeAmqpInfo { name, exists: false, error: Some(e.to_string()) });
                        continue;
                    }
                };
                // Passive declare ignores the kind; it only checks existence.
                match channel
                    .exchange_declare(
                        name.clone().into(),
                        ExchangeKind::Direct,
                        ExchangeDeclareOptions { passive: true, ..Default::default() },
                        FieldTable::default(),
                    )
                    .await
                {
                    Ok(_) => {
                        out.push(ExchangeAmqpInfo { name, exists: true, error: None });
                        let _ = channel.close(200, "ok".into()).await;
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        let not_found = is_not_found(&msg);
                        out.push(ExchangeAmqpInfo { name, exists: false, error: if not_found { None } else { Some(msg) } });
                    }
                }
            }
            Ok(serde_json::to_value(out).unwrap())
        }

        "amqp-declare-queue" => {
            let config_id: String = param(&params, "configId")?;
            let name: String = param(&params, "name")?;
            let durable: bool = param(&params, "durable")?;
            let auto_delete: bool = param(&params, "autoDelete")?;
            let config = find_config(&config_id)?;
            let conn = connect_amqp(&config).await?;
            let channel = conn.create_channel().await.map_err(|e| e.to_string())?;
            channel
                .queue_declare(
                    name.into(),
                    QueueDeclareOptions { durable, auto_delete, ..Default::default() },
                    FieldTable::default(),
                )
                .await
                .map_err(|e| format!("Declare queue failed: {e}"))?;
            Ok(serde_json::Value::Null)
        }

        "amqp-declare-exchange" => {
            let config_id: String = param(&params, "configId")?;
            let name: String = param(&params, "name")?;
            let kind: String = param(&params, "kind")?;
            let durable: bool = param(&params, "durable")?;
            let auto_delete: bool = param(&params, "autoDelete")?;
            let internal: bool = param(&params, "internal")?;
            let config = find_config(&config_id)?;
            let conn = connect_amqp(&config).await?;
            let channel = conn.create_channel().await.map_err(|e| e.to_string())?;
            let ek = match kind.as_str() {
                "direct" => ExchangeKind::Direct,
                "fanout" => ExchangeKind::Fanout,
                "topic" => ExchangeKind::Topic,
                "headers" => ExchangeKind::Headers,
                other => ExchangeKind::Custom(other.to_string()),
            };
            channel
                .exchange_declare(
                    name.into(),
                    ek,
                    ExchangeDeclareOptions { durable, auto_delete, internal, ..Default::default() },
                    FieldTable::default(),
                )
                .await
                .map_err(|e| format!("Declare exchange failed: {e}"))?;
            Ok(serde_json::Value::Null)
        }

        "amqp-bind-queue" => {
            let config_id: String = param(&params, "configId")?;
            let queue: String = param(&params, "queue")?;
            let exchange: String = param(&params, "exchange")?;
            let routing_key: String = param(&params, "routingKey")?;
            let config = find_config(&config_id)?;
            let conn = connect_amqp(&config).await?;
            let channel = conn.create_channel().await.map_err(|e| e.to_string())?;
            channel
                .queue_bind(
                    queue.into(),
                    exchange.into(),
                    routing_key.into(),
                    QueueBindOptions::default(),
                    FieldTable::default(),
                )
                .await
                .map_err(|e| format!("Bind failed: {e}"))?;
            Ok(serde_json::Value::Null)
        }

        // "consume-start" (stream) KHÔNG đi qua đây — xem `handle_consume_start`.

        "consume-stop" => {
            let consumer_id: String = param(&params, "consumerId")?;
            if let Some(notify) = stream_registry().inner.lock().unwrap().remove(&consumer_id) {
                notify.notify_one();
            }
            Ok(serde_json::Value::Null)
        }

        other => Err(format!("method không hỗ trợ: \"{other}\"")),
    }
}

// ── main: đọc stdin, spawn một task async cho mỗi dòng, một task khác sở hữu
//    stdout để mọi phản hồi ghi ra không bị xen lẫn giữa hai task — y hệt
//    cấu trúc devtool-svc-redis.rs / devtool-svc-container.rs. ─────────────

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
    // Lưu ý: nếu có consumer `consume-start` đang chạy, task nền của nó vẫn
    // giữ một bản sao `tx` nên `writer` (và do đó main()) sẽ KHÔNG tự thoát
    // chỉ vì stdin đóng — `service_host.rs` spawn sidecar với
    // `kill_on_drop(true)`, nên tiến trình vẫn bị buộc dừng khi host
    // kill/drop child handle bất kể trạng thái kênh nội bộ này.
}

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
    // `consume-start` KHÔNG đi qua `handle()` (một-lần) — nó cần giữ `tx` để
    // phát nhiều sự kiện theo thời gian, xem `handle_consume_start`. Mọi
    // method khác (bao gồm `consume-stop`) vẫn đi qua đường một-lần cũ.
    if req.method == "consume-start" {
        handle_consume_start(req.id, req.params, tx.clone()).await;
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

    fn base_config() -> RabbitConnection {
        RabbitConnection {
            id: "1".into(),
            name: "t".into(),
            host: "localhost".into(),
            port: 15672,
            vhost: "/".into(),
            username: "guest".into(),
            password: "guest".into(),
            use_tls: false,
            amqp_port: 5672,
            extra_hosts: Vec::new(),
            tls_ca_pem: None,
            client_pkcs12_b64: None,
            client_pkcs12_password: None,
            heartbeat: None,
            connection_name: None,
            amqp_only: false,
        }
    }

    fn amqp_uri(c: &RabbitConnection) -> String {
        amqp_uri_for(c, &c.host, c.amqp_port)
    }

    // ── Test mang theo từ rabbit.rs (logic thuần, không cần broker) ─────────

    #[test]
    fn amqp_uri_encodes_default_vhost_and_uses_amqp() {
        let uri = amqp_uri(&base_config());
        assert_eq!(uri, "amqp://guest:guest@localhost:5672/%2F");
    }

    #[test]
    fn amqp_uri_uses_amqps_when_tls_and_appends_heartbeat() {
        let mut c = base_config();
        c.use_tls = true;
        c.heartbeat = Some(30);
        c.vhost = "prod".into();
        let uri = amqp_uri(&c);
        assert_eq!(uri, "amqps://guest:guest@localhost:5672/prod?heartbeat=30");
    }

    #[test]
    fn amqp_uri_percent_encodes_credentials() {
        let mut c = base_config();
        c.username = "user@host".into();
        c.password = "p:s/w".into();
        let uri = amqp_uri(&c);
        assert!(uri.contains("user%40host"));
        assert!(uri.contains("p%3As%2Fw"));
    }

    #[test]
    fn config_deserializes_null_extra_hosts_as_empty() {
        // The frontend sends `extraHosts: null` when empty; it must not error.
        let json = r#"{
            "id": "1", "name": "t", "host": "localhost", "port": 15672,
            "vhost": "/", "username": "guest", "password": "guest", "useTls": false,
            "amqpPort": 5672, "extraHosts": null
        }"#;
        let c: RabbitConnection = serde_json::from_str(json).unwrap();
        assert!(c.extra_hosts.is_empty());
    }

    #[test]
    fn endpoints_lists_primary_then_extras_with_port_fallback() {
        let mut c = base_config();
        c.extra_hosts = vec![
            "node2".into(),          // host only → falls back to amqp_port
            "node3:5673".into(),     // explicit port
            "  ".into(),             // blank → skipped
            "node4:notaport".into(), // bad port → whole entry treated as host
        ];
        assert_eq!(
            endpoints(&c),
            vec![
                ("localhost".to_string(), 5672),
                ("node2".to_string(), 5672),
                ("node3".to_string(), 5673),
                ("node4:notaport".to_string(), 5672),
            ],
        );
    }

    #[test]
    fn nonempty_trims_and_filters() {
        assert_eq!(nonempty(&Some("  x ".into())), Some("x".into()));
        assert_eq!(nonempty(&Some("   ".into())), None);
        assert_eq!(nonempty(&None), None);
    }

    #[test]
    fn build_properties_sets_persistent_and_fields() {
        let p = PublishProps {
            content_type: Some("application/json".into()),
            persistent: Some(true),
            priority: Some(5),
            correlation_id: Some("abc".into()),
            content_encoding: Some("".into()), // empty → omitted
            ..Default::default()
        };
        let props = build_properties(&p);
        assert_eq!(props.content_type().as_ref().map(|s| s.as_str()), Some("application/json"));
        assert_eq!(props.delivery_mode(), &Some(2));
        assert_eq!(props.priority(), &Some(5));
        assert_eq!(props.correlation_id().as_ref().map(|s| s.as_str()), Some("abc"));
        assert!(props.content_encoding().is_none());
    }

    #[test]
    fn build_properties_omits_delivery_mode_when_not_persistent() {
        let props = build_properties(&PublishProps::default());
        assert_eq!(props.delivery_mode(), &None);
    }

    #[test]
    fn to_field_table_carries_all_headers() {
        let mut h = BTreeMap::new();
        h.insert("__TypeId__".to_string(), "com.example.X".to_string());
        h.insert("source".to_string(), "devtool".to_string());
        let ft = to_field_table(&h);
        assert_eq!(ft.inner().len(), 2);
    }

    #[test]
    fn routed_from_logic() {
        assert!(routed_from(false, false)); // not mandatory → routed
        assert!(routed_from(false, true)); // not mandatory, ignore return
        assert!(routed_from(true, false)); // mandatory, not returned → routed
        assert!(!routed_from(true, true)); // mandatory + returned → unroutable
    }

    // ── Test riêng cho phần hạ tầng chỉ có ở sidecar (không có trong rabbit.rs) ─

    #[test]
    fn app_data_dir_bao_loi_ro_rang_khi_thieu_bien_moi_truong() {
        // Không set biến môi trường trong test này — nhưng test khác trong
        // cùng binary CÓ THỂ chạy song song và set nó, nên chỉ assert khi
        // biến thực sự vắng mặt để tránh test chập chờn.
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
    async fn list_configs_khong_co_du_lieu_tra_ve_vec_rong() {
        // Không set DEVTOOL_SERVICE_DATA_DIR trong test này → load_configs()
        // phải rơi về rỗng, không panic.
        let res = handle("list-configs", serde_json::Value::Null).await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn delete_config_thieu_config_id_tra_ve_loi_ro_rang() {
        let res = handle("delete-config", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("configId"));
    }

    #[tokio::test]
    async fn save_config_thieu_config_tra_ve_loi_ro_rang() {
        let res = handle("save-config", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("config"));
    }

    #[tokio::test]
    async fn amqp_test_thieu_config_tra_ve_loi_ro_rang() {
        let res = handle("amqp-test", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("config"));
    }

    #[tokio::test]
    async fn amqp_test_config_khong_ket_noi_duoc_tra_ve_loi_ro_rang() {
        let mut c = base_config();
        c.host = "127.0.0.1".into();
        c.amqp_port = 1; // cổng gần như chắc chắn không có broker nào lắng nghe
        let res = handle("amqp-test", serde_json::json!({ "config": c })).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn rpc_call_thieu_config_id_tra_ve_loi_ro_rang() {
        let res = handle(
            "rpc-call",
            serde_json::json!({ "exchange": "", "routingKey": "x", "payload": "y", "timeoutMs": 100 }),
        )
        .await;
        assert!(res.unwrap_err().contains("configId"));
    }

    #[tokio::test]
    async fn rpc_call_config_khong_ton_tai_tra_ve_loi_ro_rang() {
        let res = handle(
            "rpc-call",
            serde_json::json!({
                "configId": "khong-ton-tai-chac-chan", "exchange": "", "routingKey": "x",
                "payload": "y", "timeoutMs": 100,
            }),
        )
        .await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn publish_thieu_routing_key_tra_ve_loi_ro_rang() {
        let res = handle(
            "publish",
            serde_json::json!({ "configId": "x", "exchange": "", "payload": "y" }),
        )
        .await;
        assert!(res.unwrap_err().contains("routingKey"));
    }

    #[tokio::test]
    async fn publish_config_khong_ton_tai_tra_ve_loi_ro_rang() {
        let res = handle(
            "publish",
            serde_json::json!({
                "configId": "khong-ton-tai-chac-chan", "exchange": "", "routingKey": "x", "payload": "y",
            }),
        )
        .await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn amqp_queues_info_thieu_names_tra_ve_loi_ro_rang() {
        let res = handle("amqp-queues-info", serde_json::json!({ "configId": "x" })).await;
        assert!(res.unwrap_err().contains("names"));
    }

    #[tokio::test]
    async fn amqp_queues_info_config_khong_ton_tai_tra_ve_loi_ro_rang() {
        let res = handle(
            "amqp-queues-info",
            serde_json::json!({ "configId": "khong-ton-tai-chac-chan", "names": ["q1"] }),
        )
        .await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn amqp_exchanges_info_thieu_names_tra_ve_loi_ro_rang() {
        let res = handle("amqp-exchanges-info", serde_json::json!({ "configId": "x" })).await;
        assert!(res.unwrap_err().contains("names"));
    }

    #[tokio::test]
    async fn amqp_declare_queue_thieu_durable_tra_ve_loi_ro_rang() {
        let res = handle(
            "amqp-declare-queue",
            serde_json::json!({ "configId": "x", "name": "q1", "autoDelete": false }),
        )
        .await;
        assert!(res.unwrap_err().contains("durable"));
    }

    #[tokio::test]
    async fn amqp_declare_queue_config_khong_ton_tai_tra_ve_loi_ro_rang() {
        let res = handle(
            "amqp-declare-queue",
            serde_json::json!({
                "configId": "khong-ton-tai-chac-chan", "name": "q1", "durable": true, "autoDelete": false,
            }),
        )
        .await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn amqp_declare_exchange_thieu_kind_tra_ve_loi_ro_rang() {
        let res = handle(
            "amqp-declare-exchange",
            serde_json::json!({ "configId": "x", "name": "e1", "durable": true, "autoDelete": false, "internal": false }),
        )
        .await;
        assert!(res.unwrap_err().contains("kind"));
    }

    #[tokio::test]
    async fn amqp_bind_queue_thieu_exchange_tra_ve_loi_ro_rang() {
        let res = handle(
            "amqp-bind-queue",
            serde_json::json!({ "configId": "x", "queue": "q1", "routingKey": "rk" }),
        )
        .await;
        assert!(res.unwrap_err().contains("exchange"));
    }

    #[tokio::test]
    async fn amqp_bind_queue_config_khong_ton_tai_tra_ve_loi_ro_rang() {
        let res = handle(
            "amqp-bind-queue",
            serde_json::json!({
                "configId": "khong-ton-tai-chac-chan", "queue": "q1", "exchange": "e1", "routingKey": "rk",
            }),
        )
        .await;
        assert!(res.is_err());
    }

    // ── Bước 3: consume-start (stream) / consume-stop — đường lỗi + registry ─

    #[tokio::test]
    async fn consume_stop_id_khong_ton_tai_van_ok_khong_panic() {
        // Gỡ một consumerId chưa từng đăng ký là no-op (giống bản Tier A) —
        // không có gì để dừng nhưng vẫn phải trả Ok, không lỗi/panic.
        let res = handle("consume-stop", serde_json::json!({ "consumerId": "khong-ton-tai" })).await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn consume_stop_thieu_consumer_id_tra_ve_loi_ro_rang() {
        let res = handle("consume-stop", serde_json::json!({})).await;
        assert!(res.unwrap_err().contains("consumerId"));
    }

    #[tokio::test]
    async fn consume_stop_thao_dung_entry_khoi_registry_va_bao_notify() {
        let id = "consumer-test-1".to_string();
        let notify = Arc::new(tokio::sync::Notify::new());
        stream_registry().inner.lock().unwrap().insert(id.clone(), notify.clone());

        let notified = tokio::spawn({
            let notify = notify.clone();
            async move { notify.notified().await }
        });

        let res = handle("consume-stop", serde_json::json!({ "consumerId": id })).await;
        assert!(res.is_ok());
        // notify_one() đã được gọi bên trong handle("consume-stop", …) — task
        // đang chờ notified() phải hoàn tất, không treo.
        tokio::time::timeout(std::time::Duration::from_secs(2), notified).await.expect("notify phải bắn").unwrap();
        assert!(!stream_registry().inner.lock().unwrap().contains_key(&id));
    }

    #[tokio::test]
    async fn consume_start_thieu_config_id_bao_loi_qua_stream_event() {
        // Lỗi phải đi qua như một SỰ KIỆN STREAM (`response.error.is_none()`,
        // `stream: true`, payload `{"type":"error",...}`) — KHÔNG phải
        // `response.error: Some(...)` ở tầng khung tin nhắn, vì
        // `service_host.rs::dispatch()` âm thầm bỏ qua lỗi tầng khung cho một
        // `Waiter::Stream` (xem comment ở `send_stream_error`). Nếu test này
        // đỏ vì `response.error` lại có giá trị, đó là dấu hiệu bug cũ (fail
        // giữa chừng nhưng client không bao giờ biết) đã quay lại.
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_consume_start(
            "req-1".to_string(),
            serde_json::json!({ "queue": "q1", "ackMode": "consume", "prefetch": 10 }),
            tx,
        )
        .await;
        let response = rx.recv().await.expect("phải gửi đúng một sự kiện lỗi");
        assert_eq!(response.id, "req-1");
        assert!(response.error.is_none(), "lỗi phải đi qua stream event, không phải response.error");
        assert!(response.stream);
        let event = response.result.expect("sự kiện lỗi phải mang result");
        assert_eq!(event["type"], "error");
        assert!(event["message"].as_str().unwrap().contains("configId"));
    }

    #[tokio::test]
    async fn consume_start_thieu_queue_bao_loi_qua_stream_event() {
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_consume_start(
            "req-2".to_string(),
            serde_json::json!({ "configId": "x", "ackMode": "consume", "prefetch": 10 }),
            tx,
        )
        .await;
        let response = rx.recv().await.expect("phải gửi đúng một sự kiện lỗi");
        let event = response.result.expect("sự kiện lỗi phải mang result");
        assert_eq!(event["type"], "error");
        assert!(event["message"].as_str().unwrap().contains("queue"));
    }

    #[tokio::test]
    async fn consume_start_thieu_ack_mode_bao_loi_qua_stream_event() {
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_consume_start(
            "req-3".to_string(),
            serde_json::json!({ "configId": "x", "queue": "q1", "prefetch": 10 }),
            tx,
        )
        .await;
        let response = rx.recv().await.expect("phải gửi đúng một sự kiện lỗi");
        let event = response.result.expect("sự kiện lỗi phải mang result");
        assert_eq!(event["type"], "error");
        assert!(event["message"].as_str().unwrap().contains("ackMode"));
    }

    #[tokio::test]
    async fn consume_start_config_khong_ton_tai_bao_loi_qua_stream_event() {
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_consume_start(
            "req-4".to_string(),
            serde_json::json!({
                "configId": "khong-ton-tai-chac-chan", "queue": "q1", "ackMode": "consume", "prefetch": 10,
            }),
            tx,
        )
        .await;
        let response = rx.recv().await.expect("phải gửi đúng một sự kiện lỗi");
        assert!(response.error.is_none());
        let event = response.result.expect("sự kiện lỗi phải mang result");
        assert_eq!(event["type"], "error");
    }

    #[tokio::test]
    async fn consume_start_di_qua_handle_line_khong_qua_handle_mot_lan() {
        // `handle_line` phải phân nhánh `consume-start` sang
        // `handle_consume_start` (đường stream event), không rơi vào đường
        // `handle()` một-lần (đường đó sẽ trả `response.error: Some(...)`).
        let line = serde_json::json!({
            "protocol": SERVICE_PROTOCOL, "id": "req-5", "method": "consume-start",
            "params": { "queue": "q1", "ackMode": "consume", "prefetch": 10 },
        })
        .to_string();
        let response = call_handle_line(&line).await;
        assert!(response.error.is_none(), "lỗi phải đi qua stream event, không phải response.error");
        assert!(response.stream);
        let event = response.result.expect("sự kiện lỗi phải mang result");
        assert_eq!(event["type"], "error");
    }

    /// `handle_line` trả về qua kênh `tx` — test dựng một kênh riêng và đọc
    /// lại đúng một `Response`, giống mẫu ở devtool-svc-redis.rs /
    /// devtool-svc-container.rs.
    async fn call_handle_line(line: &str) -> Response {
        let (tx, mut rx) = mpsc::unbounded_channel::<Response>();
        handle_line(line, &tx).await;
        drop(tx);
        rx.recv().await.expect("handle_line phải gửi đúng một response")
    }

    #[tokio::test]
    async fn handle_line_tra_response_hop_le_cho_method_mot_lan() {
        let line = serde_json::json!({
            "protocol": SERVICE_PROTOCOL, "id": "1", "method": "delete-config",
            "params": { "configId": "khong-quan-trong" },
        })
        .to_string();
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

    #[tokio::test]
    async fn method_la_tra_ve_loi_ro_rang() {
        let line = serde_json::json!({ "protocol": SERVICE_PROTOCOL, "id": "9", "method": "khong-ton-tai", "params": null }).to_string();
        let response = call_handle_line(&line).await;
        assert!(response.error.unwrap().contains("khong-ton-tai"));
    }
}
