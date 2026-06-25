use rskafka::client::{ClientBuilder, partition::{Compression, UnknownTopicHandling}};
use rskafka::record::Record;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use chrono::Utc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use uuid::Uuid;

// ── Data types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerConfig {
    pub id: String,
    pub name: String,
    pub bootstrap_servers: String,
    pub sasl_mechanism: Option<String>,
    pub sasl_username: Option<String>,
    pub sasl_password: Option<String>,
    pub ssl_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicSummary {
    pub name: String,
    pub partition_count: i32,
    pub replication_factor: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartitionInfo {
    pub id: i32,
    pub leader: i32,
    pub earliest_offset: i64,
    pub latest_offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupLag {
    pub group_id: String,
    pub partition: i32,
    pub committed_offset: i64,
    pub lag: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicDetails {
    pub name: String,
    pub partitions: Vec<PartitionInfo>,
    pub replication_factor: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicConfig {
    pub name: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSummary {
    pub group_id: String,
    pub state: String,
    pub protocol_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    pub topic: String,
    pub partition: i32,
    pub committed_offset: i64,
    pub lag: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupMember {
    pub member_id: String,
    pub client_id: String,
    pub client_host: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDetails {
    pub group_id: String,
    pub state: String,
    pub member_count: i32,
    pub members: Vec<GroupMember>,
    pub assignments: Vec<Assignment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProduceResult {
    pub partition: i32,
    pub offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KafkaMessage {
    pub offset: i64,
    pub partition: i32,
    pub timestamp: String,
    pub key: Option<String>,
    pub value: Option<String>,
    pub headers: std::collections::BTreeMap<String, String>,
}

// ── Config persistence ────────────────────────────────────────────────────────

fn configs_path(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .expect("no app data dir")
        .join("kafka-brokers.json")
}

fn load_configs(app: &AppHandle) -> Vec<BrokerConfig> {
    let path = configs_path(app);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_configs(app: &AppHandle, configs: &[BrokerConfig]) -> Result<(), String> {
    let path = configs_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(configs).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn find_config(app: &AppHandle, config_id: &str) -> Result<BrokerConfig, String> {
    load_configs(app)
        .into_iter()
        .find(|c| c.id == config_id)
        .ok_or_else(|| format!("Broker config '{}' not found", config_id))
}

// ── rskafka client ────────────────────────────────────────────────────────────

fn parse_brokers(bootstrap_servers: &str) -> Vec<String> {
    bootstrap_servers
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

async fn make_client(config: &BrokerConfig) -> Result<rskafka::client::Client, String> {
    let brokers = parse_brokers(&config.bootstrap_servers);
    if brokers.is_empty() {
        return Err("No broker addresses specified".to_string());
    }
    ClientBuilder::new(brokers)
        .build()
        .await
        .map_err(|e| e.to_string())
}

// ── Kafka wire protocol ───────────────────────────────────────────────────────
// Used for operations not covered by rskafka: metadata, offsets, consumer groups, create topic.

async fn connect_broker(addr: &str) -> Result<TcpStream, String> {
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        TcpStream::connect(addr),
    )
    .await
    .map_err(|_| format!("Timeout connecting to {}", addr))?
    .map_err(|e| format!("Failed to connect to {}: {}", addr, e))
}

/// Opens a TcpStream to the first address in bootstrap_servers that speaks Kafka protocol.
/// Probes each address with a MetadataRequest so that non-Kafka ports (e.g. ZooKeeper)
/// are skipped automatically instead of returning "early eof".
async fn open_kafka_stream(config: &BrokerConfig) -> Result<TcpStream, String> {
    let brokers = parse_brokers(&config.bootstrap_servers);
    if brokers.is_empty() {
        return Err("No broker addresses specified".to_string());
    }
    let mut errors: Vec<String> = Vec::new();
    for addr in &brokers {
        match connect_broker(addr).await {
            Err(e) => { errors.push(format!("{addr}: {e}")); }
            Ok(mut probe) => {
                match wire_metadata(&mut probe, &[]).await {
                    Ok(_) => {
                        // Confirmed Kafka; return a fresh stream for the actual command
                        return connect_broker(addr).await;
                    }
                    Err(e) => {
                        errors.push(format!("{addr}: {e} (not a Kafka broker?)"));
                    }
                }
            }
        }
    }
    Err(format!(
        "Could not reach any Kafka broker. Tried: {}. \
         Make sure bootstrap servers contains only Kafka broker ports, not ZooKeeper.",
        errors.join("; ")
    ))
}

async fn send_request(
    stream: &mut TcpStream,
    api_key: i16,
    api_version: i16,
    correlation_id: i32,
    body: &[u8],
) -> Result<Vec<u8>, String> {
    let client_id = b"devtool";
    let mut msg = Vec::new();
    msg.extend_from_slice(&api_key.to_be_bytes());
    msg.extend_from_slice(&api_version.to_be_bytes());
    msg.extend_from_slice(&correlation_id.to_be_bytes());
    msg.extend_from_slice(&(client_id.len() as i16).to_be_bytes());
    msg.extend_from_slice(client_id);
    msg.extend_from_slice(body);

    let size = msg.len() as i32;
    stream.write_all(&size.to_be_bytes()).await.map_err(|e| e.to_string())?;
    stream.write_all(&msg).await.map_err(|e| e.to_string())?;

    const READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

    let mut size_buf = [0u8; 4];
    tokio::time::timeout(READ_TIMEOUT, stream.read_exact(&mut size_buf))
        .await
        .map_err(|_| "Kafka read timed out (30 s)".to_string())?
        .map_err(|e| e.to_string())?;
    let rlen = i32::from_be_bytes(size_buf);
    // The length comes straight off the socket. Validate it before allocating:
    // a non-Kafka server (e.g. an HTTP/TLS port reached by a typo in
    // bootstrap_servers) or a malicious peer could otherwise send a huge or
    // negative size and trigger a multi-GB allocation → OOM crash. A response
    // must also be at least 4 bytes to contain the correlation id we skip below.
    const MAX_RESPONSE_BYTES: i32 = 64 * 1024 * 1024; // 64 MB — ample for metadata/offsets/groups/configs
    if rlen < 4 || rlen > MAX_RESPONSE_BYTES {
        return Err(format!(
            "Invalid Kafka response size ({rlen} bytes) — is this a Kafka broker port?"
        ));
    }
    let mut resp = vec![0u8; rlen as usize];
    tokio::time::timeout(READ_TIMEOUT, stream.read_exact(&mut resp))
        .await
        .map_err(|_| "Kafka read timed out (30 s)".to_string())?
        .map_err(|e| e.to_string())?;
    // skip correlation_id (4 bytes)
    Ok(resp[4..].to_vec())
}

struct Dec<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Dec<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn i16(&mut self) -> Result<i16, String> {
        self.ensure(2)?;
        let v = i16::from_be_bytes(self.data[self.pos..self.pos + 2].try_into().unwrap());
        self.pos += 2;
        Ok(v)
    }

    fn i32(&mut self) -> Result<i32, String> {
        self.ensure(4)?;
        let v = i32::from_be_bytes(self.data[self.pos..self.pos + 4].try_into().unwrap());
        self.pos += 4;
        Ok(v)
    }

    fn i64(&mut self) -> Result<i64, String> {
        self.ensure(8)?;
        let v = i64::from_be_bytes(self.data[self.pos..self.pos + 8].try_into().unwrap());
        self.pos += 8;
        Ok(v)
    }

    fn str(&mut self) -> Result<String, String> {
        let len = self.i16()?;
        if len < 0 {
            return Ok(String::new());
        }
        let len = len as usize;
        self.ensure(len)?;
        let s = String::from_utf8_lossy(&self.data[self.pos..self.pos + len]).to_string();
        self.pos += len;
        Ok(s)
    }

    fn bytes(&mut self) -> Result<Vec<u8>, String> {
        let len = self.i32()?;
        if len < 0 {
            return Ok(vec![]);
        }
        let len = len as usize;
        self.ensure(len)?;
        let b = self.data[self.pos..self.pos + len].to_vec();
        self.pos += len;
        Ok(b)
    }

    fn array<T, F: FnMut(&mut Dec) -> Result<T, String>>(&mut self, mut f: F) -> Result<Vec<T>, String> {
        let count = self.i32()?;
        if count < 0 {
            return Ok(vec![]);
        }
        (0..count).map(|_| f(self)).collect()
    }

    fn nullable_str(&mut self) -> Result<Option<String>, String> {
        let len = self.i16()?;
        if len < 0 { return Ok(None); }
        let len = len as usize;
        self.ensure(len)?;
        let s = String::from_utf8_lossy(&self.data[self.pos..self.pos + len]).to_string();
        self.pos += len;
        Ok(Some(s))
    }

    fn bool_val(&mut self) -> Result<bool, String> {
        self.ensure(1)?;
        let v = self.data[self.pos] != 0;
        self.pos += 1;
        Ok(v)
    }

    fn uvarint(&mut self) -> Result<u64, String> {
        let mut result: u64 = 0;
        let mut shift = 0u32;
        loop {
            self.ensure(1)?;
            let b = self.data[self.pos];
            self.pos += 1;
            result |= ((b & 0x7f) as u64) << shift;
            if b & 0x80 == 0 { break; }
            shift += 7;
            if shift >= 64 { return Err("varint overflow".into()); }
        }
        Ok(result)
    }

    fn svarint(&mut self) -> Result<i64, String> {
        let n = self.uvarint()?;
        Ok(((n >> 1) as i64) ^ -((n & 1) as i64))
    }

    fn skip(&mut self, n: usize) -> Result<(), String> {
        self.ensure(n)?;
        self.pos += n;
        Ok(())
    }

    fn ensure(&self, n: usize) -> Result<(), String> {
        if self.pos + n > self.data.len() {
            Err(format!("Decode buffer too short (need {} at pos {})", n, self.pos))
        } else {
            Ok(())
        }
    }
}

fn enc_str(buf: &mut Vec<u8>, s: &str) {
    buf.extend_from_slice(&(s.len() as i16).to_be_bytes());
    buf.extend_from_slice(s.as_bytes());
}

fn enc_i32(buf: &mut Vec<u8>, v: i32) {
    buf.extend_from_slice(&v.to_be_bytes());
}

fn enc_i64(buf: &mut Vec<u8>, v: i64) {
    buf.extend_from_slice(&v.to_be_bytes());
}

fn ms_to_rfc3339(ms: i64) -> String {
    use chrono::TimeZone;
    let secs = ms / 1000;
    let nanos = ((ms % 1000).max(0) * 1_000_000) as u32;
    chrono::Utc.timestamp_opt(secs, nanos)
        .single()
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string())
}

fn bytes_to_string(b: &[u8]) -> String {
    String::from_utf8(b.to_vec())
        .unwrap_or_else(|_| format!("<binary {} bytes>", b.len()))
}

// MetadataRequest v0 (API 3) — returns topics with partition/replica info
async fn wire_metadata(
    stream: &mut TcpStream,
    topics: &[&str],
) -> Result<Vec<TopicSummary>, String> {
    let mut body = Vec::new();
    enc_i32(&mut body, topics.len() as i32);
    for t in topics {
        enc_str(&mut body, t);
    }
    let resp = send_request(stream, 3, 0, 1, &body).await?;
    let mut d = Dec::new(&resp);
    // skip brokers array
    let broker_count = d.i32()?;
    for _ in 0..broker_count {
        d.i32()?; // node_id
        d.str()?; // host
        d.i32()?; // port
    }
    // topic metadata
    d.array(|d| {
        let _err = d.i16()?;
        let name = d.str()?;
        let partitions = d.array(|d| {
            d.i16()?; // partition error
            let _pid = d.i32()?;
            let _leader = d.i32()?;
            let replicas = d.array(|d| d.i32())?;
            d.array(|d| d.i32())?; // isr
            Ok(replicas.len() as i32)
        })?;
        let partition_count = partitions.len() as i32;
        let replication_factor = partitions.first().copied().unwrap_or(0);
        Ok(TopicSummary { name, partition_count, replication_factor })
    })
}

// ListOffsetsRequest v0 (API 2) — earliest (-2) or latest (-1)
async fn wire_list_offsets(
    stream: &mut TcpStream,
    topic: &str,
    partition_ids: &[i32],
    timestamp: i64, // -1 = latest, -2 = earliest
) -> Result<Vec<(i32, i64)>, String> {
    let mut body = Vec::new();
    enc_i32(&mut body, -1); // replica_id
    enc_i32(&mut body, 1);  // topic count
    enc_str(&mut body, topic);
    enc_i32(&mut body, partition_ids.len() as i32);
    for &pid in partition_ids {
        enc_i32(&mut body, pid);
        enc_i64(&mut body, timestamp);
        enc_i32(&mut body, 1); // max_num_offsets (v0 only)
    }
    let resp = send_request(stream, 2, 0, 2, &body).await?;
    let mut d = Dec::new(&resp);
    let mut result = Vec::new();
    d.array(|d| {
        let _topic = d.str()?;
        d.array(|d| {
            let pid = d.i32()?;
            let _err = d.i16()?;
            let offsets = d.array(|d| d.i64())?;
            let offset = offsets.into_iter().next().unwrap_or(-1);
            result.push((pid, offset));
            Ok(())
        })
    })?;
    Ok(result)
}

// ── Record set parsing ────────────────────────────────────────────────────────

fn parse_legacy_message(base_offset: i64, body: &[u8], partition: i32) -> Result<KafkaMessage, String> {
    // body starts at the message boundary: [crc:4][magic:1][attrs:1][timestamp?:8][key:bytes4][value:bytes4]
    if body.len() < 6 { return Err("message body too short".into()); }
    let magic = body[4];
    let attrs = body[5];
    let compression = attrs & 0x07;
    let mut d = Dec::new(body);
    d.skip(6)?; // crc + magic + attrs
    let timestamp_ms: i64 = if magic >= 1 { d.i64()? } else { 0 };
    let key = {
        let len = d.i32()?;
        if len < 0 { None } else {
            d.ensure(len as usize)?;
            let b = d.data[d.pos..d.pos + len as usize].to_vec();
            d.pos += len as usize;
            Some(b)
        }
    };
    let value = {
        let len = d.i32()?;
        if len < 0 { None } else {
            d.ensure(len as usize)?;
            let b = d.data[d.pos..d.pos + len as usize].to_vec();
            d.pos += len as usize;
            Some(b)
        }
    };
    let value_str = if compression != 0 {
        Some(format!("<compressed {} bytes>", value.as_ref().map_or(0, |b: &Vec<u8>| b.len())))
    } else {
        value.map(|b| bytes_to_string(&b))
    };
    Ok(KafkaMessage {
        offset: base_offset,
        partition,
        timestamp: ms_to_rfc3339(timestamp_ms),
        key: key.map(|b| bytes_to_string(&b)),
        value: value_str,
        headers: Default::default(),
    })
}

fn parse_record_batch(base_offset: i64, body: &[u8], partition: i32) -> Result<Vec<KafkaMessage>, String> {
    // body starts at partition_leader_epoch: [ple:4][magic:1][crc:4][attrs:2][last_offset_delta:4]
    //   [base_timestamp:8][max_timestamp:8][producer_id:8][producer_epoch:2][base_seq:4][count:4][records...]
    let mut d = Dec::new(body);
    d.skip(4)?; // partition_leader_epoch
    d.skip(1)?; // magic (already known = 2)
    d.skip(4)?; // crc32c
    let attrs = d.i16()?;
    let compression = attrs & 0x07;
    d.skip(4)?; // last_offset_delta
    let base_timestamp = d.i64()?;
    d.skip(8)?; // max_timestamp
    d.skip(8)?; // producer_id
    d.skip(2)?; // producer_epoch
    d.skip(4)?; // base_sequence
    let records_count = d.i32()?;

    if compression != 0 {
        return Ok(vec![KafkaMessage {
            offset: base_offset,
            partition,
            timestamp: ms_to_rfc3339(base_timestamp),
            key: None,
            value: Some(format!("<compressed batch {} records>", records_count)),
            headers: Default::default(),
        }]);
    }

    let mut messages = Vec::new();
    for _ in 0..records_count {
        let _record_len = d.svarint()?;
        d.ensure(1)?;
        d.pos += 1; // attributes (i8)
        let timestamp_delta = d.svarint()?;
        let offset_delta = d.svarint()?;
        let key_len = d.svarint()?;
        let key = if key_len < 0 {
            None
        } else {
            d.ensure(key_len as usize)?;
            let b = d.data[d.pos..d.pos + key_len as usize].to_vec();
            d.pos += key_len as usize;
            Some(bytes_to_string(&b))
        };
        let val_len = d.svarint()?;
        let value = if val_len < 0 {
            None
        } else {
            d.ensure(val_len as usize)?;
            let b = d.data[d.pos..d.pos + val_len as usize].to_vec();
            d.pos += val_len as usize;
            Some(bytes_to_string(&b))
        };
        let headers_count = d.uvarint()?;
        let mut headers = std::collections::HashMap::new();
        for _ in 0..headers_count {
            let hk_len = d.svarint()?;
            let hk = if hk_len <= 0 {
                String::new()
            } else {
                d.ensure(hk_len as usize)?;
                let s = String::from_utf8_lossy(&d.data[d.pos..d.pos + hk_len as usize]).to_string();
                d.pos += hk_len as usize;
                s
            };
            let hv_len = d.svarint()?;
            let hv = if hv_len <= 0 {
                String::new()
            } else {
                d.ensure(hv_len as usize)?;
                let s = String::from_utf8_lossy(&d.data[d.pos..d.pos + hv_len as usize]).to_string();
                d.pos += hv_len as usize;
                s
            };
            headers.insert(hk, hv);
        }
        messages.push(KafkaMessage {
            offset: base_offset + offset_delta,
            partition,
            timestamp: ms_to_rfc3339(base_timestamp + timestamp_delta),
            key,
            value,
            headers,
        });
    }
    Ok(messages)
}

fn parse_record_set(data: &[u8], partition: i32) -> Result<Vec<KafkaMessage>, String> {
    let mut messages = Vec::new();
    let mut pos = 0usize;
    while pos + 12 <= data.len() {
        let base_offset = i64::from_be_bytes(data[pos..pos + 8].try_into().unwrap());
        let entry_size = i32::from_be_bytes(data[pos + 8..pos + 12].try_into().unwrap());
        if entry_size <= 0 { break; }
        let entry_size = entry_size as usize;
        if pos + 12 + entry_size > data.len() { break; } // truncated at end, normal
        let body = &data[pos + 12..pos + 12 + entry_size];
        if body.len() >= 5 {
            let magic = body[4];
            match magic {
                0 | 1 => {
                    if let Ok(msg) = parse_legacy_message(base_offset, body, partition) {
                        messages.push(msg);
                    }
                }
                2 => {
                    if let Ok(mut batch) = parse_record_batch(base_offset, body, partition) {
                        messages.append(&mut batch);
                    }
                }
                _ => {}
            }
        }
        pos += 12 + entry_size;
    }
    Ok(messages)
}

// FetchRequest v1 (API 1) — fetch messages from a single partition
async fn wire_fetch(
    stream: &mut TcpStream,
    topic: &str,
    partition: i32,
    fetch_offset: i64,
    max_bytes: i32,
) -> Result<Vec<KafkaMessage>, String> {
    let mut body = Vec::new();
    enc_i32(&mut body, -1);        // replica_id
    enc_i32(&mut body, 5_000);     // max_wait_ms
    enc_i32(&mut body, 1);         // min_bytes
    enc_i32(&mut body, 1);         // topics count
    enc_str(&mut body, topic);
    enc_i32(&mut body, 1);         // partitions count
    enc_i32(&mut body, partition);
    enc_i64(&mut body, fetch_offset);
    enc_i32(&mut body, max_bytes);
    let resp = send_request(stream, 1, 1, 6, &body).await?;
    let mut d = Dec::new(&resp);
    d.skip(4)?; // throttle_time_ms
    let topic_count = d.i32()?;
    if topic_count < 1 { return Ok(vec![]); }
    let _resp_topic = d.str()?;
    let part_count = d.i32()?;
    if part_count < 1 { return Ok(vec![]); }
    let _resp_part = d.i32()?;
    let err = d.i16()?;
    let _high_watermark = d.i64()?;
    let rset_len = d.i32()?;
    if err != 0 {
        return Err(format!("Kafka fetch error code {}", err));
    }
    if rset_len <= 0 {
        return Ok(vec![]);
    }
    d.ensure(rset_len as usize)?;
    let rset_bytes = d.data[d.pos..d.pos + rset_len as usize].to_vec();
    parse_record_set(&rset_bytes, partition)
}

// ListGroupsRequest v0 (API 16)
async fn wire_list_groups(stream: &mut TcpStream) -> Result<Vec<GroupSummary>, String> {
    let resp = send_request(stream, 16, 0, 3, &[]).await?;
    let mut d = Dec::new(&resp);
    let _err = d.i16()?;
    d.array(|d| {
        let group_id = d.str()?;
        let protocol_type = d.str()?;
        Ok(GroupSummary { group_id, state: String::new(), protocol_type })
    })
}

// DescribeGroupsRequest v0 (API 15)
async fn wire_describe_groups(
    stream: &mut TcpStream,
    group_ids: &[&str],
) -> Result<Vec<(String, String, Vec<GroupMember>)>, String> {
    // returns (group_id, state, members)
    let mut body = Vec::new();
    enc_i32(&mut body, group_ids.len() as i32);
    for gid in group_ids {
        enc_str(&mut body, gid);
    }
    let resp = send_request(stream, 15, 0, 4, &body).await?;
    let mut d = Dec::new(&resp);
    d.array(|d| {
        let _err = d.i16()?;
        let group_id = d.str()?;
        let state = d.str()?;
        let _protocol_type = d.str()?;
        let _protocol = d.str()?;
        let members = d.array(|d| {
            let member_id = d.str()?;
            let client_id = d.str()?;
            let client_host = d.str()?;
            d.bytes()?; // member_metadata
            d.bytes()?; // member_assignment
            Ok(GroupMember { member_id, client_id, client_host })
        })?;
        Ok((group_id, state, members))
    })
}

// OffsetFetchRequest v1 (API 9) — committed offsets for a group per topic/partition
async fn wire_offset_fetch(
    stream: &mut TcpStream,
    group_id: &str,
    // topic -> partition ids
    topics: &[(&str, Vec<i32>)],
) -> Result<Vec<(String, i32, i64)>, String> {
    // returns (topic, partition, committed_offset)
    let mut body = Vec::new();
    enc_str(&mut body, group_id);
    enc_i32(&mut body, topics.len() as i32);
    for (topic, parts) in topics {
        enc_str(&mut body, topic);
        enc_i32(&mut body, parts.len() as i32);
        for &p in parts {
            enc_i32(&mut body, p);
        }
    }
    let resp = send_request(stream, 9, 1, 5, &body).await?;
    let mut d = Dec::new(&resp);
    let mut result = Vec::new();
    d.array(|d| {
        let topic = d.str()?;
        d.array(|d| {
            let partition = d.i32()?;
            let offset = d.i64()?;
            d.str()?; // metadata
            let _err = d.i16()?;
            if offset >= 0 {
                result.push((topic.clone(), partition, offset));
            }
            Ok(())
        })
    })?;
    Ok(result)
}

// DescribeConfigs v0 (API 32) — topic config entries (retention.ms, cleanup.policy, etc.)
async fn wire_describe_configs(
    stream: &mut TcpStream,
    topic: &str,
) -> Result<Vec<TopicConfig>, String> {
    let mut body = Vec::new();
    enc_i32(&mut body, 1);     // 1 resource
    body.push(2u8);            // resource_type = TOPIC
    enc_str(&mut body, topic);
    enc_i32(&mut body, 0);     // config_names: empty array = all configs

    let resp = send_request(stream, 32, 0, 6, &body).await?;
    let mut d = Dec::new(&resp);

    d.i32()?; // throttle_time_ms

    let mut result = Vec::new();
    d.array(|d| {
        let _err = d.i16()?;
        let _msg = d.nullable_str()?;
        d.skip(1)?;      // resource_type (i8)
        let _rname = d.str()?;
        d.array(|d| {
            let name = d.str()?;
            let value = d.nullable_str()?;
            d.bool_val()?; // read_only
            d.bool_val()?; // is_default
            d.bool_val()?; // is_sensitive
            result.push(TopicConfig { name, value });
            Ok(())
        })?;
        Ok(())
    })?;

    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn kafka_list_configs(app: AppHandle) -> Result<Vec<BrokerConfig>, String> {
    Ok(load_configs(&app))
}

#[tauri::command]
pub async fn kafka_save_config(app: AppHandle, mut config: BrokerConfig) -> Result<BrokerConfig, String> {
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
pub async fn kafka_delete_config(app: AppHandle, config_id: String) -> Result<(), String> {
    let mut configs = load_configs(&app);
    configs.retain(|c| c.id != config_id);
    save_configs(&app, &configs)
}

#[tauri::command]
pub async fn kafka_test_connection(app: AppHandle, config_id: String) -> Result<(), String> {
    let config = find_config(&app, &config_id)?;
    // open_kafka_stream already probes with a MetadataRequest, so success == connected
    open_kafka_stream(&config).await?;
    Ok(())
}

#[tauri::command]
pub async fn kafka_list_topics(app: AppHandle, config_id: String) -> Result<Vec<TopicSummary>, String> {
    let config = find_config(&app, &config_id)?;
    let mut stream = open_kafka_stream(&config).await?;
    let mut topics = wire_metadata(&mut stream, &[]).await?;
    topics.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(topics)
}

#[tauri::command]
pub async fn kafka_topic_details(
    app: AppHandle,
    config_id: String,
    topic: String,
) -> Result<TopicDetails, String> {
    let config = find_config(&app, &config_id)?;
    let mut stream = open_kafka_stream(&config).await?;

    // Get partition metadata
    let meta = wire_metadata(&mut stream, &[topic.as_str()]).await?;
    let summary = meta.into_iter().find(|t| t.name == topic)
        .ok_or_else(|| format!("Topic '{}' not found", topic))?;

    let partition_ids: Vec<i32> = (0..summary.partition_count).collect();

    // Get earliest offsets
    let earliest = wire_list_offsets(&mut stream, &topic, &partition_ids, -2).await
        .unwrap_or_default();
    // Get latest offsets
    let latest = wire_list_offsets(&mut stream, &topic, &partition_ids, -1).await
        .unwrap_or_default();

    let earliest_map: std::collections::HashMap<i32, i64> = earliest.into_iter().collect();
    let latest_map: std::collections::HashMap<i32, i64> = latest.into_iter().collect();

    let partitions: Vec<PartitionInfo> = partition_ids.iter().map(|&id| PartitionInfo {
        id,
        leader: 0, // metadata doesn't surface leader separately here
        earliest_offset: earliest_map.get(&id).copied().unwrap_or(-1),
        latest_offset: latest_map.get(&id).copied().unwrap_or(-1),
    }).collect();

    // Note: consumer groups are NOT gathered here — opening a topic must stay
    // cheap. The Consumers tab fetches them on demand via
    // `kafka_topic_consumer_groups`.
    Ok(TopicDetails {
        name: topic,
        partitions,
        replication_factor: summary.replication_factor,
    })
}

/// Consumer groups committed to a topic — used only when the user opens the
/// Consumers tab, never on topic open. Lists every group once, then asks each
/// for its committed offsets on this topic's partitions over a single
/// connection. `wire_offset_fetch` only returns partitions with a real (>= 0)
/// committed offset, so groups that never consumed this topic contribute
/// nothing.
#[tauri::command]
pub async fn kafka_topic_consumer_groups(
    app: AppHandle,
    config_id: String,
    topic: String,
) -> Result<Vec<GroupLag>, String> {
    let config = find_config(&app, &config_id)?;
    let mut stream = open_kafka_stream(&config).await?;

    let meta = wire_metadata(&mut stream, &[topic.as_str()]).await?;
    let summary = meta.into_iter().find(|t| t.name == topic)
        .ok_or_else(|| format!("Topic '{}' not found", topic))?;
    let partition_ids: Vec<i32> = (0..summary.partition_count).collect();

    let latest: std::collections::HashMap<i32, i64> =
        wire_list_offsets(&mut stream, &topic, &partition_ids, -1).await
            .unwrap_or_default()
            .into_iter()
            .collect();

    let groups = wire_list_groups(&mut stream).await?;
    let topics_arg = [(topic.as_str(), partition_ids)];
    let mut result: Vec<GroupLag> = Vec::new();
    for g in &groups {
        match wire_offset_fetch(&mut stream, &g.group_id, &topics_arg).await {
            Ok(offsets) => {
                for (_t, partition, committed_offset) in offsets {
                    let latest_off = latest.get(&partition).copied().unwrap_or(-1);
                    let lag = if latest_off >= 0 && committed_offset >= 0 {
                        latest_off - committed_offset
                    } else {
                        -1
                    };
                    result.push(GroupLag { group_id: g.group_id.clone(), partition, committed_offset, lag });
                }
            }
            // A read error leaves the TCP stream in an unknown state. Stop here
            // rather than continuing: subsequent reads on a corrupted stream
            // would each block for the full 30 s timeout before failing.
            Err(_) => break,
        }
    }
    result.sort_by(|a, b| a.group_id.cmp(&b.group_id).then(a.partition.cmp(&b.partition)));
    Ok(result)
}

#[tauri::command]
pub async fn kafka_topic_configs(
    app: AppHandle,
    config_id: String,
    topic: String,
) -> Result<Vec<TopicConfig>, String> {
    let config = find_config(&app, &config_id)?;
    let mut stream = open_kafka_stream(&config).await?;
    wire_describe_configs(&mut stream, &topic).await
}

#[tauri::command]
pub async fn kafka_create_topic(
    app: AppHandle,
    config_id: String,
    name: String,
    num_partitions: i32,
    replication_factor: i16,
) -> Result<(), String> {
    let config = find_config(&app, &config_id)?;
    let client = make_client(&config).await?;
    let controller = client.controller_client().map_err(|e| e.to_string())?;
    controller
        .create_topic(name, num_partitions, replication_factor, 5_000)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kafka_delete_topic(
    app: AppHandle,
    config_id: String,
    name: String,
) -> Result<(), String> {
    let config = find_config(&app, &config_id)?;
    let client = make_client(&config).await?;
    let controller = client.controller_client().map_err(|e| e.to_string())?;
    controller
        .delete_topic(name, 5_000)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kafka_list_groups(
    app: AppHandle,
    config_id: String,
) -> Result<Vec<GroupSummary>, String> {
    let config = find_config(&app, &config_id)?;
    let mut stream = open_kafka_stream(&config).await?;
    let mut groups = wire_list_groups(&mut stream).await?;

    if !groups.is_empty() {
        let gids: Vec<&str> = groups.iter().map(|g| g.group_id.as_str()).collect();
        if let Ok(details) = wire_describe_groups(&mut stream, &gids).await {
            let state_map: std::collections::HashMap<String, String> =
                details.into_iter().map(|(id, state, _members)| (id, state)).collect();
            for g in &mut groups {
                if let Some(state) = state_map.get(&g.group_id) {
                    g.state = state.clone();
                }
            }
        }
    }

    groups.sort_by(|a, b| a.group_id.cmp(&b.group_id));
    Ok(groups)
}

#[tauri::command]
pub async fn kafka_group_details(
    app: AppHandle,
    config_id: String,
    group_id: String,
) -> Result<GroupDetails, String> {
    let config = find_config(&app, &config_id)?;
    let mut stream = open_kafka_stream(&config).await?;

    // Describe group for state + members
    let desc = wire_describe_groups(&mut stream, &[group_id.as_str()]).await?;
    let (state, members) = desc
        .into_iter()
        .find(|(id, _, _)| id == &group_id)
        .map(|(_, s, m)| (s, m))
        .unwrap_or_else(|| (String::from("Unknown"), Vec::new()));
    let member_count = members.len() as i32;

    // Get all topics so we can fetch offsets for all partitions
    let all_topics = wire_metadata(&mut stream, &[]).await?;

    // OffsetFetch: ask for all topic/partitions
    let topics_args: Vec<(&str, Vec<i32>)> = all_topics
        .iter()
        .map(|t| {
            let parts: Vec<i32> = (0..t.partition_count).collect();
            (t.name.as_str(), parts)
        })
        .collect();

    let committed = wire_offset_fetch(&mut stream, &group_id, &topics_args).await
        .unwrap_or_default();

    // Compute lag. Batch ListOffsets per topic (one request for all of a
    // topic's partitions) instead of one request per partition — avoids the
    // old N+1 (50 partitions = 50 round-trips).
    let mut by_topic: std::collections::HashMap<String, Vec<(i32, i64)>> = std::collections::HashMap::new();
    for (topic, partition, committed_offset) in committed {
        by_topic.entry(topic).or_default().push((partition, committed_offset));
    }

    let mut assignments = Vec::new();
    for (topic, parts) in by_topic {
        let pids: Vec<i32> = parts.iter().map(|(p, _)| *p).collect();
        let latest_map: std::collections::HashMap<i32, i64> =
            wire_list_offsets(&mut stream, &topic, &pids, -1).await
                .unwrap_or_default()
                .into_iter()
                .collect();
        for (partition, committed_offset) in parts {
            let latest = latest_map.get(&partition).copied().unwrap_or(-1);
            let lag = if latest >= 0 && committed_offset >= 0 {
                latest - committed_offset
            } else {
                -1
            };
            assignments.push(Assignment { topic: topic.clone(), partition, committed_offset, lag });
        }
    }

    assignments.sort_by(|a, b| a.topic.cmp(&b.topic).then(a.partition.cmp(&b.partition)));

    Ok(GroupDetails { group_id, state, member_count, members, assignments })
}

#[tauri::command]
pub async fn kafka_produce(
    app: AppHandle,
    config_id: String,
    topic: String,
    partition: Option<i32>,
    key: Option<String>,
    value: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<ProduceResult, String> {
    let config = find_config(&app, &config_id)?;
    let client = make_client(&config).await?;
    let part = partition.unwrap_or(0);
    let pc = client
        .partition_client(topic.as_str(), part, UnknownTopicHandling::Retry)
        .await
        .map_err(|e| e.to_string())?;

    let record_headers: std::collections::BTreeMap<String, Vec<u8>> = headers
        .unwrap_or_default()
        .into_iter()
        .map(|(k, v)| (k, v.into_bytes()))
        .collect();

    let record = Record {
        key: key.map(|k| k.into_bytes()),
        value: Some(value.into_bytes()),
        headers: record_headers,
        timestamp: Utc::now(),
    };
    let offsets = pc
        .produce(vec![record], Compression::NoCompression)
        .await
        .map_err(|e| e.to_string())?;

    let offset = offsets.into_iter().next().unwrap_or(-1);
    Ok(ProduceResult { partition: part, offset })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRecord {
    pub key: Option<String>,
    pub value: String,
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,
}

/// Produce many records to one partition in a single request (e.g. from a
/// pasted JSON array). Returns the assigned offsets in order.
#[tauri::command]
pub async fn kafka_produce_batch(
    app: AppHandle,
    config_id: String,
    topic: String,
    partition: Option<i32>,
    records: Vec<BatchRecord>,
) -> Result<Vec<i64>, String> {
    if records.is_empty() {
        return Err("No records to produce".into());
    }
    let config = find_config(&app, &config_id)?;
    let client = make_client(&config).await?;
    let part = partition.unwrap_or(0);
    let pc = client
        .partition_client(topic.as_str(), part, UnknownTopicHandling::Retry)
        .await
        .map_err(|e| e.to_string())?;

    let recs: Vec<Record> = records
        .into_iter()
        .map(|r| Record {
            key: r.key.map(|k| k.into_bytes()),
            value: Some(r.value.into_bytes()),
            headers: r.headers.into_iter().map(|(k, v)| (k, v.into_bytes())).collect(),
            timestamp: Utc::now(),
        })
        .collect();

    pc.produce(recs, Compression::NoCompression)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kafka_fetch_messages(
    app: AppHandle,
    config_id: String,
    topic: String,
    partition: i32,
    offset: i64,  // -1 = tail (latest - limit), >= 0 = exact offset
    limit: i32,
    // When set, fetch from the first offset whose timestamp is >= this epoch-ms
    // (resolved via ListOffsets). Takes precedence over `offset`.
    start_timestamp: Option<i64>,
) -> Result<Vec<KafkaMessage>, String> {
    let config = find_config(&app, &config_id)?;
    let mut stream = open_kafka_stream(&config).await?;

    let start_offset = if let Some(ts_ms) = start_timestamp {
        let offs = wire_list_offsets(&mut stream, &topic, &[partition], ts_ms)
            .await
            .unwrap_or_default();
        match offs.into_iter().next().map(|(_, o)| o) {
            Some(o) if o >= 0 => o,
            _ => return Ok(Vec::new()),
        }
    } else if offset < 0 {
        let offs = wire_list_offsets(&mut stream, &topic, &[partition], -1)
            .await
            .unwrap_or_default();
        let latest = offs.into_iter().next().map(|(_, o)| o).unwrap_or(0);
        (latest - limit as i64).max(0)
    } else {
        offset
    };

    let mut messages = wire_fetch(&mut stream, &topic, partition, start_offset, 10 * 1024 * 1024).await?;
    messages.truncate(limit as usize);
    Ok(messages)
}
