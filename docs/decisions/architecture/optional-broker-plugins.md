# Redis/RabbitMQ/Container Manager/Kafka Explorer moved to a separate plugin repo

## Bối cảnh

`redis-client`, `rabbit-client`, `container-manager` từng là ba plugin
compile-time như mọi tool khác trong `src/plugins/`. Cả ba đã là plugin Tier
B (sidecar riêng: `devtool-svc-redis`/`-rabbit`/`-container`) từ trước —
nghĩa là chúng đã tách khỏi tiến trình chính, chỉ chưa tách khỏi BẢN BUILD.
Không phải ai dùng DevTool cũng làm việc với Redis, RabbitMQ, hay
Docker/Podman — ba dependency đó (crate `redis`, `lapin`, `bollard` cùng cây
phụ thuộc của chúng) kéo dài thời gian build và tăng kích thước app cho
100% người dùng để phục vụ một nhóm nhỏ hơn.

Kafka Explorer ban đầu KHÔNG chuyển theo đợt đầu: logic Kafka nằm thẳng
trong `src-tauri/src/kafka.rs` như native command (không phải sidecar riêng
như ba tool kia), nên tách nó đòi viết lại thành sidecar JSONL trước
(`devtool-svc-kafka`) — cùng khuôn với `devtool-svc-redis` (đăng ký luồng
qua `ConsumerRegistry`/`Notify` cho live-consume). Việc viết lại đó đã xong
ở một phiên sau; Kafka Explorer giờ theo đúng khuôn ba tool kia.

## Quyết định

Chuyển UI + sidecar của cả bốn (`redis-client`, `rabbit-client`,
`container-manager`, `kafka-explorer`) sang repo riêng,
[`developer-desktop-util-plugin`](https://github.com/DianaSensei/developer-desktop-util-plugin),
cài qua URL (Settings → Extensions) thay vì compile-time. Cơ chế cài-từ-URL
đã tồn tại từ trước (`docs/plugin-sdk/05-external-install.md`) — quyết định
này không thêm cơ chế mới, chỉ là lần đầu dùng nó cho một plugin ĐÃ CÓ giá trị
người dùng thật (trước đó chỉ có `devtool-svc-echo`, một ví dụ tối giản).

## Hai lỗ hổng phải vá để việc chuyển này hoạt động thật

Cơ chế `kind: "plugin"` (external-install) trước đây được thiết kế cho một
plugin KHÔNG quyền — ví dụ trong tài liệu chỉ render `<div>Hello!</div>`.
Redis/Rabbit/Container cần `sdk.storage`, `sdk.service` (gọi sidecar),
`sdk.clipboard`… Hai chỗ phải mở rộng:

1. **`window.__DEVTOOL_VENDOR__` chỉ mang React trước đó.** Một bundle cài từ
   URL không `import` được `@/platform` (module đó không tồn tại ngoài build
   của app chính) — nên không gọi được `usePluginSdk()` để lấy SDK của chính
   mình. Thêm `window.__DEVTOOL_VENDOR__.platform.*` (`usePluginSdk`,
   `usePluginSdkFor`, `getPluginSdk`, `usePluginState`, `migrateLegacyKey`,
   `usePluginConfig`, `useLiveConnection`, `usePluginMcpBridgeActive`) — mỗi
   hàm là ĐÚNG hàm app chính dùng nội bộ, quyền vẫn kiểm y hệt, chỉ khác chỗ
   plugin lấy tham chiếu hàm (`main.tsx` thay vì `import`). Xem
   `docs/plugin-sdk/05-external-install.md`.

2. **`RemotePluginManifest` thiếu `service`.** Trước bản này, một manifest cài
   từ URL khai `permissions: ['service']` mà không có field `service.bin`/
   `service.methods` tương ứng bị `validateManifest()` từ chối thẳng
   (mismatch giữa `permissions` và `service`) — nghĩa là KHÔNG plugin nào gọi
   được sidecar qua đường cài-từ-URL, dù chính sidecar đó cài được. Thêm
   `service?: ServiceDescriptor` vào `RemotePluginManifest` (`installer.ts`)
   và `RemoteServiceDescriptor` phía Rust (`artifact_installer.rs`), truyền
   xuyên qua `installedPluginManifests()`. `bin` vẫn phải nằm trong
   `ALLOWED_SERVICES` (service_host.rs) — trường mới chỉ mang allowlist
   METHOD, không tự cấp quyền chạy một bin mới.

## Điều gì KHÔNG đổi

- `ALLOWED_SERVICES` (service_host.rs) vẫn giữ tên `devtool-svc-redis`/
  `-rabbit`/`-container` — ranh giới tin cậy "bin nào được phép chạy" là
  quyết định của TÁC GIẢ lúc build app, cơ chế cài-từ-URL chỉ đổi CHỖ LẤY
  BYTES. Bỏ tên khỏi allowlist thì việc cài sidecar từ URL sẽ luôn bị chặn,
  vĩnh viễn — xem comment tại chỗ khai hằng số đó.
- `BUNDLED_SERVICES` (hằng số MỚI, tách khỏi `ALLOWED_SERVICES`) mới là tập
  con thực sự đóng gói sẵn (`devtool-svc-echo`) — test
  `allowlist_khop_voi_external_bin` giờ chỉ khoá tập con này khớp
  `bundle.externalBin`, không khoá toàn bộ allowlist như trước.

## Hệ quả chấp nhận được

- **MCP**: `McpBackgroundBridge.tsx` không còn giữ runtime nền cho bốn tool
  này (một plugin cài từ URL chỉ mount khi route của nó đang mở — không có
  compile-time runtime context nào để share lúc tool không ở trên màn hình).
  `devtool-mcp-server.rs` không còn khai tool MCP tĩnh cho bất cứ plugin nào
  (kể cả các tool compile-in như API Client/Mock Server) — mỗi plugin tự
  mang schema MCP của nó (`mcpTools.ts` trong chính plugin) và tự đăng ký
  qua `mcp_register_tools`/`mcp_unregister_tools` (`mcp_bridge.rs`) khi
  bridge của nó mount, tự huỷ đăng ký khi unmount. `devtool-mcp-server.rs`
  đọc danh sách tool đã đăng ký qua `GET /tools` trên MỖI lần `list_tools()`
  (không cache lúc khởi động process) — nên với bốn tool này, lời gọi MCP
  chỉ xuất hiện sau khi người dùng cài plugin VÀ mở đúng route của nó (lúc
  đó bridge mới mount và đăng ký).
- **Tailwind**: các class utility riêng của ba tool này được giữ lại trong
  CSS đã build qua `src/styles/externalPluginClassnamesSafelist.ts` (một
  file text thuần, không import ở đâu) — nếu không, Tailwind JIT sẽ âm thầm
  loại các class đó khỏi CSS ngay khi source rời `src/`, và ai cài lại plugin
  sau này sẽ thấy nó render thiếu style.
