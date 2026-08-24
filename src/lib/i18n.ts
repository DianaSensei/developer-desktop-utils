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

  // ── Sidebar — trạng thái, tooltip, nút ──────────────────────────────────
  'shell.sidebar.connected': { vi: 'Đang kết nối', en: 'Connected' },
  'shell.sidebar.connectedLabel': { vi: '{{label}} — đang kết nối', en: '{{label}} — connected' },
  'shell.sidebar.disabledLabel': { vi: '{{label}} — đã tắt', en: '{{label}} — turned off' },
  'shell.sidebar.enable': { vi: 'Bật', en: 'Enable' },
  'shell.sidebar.moreAvailable': { vi: 'Còn {{count}} tool nữa', en: '{{count}} more tools available' },
  'shell.sidebar.moreInSettings': { vi: 'Còn {{count}} tool trong Cài đặt', en: '{{count}} more in Settings' },
  'shell.sidebar.turnOnHint': { vi: 'Bật thêm tool từ trang Cài đặt.', en: 'Turn on more tools from the Settings page.' },
  'shell.sidebar.closeMenu': { vi: 'Đóng menu', en: 'Close menu' },
  'shell.sidebar.searchToolsTitle': { vi: 'Tìm tool', en: 'Search tools' },
  'shell.sidebar.clearSearch': { vi: 'Xóa tìm kiếm', en: 'Clear search' },
  'shell.sidebar.expand': { vi: 'Mở rộng sidebar', en: 'Expand sidebar' },
  'shell.sidebar.collapse': { vi: 'Thu gọn sidebar', en: 'Collapse sidebar' },
  'shell.sidebar.collapseLabel': { vi: 'Thu gọn', en: 'Collapse' },
  'shell.sidebar.themeCycle': { vi: 'Giao diện: {{theme}} (bấm để đổi)', en: 'Theme: {{theme}} (click to cycle)' },
  'shell.sidebar.settings': { vi: 'Cài đặt', en: 'Settings' },
  'shell.sidebar.moreScrollHint': { vi: 'thêm', en: 'more' },

  // ── Experimental tools — badge + mỗi-lần-mở consent gate ────────────────
  'shell.experimental.badge': { vi: 'Thử nghiệm', en: 'Experimental' },
  'shell.experimental.sidebarLabel': { vi: '{{label}} — thử nghiệm', en: '{{label}} — experimental' },
  'shell.experimental.consentTitle': { vi: '{{label}} là tính năng thử nghiệm', en: '{{label}} is an experimental feature' },
  'shell.experimental.consentBody': {
    vi: 'Tính năng này còn đang thay đổi và có thể có hành vi chưa ổn định. Bạn sẽ được hỏi xác nhận lại mỗi lần mở tool này.',
    en: 'This feature is still evolving and may behave unpredictably. You will be asked to confirm again every time you open this tool.',
  },
  'shell.experimental.continue': { vi: 'Tiếp tục', en: 'Continue' },
  'shell.experimental.cancel': { vi: 'Quay lại', en: 'Go back' },

  // ── Theme options — dùng chung cho sidebar + toggle mobile ──────────────
  'shell.theme.light': { vi: 'Chế độ sáng', en: 'Light mode' },
  'shell.theme.dark': { vi: 'Chế độ tối', en: 'Dark mode' },
  'shell.theme.system': { vi: 'Theo hệ thống', en: 'Match system' },

  // ── Titlebar tự vẽ (macOS overlay + Windows/Linux custom chrome) ────────
  'shell.titlebar.openMenu': { vi: 'Mở menu', en: 'Open menu' },
  'shell.titlebar.running': { vi: 'Đang chạy', en: 'Running' },
  'shell.titlebar.howToUse': { vi: 'Cách dùng {{label}}', en: 'How to use {{label}}' },
  'shell.titlebar.minimize': { vi: 'Thu nhỏ', en: 'Minimize' },
  'shell.titlebar.restore': { vi: 'Khôi phục', en: 'Restore' },
  'shell.titlebar.maximize': { vi: 'Phóng to', en: 'Maximize' },
  'shell.titlebar.close': { vi: 'Đóng', en: 'Close' },
  'shell.titlebar.themeCycleTap': { vi: 'Giao diện: {{theme}} (chạm để đổi)', en: 'Theme: {{theme}} (tap to cycle)' },

  // ── ⌘K command palette — a11y-only title ────────────────────────────────
  'palette.title': { vi: 'Bảng lệnh', en: 'Command palette' },

  // ── Dùng chung nhiều nơi (sidebar + Settings tool list) ─────────────────
  'common.favorite': { vi: 'Thêm vào mục yêu thích', en: 'Add to favorites' },
  'common.unfavorite': { vi: 'Bỏ khỏi mục yêu thích', en: 'Remove from favorites' },
  'common.favoriteAria': { vi: 'Yêu thích {{label}}', en: 'Favorite {{label}}' },
  'common.unfavoriteAria': { vi: 'Bỏ yêu thích {{label}}', en: 'Unfavorite {{label}}' },
  'common.reset': { vi: 'Đặt lại', en: 'Reset' },

  // ── Settings — Appearance / Tools ────────────────────────────────────────
  'settings.section.appearance': { vi: 'Giao diện', en: 'Appearance' },
  'settings.section.tools': { vi: 'Công cụ', en: 'Tools' },
  'settings.tools.enabledCount': { vi: '{{enabled}}/{{total}} đã bật', en: '{{enabled}} of {{total}} enabled' },
  'settings.tools.enableAll': { vi: 'Bật tất cả', en: 'Enable all' },
  'settings.tools.disableAll': { vi: 'Tắt tất cả', en: 'Disable all' },
  'settings.tools.count': { vi: '{{count}} tool', en: '{{count}} tools' },
  'settings.tools.enableAria': { vi: 'Bật {{label}}', en: 'Enable {{label}}' },
  'settings.tools.disableAria': { vi: 'Tắt {{label}}', en: 'Disable {{label}}' },
  'settings.tools.dragReorder': { vi: 'Kéo để sắp xếp lại', en: 'Drag to reorder' },
  'settings.tools.dragReorderGroup': { vi: 'Kéo để sắp xếp lại {{label}}', en: 'Drag to reorder {{label}}' },

  // ── Settings — Permissions ───────────────────────────────────────────────
  'settings.permissions.title': { vi: 'Quyền ứng dụng', en: 'App Permissions' },
  'settings.permissions.description': {
    vi: 'Được tạo trực tiếp từ src-tauri/capabilities/default.json — mọi quyền mà app có thể yêu cầu được liệt kê bên dưới, theo từng plugin, kèm khai báo chính xác.',
    en: 'Generated directly from src-tauri/capabilities/default.json — every permission the app can request is listed below, grouped by plugin, with its exact declaration.',
  },
  'settings.permissions.webWarning': {
    vi: 'Đang chạy trong trình duyệt — các quyền liệt kê dưới đây chỉ áp dụng cho bản desktop.',
    en: 'Running in browser — permissions listed below apply to the desktop app only.',
  },

  // ── Settings — About ──────────────────────────────────────────────────────
  'settings.about.title': { vi: 'Giới thiệu', en: 'About' },
  'settings.about.tagline': { vi: 'Bộ công cụ dành cho developer trên máy tính của bạn', en: 'Developer utilities for your desktop' },
  'settings.about.onboardingTitle': { vi: 'Hướng dẫn giới thiệu', en: 'Onboarding guide' },
  'settings.about.onboardingDescription': {
    vi: 'Xem lại màn welcome và chọn lại nhóm tool quan tâm',
    en: 'Revisit the welcome screen and pick your tool groups again',
  },
  'settings.about.reviewCta': { vi: 'Xem lại', en: 'Review' },
  'settings.about.autoCheckTitle': { vi: 'Tự động kiểm tra cập nhật', en: 'Auto-check for updates' },
  'settings.about.autoCheckDescription': { vi: 'Kiểm tra khi khởi động và mỗi ngày lúc {{hour}}', en: 'Check on launch and daily at {{hour}}' },
  'settings.about.version': { vi: 'Phiên bản', en: 'Version' },
  'settings.about.upToDate': { vi: 'Đã cập nhật', en: 'Up to date' },
  'settings.about.updateAvailable': { vi: 'Có bản v{{version}}', en: 'v{{version}} available' },
  'settings.about.updateCheckFailed': { vi: 'Kiểm tra cập nhật thất bại', en: 'Update check failed' },
  'settings.about.offline': { vi: 'Ngoại tuyến', en: 'Offline' },
  'settings.about.downloading': { vi: 'Đang tải…', en: 'Downloading…' },
  'settings.about.cancelDownload': { vi: 'Hủy tải xuống', en: 'Cancel download' },
  'settings.about.checking': { vi: 'Đang kiểm tra…', en: 'Checking…' },
  'settings.about.whatsNew': { vi: 'Có gì mới', en: "What's new" },
  'settings.about.install': { vi: 'Cài đặt', en: 'Install' },
  'settings.about.check': { vi: 'Kiểm tra', en: 'Check' },
  'settings.about.contact': { vi: 'Liên hệ, góp ý & đóng góp', en: 'Contact, feedback & contribute' },
  'settings.about.openGitHub': { vi: 'Mở GitHub issues', en: 'Open GitHub issues' },
  'settings.about.privacyNote': {
    vi: 'Mọi thứ chạy ngay trên máy bạn. App chỉ truy cập mạng khi bạn yêu cầu, cộng với việc kiểm tra cập nhật hằng ngày — không có telemetry, phân tích hay dữ liệu nào rời khỏi máy bạn.',
    en: 'Everything runs on your device. Network access only happens when you ask for it, plus the daily check for app updates — no telemetry, analytics, or other data leaves your machine.',
  },

  // ── Settings — Data & Storage ─────────────────────────────────────────────
  'settings.storage.title': { vi: 'Dữ liệu & Lưu trữ', en: 'Data & Storage' },
  'settings.storage.location': { vi: 'Nơi lưu dữ liệu của bạn', en: 'Where your data is stored' },
  'settings.storage.resolving': { vi: 'Đang xác định…', en: 'Resolving…' },
  'settings.storage.webOnly': { vi: 'Thư mục dữ liệu app (chỉ có ở bản desktop).', en: 'App data folder (available in the desktop app).' },
  'settings.storage.note': {
    vi: 'Mọi cài đặt, lịch sử tool và workspace được lưu vào một file trên máy bạn — không phải trên trình duyệt. Không có gì rời khỏi máy bạn.',
    en: 'All settings, tool history and workspaces are saved to a file on your device — not in the browser. Nothing leaves your machine.',
  },
  'settings.storage.showInFolder': { vi: 'Mở trong thư mục', en: 'Show in folder' },

  // ── Settings — Configuration ──────────────────────────────────────────────
  'settings.config.title': { vi: 'Cấu hình', en: 'Configuration' },
  'settings.config.description': {
    vi: 'Các giá trị điều chỉnh hành vi app. Thay đổi được lưu cục bộ và áp dụng ngay.',
    en: 'Tunable app behavior. Changes are saved locally and applied immediately.',
  },

  // ── Onboarding welcome flow ───────────────────────────────────────────────
  'onboarding.welcome.title': { vi: 'Chào mừng đến với DevTool', en: 'Welcome to DevTool' },
  'onboarding.welcome.description': {
    vi: 'Bộ công cụ dành cho developer: xử lý text, encode/hash, API client, mock server, Kafka/RabbitMQ và nhiều hơn nữa — tất cả chạy ngay trên máy bạn, không cần server.',
    en: 'A developer toolbox: text processing, encode/hash, API client, mock server, Kafka/RabbitMQ and more — all running right on your machine, no server required.',
  },
  'onboarding.skip': { vi: 'Bỏ qua', en: 'Skip' },
  'onboarding.start': { vi: 'Bắt đầu', en: 'Get started' },
  'onboarding.tools.title': { vi: 'Bạn quan tâm tới nhóm công cụ nào?', en: 'Which tool groups interest you?' },
  'onboarding.tools.description': {
    vi: 'Các tool trong nhóm bạn chọn sẽ được bật và ghim lên đầu sidebar. Bạn có thể đổi lại bất cứ lúc nào trong Settings.',
    en: 'Tools in the groups you pick will be enabled and pinned to the top of the sidebar. You can change this anytime in Settings.',
  },
  'onboarding.continue': { vi: 'Tiếp tục', en: 'Continue' },
  'onboarding.done.title': { vi: 'Sẵn sàng rồi!', en: 'All set!' },
  'onboarding.done.before': {
    vi: 'Các tool bạn chọn đã lên đầu sidebar. Bấm nút',
    en: 'Your chosen tools are now pinned to the top of the sidebar. Tap the',
  },
  'onboarding.done.after': {
    vi: 'ở góc trên mỗi tool bất cứ lúc nào để xem hướng dẫn sử dụng chi tiết.',
    en: 'button at the top of any tool anytime to see a detailed guide.',
  },
  'onboarding.done.cta': { vi: 'Bắt đầu sử dụng DevTool', en: 'Start using DevTool' },
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
