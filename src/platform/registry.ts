import { lazy } from 'react';
import { withPluginSdk } from './context';
import { validateManifest } from './manifest';
import { createPluginSdk } from './sdk';
import { isTauri } from '@/lib/platform';
import { installedPluginManifests } from './installer';
import type { PluginLoadError, PluginManifest, PluginRecord } from './types';

/**
 * Registry của Platform: quét `src/plugins/<id>/plugin.ts` lúc BUILD (plugin
 * compile-time), rồi sau đó — lúc app khởi động, xem `initInstalledPlugins()`
 * — nạp thêm plugin đã CÀI TỪ BÊN NGOÀI (`src/platform/installer.ts`). Cả hai
 * loại đi qua đúng một hàm đăng ký (`registerManifest`) nên chịu chung một bộ
 * luật: hợp lệ, không đụng id/route/order của nhau, và có audit như nhau.
 *
 * `eager: true` là cố ý và KHÔNG kéo tool vào bundle khởi động: file manifest
 * chỉ chứa metadata + một closure `load` chưa được gọi, nên code thật của tool
 * vẫn nằm ở chunk riêng, tách ra đúng lúc `lazy` chạm vào lần đầu. Quét lười
 * thì ngược lại sẽ biến mọi thứ đọc metadata (sidebar, Command Palette,
 * Settings) thành async — trả giá lớn để đổi lấy vài KB.
 */
const modules = import.meta.glob<{ default: PluginManifest }>('../plugins/*/plugin.ts', {
  eager: true,
});

const errors: PluginLoadError[] = [];
const records: PluginRecord[] = [];

/** Khai TRƯỚC vòng lặp glob bên dưới, dù nó chỉ được export — `registerManifest`
 *  (gọi ngay trong vòng lặp đó) ghi vào đây, và một `const` được tham chiếu
 *  trước khi chính dòng khai báo của nó chạy thì ném lỗi "trước khi khởi tạo"
 *  bất kể tham chiếu đó nằm trong thân một hàm hay không — thứ tự văn bản ở
 *  đây là bắt buộc, không phải trang trí. */
export const PLUGIN_MAP: Map<string, PluginRecord> = new Map();

const seenIds = new Map<string, string>();
const seenRoutes = new Map<string, string>();
const seenOrders = new Map<number, string>();

/**
 * Đăng ký một manifest — dùng chung cho cả plugin compile-time (glob ở dưới)
 * và plugin cài từ bên ngoài (`initInstalledPlugins`). `requireFolderMatch`
 * chỉ có nghĩa với loại đầu: "thư mục là danh tính" là luật cho file nằm
 * trong `src/plugins/`, không áp dụng cho một bản ghi tải về lúc chạy (không
 * có "thư mục nguồn" nào để so).
 */
function registerManifest(
  manifest: unknown,
  source: string,
  options: { requireFolderMatch?: boolean } = {},
): void {
  const problems = validateManifest(manifest);
  if (problems.length > 0) {
    errors.push({ source, id: (manifest as PluginManifest | undefined)?.id, reason: problems.join('; ') });
    return;
  }

  const m = manifest as PluginManifest;
  if (options.requireFolderMatch) {
    // Thư mục là danh tính: `src/plugins/json/plugin.ts` phải khai id 'json'.
    // Nếu không, đường dẫn file không còn tra ngược được về plugin, và hai
    // thư mục có thể cùng khai một id mà nhìn cây thư mục không thấy gì
    // bất thường.
    const folder = /\/plugins\/([^/]+)\/plugin\.ts$/.exec(source)?.[1];
    if (folder && folder !== m.id) {
      errors.push({ source, id: m.id, reason: `id "${m.id}" không khớp tên thư mục "${folder}"` });
      return;
    }
  }

  const clash =
    (seenIds.has(m.id) && `id "${m.id}" đã dùng ở ${seenIds.get(m.id)}`) ||
    (seenRoutes.has(m.route) && `route "${m.route}" đã dùng ở ${seenRoutes.get(m.route)}`) ||
    (seenOrders.has(m.order) && `order ${m.order} đã dùng ở ${seenOrders.get(m.order)}`);
  if (clash) {
    errors.push({ source, id: m.id, reason: clash });
    return;
  }
  seenIds.set(m.id, source);
  seenRoutes.set(m.route, source);
  seenOrders.set(m.order, source);

  const sdk = createPluginSdk(m);
  const record: PluginRecord = {
    ...m,
    keywords: m.keywords ?? [],
    experimental: m.experimental ?? false,
    fullHeight: m.fullHeight ?? true,
    permissions: m.permissions ?? [],
    commands: m.commands ?? [],
    component: lazy(async () => ({ default: withPluginSdk(sdk, await m.load()) })),
  };
  records.push(record);
  records.sort((a, b) => a.order - b.order);
  // `PLUGIN_MAP` phải cập nhật CÙNG LÚC với `records`: nó được dựng một lần từ
  // `records` ngay dưới đây cho 26 plugin compile-time, nhưng
  // `initInstalledPlugins()` gọi lại `registerManifest` này SAU thời điểm đó —
  // thiếu dòng này, `getPlugin()` sẽ không bao giờ thấy một plugin cài từ bên
  // ngoài dù nó có mặt trong `PLUGINS`.
  PLUGIN_MAP.set(record.id, record);
}

for (const source of Object.keys(modules).sort()) {
  registerManifest(modules[source]?.default, source, { requireFolderMatch: true });
}

/** Mọi plugin hợp lệ, đã sắp theo `order`. Mảng CÙNG một tham chiếu trong
 *  suốt vòng đời app — `initInstalledPlugins()` nối thêm vào chính mảng này
 *  (`push`), không thay bằng mảng mới, vì `DEFAULT_PLUGIN_ORDER`/
 *  `DEFAULT_PLUGIN_FEATURES` bên dưới được suy ra một lần lúc app khởi động
 *  và phải nhìn thấy plugin cài từ bên ngoài trong đó. */
export const PLUGINS: readonly PluginRecord[] = records;

/**
 * Manifest bị loại và lý do. Rỗng ở mọi build lành mạnh cho phần compile-time
 * — `registry.test.ts` khoá điều đó, nên một manifest hỏng làm đỏ CI thay vì
 * âm thầm mất một tool khỏi sidebar của người dùng. Một plugin cài từ bên
 * ngoài bị từ chối cũng vào đây, nhưng KHÔNG làm CI đỏ (nó không tồn tại lúc
 * build) — Settings → Extensions đọc mảng này để báo cho người dùng biết.
 */
export const PLUGIN_ERRORS: PluginLoadError[] = errors;

/** Thứ tự sidebar cho bản cài mới. */
export const DEFAULT_PLUGIN_ORDER: readonly string[] = records.map((p) => p.id);

/** Bật/tắt mặc định cho bản cài mới, khớp khoá của FeatureContext. */
export const DEFAULT_PLUGIN_FEATURES: Readonly<Record<string, boolean>> = Object.fromEntries(
  records.map((p) => [p.id, p.defaultEnabled]),
);

export function getPlugin(id: string): PluginRecord | undefined {
  return PLUGIN_MAP.get(id);
}

/**
 * Nạp plugin đã cài từ bên ngoài vào registry — gọi MỘT LẦN lúc bootstrap
 * (`main.tsx`, trước khi render `<App/>`), đúng vị trí `initPersistentStore()`
 * đã chiếm giữ cho cùng một lý do: mọi thứ đọc `PLUGINS` (sidebar, Command
 * Palette, `FeatureContext`) giả định danh sách đã ĐẦY ĐỦ trước khung hình vẽ
 * đầu tiên, và một plugin cài từ bên ngoài không thể biết được tại thời điểm
 * `import.meta.glob` chạy (lúc build) — nó chỉ tồn tại trên đĩa của máy người
 * dùng, đọc được lúc app khởi động, không sớm hơn.
 *
 * Không làm gì trên bản web (`!isTauri`): không có kho cài đặt cục bộ nào để
 * đọc — giữ `PLUGINS` đúng 26 plugin compile-time, khớp `registry.test.ts`.
 *
 * KHÔNG phản ứng lại khi cài/gỡ plugin trong lúc app đang chạy: `PLUGINS` chỉ
 * được đọc lại một lần ở đây. Settings → Extensions nhắc người dùng khởi động lại
 * app sau khi cài/gỡ/cập nhật — cùng mô hình app đã dùng cho việc TỰ CẬP NHẬT
 * (`UpdateContext` cũng cài xong rồi `relaunch()`), không phải một quyết định
 * riêng cho plugin.
 */
export async function initInstalledPlugins(): Promise<void> {
  if (!isTauri) return;
  const manifests = await installedPluginManifests();
  for (const { manifest, source } of manifests) {
    registerManifest(manifest, source);
  }
}
