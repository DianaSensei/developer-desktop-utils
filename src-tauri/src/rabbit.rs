// RabbitMQ tool backend.
//
// Connection profiles are persisted to the app-data directory (keeping the
// password out of localStorage). Browsing/creating queues & exchanges happens on
// the frontend via the Management HTTP API; this module owns the AMQP operations
// that the REST API can't do: full-feature publish (properties + mandatory +
// publisher confirms), request/response via direct reply-to, and a live consumer.

use serde::{Deserialize, Deserializer, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tokio::sync::Notify;
use uuid::Uuid;

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

/// Tracks running consumers so they can be stopped. The inner `Arc` lets a
/// spawned consumer task remove itself on exit without holding the Tauri `State`.
#[derive(Default, Clone)]
pub struct ConsumerRegistry {
    inner: Arc<Mutex<HashMap<String, Arc<Notify>>>>,
}

// ── Config persistence ──────────────────────────────────────────────────────

fn configs_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("rabbit-connections.json"))
        .map_err(|e| format!("Could not resolve app data directory: {e}"))
}

fn load_configs(app: &AppHandle) -> Vec<RabbitConnection> {
    let Ok(path) = configs_path(app) else { return Vec::new(); };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_configs(app: &AppHandle, configs: &[RabbitConnection]) -> Result<(), String> {
    let path = configs_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(configs).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn find_config(app: &AppHandle, config_id: &str) -> Result<RabbitConnection, String> {
    load_configs(app)
        .into_iter()
        .find(|c| c.id == config_id)
        .ok_or_else(|| format!("Connection '{}' not found", config_id))
}

// ── Config-management commands ────────────────────────────────────────────────

#[tauri::command]
pub async fn rabbit_list_configs(app: AppHandle) -> Result<Vec<RabbitConnection>, String> {
    Ok(load_configs(&app))
}

#[tauri::command]
pub async fn rabbit_save_config(
    app: AppHandle,
    mut config: RabbitConnection,
) -> Result<RabbitConnection, String> {
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
pub async fn rabbit_delete_config(app: AppHandle, config_id: String) -> Result<(), String> {
    let mut configs = load_configs(&app);
    configs.retain(|c| c.id != config_id);
    save_configs(&app, &configs)
}

// ── AMQP connection ───────────────────────────────────────────────────────────

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

// ── Publish (full AMQP) ─────────────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn rabbit_publish(
    app: AppHandle,
    config_id: String,
    exchange: String,
    routing_key: String,
    payload: String,
    properties: PublishProps,
    mandatory: bool,
    confirm: bool,
) -> Result<PublishOutcome, String> {
    let config = find_config(&app, &config_id)?;
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
        Ok(PublishOutcome {
            confirmed,
            routed: routed_from(mandatory, returned.is_some()),
            return_reason,
        })
    } else {
        let _ = publish.await; // flush
        Ok(PublishOutcome { confirmed: false, routed: true, return_reason: None })
    }
}

// ── Request/Response over AMQP (direct reply-to) ──────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn rabbit_rpc_call(
    app: AppHandle,
    config_id: String,
    exchange: String,
    routing_key: String,
    payload: String,
    correlation_id: Option<String>,
    content_type: Option<String>,
    headers: Option<BTreeMap<String, String>>,
    timeout_ms: u64,
) -> Result<RpcReply, String> {
    let config = find_config(&app, &config_id)?;
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
        Ok(Some(Ok(delivery))) => Ok(RpcReply {
            payload: String::from_utf8_lossy(&delivery.data).to_string(),
            correlation_id: delivery.properties.correlation_id().as_ref().map(|s| s.to_string()),
            content_type: delivery.properties.content_type().as_ref().map(|s| s.to_string()),
        }),
        Ok(Some(Err(e))) => Err(format!("Error receiving reply: {e}")),
        Ok(None) => Err("Reply stream closed before a reply arrived".to_string()),
        Err(_) => Err(format!(
            "No reply within {timeout_ms} ms. Check the routing key reaches a responder that replies to reply_to."
        )),
    }
}

// ── Live consumer ─────────────────────────────────────────────────────────────

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

/// Auto-reply configuration for a "respond" consumer (the tool acts as an RPC server).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyOptions {
    /// Reply with the request's own body instead of `payload`.
    pub echo: bool,
    pub payload: String,
    pub content_type: Option<String>,
}

/// Start a live consumer.
/// `ack_mode`:
///   - "peek"    — non-destructive: messages are delivered unacked and requeued on stop.
///   - "consume" — ack (remove) each message.
///   - "respond" — ack each message and reply to its `reply_to` (request/reply server),
///                 using `reply` for the response body. Requires `reply`.
/// `prefetch` bounds in-flight messages so the broker is never flooded.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn rabbit_consume_start(
    app: AppHandle,
    registry: tauri::State<'_, ConsumerRegistry>,
    config_id: String,
    queue: String,
    ack_mode: String,
    prefetch: u16,
    reply: Option<ReplyOptions>,
    on_message: Channel<ConsumedMessage>,
) -> Result<String, String> {
    let config = find_config(&app, &config_id)?;
    let conn = connect_amqp(&config).await?;
    let channel = conn.create_channel().await.map_err(|e| e.to_string())?;

    let prefetch = prefetch.clamp(1, 500);
    channel
        .basic_qos(prefetch, BasicQosOptions::default())
        .await
        .map_err(|e| e.to_string())?;

    let should_ack = ack_mode != "peek"; // consume + respond both ack
    let should_reply = ack_mode == "respond" && reply.is_some();
    let mut consumer = channel
        .basic_consume(
            queue.clone().into(),
            "devtool-consumer".into(),
            BasicConsumeOptions::default(), // manual ack
            FieldTable::default(),
        )
        .await
        .map_err(|e| format!("Consume failed: {e}"))?;

    let id = Uuid::new_v4().to_string();
    let notify = Arc::new(Notify::new());
    let reg = registry.inner.clone();
    reg.lock().unwrap().insert(id.clone(), notify.clone());

    let reg_task = reg.clone();
    let id_task = id.clone();
    tokio::spawn(async move {
        // Keep the connection (and channel) alive for the consumer's lifetime; the
        // channel is also used to publish replies in respond mode.
        let _keep_conn = conn;
        let channel = channel;
        loop {
            tokio::select! {
                _ = notify.notified() => break,
                next = consumer.next() => match next {
                    Some(Ok(delivery)) => {
                        if on_message.send(message_from_delivery(&delivery)).is_err() {
                            break; // frontend dropped the channel
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
        reg_task.lock().unwrap().remove(&id_task);
    });

    Ok(id)
}

#[tauri::command]
pub async fn rabbit_consume_stop(
    registry: tauri::State<'_, ConsumerRegistry>,
    consumer_id: String,
) -> Result<(), String> {
    if let Some(notify) = registry.inner.lock().unwrap().remove(&consumer_id) {
        notify.notify_one();
    }
    Ok(())
}

// ── AMQP topology (for brokers with no management HTTP API) ───────────────────
// AMQP 0-9-1 can't *enumerate* queues/exchanges, but it can declare/bind and, via
// a passive declare, report whether a *named* queue exists plus its live message
// and consumer counts. These power the typed-name workflow in AMQP-only mode.

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

/// Open (and immediately close) an AMQP connection to verify the profile works.
/// Takes a full config so it can test an unsaved form.
#[tauri::command]
pub async fn rabbit_amqp_test(config: RabbitConnection) -> Result<(), String> {
    let conn = connect_amqp(&config).await?;
    // A channel open confirms the connection is usable, not just the TCP/TLS handshake.
    conn.create_channel().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn rabbit_amqp_queues_info(
    app: AppHandle,
    config_id: String,
    names: Vec<String>,
) -> Result<Vec<QueueAmqpInfo>, String> {
    let config = find_config(&app, &config_id)?;
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
    Ok(out)
}

#[tauri::command]
pub async fn rabbit_amqp_exchanges_info(
    app: AppHandle,
    config_id: String,
    names: Vec<String>,
) -> Result<Vec<ExchangeAmqpInfo>, String> {
    let config = find_config(&app, &config_id)?;
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
    Ok(out)
}

#[tauri::command]
pub async fn rabbit_amqp_declare_queue(
    app: AppHandle,
    config_id: String,
    name: String,
    durable: bool,
    auto_delete: bool,
) -> Result<(), String> {
    let config = find_config(&app, &config_id)?;
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
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn rabbit_amqp_declare_exchange(
    app: AppHandle,
    config_id: String,
    name: String,
    kind: String,
    durable: bool,
    auto_delete: bool,
    internal: bool,
) -> Result<(), String> {
    let config = find_config(&app, &config_id)?;
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
    Ok(())
}

#[tauri::command]
pub async fn rabbit_amqp_bind_queue(
    app: AppHandle,
    config_id: String,
    queue: String,
    exchange: String,
    routing_key: String,
) -> Result<(), String> {
    let config = find_config(&app, &config_id)?;
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
    Ok(())
}

// ── Tests (pure logic; no broker) ─────────────────────────────────────────────

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
}
