// Host cho plugin dịch vụ (tier B) — chạy sidecar như TIẾN TRÌNH RIÊNG.
//
// Vì sao không thêm lệnh vào `main.rs` cho mỗi plugin cần native:
// `tauri::generate_handler!` là macro lúc biên dịch, không đăng ký lệnh lúc
// chạy được. Và `panic = "abort"` trong profile release nghĩa là một panic
// trong code dịch vụ sẽ giết cả app, kéo theo mọi consumer Kafka và tab API
// Client đang mở của người dùng. Tiến trình riêng thì chỉ dịch vụ đó chết, lần
// gọi sau tự spawn lại.
//
// Giao thức: JSON theo dòng (JSONL) qua stdin/stdout. Mỗi dòng ra mang một
// `id` khớp với dòng vào đã sinh ra nó. Có HAI kiểu lời gọi:
//   - MỘT-LẦN (`service_call`): sidecar trả đúng một dòng cho mỗi request.
//   - STREAM (`service_stream_start`/`_stop`): sidecar trả NHIỀU dòng cho
//     CÙNG một `id` (Pub/Sub, tail log…), cho tới khi tự gửi `done: true` hoặc
//     bị `service_stream_stop` yêu cầu ngừng route (sidecar không nhất thiết
//     biết việc dừng đó — dọn tài nguyên phía sidecar, nếu cần, là việc của
//     phương thức riêng sidecar tự định nghĩa, host không áp đặt).
//
// Một READER TASK riêng cho mỗi sidecar đọc liên tục và DEMUX theo `id` — đây
// là điểm khác biệt lớn nhất so với bản v1 (một mutex khoá trọn một vòng
// request/response): nó cho phép nhiều lời gọi đồng thời tới CÙNG một sidecar
// (một one-shot không phải đợi một stream đang chạy nhường chỗ), và biến lớp
// "phản hồi đến muộn bị đọc nhầm thành phản hồi của lời gọi kế tiếp" — vốn là
// rủi ro cố hữu của mô hình v1 — thành vô hại: một phản hồi tới khi waiter của
// nó đã bị dọn (do timeout) chỉ đơn giản không khớp `id` nào và bị bỏ qua.
//
// HỢP ĐỒNG mà một sidecar phải giữ:
//   1. đọc từng dòng stdin, trả về ít nhất một dòng JSON mang đúng `id` đó
//      (một dòng cho lời gọi thường; nhiều dòng, kết bằng `done: true`, cho
//      một lời gọi mà chính sidecar coi là stream);
//   2. THOÁT khi stdin đóng (EOF) — đây là cách tiến trình con được dọn khi app
//      tắt, kể cả lúc app bị kill và không kịp chạy hàm dọn nào;
//   3. không bao giờ ghi gì khác lên stdout (log thì ghi stderr).
//
// Ranh giới tin cậy: frontend nêu tên binary, nhưng chỉ tên nằm trong
// `ALLOWED_SERVICES` dưới đây mới được chạy. Danh sách sống ở Rust, không phải
// ở manifest, vì manifest do webview đọc — thứ ta đang muốn giới hạn.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{oneshot, Mutex as AsyncMutex};
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
/// `devtool-svc-echo` là plugin ví dụ tối giản (`ping`/`echo`/`tick-stream`,
/// không có giá trị người dùng) — nó tồn tại thuần để chứng minh đường
/// end-to-end thật của tier B, cả một-lần lẫn stream, trước khi có plugin thật
/// cần tới cơ chế này, xem `tests/service_echo.rs`. Chưa có `plugin.ts` nào
/// khai `service` để gọi tới nó, nên nó không xuất hiện ở bất cứ đâu trong UI.
const ALLOWED_SERVICES: &[&str] = &["devtool-svc-echo", "devtool-svc-redis"];

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

fn is_false(b: &bool) -> bool {
    !*b
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
    /// Dòng này là MỘT TRONG NHIỀU sự kiện của một stream, không phải phản hồi
    /// một-lần. Vắng mặt (hay `false`) tương thích ngược với mọi sidecar không
    /// biết gì về trường này (chúng chỉ bao giờ trả một-lần).
    #[serde(default, skip_serializing_if = "is_false")]
    pub stream: bool,
    /// Dòng CUỐI của một stream — sau dòng này sidecar sẽ không gửi thêm sự
    /// kiện nào cho đúng `id` này nữa. Chỉ có nghĩa khi đi kèm một lời gọi
    /// stream; host bỏ qua nó với lời gọi một-lần.
    #[serde(default, skip_serializing_if = "is_false")]
    pub done: bool,
}

impl ServiceResponse {
    fn err(id: &str, message: impl Into<String>) -> Self {
        Self {
            protocol: SERVICE_PROTOCOL,
            id: id.to_string(),
            result: None,
            error: Some(message.into()),
            stream: false,
            done: false,
        }
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

/// Nơi một dòng phản hồi (khớp `id`) được chuyển tới. `Once` giải quyết đúng
/// một lần rồi bị gỡ; `Stream` sống tới khi gặp `done: true`, gặp `error`,
/// hoặc bị `service_stream_stop` gỡ tay.
enum Waiter {
    Once(oneshot::Sender<ServiceResponse>),
    Stream(Box<dyn EventSink>),
}

/// Trừu tượng hoá "gửi một sự kiện ra ngoài" — tách khỏi `tauri::ipc::Channel`
/// cụ thể để TEST ĐƯỢC bằng một tiến trình thật (`sh`) và một sink thu thập
/// vào bộ nhớ, không cần dựng một `Channel` thật (chỉ construct được thông qua
/// một lời gọi Tauri command thật đang chạy trong app — xem lý do tương tự ở
/// `artifact_installer.rs` về việc không dựng `AppHandle` giả trong test).
trait EventSink: Send {
    fn send(&self, value: serde_json::Value);
}

struct ChannelSink(Channel<serde_json::Value>);

impl EventSink for ChannelSink {
    fn send(&self, value: serde_json::Value) {
        let _ = self.0.send(value);
    }
}

type Waiters = Arc<StdMutex<HashMap<String, Waiter>>>;

struct RunningSidecar {
    child: AsyncMutex<Child>,
    stdin: AsyncMutex<ChildStdin>,
    waiters: Waiters,
}

#[derive(Default, Clone)]
pub struct ServiceRegistry {
    running: Arc<AsyncMutex<HashMap<String, Arc<RunningSidecar>>>>,
}

/// Phần "tìm cạnh file thực thi" của `sidecar_path` — hành vi gốc, giữ
/// NGUYÊN, chỉ tách `dir` ra làm tham số để test được (`current_exe()` trong
/// một `cargo test` binary trỏ tới chính binary test, không phải nơi ta muốn
/// kiểm). Vẫn là fallback SAU CÙNG khi không có bản tải-về nào — xem
/// `sidecar_path` bên dưới.
fn resolve_beside_dir(dir: &std::path::Path, bin: &str) -> Result<std::path::PathBuf, String> {
    let name = if cfg!(windows) { format!("{bin}.exe") } else { bin.to_string() };
    let path = dir.join(name);
    if !path.exists() {
        return Err(format!(
            "Không thấy sidecar \"{bin}\" cạnh app, và cũng chưa cài qua Settings → Extensions. \
             Nhiều khả năng đây là bản dev (`tauri dev`), vốn chỉ build bin mặc định (`devtool`) \
             chứ không build các sidecar. Chạy `cargo build --bin {bin}` để nó nằm cạnh trong \
             target/debug rồi thử lại, hoặc cài sidecar này qua URL trong Settings."
        ));
    }
    Ok(path)
}

/// Hợp cả hai nguồn, THUẦN (không đụng `AppHandle`/`current_exe()`) — dùng bởi
/// cả `sidecar_path` thật (dưới đây) lẫn test của module này, không cần dựng
/// một AppHandle giả (không thể — xem `artifact_installer.rs` đầu file đó về
/// lý do).
///
/// **Thứ tự CỐ Ý, không được đảo ngược** (xem "Quyết định quan trọng nhất" ở
/// `docs/plans/native-sidecar-install.md`): tải-về qua `extensions/index.json`
/// (nếu có bản ghi VÀ file còn tồn tại trên đĩa) LUÔN được ưu tiên trước bản
/// đóng gói sẵn cạnh exe. Điều này phục vụ trực tiếp mục tiêu đã chốt: một khi
/// `bundle.externalBin` không còn liệt kê một bin nào đó, fallback tự nhiên
/// biến mất — không cần sửa hàm này lần nữa.
fn resolve_sidecar_path(
    index_dir: Option<&std::path::Path>,
    beside_dir: &std::path::Path,
    bin: &str,
) -> Result<std::path::PathBuf, String> {
    if let Some(dir) = index_dir {
        if let Some(path) = crate::artifact_installer::installed_service_bin_path_at(dir, bin) {
            return Ok(path);
        }
    }
    resolve_beside_dir(beside_dir, bin)
}

/// **HÀM BIÊN GIỚI TIN CẬY** — quyết định binary NÀO thực sự bị spawn cho một
/// tên `bin` đã qua `ALLOWED_SERVICES`. Đọc phần `kind=service` của
/// `extensions/index.json` (nhánh service của `artifact_installer.rs`, xem
/// module đó) TRƯỚC; chỉ khi không có bản ghi hợp lệ (không có bản ghi, hoặc
/// có bản ghi nhưng file đã mất khỏi đĩa — đĩa hỏng/xoá thủ công) mới rơi
/// xuống hành vi CŨ (tìm cạnh `current_exe()`, đúng quy ước với
/// `mcp_bridge::mcp_sidecar_path`, nên không cần thêm tauri-plugin-shell hay
/// mở quyền chạy tiến trình ở tầng capability).
fn sidecar_path(app: &AppHandle, bin: &str) -> Result<std::path::PathBuf, String> {
    // `extensions_dir` tự tạo thư mục nếu chưa có — lỗi ở đây (app_data
    // không đọc được) không nên chặn hẳn fallback cạnh-exe, nên chỉ bỏ qua
    // (`.ok()`) thay vì `?`.
    let index_dir = crate::artifact_installer::extensions_dir(app).ok();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let beside_dir = exe
        .parent()
        .ok_or("Không xác định được thư mục cài đặt của app")?
        .to_path_buf();
    resolve_sidecar_path(index_dir.as_deref(), &beside_dir, bin)
}

/// Demux MỘT dòng đã phân tích vào đúng waiter của nó. Hàm THUẦN (không có gì
/// async) — dễ kiểm bằng cách gọi trực tiếp, không cần spawn tiến trình nào.
fn dispatch(waiters: &Waiters, response: ServiceResponse) {
    let mut w = waiters.lock().unwrap();
    // Gỡ trước rồi mới quyết định có chèn lại không — giữ cả borrow đọc lẫn
    // ghi cùng lúc trên cùng một entry sẽ không qua được borrow checker.
    let Some(waiter) = w.remove(&response.id) else {
        // Không ai còn chờ id này — đã timeout, hoặc rác. Bỏ qua có chủ ý:
        // đây chính là điều làm một phản hồi tới muộn trở nên VÔ HẠI, khác
        // hẳn bản v1 (một mutex khoá cả sidecar, phản hồi muộn ghép nhầm vào
        // lời gọi kế tiếp).
        return;
    };
    match waiter {
        Waiter::Once(tx) => {
            let _ = tx.send(response);
        }
        Waiter::Stream(sink) => {
            if response.error.is_some() || response.done {
                // Lỗi giữa chừng cũng coi như kết thúc — không lặng lẽ tiếp
                // tục route rác cho một stream đã báo hỏng.
                return;
            }
            sink.send(response.result.unwrap_or(serde_json::Value::Null));
            w.insert(response.id, Waiter::Stream(sink));
        }
    }
}

/// Vòng đọc của một sidecar — chạy suốt vòng đời tiến trình con, một task cho
/// mỗi sidecar. Kết thúc khi stdout đóng (tiến trình chết) hoặc sidecar nói
/// sai giao thức (từ đó ống dẫn không còn tin được nữa — không có cách nào
/// biết ranh giới dòng kế tiếp thật sự bắt đầu ở đâu). `on_ended` chạy đúng
/// một lần khi vòng đọc dừng, để lớp gọi tự quyết định dọn gì tiếp (production:
/// gỡ khỏi registry để lần sau spawn lại).
async fn reader_loop(
    mut lines: Lines<BufReader<ChildStdout>>,
    waiters: Waiters,
    on_ended: impl FnOnce() + Send + 'static,
) {
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => match serde_json::from_str::<ServiceResponse>(&line) {
                Ok(response) => dispatch(&waiters, response),
                Err(_) => break,
            },
            _ => break,
        }
    }
    // Mọi one-shot còn treo phải được giải quyết — nếu không, lời gọi phía
    // trên đợi timeout thay vì biết ngay sidecar đã thoát. Stream thì lặng lẽ
    // kết thúc: channel/sink không còn ai gửi thêm là tín hiệu đủ rõ.
    let mut w = waiters.lock().unwrap();
    for (_, waiter) in w.drain() {
        if let Waiter::Once(tx) = waiter {
            let _ = tx.send(ServiceResponse::err("", "Sidecar đã thoát hoặc nói sai giao thức"));
        }
    }
    drop(w);
    on_ended();
}

/// Spawn một tiến trình VÀ vòng đọc của nó. Nhận thẳng `Command` (không phải
/// tên bin) để test lái được bằng tiến trình sẵn có của OS (`cat`, `sh`) thay
/// vì ship thêm một binary giả.
fn spawn_process(
    command: &mut Command,
    on_ended: impl FnOnce() + Send + 'static,
) -> Result<Arc<RunningSidecar>, String> {
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
    let waiters: Waiters = Arc::default();

    tokio::spawn(reader_loop(BufReader::new(stdout).lines(), waiters.clone(), on_ended));

    Ok(Arc::new(RunningSidecar {
        child: AsyncMutex::new(child),
        stdin: AsyncMutex::new(stdin),
        waiters,
    }))
}

/// Thư mục dữ liệu bền của MỘT sidecar — `<app_data>/service-data/<bin>`. Hàm
/// THUẦN (chỉ ghép đường dẫn, không chạm đĩa) để test được không cần
/// `AppHandle`; `get_or_spawn` là nơi thật sự `create_dir_all` nó.
///
/// Cách ly bằng cấu trúc thư mục, không phải bằng quy ước đặt tên file: một
/// sidecar chỉ NHÌN THẤY thư mục của chính nó qua biến môi trường
/// `DEVTOOL_SERVICE_DATA_DIR` — nó không có cách nào biết (nói gì tới đọc/ghi)
/// thư mục app_data gốc hay thư mục của sidecar khác, kể cả nếu code của nó có
/// lỗi hay cố tình đoán đường dẫn. Khác hẳn quy ước cũ của các
/// `#[tauri::command]` biên dịch sẵn (`kafka-brokers.json`,
/// `rabbit-connections.json`, `container-connections.json`, `redis_tool.rs`'s
/// `redis-connections.json`) — các file đó vẫn nằm phẳng ngay dưới app_data
/// gốc, chỉ "cách ly" bằng việc mỗi module tự giác chỉ đụng đúng tên file của
/// mình, không có gì ở tầng hệ thống ngăn một lỗi gõ nhầm tên đọc/ghi nhầm file
/// của tool khác. Sidecar mới port sang (bắt đầu từ Redis) sửa đúng khoảng
/// trống này; các Tier A còn lại tự động được sửa khi tới lượt chúng port sang
/// Tier B ở các bước sau của Phase 2 (xem docs/decisions/platform-plugin-architecture.md).
fn service_data_dir(app_data_dir: &std::path::Path, bin: &str) -> std::path::PathBuf {
    app_data_dir.join("service-data").join(bin)
}

async fn get_or_spawn(app: &AppHandle, registry: &ServiceRegistry, bin: &str) -> Result<Arc<RunningSidecar>, String> {
    let mut map = registry.running.lock().await;
    if let Some(running) = map.get(bin) {
        return Ok(running.clone());
    }

    let mut command = Command::new(sidecar_path(app, bin)?);
    // Sidecar không có `AppHandle` — nó không phải một plugin JS chạy trong
    // webview, nên không đi qua `sdk.storage`/`app.path()`. Một sidecar cần
    // lưu gì đó bền (cấu hình kết nối, ví dụ) đọc thư mục NÀY, chỉ của riêng
    // nó, qua biến môi trường — không phải toàn bộ app_data_dir.
    if let Ok(app_data) = app.path().app_data_dir() {
        let dir = service_data_dir(&app_data, bin);
        if std::fs::create_dir_all(&dir).is_ok() {
            command.env("DEVTOOL_SERVICE_DATA_DIR", dir);
        }
    }
    let cleanup_registry = registry.clone();
    let cleanup_bin = bin.to_string();
    let running = spawn_process(&mut command, move || {
        // Dọn KHÔNG ĐỒNG BỘ với việc vòng đọc kết thúc: `on_ended` phải là một
        // closure THƯỜNG (reader_loop không muốn phụ thuộc kiểu future cụ thể
        // nào), nên việc gỡ khỏi map — vốn cần `.await` để khoá — được giao
        // cho một task riêng. Trong lúc đó, một lời gọi mới TỚI ĐÚNG sidecar
        // này vẫn dùng được `Arc` cũ cho tới khi nó bị gỡ (ghi xuống stdin đã
        // đóng sẽ tự báo lỗi cho người gọi đó — tự sửa, không cần đồng bộ chặt).
        tokio::spawn(async move {
            cleanup_registry.running.lock().await.remove(&cleanup_bin);
        });
    })
    .map_err(|e| format!("Không chạy được sidecar \"{bin}\": {e}"))?;

    map.insert(bin.to_string(), running.clone());
    Ok(running)
}

async fn write_line(running: &RunningSidecar, line: &str) -> Result<(), String> {
    let mut stdin = running.stdin.lock().await;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("Không ghi được xuống sidecar: {e}"))?;
    stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())
}

fn encode(request: &ServiceRequest) -> Result<String, String> {
    serde_json::to_string(&serde_json::json!({
        "protocol": request.protocol,
        "id": request.id,
        "plugin": request.plugin,
        "method": request.method,
        "params": request.params,
    }))
    .map_err(|e| e.to_string())
}

/// Một vòng request/response MỘT-LẦN thật sự (dùng bởi cả `service_call` và
/// các test dưới): đăng ký waiter TRƯỚC khi ghi dòng ra — đăng ký sau khi ghi
/// sẽ để lọt một khoảng hở lý thuyết nơi phản hồi tới trước khi có ai chờ nó.
async fn call_once(running: &RunningSidecar, request: &ServiceRequest, limit: Duration) -> ServiceResponse {
    let line = match encode(request) {
        Ok(l) => l,
        Err(e) => return ServiceResponse::err(&request.id, e),
    };

    let (tx, rx) = oneshot::channel();
    running.waiters.lock().unwrap().insert(request.id.clone(), Waiter::Once(tx));

    if let Err(e) = write_line(running, &line).await {
        running.waiters.lock().unwrap().remove(&request.id);
        return ServiceResponse::err(&request.id, e);
    }

    match timeout(limit, rx).await {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => ServiceResponse::err(&request.id, "Sidecar đã thoát trước khi trả lời"),
        Err(_) => {
            // KHÔNG giết sidecar ở đây, khác bản v1: với việc route theo `id`,
            // một phản hồi tới muộn cho ĐÚNG lời gọi này giờ vô hại — nó chỉ
            // không tìm thấy waiter (đã gỡ ngay dưới) và bị bỏ qua. Lời gọi
            // khác, đồng thời, tới cùng sidecar không phải trả giá cho một
            // lời gọi chậm.
            running.waiters.lock().unwrap().remove(&request.id);
            ServiceResponse::err(&request.id, format!("Sidecar không trả lời trong {}s", limit.as_secs()))
        }
    }
}

#[tauri::command]
pub async fn service_call(
    app: AppHandle,
    state: tauri::State<'_, ServiceRegistry>,
    request: ServiceRequest,
) -> Result<ServiceResponse, String> {
    if let Some(reason) = reject_reason(&request) {
        return Ok(ServiceResponse::err(&request.id, reason));
    }
    let running = match get_or_spawn(&app, &state, &request.bin).await {
        Ok(r) => r,
        Err(e) => return Ok(ServiceResponse::err(&request.id, e)),
    };
    Ok(call_once(&running, &request, CALL_TIMEOUT).await)
}

/// Bắt đầu một stream: ghi request, đăng ký `channel` để nhận MỌI sự kiện
/// mang đúng `request.id` cho tới khi sidecar gửi `done: true` hoặc
/// `service_stream_stop` được gọi. KHÔNG đợi sự kiện đầu tiên — trả về ngay
/// sau khi ghi xong, vì một stream có thể không bao giờ có sự kiện nào cho
/// tới khi có dữ liệu thật (một kênh Pub/Sub im lặng chẳng hạn).
#[tauri::command]
pub async fn service_stream_start(
    app: AppHandle,
    state: tauri::State<'_, ServiceRegistry>,
    request: ServiceRequest,
    channel: Channel<serde_json::Value>,
) -> Result<(), String> {
    if let Some(reason) = reject_reason(&request) {
        return Err(reason);
    }
    let running = get_or_spawn(&app, &state, &request.bin).await?;
    let line = encode(&request)?;

    running
        .waiters
        .lock()
        .unwrap()
        .insert(request.id.clone(), Waiter::Stream(Box::new(ChannelSink(channel))));

    if let Err(e) = write_line(&running, &line).await {
        running.waiters.lock().unwrap().remove(&request.id);
        return Err(e);
    }
    Ok(())
}

/// Ngừng route sự kiện cho MỘT stream — không đảm bảo sidecar biết việc này
/// (host không áp đặt một quy ước "unsubscribe" chung cho mọi sidecar). Một
/// sidecar muốn dọn tài nguyên khi khách ngừng nghe nên tự định nghĩa một
/// phương thức riêng (ví dụ `unsubscribe`) mà client gọi qua `service_call`
/// TRƯỚC khi gọi hàm này.
#[tauri::command]
pub async fn service_stream_stop(
    state: tauri::State<'_, ServiceRegistry>,
    bin: String,
    id: String,
) -> Result<(), String> {
    if let Some(running) = state.running.lock().await.get(&bin) {
        running.waiters.lock().unwrap().remove(&id);
    }
    Ok(())
}

#[tauri::command]
pub async fn service_stop(state: tauri::State<'_, ServiceRegistry>, bin: String) -> Result<(), String> {
    if let Some(running) = state.running.lock().await.remove(&bin) {
        kill(running).await;
    }
    Ok(())
}

async fn kill(running: Arc<RunningSidecar>) {
    // Đóng stdin trước: sidecar đúng hợp đồng sẽ tự thoát, không cần SIGKILL.
    // `stdin`/`child` nằm sau `AsyncMutex` vì `RunningSidecar` được chia sẻ
    // (Arc) — một stream/one-shot khác có thể đang giữ nó đúng lúc này.
    drop(running.stdin.lock().await);
    let _ = running.child.lock().await.kill().await;
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
    fn service_data_dir_cach_ly_theo_ten_bin_khong_phai_ten_file() {
        let root = std::path::Path::new("/app-data");
        assert_eq!(service_data_dir(root, "devtool-svc-redis"), root.join("service-data").join("devtool-svc-redis"));
        // Hai sidecar khác nhau không bao giờ ra cùng một thư mục.
        assert_ne!(
            service_data_dir(root, "devtool-svc-redis"),
            service_data_dir(root, "devtool-svc-kafka"),
        );
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
        let running = spawn_process(&mut cmd, || {}).expect("spawn cat");

        let req = request("cat", SERVICE_PROTOCOL);
        let response = call_once(&running, &req, Duration::from_secs(5)).await;

        assert_eq!(response.id, "1");
        assert_eq!(response.protocol, SERVICE_PROTOCOL);
        assert!(response.error.is_none(), "{response:?}");
        kill(running).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn hai_loi_goi_dong_thoi_toi_cung_sidecar_khong_giam_len_nhau() {
        // Trần cũ (một mutex khoá cả sidecar cho MỘT vòng round-trip) sẽ khiến
        // lời gọi thứ hai đợi lời gọi thứ nhất xong xuôi. `cat` dội đúng dòng
        // gửi vào, nên hai id khác nhau phải nhận đúng phản hồi của MÌNH dù
        // gửi gần như cùng lúc.
        let mut cmd = Command::new("cat");
        let running = spawn_process(&mut cmd, || {}).expect("spawn cat");

        let mut a = request("cat", SERVICE_PROTOCOL);
        a.id = "a".into();
        let mut b = request("cat", SERVICE_PROTOCOL);
        b.id = "b".into();

        let (ra, rb) = tokio::join!(
            call_once(&running, &a, Duration::from_secs(5)),
            call_once(&running, &b, Duration::from_secs(5)),
        );
        assert_eq!(ra.id, "a");
        assert_eq!(rb.id, "b");
        kill(running).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timeout_khong_giet_sidecar_va_khong_anh_huong_loi_goi_khac() {
        // sh: dòng đầu KHÔNG được trả lời (ngủ lâu hơn timeout của lời gọi đó),
        // dòng thứ hai dội lại ngay — chứng minh một lời gọi timeout không đầu
        // độc sidecar cho lời gọi tiếp theo, khác hẳn hành vi "giết cả tiến
        // trình khi timeout" của bản v1.
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg("read -r first; sleep 5 & read -r second; echo \"$second\"");
        let running = spawn_process(&mut cmd, || {}).expect("spawn sh");

        let mut a = request("sh", SERVICE_PROTOCOL);
        a.id = "cham".into();
        let err = call_once(&running, &a, Duration::from_millis(200)).await;
        assert!(err.error.unwrap().contains("không trả lời"));

        let mut b = request("sh", SERVICE_PROTOCOL);
        b.id = "nhanh".into();
        let ok = call_once(&running, &b, Duration::from_secs(5)).await;
        assert_eq!(ok.id, "nhanh");
        assert!(ok.error.is_none());

        kill(running).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn sidecar_chet_thi_bao_loi_ro_rang_khong_treo() {
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg("exit 0");
        let running = spawn_process(&mut cmd, || {}).expect("spawn sh");

        let req = request("sh", SERVICE_PROTOCOL);
        let response = call_once(&running, &req, Duration::from_secs(5)).await;
        assert!(response.error.is_some());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn json_hong_lam_reader_dung_va_bao_loi_cho_waiter_dang_treo() {
        // `printf` in ra một dòng KHÔNG phải JSON hợp lệ — vòng đọc phải coi
        // ống dẫn không còn tin được và dừng, chứ không cố đọc tiếp.
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg("read -r _; printf 'khong-phai-json\\n'");
        let running = spawn_process(&mut cmd, || {}).expect("spawn sh");

        let req = request("sh", SERVICE_PROTOCOL);
        let response = call_once(&running, &req, Duration::from_secs(5)).await;
        assert!(response.error.is_some());
    }

    /// Sink thu thập vào bộ nhớ — thay cho `tauri::ipc::Channel` thật (chỉ
    /// dựng được thông qua một lời gọi Tauri command đang chạy trong app).
    struct CollectSink(Arc<StdMutex<Vec<serde_json::Value>>>);
    impl EventSink for CollectSink {
        fn send(&self, value: serde_json::Value) {
            self.0.lock().unwrap().push(value);
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stream_nhan_du_moi_su_kien_toi_khi_done() {
        // Sidecar giả: đọc một dòng, rồi tự phát 3 sự kiện mang ĐÚNG id của
        // request đó, kết bằng `done: true`.
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg(
            r#"read -r _; \
               printf '{"protocol":1,"id":"s","stream":true,"result":1}\n'; \
               printf '{"protocol":1,"id":"s","stream":true,"result":2}\n'; \
               printf '{"protocol":1,"id":"s","stream":true,"done":true}\n'"#,
        );
        let running = spawn_process(&mut cmd, || {}).expect("spawn sh");

        let collected = Arc::new(StdMutex::new(Vec::new()));
        let mut req = request("sh", SERVICE_PROTOCOL);
        req.id = "s".into();
        let line = encode(&req).unwrap();
        running
            .waiters
            .lock()
            .unwrap()
            .insert(req.id.clone(), Waiter::Stream(Box::new(CollectSink(collected.clone()))));
        write_line(&running, &line).await.unwrap();

        // Đợi tới khi waiter tự gỡ (nghĩa là `done` đã tới) thay vì `sleep` cố
        // định — tránh test chập chờn theo tốc độ máy chạy CI.
        for _ in 0..100 {
            if !running.waiters.lock().unwrap().contains_key("s") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(!running.waiters.lock().unwrap().contains_key("s"), "waiter phải tự gỡ sau done");
        assert_eq!(*collected.lock().unwrap(), vec![serde_json::json!(1), serde_json::json!(2)]);
        kill(running).await;
    }

    #[test]
    fn stream_dung_tay_qua_dispatch_ngung_route_ngay_du_chua_done() {
        let waiters: Waiters = Arc::default();
        let collected = Arc::new(StdMutex::new(Vec::new()));
        waiters
            .lock()
            .unwrap()
            .insert("s".into(), Waiter::Stream(Box::new(CollectSink(collected.clone()))));

        // Mô phỏng `service_stream_stop`: gỡ tay, không cần sidecar biết.
        waiters.lock().unwrap().remove("s");

        dispatch(
            &waiters,
            ServiceResponse { protocol: SERVICE_PROTOCOL, id: "s".into(), result: Some(serde_json::json!(1)), error: None, stream: true, done: false },
        );
        assert!(collected.lock().unwrap().is_empty(), "đã dừng thì không còn nhận sự kiện nào nữa");
    }

    #[test]
    fn phan_hoi_toi_muon_khong_khop_id_nao_thi_bi_bo_qua_khong_panic() {
        // Đây chính là ca bản v1 sẽ ghép nhầm vào lời gọi kế tiếp — với demux
        // theo id, nó chỉ đơn giản không khớp waiter nào.
        let waiters: Waiters = Arc::default();
        dispatch(&waiters, ServiceResponse::err("khong-ai-cho", "trễ"));
        // Không panic, không còn gì trong waiters — đủ để coi là bỏ qua sạch.
        assert!(waiters.lock().unwrap().is_empty());
    }

    #[test]
    fn response_bo_qua_truong_rong_khi_serialize() {
        let json = serde_json::to_string(&ServiceResponse::err("7", "hỏng")).unwrap();
        assert!(json.contains("\"error\":\"hỏng\""), "{json}");
        assert!(!json.contains("result"));
        assert!(!json.contains("stream"));
        assert!(!json.contains("done"));
    }

    // -- Task 3: sidecar_path — thứ tự ưu tiên tải-về-trước, cạnh-exe sau -----

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("devtool-sidecar-path-test-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Ghi thẳng một `extensions/index.json` giả với đúng hình dạng
    /// `artifact_installer.rs` thật sự ghi ra — dùng type công khai của module
    /// đó (`InstalledArtifactRecord::Service`), không bịa JSON tay.
    fn write_fake_service_index(extensions_dir: &std::path::Path, bin: &str, bin_path: &std::path::Path) {
        let mut targets = HashMap::new();
        targets.insert(
            crate::artifact_installer::current_target_triple(),
            crate::artifact_installer::ServiceTarget { url: "https://x/bin".into(), sha256: "0".repeat(64) },
        );
        let record = crate::artifact_installer::InstalledArtifactRecord::Service(
            crate::artifact_installer::InstalledServiceRecord {
                manifest: crate::artifact_installer::RemoteServiceManifest {
                    bin: bin.into(),
                    version: "1.0.0".into(),
                    protocol: SERVICE_PROTOCOL,
                    targets,
                },
                source_url: "https://x/svc.json".into(),
                bin_path: bin_path.to_string_lossy().into_owned(),
                installed_at: 1,
            },
        );
        std::fs::write(
            extensions_dir.join("index.json"),
            serde_json::to_string_pretty(&vec![record]).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn dat_cung_ten_bin_o_ca_hai_vi_tri_thi_ban_tai_ve_luon_duoc_chon() {
        let extensions_dir = temp_dir("extensions");
        let beside_dir = temp_dir("beside-exe");
        let installed_bin = temp_dir("installed-bin-dir").join("devtool-svc-demo");
        std::fs::write(&installed_bin, b"noi dung ban tai ve").unwrap();
        // Cùng tên bin cũng tồn tại cạnh "exe" — nội dung khác hẳn, để một
        // assertion sai (chọn nhầm bản) lộ rõ nếu có ai lỡ đảo thứ tự.
        std::fs::write(beside_dir.join("devtool-svc-demo"), b"noi dung ban canh exe").unwrap();
        write_fake_service_index(&extensions_dir, "devtool-svc-demo", &installed_bin);

        let resolved = resolve_sidecar_path(Some(&extensions_dir), &beside_dir, "devtool-svc-demo").unwrap();
        assert_eq!(resolved, installed_bin);
    }

    #[test]
    fn khong_co_ban_tai_ve_thi_roi_xuong_canh_exe_khong_doi_hanh_vi_cu() {
        let extensions_dir = temp_dir("extensions-empty");
        let beside_dir = temp_dir("beside-exe-only");
        let beside_bin = beside_dir.join("devtool-svc-demo");
        std::fs::write(&beside_bin, b"ban dong goi san").unwrap();

        let resolved = resolve_sidecar_path(Some(&extensions_dir), &beside_dir, "devtool-svc-demo").unwrap();
        assert_eq!(resolved, beside_bin);
    }

    #[test]
    fn khong_co_gi_o_ca_hai_noi_thi_bao_loi_ro_rang_khong_panic() {
        let extensions_dir = temp_dir("extensions-empty-2");
        let beside_dir = temp_dir("beside-empty");
        let err = resolve_sidecar_path(Some(&extensions_dir), &beside_dir, "devtool-svc-khong-ton-tai").unwrap_err();
        assert!(err.contains("Không thấy sidecar"), "{err}");
    }

    #[test]
    fn index_noi_da_cai_nhung_file_mat_tren_dia_thi_roi_xuong_canh_exe() {
        // index.json nói đã cài nhưng file bị xoá/hỏng đĩa — edge case nêu
        // trong plan: rơi xuống fallback cạnh-exe nếu có, không panic.
        let extensions_dir = temp_dir("extensions-dangling");
        let beside_dir = temp_dir("beside-fallback");
        let beside_bin = beside_dir.join("devtool-svc-demo");
        std::fs::write(&beside_bin, b"ban dong goi san").unwrap();
        // Trỏ tới một file KHÔNG tồn tại — mô phỏng đĩa hỏng/bị xoá thủ công.
        let missing = temp_dir("missing-parent").join("devtool-svc-demo");
        write_fake_service_index(&extensions_dir, "devtool-svc-demo", &missing);

        let resolved = resolve_sidecar_path(Some(&extensions_dir), &beside_dir, "devtool-svc-demo").unwrap();
        assert_eq!(resolved, beside_bin);
    }

    /// Round-trip đầy đủ: "cài" một binary giả (một script `sh` dội lại dòng
    /// vào, giống `cat` — cùng cách `plugin_installer.rs`/`artifact_installer.rs`'s
    /// test cũ không cần ship thêm binary nào), resolve qua `resolve_sidecar_path`,
    /// rồi thực sự spawn + gọi qua đúng đường request/response mà `service_call`
    /// dùng (`spawn_process`/`call_once`) — chứng minh cả đường dây, không chỉ
    /// phần chọn đường dẫn.
    #[cfg(unix)]
    #[tokio::test]
    async fn round_trip_cai_gia_resolve_dung_va_goi_duoc_qua_no() {
        use std::os::unix::fs::PermissionsExt;

        let extensions_dir = temp_dir("rt-extensions");
        let beside_dir = temp_dir("rt-beside");
        let bin_dir = temp_dir("rt-bin-dir");
        let installed_bin = bin_dir.join("devtool-svc-demo");
        std::fs::write(&installed_bin, "#!/bin/sh\ncat\n").unwrap();
        let mut perms = std::fs::metadata(&installed_bin).unwrap().permissions();
        perms.set_mode(perms.mode() | 0o111);
        std::fs::set_permissions(&installed_bin, perms).unwrap();
        write_fake_service_index(&extensions_dir, "devtool-svc-demo", &installed_bin);

        let resolved = resolve_sidecar_path(Some(&extensions_dir), &beside_dir, "devtool-svc-demo").unwrap();
        assert_eq!(resolved, installed_bin);

        let mut cmd = Command::new(&resolved);
        let running = spawn_process(&mut cmd, || {}).expect("spawn binary vừa cài");
        let req = request("devtool-svc-demo", SERVICE_PROTOCOL);
        let response = call_once(&running, &req, Duration::from_secs(5)).await;
        assert_eq!(response.id, "1");
        assert!(response.error.is_none(), "{response:?}");
        kill(running).await;
    }
}
