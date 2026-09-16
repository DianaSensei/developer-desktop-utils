// "Market" = một nguồn catalog.json liệt kê nhiều plugin cài-được-ngay, khác
// với ô "Cài tiện ích từ bên ngoài" (SettingsExtensionInstaller) vốn chỉ nhận
// ĐÚNG MỘT URL manifest mỗi lần dán. Một market không tự cài gì — nó chỉ hiển
// thị danh sách rồi giao URL manifest đã chọn cho đúng luồng
// preview/xác nhận/cài sẵn có (qua `pendingInstall`, xem
// `SettingsMarketplace.tsx`), cùng nguyên tắc "không có URL nào tự đủ để tin"
// đã áp dụng cho deep link.
//
// Có SẴN một market chính thức (catalog.json của developer-desktop-miniapp)
// và cho phép người dùng thêm market tuỳ ý (nội bộ công ty, một fork,…) — ai
// cũng generate được đúng format `MarketCatalog` này, kể cả không phải
// developer-desktop-miniapp.

import { isTauri } from '@/lib/platform';
import { storageGet, storageSet } from '@/lib/persistentStore';

export interface Market {
  id: string;
  label: string;
  catalogUrl: string;
  /** `true` cho market cài sẵn — không cho xoá, phân biệt với market người
   *  dùng tự thêm (`removeCustomMarket` chỉ tác động market không builtin). */
  builtin: boolean;
}

export interface MarketPlugin {
  id: string;
  label: string;
  description: string;
  version: string;
  keywords: string[];
  pluginManifestUrl: string;
  serviceManifestUrl?: string;
  /** Target triple mà sidecar (nếu có) hỗ trợ — thiếu/rỗng nghĩa là không rõ,
   *  không nên dùng để TỪ CHỐI cài, chỉ để cảnh báo. */
  targets?: string[];
}

const BUILTIN_MARKETS: Market[] = [
  {
    id: 'official',
    label: 'DevTool Official',
    catalogUrl: 'https://raw.githubusercontent.com/DianaSensei/developer-desktop-miniapp/main/catalog.json',
    builtin: true,
  },
];

const CUSTOM_MARKETS_KEY = 'devtool-markets-custom';
const SELECTED_MARKET_KEY = 'devtool-market-selected';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function loadCustomMarkets(): Market[] {
  const raw = storageGet(CUSTOM_MARKETS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is Market =>
        !!m &&
        typeof m === 'object' &&
        isNonEmptyString((m as Market).id) &&
        isNonEmptyString((m as Market).label) &&
        isNonEmptyString((m as Market).catalogUrl),
    ).map((m) => ({ ...m, builtin: false }));
  } catch {
    return [];
  }
}

function saveCustomMarkets(markets: Market[]): void {
  storageSet(CUSTOM_MARKETS_KEY, JSON.stringify(markets));
}

/** Builtin trước, rồi market tự thêm theo thứ tự đã thêm. */
export function listMarkets(): Market[] {
  return [...BUILTIN_MARKETS, ...loadCustomMarkets()];
}

// `Date.now()` một mình không đủ duy nhất khi hai lần thêm xảy ra trong cùng
// millisecond (đã bắt được ngay bằng test) — kèm một số ngẫu nhiên.
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function addCustomMarket(label: string, catalogUrl: string): Market {
  const market: Market = {
    id: `custom:${Date.now()}:${randomSuffix()}`,
    label: label.trim(),
    catalogUrl: catalogUrl.trim(),
    builtin: false,
  };
  saveCustomMarkets([...loadCustomMarkets(), market]);
  return market;
}

export function removeCustomMarket(id: string): void {
  saveCustomMarkets(loadCustomMarkets().filter((m) => m.id !== id));
}

/** Market đang chọn — tự rơi về market builtin đầu tiên nếu chưa chọn gì
 *  hoặc giá trị đã lưu không còn tồn tại (market tuỳ ý bị xoá ở máy khác, rồi
 *  đồng bộ store lại). */
export function getSelectedMarketId(): string {
  const saved = storageGet(SELECTED_MARKET_KEY);
  if (saved && listMarkets().some((m) => m.id === saved)) return saved;
  return BUILTIN_MARKETS[0].id;
}

export function setSelectedMarketId(id: string): void {
  storageSet(SELECTED_MARKET_KEY, id);
}

// Cùng cách né CORS/Origin đã dùng ở `src/lib/network.ts`: trong app desktop
// đi qua tauri-plugin-http (chạy từ phía Rust, không có Origin của webview),
// bản web dùng `fetch` chuẩn. Không cần audit/permission ở đây — đây là mã
// SHELL (Settings), không phải lời gọi network của một plugin.
async function marketFetch(url: string): Promise<Response> {
  if (isTauri) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url);
  }
  return fetch(url);
}

function toMarketPlugin(raw: unknown): MarketPlugin | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(r.id) ||
    !isNonEmptyString(r.label) ||
    !isNonEmptyString(r.description) ||
    !isNonEmptyString(r.version) ||
    !isNonEmptyString(r.pluginManifestUrl)
  ) {
    return null;
  }
  return {
    id: r.id,
    label: r.label,
    description: r.description,
    version: r.version,
    keywords: Array.isArray(r.keywords) ? r.keywords.filter(isNonEmptyString) : [],
    pluginManifestUrl: r.pluginManifestUrl,
    serviceManifestUrl: isNonEmptyString(r.serviceManifestUrl) ? r.serviceManifestUrl : undefined,
    targets: Array.isArray(r.targets) ? r.targets.filter(isNonEmptyString) : undefined,
  };
}

/** Tải + kiểm hình dạng một catalog.json. Ném lỗi rõ ràng (thông điệp tiếng
 *  Anh — UI tự bọc qua i18n) khi HTTP lỗi hoặc JSON sai hình dạng; một mục
 *  đơn lẻ sai hình dạng trong mảng `plugins` chỉ bị BỎ QUA (dữ liệu bên ngoài,
 *  không đáng để hỏng cả danh sách vì một mục), không ném lỗi cho cả catalog.
 */
export async function fetchMarketCatalog(url: string): Promise<MarketPlugin[]> {
  const res = await marketFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: unknown = await res.json();
  const plugins = data && typeof data === 'object' ? (data as { plugins?: unknown }).plugins : undefined;
  if (!Array.isArray(plugins)) {
    throw new Error('Catalog is missing a "plugins" array.');
  }
  return plugins.map(toMarketPlugin).filter((p): p is MarketPlugin => p !== null);
}
