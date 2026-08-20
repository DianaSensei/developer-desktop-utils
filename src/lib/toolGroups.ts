import {
  Binary,
  Braces,
  CaseSensitive,
  Clock,
  Dices,
  Radio,
  FileCode2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { TOOL_DEFS, TOOL_DEF_MAP, DEFAULT_TOOL_ORDER, type ToolDef } from '@/lib/toolDefs';

/**
 * Gộp 24 tool thành 15 mục sidebar.
 *
 * Vì sao: danh sách phẳng 24 mục buộc người dùng phải quét cả danh sách mỗi lần,
 * và nó che mất việc nhiều tool là biến thể của cùng một việc (đếm chữ và biến
 * đổi chữ đều là "làm gì đó với text").
 *
 * ── Hai quyết định định hình cả file này ──────────────────────────────────
 *
 * 1. NHÓM MỘT TOOL KHÔNG PHẢI LÀ NHÓM. Tám tool lớn (API Client, Mock Server,
 *    Time Tracker…) đứng riêng và render y như trước — không tiêu đề nhóm, không
 *    tab con, không mũi tên mở rộng. Bọc chúng vào khung nhóm chỉ thêm một lớp
 *    chrome cho zero lợi ích.
 *
 * 2. KHI TÌM KIẾM THÌ HIỆN TOOL, KHÔNG HIỆN NHÓM. Gõ "cron" phải ra thẳng Cron,
 *    chứ không phải nhóm "Thời gian" rồi bắt người dùng đoán cron nằm trong đó.
 *    Nhóm chỉ là cách sắp xếp lúc KHÔNG tìm kiếm.
 *
 * Việc gộp ở đây thuần tuý là ĐIỀU HƯỚNG — không tool nào bị xoá, không route
 * nào đổi. Việc gộp component thật (nếu có) là chuyện của giai đoạn sau.
 */

export interface ToolGroup {
  id: string;
  /** Nhãn hiện ở sidebar. Ngắn hơn nhãn tool vì nó phải bao được nhiều tool. */
  label: string;
  icon: LucideIcon;
  /** Theo thứ tự tab con. Phần tử đầu là đích khi bấm vào nhóm. */
  toolIds: string[];
}

/** Chỉ các nhóm THẬT (≥2 tool). Tool không có tên ở đây thì đứng riêng. */
export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'g-text',
    label: 'Text',
    icon: CaseSensitive,
    toolIds: ['text-transform', 'text-counter', 'deduplicate'],
  },
  {
    id: 'g-json',
    label: 'JSON & Data',
    icon: Braces,
    toolIds: ['json', 'data-converter'],
  },
  {
    id: 'g-format',
    label: 'Format',
    icon: FileCode2,
    toolIds: ['sql-formatter', 'markdown'],
  },
  {
    id: 'g-encode',
    label: 'Encode & Hash',
    icon: Binary,
    toolIds: ['base64', 'jwt'],
  },
  {
    id: 'g-time',
    label: 'Time',
    icon: Clock,
    toolIds: ['unix-time', 'cron-generator'],
  },
  {
    id: 'g-generate',
    label: 'Generate',
    icon: Dices,
    toolIds: ['generator', 'qrcode', 'lucky-wheel'],
  },
  {
    id: 'g-brokers',
    label: 'Brokers',
    icon: Radio,
    toolIds: ['kafka-explorer', 'rabbit-client', 'redis-client'],
  },
];

/** id tool → nhóm chứa nó. Tool đứng riêng không có mặt ở đây. */
export const GROUP_OF_TOOL = new Map<string, ToolGroup>(
  TOOL_GROUPS.flatMap((g) => g.toolIds.map((id) => [id, g] as const)),
);

/**
 * Mục sidebar: hoặc một tool đứng riêng, hoặc một nhóm nhiều tool.
 * `tools` luôn có ít nhất một phần tử và chỉ chứa tool đang BẬT.
 */
export interface NavEntry {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Nhóm thật (≥2 tool đang bật) hay tool đứng riêng. */
  isGroup: boolean;
  tools: ToolDef[];
}

export interface BuildNavOptions {
  /** id tool đang bật. Tool tắt không xuất hiện ở đâu cả. */
  enabledIds: Set<string>;
  /** Thứ tự người dùng đã kéo-thả; rỗng thì dùng DEFAULT_TOOL_ORDER. */
  order?: string[];
  /** id tool được đánh dấu yêu thích, theo thứ tự đánh dấu. */
  favorites?: string[];
}

/**
 * Dựng danh sách mục sidebar khi KHÔNG tìm kiếm.
 *
 * Quy tắc thứ tự, theo đúng thứ tự áp dụng:
 *
 *   1. Nhóm lấy vị trí của THÀNH VIÊN ĐỨNG SỚM NHẤT trong thứ tự người dùng.
 *      Nhờ vậy kéo-thả cũ vẫn có ý nghĩa mà không cần di trú dữ liệu.
 *   2. Yêu thích nổi lên đầu. Một nhóm là "yêu thích" nếu BẤT KỲ thành viên nào
 *      được yêu thích — cũng để khỏi phải di trú: dữ liệu yêu thích vẫn là id
 *      tool như cũ.
 *   3. Nhóm chỉ còn một tool đang bật sẽ TỰ THOÁI thành mục đơn, mang nhãn của
 *      chính tool đó. Hiện "JSON & Data" mà bên trong chỉ có JSON là nói dối.
 */
export function buildNavEntries({
  enabledIds,
  order = [],
  favorites = [],
}: BuildNavOptions): NavEntry[] {
  const effectiveOrder = order.length ? order : DEFAULT_TOOL_ORDER;
  const rank = new Map(effectiveOrder.map((id, i) => [id, i]));
  // Tool chưa có trong thứ tự (mới thêm sau khi người dùng đã sắp xếp) xuống cuối.
  const rankOf = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;

  const seen = new Set<string>();
  const entries: Array<NavEntry & { sort: number; fav: number }> = [];

  for (const def of TOOL_DEFS) {
    if (!enabledIds.has(def.id) || seen.has(def.id)) continue;

    const group = GROUP_OF_TOOL.get(def.id);
    const members = group
      ? group.toolIds.filter((id) => enabledIds.has(id))
      : [def.id];

    for (const id of members) seen.add(id);

    const tools = members
      .map((id) => TOOL_DEF_MAP.get(id))
      .filter((t): t is ToolDef => Boolean(t));
    if (!tools.length) continue;

    // Nhóm còn đúng một tool thì thoái thành mục đơn — xem quy tắc 3.
    const isGroup = Boolean(group) && tools.length > 1;

    const favIdx = members
      .map((id) => favorites.indexOf(id))
      .filter((i) => i >= 0);

    entries.push({
      key: isGroup ? group!.id : tools[0].id,
      label: isGroup ? group!.label : tools[0].label,
      icon: isGroup ? group!.icon : tools[0].icon,
      isGroup,
      tools,
      sort: Math.min(...members.map(rankOf)),
      fav: favIdx.length ? Math.min(...favIdx) : -1,
    });
  }

  entries.sort((a, b) => {
    const aFav = a.fav >= 0;
    const bFav = b.fav >= 0;
    if (aFav !== bFav) return aFav ? -1 : 1;
    if (aFav && bFav) return a.fav - b.fav;
    return a.sort - b.sort;
  });

  return entries.map(({ sort: _sort, fav: _fav, ...entry }) => entry);
}

/** Số mục yêu thích ở đầu danh sách — để đặt vạch ngăn "Yêu thích / Tất cả". */
export function countFavoriteEntries(entries: NavEntry[], favorites: string[]): number {
  return entries.filter((e) => e.tools.some((t) => favorites.includes(t.id))).length;
}

/**
 * Sắp lại một danh sách id tool PHẲNG sao cho các tool cùng nhóm luôn đứng
 * liền nhau, tại vị trí của thành viên đứng sớm nhất — cùng quy tắc 1 của
 * `buildNavEntries`, tách riêng vì Settings cần áp nó lên danh sách Bật/Tắt
 * (có cả tool đang tắt, không có khái niệm "yêu thích nổi lên đầu" như
 * sidebar) chứ không dựng ra `NavEntry`.
 */
export function clusterToolOrder(ids: string[]): string[] {
  const present = new Set(ids);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const group = GROUP_OF_TOOL.get(id);
    const members = group ? group.toolIds.filter((mid) => present.has(mid)) : [id];
    for (const mid of members) {
      if (seen.has(mid)) continue;
      seen.add(mid);
      result.push(mid);
    }
  }
  return result;
}
