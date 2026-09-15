// Host cho plugin dịch vụ (tier B) — chạy sidecar như TIẾN TRÌNH RIÊNG.
//
// Vì sao không thêm lệnh vào `main.rs` cho mỗi plugin cần native:
// `tauri::generate_handler!` là macro lúc biên dịch, không đăng ký lệnh lúc
// chạy được. Và `panic = "abort"` trong profile release nghĩa là một panic
// trong code dịch vụ sẽ giết cả app, kéo theo mọi consumer Kafka và tab API
// Client đang mở của người dùng. Tiến trình riêng thì chỉ dịch vụ đó chết, lần
// gọi sau tự spawn lại.
//
// Giao thức: JSON theo dòng (JSONL) qua stdin/stdout. Một dòng vào là một
// request, một dòng ra là một response. Mỗi sidecar được phục vụ tuần tự bởi
// một mutex — đơn giản và đủ: khối lượng ở đây là lời gọi do người dùng bấm,
// không phải luồng dữ liệu nóng.
//
// HỢP ĐỒNG mà một sidecar phải giữ:
//   1. đọc từng dòng stdin, trả đúng một dòng JSON cho mỗi dòng nhận được;
//   2. THOÁT khi stdin đóng (EOF) — đây là cách tiến trình con được dọn khi app
//      tắt, kể cả lúc app bị kill và không kịp chạy hàm dọn nào;
//   3. không bao giờ ghi gì khác lên stdout (log thì ghi stderr).
//
// Ranh giới tin cậy: frontend nêu tên binary, nhưng chỉ tên nằm trong
// `ALLOWED_SERVICES` dưới đây mới được chạy. Danh sách sống ở Rust, không phải
// ở manifest, vì manifest do webview đọc — thứ ta đang muốn giới hạn.

use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

/// Phiên bản khung tin nhắn. Phải khớp `SERVICE_PROTOCOL` ở
/// src/platform/service.ts — lệch thì cả hai phía từ chối tử tế thay vì diễn
/// giải sai payload của nhau.
pub const SERVICE_PROTOCOL: u32 = 1;

const CALL_TIMEOUT: Duration = Duration::from_secs(30);

/// Binary sidecar được phép chạy. Mỗi mục PHẢI có một dòng tương ứng trong
/// `bundle.externalBin` của tauri.conf.json, nếu không nó sẽ không được đóng
/// gói cùng app và mọi lời gọi sẽ báo "không tìm thấy". Cũng phải có mặt trong
/// danh sách của `scripts/prepare-service-sidecars.mjs` — hai chỗ khai tay
/// song song vì Rust và Node không chia sẻ được hằng số qua ranh giới ngôn
/// ngữ; `allowlist_khop_voi_external_bin` dưới đây khoá vế phía tauri.conf.json.
///
/// `devtool-svc-echo` là plugin ví dụ tối giản (chỉ `ping`/`echo`, không có
/// giá trị người dùng) — nó tồn tại thuần để chứng minh đường end-to-end thật
/// của tier B trước khi có plugin thật cần tới cơ chế này, xem
/// `tests/service_echo.rs`. Chưa có `plugin.ts` nào khai `service` để gọi
/// tới nó, nên nó không xuất hiện ở bất cứ đâu trong UI.
const ALLOWED_SERVICES: &[&str] = &["devtool-svc-echo"];

#[derive(Debug, Deserialize)]
pub struct ServiceRequest {
    pub protocol: u32,
    pub id: String,
    pub plugin: String,
    pub bin: String,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

// `Deserialize` cũng cần, không chỉ `Serialize`: host PHÂN TÍCH phản hồi của
// sidecar thành đúng kiểu này trước khi chuyển tiếp cho webview — một sidecar
// trả JSON lệch hình dạng phải bị chặn ở đây, không phải lọt lên frontend.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceResponse {
    pub protocol: u32,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ServiceResponse {
    fn err(id: &str, message: impl Into<String>) -> Self {
        Self { protocol: SERVICE_PROTOCOL, id: id.to_string(), result: None, error: Some(message.into()) }
    }
}

/// Lý do một request bị từ chối TRƯỚC khi chạm tới tiến trình con. Tách khỏi
/// phần I/O để kiểm thử được mà không cần spawn gì cả.
pub fn reject_reason(request: &ServiceRequest) -> Option<String> {
    if request.protocol != SERVICE_PROTOCOL {
        return Some(format!(
            "lệch protocol: client {}, host {SERVICE_PROTOCOL}",
            request.protocol
        ));
    }
    if !ALLOWED_SERVICES.contains(&request.bin.as_str()) {
        return Some(format!(
            "dịch vụ \"{}\" không nằm trong allowlist của host",
            request.bin
        ));
    }
    None
}

struct Running {
    child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
}

#[derive(Default)]
pub struct ServiceRegistry {
    running: Mutex<HashMap<String, Running>>,
}

/// Sidecar nằm cạnh file thực thi của app — cùng quy ước với
/// `mcp_bridge::mcp_sidecar_path`, nên không cần thêm tauri-plugin-shell (và
/// không cần mở quyền chạy tiến trình ở tầng capability).
fn sidecar_path(bin: &str) -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("Không xác định được thư mục cài đặt của app")?;
    let name = if cfg!(windows) { format!("{bin}.exe") } else { bin.to_string() };
    let path = dir.join(name);
    if !path.exists() {
        return Err(format!(
            "Không thấy sidecar \"{bin}\" cạnh app — nhiều khả năng đây là bản dev (`tauri dev`), \
             vốn chỉ build bin mặc định (`devtool`) chứ không build các sidecar. \
             Chạy `cargo build --bin {bin}` để nó nằm cạnh trong target/debug rồi thử lại."
        ));
    }
    Ok(path)
}

async fn spawn(bin: &str) -> Result<Running, String> {
    let mut command = Command::new(sidecar_path(bin)?);
    running_from(&mut command).map_err(|e| format!("Không chạy được sidecar \"{bin}\": {e}"))
}

/// Dựng `Running` từ một lệnh bất kỳ. Tách khỏi `spawn` để test lái được đường
/// I/O thật (round-trip, timeout, tiến trình chết) bằng tiến trình sẵn có của
/// hệ điều hành, không phải ship thêm một binary giả chỉ để kiểm thử.
fn running_from(command: &mut Command) -> Result<Running, String> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        // Tiến trình con chết theo app kể cả khi không chạy được hàm dọn nào.
        // Vẫn giữ luật "thoát khi stdin EOF" trong hợp đồng: kill_on_drop chỉ
        // có tác dụng khi registry thật sự bị drop, điều không chắc xảy ra lúc
        // tiến trình cha bị kill.
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdin = child.stdin.take().ok_or("Sidecar không mở được stdin")?;
    let stdout = child.stdout.take().ok_or("Sidecar không mở được stdout")?;
    Ok(Running { child, stdin, stdout: BufReader::new(stdout).lines() })
}

/// Một vòng request/response trên tiến trình đang chạy. Trả `Err` khi ống dẫn
/// hỏng — người gọi sẽ giết tiến trình và để lần sau spawn lại.
async fn exchange(running: &mut Running, line: String, limit: Duration) -> Result<String, String> {
    running
        .stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("Không ghi được xuống sidecar: {e}"))?;
    running.stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    running.stdin.flush().await.map_err(|e| e.to_string())?;

    match timeout(limit, running.stdout.next_line()).await {
        Err(_) => Err(format!("Sidecar không trả lời trong {}s", limit.as_secs())),
        Ok(Err(e)) => Err(format!("Không đọc được từ sidecar: {e}")),
        Ok(Ok(None)) => Err("Sidecar đã đóng stdout".to_string()),
        Ok(Ok(Some(line))) => Ok(line),
    }
}

#[tauri::command]
pub async fn service_call(
    state: tauri::State<'_, ServiceRegistry>,
    request: ServiceRequest,
) -> Result<ServiceResponse, String> {
    if let Some(reason) = reject_reason(&request) {
        return Ok(ServiceResponse::err(&request.id, reason));
    }

    let line = match serde_json::to_string(&serde_json::json!({
        "protocol": request.protocol,
        "id": request.id,
        "plugin": request.plugin,
        "method": request.method,
        "params": request.params,
    })) {
        Ok(l) => l,
        Err(e) => return Ok(ServiceResponse::err(&request.id, e.to_string())),
    };

    let mut running_map = state.running.lock().await;
    if !running_map.contains_key(&request.bin) {
        match spawn(&request.bin).await {
            Ok(r) => {
                running_map.insert(request.bin.clone(), r);
            }
            Err(e) => return Ok(ServiceResponse::err(&request.id, e)),
        }
    }

    let running = running_map.get_mut(&request.bin).expect("vừa chèn ở trên");
    match exchange(running, line, CALL_TIMEOUT).await {
        Ok(reply) => match serde_json::from_str::<ServiceResponse>(&reply) {
            Ok(response) => Ok(response),
            Err(e) => {
                // Sidecar nói sai giao thức: ống dẫn coi như không còn tin được
                // (dòng vừa đọc có thể là log lạc vào stdout, và dòng kế tiếp
                // sẽ bị ghép nhầm với lời gọi sau). Dọn để lần sau bắt đầu sạch.
                kill(running_map.remove(&request.bin)).await;
                Ok(ServiceResponse::err(&request.id, format!("Phản hồi sidecar không hợp lệ: {e}")))
            }
        },
        Err(e) => {
            // Bao gồm cả TIMEOUT, và đó là lý do phải giết chứ không chỉ báo
            // lỗi: phản hồi muộn vẫn còn nằm trong ống và sẽ bị đọc nhầm thành
            // phản hồi của lời gọi kế tiếp.
            kill(running_map.remove(&request.bin)).await;
            Ok(ServiceResponse::err(&request.id, e))
        }
    }
}

#[tauri::command]
pub async fn service_stop(state: tauri::State<'_, ServiceRegistry>, bin: String) -> Result<(), String> {
    kill(state.running.lock().await.remove(&bin)).await;
    Ok(())
}

async fn kill(running: Option<Running>) {
    if let Some(mut r) = running {
        // Đóng stdin trước: sidecar đúng hợp đồng sẽ tự thoát, không cần SIGKILL.
        drop(r.stdin);
        let _ = r.child.kill().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(bin: &str, protocol: u32) -> ServiceRequest {
        ServiceRequest {
            protocol,
            id: "1".into(),
            plugin: "demo".into(),
            bin: bin.into(),
            method: "ping".into(),
            params: serde_json::Value::Null,
        }
    }

    #[test]
    fn tu_choi_binary_ngoai_allowlist() {
        // Điểm mấu chốt của ranh giới tin cậy: frontend nêu tên nào cũng được,
        // chỉ tên trong danh sách của Rust mới chạy.
        let reason = reject_reason(&request("/bin/sh", SERVICE_PROTOCOL)).expect("phải bị từ chối");
        assert!(reason.contains("allowlist"), "{reason}");

        let reason = reject_reason(&request("devtool-svc-chua-ton-tai", SERVICE_PROTOCOL))
            .expect("phải bị từ chối");
        assert!(reason.contains("allowlist"), "{reason}");
    }

    #[test]
    fn tu_choi_lech_protocol_truoc_ca_allowlist() {
        let reason = reject_reason(&request("/bin/sh", 99)).expect("phải bị từ chối");
        assert!(reason.contains("protocol"), "{reason}");
    }

    #[test]
    fn allowlist_khop_voi_external_bin() {
        // Một mục trong allowlist mà không được đóng gói thì mọi lời gọi tới nó
        // báo "không tìm thấy" trên máy người dùng, còn ở máy dev thì chạy tốt
        // — kiểu lệch chỉ lộ ra sau khi phát hành.
        let conf = include_str!("../tauri.conf.json");
        for bin in ALLOWED_SERVICES {
            assert!(
                conf.contains(&format!("binaries/{bin}")),
                "\"{bin}\" nằm trong ALLOWED_SERVICES nhưng thiếu trong bundle.externalBin"
            );
        }
    }

    /// `cat` là một sidecar hợp lệ một cách tình cờ: nó dội lại đúng dòng
    /// request, mà dòng đó đã mang `protocol` và `id` nên parse được thành một
    /// `ServiceResponse` không lỗi. Đủ để kiểm đường I/O thật mà không phải
    /// ship thêm binary nào.
    #[cfg(unix)]
    #[tokio::test]
    async fn round_trip_qua_ong_dan_that() {
        let mut cmd = Command::new("cat");
        let mut running = running_from(&mut cmd).expect("spawn cat");

        let line = r#"{"protocol":1,"id":"7","plugin":"demo","method":"ping","params":null}"#;
        let reply = exchange(&mut running, line.to_string(), Duration::from_secs(5))
            .await
            .expect("phải nhận được phản hồi");

        let parsed: ServiceResponse = serde_json::from_str(&reply).expect("phản hồi hợp lệ");
        assert_eq!(parsed.id, "7");
        assert_eq!(parsed.protocol, SERVICE_PROTOCOL);
        kill(Some(running)).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn sidecar_nuot_request_ma_khong_tra_loi_thi_bao_timeout() {
        // Đọc hết stdin nhưng không bao giờ ghi ra — đúng kiểu sidecar treo.
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg("while IFS= read -r _; do :; done");
        let mut running = running_from(&mut cmd).expect("spawn sh");

        let err = exchange(&mut running, "{}".to_string(), Duration::from_millis(200))
            .await
            .expect_err("phải timeout");
        assert!(err.contains("không trả lời"), "{err}");
        kill(Some(running)).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn sidecar_chet_thi_bao_dong_stdout_chu_khong_treo() {
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg("exit 0");
        let mut running = running_from(&mut cmd).expect("spawn sh");

        let err = exchange(&mut running, "{}".to_string(), Duration::from_secs(5))
            .await
            .expect_err("tiến trình đã chết");
        assert!(err.contains("stdout") || err.contains("ghi được"), "{err}");
        kill(Some(running)).await;
    }

    #[test]
    fn response_bo_qua_truong_rong_khi_serialize() {
        let json = serde_json::to_string(&ServiceResponse::err("7", "hỏng")).unwrap();
        assert!(json.contains("\"error\":\"hỏng\""), "{json}");
        assert!(!json.contains("result"), "{json}");
    }
}
