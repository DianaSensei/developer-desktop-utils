# Tier B — viết một sidecar

Đọc [01-architecture.md](./01-architecture.md) trước nếu chưa rõ vì sao Tier
B tồn tại (tiến trình riêng, không phải thêm lệnh vào app chính). Tài liệu
này là hướng dẫn THỰC HÀNH, đúc kết từ việc port thật 4 tool (Redis, Kafka,
RabbitMQ, Container) sang mô hình này.

## Khi nào chọn Tier B thay vì Tier A

Chỉ khi plugin cần MỘT trong các điều sau — nếu không, ở lại Tier A:

- Giữ một kết nối/socket sống lâu dài, nhận dữ liệu liên tục (Pub/Sub,
  AMQP consumer, tail log của container).
- Dùng một crate Rust không có binding JS tốt (Docker Engine API qua
  `bollard`, giao thức wire của Kafka qua `rskafka`).
- Khối lượng công việc đủ nặng để chạy trong webview sẽ chặn UI, và
  không thể chia nhỏ bằng `requestIdleCallback`/Web Worker.

## Bộ khung tối thiểu

Mỗi sidecar là một file `src-tauri/src/bin/devtool-svc-<ten>.rs` — Cargo tự
nhận diện mọi file trong `src/bin/` là một binary riêng, không cần khai gì
thêm trong `Cargo.toml`.

**Hợp đồng bắt buộc** (host, `service_host.rs`, dựa vào đúng những điều
này — vi phạm bất kỳ điều nào cũng làm sidecar "câm" hoặc treo):

1. Đọc từng dòng JSON ở stdin.
2. Trả về **ít nhất một dòng JSON mang đúng `id`** của dòng vào đó — một
   dòng cho method một-lần; nhiều dòng, kết bằng `done: true`, cho method
   mà chính sidecar coi là stream.
3. **Thoát khi stdin đóng (EOF)** — đây là cách host dọn tiến trình con khi
   app tắt, kể cả khi app bị kill và không kịp chạy hàm dọn nào.
4. **Không bao giờ ghi gì khác lên stdout** — log thì ghi stderr. Một dòng
   không phải JSON hợp lệ trên stdout làm host coi cả ống dẫn không còn tin
   được và dừng đọc.

### Khung tin nhắn

```rust
const SERVICE_PROTOCOL: u32 = 1; // phải khớp SERVICE_PROTOCOL ở service.ts

#[derive(Deserialize)]
struct Request {
    protocol: u32,
    id: String,
    #[serde(default)]
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

fn is_false(b: &bool) -> bool { !*b }

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
```

Hằng số `SERVICE_PROTOCOL` và khung `Request`/`Response` bị **LẶP LẠI có
chủ ý** ở mỗi sidecar (không có crate `lib` dùng chung với host) — lệch
nhau thì phía host tự phát hiện và từ chối tử tế thay vì diễn giải sai
payload, thay vì rủi ro một thay đổi ở sidecar này vô tình ảnh hưởng sidecar
khác qua một dependency chung.

### Ví dụ tối thiểu — chỉ method một-lần (đồng bộ, đơn giản nhất)

```rust
use std::io::{self, BufRead, Write};

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break }; // EOF hoặc lỗi đọc → thoát
        if line.trim().is_empty() { continue; }

        let response = handle_line(&line);
        let Ok(json) = serde_json::to_string(&response) else { continue };
        if writeln!(out, "{json}").is_err() || out.flush().is_err() { break; }
    }
}
```

Đây đúng là toàn bộ `devtool-svc-echo.rs` (xem file thật để đọc trọn vẹn,
kèm `ping`/`echo`/`tick-stream`). Cách này ĐỦ nếu sidecar chỉ có method
một-lần và không cần xử lý nhiều lời gọi CHỒNG LÊN NHAU (host gửi lời gọi
tiếp theo trước khi lời gọi trước trả lời xong) — với 4 sidecar thật đã
làm, không sidecar nào dùng cách này vì tất cả đều có ít nhất một method
cần mở kết nối mạng (độ trễ đủ lớn để chồng lấn xảy ra thật).

### Mẫu khuyến nghị cho sidecar thật — async, xử lý đồng thời

```rust
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    let (tx, mut rx) = mpsc::unbounded_channel::<Response>();

    // Một task RIÊNG sở hữu stdout — tránh hai response ghi xen kẽ làm hỏng
    // ranh giới dòng khi nhiều task xử lý đồng thời cùng gọi tx.send().
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
        if line.trim().is_empty() { continue; }
        let tx = tx.clone();
        // Spawn MỘT TASK cho mỗi dòng vào — cho phép nhiều lời gọi chồng lấn
        // (host demux theo `id`, xem "Ghép dòng theo id" ở
        // docs/decisions/architecture/platform-plugin-architecture.md).
        tokio::spawn(async move {
            let response = handle_line(&line).await;
            let _ = tx.send(response);
        });
    }

    drop(tx);
    let _ = writer.await;
}
```

Đây là cấu trúc `devtool-svc-redis.rs`/`devtool-svc-container.rs`/
`devtool-svc-rabbit.rs` đều dùng. **Dùng cách này nếu sidecar của bạn có
BẤT KỲ method nào chạm mạng/IO chậm** — cách đồng bộ đơn giản ở trên sẽ
khiến một lời gọi chậm chặn hết mọi lời gọi khác tới cùng sidecar.

## Method một-lần vs method stream

### Một-lần

Trả đúng MỘT `Response` cho một `id`, không set `stream`/`done`.

```rust
"list-configs" => Ok(serde_json::to_value(load_configs())?),
```

### Stream — nhiều sự kiện cho cùng một `id`

Có hai hình dạng, khác nhau ở việc AI RA LỆNH DỪNG:

**(a) Tự kết thúc** (ví dụ: pull một image, chạy xong tự dừng) — mẫu
`tick-stream` của `devtool-svc-echo`:

```rust
fn tick_stream(id: String, params: &serde_json::Value) -> Vec<Response> {
    let count = params.get("count").and_then(Value::as_u64).unwrap_or(3);
    let mut out: Vec<Response> = (0..count)
        .map(|i| Response::event(id.clone(), serde_json::json!(i)))
        .collect();
    out.push(Response::done(id)); // đánh dấu kết thúc, host tự gỡ waiter
    out
}
```

Không cần registry — không ai cần "dừng tay" nó giữa chừng.

**(b) Vô hạn, cần dừng tay** (Pub/Sub, tail log, consumer) — mẫu
`pubsub-subscribe` của `devtool-svc-redis`:

```rust
static REGISTRY: OnceLock<Registry> = OnceLock::new(); // subscriptionId -> Notify

async fn handle_watch_start(id: String, params: Value, tx: mpsc::UnboundedSender<Response>) {
    // ... mở kết nối/subscription thật ...

    let subscription_id = Uuid::new_v4().to_string(); // id NỘI BỘ, khác request.id
    let notify = Arc::new(Notify::new());
    registry().insert(subscription_id.clone(), notify.clone());

    // Sự kiện ĐẦU luôN báo id nội bộ, để client biết cách dừng sau này.
    if tx.send(Response::event(id.clone(), json!({
        "type": "subscribed", "subscriptionId": subscription_id
    }))).is_err() {
        registry().remove(&subscription_id);
        return;
    }

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = notify.notified() => break, // "watch-stop" gọi tới
                next = some_stream.next() => match next {
                    Some(event) => {
                        let payload = json!({ "type": "message", /* ... */ });
                        if tx.send(Response::event(id.clone(), payload)).is_err() {
                            break; // writer task đã thoát — không còn ai đọc
                        }
                    }
                    None => break,
                }
            }
        }
        registry().remove(&subscription_id);
    });
}

// Method MỘT-LẦN riêng để dừng — request KHÁC, mang subscriptionId nội bộ
"watch-stop" => {
    let subscription_id: String = param(&params, "subscriptionId")?;
    if let Some(notify) = registry().remove(&subscription_id) {
        notify.notify_one();
    }
    Ok(Value::Null)
}
```

**Vì sao cần một method `*-stop` riêng, không chỉ dựa vào
`sdk.service.stream()`'s `.stop()` phía client:** `service_stream_stop`
(lệnh Tauri phía host) CHỈ gỡ waiter phía HOST — nó **không báo gì cho
sidecar**. Nếu sidecar không tự có cách dừng tác vụ nền của nó, task đó sẽ
chạy MÃI MÃI (rò rỉ kết nối/subscription thật ở phía server bên ngoài) dù
phía client tưởng đã dừng. Registry nội bộ + method dừng riêng là cách bắt
buộc phải làm — không có đường tắt nào khác trong kiến trúc hiện tại.

## Cạm bẫy đã gặp thật — đọc kỹ trước khi viết method stream

### 1. `dispatch()` phía host âm thầm bỏ payload của response mang `error`
   HOẶC `done: true` khi waiter là Stream

Đây là lỗ hổng thật, phát hiện hai lần độc lập (Redis Pub/Sub, rồi
Container image-pull) trong quá trình port — không phải giả thuyết.

`service_host.rs::dispatch()`:
```rust
Waiter::Stream(sink) => {
    if response.error.is_some() || response.done {
        return; // KHÔNG gửi gì tới sink, kể cả nếu response.result có dữ liệu
    }
    sink.send(response.result.unwrap_or(Value::Null));
    // ... chèn lại waiter để tiếp tục nhận sự kiện sau ...
}
```

**Hệ quả**: nếu bạn dùng `Response::err(id, "lỗi gì đó")` cho một method
stream, lỗi đó KHÔNG BAO GIỜ tới được `onMessage` phía client — người dùng
thấy UI treo ở "đang chờ" mãi mãi, không một dòng lỗi nào. Tương tự, nếu
bạn gói dữ liệu hoàn tất vào response cuối kèm `done: true`, dữ liệu đó
cũng bị bỏ.

**Cách đúng — luôn mã hoá lỗi/hoàn tất vào GIAO THỨC ỨNG DỤNG của chính
sidecar**, không phải khung tin nhắn:

```rust
// SAI cho method stream:
tx.send(Response::err(id, "connection refused"));

// ĐÚNG:
tx.send(Response::event(id, json!({ "type": "error", "message": "connection refused" })));
```

Và nếu cần gửi dữ liệu kèm lúc hoàn tất, gửi nó như một event ứng dụng
TRƯỚC, framing `done: true` chỉ để dọn dẹp:

```rust
tx.send(Response::event(id.clone(), json!({ "type": "done", "finalCount": n })));
tx.send(Response::done(id)); // vô hại nếu bị dispatch() bỏ, chỉ để gỡ waiter
```

Phía client tương ứng: đợi đúng sự kiện `"subscribed"`/`"error"` đầu tiên
trước khi resolve/reject promise của lời gọi `stream()`, thay vì resolve
ngay khi `sdk.service.stream()` trả về (nó chỉ xác nhận ĐĂNG KÝ thành công,
không xác nhận sidecar đã thật sự làm được việc):

```ts
async function watchStart(params: Params, onEvent: (e: MyEvent) => void) {
  let subscriptionId: string | null = null;
  let settleReady: (() => void) | null = null;
  let settleFailed: ((e: Error) => void) | null = null;
  const ready = new Promise<void>((res, rej) => { settleReady = res; settleFailed = rej; });

  const subscription = await sdk.service.stream<RawEvent>('watch-start', (event) => {
    if (event.type === 'subscribed') { subscriptionId = event.subscriptionId; settleReady?.(); return; }
    if (event.type === 'error') { settleFailed?.(new Error(event.message)); return; }
    onEvent(mapEvent(event));
  }, params);

  try {
    await ready;
  } catch (e) {
    await subscription.stop().catch(() => {});
    throw e;
  }

  return {
    async stop() {
      if (subscriptionId) await sdk.service.call('watch-stop', { subscriptionId }).catch(() => {});
      await subscription.stop();
    },
  };
}
```

### 2. Drop sớm connection/channel trong task nền

Nếu task nền của một stream không GIỮ biến kết nối (không gán vào một
biến sống suốt vòng đời task, ví dụ `let _keep_conn = conn;`), Rust sẽ drop
nó ngay khi hàm bao ngoài return — kết nối đóng trước khi kịp nhận sự kiện
nào. Đã gặp thật ở RabbitMQ (connection + channel phải sống suốt vòng đời
consumer để còn dùng publish reply).

### 3. `tauri-build` kiểm TOÀN BỘ `bundle.externalBin` tồn tại trên đĩa,
   không riêng bin đang build

Lần đầu thêm một sidecar MỚI, build nó lần đầu sẽ fail nếu MỘT sidecar
KHÁC trong `bundle.externalBin` chưa từng được build (chưa có file trên
đĩa, kể cả placeholder). `scripts/sidecar.mjs`'s `buildSidecar()` xử lý
việc này bằng cách tạo placeholder rỗng cho MỌI entry trong
`bundle.externalBin` (đọc thẳng từ `tauri.conf.json`) trước khi build bin
hiện tại — không cần bạn tự lo, chỉ cần biết lý do nếu gặp lỗi
`resource path '...' doesn't exist` khi build.

## Dữ liệu bền — `DEVTOOL_SERVICE_DATA_DIR`

Sidecar không có `AppHandle` (không chạy trong Tauri app). Nếu cần lưu gì
đó (cấu hình kết nối, ...), đọc thư mục RIÊNG của sidecar qua biến môi
trường host tự set khi spawn:

```rust
fn app_data_dir() -> Result<PathBuf, String> {
    std::env::var("DEVTOOL_SERVICE_DATA_DIR")
        .map(PathBuf::from)
        .map_err(|_| "DEVTOOL_SERVICE_DATA_DIR không được set — sidecar phải chạy qua service_host.rs".to_string())
}
```

Thư mục này (`<app_data>/service-data/<bin>/`) đã được host cách ly RIÊNG
cho sidecar của bạn — không đọc/ghi ra ngoài nó, không đoán một đường dẫn
`app_data` khác.

## Đăng ký sidecar vào app

Ba chỗ cần sửa — thiếu một trong ba thì sidecar build được, test được, nhưng
KHÔNG chạy được từ app thật:

1. **`src-tauri/src/service_host.rs`** — thêm tên bin vào `ALLOWED_SERVICES`
   (hằng số Rust, ranh giới tin cậy thật — xem 01-architecture.md).
2. **`src-tauri/tauri.conf.json`** — thêm `"binaries/<ten-bin>"` vào
   `bundle.externalBin`.
3. **`scripts/prepare-service-sidecars.mjs`** — thêm tên bin vào
   `SERVICE_SIDECARS` (build trước `tauri build`, chạy tay lúc dev).

`service_host.rs`'s test `allowlist_khop_voi_external_bin` khoá chiều (1)
↔ (2) khớp nhau — không khoá được (3) vì Rust/Node không chia sẻ hằng số
qua ranh giới ngôn ngữ; thiếu (3) chỉ lộ ra lúc build release thật, không
lộ lúc `cargo test`.

## Testing

Xem [06-testing.md](./06-testing.md) cho quy ước đầy đủ. Tóm tắt cho Tier B:

- Test đơn vị THUẦN cho logic không chạm mạng (parse, validate tham số).
- Test integration cho service_host.rs's phần điều phối, dùng `sh`/`cat` giả
  làm sidecar (không cần binary thật) — xem `service_host.rs`'s
  `#[cfg(test)] mod tests`.
- Test bằng BINARY THẬT (`src-tauri/tests/`, dùng
  `CARGO_BIN_EXE_<ten-bin>` — CHỈ set cho integration test, không set cho
  `#[cfg(test)]` trong `src/`) cho hành vi thật của sidecar theo đúng khung
  JSONL.
- **Xác nhận thủ công bằng server/daemon thật** (Redis/RabbitMQ/Docker qua
  container tạm, dừng+xoá sau khi test) trước khi coi một method là "xong"
  — test tự động không thay thế được việc này cho code chạm mạng thật.
