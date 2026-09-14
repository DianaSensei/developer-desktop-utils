import { lazy } from 'react';
import { withPluginSdk } from './context';
import { validateManifest } from './manifest';
import { createPluginSdk } from './sdk';
import type { PluginLoadError, PluginManifest, PluginRecord } from './types';

/**
 * Registry của Platform: quét `src/plugins/<id>/plugin.ts`, kiểm từng manifest,
 * rồi dựng ra mọi thứ phần còn lại của app cần (danh sách tool, route, thứ tự
 * sidebar, mặc định bật/tắt).
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

const seenIds = new Map<string, string>();
const seenRoutes = new Map<string, string>();
const seenOrders = new Map<number, string>();

for (const source of Object.keys(modules).sort()) {
  const manifest = modules[source]?.default;

  const problems = validateManifest(manifest);
  if (problems.length > 0) {
    errors.push({ source, id: (manifest as PluginManifest | undefined)?.id, reason: problems.join('; ') });
    continue;
  }

  const m = manifest as PluginManifest;
  // Thư mục là danh tính: `src/plugins/json/plugin.ts` phải khai id 'json'. Nếu
  // không, đường dẫn file không còn tra ngược được về plugin, và hai thư mục có
  // thể cùng khai một id mà nhìn cây thư mục không thấy gì bất thường.
  const folder = /\/plugins\/([^/]+)\/plugin\.ts$/.exec(source)?.[1];
  if (folder && folder !== m.id) {
    errors.push({ source, id: m.id, reason: `id "${m.id}" không khớp tên thư mục "${folder}"` });
    continue;
  }
  const clash =
    (seenIds.has(m.id) && `id "${m.id}" đã dùng ở ${seenIds.get(m.id)}`) ||
    (seenRoutes.has(m.route) && `route "${m.route}" đã dùng ở ${seenRoutes.get(m.route)}`) ||
    (seenOrders.has(m.order) && `order ${m.order} đã dùng ở ${seenOrders.get(m.order)}`);
  if (clash) {
    errors.push({ source, id: m.id, reason: clash });
    continue;
  }
  seenIds.set(m.id, source);
  seenRoutes.set(m.route, source);
  seenOrders.set(m.order, source);

  const sdk = createPluginSdk(m);
  records.push({
    ...m,
    keywords: m.keywords ?? [],
    experimental: m.experimental ?? false,
    fullHeight: m.fullHeight ?? true,
    permissions: m.permissions ?? [],
    commands: m.commands ?? [],
    component: lazy(async () => ({ default: withPluginSdk(sdk, await m.load()) })),
  });
}

records.sort((a, b) => a.order - b.order);

/** Mọi plugin hợp lệ, đã sắp theo `order`. */
export const PLUGINS: readonly PluginRecord[] = records;

export const PLUGIN_MAP: ReadonlyMap<string, PluginRecord> = new Map(records.map((p) => [p.id, p]));

/**
 * Manifest bị loại và lý do. Rỗng ở mọi build lành mạnh — `registry.test.ts`
 * khoá điều đó, nên một manifest hỏng làm đỏ CI thay vì âm thầm mất một tool
 * khỏi sidebar của người dùng.
 */
export const PLUGIN_ERRORS: readonly PluginLoadError[] = errors;

/** Thứ tự sidebar cho bản cài mới. */
export const DEFAULT_PLUGIN_ORDER: readonly string[] = records.map((p) => p.id);

/** Bật/tắt mặc định cho bản cài mới, khớp khoá của FeatureContext. */
export const DEFAULT_PLUGIN_FEATURES: Readonly<Record<string, boolean>> = Object.fromEntries(
  records.map((p) => [p.id, p.defaultEnabled]),
);

export function getPlugin(id: string): PluginRecord | undefined {
  return PLUGIN_MAP.get(id);
}
