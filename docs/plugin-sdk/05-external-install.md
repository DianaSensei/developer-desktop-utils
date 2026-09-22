# Cài đặt từ bên ngoài — publish một plugin/sidecar qua URL

DevTool hỗ trợ cài một plugin (Tier A, bundle JS) hoặc một sidecar (Tier B,
binary native) **sau khi app đã cài đặt**, không cần compile vào bản build
gốc — người dùng dán một URL manifest vào Settings → Extensions.

**Bối cảnh tin cậy**: cơ chế này dành cho plugin do CHÍNH bạn (chủ repo)
phát hành và tự host — không phải một kho plugin mở cho bên thứ ba. Rủi ro
được phòng là MITM/server lưu trữ bị chiếm khi tải qua mạng, không phải một
tác giả ác ý.

## Hai kind, một manifest chung

```jsonc
// kind: "plugin" — bundle JS chạy trong webview
{
  "kind": "plugin",
  "id": "hello-example",
  "version": "1.0.0",
  "sdk": "^1.0.0",
  "entry": "https://example.com/hello/bundle.mjs",
  "integrity": "<sha256 hex của đúng nội dung file bundle.mjs>",
  "label": "Hello Example",
  "description": "...",
  "icon": "puzzle",
  "keywords": [],
  "route": "/hello-example",
  "permissions": [],
  "commands": [],
  "hosts": []
}
```

```jsonc
// kind: "service" — binary native, sidecar Tier B
{
  "kind": "service",
  "bin": "devtool-svc-mydb",
  "version": "1.0.0",
  "protocol": 1,
  "targets": {
    "aarch64-apple-darwin": {
      "url": "https://example.com/mydb/devtool-svc-mydb-aarch64-apple-darwin",
      "sha256": "<sha256 hex của đúng binary cho target này>"
    },
    "x86_64-pc-windows-msvc": {
      "url": "https://example.com/mydb/devtool-svc-mydb-x86_64-pc-windows-msvc.exe",
      "sha256": "<...>"
    }
  }
}
```

`targets` là map **target-triple chuẩn Rust** → `{ url, sha256 }`. Máy tự
tính target-triple của chính nó (`current_target_triple()`, ở Rust — KHÔNG
nhận từ client/manifest) rồi tra thẳng vào map; thiếu target cho nền tảng
người dùng bị từ chối rõ ràng, không đoán/thử biến thể khác.

## Field bắt buộc và ý nghĩa

| Field (cả hai kind) | Ý nghĩa |
|---|---|
| `kind` | `"plugin"` hoặc `"service"` — bắt buộc, không suy luận. |
| `integrity`/`sha256` | SHA-256 hex, 64 ký tự, của ĐÚNG NỘI DUNG file sẽ tải. **Bắt buộc**, kiểm hai lần (lúc cài, và lại mỗi lần đọc lại trước khi chạy) — phòng trường hợp file trên đĩa bị sửa sau khi cài mà index nội bộ không biết. |
| URL (`entry`/`targets[].url`) | Phải là `https://` — `http` không mã hoá thì kiểm checksum ở bước sau cũng vô nghĩa, kẻ đứng giữa đổi được cả hai. |

Nhánh `plugin` giữ thêm mọi field của `PluginManifest` compile-time NGOẠI
TRỪ hai chỗ khác biệt bắt buộc vì giới hạn JSON:
- `icon` là TÊN icon (tra trong bảng cố định ở `installer.ts`'s
  `ICONS_BY_NAME` — tên lạ rơi về `Puzzle`, không chặn cài đặt), không phải
  component.
- Không có `load` — thay bằng `entry`, URL trỏ tới ĐÚNG MỘT file bundle đã
  build sẵn (không phải một thư mục nhiều file).

Không có `order`/`defaultEnabled` trong manifest — Platform tự gán:
`order` bắt đầu từ `100_000 + thứ tự cài` (luôn xếp sau mọi plugin
compile-time), `defaultEnabled` luôn `true`.

## Build một bundle plugin đúng chuẩn

**Một file duy nhất, không phải nhiều module.** Bundle được nạp qua
`blob:` URL + `import()` động — một URL blob không có "thư mục chứa nó" để
trình duyệt phân giải `import './helper.js'` tương đối. Build công cụ của
bạn (Vite `build.lib`, esbuild `--bundle`) phải gộp hết thành một file ESM.

**Export default một React component**, ký hiệu `default export`:

```js
// bundle.mjs — hand-written hoặc build ra từ TSX
export default function HelloPlugin() {
  const React = window.__DEVTOOL_VENDOR__.react;
  return React.createElement('div', null, 'Hello!');
}
```

**Dùng SDK DÙNG CHUNG của app nếu cần `permissions`** — một plugin khai
`permissions`/`service` trong manifest (vd để gọi một sidecar Tier B) đọc SDK
của chính nó qua `window.__DEVTOOL_VENDOR__.platform.*`, KHÔNG `import` từ
`@/platform` — bundle của bạn không có module đó. Bề mặt hiện expose:
`usePluginSdk`, `usePluginSdkFor`, `getPluginSdk`, `usePluginState`,
`migrateLegacyKey`, `usePluginConfig`, `useLiveConnection`,
`usePluginMcpBridgeActive`. Đây là ĐÚNG cùng hàm mà app chính dùng nội bộ;
`usePluginSdk()` vẫn kiểm đúng `permissions` đã khai và audit lại mọi lời gọi
như plugin compile-time, chỉ khác chỗ lấy bytes của hàm, không khác chỗ áp
luật:

```js
const { usePluginSdk } = window.__DEVTOOL_VENDOR__.platform;

export default function MyPlugin() {
  const sdk = usePluginSdk();
  // sdk.storage / sdk.service / sdk.clipboard / … — giống hệt plugin compile-time
}
```

**Dùng React DÙNG CHUNG của app** — không tự bundle `react`/`react-dom`.
Một bundle mang theo bản React riêng sẽ vỡ hook ("Invalid hook call" kinh
điển, vì hook đọc trạng thái nội bộ gắn với ĐÚNG một instance React). App
gán `window.__DEVTOOL_VENDOR__ = { react, reactDom, reactDomFull, jsxRuntime }`
ngay dòng đầu của `main.tsx`, trước bất kỳ import động nào của plugin có
thể chạy. Nếu build bằng TSX qua Vite/Rollup, cấu hình một plugin
`resolveId`/`load` ảo:

```js
// vite.config.plugin-authoring.js — ví dụ
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

**Tính SHA-256 của đúng file cuối cùng** (sau khi build, không phải file
nguồn):

```bash
shasum -a 256 bundle.mjs
# hoặc: python3 -c "import hashlib; print(hashlib.sha256(open('bundle.mjs','rb').read()).hexdigest())"
```

### CSS: bundle plugin KHÔNG mang stylesheet của riêng nó

Bundle plugin chỉ là **JavaScript** — không có file CSS nào đi kèm, và toàn
bộ giao diện ăn theo stylesheet Tailwind mà app chủ đã biên dịch sẵn.
Stylesheet đó sinh ra bằng cách quét `src/**` của **app chủ**
(`tailwind.config.js` → `content`), vốn không bao giờ chứa mã nguồn plugin
(plugin được cài lúc chạy từ một URL, không có mặt lúc app build). Hệ quả:
một class chỉ xuất hiện trong mã plugin sẽ nằm trong DOM mà **không có rule
nào phía sau** — im lặng không làm gì cả.

- **Utility có tên** (`flex`, `p-2`, `text-xs`, `h-ctl`, token design-system):
  an toàn trên thực tế — app chủ dùng chung bộ kit nên rule đã có sẵn.
- **Giá trị tuỳ ý (arbitrary value)** — `h-[68vh]`, `max-h-[70vh]`,
  `grid-cols-[1fr_auto]`… — **không an toàn**: mỗi class là một rule riêng,
  chỉ được phát sinh nếu tình cờ có file nào trong `src/**` của app chủ viết
  y hệt từng ký tự.

Vì vậy kích thước theo viewport hoặc theo pixel phải viết bằng inline
`style`, thứ không build step nào bỏ đi được:

```tsx
// có thể không có rule nào trong stylesheet của app chủ
<div className="flex h-[68vh] max-h-[calc(100vh-13rem)] flex-col" />

// luôn áp dụng
<div className="flex flex-col" style={{ height: '68vh', maxHeight: 'calc(100vh - 13rem)' }} />
```

**Utility có tên cũng không miễn nhiễm.** Rà soát cả bốn plugin bằng đúng
file CSS app chủ biên dịch ra cho thấy `bottom-3`, `pl-1.5`, `-ml-1.5`,
`py-5`, `h-64`, `m-4`, `mx-5`, `min-h-16`, `min-h-20`, `-mt-2.5`,
`align-top`, `translate-x-full` đều KHÔNG có rule — trong khi `max-h-64` nằm
ngay cạnh `h-64` thì có. Vì thế `src/styles/plugin-utilities.css` dùng
`@source inline(...)` ép Tailwind phát sinh sẵn các thang đo chung (spacing,
kích thước, vị trí, lưới, canh dọc) cho plugin dựa vào, dù không file nào
trong `src/**` dùng tới.

Safelist đó chỉ có ở bản app chủ từ đây trở đi. **Plugin cài vào bản app chủ
nào người dùng đang có**, nên mã plugin vẫn phải chạy đúng trên bản cũ — và
không safelist nào phủ nổi giá trị tuỳ ý. Repo plugin
(`developer-desktop-miniapp`) kiểm bằng `scripts/check-host-classes.mjs`:
nó phân giải mọi class plugin viết ra dựa trên một file CSS app chủ thật,
chạy với bản phát hành cũ nhất còn hỗ trợ.

```bash
# trong checkout app chủ
npm run build
# trong repo plugin
node scripts/check-host-classes.mjs ../developer-desktop-utils/dist/assets/*.css
```

Đây không phải lo xa: dialog xem log của Container Manager đã mất đúng hai
class kích thước, hộp log rơi về `height: auto`, phình theo từng dòng log đổ
về và đẩy dialog tràn khỏi cả trên lẫn dưới màn hình — thanh công cụ của
chính nó không với tới được.

## Build một sidecar đúng chuẩn để publish

Xem [04-tier-b-sidecars.md](./04-tier-b-sidecars.md) cho cách viết sidecar.
Để publish nó:

1. `cargo build --release --bin devtool-svc-<ten>` **cho từng target-triple**
   muốn hỗ trợ (cross-compile hoặc build trên máy đúng nền tảng đó).
2. Tính SHA-256 của MỖI binary đã build.
3. Host mỗi binary ở một URL `https://` (GitHub Release asset là lựa chọn
   đơn giản — public, ổn định, không cần hạ tầng riêng).
4. Viết manifest `kind: "service"` liệt kê từng target-triple → `{url, sha256}`.
5. Tên bin trong manifest (`bin`) phải khớp một tên đã có sẵn trong
   `ALLOWED_SERVICES` của app đang cài — **cài qua URL KHÔNG tự cấp quyền
   chạy cho một tên bin mới**; đây là ranh giới tin cậy cố ý (xem
   01-architecture.md). Sidecar bạn tự viết cho DevTool của chính mình thì
   bạn cũng là người thêm tên vào `ALLOWED_SERVICES` khi build app — cơ chế
   URL chỉ thay đổi CHỖ LẤY BYTES, không thay đổi AI QUYẾT ĐỊNH tên nào
   được phép chạy.

## Nơi lưu và độ ưu tiên lúc chạy

- Plugin: `<app_data>/plugins/<id>/<version>/bundle.mjs`.
- Sidecar: `<app_data>/services/<bin>/<version>/<bin>[.exe]`, ghi ATOMIC
  (tải vào file `.tmp` cùng thư mục, kiểm checksum khớp, rồi `rename`) —
  vì binary này sẽ được THỰC THI, một file dở dang do crash giữa chừng
  nguy hiểm hơn hẳn một bundle JS dở dang.
- Cả hai kind lưu chung một `<app_data>/extensions/index.json`.

**Bản tải-về LUÔN thắng bản đóng gói sẵn** nếu một sidecar cùng tên tồn
tại ở cả hai nơi — `sidecar_path()` kiểm `extensions/index.json` TRƯỚC,
cạnh-file-thực-thi (đóng gói sẵn lúc build) chỉ là fallback.

## Cập nhật và gỡ

`checkForUpdate`/`checkForServiceUpdate` so sánh SemVer giữa bản đã cài và
bản tại URL gốc đã cài từ (`source_url` lưu lại lúc cài). Cài đè một sidecar
đang chạy tự động dừng tiến trình cũ (`service_stop`) — lần gọi kế tiếp tự
spawn lại đúng version mới. Gỡ (`uninstallService`) KHÔNG đụng thư mục dữ
liệu runtime của sidecar (`service-data/<bin>/`) — dữ liệu ở lại, người
dùng tự dọn nếu muốn.

**Cài/gỡ/cập nhật không áp dụng ngay lập tức** — `initInstalledPlugins()`
chỉ chạy MỘT LẦN lúc bootstrap app. Settings nhắc khởi động lại sau khi
cài xong.

## API TypeScript để tự dựng UI cài đặt

`Settings → Extensions` (component có sẵn) đã dùng đúng các hàm này —
đọc `src/components/SettingsExtensionInstaller.tsx` nếu muốn tự làm một
UI khác:

```ts
import {
  fetchArtifactManifestPreview, // (url) => Promise<RemoteArtifactManifest>
  installArtifact,              // (url) => Promise<InstalledArtifactRecord>
  listInstalledArtifacts,       // () => Promise<InstalledArtifactRecord[]>
  uninstallArtifact,            // (idOrBin) => Promise<void>
  currentTargetTriple,          // () => Promise<string>
} from '@/platform';
```

## Link `desktop-devtool-app://install` — bấm trên trang web thay vì copy/dán tay

Trang plugin (`starlight-site`'s `plugins.astro`) không bắt người dùng tự
copy URL manifest rồi dán vào Settings nữa — mỗi thẻ plugin có một nút "Cài
đặt" trỏ tới:

```
desktop-devtool-app://install?manifest=<url manifest plugin>&service=<url manifest sidecar, nếu có>
```

Cơ chế (xem `src-tauri/src/main.rs`, `src/lib/deepLink.ts`,
`src/lib/pendingInstall.ts`):

1. `tauri-plugin-deep-link` đăng ký scheme `desktop-devtool-app` (config ở
   `tauri.conf.json`'s `plugins.deep-link.desktop.schemes`) — hệ điều hành
   mở app khi người dùng bấm link này. Bản canary đăng ký scheme riêng
   (`desktop-devtool-app-canary`, `tauri.canary.conf.json`) để không giành
   đăng ký OS-level với bản stable — nhưng cả hai bản chạy chung một bundle
   JS, nên `deepLink.ts`'s `INSTALL_LINK_SCHEMES` chấp nhận cả hai.
2. `tauri-plugin-single-instance` (feature `deep-link`, đăng ký TRƯỚC mọi
   plugin khác trong `main.rs`) đảm bảo bấm link lần hai khi app đã mở
   không mở thêm cửa sổ — chuyển tiếp URL sang tiến trình đang chạy.
3. `deepLink.ts` (JS) nghe qua `@tauri-apps/plugin-deep-link`'s
   `onOpenUrl`/`getCurrent`, tách `manifest`/`service` thành hàng đợi
   (`pendingInstall.ts`), rồi điều hướng tới `/settings`.
4. `SettingsExtensionInstaller.tsx` tự lấy URL kế tiếp trong hàng đợi, điền
   vào ô URL và gọi `fetchArtifactManifestPreview` ngay — **không tự cài**.
   Người dùng vẫn phải tự bấm "Cài đặt" sau khi xem tên/quyền/nguồn, đúng
   luồng xác nhận đã có sẵn. Cài xong plugin, nếu hàng đợi còn URL service
   (sidecar của plugin đó), màn xem trước tiếp theo tự hiện ra.

Không có phần nào ở đây bỏ qua bước xác nhận — deep link chỉ thay việc
copy/dán URL bằng một cú bấm.
