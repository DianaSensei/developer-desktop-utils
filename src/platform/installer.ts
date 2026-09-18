// Cài đặt "artifact" từ bên ngoài — nửa TS của cơ chế; nửa Rust
// (`src-tauri/src/artifact_installer.rs`) tải, kiểm checksum và lưu artifact
// xuống đĩa. File này: gọi các lệnh Rust (đổi tên từ `plugin_installer_*`
// sang `artifact_installer_*` — xem docs/plans/native-sidecar-install.md),
// đổi hình dạng snake_case trả về thành camelCase, và là API mà
// SettingsExtensionInstaller dùng để xem trước/cài/gỡ/cập nhật.
//
// GIỮ TÊN FILE `installer.ts` (không đổi thành `artifactInstaller.ts`): file
// này đã tổng quát đúng mức cần — "cài một thứ từ bên ngoài" vẫn là đúng một
// việc file này làm, chỉ thêm một nhánh `kind` mới, không phải một trách
// nhiệm khác hẳn đòi một cái tên khác. Đổi tên chỉ tạo thêm một chỗ import
// phải sửa mà không có lợi ích tương xứng.
//
// HAI TẦNG API có chủ đích:
//   - `fetchArtifactManifestPreview`/`installArtifact`/`listInstalledArtifacts`/
//     `uninstallArtifact` — tầng TỔNG QUÁT, trả `kind` tường minh, dùng bởi
//     `SettingsExtensionInstaller.tsx` (biết cả hai kind trong cùng một danh
//     sách).
//   - `fetchManifestPreview`/`installPlugin`/`listInstalledPlugins`/
//     `uninstallPlugin`/`checkForUpdate` (nhánh PLUGIN) và
//     `installService`/`listInstalledServices`/`uninstallService`/
//     `checkForServiceUpdate` (nhánh SERVICE) — tầng THEO KIND, hành vi/hình
//     dạng giữ NGUYÊN như Phase 1 đã có cho plugin (chỉ đổi tên lệnh Rust gọi
//     xuống), mirror cho service. `registry.ts`'s `initInstalledPlugins()`
//     (không quan tâm gì tới service) tiếp tục dùng đúng những hàm này không
//     cần sửa.
//
// MỘT FILE BUNDLE DUY NHẤT, KHÔNG PHẢI MỘT THƯ MỤC (nhánh plugin): `entry`
// trong manifest trỏ tới đúng một file JS (ESM). Không hỗ trợ import tương
// đối bên trong nó (`import './helper.js'`) — bundle được nạp qua URL kiểu
// `blob:` (xem `loadInstalled` dưới), và một URL blob không có "thư mục chứa
// nó" nào để trình duyệt phân giải import tương đối. Plugin tác giả phải
// build ra đúng một file đã gộp hết (Vite/esbuild với `build.lib`/`bundle:
// true`).
//
// REACT DÙNG CHUNG (nhánh plugin): một bundle plugin mang theo bản React
// riêng của nó sẽ vỡ hook (hai bản React trong cùng một cây component là lỗi
// "Invalid hook call" kinh điển). `main.tsx` gắn `window.__DEVTOOL_VENDOR__`
// ngay sau khi import React — bundle phải cấu hình build của nó coi
// `react`/`react-dom` là external, đọc từ đó thay vì tự bundle. Đây là HỢP
// ĐỒNG TÁC GIẢ, không phải thứ nạp lúc chạy có thể tự kiểm tra được — ghi lại
// ở docs/decisions/architecture/platform-plugin-architecture.md.
//
// NHÁNH SERVICE KHÔNG CÓ BLOB/IMPORT(): một binary native không chạy trong
// webview — nó được cài xuống đĩa rồi SPAWN như tiến trình con (xem
// `service_host.rs`'s `sidecar_path`/`get_or_spawn`). Vì vậy không có hàm
// "loadInstalledService" tương đương `loadInstalled` — `service_call` tự tìm
// đúng binary đã cài qua `sidecar_path`, TS không cần (và không nên) tự tay
// nạp/thực thi gì thêm ở đây.

import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight, Binary, Boxes, CalendarClock, Clock, Container, Database, Dices, FileJson,
  FileText, Globe, KeyRound, MemoryStick, Network, Package, Puzzle, QrCode, Regex, Send,
  Server, ServerCog, ShieldCheck, Timer,
} from 'lucide-react';
import { isTauri } from '@/lib/platform';
import type { PluginManifest, PluginPermission } from './types';
import type { ServiceDescriptor } from './service';

// ---------------------------------------------------------------------------
// Manifest thô tải từ URL — khớp `RemoteArtifactManifest` phía Rust
// ---------------------------------------------------------------------------

/** Nhánh plugin — hình dạng giữ NGUYÊN từ Phase 1. JSON không mang được
 *  component React hay closure, nên `icon` là TÊN tra trong `ICONS_BY_NAME`
 *  dưới, và không có `load` (thay bằng `entry`). */
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
  /**
   * Tier B — sidecar mà plugin này gọi tới, khi `permissions` khai `'service'`.
   * Cùng hình dạng `ServiceDescriptor` compile-time; đây là bổ sung so với
   * Phase 1 (khi nhánh plugin external-install chỉ hỗ trợ Tier A) — không có
   * trường này, `validateManifest()` từ chối mọi plugin cài từ URL có khai
   * `'service'` (mismatch `hasService`/`m.service`), tức bản trước KHÔNG cài
   * được một plugin gọi sidecar qua URL dù chính sidecar đó (`kind: "service"`)
   * cài được. `bin` ở đây vẫn phải nằm trong `ALLOWED_SERVICES` phía Rust —
   * trường này chỉ mang theo allowlist METHOD của plugin, không tự cấp quyền
   * chạy một bin mới (xem docs/plugin-sdk/05-external-install.md).
   */
  service?: ServiceDescriptor;
}

/** Một target khả dụng của một service — địa chỉ tải + checksum riêng cho
 *  một target triple cụ thể (vd `x86_64-apple-darwin`). Khớp `ServiceTarget`
 *  phía Rust. */
export interface ServiceTarget {
  url: string;
  sha256: string;
}

/** Nhánh service — mô tả một phiên bản của một sidecar native. `bin` là TÊN
 *  TRẦN, không đuôi mở rộng, không target triple — đuôi `.exe` cho Windows do
 *  host tự thêm khi đặt tên file cuối cùng trên đĩa. Khớp
 *  `RemoteServiceManifest` phía Rust; `targets` là map target-triple →
 *  `ServiceTarget` (Rust `HashMap` tuần tự hoá thành object JSON thường). */
export interface RemoteServiceManifest {
  bin: string;
  version: string;
  protocol: number;
  targets: Record<string, ServiceTarget>;
}

/** Manifest tổng quát — khớp `RemoteArtifactManifest` phía Rust
 *  (internally-tagged theo `kind`, `rename_all = "snake_case"` → chuỗi
 *  `"plugin"`/`"service"`). Rust ghi phẳng: `{ kind, ...các trường riêng của
 *  kind đó }`, không lồng dưới một khoá "Plugin"/"Service" — union type dưới
 *  đây khớp đúng hình dạng phẳng đó. */
export type RemoteArtifactManifest =
  | ({ kind: 'plugin' } & RemotePluginManifest)
  | ({ kind: 'service' } & RemoteServiceManifest);

// ---------------------------------------------------------------------------
// Bản ghi đã cài — khớp `InstalledArtifactRecord` phía Rust (camelCase hoá)
// ---------------------------------------------------------------------------

export interface InstalledPluginRecord {
  manifest: RemotePluginManifest;
  sourceUrl: string;
  bundlePath: string;
  installedAt: number;
  /** Market (SettingsMarketplace) đã cài plugin này từ, nếu có — `undefined`
   *  cho một cài đặt qua URL dán tay hoặc từ trước khi market tồn tại. Đây là
   *  DANH TÍNH thật của bản ghi, không chỉ để hiển thị: xem
   *  `artifact_installer.rs`'s `InstalledPluginRecord::market_id`. */
  marketId?: string;
}

export interface InstalledServiceRecord {
  manifest: RemoteServiceManifest;
  sourceUrl: string;
  binPath: string;
  installedAt: number;
  /** Chỉ để hiển thị — xem giải thích ở `artifact_installer.rs`'s
   *  `InstalledServiceRecord::market_id` (không dùng để so khớp/dedupe, khác
   *  nhánh plugin). */
  marketId?: string;
}

/** Bản ghi tổng quát — `InstalledArtifactRecord` phía Rust cũng ghi phẳng
 *  (`{ kind, manifest, source_url, ... }`, không lồng), camelCase hoá ở TS
 *  qua `toCamelArtifactRecord` bên dưới. */
export type InstalledArtifactRecord =
  | ({ kind: 'plugin' } & InstalledPluginRecord)
  | ({ kind: 'service' } & InstalledServiceRecord);

/** Hình dạng thô (snake_case) nhận trực tiếp từ `invoke` — chỉ dùng nội bộ
 *  file này, không export: mọi nơi khác trong app chỉ nên thấy bản camelCase
 *  ở trên. */
// `market_id` phía Rust là `Option<String>` KHÔNG có `skip_serializing_if` —
// một record không market ghi ra JSON `"market_id": null`, không phải vắng
// hẳn trường này. `?: string | null` phản ánh đúng cả hai khả năng (thiếu
// hẳn trường, cho index.json rất cũ; hoặc `null`, cho bản ghi bình thường
// không market) — `toCamelArtifactRecord` bên dưới chuẩn hoá cả hai về
// `undefined` một lần duy nhất, để KHÔNG chỗ nào khác trong TS phải nhớ so
// `=== null` thay vì `=== undefined`.
type RawInstalledArtifactRecord =
  | { kind: 'plugin'; manifest: RemotePluginManifest; source_url: string; bundle_path: string; installed_at: number; market_id?: string | null }
  | { kind: 'service'; manifest: RemoteServiceManifest; source_url: string; bin_path: string; installed_at: number; market_id?: string | null };

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

function toCamelArtifactRecord(record: RawInstalledArtifactRecord): InstalledArtifactRecord {
  if (record.kind === 'plugin') {
    return {
      kind: 'plugin',
      manifest: record.manifest,
      sourceUrl: record.source_url,
      bundlePath: record.bundle_path,
      installedAt: record.installed_at,
      marketId: record.market_id ?? undefined,
    };
  }
  return {
    kind: 'service',
    manifest: record.manifest,
    sourceUrl: record.source_url,
    binPath: record.bin_path,
    installedAt: record.installed_at,
    marketId: record.market_id ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Tầng tổng quát — dùng bởi SettingsExtensionInstaller (cả hai kind)
// ---------------------------------------------------------------------------

/** Xem trước MỘT manifest (chưa biết trước kind) — UI tự rẽ nhánh hiển thị
 *  theo `manifest.kind`. Không tải bundle/binary, chỉ tải + kiểm hình dạng
 *  JSON manifest. */
export async function fetchArtifactManifestPreview(url: string): Promise<RemoteArtifactManifest> {
  return invokeCommand<RemoteArtifactManifest>('artifact_installer_fetch_manifest', { url });
}

/** Tải, kiểm checksum, lưu xuống đĩa — dùng chung cho cả hai kind (Rust tự
 *  rẽ nhánh theo `kind` khai trong manifest tại `url`). `marketId` đi kèm khi
 *  URL này tới từ một thẻ trong SettingsMarketplace (xem `pendingInstall.ts`)
 *  — `undefined` cho một URL dán tay/deep link, giữ nguyên hành vi "một id
 *  luôn thay bản cũ" như trước tính năng market. */
export async function installArtifact(url: string, marketId?: string): Promise<InstalledArtifactRecord> {
  const raw = await invokeCommand<RawInstalledArtifactRecord>('artifact_installer_install', {
    sourceUrl: url,
    marketId,
  });
  return toCamelArtifactRecord(raw);
}

export async function listInstalledArtifacts(): Promise<InstalledArtifactRecord[]> {
  if (!isTauri) return [];
  const raw = await invokeCommand<RawInstalledArtifactRecord[]>('artifact_installer_list');
  return raw.map(toCamelArtifactRecord);
}

/** `key` là id (plugin) hoặc bin (service) — cùng tham số `key` mà
 *  `artifact_installer_uninstall` phía Rust nhận, phân biệt kind bằng cách
 *  tìm trong index chứ không cần client khai trước. `marketId` PHẢI khớp
 *  đúng `record.marketId` của bản ghi muốn gỡ khi đó là một plugin (xem
 *  `recordKey`/`SettingsExtensionInstaller.tsx`) — thiếu nó khi bản ghi thật
 *  sự có market sẽ khiến Rust không tìm thấy mục nào để gỡ (lỗi rõ ràng,
 *  không gỡ nhầm bản của market khác). */
export async function uninstallArtifact(key: string, marketId?: string): Promise<void> {
  await invokeCommand<void>('artifact_installer_uninstall', { key, marketId });
}

/** Target triple của máy đang chạy app, TÍNH Ở RUST — hiển thị cho người
 *  dùng khi xem trước một manifest `kind=service`, để họ tự xác nhận có
 *  target khớp trước khi bấm cài (không đoán/tính lại ở phía webview). */
export async function currentTargetTriple(): Promise<string> {
  return invokeCommand<string>('artifact_installer_current_target_triple');
}

// ---------------------------------------------------------------------------
// Nhánh PLUGIN — hành vi/hình dạng giữ NGUYÊN từ Phase 1
// ---------------------------------------------------------------------------

/** Xem trước một manifest PLUGIN trước khi cài. Ném lỗi rõ ràng nếu URL này
 *  thật ra khai `kind=service` — gọi nhầm hàm theo kind là lỗi của lớp gọi,
 *  không phải thứ nên âm thầm trả kết quả sai hình dạng. */
export async function fetchManifestPreview(url: string): Promise<RemotePluginManifest> {
  const manifest = await fetchArtifactManifestPreview(url);
  if (manifest.kind !== 'plugin') {
    throw new Error(`URL này khai "kind": "${manifest.kind}", không phải "plugin".`);
  }
  const { kind: _kind, ...rest } = manifest;
  return rest;
}

/** Tải, kiểm checksum, lưu xuống đĩa. Ném lỗi (đã là tiếng Việt dễ đọc, từ
 *  phía Rust) khi mạng lỗi, JSON sai hình dạng, hoặc checksum không khớp. */
export async function installPlugin(url: string, marketId?: string): Promise<InstalledPluginRecord> {
  const record = await installArtifact(url, marketId);
  if (record.kind !== 'plugin') {
    throw new Error(`URL này cài một "${record.kind}", không phải plugin.`);
  }
  const { kind: _kind, ...rest } = record;
  return rest;
}

export async function listInstalledPlugins(): Promise<InstalledPluginRecord[]> {
  const records = await listInstalledArtifacts();
  return records
    .filter((r): r is Extract<InstalledArtifactRecord, { kind: 'plugin' }> => r.kind === 'plugin')
    .map(({ kind: _kind, ...rest }) => rest);
}

export async function uninstallPlugin(id: string, marketId?: string): Promise<void> {
  await uninstallArtifact(id, marketId);
}

/** So version đã cài với version manifest tại `sourceUrl` hiện đang khai. So
 *  sánh SỐ theo thứ tự semver (major.minor.patch, mỗi phần một số) — cùng
 *  quy mô tối giản với `satisfiesSdk` ở manifest.ts: đủ cho version tác giả
 *  tự tăng tuần tự, không cần kéo một thư viện semver đầy đủ cho ba con số. */
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

// ---------------------------------------------------------------------------
// Nhánh SERVICE — mirror nhánh plugin, bỏ blob/import() (không áp dụng cho
// một binary native chạy như tiến trình riêng, xem lời giải thích đầu file)
// ---------------------------------------------------------------------------

export async function installService(url: string, marketId?: string): Promise<InstalledServiceRecord> {
  const record = await installArtifact(url, marketId);
  if (record.kind !== 'service') {
    throw new Error(`URL này cài một "${record.kind}", không phải service.`);
  }
  const { kind: _kind, ...rest } = record;
  return rest;
}

export async function listInstalledServices(): Promise<InstalledServiceRecord[]> {
  const records = await listInstalledArtifacts();
  return records
    .filter((r): r is Extract<InstalledArtifactRecord, { kind: 'service' }> => r.kind === 'service')
    .map(({ kind: _kind, ...rest }) => rest);
}

export async function uninstallService(bin: string): Promise<void> {
  await uninstallArtifact(bin);
}

export async function checkForServiceUpdate(
  record: InstalledServiceRecord,
): Promise<{ available: boolean; remote?: RemoteServiceManifest }> {
  const manifest = await fetchArtifactManifestPreview(record.sourceUrl);
  if (manifest.kind !== 'service') {
    throw new Error(`Nguồn đã cài không còn khai "kind": "service" (hiện là "${manifest.kind}").`);
  }
  const { kind: _kind, ...remote } = manifest;
  return { available: compareVersions(remote.version, record.manifest.version) > 0, remote };
}

// ---------------------------------------------------------------------------
// Kiểm TẤT CẢ artifact đã cài — dùng bởi ExtensionUpdateContext để tự kiểm
// lúc app khởi động, không đợi người dùng bấm "Check for update" từng dòng.
// ---------------------------------------------------------------------------

export interface ArtifactUpdateAvailable {
  /** Cùng khoá `recordKey` dùng ở SettingsExtensionInstaller.tsx — id/bin
   *  cho một bản ghi không market, hoặc `<marketId>::<id>` cho một plugin cài
   *  qua market (xem `recordKey` ở đó cho lý do cần phân biệt). */
  key: string;
  record: InstalledArtifactRecord;
  remoteVersion: string;
}

/** Khoá định danh MỘT bản ghi trong danh sách "đã cài" — id/bin trần cho một
 *  bản ghi không gắn market (dán tay, hoặc từ trước tính năng market — giữ
 *  đúng khoá cũ để không phá vỡ gì đang hoạt động), `<marketId>::<id>` khi có
 *  market. Chỉ có Ý NGHĨA phân biệt cho kind=plugin (hai market có thể cùng
 *  id); service dùng `bin` trần dù có `marketId` hiển thị — market của một
 *  service chỉ mang tính thông tin (xem `InstalledServiceRecord::market_id`
 *  phía Rust), `bin` vẫn là một allowlist toàn cục duy nhất.
 *  DÙNG CHUNG bởi `checkAllForUpdates` (dưới) và
 *  `SettingsExtensionInstaller.tsx` — hai nơi phải tính RA CÙNG một khoá cho
 *  cùng một bản ghi, nếu không badge "có bản mới" sẽ không khớp được dòng nào
 *  trong danh sách.
 */
export function recordKey(record: InstalledArtifactRecord): string {
  if (record.kind === 'service') return record.manifest.bin;
  return record.marketId ? `${record.marketId}::${record.manifest.id}` : record.manifest.id;
}

/** Kiểm từng artifact đã cài, TUẦN TỰ (không Promise.all) — best-effort, một
 *  nguồn lỗi (mạng, URL đã đổi/chết) chỉ loại đúng mục đó khỏi kết quả, không
 *  chặn việc kiểm các mục còn lại hay ném lỗi ra ngoài (lời gọi này chạy nền
 *  lúc khởi động, không có UI nào chờ nó để hiện lỗi). Tuần tự thay vì song
 *  song có chủ đích, không chỉ để đơn giản: kiểm N mục cùng lúc là N request
 *  HTTP đồng thời lúc app vừa mở — không có gì cần gấp ở đây (kết quả chỉ
 *  hiện thành badge, không chặn UI nào), nên tránh dồn tải mạng không cần
 *  thiết. Đọc index thất bại (file hỏng, quyền đĩa…) cũng không được ném ra
 *  ngoài — cùng nguyên tắc `installedPluginManifests()` ở registry.ts: coi
 *  như "chưa cài gì" thay vì kéo cả app xuống. */
export async function checkAllForUpdates(): Promise<ArtifactUpdateAvailable[]> {
  let records: InstalledArtifactRecord[];
  try {
    records = await listInstalledArtifacts();
  } catch {
    return [];
  }
  const updates: ArtifactUpdateAvailable[] = [];
  for (const record of records) {
    try {
      if (record.kind === 'plugin') {
        const { available, remote } = await checkForUpdate(record);
        if (available && remote) updates.push({ key: recordKey(record), record, remoteVersion: remote.version });
      } else {
        const { available, remote } = await checkForServiceUpdate(record);
        if (available && remote) updates.push({ key: recordKey(record), record, remoteVersion: remote.version });
      }
    } catch {
      // Bỏ qua mục này, tiếp tục kiểm các mục còn lại.
    }
  }
  return updates;
}

/**
 * Nạp mã nguồn bundle đã cài (Rust kiểm lại checksum trước khi trả về — xem
 * `artifact_installer_read_bundle`) và chạy nó như một ES module qua URL
 * `blob:`. Đây là lý do CSP có thêm `blob:` trong `script-src`
 * (`src-tauri/tauri.conf.json`): `import()` một URL không phải 'self' bị CSP
 * chặn mặc định, và `blob:` là cách hẹp nhất để cho phép đúng trường hợp này
 * mà không mở toang `script-src` cho mọi nguồn. Chỉ áp dụng cho nhánh plugin
 * — service không có khái niệm "đọc lại để webview `import()`".
 *
 * Thu hồi URL blob ngay sau khi `import()` xong: một khi promise resolve,
 * thân module đã chạy và export đã nằm trong tay — không cần blob sống thêm.
 */
async function loadInstalled(id: string, marketId: string | undefined): Promise<React.ComponentType> {
  const source = await invokeCommand<string>('artifact_installer_read_bundle', { id, marketId });
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

  return records.map((record, i) => {
    // Danh tính registry (id storage/route/quyền/audit đều khoá theo đây, xem
    // registry.ts's `registerManifest`) PHẢI phân biệt được hai market khác
    // nhau cùng phát hành một plugin trùng `manifest.id` — không có allowlist
    // toàn cục nào ép id duy nhất giữa các market (khác `ALLOWED_SERVICES`
    // của service_host.rs, một danh sách cố định phía Rust). Không có
    // `marketId` (URL dán tay, hoặc bản cài từ trước khi market tồn tại) thì
    // giữ NGUYÊN id/route gốc — không đổi hành vi của người dùng đã cài từ
    // trước tính năng này.
    const registryId = record.marketId ? `${record.marketId}-${record.manifest.id}` : record.manifest.id;
    return {
      source: `installed:${registryId}@${record.manifest.version}`,
      manifest: {
        id: registryId,
        // Chỉ khác `id` khi có tiền tố market — bundle của plugin gọi
        // `usePluginSdkFor(record.manifest.id)` bằng đúng id GỐC này, không
        // biết gì về tiền tố market (xem PluginManifest.baseId).
        baseId: record.manifest.id,
        label: record.manifest.label,
        icon: ICONS_BY_NAME[record.manifest.icon] ?? Puzzle,
        description: record.manifest.description,
        keywords: record.manifest.keywords,
        route: record.marketId ? `/installed/${registryId}` : record.manifest.route,
        order: INSTALLED_ORDER_BASE + i,
        defaultEnabled: true,
        permissions: record.manifest.permissions,
        commands: record.manifest.commands,
        hosts: record.manifest.hosts,
        service: record.manifest.service,
        sdk: record.manifest.sdk,
        load: () => loadInstalled(record.manifest.id, record.marketId),
      },
    };
  });
}
