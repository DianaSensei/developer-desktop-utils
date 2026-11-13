import { defineMessages } from '@/lib/i18n';

export default defineMessages({
  // Tabs
  tabOverview: { vi: 'Tổng quan', en: 'Overview' },
  tabSessions: { vi: 'Phiên', en: 'Sessions' },
  tabUsage: { vi: 'Mức dùng', en: 'Usage' },
  tabAccounts: { vi: 'Tài khoản', en: 'Accounts' },

  // Toolbar
  allAccounts: { vi: 'Mọi tài khoản', en: 'All accounts' },
  accountFilter: { vi: 'Lọc theo tài khoản', en: 'Filter by account' },
  rangeLabel: { vi: 'Khoảng thời gian', en: 'Time range' },
  rangeToday: { vi: 'Hôm nay', en: 'Today' },
  range7d: { vi: '7 ngày', en: '7 days' },
  range30d: { vi: '30 ngày', en: '30 days' },
  rangeAll: { vi: 'Tất cả', en: 'All time' },
  refresh: { vi: 'Làm mới', en: 'Refresh' },
  autoRefresh: { vi: 'Tự làm mới', en: 'Auto-refresh' },
  autoRefreshHint: { vi: 'Quét lại mỗi {{seconds}} giây khi tool đang mở', en: 'Rescan every {{seconds}}s while this tool is in front' },
  updatedAt: { vi: 'Cập nhật {{time}}', en: 'Updated {{time}}' },

  // States
  desktopOnly: {
    vi: 'Claude Manager đọc dữ liệu Claude Code trên máy nên chỉ chạy trong bản desktop.',
    en: 'Claude Manager reads Claude Code data from this machine, so it only works in the desktop app.',
  },
  scanning: { vi: 'Đang quét dữ liệu Claude Code…', en: 'Scanning Claude Code data…' },
  scanFailed: { vi: 'Không quét được', en: 'Scan failed' },
  noDataTitle: { vi: 'Chưa thấy phiên Claude Code nào', en: 'No Claude Code sessions found' },
  noDataBody: {
    vi: 'Không có phiên nào trong các thư mục đang theo dõi. Thêm thư mục cấu hình ở tab Tài khoản.',
    en: 'None of the tracked directories has a session yet. Add a config directory in the Accounts tab.',
  },
  noMatch: { vi: 'Không có phiên nào khớp bộ lọc', en: 'No sessions match the filter' },
  noUsage: { vi: 'Không có mức dùng trong khoảng này', en: 'No usage in this range' },
  manageAccounts: { vi: 'Quản lý tài khoản', en: 'Manage accounts' },

  // Status
  statusWorking: { vi: 'đang chạy', en: 'working' },
  statusWaiting: { vi: 'chờ bạn', en: 'needs you' },
  statusIdle: { vi: 'rảnh', en: 'idle' },
  statusEnded: { vi: 'đã đóng', en: 'ended' },
  filterAll: { vi: 'Tất cả', en: 'All' },
  filterRunning: { vi: 'Đang mở', en: 'Running' },
  filterEnded: { vi: 'Đã đóng', en: 'Ended' },
  statusFilter: { vi: 'Lọc theo trạng thái', en: 'Filter by status' },

  // Stats
  statRunning: { vi: 'Phiên đang mở', en: 'Running sessions' },
  statRunningSub: { vi: '{{working}} đang chạy · {{waiting}} chờ bạn', en: '{{working}} working · {{waiting}} need you' },
  statTokens: { vi: 'Token', en: 'Tokens' },
  statTokensSub: { vi: '{{requests}} lượt gọi', en: '{{requests}} requests' },
  statCost: { vi: 'Chi phí ước tính', en: 'Estimated cost' },
  statCostSub: { vi: 'theo giá API', en: 'at API list prices' },
  statWindow: { vi: '5 giờ gần nhất', en: 'Last 5 hours' },
  statWindowSub: { vi: '{{cost}} · {{requests}} lượt gọi', en: '{{cost}} · {{requests}} requests' },
  statInput: { vi: 'Đầu vào', en: 'Input' },
  statOutput: { vi: 'Đầu ra', en: 'Output' },
  statCacheWrite: { vi: 'Ghi cache', en: 'Cache write' },
  statCacheRead: { vi: 'Đọc cache', en: 'Cache read' },

  // Sections
  runningNow: { vi: 'Đang mở', en: 'Running now' },
  nothingRunning: { vi: 'Không có phiên Claude Code nào đang mở.', en: 'No Claude Code session is running.' },
  recentSessions: { vi: 'Gần đây', en: 'Recent' },
  byAccount: { vi: 'Theo tài khoản', en: 'By account' },
  byDay: { vi: 'Theo ngày', en: 'By day' },
  byModel: { vi: 'Theo model', en: 'By model' },
  byProject: { vi: 'Theo dự án', en: 'By project' },
  costNote: {
    vi: 'Chi phí là ước tính theo bảng giá API của Anthropic. Gói thuê bao (Pro / Max / Team) không tính tiền theo token — dùng con số này để so sánh giữa các phiên và tài khoản.',
    en: 'Cost is an estimate at Anthropic API list prices. Subscription plans (Pro / Max / Team) are not billed per token — use the figure to compare sessions and accounts.',
  },
  unpricedNote: {
    vi: '{{count}} lượt gọi dùng model chưa có trong bảng giá nên không tính vào chi phí.',
    en: '{{count}} requests used a model with no known price and are left out of the cost.',
  },

  // Columns
  colSession: { vi: 'Phiên', en: 'Session' },
  colProject: { vi: 'Dự án', en: 'Project' },
  colAccount: { vi: 'Tài khoản', en: 'Account' },
  colModel: { vi: 'Model', en: 'Model' },
  colActivity: { vi: 'Hoạt động', en: 'Last active' },
  colTokens: { vi: 'Token', en: 'Tokens' },
  colCost: { vi: 'Chi phí', en: 'Cost' },
  colRequests: { vi: 'Lượt gọi', en: 'Requests' },
  colDay: { vi: 'Ngày', en: 'Day' },
  colShare: { vi: 'Tỷ trọng', en: 'Share' },
  colDirectory: { vi: 'Thư mục cấu hình', en: 'Config directory' },
  colSignedIn: { vi: 'Đăng nhập', en: 'Signed in as' },
  colSessions: { vi: 'Phiên', en: 'Sessions' },

  // Session row
  untitled: { vi: '(chưa có tiêu đề)', en: '(untitled)' },
  searchSessions: { vi: 'Tìm theo tiêu đề, dự án, nhánh…', en: 'Search title, project, branch…' },
  copyResume: { vi: 'Chép lệnh mở lại phiên', en: 'Copy resume command' },
  copyLaunch: { vi: 'Chép lệnh chạy Claude bằng tài khoản này', en: 'Copy command to start Claude with this account' },
  subagents: { vi: '{{count}} agent con', en: '{{count}} subagents' },
  prompts: { vi: '{{count}} lời nhắc', en: '{{count}} prompts' },
  pid: { vi: 'PID {{pid}}', en: 'PID {{pid}}' },
  justNow: { vi: 'vừa xong', en: 'just now' },
  minutesAgo: { vi: '{{n}} phút trước', en: '{{n}}m ago' },
  hoursAgo: { vi: '{{n}} giờ trước', en: '{{n}}h ago' },
  daysAgo: { vi: '{{n}} ngày trước', en: '{{n}}d ago' },
  showMore: { vi: 'Hiện thêm {{count}}', en: 'Show {{count}} more' },

  // Accounts
  accountsIntro: {
    vi: 'Mỗi tài khoản là một thư mục cấu hình Claude Code. Để dùng tài khoản thứ hai, chạy Claude với CLAUDE_CONFIG_DIR trỏ tới một thư mục khác rồi đăng nhập ở đó.',
    en: 'Each account is one Claude Code config directory. To use a second account, start Claude with CLAUDE_CONFIG_DIR pointing at another directory and sign in there.',
  },
  notSignedIn: { vi: 'chưa đăng nhập', en: 'not signed in' },
  dirMissing: { vi: 'không thấy thư mục', en: 'directory not found' },
  addAccount: { vi: 'Thêm tài khoản', en: 'Add account' },
  detect: { vi: 'Tự tìm', en: 'Detect' },
  detectHint: { vi: 'Tìm ~/.claude và ~/.claude-* có dữ liệu phiên', en: 'Look for ~/.claude and ~/.claude-* that hold session data' },
  detectedNone: { vi: 'Không tìm thấy thư mục mới.', en: 'No new directory found.' },
  detectedSome: { vi: 'Đã thêm {{count}} thư mục.', en: 'Added {{count}} directories.' },
  labelField: { vi: 'Tên gọi', en: 'Label' },
  labelPlaceholder: { vi: 'Công việc', en: 'Work' },
  dirField: { vi: 'Thư mục cấu hình', en: 'Config directory' },
  dirPlaceholder: { vi: '~/.claude-work', en: '~/.claude-work' },
  add: { vi: 'Thêm', en: 'Add' },
  duplicateDir: { vi: 'Thư mục này đã được theo dõi.', en: 'This directory is already tracked.' },
  remove: { vi: 'Bỏ theo dõi', en: 'Stop tracking' },
  removeTitle: { vi: 'Bỏ theo dõi "{{label}}"?', en: 'Stop tracking "{{label}}"?' },
  removeBody: {
    vi: 'Chỉ gỡ khỏi danh sách trong DevTool. Thư mục, phiên và đăng nhập Claude Code không bị đụng tới.',
    en: 'This only removes it from the list in DevTool. The directory, its sessions and the Claude Code sign-in are left untouched.',
  },
});
