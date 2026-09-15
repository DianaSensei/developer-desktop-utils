// Cài đặt plugin từ bên ngoài — nửa TS của cơ chế; nửa Rust
// (`src-tauri/src/plugin_installer.rs`) tải, kiểm checksum và lưu bundle
// xuống đĩa. File này: gọi các lệnh đó, đổi một `RemotePluginManifest` (hình
// dạng JSON, tải từ mạng) thành một `PluginManifest` thật mà registry hiểu
// được, và là API mà Settings → Plugin dùng để cài/gỡ/cập nhật.
//
// MỘT FILE BUNDLE DUY NHẤT, KHÔNG PHẢI MỘT THƯ MỤC: `entry` trong manifest
// trỏ tới đúng một file JS (ESM). Không hỗ trợ import tương đối bên trong nó
// (`import './helper.js'`) — bundle được nạp qua URL kiểu `blob:` (xem
// `loadInstalled` dưới), và một URL blob không có "thư mục chứa nó" nào để
// trình duyệt phân giải import tương đối. Plugin tác giả phải build ra đúng
// một file đã gộp hết (Vite/esbuild với `build.lib`/`bundle: true`).
//
// REACT DÙNG CHUNG: một bundle plugin mang theo bản React riêng của nó sẽ vỡ
// hook (hai bản React trong cùng một cây component là lỗi "Invalid hook
// call" kinh điển). `main.tsx` gắn `window.__DEVTOOL_VENDOR__` ngay sau khi
// import React — bundle phải cấu hình build của nó coi `react`/`react-dom`
// là external, đọc từ đó thay vì tự bundle. Đây là HỢP ĐỒNG TÁC GIẢ, không
// phải thứ nạp lúc chạy có thể tự kiểm tra được — ghi lại ở
// docs/decisions/platform-plugin-architecture.md, chưa có công cụ scaffold
// riêng ở đợt này.

import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight, Binary, Boxes, CalendarClock, Clock, Container, Database, Dices, FileJson,
  FileText, Globe, KeyRound, MemoryStick, Network, Package, Puzzle, QrCode, Regex, Send,
  Server, ServerCog, ShieldCheck, Timer,
} from 'lucide-react';
import { isTauri } from '@/lib/platform';
import type { PluginManifest, PluginPermission } from './types';

/** Manifest thô tải từ URL — khớp `RemotePluginManifest` phía Rust. JSON
 *  không mang được component React hay closure, nên `icon` là TÊN tra trong
 *  `ICONS_BY_NAME` dưới, và không có `load` (thay bằng `entry`). */
export interface RemotePluginManifest {
  id: string;
  version: string;
  sdk: string;
  entry: string;
  integrity: string;
  label: string;
  description: string;
  icon: string;
  keywords: string[];
  route: string;
  permissions: PluginPermission[];
  commands: string[];
  hosts: string[];
}

export interface InstalledPluginRecord {
  manifest: RemotePluginManifest;
  sourceUrl: string;
  bundlePath: string;
  installedAt: number;
}

/** Bảng tên → icon cố định. Một plugin cài từ bên ngoài không thể `import`
 *  thẳng một icon component (JSON không mang code) — tác giả chọn TÊN, host
 *  tra trong bảng này. Tên lạ rơi về `Puzzle`, không chặn cài đặt: một icon
 *  sai không đáng để từ chối cả plugin. */
const ICONS_BY_NAME: Record<string, LucideIcon> = {
  puzzle: Puzzle, package: Package, boxes: Boxes, globe: Globe,
  'calendar-clock': CalendarClock, clock: Clock, timer: Timer,
  'file-json': FileJson, 'file-text': FileText, binary: Binary, regex: Regex,
  'key-round': KeyRound, 'qr-code': QrCode, 'arrow-left-right': ArrowLeftRight,
  server: Server, 'server-cog': ServerCog, database: Database, 'memory-stick': MemoryStick,
  network: Network, container: Container, send: Send, 'shield-check': ShieldCheck, dices: Dices,
};

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

function toCamelRecord(record: {
  manifest: RemotePluginManifest;
  source_url: string;
  bundle_path: string;
  installed_at: number;
}): InstalledPluginRecord {
  return {
    manifest: record.manifest,
    sourceUrl: record.source_url,
    bundlePath: record.bundle_path,
    installedAt: record.installed_at,
  };
}

/** Xem trước một manifest trước khi cài — Settings dùng để hiện tên/mô tả/
 *  quyền cho người dùng duyệt trước khi bấm "Cài đặt", không tải bundle. */
export async function fetchManifestPreview(url: string): Promise<RemotePluginManifest> {
  return invokeCommand<RemotePluginManifest>('plugin_installer_fetch_manifest', { url });
}

/** Tải, kiểm checksum, lưu xuống đĩa. Ném lỗi (đã là tiếng Việt dễ đọc, từ
 *  phía Rust) khi mạng lỗi, JSON sai hình dạng, hoặc checksum không khớp. */
export async function installPlugin(url: string): Promise<InstalledPluginRecord> {
  const record = await invokeCommand<{
    manifest: RemotePluginManifest;
    source_url: string;
    bundle_path: string;
    installed_at: number;
  }>('plugin_installer_install', { sourceUrl: url });
  return toCamelRecord(record);
}

export async function listInstalledPlugins(): Promise<InstalledPluginRecord[]> {
  if (!isTauri) return [];
  const records = await invokeCommand<
    Array<{ manifest: RemotePluginManifest; source_url: string; bundle_path: string; installed_at: number }>
  >('plugin_installer_list');
  return records.map(toCamelRecord);
}

export async function uninstallPlugin(id: string): Promise<void> {
  await invokeCommand<void>('plugin_installer_uninstall', { id });
}

/** So version đã cài với version manifest tại `sourceUrl` hiện đang khai. So
 *  sánh CHUỖI theo thứ tự semver (major.minor.patch, mỗi phần một số) — cùng
 *  quy mô tối giản với `satisfiesSdk` ở manifest.ts: đủ cho version tác giả tự
 *  tăng tuần tự, không cần kéo một thư viện semver đầy đủ cho ba con số. */
export async function checkForUpdate(
  record: InstalledPluginRecord,
): Promise<{ available: boolean; remote?: RemotePluginManifest }> {
  const remote = await fetchManifestPreview(record.sourceUrl);
  return { available: compareVersions(remote.version, record.manifest.version) > 0, remote };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Nạp mã nguồn bundle đã cài (Rust kiểm lại checksum trước khi trả về — xem
 * `plugin_installer_read_bundle`) và chạy nó như một ES module qua URL
 * `blob:`. Đây là lý do CSP có thêm `blob:` trong `script-src`
 * (`src-tauri/tauri.conf.json`): `import()` một URL không phải 'self' bị CSP
 * chặn mặc định, và `blob:` là cách hẹp nhất để cho phép đúng trường hợp này
 * mà không mở toang `script-src` cho mọi nguồn.
 *
 * Thu hồi URL blob ngay sau khi `import()` xong: một khi promise resolve,
 * thân module đã chạy và export đã nằm trong tay — không cần blob sống thêm.
 */
async function loadInstalled(id: string): Promise<React.ComponentType> {
  const source = await invokeCommand<string>('plugin_installer_read_bundle', { id });
  const blob = new Blob([source], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    const mod = (await import(/* @vite-ignore */ url)) as { default: React.ComponentType };
    return mod.default;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Installed plugin luôn xếp SAU mọi plugin compile-time, theo thứ tự cài —
 *  không cạnh tranh vị trí đã sắp tay trong manifest compile-time (order tối
 *  đa hiện dùng chưa tới 300). `initInstalledPlugins()` chỉ chạy đúng một lần
 *  mỗi phiên app (xem registry.ts), nên không cần giữ trạng thái giữa các
 *  lần gọi để tránh trùng số. */
const INSTALLED_ORDER_BASE = 100_000;

/** Đổi mọi `RemotePluginManifest` đã cài thành `PluginManifest` mà registry
 *  đăng ký được — dùng bởi `registry.ts`'s `initInstalledPlugins()`. */
export async function installedPluginManifests(): Promise<
  Array<{ manifest: PluginManifest; source: string }>
> {
  if (!isTauri) return [];
  let records: InstalledPluginRecord[];
  try {
    records = await listInstalledPlugins();
  } catch {
    // Đọc index lỗi (file hỏng, quyền đĩa…) không được phép chặn cả app khởi
    // động — coi như chưa cài gì, giống hệt "chưa cài plugin nào bao giờ".
    return [];
  }

  return records.map((record, i) => ({
    source: `installed:${record.manifest.id}@${record.manifest.version}`,
    manifest: {
      id: record.manifest.id,
      label: record.manifest.label,
      icon: ICONS_BY_NAME[record.manifest.icon] ?? Puzzle,
      description: record.manifest.description,
      keywords: record.manifest.keywords,
      route: record.manifest.route,
      order: INSTALLED_ORDER_BASE + i,
      defaultEnabled: true,
      permissions: record.manifest.permissions,
      commands: record.manifest.commands,
      hosts: record.manifest.hosts,
      sdk: record.manifest.sdk,
      load: () => loadInstalled(record.manifest.id),
    },
  }));
}

