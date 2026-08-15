/**
 * Đoán người dùng sắp làm gì với nội dung đang có trên clipboard.
 *
 * ⌘K đọc clipboard và, nếu đoán được, xếp một tool lên đầu danh sách kèm LÝ DO
 * — không chỉ đoán âm thầm. "Trông giống JWT — ba đoạn base64url ngăn bằng dấu
 * chấm" cho người dùng cơ sở để tin hoặc bỏ qua gợi ý, thay vì một phép màu khó
 * hiểu khi tool bỗng dưng nhảy lên đầu.
 *
 * Hàm ở đây THUẦN — không đọc clipboard, không đụng React. `readTextFromClipboard`
 * trong `lib/clipboard.ts` mới là nơi làm việc đó; tách ra để logic đoán test
 * được mà không cần giả lập clipboard hay DOM.
 *
 * Thứ tự kiểm tra đi từ ĐẶC THÙ đến CHUNG CHUNG — bắt buộc, vì JSON hợp lệ và
 * URL hợp lệ đều có thể vô tình khớp một mẫu chung chung hơn ở phía dưới.
 */

import type { TranslationKey } from '@/lib/i18n';

export type ClipboardIntentKind =
  | 'jwt'
  | 'json'
  | 'uuid'
  | 'cron'
  | 'timestamp'
  | 'url'
  | 'hex'
  | 'base64';

/** Chỉ những khoá `clipboard.reason.*` — ràng buộc kiểu để không lệch với i18n.ts. */
export type ClipboardReasonKey = Extract<TranslationKey, `clipboard.reason.${string}`>;

export interface ClipboardIntent {
  kind: ClipboardIntentKind;
  /** id trong TOOL_DEFS — tool để mở. */
  toolId: string;
  /** Khoá dịch trong lib/i18n.ts — không phải chuỗi hiển thị. */
  reasonKey: ClipboardReasonKey;
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Giải base64url không cần đệm — dùng cho phần header của JWT. */
function decodeBase64Url(segment: string): string | null {
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    return atob(padded + pad);
  } catch {
    return null;
  }
}

function isJwt(text: string): boolean {
  const parts = text.split('.');
  if (parts.length !== 3) return false;
  if (!parts.every((p) => p.length > 0 && B64URL.test(p))) return false;
  // Header phải giải mã ra JSON có khoá "alg" — đó là dấu hiệu chắc chắn nhất,
  // vì ba đoạn base64url ngăn bằng chấm không hiếm gặp ngoài JWT.
  const header = decodeBase64Url(parts[0]);
  if (!header) return false;
  try {
    const parsed = JSON.parse(header);
    return typeof parsed === 'object' && parsed !== null && 'alg' in parsed;
  } catch {
    return false;
  }
}

function isJson(text: string): boolean {
  const t = text.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cron 5 hoặc 6 trường, mỗi trường chỉ gồm ký tự cú pháp cron. Yêu cầu ít nhất
 * một trường có `*`, `/` hoặc `,` — nếu không thì "1 2 3 4 5" (năm số cách nhau
 * bằng dấu cách) cũng khớp, và đó gần như chắc chắn không phải cron thật.
 */
function isCron(text: string): boolean {
  const fields = text.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) return false;
  if (!fields.every((f) => /^[\d*/,-]+$/.test(f))) return false;
  return fields.some((f) => /[*/,]/.test(f));
}

/** 10 chữ số (giây) hoặc 13 chữ số (mili giây), nằm trong khoảng năm 2001–2100. */
function isTimestamp(text: string): boolean {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return false;
  if (t.length !== 10 && t.length !== 13) return false;
  const ms = t.length === 10 ? Number(t) * 1000 : Number(t);
  const year = new Date(ms).getUTCFullYear();
  return year >= 2001 && year <= 2100;
}

const URL_RE = /^https?:\/\/\S+$/i;

/** Cần ít nhất một chữ a–f để tách khỏi chuỗi toàn số (đã bắt ở isTimestamp). */
function isHex(text: string): boolean {
  const t = text.trim().replace(/^0x/i, '');
  if (t.length < 6 || t.length % 2 !== 0) return false;
  return /^[0-9a-f]+$/i.test(t) && /[a-f]/i.test(t);
}

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;

/** Cần dấu `+`, `/` hoặc `=`, hoặc cả chữ hoa lẫn thường — để tách khỏi hex thuần. */
function isBase64(text: string): boolean {
  const t = text.trim();
  if (t.length < 8 || t.length % 4 !== 0) return false;
  if (!BASE64_RE.test(t)) return false;
  return /[+/=]/.test(t) || (/[A-Z]/.test(t) && /[a-z]/.test(t));
}

export function detectClipboardIntent(rawText: string | null | undefined): ClipboardIntent | null {
  if (!rawText) return null;
  const text = rawText.trim();
  if (!text || text.length > 8000) return null; // clipboard quá dài không phải thứ để đoán

  if (isJwt(text)) return { kind: 'jwt', toolId: 'jwt', reasonKey: 'clipboard.reason.jwt' };
  if (isJson(text)) return { kind: 'json', toolId: 'json', reasonKey: 'clipboard.reason.json' };
  if (UUID_RE.test(text)) return { kind: 'uuid', toolId: 'generator', reasonKey: 'clipboard.reason.uuid' };
  if (isCron(text)) return { kind: 'cron', toolId: 'cron-generator', reasonKey: 'clipboard.reason.cron' };
  if (isTimestamp(text)) return { kind: 'timestamp', toolId: 'unix-time', reasonKey: 'clipboard.reason.timestamp' };
  // URL gợi ý QR Code chứ không phải trình duyệt — đây là app tiện ích ngoại
  // tuyến, việc hợp lý nhất để làm với một URL vừa copy là biến nó thành QR.
  if (URL_RE.test(text)) return { kind: 'url', toolId: 'qrcode', reasonKey: 'clipboard.reason.url' };
  if (isHex(text)) return { kind: 'hex', toolId: 'base64', reasonKey: 'clipboard.reason.hex' };
  if (isBase64(text)) return { kind: 'base64', toolId: 'base64', reasonKey: 'clipboard.reason.base64' };

  return null;
}
