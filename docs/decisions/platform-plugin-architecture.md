# Platform / Plugin — kiến trúc và ranh giới

**Trạng thái**: đã áp dụng. Mọi tool trong app là plugin và chạy trên SDK.

## Bối cảnh

DevTool đi từ "một app có nhiều tool" sang "một platform chở nhiều mini app".
Trước thay đổi này, thêm một tool phải sửa **năm** chỗ rời rạc — metadata, thứ tự
sidebar, route, bật/tắt mặc định, hướng dẫn — và bốn trong năm chỗ đó không có gì
bắt phải khớp nhau. `allTools` ráp hai bảng bằng `...TOOL_ROUTES[def.id]`, mà
spread một `undefined` là hợp lệ trong JS, nên một tool thiếu route chỉ **lặng lẽ**
mất `path`/`component` lúc chạy thay vì báo lỗi lúc build.

## Mô hình

### Một plugin = một thư mục = một manifest

`src/plugins/<id>/plugin.ts` export default một `PluginManifest`. Platform tự quét
bằng `import.meta.glob` (`src/platform/registry.ts`). Không còn bảng đăng ký tay.

`toolDefs.ts`, `toolRegistry.ts` và `DEFAULT_FEATURES` vẫn tồn tại nhưng chỉ là
**view dẫn xuất** — giữ nguyên hình dạng cũ để hơn một tá module đang đọc chúng
(Settings, CommandPalette, toolGroups, onboarding) không phải đổi.

`eager: true` **không** kéo tool vào bundle khởi động: manifest chỉ chứa metadata
và một closure `load` chưa được gọi, nên code thật của tool vẫn ở chunk riêng.
Quét lười thì ngược lại sẽ biến mọi thứ đọc metadata — sidebar, ⌘K, Settings —
thành async.

**Thư mục là danh tính**: `src/plugins/json/plugin.ts` phải khai `id: 'json'`.
Không có luật này thì đường dẫn file không tra ngược được về plugin.

### Manifest hỏng thì bị loại, không làm sập app

`PLUGIN_ERRORS` gom manifest bị loại kèm lý do; `registry.test.ts` khoá danh sách
đó phải rỗng. Một manifest sai chính tả làm **CI đỏ**, chứ không làm trắng cửa sổ
của người dùng.

## Platform SDK

Bề mặt được chốt bằng cách **đếm xem các tool thực sự với ra ngoài những gì**,
không phải liệt kê thứ nghe hợp lý.

| Kênh | Quyền | Dùng cho |
|---|---|---|
| `sdk.storage` / `usePluginState` | `storage` | State có ghi nhớ, khoá gắn namespace `devtool:<id>:` |
| `sdk.secrets` / `useSecretState` | `secrets` | Credential — kho riêng, mã hoá |
| `sdk.clipboard` | `clipboard:read` / `clipboard:write` | Text và ảnh |
| `sdk.files` | `files:read` / `files:write` | Hộp thoại + đọc/ghi file, kéo-thả cấp cửa sổ |
| `sdk.http.fetch` | `http` + `hosts` | Mạng ra ngoài |
| `sdk.native` | `native` + `commands` | `invoke`, `channel` (stream), `listen` (sự kiện Rust) |
| `sdk.service` | `service` + `service.methods` | Sidecar riêng của plugin (tier B) |
| `sdk.openExternal` | `open-url` | Giao URL cho trình duyệt của người dùng |
| `sdk.env` | — | `isTauri`, `isMac`, `modKey`; không tiết lộ gì hơn `navigator.userAgent` |

Ba dịch vụ có hình dạng React nên không thể là thuộc tính của object `sdk`, nhưng
vẫn xuất qua cùng cửa `@/platform`: `usePluginConfig()`, `useLiveConnection()`,
`usePluginMcpBridgeActive()`.

**Đọc và ghi luôn tách đôi quyền** — clipboard cũng như file — vì cùng một lý do:
một tool chỉ cần *nhập* file (API Client import collection) không nên vì thế mà có
luôn quyền *ghi đè* lên bất cứ file nào người dùng chọn.

### SDK là điểm thắt, và giờ quyền được THỰC THI

Mọi kênh đi qua cùng một trình tự: kiểm quyền khai trong manifest → ghi audit →
mới thực thi. Từ khi chỉ số `directTauriInPluginCode` về 0 (xem "Rào chắn"),
**không code plugin nào còn chạm thẳng Tauri** — nên `permissions` không còn là mô
tả mà là hàng rào thật: một lệnh gõ sai hay nằm ngoài allowlist bị chặn và ghi
nhật ký, thay vì lặng lẽ đi xuống Rust.

Điều đó **không** biến plugin thành sandbox. Mọi plugin vẫn chạy chung realm với
app; về kỹ thuật một plugin vẫn có thể import `@tauri-apps/*` trở lại. Cái đã có
là: mọi lời gọi hiện tại đều đi qua điểm thắt, và rào chắn làm CI đỏ nếu có chỗ
mới lách ra. Sandbox thật chỉ xuất hiện khi plugin chạy trong webview/tiến trình
riêng — lúc đó chính danh sách `permissions` là thứ ánh xạ sang capability.

Hệ quả đi kèm: **quyền `native` luôn phải kèm allowlist lệnh**, `http` luôn kèm
`hosts`, `service` luôn kèm `service.methods`. Quyền không allowlist là quyền vô
hạn; `validateManifest` từ chối cả hai chiều.

### Settings → Plugin: hai bảng, cố ý không gộp

Manifest nói plugin **được phép** làm gì (tĩnh); nhật ký nói nó **đã** làm gì
(động, theo phiên). Chỉ có bảng thứ nhất thì quyền mãi là lời hứa; chỉ có bảng thứ
hai thì không có gì để đối chiếu.

Audit là bộ đệm vòng trong RAM (500 bản ghi), **ghi cả lời gọi bị từ chối** — đó
là loại lỗi duy nhất không tự lộ ra ở chỗ khác: hàm ném, plugin bắt lại, người
dùng chỉ thấy tính năng "không chạy". Nhật ký chỉ ghi **host** của URL và **tên**
file, không ghi path/query hay đường dẫn đầy đủ: đó là nơi token và tên tài khoản
người dùng nằm. `usePluginState` ghi đúng một dòng cho mỗi khoá lúc gắn, không
theo từng lần gõ phím — một editor sẽ cuốn trôi bộ đệm 500 mục.

## Kho bí mật

`persistentStore` nạp **toàn bộ** `app-settings.json` vào một cache đồng bộ trong
RAM lúc khởi động, và `storageGet(bấtKỳKhoáNào)` đọc được mọi thứ trong đó. Khi
seed TOTP và token API cùng nằm trên mặt phẳng khoá ấy thì bất kỳ đoạn code nào
trong webview — kể cả một dependency npm bị chiếm — cũng đọc được tất cả bằng đúng
một lời gọi.

Bí mật giờ nằm ở kho riêng, truy cập qua `sdk.secrets`, khoá dạng `<pluginId>/<key>`:

| Môi trường | Nơi lưu |
|---|---|
| Tauri | `<app_data>/secrets.enc`, AES-256-GCM, khoá ở keychain OS |
| Web (`npm run dev`) | `sessionStorage` — **không** `localStorage`, vì bản web hút nguyên localStorage vào cache chung, tức đưa bí mật trở lại đúng mặt phẳng khoá vừa dọn |

**Khoá mã hoá không nằm cạnh dữ liệu.** Mã hoá mà cất khoá ngay cạnh file là nghi
thức, không phải bảo vệ — nên vị trí khoá mới là phần cốt lõi, không phải thuật
toán. Ba bất biến khoá bằng test Rust: bản mã không chứa **cả giá trị lẫn tên
khoá** (tên khoá tiết lộ người dùng có bí mật của plugin nào); **mỗi lần ghi một
nonce mới** (dùng lại nonce với cùng khoá trong GCM là hỏng hoàn toàn, không chỉ
yếu đi); sửa một byte bản mã thì giải mã bị từ chối chứ không trả ra bản rõ méo mó.

**Đường dự phòng fail-open, có chủ ý.** Máy Linux không có Secret Service thì khoá
rơi về `<app_data>/secrets.key` quyền 0600. Ở chế độ đó ai đọc được thư mục app
data thì đọc được cả hai — nó chỉ chặn việc chép `secrets.enc` đi nơi khác. Lựa
chọn còn lại là fail-closed, tức 2FA và JWT ngừng chạy hẳn trên những máy đó; với
công cụ dev chạy cục bộ, im lặng làm hỏng tính năng là giá cao hơn. Bù lại chế độ
đang dùng **không được giấu**: Settings → Plugin hiện đúng một dòng nói rõ.

**Không tự xoá khi không giải mã được.** Mất mục keychain thì các lệnh báo lỗi rõ
ràng chứ tuyệt đối không tự khởi tạo lại kho — âm thầm vứt dữ liệu để "trở lại
hoạt động" hỏng tệ hơn nhiều. `secret_vault_reset` cho trường hợp người dùng chủ
động chọn bỏ.

### API Client: tách theo BIẾN, không bê cả tài liệu

`environments` chứa token nhưng cũng chứa base URL, tên môi trường, biến thường —
thứ người dùng sửa liên tục và các phần khác của store đọc đồng bộ. Bê cả tài liệu
sang kho bất đồng bộ, mã hoá lại sau mỗi lần gõ phím, là trả giá lớn cho một phần
nhỏ dữ liệu.

Nên chỉ **giá trị của biến có `secret: true`** đi vào kho (`envSecrets.ts` +
`useEnvSecrets.ts`); cấu trúc ở lại chỗ cũ. Mô hình dữ liệu vốn đã phân biệt sẵn —
`KeyValue.secret` có từ trước — nên đây chỉ là dùng đúng cái phân biệt đó cho việc
lưu trữ. Bảy chỗ gọi `setEnvironments` không đổi một dòng.

Bản đồ bí mật ghi lại **đầy đủ** mỗi lần, không phải bản vá: bỏ đánh dấu `secret`
hay xoá môi trường sẽ dọn luôn mục cũ thay vì để nằm lại vĩnh viễn.

"Vault" của API Client đi trọn vào kho: toàn bộ nội dung là bí mật theo đúng định
nghĩa của nó.

## Allowlist host — và vì sao nó KHÔNG nằm ở tầng capability

Ý định ban đầu là thu hẹp `http://**` + `https://**` trong `capabilities/default.json`.
Việc đó **không làm được**: capability của Tauri gắn theo **webview**, mà mọi plugin
dùng chung một webview. API Client là HTTP workbench — nó tồn tại để gọi tới URL
người dùng gõ vào — nên capability buộc phải đủ rộng cho nó, và vì thế không nói
được gì về riêng một tool nào khác.

Giới hạn thật vì vậy ở tầng Platform: manifest khai `hosts`, `sdk.http.fetch` kiểm
host rồi mới gửi. `network` khai 7 host cố định; `api-client` và `rabbit-client`
khai `['*']`.

`'*'` **phải khai tường minh**: một workbench gọi được mọi nơi là đúng thiết kế,
nhưng điều đó xứng đáng là một dòng nhìn thấy được, không phải mặc định ngầm. Mẫu
nửa vời (`*abc.com`, `a.*.com`) bị từ chối vì khớp rộng hơn người viết tưởng;
`*.example.com` phủ chính nó và subdomain, không phủ `evilexample.com`.

Mô tả của `http:default` trong `appPermissions.ts` nói rõ danh sách có wildcard nên
đây là quyền cấp-app, còn giới hạn theo tool ở chỗ khác.

## Ba tier — ba cơ chế khác nhau

Quyết định quan trọng nhất và dễ làm sai nhất: **không có một cơ chế nạp duy nhất
cho mọi loại plugin.**

| Tier | Là gì | Cơ chế | Trạng thái |
|---|---|---|---|
| **A** | Mini tool JS/TS | Manifest + `import.meta.glob`, chung webview | ✅ |
| **B** | Plugin cần native (socket, fs, SDK hệ sinh thái khác) | Sidecar binary, JSONL qua stdin/stdout | Khung xong, chờ plugin thật đầu tiên |
| **C** | Mini app nặng (game, automation) | Crate + binary + **cửa sổ riêng** | Ngoài phạm vi |

Tier C phải là tiến trình riêng, không vì hiệu năng đồ hoạ mà vì bốn ràng buộc cụ
thể: profile release của app là `opt-level = "z"` (tối ưu dung lượng — cấu hình tệ
nhất cho hot loop), `panic = "abort"` (panic trong mini app giết cả app), thời gian
build đã phải hạ xuống `lto = "thin"` vì cây phụ thuộc async, và crash driver GPU
trong tiến trình sẽ kéo theo mọi consumer đang chạy.

### Tier B — plugin dịch vụ (sidecar)

`src-tauri/src/service_host.rs` (host) + `src/platform/service.ts` (client).
Manifest khai `service: { bin, methods }` + quyền `service`.

**Giao thức**: JSON theo dòng (JSONL) qua stdin/stdout. Hợp đồng sidecar phải giữ:
trả ÍT NHẤT một dòng mang đúng `id` cho mỗi dòng nhận được; **thoát khi stdin đóng
(EOF)** — đó là cách tiến trình con được dọn khi app bị kill; không ghi gì khác lên
stdout (log thì ghi stderr).

**Ranh giới tin cậy ở Rust, không ở manifest.** Client nêu tên binary, nhưng chỉ tên
trong `ALLOWED_SERVICES` mới được chạy — manifest do webview đọc, nên nó không thể
là thứ quyết định tiến trình nào được sinh. Danh sách hiện rỗng: host **fail-closed**
thay vì mở sẵn một đường chạy tiến trình cho thứ chưa tồn tại. Test Rust khoá rằng
mọi mục trong allowlist đều phải có trong `bundle.externalBin`.

### Ghép dòng theo `id`, không theo thứ tự ống dẫn (mở rộng streaming)

Bản đầu phục vụ tuần tự: một mutex quanh sidecar, gửi rồi đọc đúng một dòng kế
tiếp làm phản hồi. Cách này có hai giới hạn thật: (1) không biểu diễn được một
method phát NHIỀU sự kiện cho một lời gọi (Pub/Sub, tail log — thứ Phase 2 của
Kafka/Redis/Container chắc chắn cần), và (2) một lỗi tiềm ẩn — phản hồi đến muộn
(timeout) vẫn nằm trong ống và bị đọc nhầm thành phản hồi của lời gọi kế tiếp
dùng chung sidecar.

Sửa bằng cách thêm một **tác vụ đọc nền cho mỗi sidecar** (`reader_loop`), chạy
độc lập ngay khi sidecar được spawn, đọc liên tục mọi dòng và ghép chúng vào
đúng lời gọi bằng `id` — KHÔNG còn giả định "dòng kế tiếp trên ống thuộc về lời
gọi vừa gửi":

- `Waiter::Once(oneshot::Sender)` — một lời gọi một-lần (`call()`/`sdk.service.call`),
  y hệt trước, chỉ khác là nó không còn giữ khoá độc quyền sidecar trong lúc chờ.
- `Waiter::Stream(Box<dyn EventSink>)` — một đăng ký dài hạn, nhận NHIỀU dòng cho
  cùng một `id`, đến khi dòng nào đó mang `done: true`. `EventSink` là một trait
  (`send(&self, Value)`) chứ không phải trực tiếp `tauri::ipc::Channel`: `Channel`
  chỉ dựng được từ một lệnh Tauri thật đang chạy (nó cài `CommandArg`), không
  fabricate được trong unit test cô lập — trait này tách phần LOGIC ĐỊNH TUYẾN
  (test được bằng một `EventSink` giả, `CollectSink`) khỏi phần TRUYỀN TẢI thật.
- `dispatch(waiters, response)` là hàm định tuyến thuần: gỡ waiter theo `id` ra
  khỏi map TRƯỚC (tránh vừa giữ borrow bất biến từ `.get()` vừa cần `&mut` để
  `.remove()`), rồi match trên giá trị đã sở hữu — `Stream` chưa `done` thì gửi
  sự kiện rồi chèn lại vào map, `Stream` đã `done` hoặc `Once` thì gửi rồi bỏ
  hẳn. Một phản hồi không khớp `id` nào (đã timeout, hoặc sidecar tự ý gửi thừa)
  bị **bỏ qua thầm lặng, không panic** — đây là hệ quả trực tiếp của việc chọn
  gỡ theo `id` thay vì theo thứ tự.

**Khung tin nhắn** thêm hai trường tuỳ chọn, bỏ qua khi serialize nếu ở giá trị
mặc định (`#[serde(default, skip_serializing_if = "is_false")]`, cần một hàm
`is_false` viết tay vì `Not::not` không khớp chữ ký `&T -> bool` mà serde cần):
`stream: bool` (dòng này là một-trong-nhiều sự kiện của cùng một lời gọi) và
`done: bool` (sự kiện cuối của stream đó). Sidecar cũ (không biết hai trường
này) vẫn tương thích: chúng vắng mặt tương đương `false`, tức hành vi một-lần
như trước.

**Timeout KHÔNG còn giết sidecar.** Đây là một thay đổi hành vi có chủ ý so với
bản v1: giờ mỗi lời gọi có `id` riêng và một tác vụ đọc nền riêng biệt với việc
gửi, một phản hồi đến muộn không còn nguy cơ bị đọc nhầm thành của lời gọi khác
— nó chỉ đơn giản bị `dispatch` bỏ qua vì lúc đó `id` đã bị gỡ khỏi `waiters` do
timeout. Giết sidecar mỗi lần timeout giờ là phản ứng thừa, tốn kém (một sidecar
đang phục vụ một stream khác cho plugin khác sẽ bị giết oan). Sidecar trả JSON
không hợp lệ hoàn toàn thì vẫn được coi là sự cố nghiêm trọng của tiến trình đó
— hành vi đó không đổi.

**Hai lệnh Tauri mới**: `service_stream_start(request, channel: Channel<Value>)`
đăng ký một `Waiter::Stream` rồi gửi request; `service_stream_stop(bin, id)` gỡ
đăng ký phía HOST — không đảm bảo sidecar biết việc dừng này (nó không phải một
tín hiệu gửi xuống tiến trình con), dọn tài nguyên phía sidecar nếu cần là việc
của một method riêng (`unsubscribe`) mà plugin tự gọi qua `call()` trước khi gọi
`stop()`. Phía client, `sdk.service.stream(method, onMessage, params)` dùng
CHUNG cửa chặn quyền/audit với `call()` (một hàm `prepare()` nội bộ dựng sẵn
`ServiceRequest` cho cả hai) — một method stream ngoài `service.methods` bị từ
chối y hệt một method một-lần.

**`devtool-svc-echo` có thêm `tick-stream`** (`{ count }` → N sự kiện
`0..count` rồi một dòng `done: true`, mặc định `count = 3`) — method DUY NHẤT
trong plugin ví dụ này cần một binary thật để kiểm (`sh`/`cat` dùng trong test
của `service_host.rs` không mô phỏng được việc một tiến trình tự phát nhiều
dòng cho một request). `src-tauri/tests/service_echo.rs` kiểm cả ba việc: đúng
số sự kiện + `done` cuối, mặc định đúng khi không truyền `count`, và sidecar
vẫn sống/trả lời đúng cho request kế tiếp sau khi phát hết một stream.

Test: 12 test Rust ở `service_host.rs` (thêm ba test mới — gọi đồng thời hai
lời gọi tới cùng sidecar không giẫm lên nhau, timeout không giết sidecar và
không ảnh hưởng lời gọi khác, và ba ca cho `dispatch`/stream nêu trên), 9 test
integration ở `service_echo.rs` (ba test mới cho `tick-stream`), và phía TS,
`sdk.service.stream` có test riêng dùng transport giả (`fakeStreamingTransport`)
kiểm: dùng chung cửa chặn với `call`, báo lỗi rõ ràng khi transport không cài
`.stream`, sự kiện tới đúng `onMessage`, và `.stop()` gọi lại đúng request đã
đăng ký.

Không thêm `tauri-plugin-shell`: sidecar resolve như binary cạnh file thực thi, đúng
quy ước `mcp_bridge::mcp_sidecar_path` — không phải mở thêm quyền chạy tiến trình nào.

**Đường end-to-end đã có bằng chứng thật, với `devtool-svc-echo`.** Đây là plugin
dịch vụ tối giản (`ping`/`echo`, không có giá trị người dùng) — tồn tại thuần để
chứng minh cơ chế: build ra binary thật, đóng gói qua `externalBin`, nằm trong
`ALLOWED_SERVICES`, và một integration test thật (`src-tauri/tests/service_echo.rs`)
spawn đúng binary đã build (qua `CARGO_BIN_EXE_devtool-svc-echo`, biến Cargo chỉ có ở
integration test chứ không có ở unit test bên trong bin crate) rồi nói chuyện qua khung
JSONL — không còn là mô phỏng bằng `cat`/`sh` như test host-side. Test host-side (đối
xử với sidecar giả bằng `cat`/`sh`) vẫn giữ nguyên vì chúng nhắm đúng phần khác: logic
điều phối phía host (allowlist, spawn-một-lần, timeout giết tiến trình).

Việc dựng plugin này lộ ra một **bug bootstrap thật** trong script build: `tauri-build`
kiểm mọi mục `externalBin` đã tồn tại trên đĩa mỗi khi `build.rs` chạy lại (tức mỗi khi
`tauri.conf.json` đổi) — kể cả với `cargo build`/`cargo test` thường, không riêng
`tauri build`. Lần đầu thêm một sidecar mới, biên dịch nó (bản thân là một `cargo build`
của cùng package) thất bại trước khi kịp tạo ra binary mà chính bước đó đang cố tạo. Sửa
trong `scripts/sidecar.mjs`: tạo một placeholder rỗng tại đúng đường dẫn nếu chưa có,
trước khi build — kiểm tra tồn tại chỉ cần một file, không xác thực nó là binary thật,
nên placeholder qua được; binary thật ghi đè lên ngay sau đó. Không có bước này thì
`prepare-service-sidecars.mjs` không chạy nổi trên một checkout sạch — nó chỉ tình cờ
chạy được trên máy phát triển ban đầu vì đã có sẵn một file placeholder cũ, gitignore,
để lại từ một phiên trước.

Chưa có: một `plugin.ts` thật khai `service` để gọi tới sidecar này qua UI — vẫn đúng như
đã ghi, vì đây là plugin ví dụ chứ không phải tính năng.

## Rào chắn ranh giới (`guard.test.ts` + `baseline.json`)

Cùng cơ chế ngưỡng lùi dần như `design-system/guard.test.ts`: đỏ cả khi vượt ngưỡng
lẫn khi thấp hơn ngưỡng — dọn xong mà quên hạ thì lần sau vi phạm lẻn về không ai biết.

| Luật | Ngưỡng | Ý nghĩa |
|---|---|---|
| Code plugin gọi thẳng `@tauri-apps` | **0** | Quyền `native`/`files`/`clipboard`/`http` được thực thi |
| Code plugin dùng thẳng store chung | **2** | Hai ngoại lệ đúng, xem dưới |
| Manifest nhập thứ ngoài `lucide-react` + `@/platform` | 0 | Nhập thứ khác phá code-split |
| Khoá dáng credential trong store chung | 0 | Tripwire theo tên khoá |

**Bản guard đầu từng đo thiếu.** Nó chỉ đếm `from '@tauri-apps/…'` và bỏ sót
`await import('@tauri-apps/…')` — mà repo này cố tình dùng dynamic import để giữ
bundle gọn, nên dạng động mới là dạng phổ biến. Con số 12 khi đó là sai; số thật là
53. Một rào chắn đo thiếu còn tệ hơn không có rào chắn, vì con số của nó trông như
đã sạch.

Hai chỗ còn lại của luật thứ hai là **ngoại lệ đúng, không phải nợ**: code di trú
một lần đọc những khoá có TRƯỚC khi có namespace — `apiclient/store.ts` đọc
`devtool:apiclient:activeEnv` để suy ra mô hình mới, `clockify/store.tsx` đọc cờ
migrated/purged. Đưa chúng qua `sdk.storage` sẽ **sai**, vì khoá khi đó thành
`devtool:<id>:devtool:…`. Chúng chỉ biến mất khi chính các migration đó được xoá.

Tripwire "khoá dáng credential" bắt theo **tên khoá**, nên nó bắt trường hợp hiển
nhiên chứ **không** phải bằng chứng đã sạch: `devtool:apiclient:environments` từng
chứa token mà tên khoá không hề lộ ra.

## Di trú dữ liệu người dùng

Đây là phần rủi ro nhất của cả thay đổi: chuyển tool sang `usePluginState` đổi
**chỗ lưu** của gần như mọi thứ người dùng đã lưu. Một cặp khoá khai sai là dữ liệu
biến mất mà không có lỗi nào báo ra — họ chỉ thấy app "tự reset".

Ba khuôn, dùng lại cho mọi tool về sau:

1. **Component/hook** → `usePluginSdkFor(id)` + `usePluginState(sdk, key, init, { legacyKey })`.
2. **Store ở phạm vi module** (lịch sử nhập, log request, client HTTP quản trị) tồn
   tại *chính vì* nó phải sống ngoài vòng đời component, nên không gọi hook được →
   `getPluginSdk(id)` + `migrateLegacyKey(sdk, key, legacyKey)` gọi một lần lúc nạp module.
3. **Khoá mới**: Redis bỏ hẳn tiền tố cũ (`devtool:redis:selectedConnId` → key
   `selectedConnId`) vì nó chỉ có một không gian khoá; Encode·Hash·Encrypt **giữ**
   tiền tố phụ (`devtool:codec:input` → key `codec:input`) vì bốn sub-tool trong cùng
   một plugin sẽ giẫm khoá lên nhau nếu bỏ.

`legacyKey` **bắt buộc** ở mọi lần chuyển: tiền tố lịch sử hiếm khi trùng id plugin
(`devtool:redis:*` vs `redis-client`, `devtool:apiclient:*` vs `api-client`).

**Hai cái bẫy không nằm trong ba khuôn trên**, và cả hai đều suýt lọt:

- `liveConnections.ts` **seed lúc nạp module**, trước khi component nào kịp di trú
  khoá. Đổi khoá mà không cho seed đọc được cả hai thì chấm live sai đúng một lần
  chạy sau khi nâng cấp — lỗi không ai báo nhưng ai cũng thấy.
- Di trú sang kho bí mật **không được chạy ở bản web**. Kho của bản web là
  `sessionStorage`, nên "chuyển" ở đó thực chất là bê dữ liệu từ nơi lưu được sang
  nơi mất khi đóng tab rồi xoá bản gốc — tức **xoá** dữ liệu người dùng. Để nguyên
  thì bản web hiển thị rỗng nhưng dữ liệu còn nguyên và sẽ được di trú đúng cách khi
  họ mở bản desktop.

`src/platform/migration.test.ts` đọc **thẳng mã nguồn** để lấy mọi cặp
(key, legacyKey) đang khai rồi kiểm từng cặp: đúng hình dạng, không hai chỗ tranh
nhau một khoá cũ, plugin có thật, và — quan trọng nhất — **thật sự chuyển được dữ
liệu**. Đọc mã nguồn thay vì liệt kê tay là có chủ ý: một danh sách chép tay sẽ lạc
hậu ngay lần chuyển đổi kế tiếp, mà đó đúng là lúc cần nó nhất. Nó cũng kiểm khoá
trong `liveConnections` khớp khoá tool thật sự ghi, và mọi plugin trong bảng
`MIGRATIONS` của kho bí mật đều khai quyền `secrets` (thiếu quyền là di trú vẫn chép
nhưng tool đọc lại bị chặn và hiện ra rỗng — trông y như mất dữ liệu).

## Cài đặt plugin từ bên ngoài (Phase 1: cơ chế URL + cập nhật)

Mọi plugin vẫn do chính người dùng (chủ repo) phát hành — không mở cho bên thứ
ba — nhưng từ đây, một plugin không bắt buộc phải compile sẵn vào app lúc build
nữa: nó có thể tải, kiểm, và nạp lúc app đang chạy, từ một URL.

### Định dạng gói

Một "gói" là hai thứ ở hai URL: một **manifest JSON** (`RemotePluginManifest`)
và **đúng một file bundle ESM** mà manifest trỏ tới qua `entry`. Không phải một
thư mục nhiều file — bundle được nạp qua URL kiểu `blob:` (xem dưới), và một
blob không có "thư mục chứa nó" để trình duyệt phân giải `import` tương đối.
Tác giả build ra một file đã gộp hết (Vite/esbuild/Rollup ở chế độ bundle single
file), không phải ESM nhiều file như dev server vẫn phục vụ.

```json
{
  "id": "my-tool", "version": "1.0.0", "sdk": "^1.0.0",
  "entry": "https://example.com/my-tool/1.0.0/bundle.mjs",
  "integrity": "<sha256 hex của đúng nội dung file entry>",
  "label": "My Tool", "description": "...", "icon": "puzzle",
  "keywords": [], "route": "/my-tool",
  "permissions": ["storage"], "commands": [], "hosts": []
}
```

`icon` là TÊN, không phải component — JSON không mang được code. Tra trong bảng
cố định `ICONS_BY_NAME` (`src/platform/installer.ts`); tên lạ rơi về `Puzzle`,
không chặn cài đặt. Không có `order`/`defaultEnabled` trong manifest — Platform
tự gán: `order` bắt đầu từ `100_000 + thứ tự cài` (luôn xếp sau mọi plugin
compile-time), `defaultEnabled` luôn `true` (cài rồi thì mặc định bật).

### Đường đi: tải → kiểm → lưu → nạp

`src-tauri/src/plugin_installer.rs` (Rust) + `src/platform/installer.ts` (TS).

- **Tải THẲNG BẰNG reqwest ở Rust**, không qua binding JS của
  `@tauri-apps/plugin-http`. Một gói có thể vài MB; đẩy nó qua `invoke` dưới
  dạng JSON/base64 tốn thêm ~33% và giữ cả payload trong bộ nhớ ở hai phía
  không cần thiết — Rust tải thẳng xuống đĩa (`<app_data>/plugins/<id>/<version>/
  bundle.mjs`), JS chỉ nhận lại bản ghi đã cài.
- **`integrity` (sha256) là BẮT BUỘC, kiểm HAI LẦN**: lúc cài (từ chối và không
  ghi gì xuống đĩa nếu sai), và lại một lần nữa mỗi khi ĐỌC bundle để chạy —
  phòng trường hợp file trên đĩa bị sửa sau khi cài mà `index.json` không biết.
  Một URL không tự đủ để tin: một MITM hay một server lưu trữ bị chiếm có thể
  đổi nội dung bundle mà người dùng không hay, dù chính họ đã tin nguồn.
- **Nạp qua URL `blob:`, không phải asset-protocol.** `sdk`-tương-đương ở host
  đọc lại nội dung bundle (kiểm checksum lần hai), dựng `Blob` rồi
  `URL.createObjectURL`, `import()` URL đó. Lý do chọn `blob:` thay vì scope
  asset-protocol của Tauri: hành vi CSP của `blob:` cho `import()` động là quy
  tắc trình duyệt chuẩn, kiểm chứng được mà không cần chạy GUI thật; asset-
  protocol có chi tiết cấu hình/scope riêng của từng bản Tauri mà việc này
  không xác nhận được nếu không tự tay chạy app. CSP (`tauri.conf.json`) có
  thêm `script-src 'self' blob:` — hẹp nhất có thể để cho phép đúng trường hợp
  này, không mở toang `script-src` cho mọi nguồn.
- **Đăng ký qua ĐÚNG MỘT hàm** (`registerManifest` trong `registry.ts`) dùng
  chung với 26 plugin compile-time — nên chịu chung một bộ luật: id/route/order
  không đụng nhau, hợp lệ theo `validateManifest`. Một plugin cài từ bên ngoài
  cố lấy `route: '/json'` (đã bị plugin compile-time chiếm) bị từ chối y hệt
  như hai plugin compile-time đụng route nhau lúc build — chỉ khác là lỗi này
  vào `PLUGIN_ERRORS` lúc chạy thay vì làm CI đỏ lúc build.
- **KHÔNG áp dụng ngay lập tức.** `initInstalledPlugins()` chỉ chạy MỘT LẦN lúc
  bootstrap (`main.tsx`, trước khi render `<App/>`) — cài/gỡ/cập nhật trong lúc
  app đang chạy không cập nhật sidebar tại chỗ; Settings nhắc khởi động lại,
  dùng lại đúng cơ chế `relaunch()` app đã có sẵn cho việc TỰ CẬP NHẬT
  (`UpdateContext`). Làm cho `PLUGINS` phản ứng runtime (biến registry từ mảng
  tĩnh thành store `useSyncExternalStore`-được) là việc có thể làm sau, không
  phải điều kiện để cơ chế này có ích.

### React dùng chung — hợp đồng cho tác giả plugin

Một bundle mang theo bản React riêng sẽ vỡ hook (hai bản React trong cùng một
cây component là lỗi "Invalid hook call" kinh điển). `main.tsx` gán
`window.__DEVTOOL_VENDOR__ = { react, reactDom, reactDomFull, jsxRuntime }`
ngay từ dòng đầu tiên của app. Bundle của plugin phải cấu hình build của nó để
`react`/`react-dom`/`react/jsx-runtime` KHÔNG bị tự bundle mà đọc từ đó — ví dụ
với Rollup/Vite, dùng một plugin `resolveId`/`load` ảo:

```js
// vite.config.plugin-authoring.js — ví dụ, chưa kiểm bằng một plugin thật
const vendorShim = {
  name: 'devtool-vendor-shim',
  resolveId: (id) => (['react', 'react-dom', 'react/jsx-runtime'].includes(id) ? id : null),
  load(id) {
    if (id === 'react') return 'export default window.__DEVTOOL_VENDOR__.react;';
    if (id === 'react-dom') return 'export default window.__DEVTOOL_VENDOR__.reactDomFull;';
    if (id === 'react/jsx-runtime') return `
      export const jsx = window.__DEVTOOL_VENDOR__.jsxRuntime.jsx;
      export const jsxs = window.__DEVTOOL_VENDOR__.jsxRuntime.jsxs;
      export const Fragment = window.__DEVTOOL_VENDOR__.jsxRuntime.Fragment;
    `;
  },
};
```

**Chưa kiểm bằng một plugin thật.** Cơ chế RUNTIME (vendor globals, blob-url
import, checksum kép) có test thật ở cả hai phía (13 test Rust qua server HTTP
thật, 10 test TS mock đúng ranh giới `invoke`). Phần AUTHORING (một bundle thật,
build bằng cấu hình như trên, cài qua UI, thấy nó chạy đúng trong app) thì
chưa — đây là khoảng trống cần một lần xác nhận thủ công trước khi coi cơ chế
là đã dùng được cho việc thật, không chỉ đã đúng về mặt cơ chế.

## Không làm (và vì sao)

- **Sandbox plugin.** Mọi plugin đều do chính chúng ta phát hành, nên cách ly để
  chống mã độc chưa mua được gì. Cách ly để chống **crash** thì có giá trị và thuộc
  tier B/C.
- **Đưa `useQuickPaste` / `useInputHistory` / `useImagePaste` vào SDK.** Chúng là
  thư viện UX dùng chung, không vượt ranh giới tin cậy nào — thêm một lớp gián tiếp
  mà không mua được gì.
- **`PLUGINS` phản ứng runtime.** Cài/gỡ/cập nhật cần khởi động lại — xem trên.
- **Registry tổng hợp nhiều plugin ("chợ" plugin).** Mỗi URL người dùng dán vào
  là MỘT plugin; chưa có khái niệm một `registry.json` liệt kê nhiều plugin để
  duyệt/cài hàng loạt. Thêm khi thực sự có nhiều hơn một, hai plugin cần phân
  phối kiểu này.

## Việc còn lại

1. ~~Plugin dịch vụ tier B đầu tiên.~~ **Đã có** — `devtool-svc-echo`, xem "Tier B" ở
   trên. Còn lại: một plugin thật (không phải ví dụ) khai `service` và có UI thật sự
   gọi tới sidecar của nó.
2. ~~Cài đặt plugin từ bên ngoài.~~ **Đã có phần cơ chế (Phase 1)** — xem mục ngay
   trên. Còn lại: xác nhận thủ công với một plugin thật (mục "Chưa kiểm bằng một
   plugin thật" ở trên).
3. **Phase 2 — bốn tool nặng (Kafka/RabbitMQ/Redis/Container) thành sidecar tier B
   thật, cài được qua Phase 1.** Đây LÀ một dự án riêng, không phải phần mở rộng
   nhỏ của Phase 1: `kafka.rs`/`rabbit.rs`/`redis_tool.rs`/`container_tool.rs` cộng
   lại ~4700 dòng, mỗi lệnh `#[tauri::command]` phải viết lại thành một method
   JSONL qua `service_host.rs`. ~~Khung tin nhắn stream mà các luồng dữ liệu dài
   hạn (Kafka consume, Redis Pub/Sub, log/stats container) cần~~ **đã có** — xem
   "Ghép dòng theo `id`" ở mục Tier B trên (`sdk.service.stream`, `tick-stream`
   trong `devtool-svc-echo` làm bằng chứng cơ chế). Việc còn lại của Phase 2 giờ
   thuần là việc viết lại từng tool, không còn vướng hạ tầng giao thức. Còn hai
   thứ khác cần giải quyết TRƯỚC khi một sidecar như vậy "cài được" đúng nghĩa
   qua Phase 1: (a) `plugin_installer.rs` hiện chỉ tải/kiểm/nạp bundle JS qua
   `blob:` — chưa có đường tương đương cho một BINARY native theo từng nền tảng
   (tải, kiểm checksum, cấp quyền thực thi, đặt đúng chỗ sidecar resolve được);
   (b) `ALLOWED_SERVICES` là hằng số biên dịch sẵn trong Rust theo đúng chủ đích
   (ranh giới tin cậy không giao cho manifest) — một sidecar cài lúc chạy từ bên
   ngoài sẽ không nằm trong allowlist đó trừ khi cơ chế allowlist cũng được nghĩ
   lại. Bắt đầu từ Redis (nhỏ nhất, 945 dòng, đã qua SDK từ trước) khi có quyết
   định tiếp tục.
4. **Xoá hai ngoại lệ store chung** khi các migration một lần của chúng hết hạn dùng.
