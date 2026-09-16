# Kiến trúc — Platform, Plugin, và ba Tier

## Platform vs Plugin

**Platform** là phần lõi của app: SDK, registry, cơ chế cài đặt, audit,
kho bí mật. Platform không biết gì về nghiệp vụ của từng tool.

**Plugin** là một tool cụ thể (Redis Client, JSON Formatter, ...). Mỗi
plugin là một thư mục `src/plugins/<id>/` với đúng một file `plugin.ts`
export default một `PluginManifest` (xem [02-manifest.md](./02-manifest.md)).
Platform quét thư mục này bằng `import.meta.glob` lúc build — không có
bảng đăng ký tay, không có bước "thêm route thủ công".

Một plugin **không tự chạy code lúc app khởi động**: `plugin.ts` chỉ chứa
metadata (tên, icon, quyền, permission) và một closure `load()` chưa được
gọi. Code thật của plugin (component React, logic) nằm ở chunk riêng, chỉ
tải khi người dùng thật sự điều hướng tới route đó — đây là lý do
`load: () => import('./MyView').then(m => m.MyView)` luôn là một dynamic
import, không phải import tĩnh ở đầu file.

## Ba Tier

DevTool có ba tier cho plugin, khác nhau ở **logic nặng chạy Ở ĐÂU**:

### Tier A — chạy trong webview (mặc định, hầu hết plugin)

Component React của bạn chạy trong cùng tiến trình/webview với phần còn lại
của app. Mọi truy cập ra ngoài (lưu trữ, mạng, clipboard, gọi lệnh Rust) đi
qua `sdk.*` — xem [03-sdk-reference.md](./03-sdk-reference.md).

Đây là lựa chọn mặc định cho MỌI plugin mới. Chỉ cân nhắc Tier B khi plugin
cần thứ webview không làm được.

### Tier B — sidecar (tiến trình Rust riêng)

Dành cho plugin cần: socket thô liên tục (Redis Pub/Sub, AMQP consumer),
một SDK/crate không có binding JS tốt (Docker Engine API, Kafka wire
protocol), hoặc khối lượng công việc mà chạy trong webview sẽ chặn UI.

Plugin khai `service: { bin, methods }` trong manifest, Platform spawn một
binary Rust riêng và plugin nói chuyện với nó qua `sdk.service.call()`/
`sdk.service.stream()`. Xem [04-tier-b-sidecars.md](./04-tier-b-sidecars.md)
cho hướng dẫn viết một sidecar từ đầu.

**Vì sao tiến trình riêng, không phải thêm lệnh Rust vào app chính:**
`tauri::generate_handler!` là macro lúc biên dịch — không thêm lệnh lúc
chạy được, nên một plugin Tier B không thể "đăng ký thêm lệnh" vào app đã
build sẵn. Quan trọng hơn: `panic = "abort"` trong profile release của app
nghĩa là một panic trong code dịch vụ sẽ giết CẢ APP — một sidecar riêng
thì chỉ dịch vụ đó chết, lần gọi sau tự spawn lại.

### Tier C — cửa sổ/tiến trình native hoàn toàn riêng

Dành cho game hoặc ứng dụng cần vòng render riêng (không dùng DOM/React).
**Chưa triển khai** — nằm ngoài phạm vi hiện tại, gác lại có chủ đích.

## Ranh giới tin cậy — ở đâu, và ở đâu KHÔNG

Đọc kỹ mục này trước khi giả định quyền trong manifest là một hàng rào bảo
mật — nó không phải, và biết chính xác nó LÀ gì quan trọng hơn.

- **Không có sandbox giữa các plugin Tier A.** Mọi plugin chạy chung một
  realm JS với app. Về mặt kỹ thuật, một plugin Tier A vẫn import thẳng
  được `@tauri-apps/*` nếu cố tình — quyền trong manifest không chặn được
  điều đó ở tầng ngôn ngữ. Cái nó làm được: (1) khai báo tường minh để
  Settings → Extensions hiện cho người dùng thấy plugin nào chạm vào gì,
  (2) bắt lỗi SỚM khi code gọi nhầm một kênh chưa khai quyền (ném lỗi rõ
  ràng thay vì âm thầm chạy), (3) cho nhật ký audit (`pluginAudit`) một
  nhãn để ghi lại mọi lời gọi, kể cả lời gọi bị chặn.
- **`guard.test.ts` khoá bất biến "không plugin nào import thẳng
  `@tauri-apps/*`" ở ngưỡng 0** — đây là rào chắn kỷ luật viết code, không
  phải rào chắn runtime. Nó biến "quyền là mô tả" thành "quyền là hàng rào
  thật" theo nghĩa: nếu không ai lách qua SDK, thì allowlist trong manifest
  đúng là nơi DUY NHẤT quyết định một lời gọi có đi tiếp hay không.
- **Ranh giới thật, có giá trị bảo mật, nằm ở Tier B:** `ALLOWED_SERVICES`
  trong `service_host.rs` là một hằng số Rust CỨNG, quyết định lúc BIÊN
  DỊCH — không đổi được lúc chạy, không do manifest hay webview quyết định.
  Một plugin khai `service: { bin: 'ten-la' }` mà `ten-la` không nằm trong
  `ALLOWED_SERVICES` thì lời gọi bị từ chối, bất kể manifest nói gì. Đây là
  lý do: manifest do webview đọc — thứ ta đang muốn giới hạn khả năng của
  nó — nên nó không thể là nơi cấp quyền chạy tiến trình.
- **Vì sao không cần sandbox chống mã độc lúc này:** mọi plugin (kể cả
  plugin cài từ URL bên ngoài) hiện do chính người phát hành DevTool viết
  và tự host. Đây không phải kho plugin bên thứ ba. Rủi ro thật đang được
  phòng là MITM/server lưu trữ bị chiếm khi tải qua mạng (giải quyết bằng
  checksum SHA-256 bắt buộc — xem
  [05-external-install.md](./05-external-install.md)), không phải một tác
  giả plugin ác ý.

## Vòng đời một request đi qua SDK (Tier A)

```
component gọi sdk.storage.get('key')
  → kiểm manifest.permissions có 'storage' không
    → có: ghi audit (allowed: true) → thực thi, trả kết quả
    → không: ghi audit (allowed: false, missingPermission: 'storage')
             → ném PluginPermissionError
```

Mọi kênh trong `sdk.*` đều đi qua đúng trình tự này: **kiểm quyền → ghi
audit → mới thực thi**. Không có đường tắt nào bỏ qua audit, kể cả khi lời
gọi bị chặn — một lời gọi bị từ chối âm thầm là loại lỗi khó phát hiện
nhất (component chỉ thấy "tính năng không chạy", không thấy vì sao).

## Nơi lưu dữ liệu — cách ly theo plugin

Ba tầng dữ liệu, ba cơ chế cách ly khác nhau (chi tiết đầy đủ ở
`docs/decisions/architecture/platform-plugin-architecture.md`, mục "Cách ly dữ liệu"):

| Tầng | Cách ly bằng |
|---|---|
| `sdk.storage`/`sdk.secrets` (Tier A) | Namespace đóng cứng theo `pluginId` ngay trong closure SDK — plugin không có tham số nào để tự nêu id khác |
| Sidecar Tier B | Thư mục riêng (`<app_data>/service-data/<bin>/`) cấp qua biến môi trường lúc spawn |

Nếu plugin của bạn cần lưu gì đó bền, dùng `sdk.storage`/`sdk.secrets` (Tier
A) hoặc đọc/ghi trong thư mục `DEVTOOL_SERVICE_DATA_DIR` (Tier B) — không
tự đoán một đường dẫn khác trong `app_data`.
