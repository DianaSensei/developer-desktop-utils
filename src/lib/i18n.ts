/**
 * VI/EN localization, switchable at runtime.
 *
 * The flat dictionary below is the shell's (sidebar, ⌘K, Settings,
 * workspaces). Each tool keeps its own `<Tool>.messages.ts` next to it
 * (`defineMessages`), and kit components use `components/ui/ui.messages.ts`.
 *
 * Flat `{ vi, en }` entries make a missing translation a type error and let
 * i18n.test.ts check that used keys and defined keys match. `{{name}}`
 * interpolation is enough for short shell strings.
 */

export type Locale = 'vi' | 'en';

export const LOCALES: Locale[] = ['vi', 'en'];

export type Entry = Record<Locale, string>;

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

  // ── Clipboard detection reasons (lib/clipboardIntent.ts) ───────────────
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
  'settings.corner.label': { vi: 'Kiểu bo góc', en: 'Corner style' },
  'settings.corner.description': {
    vi: 'Độ bo góc của thẻ, nút và ô nhập trong toàn app. "Vuông" cho dáng IDE, "Tròn" cho dáng mềm.',
    en: 'Corner rounding for cards, buttons and inputs across the app. "Sharp" reads as an IDE, "Round" as a softer app.',
  },
  'settings.corner.sharp': { vi: 'Vuông', en: 'Sharp' },
  'settings.corner.default': { vi: 'Mặc định', en: 'Default' },
  'settings.corner.round': { vi: 'Tròn', en: 'Round' },
  'settings.font.label': { vi: 'Mặt chữ', en: 'Font' },
  'settings.font.description': {
    vi: 'Đổi mặt chữ giao diện chung, dùng mặt chữ hệ thống đã cài sẵn — không cần tải font mới.',
    en: "Changes the app's general UI font, using fonts already installed on your system — nothing new to download.",
  },
  'settings.font.default': { vi: 'Mặc định (Be Vietnam Pro)', en: 'Default (Be Vietnam Pro)' },
  'settings.font.system': { vi: 'Mặt chữ hệ thống', en: 'System font' },
  'settings.font.serif': { vi: 'Chữ có chân', en: 'Serif' },
  'settings.font.classic': { vi: 'Sans cổ điển', en: 'Classic sans' },
  'settings.monoFont.label': { vi: 'Mặt chữ mã', en: 'Code font' },
  'settings.monoFont.description': {
    vi: 'Mặt chữ đơn cách cho code, JSON, và các ô nhập dữ liệu — riêng khỏi mặt chữ giao diện chung ở trên. Cả hai lựa chọn đều tự host, không cần tải thêm.',
    en: 'Monospace font for code, JSON, and data fields — separate from the general UI font above. Both options are self-hosted, nothing extra to download.',
  },
  'settings.monoFont.ibmPlexMono': { vi: 'IBM Plex Mono (mặc định)', en: 'IBM Plex Mono (default)' },
  'settings.monoFont.firaCode': { vi: 'Fira Code (có ligature)', en: 'Fira Code (with ligatures)' },
  'settings.monoFont.previewLabel': { vi: 'Xem trước', en: 'Preview' },

  // ── Sidebar: status, tooltips, buttons ─────────────────────────────────
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

  // ── Experimental tools: badge and per-open consent ─────────────────────
  'shell.experimental.badge': { vi: 'Thử nghiệm', en: 'Experimental' },
  'shell.experimental.sidebarLabel': { vi: '{{label}} — thử nghiệm', en: '{{label}} — experimental' },
  'shell.experimental.consentTitle': { vi: '{{label}} là tính năng thử nghiệm', en: '{{label}} is an experimental feature' },
  'shell.experimental.consentBody': {
    vi: 'Tính năng này còn đang thay đổi và có thể có hành vi chưa ổn định. Bạn sẽ được hỏi xác nhận lại mỗi lần mở tool này.',
    en: 'This feature is still evolving and may behave unpredictably. You will be asked to confirm again every time you open this tool.',
  },
  'shell.experimental.continue': { vi: 'Tiếp tục', en: 'Continue' },
  'shell.experimental.cancel': { vi: 'Quay lại', en: 'Go back' },

  // ── Theme options (sidebar and mobile toggle) ──────────────────────────
  'shell.theme.light': { vi: 'Chế độ sáng', en: 'Light mode' },
  'shell.theme.dark': { vi: 'Chế độ tối', en: 'Dark mode' },
  'shell.theme.system': { vi: 'Theo hệ thống', en: 'Match system' },

  // ── Custom titlebar (macOS overlay, Windows/Linux chrome) ──────────────
  'shell.titlebar.openMenu': { vi: 'Mở menu', en: 'Open menu' },
  'shell.titlebar.running': { vi: 'Đang chạy', en: 'Running' },
  'shell.titlebar.howToUse': { vi: 'Cách dùng {{label}}', en: 'How to use {{label}}' },
  'shell.titlebar.minimize': { vi: 'Thu nhỏ', en: 'Minimize' },
  'shell.titlebar.restore': { vi: 'Khôi phục', en: 'Restore' },
  'shell.titlebar.maximize': { vi: 'Phóng to', en: 'Maximize' },
  'shell.titlebar.close': { vi: 'Đóng', en: 'Close' },
  'shell.titlebar.themeCycleTap': { vi: 'Giao diện: {{theme}} (chạm để đổi)', en: 'Theme: {{theme}} (tap to cycle)' },

  // ── Workspaces: named, persisted sets of tool tabs ─────────────────────
  'shell.workspace.tabsLabel': { vi: 'Tab của workspace {{name}}', en: 'Tabs in workspace {{name}}' },
  'shell.workspace.defaultName': { vi: 'Workspace số {{n}}', en: 'Workspace {{n}}' },
  'shell.workspace.switcher': { vi: 'Đổi workspace — đang ở {{name}}', en: 'Switch workspace — current: {{name}}' },
  'shell.workspace.menuLabel': { vi: 'Workspace', en: 'Workspaces' },
  'shell.workspace.tabCount': { vi: '{{n}} tab', en: '{{n}} tabs' },
  'shell.workspace.new': { vi: 'Workspace mới…', en: 'New workspace…' },
  'shell.workspace.rename': { vi: 'Đổi tên…', en: 'Rename…' },
  'shell.workspace.delete': { vi: 'Xoá workspace này', en: 'Delete this workspace' },
  'shell.workspace.closeTab': { vi: 'Đóng tab {{label}}', en: 'Close {{label}} tab' },
  'shell.workspace.allTabs': { vi: 'Tất cả tab ({{n}})', en: 'All tabs ({{n}})' },
  'shell.workspace.closeOthers': { vi: 'Đóng các tab khác', en: 'Close other tabs' },
  'shell.workspace.openTool': { vi: 'Mở tool khác ({{shortcut}})', en: 'Open another tool ({{shortcut}})' },
  'shell.workspace.dialogCreate': { vi: 'Workspace mới', en: 'New workspace' },
  'shell.workspace.dialogRename': { vi: 'Đổi tên workspace', en: 'Rename workspace' },
  'shell.workspace.dialogHint': {
    vi: 'Mỗi workspace giữ một bộ tab riêng. Tool đang mở sẽ là tab đầu tiên.',
    en: 'Each workspace keeps its own set of tabs. The tool on screen becomes its first tab.',
  },
  'shell.workspace.namePlaceholder': { vi: 'VD: Debug backend', en: 'e.g. Backend debugging' },
  'shell.workspace.create': { vi: 'Tạo', en: 'Create' },
  'shell.workspace.save': { vi: 'Lưu', en: 'Save' },
  'shell.workspace.cancel': { vi: 'Huỷ', en: 'Cancel' },
  'palette.section.workspaces': { vi: 'Workspace', en: 'Workspaces' },
  'palette.workspace.switch': { vi: 'Chuyển sang', en: 'Switch to' },
  'palette.workspace.empty': { vi: 'Chưa có tab nào', en: 'No tabs yet' },

  // ── ⌘K command palette: accessible title ───────────────────────────────
  'palette.title': { vi: 'Bảng lệnh', en: 'Command palette' },

  // ── Shared (sidebar and Settings tool list) ─────────────────────────────
  'common.favorite': { vi: 'Thêm vào mục yêu thích', en: 'Add to favorites' },
  'common.unfavorite': { vi: 'Bỏ khỏi mục yêu thích', en: 'Remove from favorites' },
  'common.favoriteAria': { vi: 'Yêu thích {{label}}', en: 'Favorite {{label}}' },
  'common.unfavoriteAria': { vi: 'Bỏ yêu thích {{label}}', en: 'Unfavorite {{label}}' },
  'shell.error.title': { vi: 'Tool này gặp lỗi', en: 'This tool hit an error' },
  'shell.error.fallback': { vi: 'Có lỗi khi hiển thị tool.', en: 'Something went wrong while rendering.' },
  'shell.error.retry': { vi: 'Thử lại', en: 'Try again' },
  'shell.error.copyDetails': { vi: 'Chép chi tiết lỗi', en: 'Copy error details' },
  'shell.error.clearData': { vi: 'Xoá dữ liệu của tool…', en: "Clear this tool's data…" },
  'shell.error.clearHint': {
    vi: 'Nếu lỗi lặp lại sau khi thử lại, có thể dữ liệu đã lưu của tool bị hỏng.',
    en: 'If it keeps failing after a retry, the tool’s saved data may be damaged.',
  },
  'shell.error.clearTitle': { vi: 'Xoá dữ liệu của {{label}}?', en: 'Clear {{label}} data?' },
  'shell.error.clearBody': {
    vi: 'Xoá input, tuỳ chọn và trạng thái đã lưu của tool này rồi mở lại. Không ảnh hưởng tool khác và các bí mật trong vault.',
    en: 'Removes this tool’s saved input, options and state, then reopens it. Other tools and secrets in the vault are not touched.',
  },
  'shell.error.clearConfirm': { vi: 'Xoá và mở lại', en: 'Clear and reopen' },
  'common.reset': { vi: 'Đặt lại', en: 'Reset' },

  // ── Settings — Appearance / Tools ────────────────────────────────────────
  'settings.section.appearance': { vi: 'Giao diện', en: 'Appearance' },
  'settings.section.tools': { vi: 'Công cụ', en: 'Tools' },
  'settings.section.extensions': { vi: 'Tiện ích', en: 'Extensions' },
  'settings.tools.enabledCount': { vi: '{{enabled}}/{{total}} đã bật', en: '{{enabled}} of {{total}} enabled' },
  'settings.tools.enableAll': { vi: 'Bật tất cả', en: 'Enable all' },
  'settings.confirm.disableAllTitle': { vi: 'Tắt tất cả tool?', en: 'Disable every tool?' },
  'settings.confirm.disableAllBody': {
    vi: 'Sidebar sẽ trống cho tới khi bạn bật lại từng tool. Dữ liệu của tool vẫn được giữ.',
    en: 'The sidebar stays empty until you turn tools back on. Tool data is kept.',
  },
  'settings.confirm.resetToolsTitle': { vi: 'Đặt lại tool bật/tắt?', en: 'Reset which tools are on?' },
  'settings.confirm.resetToolsBody': {
    vi: 'Các tool trở về trạng thái bật/tắt mặc định. Thứ tự, mục yêu thích và dữ liệu của tool không đổi.',
    en: 'Tools go back to their default on/off state. Order, favorites and tool data are not changed.',
  },
  'settings.confirm.resetConfigTitle': { vi: 'Đặt lại cấu hình?', en: 'Reset configuration?' },
  'settings.confirm.resetConfigBody': {
    vi: 'Mọi giá trị trong mục này trở về mặc định.',
    en: 'Every value in this section goes back to its default.',
  },
  'settings.tools.disableAll': { vi: 'Tắt tất cả', en: 'Disable all' },
  'settings.tools.count': { vi: '{{count}} tool', en: '{{count}} tools' },
  'settings.tools.enableAria': { vi: 'Bật {{label}}', en: 'Enable {{label}}' },
  'settings.tools.disableAria': { vi: 'Tắt {{label}}', en: 'Disable {{label}}' },
  'settings.tools.dragReorder': { vi: 'Kéo để sắp xếp lại', en: 'Drag to reorder' },
  'settings.tools.dragReorderGroup': { vi: 'Kéo để sắp xếp lại {{label}}', en: 'Drag to reorder {{label}}' },

  // ── Settings — Shortcuts ─────────────────────────────────────────────────
  'settings.section.shortcuts': { vi: 'Phím tắt', en: 'Keyboard Shortcuts' },
  'settings.shortcuts.description': {
    vi: 'Các phím tắt hoạt động ở mọi nơi trong app, cộng với phím tắt riêng của từng tool.',
    en: 'Shortcuts that work anywhere in the app, plus ones specific to each tool.',
  },
  'settings.shortcuts.global': { vi: 'Áp dụng mọi nơi', en: 'Works everywhere' },

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

  // ── Settings — Plugins (built in) ────────────────────────────────────────
  'settings.plugins.description': {
    vi: 'Mỗi tool BIÊN DỊCH SẴN trong app là một plugin tự khai báo trong src/plugins/<id>/plugin.ts. Bảng dưới đọc thẳng từ các manifest đó: kênh Platform mà plugin được phép dùng, và lệnh native nằm trong allowlist của nó. Muốn cài thêm plugin/service KHÁC không có sẵn ở đây, xem mục Tiện ích.',
    en: 'Every tool already COMPILED INTO the app is a plugin that declares itself in src/plugins/<id>/plugin.ts. The table below is read straight from those manifests: which Platform channels the plugin may use, and which native commands are in its allowlist. To install extra plugins/services not already here, see the Extensions section.',
  },
  'settings.plugins.count': {
    vi: '{{enabled}}/{{total}} plugin đang bật · Platform SDK {{sdk}}',
    en: '{{enabled}} of {{total}} plugins on · Platform SDK {{sdk}}',
  },
  'settings.plugins.off': { vi: 'đã tắt', en: 'off' },
  'settings.plugins.noPermissions': { vi: 'Không dùng kênh nào của Platform', en: 'Uses no Platform channel' },
  'settings.plugins.commands': { vi: 'Lệnh native', en: 'Native commands' },
  'settings.plugins.hosts': { vi: 'Host được phép gọi', en: 'Allowed hosts' },
  'settings.plugins.vaultKeychain': {
    vi: 'Bí mật được mã hoá AES-256-GCM, khoá nằm trong keychain của hệ điều hành.',
    en: 'Secrets are encrypted with AES-256-GCM; the key lives in the OS keychain.',
  },
  'settings.plugins.vaultFile': {
    vi: 'Bí mật được mã hoá, nhưng máy này không có keychain khả dụng nên khoá nằm trong file chỉ chủ sở hữu đọc được, cạnh dữ liệu — yếu hơn: ai đọc được thư mục dữ liệu app thì đọc được cả hai.',
    en: 'Secrets are encrypted, but no keychain is available on this machine, so the key sits in an owner-only file next to the data — weaker: anyone who can read the app data folder can read both.',
  },
  'settings.plugins.vaultUnreadable': {
    vi: 'Không giải mã được kho bí mật bằng khoá hiện tại — nhiều khả năng mục trong keychain đã bị xoá hoặc thay.',
    en: 'The secret store cannot be decrypted with the current key — the keychain entry was most likely removed or replaced.',
  },
  'settings.plugins.audit': { vi: 'Nhật ký hoạt động', en: 'Activity log' },
  'settings.plugins.auditDescription': {
    vi: 'Mọi lời gọi plugin → Platform trong phiên này, kể cả lời gọi bị từ chối vì thiếu quyền. Chỉ lưu trong bộ nhớ, xoá khi đóng app.',
    en: 'Every plugin → Platform call this session, including ones denied for a missing permission. Kept in memory only; cleared when the app closes.',
  },
  'settings.plugins.auditEmpty': {
    vi: 'Chưa có lời gọi nào trong phiên này.',
    en: 'No calls yet this session.',
  },
  'settings.plugins.auditDenied': { vi: 'bị từ chối', en: 'denied' },
  'settings.plugins.auditShow': {
    vi: 'Hiện nhật ký ({{count}})',
    en: 'Show activity log ({{count}})',
  },
  'settings.plugins.auditHide': { vi: 'Ẩn nhật ký', en: 'Hide activity log' },
  'settings.plugins.auditSearchPlaceholder': {
    vi: 'Tìm theo id tool, hành động, chi tiết…',
    en: 'Search by tool id, action, detail…',
  },
  'settings.plugins.auditNoMatch': {
    vi: 'Không có lời gọi nào khớp "{{query}}".',
    en: 'No calls match "{{query}}".',
  },

  // ── Settings — Extensions (installed from a marketplace or URL) ───────────
  'settings.extensions.title': { vi: 'Tiện ích', en: 'Extensions' },
  'settings.extensions.description': {
    vi: 'Cài thêm plugin hoặc sidecar KHÔNG có sẵn trong bản biên dịch của app — từ Chợ tiện ích hoặc dán URL manifest tay. Đây là tiện ích do chính bạn phát hành, không phải một kho mở cho bên thứ ba. Xem mục Plugin nếu muốn xem quyền của các tool đã có sẵn.',
    en: 'Install extra plugins or sidecars that are NOT already compiled into the app — from the Marketplace or by pasting a manifest URL. These are extensions you publish yourself, not an open third-party store. See the Plugins section for the permissions of the tools already built in.',
  },
  'settings.extensions.tabs.marketplace': { vi: 'Chợ tiện ích', en: 'Marketplace' },
  'settings.extensions.tabs.installUrl': { vi: 'Cài từ URL', en: 'Install by URL' },
  'settings.extensions.tabs.installed': { vi: 'Đã cài', en: 'Installed' },

  'settings.extensions.install.title': { vi: 'Cài tiện ích từ bên ngoài', en: 'Install external extension' },
  'settings.extensions.install.description': {
    vi: 'Dán URL manifest của một plugin hoặc một sidecar (do bạn phát hành) để cài. Checksum sha256 trong manifest được kiểm trước khi bất kỳ dòng code/binary nào chạy — một URL không tự đủ để tin, kiểm tra vẫn diễn ra dù bạn đã tin nguồn.',
    en: 'Paste a manifest URL for a plugin or a sidecar (published by you) to install it. The sha256 checksum in the manifest is checked before any of its code/binary ever runs — a URL alone is never enough trust, the check still happens even when you trust the source.',
  },
  'settings.extensions.install.webWarning': {
    vi: 'Đang chạy trong trình duyệt — cài tiện ích chỉ hoạt động trên bản desktop.',
    en: 'Running in browser — installing extensions only works in the desktop app.',
  },
  'settings.extensions.install.preview': { vi: 'Xem trước', en: 'Preview' },
  'settings.extensions.install.confirm': { vi: 'Cài đặt', en: 'Install' },
  'settings.extensions.install.previewing': { vi: 'Đang tải manifest…', en: 'Fetching manifest…' },
  'settings.extensions.install.installing': { vi: 'Đang cài…', en: 'Installing…' },
  'settings.extensions.install.installed': {
    vi: 'Đã cài. Khởi động lại app để dùng tiện ích này.',
    en: 'Installed. Restart the app to use this extension.',
  },
  'settings.extensions.install.kind.plugin': { vi: 'Trình cắm', en: 'Plugin' },
  'settings.extensions.install.kind.service': { vi: 'Dịch vụ', en: 'Service' },
  'settings.extensions.install.targetTriple': {
    vi: 'Nền tảng máy này: {{triple}}',
    en: 'This machine\'s target: {{triple}}',
  },
  'settings.extensions.install.targetSupported': {
    vi: 'Manifest có bản cho nền tảng này.',
    en: 'The manifest has a build for this platform.',
  },
  'settings.extensions.install.targetUnsupported': {
    vi: 'Manifest KHÔNG có bản cho nền tảng này — cài sẽ bị từ chối.',
    en: 'The manifest has NO build for this platform — install will be rejected.',
  },
  'settings.extensions.install.serviceDependencyMissing': {
    vi: 'Plugin này cần sidecar "{{bin}}" để hoạt động đầy đủ, và sidecar đó CHƯA được cài. Dán URL manifest service của nó (thường đi kèm cùng chỗ với plugin này) và cài riêng — hai URL tách biệt nhau, không tự tải hộ được.',
    en: 'This plugin needs the "{{bin}}" sidecar to work fully, and it isn’t installed yet. Paste its service manifest URL (usually listed alongside this plugin) and install it separately — the two are separate URLs, this can’t fetch it for you.',
  },
  'settings.extensions.installed.title': { vi: 'Tiện ích đã cài', en: 'Installed extensions' },
  'settings.extensions.installed.empty': { vi: 'Chưa cài tiện ích nào.', en: 'No extensions installed yet.' },
  'settings.extensions.installed.checkUpdate': { vi: 'Kiểm bản mới', en: 'Check for update' },
  'settings.extensions.installed.update': { vi: 'Cập nhật', en: 'Update' },
  'settings.extensions.installed.upToDate': { vi: 'Đã là bản mới nhất', en: 'Up to date' },
  'settings.extensions.installed.updateAvailable': {
    vi: 'Có bản {{version}} mới hơn',
    en: 'Version {{version}} available',
  },
  'settings.extensions.installed.uninstall': { vi: 'Gỡ', en: 'Uninstall' },
  'settings.extensions.installed.serviceWarning': {
    vi: 'Cập nhật/gỡ sẽ DỪNG sidecar này nếu đang chạy — một kết nối hoặc stream đang mở sẽ bị ngắt ngay.',
    en: 'Updating/uninstalling will STOP this sidecar if it is running — any open connection or stream will be cut immediately.',
  },
  'settings.extensions.installed.coupledUninstallNote': {
    vi: 'Sẽ gỡ luôn "{{label}}" — hai phần này liên quan trực tiếp với nhau (một bên không dùng được nếu thiếu bên kia).',
    en: 'Will also uninstall "{{label}}" — the two are directly linked (one doesn’t work without the other).',
  },
  'settings.extensions.installed.confirm': { vi: 'Xác nhận', en: 'Confirm' },
  'settings.extensions.installed.cancel': { vi: 'Huỷ', en: 'Cancel' },

  // ── Settings — Extensions — Marketplace ──────────────────────────────────
  'settings.extensions.marketplace.description': {
    vi: 'Chọn một market để xem những tiện ích có sẵn ở đó — bấm Cài để tự chuyển sang bước xem trước/xác nhận, không cài thẳng.',
    en: 'Pick a market to see what it offers — clicking Install jumps you to the same preview/confirm step, nothing installs directly.',
  },
  'settings.extensions.marketplace.marketLabel': { vi: 'Nguồn (market)', en: 'Market' },
  'settings.extensions.marketplace.addMarket': { vi: 'Thêm market', en: 'Add market' },
  'settings.extensions.marketplace.marketNamePlaceholder': { vi: 'Tên market', en: 'Market name' },
  'settings.extensions.marketplace.marketUrlPlaceholder': { vi: 'URL catalog.json', en: 'catalog.json URL' },
  'settings.extensions.marketplace.add': { vi: 'Thêm', en: 'Add' },
  'settings.extensions.marketplace.remove': { vi: 'Xoá market này', en: 'Remove this market' },
  'settings.extensions.marketplace.custom': { vi: 'Tự thêm', en: 'Custom' },
  'settings.extensions.marketplace.loading': { vi: 'Đang tải danh sách tiện ích…', en: 'Loading extension list…' },
  'settings.extensions.marketplace.error': {
    vi: 'Không tải được market này: {{error}}',
    en: 'Could not load this market: {{error}}',
  },
  'settings.extensions.marketplace.empty': {
    vi: 'Market này chưa có tiện ích nào.',
    en: 'This market has no extensions yet.',
  },
  'settings.extensions.marketplace.install': { vi: 'Cài đặt', en: 'Install' },
  'settings.extensions.marketplace.installed': { vi: 'Đã cài', en: 'Installed' },
  'settings.extensions.marketplace.updateTo': { vi: 'Cập nhật lên {{version}}', en: 'Update to {{version}}' },
  'settings.extensions.marketplace.unsupportedPlatform': {
    vi: 'Không có bản cho nền tảng máy này',
    en: 'No build for this machine\'s platform',
  },
  'settings.extensions.restart.needed': {
    vi: 'Đã thay đổi tiện ích cài từ bên ngoài — khởi động lại để áp dụng.',
    en: 'External extensions changed — restart to apply.',
  },
  'settings.extensions.restart.now': { vi: 'Khởi động lại ngay', en: 'Restart now' },

  // ── Settings — MCP ────────────────────────────────────────────────────────
  'settings.mcp.title': { vi: 'Cầu nối MCP', en: 'MCP' },
  'settings.mcp.backgroundTitle': { vi: 'Bridge MCP chạy nền', en: 'Background MCP bridge' },
  'settings.mcp.backgroundDescription': {
    vi: 'Cho phép Claude Desktop/Code điều khiển API Client, Mock Server, Redis Client và Kafka Explorer qua MCP dù đang xem tool khác. Mặc định mỗi tool chỉ trả lời MCP khi chính tool đó đang mở trên màn hình.',
    en: 'Lets Claude Desktop/Code drive API Client, Mock Server, Redis Client, and Kafka Explorer over MCP even while a different tool is on screen. By default, each only answers MCP calls while it is the tool actually open.',
  },
  'settings.mcp.perToolTitle': { vi: 'Truy cập MCP theo từng tool', en: 'Per-tool MCP access' },
  'settings.mcp.perToolDescription': {
    vi: 'Tắt một tool ở đây thì tool đó không bao giờ trả lời MCP call nữa — dù đang mở trên màn hình hay bridge chạy nền đang bật.',
    en: 'Turning a tool off here means it never answers an MCP call again — whether it’s on screen or the background bridge is on.',
  },
  'settings.mcp.webWarning': {
    vi: 'Đang chạy trong trình duyệt — MCP chỉ khả dụng trên bản desktop.',
    en: 'Running in browser — MCP is only available in the desktop app.',
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

  // ── Settings — Data & Storage (shown under About) ────────────────────────
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
    vi: 'Bộ công cụ dành cho developer: JSON, xử lý text, encode/hash, API client, mock server và nhiều hơn nữa — tất cả chạy ngay trên máy bạn, không cần server. Cài thêm tool trong Settings → Extensions.',
    en: 'A developer toolbox: JSON, text processing, encode/hash, API client, mock server and more — all running right on your machine, no server required. Add more tools in Settings → Extensions.',
  },
  'onboarding.skip': { vi: 'Bỏ qua', en: 'Skip' },
  'onboarding.start': { vi: 'Bắt đầu', en: 'Get started' },
  'onboarding.tools.title': { vi: 'Bạn quan tâm tới nhóm công cụ nào?', en: 'Which tool groups interest you?' },
  'onboarding.tools.description': {
    vi: 'Các tool trong nhóm bạn chọn sẽ được bật trong sidebar; bỏ chọn một nhóm sẽ tắt các tool của nhóm đó. Bạn có thể đổi lại bất cứ lúc nào trong Settings.',
    en: 'Tools in the groups you pick are turned on in the sidebar; unpicking a group turns its tools off. You can change this anytime in Settings.',
  },
  'onboarding.continue': { vi: 'Tiếp tục', en: 'Continue' },
  'onboarding.done.title': { vi: 'Sẵn sàng rồi!', en: 'All set!' },
  'onboarding.done.before': {
    vi: 'Các tool bạn chọn đã có trong sidebar. Bấm nút',
    en: 'Your chosen tools are now in the sidebar. Tap the',
  },
  'onboarding.done.after': {
    vi: 'ở góc trên mỗi tool bất cứ lúc nào để xem hướng dẫn sử dụng chi tiết.',
    en: 'button at the top of any tool anytime to see a detailed guide.',
  },
  'onboarding.group.api-messaging': { vi: 'API & Mock', en: 'API & Mocking' },
  'onboarding.group.data-format': { vi: 'Dữ liệu & Định dạng', en: 'Data & Formatters' },
  'onboarding.group.text-encoding': { vi: 'Text & Mã hoá', en: 'Text & Encoding' },
  'onboarding.group.time-productivity': { vi: 'Thời gian & Năng suất', en: 'Time & Productivity' },
  'onboarding.group.design-media': { vi: 'Thiết kế & Media', en: 'Design & Media' },
  'onboarding.group.network-security': { vi: 'Mạng & Bảo mật', en: 'Network & Security' },
  'onboarding.group.fun': { vi: 'Giải trí', en: 'Fun' },
  'guide.title': { vi: 'Cách dùng {{label}}', en: 'Using {{label}}' },
  'guide.whatsNewTitle': { vi: 'Có gì mới ở {{label}}', en: "What's new in {{label}}" },
  'onboarding.done.cta': { vi: 'Bắt đầu sử dụng DevTool', en: 'Start using DevTool' },
} satisfies Record<string, Entry>;

export type TranslationKey = keyof typeof DICTIONARY;

/**
 * Translates a key and interpolates `{{param}}`. An unknown key returns the
 * key itself, which is easy to spot and never throws during render.
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
      // split/join instead of replaceAll: the build targets ES2020.
      text = text.split(`{{${k}}}`).join(String(v));
    }
  }
  return text;
}

/** Vietnamese when `navigator.language` starts with "vi", otherwise English. */
export function detectDefaultLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language?.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

// ── Per-tool dictionaries ────────────────────────────────────────────────
//
// Each tool keeps its strings in `<Tool>.messages.ts` next to it, so they
// stay reviewable and leave with the tool. `toolMessages.test.ts` checks
// every `*.messages.ts` for empty translations.

export type Messages = Record<string, Entry>;

/** Declares a tool dictionary so TypeScript infers its keys. */
export function defineMessages<M extends Messages>(messages: M): M {
  return messages;
}

/** Interpolates `{{param}}`; shared by shell and tool dictionaries. */
export function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  let out = text;
  for (const [k, v] of Object.entries(params)) out = out.split(`{{${k}}}`).join(String(v));
  return out;
}
