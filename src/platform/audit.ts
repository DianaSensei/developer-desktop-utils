import type { PluginPermission } from './types';

/**
 * Nhật ký kiểm toán (audit) của Platform: mọi lời gọi plugin → SDK đều đi qua
 * đây, kể cả lời gọi BỊ TỪ CHỐI.
 *
 * Vì sao ghi cả lời gọi bị từ chối: một plugin gọi kênh nó chưa khai quyền là
 * lỗi lập trình lặng lẽ — hàm ném lỗi, plugin bắt lại, người dùng chỉ thấy tính
 * năng "không chạy" mà không biết vì sao. Có bản ghi thì Settings (và test) chỉ
 * ra được ngay.
 *
 * Bộ đệm vòng, giữ trong RAM: nhật ký này để soi hành vi phiên hiện tại, không
 * phải bằng chứng pháp lý — ghi xuống đĩa sẽ kéo theo chuyện xoay vòng file,
 * dung lượng và cả rủi ro rò dữ liệu nhạy cảm (URL, khoá) mà không đổi lại được
 * gì ở phạm vi hiện tại.
 */

export type AuditChannel =
  | 'storage'
  | 'secrets'
  | 'clipboard'
  | 'http'
  | 'native'
  | 'service'
  | 'lifecycle';

export interface AuditEntry {
  ts: number;
  pluginId: string;
  channel: AuditChannel;
  /** Hành vi cụ thể: 'get' | 'set' | 'fetch' | tên lệnh Tauri… */
  action: string;
  allowed: boolean;
  /** Quyền bị thiếu, khi `allowed` là false vì chưa khai quyền. */
  missingPermission?: PluginPermission;
  /** Chi tiết ngắn, đã lược bỏ giá trị: khoá storage, host của URL… */
  detail?: string;
}

const MAX_ENTRIES = 500;

const entries: AuditEntry[] = [];
const listeners = new Set<(entry: AuditEntry) => void>();

export function record(entry: Omit<AuditEntry, 'ts'>): void {
  const full: AuditEntry = { ...entry, ts: Date.now() };
  entries.push(full);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  for (const fn of listeners) {
    try {
      fn(full);
    } catch {
      // Một listener hỏng không được phép làm gãy lời gọi SDK đang diễn ra.
    }
  }
}

/** Bản ghi mới nhất trước, tối đa `limit`. */
export function recent(limit = MAX_ENTRIES): AuditEntry[] {
  return entries.slice(-limit).reverse();
}

/** Lọc theo plugin — dùng cho panel "plugin này đã làm gì" trong Settings. */
export function recentFor(pluginId: string, limit = MAX_ENTRIES): AuditEntry[] {
  return entries.filter((e) => e.pluginId === pluginId).slice(-limit).reverse();
}

export function subscribe(fn: (entry: AuditEntry) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Chỉ dùng trong test — xoá sạch bộ đệm giữa các ca. */
export function clear(): void {
  entries.length = 0;
}

/**
 * Chỉ lấy phần định danh của URL (scheme + host + port) cho nhật ký. Query và
 * path bị bỏ vì đó là nơi token/khoá API hay nằm, mà host đã đủ trả lời câu hỏi
 * "plugin này gọi ra đâu".
 *
 * Cố ý KHÔNG truyền base URL: phân giải một đường dẫn tương đối theo origin của
 * webview sẽ ghi vào nhật ký một host mà plugin chưa từng gọi tới — sai lệch
 * đúng ở nơi nhật ký cần chính xác nhất.
 */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '<url không hợp lệ>';
  }
}
