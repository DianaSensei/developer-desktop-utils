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

**Giao thức**: JSON theo dòng (JSONL) qua stdin/stdout, mỗi sidecar phục vụ tuần tự
sau một mutex. Hợp đồng sidecar phải giữ: trả đúng một dòng cho mỗi dòng nhận được;
**thoát khi stdin đóng (EOF)** — đó là cách tiến trình con được dọn khi app bị kill;
không ghi gì khác lên stdout.

**Ranh giới tin cậy ở Rust, không ở manifest.** Client nêu tên binary, nhưng chỉ tên
trong `ALLOWED_SERVICES` mới được chạy — manifest do webview đọc, nên nó không thể
là thứ quyết định tiến trình nào được sinh. Danh sách hiện rỗng: host **fail-closed**
thay vì mở sẵn một đường chạy tiến trình cho thứ chưa tồn tại. Test Rust khoá rằng
mọi mục trong allowlist đều phải có trong `bundle.externalBin`.

**Timeout thì giết tiến trình, không chỉ báo lỗi.** Với ống dẫn tuần tự, phản hồi
đến muộn vẫn nằm trong ống và sẽ bị đọc nhầm thành phản hồi của lời gọi kế tiếp.
Cùng lý do khi sidecar trả JSON không hợp lệ.

Không thêm `tauri-plugin-shell`: sidecar resolve như binary cạnh file thực thi, đúng
quy ước `mcp_bridge::mcp_sidecar_path` — không phải mở thêm quyền chạy tiến trình nào.

**Chưa có đường end-to-end thật.** Test Rust lái đường I/O thật bằng tiến trình sẵn
có của OS (`cat` làm sidecar dội lại, `sh` làm sidecar treo và chết) thay vì ship một
binary giả; nhưng một sidecar thật chỉ xuất hiện cùng plugin dịch vụ đầu tiên.

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

## Không làm (và vì sao)

- **Nạp plugin lúc chạy từ repo khác.** Cần: định dạng gói đã ký (tái dụng khoá
  minisign của updater), `registry.json` đã ký, kiểm `sdkRange` lúc cài, CI ma trận
  hai chiều. Hợp đồng (`PluginManifest` + `sdk` range) đã sẵn sàng; cơ chế phân phối
  thì chưa.
- **Sandbox plugin.** Mọi plugin đều do chính chúng ta phát hành, nên cách ly để
  chống mã độc chưa mua được gì. Cách ly để chống **crash** thì có giá trị và thuộc
  tier B/C.
- **Đưa `useQuickPaste` / `useInputHistory` / `useImagePaste` vào SDK.** Chúng là
  thư viện UX dùng chung, không vượt ranh giới tin cậy nào — thêm một lớp gián tiếp
  mà không mua được gì.

## Việc còn lại

1. **Plugin dịch vụ tier B đầu tiên** — kèm binary trong `externalBin` +
   `ALLOWED_SERVICES`; đường end-to-end chỉ chạy thật khi có nó.
2. **Phân phối plugin từ repo riêng** — xem "Không làm" ở trên.
3. **Xoá hai ngoại lệ store chung** khi các migration một lần của chúng hết hạn dùng.
