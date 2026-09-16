// Plugin dịch vụ tối giản (tier B) — chứng minh đường end-to-end THẬT của
// `service_host.rs` với một binary được build và đóng gói thật, không phải mô
// phỏng bằng `cat`/`sh` như các test trong service_host.rs.
//
// Không có giá trị người dùng: bốn method — `ping`, `echo` (một-lần) và
// `tick-stream`/`unknown-stream-method` (nhiều dòng, xem dưới). Chưa có
// plugin.ts nào khai `service` để gọi tới nó — nó tồn tại thuần để kiểm chứng
// cơ chế trước khi một plugin thật cần tới tier B.
//
// Hợp đồng phải giữ (xem đầu service_host.rs): đọc từng dòng JSON ở stdin, trả
// về ít nhất một dòng JSON mang đúng `id` đó cho mỗi dòng nhận được (nhiều dòng
// kết bằng `done: true` cho method mà chính sidecar coi là stream), THOÁT khi
// stdin đóng (EOF), không ghi gì khác lên stdout (log thì ghi stderr).

use std::io::{self, BufRead, Write};

use serde::{Deserialize, Serialize};

/// Phải khớp `SERVICE_PROTOCOL` ở service_host.rs / service.ts. Bin này biên
/// dịch tách biệt với module đó (không có crate `lib` dùng chung), nên hằng số
/// bị LẶP LẠI có chủ ý thay vì import — lệch nhau thì phía host tự phát hiện
/// và từ chối thay vì diễn giải sai payload.
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
        // Lỗi đọc hoặc EOF đều dừng vòng lặp — main() kết thúc, tiến trình
        // thoát. Đây chính là vế "thoát khi stdin đóng" của hợp đồng.
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }

        let mut wrote_err = false;
        for response in handle_line(&line) {
            let Ok(json) = serde_json::to_string(&response) else { continue };
            if writeln!(out, "{json}").is_err() || out.flush().is_err() {
                // Đầu đọc phía host đã đóng (ví dụ host bị kill) — không còn
                // ai nhận phản hồi tiếp theo trong CÙNG dòng này (một stream
                // có thể còn nhiều sự kiện dở dang); dừng viết cho dòng vào
                // hiện tại, vòng lặp `for line in …` ở ngoài sẽ tự thoát ở
                // lần đọc kế do stdin cũng đã đóng theo.
                wrote_err = true;
                break;
            }
        }
        if wrote_err {
            break;
        }
    }
}

/// Trả một `Vec` thay vì một `Response` duy nhất: `tick-stream` phát nhiều
/// dòng cho CÙNG một request, kết bằng `done: true` — đây chính là hành vi
/// `service_host.rs` (và `tests/service_echo.rs`) cần một sidecar thật để
/// kiểm, không mô phỏng được đầy đủ bằng `sh`/`cat`.
fn handle_line(line: &str) -> Vec<Response> {
    let req: Request = match serde_json::from_str(line) {
        Ok(r) => r,
        // Không có `id` đáng tin để gắn vào phản hồi khi chính JSON đã hỏng —
        // để rỗng còn hơn đoán bừa một id không khớp lời gọi nào.
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

/// `{ "count": N }` → N sự kiện `{0, 1, …, N-1}` rồi một dòng `done: true`.
/// `count` thiếu/không hợp lệ mặc định về 3 — đủ để một test gọi mà không cần
/// truyền tham số vẫn thấy hành vi nhiều-dòng thật sự.
fn tick_stream(id: String, params: &serde_json::Value) -> Vec<Response> {
    let count = params.get("count").and_then(serde_json::Value::as_u64).unwrap_or(3);
    let mut out: Vec<Response> = (0..count).map(|i| Response::event(id.clone(), serde_json::json!(i))).collect();
    out.push(Response::done(id));
    out
}
