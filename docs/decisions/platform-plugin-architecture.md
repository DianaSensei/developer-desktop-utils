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
| **B** | Plugin cần native (socket, fs, SDK hệ sinh thái khác) | Sidecar binary, IPC theo mẫu `mcp_bridge.rs` | ⏳ chưa |
| **C** | Mini app nặng (game, automation) | Crate + binary + **cửa sổ riêng** | ⏳ ngoài phạm vi hiện tại |

Tier C phải là tiến trình riêng, không phải vì hiệu năng đồ hoạ mà vì bốn ràng
buộc cụ thể của repo: profile release của app là `opt-level = "z"` (tối ưu dung
lượng — cấu hình tệ nhất cho hot loop), `panic = "abort"` (panic trong mini app sẽ
giết cả app), thời gian build đã phải hạ xuống `lto = "thin"` vì cây phụ thuộc
async, và crash driver GPU trong tiến trình sẽ kéo theo mọi consumer đang chạy.

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

1. Tách credential ra khỏi store dùng chung. `devtool:2fa:accounts` (TOTP
   secret), `devtool:apiclient:environments` (token), `kafka-brokers.json`
   (`sasl_password`) đang nằm chung một mặt phẳng khoá mà mọi code trong webview
   đọc được. Đây là điều kiện tiên quyết trước khi nạp bất cứ thứ gì lúc chạy.
2. Thu hẹp `http://**` + `https://**` trong `capabilities/default.json` theo
   allowlist gắn với quyền `http` của từng plugin.
3. Guard test cấm `src/plugins/**` import trực tiếp `@tauri-apps/*` (theo mẫu
   `design-system/guard.test.ts`), để `permissions` chuyển dần từ mô tả sang
   thực thi.
4. Tier B: sidecar plugin host.
