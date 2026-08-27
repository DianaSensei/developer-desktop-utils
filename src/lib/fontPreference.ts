import { storageGet, storageSet } from '@/lib/persistentStore';

/**
 * Mặt chữ UI chung (`--sans`) — bốn preset khai báo trong `design/tokens.css`
 * dưới dạng `[data-font="…"]`. Áp dụng bằng cách gán
 * `document.documentElement.dataset.font`; mọi chỗ dùng `font-sans`/`var(--sans)`
 * tự đổi theo qua CSS, không cần JS tính lại từng nơi.
 *
 * Chỉ đổi mặt chữ UI, không đổi `--mono` (đọc mã/số liệu cần một chuẩn cố
 * định, không phải gu đọc chung) — xem comment trong tokens.css.
 *
 * Danh sách này PHẢI khớp đúng các khối `[data-font="…"]` trong tokens.css —
 * `fontPreference.test.ts` đối chiếu cả hai để không lệch nhau.
 */
export type FontPreference = 'default' | 'system' | 'serif' | 'classic';

export const FONT_PREFERENCES: FontPreference[] = ['default', 'system', 'serif', 'classic'];

const FONT_KEY = 'devtool-font';
const DEFAULT_FONT: FontPreference = 'default';

function isFontPreference(value: string | null): value is FontPreference {
  return value !== null && (FONT_PREFERENCES as string[]).includes(value);
}

export function getFontPreference(): FontPreference {
  const saved = storageGet(FONT_KEY);
  return isFontPreference(saved) ? saved : DEFAULT_FONT;
}

export function setFontPreference(pref: FontPreference): void {
  storageSet(FONT_KEY, pref);
}

/** Ghi lựa chọn lên `<html data-font>` — nguồn CSS mà `--sans` đọc. */
export function applyFontToDocument(pref: FontPreference): void {
  document.documentElement.dataset.font = pref;
}
