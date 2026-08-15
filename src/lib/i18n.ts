/**
 * Hạ tầng song ngữ — VI/EN, chuyển được lúc chạy.
 *
 * G3 chỉ dịch CHUỖI CỦA SHELL (sidebar, ⌘K, Settings) — 24 tool vẫn tiếng Anh,
 * dịch dần trong chính đợt di cư của từng tool ở G4. Gộp hết vào một PR khổng
 * lồ dịch toàn app sẽ không ai review nổi.
 *
 * Từ điển PHẲNG, không lồng namespace: `{ vi, en }` theo từng khoá, để:
 *   - thiếu bản dịch lộ ra ngay ở kiểu TypeScript (cả hai field bắt buộc)
 *   - test đối chiếu được: mọi khoá dùng trong code phải có mặt ở đây, và
 *     ngược lại (xem i18n.test.ts)
 *
 * Nội suy tham số kiểu `{{name}}`, đủ dùng cho các câu ngắn của shell — không
 * cần các dạng số nhiều/ngữ pháp phức tạp mà một thư viện i18n đầy đủ mới cần.
 */

export type Locale = 'vi' | 'en';

export const LOCALES: Locale[] = ['vi', 'en'];

type Entry = Record<Locale, string>;

export const DICTIONARY = {
  // ── Sidebar ────────────────────────────────────────────────────────────
  'shell.search.placeholder': { vi: 'Tìm tool…', en: 'Search tools…' },
  'shell.search.noMatch': { vi: 'Không có tool nào khớp "{{query}}"', en: 'No tools match "{{query}}"' },
  'shell.section.favorites': { vi: 'Yêu thích', en: 'Favorites' },
  'shell.section.allTools': { vi: 'Tất cả', en: 'All tools' },
  'shell.section.disabled': { vi: 'Đã tắt', en: 'Disabled' },

  // ── ⌘K command palette ────────────────────────────────────────────────
  'palette.placeholder': { vi: 'Gõ tên tool hoặc lệnh…', en: 'Type a tool or command…' },
  'palette.empty': { vi: 'Không tìm thấy "{{query}}"', en: 'Nothing found for "{{query}}"' },
  'palette.clipboardHint': { vi: 'Từ clipboard', en: 'From clipboard' },
  'palette.disabledHint': { vi: 'Đang tắt — bấm để bật', en: 'Off — pick to enable' },
  'palette.footer.navigate': { vi: 'di chuyển', en: 'navigate' },
  'palette.footer.select': { vi: 'chọn', en: 'select' },
  'palette.footer.close': { vi: 'đóng', en: 'close' },

  // ── Lý do đoán clipboard — dùng bởi lib/clipboardIntent.ts ─────────────
  'clipboard.reason.jwt': {
    vi: 'Trông giống JWT — ba đoạn base64url ngăn bằng dấu chấm',
    en: 'Looks like a JWT — three base64url segments separated by dots',
  },
  'clipboard.reason.json': {
    vi: 'Trông giống JSON hợp lệ',
    en: 'Looks like valid JSON',
  },
  'clipboard.reason.uuid': {
    vi: 'Trông giống UUID',
    en: 'Looks like a UUID',
  },
  'clipboard.reason.cron': {
    vi: 'Trông giống biểu thức cron',
    en: 'Looks like a cron expression',
  },
  'clipboard.reason.timestamp': {
    vi: 'Trông giống dấu thời gian Unix',
    en: 'Looks like a Unix timestamp',
  },
  'clipboard.reason.url': {
    vi: 'Là một URL — tạo mã QR từ đó?',
    en: 'Is a URL — turn it into a QR code?',
  },
  'clipboard.reason.hex': {
    vi: 'Trông giống chuỗi hex',
    en: 'Looks like a hex string',
  },
  'clipboard.reason.base64': {
    vi: 'Trông giống chuỗi base64',
    en: 'Looks like base64',
  },

  // ── Settings ─────────────────────────────────────────────────────────
  'settings.language.label': { vi: 'Ngôn ngữ', en: 'Language' },
  'settings.language.description': {
    vi: 'Ngôn ngữ hiển thị của khung ứng dụng. Từng tool sẽ dịch dần.',
    en: 'Display language for the app shell. Individual tools translate over time.',
  },
  'settings.tone.label': { vi: 'Tông màu chủ đạo', en: 'Accent tone' },
  'settings.tone.description': {
    vi: 'Đổi màu nhấn của toàn app. Trạng thái (hợp lệ/lỗi/cảnh báo) không đổi theo.',
    en: "Changes the app's accent color. Status colors (valid/error/warning) stay fixed.",
  },
} satisfies Record<string, Entry>;

export type TranslationKey = keyof typeof DICTIONARY;

/**
 * Dịch một khoá sang locale đã cho, nội suy `{{param}}` nếu có.
 * Khoá không tồn tại thì trả lại chính khoá đó — dễ nhận ra khi thiếu bản dịch
 * hơn là hiện chuỗi rỗng, và không bao giờ ném lỗi giữa lúc render.
 */
export function translate(
  key: TranslationKey,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  const entry = DICTIONARY[key];
  if (!entry) return key;
  let text = entry[locale];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      // split/join thay cho replaceAll — mục tiêu build là ES2020.
      text = text.split(`{{${k}}}`).join(String(v));
    }
  }
  return text;
}

/** `navigator.language` bắt đầu bằng "vi" → mặc định tiếng Việt; còn lại → tiếng Anh. */
export function detectDefaultLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language?.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}
