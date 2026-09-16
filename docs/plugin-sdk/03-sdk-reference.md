# SDK Reference — `sdk.*`

Component của plugin nhận `sdk: PluginSdk` qua `usePluginSdkFor(pluginId)`
hoặc `usePluginSdk()` (nếu render trong `<PluginProvider>`). Đây là TOÀN BỘ
bề mặt plugin được phép chạm ra ngoài chính nó — không import gì khác từ
`@tauri-apps/*` hay `@/lib/*` nội bộ của app.

```tsx
import { usePluginSdkFor } from '@/platform';

export function MyToolView() {
  const sdk = usePluginSdkFor('my-tool');
  // sdk.storage, sdk.secrets, sdk.clipboard, sdk.files, sdk.http,
  // sdk.native, sdk.service, sdk.openExternal, sdk.env, sdk.log
}
```

Mọi lời gọi dưới đây, nếu manifest chưa khai quyền tương ứng, ném lỗi ngay
(`PluginPermissionError`/`PluginHostError`/`PluginCommandError`) — bắt các
lỗi này trong development bằng cách xem console, không phải bằng try/catch
phòng thủ trong code (đây là lỗi cấu hình manifest, không phải lỗi runtime
cần xử lý mượt).

## `sdk.id`, `sdk.sdkVersion`, `sdk.permissions`

Chỉ đọc. `id` là id plugin (khớp `manifest.id`), `permissions` là danh sách
quyền đã khai — hữu ích nếu component muốn tự ẩn UI của một tính năng chưa
có quyền thay vì để nó ném lỗi khi bấm.

## `sdk.env`

```ts
sdk.env.isTauri  // đang chạy trong Tauri hay trình duyệt thường (dev/test)
sdk.env.isMac
sdk.env.modKey   // '⌘' hoặc 'Ctrl' — dùng để hiển thị phím tắt
```

Không cần quyền — không tiết lộ gì hơn `navigator.userAgent`.

## `sdk.storage` — quyền `storage`

Đồng bộ, giá trị dạng chuỗi, namespace tự động theo `devtool:<pluginId>:<key>`.

```ts
sdk.storage.get('selectedId')          // string | null
sdk.storage.set('selectedId', 'abc')
sdk.storage.remove('selectedId')
sdk.storage.key('selectedId')          // khoá đầy đủ đã gắn namespace
```

**Không dùng trực tiếp trong component React** — dùng
`usePluginState` thay thế (xem bên dưới), nó bọc `sdk.storage` thành một
`useState` có ghi nhớ, đúng convention toàn bộ app dùng.

### `usePluginState(sdk, key, initial, options?)`

```tsx
import { usePluginState } from '@/platform';

const [selectedId, setSelectedId] = usePluginState(sdk, 'selectedId', '');
```

Hành vi y hệt `usePersistentState` nội bộ (đọc đồng bộ lúc dựng, ghi có
debounce, xả khi cửa sổ ẩn/đóng) — chỉ khác ở việc khoá được gắn namespace
theo plugin và quyền `storage` được kiểm.

`options.legacyKey`: nếu tool của bạn từng lưu ở một khoá KHÁC trước khi
chuyển sang SDK (ví dụ đang port từ code cũ), truyền khoá cũ vào đây — di
trú chạy đúng một lần lúc dựng, chỉ khi khoá mới còn trống. **Bắt buộc**
mỗi khi đổi vị trí lưu trữ để không âm thầm vứt dữ liệu người dùng — xem
`docs/decisions/architecture/platform-plugin-architecture.md` mục "Di trú dữ liệu người
dùng" cho ba khuôn mẫu di trú đầy đủ.

## `sdk.secrets` — quyền `secrets`

Bất đồng bộ, tách hẳn khỏi `sdk.storage` — kho riêng, mã hoá (AES-256-GCM,
khoá trong keychain OS trên Tauri thật; `sessionStorage` trên bản web).
Dùng cho token, mật khẩu, seed TOTP — bất cứ thứ gì không nên nằm chung mặt
phẳng khoá với cấu hình thường.

```ts
await sdk.secrets.get('apiToken')       // string | null
await sdk.secrets.set('apiToken', 'xxx')
await sdk.secrets.delete('apiToken')
await sdk.secrets.keys()                // string[]
```

Hoặc dùng hook `useSecretState(sdk, key)` nếu cần binding React.

## `sdk.clipboard` — quyền `clipboard:read` / `clipboard:write`

```ts
await sdk.clipboard.readText()          // string | null
await sdk.clipboard.writeText('...')
await sdk.clipboard.readImage()         // data URL PNG | null
await sdk.clipboard.writeImage(blobOrDataUrl)
```

## `sdk.files` — quyền `files:read` / `files:write`

```ts
const paths = await sdk.files.pickOpen({ multiple: true, filters: [{ name: 'JSON', extensions: ['json'] }] });
const path = await sdk.files.pickSave({ defaultPath: 'export.json' });
const text = await sdk.files.readText(path);
await sdk.files.writeText(path, contents, { append: true });
const bytes = await sdk.files.readBytes(path);
await sdk.files.writeBytes(path, data);
```

Kéo-thả file cấp cửa sổ (Tauri chặn trước webview, `ondrop` HTML không bao
giờ nhận được) — gác sau `files:read`:

```ts
const unlisten = await sdk.native.onFileDrop((event) => {
  // event.type: 'enter' | 'over' | 'drop' | 'leave'
  // event.paths chỉ có ở pha 'drop'
});
// PHẢI gọi unlisten() lúc unmount
```

## `sdk.http.fetch` — quyền `http` (kèm `hosts`)

```ts
const res = await sdk.http.fetch('https://api.example.com/data', {
  method: 'POST',
  maxRedirections: 0,       // riêng của Tauri, fetch trình duyệt không có
  danger: { acceptInvalidCerts: true },  // cho endpoint tự ký, dùng cẩn thận
});
```

`fetch` tương thích chuẩn Web API, tự động đi qua `tauri-plugin-http` khi
chạy trong app thật (bỏ qua CORS/cookie sandbox của webview — đó là lý do
nó tồn tại), rơi về `fetch` trình duyệt trên bản web/test. Host của `input`
phải khớp `manifest.hosts` (`hostAllowed()`), không thì ném `PluginHostError`
— kiểm TRƯỚC khi request thật sự bay đi.

## `sdk.native` — quyền `native` (kèm `commands`)

Dành cho lệnh Rust biên dịch sẵn vào app chính (không phải Tier B sidecar
— xem `sdk.service` cho việc đó).

```ts
const result = await sdk.native.invoke<MyType>('my_command', { arg: 1 });

const unlisten = await sdk.native.listen<MyPayload>('my-event', (payload) => {
  // xử lý sự kiện Rust phát ra
});
// PHẢI gọi unlisten() lúc unmount

const channel = await sdk.native.channel<MyChunk>((chunk) => {
  // nhận dữ liệu streaming từ một lệnh Rust dùng Channel<T>
}, 'my-stream-label');
// truyền `channel` làm tham số cho invoke tới lệnh Rust nhận Channel
```

`invoke` khớp CẢ hai điều kiện trước khi cho qua: có quyền `native` VÀ tên
lệnh khớp một mục (hoặc tiền tố một mục) trong `commands`. `channel()`/
`listen()` chỉ kiểm quyền `native` — không có tên lệnh cụ thể để đối chiếu
allowlist ở bước mở kênh (allowlist áp dụng ở chính lời `invoke` sẽ dùng
kênh đó).

**Lưu ý**: nếu plugin của bạn KHÔNG cần lệnh Rust biên dịch sẵn (chỉ cần
sidecar riêng), đừng khai quyền `native` — dùng `sdk.service` thay thế.
Ngoại lệ hợp lệ duy nhất cho `native` ở một plugin có `service`: cầu nối
MCP dùng chung (`mcp_respond`) — xem cách `redis-client`/`container-manager`/
`rabbit-client` giữ cả hai quyền.

## `sdk.service` — quyền `service` (kèm `service` descriptor)

Gọi sidecar Tier B của chính plugin. Xem
[04-tier-b-sidecars.md](./04-tier-b-sidecars.md) cho toàn bộ thiết kế phía
Rust; ở đây là nửa client.

```ts
// Một-lần
const configs = await sdk.service.call<Config[]>('list-configs');
const saved = await sdk.service.call<Config>('save-config', { config });

// Stream (nhiều sự kiện cho một lời gọi — Pub/Sub, tail log, ...)
const subscription = await sdk.service.stream<MyEvent>(
  'watch-changes',
  (event) => { /* xử lý mỗi sự kiện */ },
  { filter: 'abc' },
);
// ...
await subscription.stop();
```

`method` phải nằm trong `manifest.service.methods`, không thì ném
`PluginServiceError` ngay ở client, không chạm tới sidecar. Xem
04-tier-b-sidecars.md cho khuôn mẫu đúng của một stream vô hạn cần
"dừng tay" (registry nội bộ + method `unsubscribe` riêng) — `subscription.stop()`
chỉ gỡ đăng ký PHÍA HOST, không tự động báo cho sidecar biết.

## `sdk.openExternal` — quyền `open-url`

```ts
await sdk.openExternal('https://example.com');
```

Mở bằng trình duyệt mặc định của hệ điều hành, không mở trong webview của
app.

## `sdk.log`

```ts
sdk.log('đã kết nối', `tới ${host}:${port}`);
```

Ghi một dòng vào audit log kênh `lifecycle`, không cần quyền nào. Dùng cho
các mốc quan trọng trong vòng đời plugin (kết nối thành công, bắt đầu một
phiên làm việc dài) — không phải để log mọi tương tác UI.

## Các hook/service dùng chung khác (export qua `@/platform`)

| Export | Dùng khi |
|---|---|
| `usePluginSdkFor(id)` | Lấy `sdk` trong một component KHÔNG nằm trong `<PluginProvider>` (đa số trường hợp — mỗi plugin tự quản component gốc của nó). |
| `usePluginSdk()` / `usePluginSdkOptional()` | Lấy `sdk` qua context, nếu component nằm trong `<PluginProvider>` do chính plugin dựng (cho cây con nhiều tầng). |
| `getPluginSdk(id)` | Lấy `sdk` NGOÀI React (store ở phạm vi module, chạy một lần lúc import) — xem cách `liveConnections.ts`-kiểu module dùng nó. |
| `usePluginConfig()`, `useLiveConnection()`, `usePluginMcpBridgeActive()` | Ba dịch vụ có hình dạng React, xuất qua cùng cửa `@/platform` vì không thể là thuộc tính phẳng của object `sdk`. |
| `pluginAudit.recent()` | Đọc nhật ký audit gần đây (Settings → Extensions dùng cái này để hiện bảng "đã làm gì"). |

## Kiểm quyền không phải kiểm boolean đơn giản

Toàn bộ `ensure()` nội bộ của SDK vừa kiểm quyền vừa GHI AUDIT trong cùng
một bước — kể cả khi lời gọi bị từ chối. Đừng tự viết code kiểm
`sdk.permissions.includes('http')` rồi mới gọi `sdk.http.fetch` — cứ gọi
thẳng và để SDK tự chặn/ghi log; kiểm tay trước chỉ tạo ra hai đường code
phải giữ đồng bộ cho không lợi ích gì thêm.
