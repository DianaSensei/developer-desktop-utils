// Minimal tier-B sidecar used to test `service_host.rs` end to end with a
// real built binary (the unit tests there use `cat`/`sh`). No user-facing
// value; no plugin calls it.
//
// Methods: `ping` and `echo` (one-shot) and `tick-stream` (several events
// ending with `done: true`). Follows the sidecar contract described at the
// top of service_host.rs.

use std::io::{self, BufRead, Write};

use serde::{Deserialize, Serialize};

/// Must match `SERVICE_PROTOCOL` in service_host.rs and service.ts. This
/// binary shares no crate with the host, so the value is duplicated. A
/// request with another protocol is rejected here.
const SERVICE_PROTOCOL: u32 = 1;

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

    fn err(id: String, message: impl Into<String>) -> Self {
        Self { protocol: SERVICE_PROTOCOL, id, result: None, error: Some(message.into()), stream: false, done: false }
    }

    fn event(id: String, result: serde_json::Value) -> Self {
        Self { protocol: SERVICE_PROTOCOL, id, result: Some(result), error: None, stream: true, done: false }
    }

    fn done(id: String) -> Self {
        Self { protocol: SERVICE_PROTOCOL, id, result: None, error: None, stream: true, done: true }
    }
}

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        // A read error or EOF ends the loop and the process: the "exit when
        // stdin closes" part of the contract.
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }

        let mut wrote_err = false;
        for response in handle_line(&line) {
            let Ok(json) = serde_json::to_string(&response) else { continue };
            if writeln!(out, "{json}").is_err() || out.flush().is_err() {
                // The host closed its end; stop writing for this line. The next
                // read will hit EOF and end the loop.
                wrote_err = true;
                break;
            }
        }
        if wrote_err {
            break;
        }
    }
}

/// Returns several responses because `tick-stream` emits multiple lines
/// for one request.
fn handle_line(line: &str) -> Vec<Response> {
    let req: Request = match serde_json::from_str(line) {
        Ok(r) => r,
        // Malformed JSON has no trustworthy id; answer with an empty one.
        Err(e) => return vec![Response::err(String::new(), format!("JSON không hợp lệ: {e}"))],
    };

    if req.protocol != SERVICE_PROTOCOL {
        return vec![Response::err(
            req.id,
            format!("lệch protocol: client {}, sidecar {SERVICE_PROTOCOL}", req.protocol),
        )];
    }

    match req.method.as_str() {
        "ping" => vec![Response::once(req.id, serde_json::json!("pong"))],
        "echo" => vec![Response::once(req.id, req.params)],
        "tick-stream" => tick_stream(req.id, &req.params),
        other => vec![Response::err(req.id, format!("method không hỗ trợ: \"{other}\""))],
    }
}

/// `{ "count": N }` emits events 0..N-1, then `done`. `count` defaults to 3.
fn tick_stream(id: String, params: &serde_json::Value) -> Vec<Response> {
    let count = params.get("count").and_then(serde_json::Value::as_u64).unwrap_or(3);
    let mut out: Vec<Response> = (0..count).map(|i| Response::event(id.clone(), serde_json::json!(i))).collect();
    out.push(Response::done(id));
    out
}
