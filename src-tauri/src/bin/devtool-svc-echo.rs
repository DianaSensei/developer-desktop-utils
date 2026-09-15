// Plugin dịch vụ tối giản (tier B) — chứng minh đường end-to-end THẬT của
// `service_host.rs` với một binary được build và đóng gói thật, không phải mô
// phỏng bằng `cat`/`sh` như các test trong service_host.rs.
//
// Không có giá trị người dùng: chỉ hai method, `ping` và `echo`. Chưa có
// plugin.ts nào khai `service` để gọi tới nó — nó tồn tại thuần để kiểm chứng
// cơ chế trước khi một plugin thật cần tới tier B.
//
// Hợp đồng phải giữ (xem đầu service_host.rs): đọc từng dòng JSON ở stdin, trả
// đúng một dòng JSON cho mỗi dòng nhận được, THOÁT khi stdin đóng (EOF), không
// ghi gì khác lên stdout (log thì ghi stderr).

use std::io::{self, BufRead, Write};

use serde::{Deserialize, Serialize};

/// Phải khớp `SERVICE_PROTOCOL` ở service_host.rs / service.ts. Bin này biên
/// dịch tách biệt với module đó (không có crate `lib` dùng chung), nên hằng số
/// bị LẶP LẠI có chủ ý thay vì import — lệch nhau thì phía host tự phát hiện
/// và từ chối thay vì diễn giải sai payload (test `lech_protocol_thi_tu_choi`
/// và `sidecar_noi_sai_giao_thuc` ở dưới).
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

#[derive(Serialize)]
struct Response {
    protocol: u32,
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
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

        let response = handle_line(&line);
        let Ok(json) = serde_json::to_string(&response) else { continue };
        if writeln!(out, "{json}").is_err() || out.flush().is_err() {
            // Đầu đọc phía host đã đóng (ví dụ host bị kill) — không còn ai
            // nhận phản hồi, không có gì để làm tiếp ngoài thoát theo EOF ở
            // vòng lặp `for line in …` lần kế.
            break;
        }
    }
}

fn handle_line(line: &str) -> Response {
    let req: Request = match serde_json::from_str(line) {
        Ok(r) => r,
        // Không có `id` đáng tin để gắn vào phản hồi khi chính JSON đã hỏng —
        // để rỗng còn hơn đoán bừa một id không khớp lời gọi nào.
        Err(e) => {
            return Response {
                protocol: SERVICE_PROTOCOL,
                id: String::new(),
                result: None,
                error: Some(format!("JSON không hợp lệ: {e}")),
            }
        }
    };

    if req.protocol != SERVICE_PROTOCOL {
        return Response {
            protocol: SERVICE_PROTOCOL,
            id: req.id,
            result: None,
            error: Some(format!(
                "lệch protocol: client {}, sidecar {SERVICE_PROTOCOL}",
                req.protocol
            )),
        };
    }

    match req.method.as_str() {
        "ping" => Response {
            protocol: SERVICE_PROTOCOL,
            id: req.id,
            result: Some(serde_json::json!("pong")),
            error: None,
        },
        "echo" => Response {
            protocol: SERVICE_PROTOCOL,
            id: req.id,
            result: Some(req.params),
            error: None,
        },
        other => Response {
            protocol: SERVICE_PROTOCOL,
            id: req.id,
            result: None,
            error: Some(format!("method không hỗ trợ: \"{other}\"")),
        },
    }
}
