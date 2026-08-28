import { storageGet, storageSet } from '@/lib/persistentStore';

/**
 * Mặt chữ đơn cách cho vùng code/số liệu (`--mono`) — tách riêng khỏi
 * `FontPreference` (`--sans`, xem `fontPreference.ts`) vì đây là lựa chọn có
 * chủ đích cho việc ĐỌC MÃ (ligature `=>`/`!=`/`>=`…, độ rộng ký tự đều),
 * người dùng có gu khác nhau về ligature — không còn là "một chuẩn cố định,
 * không phải gu đọc chung" như comment cũ ở tokens.css.
 *
 * Cả hai lựa chọn đều là font THẬT tự host (bundle sẵn, không phải stack hệ
 * thống như bốn preset --sans) nên hiện giống hệt nhau trên mọi nền — xem
 * import trong main.tsx.
 *
 * Danh sách này PHẢI khớp đúng các khối `[data-mono-font="…"]` trong
 * `design/tokens.css` — `monoFontPreference.test.ts` đối chiếu cả hai để
 * không lệch nhau, cùng rủi ro như FONT_PREFERENCES/ACCENT_TONES.
 */
export type MonoFontPreference = 'ibm-plex-mono' | 'fira-code';

export const MONO_FONT_PREFERENCES: MonoFontPreference[] = ['ibm-plex-mono', 'fira-code'];

const MONO_FONT_KEY = 'devtool-mono-font';
const DEFAULT_MONO_FONT: MonoFontPreference = 'ibm-plex-mono';

function isMonoFontPreference(value: string | null): value is MonoFontPreference {
  return value !== null && (MONO_FONT_PREFERENCES as string[]).includes(value);
}

export function getMonoFontPreference(): MonoFontPreference {
  const saved = storageGet(MONO_FONT_KEY);
  return isMonoFontPreference(saved) ? saved : DEFAULT_MONO_FONT;
}

export function setMonoFontPreference(pref: MonoFontPreference): void {
  storageSet(MONO_FONT_KEY, pref);
}

/** Ghi lựa chọn lên `<html data-mono-font>` — nguồn CSS mà `--mono` đọc. */
export function applyMonoFontToDocument(pref: MonoFontPreference): void {
  document.documentElement.dataset.monoFont = pref;
}
