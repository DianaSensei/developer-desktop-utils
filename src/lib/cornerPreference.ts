import { storageGet, storageSet } from '@/lib/persistentStore';

/**
 * Kiểu bo góc — ba preset khai báo trong `design/tokens.css` dưới dạng
 * `[data-corner="…"]`. Áp dụng bằng cách gán
 * `document.documentElement.dataset.corner`; cả thang `--r-default`…`--r-xl`
 * (và mọi `rounded-*` đọc từ thang đó) tự đổi theo qua CSS, không cần JS.
 *
 * Cùng cơ chế với `accentPreference` — và cùng điều kiện: mọi bán kính trong
 * app phải đọc từ token. Một chỗ viết cứng `rounded-[12px]` là một chỗ ở lại
 * khi đổi preset; `guard.test.ts` (rule `hardcodedRadius`) canh việc đó.
 *
 * Danh sách này PHẢI khớp đúng các khối `[data-corner="…"]` trong tokens.css —
 * `cornerPreference.test.ts` đối chiếu cả hai để không lệch nhau.
 */
export type CornerStyle = 'sharp' | 'default' | 'round';

export const CORNER_STYLES: CornerStyle[] = ['sharp', 'default', 'round'];

const CORNER_KEY = 'devtool-corner';
const DEFAULT_CORNER: CornerStyle = 'default';

function isCornerStyle(value: string | null): value is CornerStyle {
  return value !== null && (CORNER_STYLES as string[]).includes(value);
}

export function getCornerPreference(): CornerStyle {
  const saved = storageGet(CORNER_KEY);
  return isCornerStyle(saved) ? saved : DEFAULT_CORNER;
}

export function setCornerPreference(style: CornerStyle): void {
  storageSet(CORNER_KEY, style);
}

/** Ghi lựa chọn lên `<html data-corner>` — nguồn CSS mà thang `--r-*` đọc. */
export function applyCornerToDocument(style: CornerStyle): void {
  document.documentElement.dataset.corner = style;
}
