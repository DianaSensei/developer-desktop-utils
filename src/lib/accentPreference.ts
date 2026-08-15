import { storageGet, storageSet } from '@/lib/persistentStore';

/**
 * Tone chủ đạo — sáu preset khai báo trong `design/tokens.css` dưới dạng
 * `[data-accent="…"]`. Áp dụng bằng cách gán `document.documentElement.dataset.accent`;
 * biến `--a-h/--a-s/--a-l` (và mọi thứ dẫn xuất từ chúng) tự đổi theo qua CSS,
 * không cần JS tính toán màu.
 *
 * Danh sách này PHẢI khớp đúng các khối `[data-accent="…"]` trong tokens.css —
 * `accentPreference.test.ts` đối chiếu cả hai để không lệch nhau.
 */
export type AccentTone = 'azure' | 'petrol' | 'moss' | 'iris' | 'oxblood' | 'amber';

export const ACCENT_TONES: AccentTone[] = ['azure', 'petrol', 'moss', 'iris', 'oxblood', 'amber'];

const ACCENT_KEY = 'devtool-accent';
const DEFAULT_ACCENT: AccentTone = 'azure';

function isAccentTone(value: string | null): value is AccentTone {
  return value !== null && (ACCENT_TONES as string[]).includes(value);
}

export function getAccentPreference(): AccentTone {
  const saved = storageGet(ACCENT_KEY);
  return isAccentTone(saved) ? saved : DEFAULT_ACCENT;
}

export function setAccentPreference(tone: AccentTone): void {
  storageSet(ACCENT_KEY, tone);
}

/** Ghi tone lên `<html data-accent>` — nguồn CSS mà mọi màu accent trong app đọc. */
export function applyAccentToDocument(tone: AccentTone): void {
  document.documentElement.dataset.accent = tone;
}
