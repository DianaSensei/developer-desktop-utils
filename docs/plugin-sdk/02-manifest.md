# Manifest — `definePlugin()` và `PluginManifest`

Mỗi plugin export default đúng một `PluginManifest`, bọc qua `definePlugin()`
(hàm này chỉ tồn tại để TypeScript suy luận kiểu đúng ngay tại chỗ khai báo —
không có logic gì bên trong).

```ts
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'my-tool',
  label: 'My Tool',
  icon: SomeLucideIcon,
  description: 'Mô tả ngắn hiện trong sidebar/tìm kiếm.',
  route: '/my-tool',
  order: 500,
  defaultEnabled: true,
  permissions: ['storage'],
  sdk: '^1.0.0',
  load: () => import('./MyToolView').then((m) => m.MyToolView),
});
```

## Bảng field đầy đủ

| Field | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `id` | `string` | ✅ | kebab-case (`a-z`, `0-9`, `-`), duy nhất toàn app.[^market-id] Đồng thời là namespace storage và khoá bật/tắt. |
| `label` | `string` | ✅ | Tên hiển thị. |
| `icon` | `LucideIcon` | ✅ | Component icon từ `lucide-react`. |
| `description` | `string` | ✅ | Câu mô tả ngắn. |
| `keywords` | `string[]` | – | Từ khoá đồng nghĩa cho tìm kiếm sidebar (vd `"epoch"` → gợi ý Date/Time). |
| `experimental` | `boolean` | – | Gắn nhãn "Experimental" mọi nơi + hỏi lại người dùng mỗi lần mở. Dùng cho plugin còn đổi hành vi/backend, KHÔNG phải cho plugin mới nhưng đã ổn định. |
| `route` | `string` | ✅ | Đường dẫn tuyệt đối, bắt đầu bằng `/`. Duy nhất toàn app. |
| `order` | `number` | ✅ | Số nguyên. Vị trí mặc định trong sidebar — nhỏ hơn lên trước, duy nhất. |
| `defaultEnabled` | `boolean` | ✅ | Trạng thái bật/tắt cho lần cài đầu. Người dùng đổi được sau trong Settings. |
| `fullHeight` | `boolean` | – | Mặc định `true`. Bỏ lớp cuộn sẵn của shell — gần như mọi tool đều cần nếu tự quản lý layout `tool-full-height`. |
| `permissions` | `PluginPermission[]` | – | Kênh SDK được phép dùng — xem bảng quyền dưới. Không khai = không gọi được. |
| `commands` | `string[]` | Có điều kiện | Allowlist lệnh Tauri, chỉ có nghĩa khi đã khai `native`. Khớp tiền tố: `'redis_'` cho phép mọi lệnh `redis_*`. |
| `hosts` | `string[]` | Có điều kiện | Allowlist host, chỉ có nghĩa khi đã khai `http`. Dạng `'example.com'`, `'*.example.com'`, hoặc `'*'`. |
| `service` | `ServiceDescriptor` | Có điều kiện | Tier B: `{ bin, methods, timeoutMs? }`. Chỉ có nghĩa khi đã khai `service`. Xem [04-tier-b-sidecars.md](./04-tier-b-sidecars.md). |
| `sdk` | `string` | ✅ | Dải version SDK, dạng `'^M.m.p'`. |
| `load` | `() => Promise<ComponentType>` | ✅ | Nạp component chính, lazy — chỉ gọi lúc điều hướng lần đầu. |

[^market-id]: Trong CHÍNH MỘT market (một `catalog.json`), `id` vẫn phải duy
    nhất — không có cơ chế nào ở đây gỡ khỏi tác giả trách nhiệm không đụng id
    plugin khác trong cùng market mình phát hành. Nhưng khi cài từ Settings →
    Marketplace, nếu người dùng đã thêm HAI market khác nhau cùng phát hành
    một `id` trùng nhau (hai tác giả không hề biết nhau), host tự phân biệt
    hai bản cài đó bằng `marketId + id` (registry id thật trở thành
    `<marketId>-<id>`, route thành `/installed/<marketId>-<id>`) — cả hai
    cùng tồn tại, không bản nào âm thầm bị ghi đè. Một plugin cài qua URL dán
    tay (không qua market nào) vẫn dùng đúng `id`/`route` gốc như trước, không
    đổi gì. Xem `src/platform/installer.ts`'s `installedPluginManifests()` và
    `src-tauri/src/artifact_installer.rs`'s `InstalledPluginRecord::market_id`.

## Bảng quyền (`PluginPermission`)

| Quyền | Mở khoá | Cần allowlist đi kèm |
|---|---|---|
| `storage` | `sdk.storage.*`, `usePluginState` | Không |
| `secrets` | `sdk.secrets.*` | Không |
| `clipboard:read` | `sdk.clipboard.readText/readImage` | Không |
| `clipboard:write` | `sdk.clipboard.writeText/writeImage` | Không |
| `files:read` | `sdk.files.pickOpen/readText/readBytes`, `sdk.native.onFileDrop` | Không |
| `files:write` | `sdk.files.pickSave/writeText/writeBytes` | Không |
| `open-url` | `sdk.openExternal` | Không |
| `http` | `sdk.http.fetch` | **Có** — `hosts` |
| `native` | `sdk.native.invoke/listen/channel` | **Có** — `commands` |
| `service` | `sdk.service.call/stream` | **Có** — `service` descriptor |

Đọc/ghi tách riêng quyền (clipboard, files) có chủ đích: một plugin chỉ cần
*nhập* dữ liệu (ví dụ import file cấu hình) không nên vì thế mà có luôn
quyền *ghi đè* lên bất cứ thứ gì người dùng chọn.

## Luật validate (`validateManifest`)

Một manifest hỏng bị loại khỏi registry lúc build/khởi động (không làm sập
cả app — xem `PLUGIN_ERRORS`), với lý do cụ thể. Các luật:

- `id` phải kebab-case đúng regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- `label`/`description` không được rỗng.
- `icon` phải là function/object (LucideIcon).
- `route` phải bắt đầu bằng `/`.
- `order` phải là số nguyên.
- `defaultEnabled` phải là boolean.
- `load` phải là function.
- `sdk` phải khớp `satisfiesSdk()` với `SDK_VERSION` hiện tại của Platform
  (caret range, `^M.m.p` — quy tắc caret chuẩn: major bằng nhau, và nếu
  major = 0 thì minor cũng phải bằng nhau).
- Mọi phần tử trong `permissions` phải nằm trong danh sách hợp lệ.
- **`commands` không rỗng ⟺ có quyền `native`** — thiếu một trong hai chiều
  đều là lỗi. Lý do: quyền `native` không kèm allowlist là quyền chạy MỌI
  lệnh Rust, không thể chấp nhận được kể cả khi tự phát hành.
- **`hosts` không rỗng ⟺ có quyền `http`** — cùng lý do. Muốn thật sự gọi
  được mọi nơi thì khai tường minh `hosts: ['*']`, không phải bỏ trống.
- **`service` descriptor có mặt ⟺ có quyền `service`.**
- Nếu có `service`: `service.bin` phải kebab-case, không đuôi mở rộng,
  không target-triple; `service.methods` không được rỗng (cùng lý do với
  `commands`/`hosts` — sidecar không giới hạn method là quyền mở vô hạn).

Chạy `npx vitest run src/platform/manifest.test.ts` (hoặc tương đương) để
xem toàn bộ ca test hiện có nếu muốn hiểu rõ hơn hành vi biên.

## Ví dụ: plugin có quyền `native` + `http`

```ts
export default definePlugin({
  id: 'weather-widget',
  label: 'Weather',
  icon: CloudIcon,
  description: 'Xem thời tiết hiện tại.',
  route: '/weather',
  order: 600,
  defaultEnabled: false,
  permissions: ['http', 'storage'],
  hosts: ['api.open-meteo.com'],
  sdk: '^1.0.0',
  load: () => import('./WeatherView').then((m) => m.WeatherView),
});
```

## Ví dụ: plugin Tier B (sidecar)

```ts
export default definePlugin({
  id: 'my-db-client',
  label: 'My DB',
  icon: DatabaseIcon,
  description: 'Client cho MyDB.',
  route: '/my-db',
  order: 700,
  defaultEnabled: false,
  permissions: ['storage', 'service'],
  service: {
    bin: 'devtool-svc-mydb',
    methods: ['list-configs', 'save-config', 'query', 'watch-changes'],
  },
  sdk: '^1.0.0',
  load: () => import('./MyDbView').then((m) => m.MyDbView),
});
```

`service.bin` phải khớp một mục trong `bundle.externalBin` của
`tauri.conf.json` VÀ nằm trong `ALLOWED_SERVICES` (hằng số Rust) — xem
[04-tier-b-sidecars.md](./04-tier-b-sidecars.md) cho toàn bộ quy trình.
