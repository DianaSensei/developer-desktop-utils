# Platform / Plugin — kiến trúc và ranh giới

**Trạng thái**: đã áp dụng (giai đoạn 1)
**Phạm vi**: mọi tool trong `src/`, hạ tầng đăng ký và SDK.

## Bối cảnh

DevTool đang đi từ "một app có nhiều tool" sang "một platform chở nhiều mini
app". Mục tiêu là phát triển nhiều tool nhỏ, nhúng chúng độc lập như plugin, và
có chỗ để quản lý cũng như kiểm toán chúng.

Trước thay đổi này, thêm một tool phải sửa **năm** chỗ rời rạc:

| Chỗ | Khai cái gì |
|---|---|
| `src/lib/toolDefs.ts` | metadata (label, icon, mô tả, từ khoá) |
| `DEFAULT_TOOL_ORDER` | thứ tự sidebar |
| `src/lib/toolRegistry.ts` | route + lazy import |
| `DEFAULT_FEATURES` trong `FeatureContext.tsx` | bật/tắt mặc định |
| `src/lib/toolGuides.tsx` | hướng dẫn sử dụng (tuỳ chọn) |

Bốn chỗ đầu không có gì bắt buộc phải khớp nhau. `allTools` ráp hai bảng bằng
`...TOOL_ROUTES[def.id]`, mà spread một `undefined` là hợp lệ trong JS — nên một
tool thiếu route chỉ **lặng lẽ** mất `path`/`component` lúc chạy thay vì báo lỗi
lúc build.

## Quyết định

### 1. Một plugin = một thư mục = một manifest

`src/plugins/<id>/plugin.ts` export default một `PluginManifest`. Platform tự
quét bằng `import.meta.glob` (`src/platform/registry.ts`). Không còn bảng đăng ký
tay nào.

`toolDefs.ts`, `toolRegistry.ts` và `DEFAULT_FEATURES` vẫn tồn tại nhưng chỉ còn
là **view dẫn xuất** từ registry — giữ nguyên hình dạng cũ để hơn một tá module
đang đọc chúng (Settings, CommandPalette, toolGroups, onboarding…) không phải đổi
trong cùng một diff.

**`eager: true` không kéo tool vào bundle khởi động**: manifest chỉ chứa metadata
và một closure `load` chưa được gọi, nên code thật của tool vẫn nằm ở chunk riêng
(đã đo: chunk `App` 995 kB → 987 kB sau thay đổi). Quét lười thì ngược lại sẽ
biến mọi thứ đọc metadata — sidebar, ⌘K, Settings — thành async.

### 2. Platform SDK là bề mặt duy nhất, và là điểm thắt để kiểm toán

`src/platform/sdk.ts` cấp SDK **theo từng plugin**: `storage` (namespace
`devtool:<id>:`), `clipboard`, `http`, `native.invoke`. Mọi kênh đi qua cùng một
trình tự: kiểm quyền đã khai trong manifest → ghi audit → mới thực thi.

Namespace storage **cố ý giữ đúng tiền tố `devtool:<id>:`** mà các tool đang dùng
với `usePersistentState`: đổi tiền tố là im lặng vứt đi collection, lịch sử và
cấu hình người dùng đã lưu.

### 3. Quyền trong manifest là khai báo, **chưa** phải hàng rào

Cần nói thẳng để không ai nhầm: mọi plugin hiện chạy **chung realm** với app, nên
về kỹ thuật nó vẫn gọi thẳng được `window.__TAURI_INTERNALS__` và bỏ qua SDK. Danh
sách `permissions` phục vụ ba việc khác, đều có giá trị thật:

1. khai báo tường minh để hiện cho người dùng (Settings → Plugin);
2. bắt lỗi sớm khi plugin dùng kênh nó chưa khai;
3. cho audit một nhãn để ghi.

Hàng rào thật chỉ xuất hiện khi plugin chạy trong webview/tiến trình riêng — lúc
đó chính danh sách này là thứ ánh xạ sang capability của Tauri.

Hệ quả đi kèm: **quyền `native` luôn phải kèm allowlist lệnh**. Quyền native không
allowlist là quyền vô hạn trên toàn bộ ~130 lệnh đã đăng ký trong `main.rs`.
`validateManifest` từ chối cả hai chiều (native không commands, commands không
native).

### 4. Manifest hỏng thì bị loại, không làm sập app

`PLUGIN_ERRORS` gom manifest bị loại kèm lý do; `registry.test.ts` khoá danh sách
đó phải rỗng. Một manifest sai chính tả làm **CI đỏ**, chứ không làm trắng cửa sổ
của người dùng.

Thư mục là danh tính: `src/plugins/json/plugin.ts` phải khai `id: 'json'`. Không
có luật này thì đường dẫn file không tra ngược được về plugin.

### 5. Settings → Plugin: hai bảng, cố ý không gộp

Manifest nói plugin **được phép** làm gì (tĩnh); nhật ký nói nó **đã** làm gì
(động, theo phiên). Chỉ có bảng thứ nhất thì quyền mãi là lời hứa; chỉ có bảng
thứ hai thì không có gì để đối chiếu.

Audit là bộ đệm vòng trong RAM (500 bản ghi), **ghi cả lời gọi bị từ chối** — đó
là loại lỗi duy nhất không tự lộ ra ở chỗ khác: hàm ném, plugin bắt lại, người
dùng chỉ thấy tính năng "không chạy".

Nhật ký chỉ ghi **host** của URL, không ghi path/query: đó là nơi token và khoá
API hay nằm.

## Ranh giới — ba tier, ba cơ chế khác nhau

Đây là quyết định quan trọng nhất và dễ làm sai nhất: **không có một cơ chế nạp
duy nhất cho mọi loại plugin.**

| Tier | Là gì | Cơ chế | Trạng thái |
|---|---|---|---|
| **A** | Mini tool JS/TS | Manifest + `import.meta.glob`, chung webview | ✅ đã làm |
| **B** | Plugin cần native (socket, fs, SDK hệ sinh thái khác) | Sidecar binary, JSONL qua stdin/stdout | ✅ khung đã có, chờ plugin đầu tiên |
| **C** | Mini app nặng (game, automation) | Crate + binary + **cửa sổ riêng** | ⏳ ngoài phạm vi hiện tại |

Tier C phải là tiến trình riêng, không phải vì hiệu năng đồ hoạ mà vì bốn ràng
buộc cụ thể của repo: profile release của app là `opt-level = "z"` (tối ưu dung
lượng — cấu hình tệ nhất cho hot loop), `panic = "abort"` (panic trong mini app sẽ
giết cả app), thời gian build đã phải hạ xuống `lto = "thin"` vì cây phụ thuộc
async, và crash driver GPU trong tiến trình sẽ kéo theo mọi consumer đang chạy.

## Kho bí mật (`src/platform/secrets.ts`)

`persistentStore` nạp **toàn bộ** `app-settings.json` vào một cache đồng bộ trong
RAM lúc khởi động, và `storageGet(bấtKỳKhoáNào)` đọc được mọi thứ trong đó. Khi
seed TOTP và token API cùng nằm trên mặt phẳng khoá ấy thì bất kỳ đoạn code nào
trong webview — kể cả một dependency npm bị chiếm trong bundle của một plugin —
cũng đọc được tất cả bằng đúng một lời gọi.

Bí mật giờ nằm ở một kho riêng, truy cập qua `sdk.secrets` (quyền `secrets`),
khoá dạng `<pluginId>/<key>`:

| Môi trường | Nơi lưu | Vì sao |
|---|---|---|
| Tauri | file store riêng `secrets.json` | không bao giờ được đọc vào cache chung |
| Web (`npm run dev`) | `sessionStorage` | `initPersistentStore()` ở bản web hút **nguyên `localStorage`** vào cache chung — lưu ở đó là đưa bí mật trở lại đúng mặt phẳng khoá vừa dọn. Đổi lại bản web chỉ giữ trong một phiên; sản phẩm thật luôn là Tauri |

Ba quyết định đi kèm:

- **Kho bất đồng bộ, khác hẳn `sdk.storage` đồng bộ.** Đó là cái giá của việc ra
  khỏi cache trong RAM. `useSecretState` gói lại, và trả thêm cờ `ready`: thiếu
  chốt đó, effect ghi của lần render đầu sẽ đẩy giá trị khởi tạo (mảng rỗng) đè
  lên dữ liệu thật vừa đọc lên — người dùng mở app ra là mất sạch tài khoản.
- **Di trú xoá nguồn, không dùng cờ "đã migrate".** Chép mà không xoá thì không
  giải quyết được gì; còn một cờ đặt sai thời điểm sẽ biến sự cố giữa chừng
  thành mất dữ liệu. Nguồn bị xoá nên chạy lại là no-op, chết giữa chừng thì lần
  khởi động sau tự thử lại.
- **Audit của kênh này chỉ ghi TÊN khoá, không bao giờ ghi giá trị.** Một nhật
  ký làm rò seed TOTP thì tệ hơn hẳn việc không có nhật ký. Có test khoá lại.

### Mã hoá khi nằm trên đĩa

`src-tauri/src/secrets_vault.rs`: nội dung nằm trong `<app_data>/secrets.enc`,
AES-256-GCM, khoá 32 byte **không nằm cạnh dữ liệu** mà ở keychain của OS
(Keychain / Credential Manager / Secret Service). Mã hoá mà cất khoá ngay cạnh
file là nghi thức, không phải bảo vệ — nên đây mới là phần cốt lõi.

Ba bất biến được khoá bằng test Rust: bản mã không chứa **cả giá trị lẫn tên
khoá** (tên khoá tiết lộ người dùng có bí mật của plugin nào); **mỗi lần ghi một
nonce mới** (dùng lại nonce với cùng khoá trong GCM là hỏng hoàn toàn về mật mã,
không chỉ yếu đi); và sửa một byte bản mã thì lần giải mã bị từ chối chứ không
trả ra bản rõ méo mó.

**Đường dự phòng fail-open, và nói thẳng vì sao.** Không phải máy Linux nào cũng
có Secret Service (máy không màn hình, phiên không gnome-keyring). Khi đó khoá
rơi về `<app_data>/secrets.key` quyền 0600. Ở chế độ này ai đọc được thư mục app
data thì đọc được cả khoá lẫn dữ liệu — nó chỉ chặn việc chép `secrets.enc` đi
nơi khác. Lựa chọn còn lại là fail-closed, tức 2FA và JWT ngừng chạy hẳn trên
những máy đó; với một công cụ dev chạy cục bộ, im lặng làm hỏng tính năng là cái
giá cao hơn. Đổi lại chế độ đang dùng **không được giấu**: `secret_vault_status`
trả ra và Settings → Plugin hiện đúng một dòng nói máy này đang ở chế độ nào.

**Không tự xoá khi không giải mã được.** Mất mục keychain thì blob thành không
đọc được; các lệnh báo lỗi rõ ràng chứ tuyệt đối không tự khởi tạo lại kho — âm
thầm vứt dữ liệu người dùng để "trở lại hoạt động" hỏng tệ hơn nhiều so với một
thông báo lỗi. `secret_vault_reset` tồn tại cho trường hợp người dùng chủ động
chọn bỏ.

Bản trung gian (tách mặt phẳng khoá, chưa mã hoá) để lại `secrets.json` trần;
`migrateSecretsFromPlainStore()` chuyển nó sang kho mã hoá rồi **dọn sạch** store
cũ — để lại bản trần cạnh bản mã hoá thì việc mã hoá chẳng còn ý nghĩa.

Đã chuyển sang kho: `devtool:2fa:accounts` (seed TOTP/HOTP) và `devtool:jwt:token`
(một JWT dán vào debugger thường là bearer token thật, không phải chuỗi ví dụ).
Hai tool này cũng là hai plugin đầu tiên chạy trên SDK thật.

### API Client: tách theo BIẾN, không bê cả tài liệu

`devtool:apiclient:environments` chứa token, nhưng không chỉ có token: base URL,
tên môi trường, biến thường — thứ người dùng sửa liên tục và các phần khác của
store đọc đồng bộ (`migrateLegacyActiveEnv`). Bê cả tài liệu sang một kho bất
đồng bộ, mã hoá lại từ đầu sau mỗi lần gõ phím, là trả giá lớn cho một phần nhỏ
dữ liệu — và biến một tài liệu đồng bộ thành bất đồng bộ giữa một tool 1000+
dòng là rủi ro không cần thiết.

Nên chỉ **giá trị của biến có `secret: true`** đi vào kho (`envSecrets.ts` +
`useEnvSecrets.ts`); cấu trúc ở lại chỗ cũ. Mô hình dữ liệu vốn đã phân biệt sẵn
— `KeyValue.secret` có từ trước, dùng để che giá trị trong editor và loại nó
khỏi cURL/codegen/history — nên đây chỉ là dùng đúng cái phân biệt đó cho việc
lưu trữ. Bảy chỗ gọi `setEnvironments` trong `store.ts` không đổi một dòng.

Bản đồ bí mật ghi lại **đầy đủ** mỗi lần, không phải bản vá: nhờ vậy bỏ đánh dấu
`secret` hay xoá môi trường sẽ dọn luôn mục cũ trong kho thay vì để nó nằm lại
vĩnh viễn. Di trú cho người nâng cấp chỉ chạy **sau khi kho đọc xong**, và giá
trị đã có trong kho thắng tàn dư inline — chạy sớm hơn, hoặc để bản cũ đè ngược,
đều là mất token thật của người dùng.

"Vault" của API Client (`devtool:apiclient:vault`) thì đi trọn vào kho: toàn bộ
nội dung của nó là bí mật theo đúng định nghĩa, nó tồn tại chính vì người dùng
không muốn những giá trị đó nằm trong environments xuất/nhập được.

`usePluginSdkFor(pluginId)` sinh ra từ đây: `ApiClientRuntimeProvider` mount
thẳng trong App.tsx (để cầu nối MCP trả lời được khi người dùng đang xem tool
khác), tức code của plugin sống ngoài cây mà Platform dựng, nơi `usePluginSdk()`
sẽ ném.

Mật khẩu broker (`kafka-brokers.json`, config Redis/RabbitMQ) đã nằm ở file
riêng phía Rust từ trước, không đi qua store chung — nên không thuộc đợt này.

## Tier B — plugin dịch vụ (sidecar)

`src-tauri/src/service_host.rs` (host) + `src/platform/service.ts` (client).
Manifest khai thêm `service: { bin, methods }` và quyền `service`.

**Giao thức**: JSON theo dòng (JSONL) qua stdin/stdout, mỗi sidecar phục vụ tuần
tự sau một mutex. Hợp đồng một sidecar phải giữ: trả đúng một dòng cho mỗi dòng
nhận được; **thoát khi stdin đóng (EOF)** — đó là cách tiến trình con được dọn
khi app bị kill mà không kịp chạy hàm dọn nào; không ghi gì khác lên stdout.

**Ranh giới tin cậy nằm ở Rust, không ở manifest.** Client nêu tên binary, nhưng
chỉ tên trong `ALLOWED_SERVICES` của `service_host.rs` mới được chạy — manifest
do webview đọc, nên nó không thể là thứ quyết định tiến trình nào được sinh ra.
Danh sách hiện rỗng: chưa plugin nào dùng tier B, nên host **fail-closed** thay
vì mở sẵn một đường chạy tiến trình cho thứ chưa tồn tại. Có test Rust khoá rằng
mọi mục trong allowlist đều phải có mặt trong `bundle.externalBin` — lệch hai chỗ
này là kiểu lỗi chỉ lộ ra sau khi phát hành.

**Timeout thì giết tiến trình, không chỉ báo lỗi.** Với một ống dẫn tuần tự, một
phản hồi đến muộn vẫn nằm trong ống và sẽ bị đọc nhầm thành phản hồi của lời gọi
kế tiếp. Cùng lý do khi sidecar trả JSON không hợp lệ: dòng vừa đọc có thể là log
lạc vào stdout. Cả hai đường đều dọn tiến trình để lần gọi sau bắt đầu sạch.

Không thêm `tauri-plugin-shell`: sidecar được resolve như binary nằm cạnh file
thực thi, đúng quy ước `mcp_bridge::mcp_sidecar_path` đã dùng — nên không phải mở
thêm quyền chạy tiến trình nào ở tầng capability.

**Chưa có đường end-to-end thật.** Test Rust lái đường I/O thật bằng tiến trình
sẵn có của hệ điều hành (`cat` làm sidecar dội lại, `sh` làm sidecar treo và
sidecar chết) thay vì ship một binary giả chỉ để kiểm thử; nhưng một sidecar
thật, đóng gói thật, chỉ xuất hiện cùng plugin dịch vụ đầu tiên.

## Không làm (và vì sao)

- **Nạp plugin lúc chạy từ repo khác.** Cần thêm: định dạng gói đã ký (tái dụng
  khoá minisign của updater), `registry.json` đã ký, kiểm `sdkRange` lúc cài, CI
  ma trận hai chiều giữa hai repo. Hợp đồng (`PluginManifest` + `sdk` range) đã
  sẵn sàng cho việc đó; cơ chế phân phối thì chưa.
- **Sandbox plugin.** Mọi plugin đều do chính chúng ta phát hành, nên cách ly để
  chống mã độc chưa mua được gì. Cách ly để chống **crash** thì có giá trị và
  thuộc tier B/C.
- **Bắt các tool hiện có chuyển sang SDK.** Manifest bọc quanh code đang có;
  không tool nào bị viết lại. Chuyển dần từng tool khi có lý do khác để động vào
  nó. Cho tới lúc đó, `permissions` trong manifest của các tool cũ là **mô tả**
  (suy ra từ chính code của chúng), không phải thứ đang được thực thi.

## Việc còn lại

1. ~~Tách credential ra khỏi store dùng chung, mã hoá khi nằm trên đĩa, và
   chuyển environments của API Client.~~ **Đã làm cả ba** — xem "Kho bí mật".
2. Thu hẹp `http://**` + `https://**` trong `capabilities/default.json` theo
   allowlist gắn với quyền `http` của từng plugin.
3. ~~Guard test ranh giới Platform.~~ **Đã làm** — `src/platform/guard.test.ts`
   + `baseline.json`, cùng cơ chế ngưỡng lùi dần như `design-system/guard.test.ts`.
   Mốc hiện tại: 12 chỗ gọi thẳng `@tauri-apps`, 47 chỗ dùng thẳng store chung.
   Mỗi tool chuyển sang SDK thì hạ ngưỡng; về 0 là quyền tương ứng thành thực thi.
4. ~~Tier B: sidecar plugin host.~~ **Đã làm phần khung** — xem "Tier B" bên dưới.
   Còn lại: plugin thật đầu tiên dùng nó (kèm binary trong `externalBin` +
   `ALLOWED_SERVICES`), và đường end-to-end chỉ chạy thật khi có plugin đó.
