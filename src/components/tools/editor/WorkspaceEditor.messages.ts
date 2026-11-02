import { defineMessages } from '@/lib/i18n';

export default defineMessages({
  // Explorer
  explorer: { vi: 'Thư mục', en: 'Explorer' },
  openFolder: { vi: 'Mở thư mục…', en: 'Open Folder…' },
  newFile: { vi: 'File mới…', en: 'New File…' },
  newFolder: { vi: 'Thư mục mới…', en: 'New Folder…' },
  refresh: { vi: 'Làm mới', en: 'Refresh' },
  collapseAll: { vi: 'Thu gọn tất cả', en: 'Collapse All' },
  noFolder: { vi: 'Chưa mở thư mục nào', en: 'No folder opened' },
  noFolderHint: {
    vi: 'Mở một thư mục để duyệt và sửa các file bên trong. Ứng dụng chỉ đụng tới thư mục bạn chọn.',
    en: 'Open a folder to browse and edit the files in it. The app only touches folders you choose.',
  },
  recent: { vi: 'Gần đây', en: 'Recent' },
  forget: { vi: 'Xoá khỏi danh sách gần đây', en: 'Remove from Recent' },
  removeFolder: { vi: 'Đóng thư mục khỏi workspace', en: 'Remove Folder from Workspace' },
  rename: { vi: 'Đổi tên…', en: 'Rename…' },
  delete: { vi: 'Xoá', en: 'Delete' },
  copyPath: { vi: 'Sao chép đường dẫn', en: 'Copy Path' },
  copyRelativePath: { vi: 'Sao chép đường dẫn tương đối', en: 'Copy Relative Path' },
  cut: { vi: 'Cắt', en: 'Cut' },
  paste: { vi: 'Dán vào đây', en: 'Paste' },
  open: { vi: 'Mở', en: 'Open' },
  emptyDir: { vi: 'Thư mục trống', en: 'Empty folder' },
  truncated: { vi: 'Chỉ hiện {{n}} mục đầu tiên', en: 'Showing the first {{n}} items' },
  newFilePlaceholder: { vi: 'Tên file — dùng / để tạo thư mục con', en: 'File name — use / for subfolders' },
  newFolderPlaceholder: { vi: 'Tên thư mục', en: 'Folder name' },
  pathCopied: { vi: 'Đã sao chép đường dẫn', en: 'Path copied' },
  symlink: { vi: 'Liên kết tượng trưng', en: 'Symbolic link' },

  openFile: { vi: 'Mở file…', en: 'Open File…' },

  // Untitled tabs & recently closed
  newTextFile: { vi: 'Tab mới', en: 'New Text File' },
  saveAs: { vi: 'Lưu thành…', en: 'Save As…' },
  recentlyClosed: { vi: 'Đã đóng gần đây', en: 'Recently Closed' },
  reopenLast: { vi: 'Mở lại tab vừa đóng', en: 'Reopen Closed Tab' },
  restore: { vi: 'Khôi phục', en: 'Restore' },
  clearClosed: { vi: 'Xoá danh sách', en: 'Clear List' },
  discard: { vi: 'Bỏ hẳn', en: 'Discard' },
  closedUntitledNotice: {
    vi: 'Đã đóng "{{name}}" — nội dung vẫn được giữ trong "Đã đóng gần đây".',
    en: 'Closed "{{name}}" — its text is kept under Recently Closed.',
  },
  untitledHint: {
    vi: 'Chưa lưu thành file — nội dung được tự động giữ lại',
    en: 'Not saved to a file — the text is kept automatically',
  },
  closedFile: { vi: 'file', en: 'file' },
  closedText: { vi: 'văn bản', en: 'text' },

  // Delete confirmation
  deleteTitle: { vi: 'Xoá "{{name}}"?', en: 'Delete "{{name}}"?' },
  deleteFileDesc: {
    vi: 'File sẽ bị xoá vĩnh viễn khỏi ổ đĩa (không vào Thùng rác). Không thể hoàn tác.',
    en: 'The file is permanently deleted from disk (not moved to the Trash). This cannot be undone.',
  },
  deleteFolderDesc: {
    vi: 'Thư mục và mọi thứ bên trong sẽ bị xoá vĩnh viễn khỏi ổ đĩa (không vào Thùng rác). Không thể hoàn tác.',
    en: 'The folder and everything in it are permanently deleted from disk (not moved to the Trash). This cannot be undone.',
  },
  deleteUnsaved: { vi: 'Thay đổi chưa lưu trong các tab đang mở cũng sẽ mất.', en: 'Unsaved changes in open tabs are lost too.' },

  // Tabs
  close: { vi: 'Đóng', en: 'Close' },
  closeOthers: { vi: 'Đóng các tab khác', en: 'Close Others' },
  closeRight: { vi: 'Đóng các tab bên phải', en: 'Close to the Right' },
  closeSaved: { vi: 'Đóng các tab đã lưu', en: 'Close Saved' },
  closeAll: { vi: 'Đóng tất cả', en: 'Close All' },
  revealInExplorer: { vi: 'Hiện trong cây thư mục', en: 'Reveal in Explorer' },
  unsaved: { vi: 'Chưa lưu', en: 'Unsaved' },

  // Unsaved-changes prompt
  saveChangesTitle: { vi: 'Lưu thay đổi trong "{{name}}"?', en: 'Save changes to "{{name}}"?' },
  saveChangesManyTitle: { vi: 'Lưu thay đổi trong {{n}} file?', en: 'Save changes to {{n}} files?' },
  saveChangesDesc: { vi: 'Nếu không lưu, các thay đổi sẽ mất.', en: "Your changes will be lost if you don't save them." },
  save: { vi: 'Lưu', en: 'Save' },
  saveAll: { vi: 'Lưu tất cả', en: 'Save All' },
  dontSave: { vi: 'Không lưu', en: "Don't Save" },
  cancel: { vi: 'Huỷ', en: 'Cancel' },

  // Save conflict
  conflictTitle: { vi: 'File đã đổi trên ổ đĩa', en: 'File changed on disk' },
  conflictDesc: {
    vi: '"{{name}}" đã bị chương trình khác sửa sau khi bạn mở. Ghi đè sẽ làm mất thay đổi đó.',
    en: '"{{name}}" was modified by another program after you opened it. Overwriting discards that change.',
  },
  overwrite: { vi: 'Ghi đè', en: 'Overwrite' },
  discardReload: { vi: 'Bỏ bản của tôi & tải lại', en: 'Discard Mine & Reload' },

  // Banners
  changedOnDisk: {
    vi: 'File này đã đổi trên ổ đĩa trong khi bạn có thay đổi chưa lưu.',
    en: 'This file changed on disk while you have unsaved changes.',
  },
  deletedOnDisk: { vi: 'File này đã bị xoá trên ổ đĩa. Lưu để tạo lại.', en: 'This file was deleted on disk. Save to recreate it.' },
  reload: { vi: 'Tải lại', en: 'Reload' },
  keepMine: { vi: 'Giữ bản của tôi', en: 'Keep Mine' },
  dismiss: { vi: 'Đóng', en: 'Dismiss' },
  webDemo: {
    vi: 'Bản xem trên trình duyệt: workspace mẫu này nằm trong bộ nhớ. Mở ứng dụng desktop để sửa file thật trên ổ đĩa.',
    en: 'Browser preview: this demo workspace lives in memory. Open the desktop app to edit files on disk.',
  },

  // Editor area
  noEditor: { vi: 'Chưa mở file nào', en: 'No file open' },
  shortcutQuickOpen: { vi: 'Mở nhanh file', en: 'Go to File' },
  shortcutSave: { vi: 'Lưu', en: 'Save' },
  shortcutSaveAll: { vi: 'Lưu tất cả', en: 'Save All' },
  shortcutClose: { vi: 'Đóng tab', en: 'Close Tab' },
  shortcutFind: { vi: 'Tìm / thay thế trong file', en: 'Find / Replace in File' },
  shortcutWrap: { vi: 'Bật/tắt xuống dòng', en: 'Toggle Word Wrap' },
  shortcutNewFile: { vi: 'Tab mới (không cần chọn nơi lưu)', en: 'New Text File (no location needed)' },
  shortcutSaveAs: { vi: 'Lưu thành…', en: 'Save As…' },
  shortcutReopen: { vi: 'Mở lại tab vừa đóng', en: 'Reopen Closed Tab' },
  binary: {
    vi: 'File này là nhị phân hoặc không phải văn bản UTF-8 nên không hiển thị.',
    en: 'This file is binary or not UTF-8 text, so it is not shown.',
  },
  loadFailed: { vi: 'Không mở được file', en: 'Could not open the file' },
  retry: { vi: 'Thử lại', en: 'Retry' },
  loading: { vi: 'Đang tải…', en: 'Loading…' },

  // Status bar
  lnCol: { vi: 'Dòng {{line}}, Cột {{col}}', en: 'Ln {{line}}, Col {{col}}' },
  selected: { vi: '({{n}} đã chọn)', en: '({{n}} selected)' },
  plainText: { vi: 'Văn bản thuần', en: 'Plain Text' },
  utf8: { vi: 'UTF-8', en: 'UTF-8' },
  utf8Bom: { vi: 'UTF-8 có BOM', en: 'UTF-8 with BOM' },
  wrapOn: { vi: 'Xuống dòng: bật', en: 'Wrap: on' },
  wrapOff: { vi: 'Xuống dòng: tắt', en: 'Wrap: off' },
  saving: { vi: 'Đang lưu…', en: 'Saving…' },

  // Quick Open
  quickOpenTitle: { vi: 'Mở nhanh file', en: 'Go to File' },
  quickOpenPlaceholder: { vi: 'Gõ tên file…', en: 'Search files by name…' },
  quickOpenEmpty: { vi: 'Không có file nào khớp', en: 'No matching files' },
  quickOpenNoFolder: { vi: 'Mở một thư mục trước', en: 'Open a folder first' },
  quickOpenIndexing: { vi: 'Đang liệt kê file…', en: 'Listing files…' },
  quickOpenTruncated: {
    vi: 'Workspace lớn: chỉ liệt kê một phần file (bỏ qua node_modules, .git, target…)',
    en: 'Large workspace: only part of the files are listed (node_modules, .git, target… are skipped)',
  },

  // Errors by FsError code
  'err.denied': {
    vi: 'Đường dẫn nằm ngoài các thư mục đã mở. Hãy mở thư mục chứa nó trước.',
    en: 'That path is outside the opened folders. Open its folder first.',
  },
  'err.not_found': { vi: 'Không tìm thấy — có thể đã bị xoá hoặc di chuyển.', en: 'Not found — it may have been deleted or moved.' },
  'err.exists': { vi: 'Đã có file hoặc thư mục trùng tên.', en: 'A file or folder with that name already exists.' },
  'err.too_large': { vi: 'File quá lớn để mở trong editor (giới hạn 10 MB).', en: 'The file is too large to open in the editor (10 MB limit).' },
  'err.invalid_name': { vi: 'Tên không hợp lệ.', en: 'That name is not valid.' },
  'err.root': { vi: 'Không thể đổi tên hoặc xoá thư mục gốc của workspace.', en: 'A workspace folder cannot be renamed or deleted from the tree.' },
  'err.invalid_move': { vi: 'Không thể di chuyển thư mục vào chính nó.', en: 'A folder cannot be moved into itself.' },
  'err.permission': { vi: 'Hệ điều hành từ chối quyền truy cập.', en: 'The operating system denied access.' },
});
