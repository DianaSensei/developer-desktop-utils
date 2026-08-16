// Per-method color tokens shared across sidebar, address bar, tabs, and history.
// Three scales:
//   methodColor      — text color only (labels, dropdowns)
//   methodBg         — subtle background tint for the method selector area
//   methodBadgeStyle — full pill: bg + text, for sidebar tree badges
//
// Màu lấy từ token --method-* (xem src/design-system/tokens.css), không phải
// bảng màu Tailwind. Đó là hệ "quy ước ngành" cùng loại với màu cú pháp SQL:
// xanh-GET / cam-POST / đỏ-DELETE là thứ người dùng Postman đã thuộc, đổi đi
// là bắt họ học lại. Nhờ đi qua token, cả ba thang tự đúng ở light/dark trong
// MỘT chỗ thay vì 21 cặp `dark:` viết tay như trước.

import type { HttpMethod } from './types';

const TEXT: Record<HttpMethod, string> = {
  GET:     'text-[var(--method-get)]',
  POST:    'text-[var(--method-post)]',
  PUT:     'text-[var(--method-put)]',
  PATCH:   'text-[var(--method-patch)]',
  DELETE:  'text-[var(--method-delete)]',
  HEAD:    'text-fg-mute',
  OPTIONS: 'text-fg-mute',
};

// Subtle tint behind the method selector in the address bar — no text color.
const BG: Record<HttpMethod, string> = {
  GET:     'bg-[hsl(var(--method-get-c)/0.10)]',
  POST:    'bg-[hsl(var(--method-post-c)/0.10)]',
  PUT:     'bg-[hsl(var(--method-put-c)/0.10)]',
  PATCH:   'bg-[hsl(var(--method-patch-c)/0.10)]',
  DELETE:  'bg-[hsl(var(--method-delete-c)/0.10)]',
  HEAD:    'bg-transparent',
  OPTIONS: 'bg-transparent',
};

// Full pill badge for the sidebar tree — bg + text color in one token.
const BADGE: Record<HttpMethod, string> = {
  GET:     'bg-[hsl(var(--method-get-c)/0.16)]    text-[var(--method-get)]',
  POST:    'bg-[hsl(var(--method-post-c)/0.16)]   text-[var(--method-post)]',
  PUT:     'bg-[hsl(var(--method-put-c)/0.16)]    text-[var(--method-put)]',
  PATCH:   'bg-[hsl(var(--method-patch-c)/0.16)]  text-[var(--method-patch)]',
  DELETE:  'bg-[hsl(var(--method-delete-c)/0.16)] text-[var(--method-delete)]',
  HEAD:    'bg-muted/60 text-fg-mute',
  OPTIONS: 'bg-muted/60 text-fg-mute',
};

export const methodColor      = (m: HttpMethod): string => TEXT[m]  ?? 'text-fg';
export const methodBg         = (m: HttpMethod): string => BG[m]   ?? 'bg-transparent';
export const methodBadgeStyle = (m: HttpMethod): string => BADGE[m] ?? 'bg-muted/60 text-fg';
