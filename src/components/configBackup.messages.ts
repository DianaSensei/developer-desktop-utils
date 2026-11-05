import { defineMessages } from '@/lib/i18n';

export default defineMessages({
  // Settings → Backup & restore
  title: { vi: 'Sao lưu & khôi phục', en: 'Backup & restore' },
  intro: {
    vi: 'Xuất cấu hình ra file JSON để lưu lại, chuyển sang máy khác, rồi nhập để dùng lại. Có thể chọn toàn app hoặc từng tool.',
    en: 'Export settings to a JSON file to keep, move to another machine, and import to load them back — the whole app or single tools.',
  },
  exportTitle: { vi: 'Xuất ra file', en: 'Export' },
  exportHint: { vi: 'Chọn phần muốn đưa vào file.', en: 'Choose what goes into the file.' },
  appSettings: { vi: 'Cài đặt chung của app', en: 'App settings' },
  appSettingsHint: {
    vi: 'Giao diện, ngôn ngữ, font, workspace và tab, thứ tự tool, yêu thích, phím tắt',
    en: 'Theme, language, fonts, workspaces and tabs, tool order, favorites, shortcuts',
  },
  noToolData: { vi: 'Chưa tool nào có dữ liệu đã lưu.', en: 'No tool has saved data yet.' },
  selectAll: { vi: 'Chọn hết', en: 'Select all' },
  selectNone: { vi: 'Bỏ chọn', en: 'Select none' },
  entries: { vi: '{{n}} mục · {{size}}', en: 'Entries: {{n}} · {{size}}' },
  exportButton: { vi: 'Xuất ra file…', en: 'Export to file…' },
  exported: { vi: 'Đã lưu {{name}}', en: 'Saved {{name}}' },
  exportFailed: { vi: 'Không lưu được file: {{msg}}', en: 'Could not save the file: {{msg}}' },

  importTitle: { vi: 'Nhập từ file', en: 'Import' },
  importHint: {
    vi: 'Chọn file đã xuất trước đó. Bạn chọn được phần nào sẽ được nhập; app tải lại sau khi nhập.',
    en: 'Pick a file exported earlier, choose what to load, and the app reloads with it.',
  },
  pickFile: { vi: 'Chọn file…', en: 'Choose file…' },
  pickOther: { vi: 'Chọn file khác…', en: 'Choose another file…' },
  fileInfo: { vi: 'Xuất lúc {{when}}', en: 'Exported {{when}}' },
  fileInfoVersion: { vi: 'Xuất lúc {{when}} · DevTool {{version}}', en: 'Exported {{when}} · DevTool {{version}}' },
  notInstalled: { vi: 'chưa cài', en: 'not installed' },
  modeLabel: { vi: 'Cách nhập', en: 'Mode' },
  modeReplace: { vi: 'Thay thế', en: 'Replace' },
  modeMerge: { vi: 'Gộp', en: 'Merge' },
  modeReplaceHint: {
    vi: 'Mỗi tool được chọn sẽ có đúng dữ liệu trong file (dữ liệu cũ của tool đó bị thay).',
    en: 'Each chosen tool ends up with exactly the data in the file (its current data is replaced).',
  },
  modeMergeHint: {
    vi: 'Chỉ ghi đè những mục có trong file, giữ nguyên phần còn lại.',
    en: 'Only overwrites the entries in the file and keeps everything else.',
  },
  importButton: { vi: 'Nhập và tải lại', en: 'Import and reload' },
  errNotJson: { vi: 'File không phải JSON hợp lệ.', en: 'The file is not valid JSON.' },
  errWrongFormat: { vi: 'Đây không phải file cấu hình của DevTool.', en: 'This is not a DevTool settings file.' },
  errNewerVersion: {
    vi: 'File được tạo bởi bản DevTool mới hơn. Hãy cập nhật app rồi nhập lại.',
    en: 'The file was made by a newer DevTool. Update the app, then import it.',
  },
  errEmpty: { vi: 'File không có dữ liệu nào để nhập.', en: 'The file has nothing to import.' },
  errRead: { vi: 'Không đọc được file: {{msg}}', en: 'Could not read the file: {{msg}}' },

  undoTitle: { vi: 'Hoàn tác', en: 'Undo' },
  undoHint: { vi: 'Lần thay đổi gần nhất: {{label}} · {{when}}', en: 'Last change: {{label}} · {{when}}' },
  undoButton: { vi: 'Hoàn tác và tải lại', en: 'Undo and reload' },

  notIncluded: {
    vi: 'Không bao giờ có trong file: bí mật trong kho mã hoá (mã 2FA, token, mật khẩu, token Jira) và file trên ổ đĩa (thư mục mở trong Text Editor, Local History). Sau khi nhập trên máy mới, hãy nhập lại các bí mật đó.',
    en: 'Never in the file: secrets in the encrypted vault (2FA seeds, tokens, passwords, the Jira token) and files on disk (folders opened in the Text Editor, Local History). On a new machine, enter those secrets again after importing.',
  },

  // Labels stored with an import / reset (shown in the notice and Undo).
  labelAll: { vi: 'toàn bộ cài đặt', en: 'all settings' },
  labelTools: { vi: '{{n}} tool', en: '{{n}} tools' },
  labelAppAndTools: { vi: 'cài đặt chung và {{n}} tool', en: 'app settings and {{n}} tools' },
  labelReset: { vi: 'đặt lại {{tool}}', en: 'reset {{tool}}' },

  // Tool header menu
  menuLabel: { vi: 'Dữ liệu của {{tool}}', en: '{{tool}} data' },
  menuExport: { vi: 'Xuất cấu hình {{tool}}…', en: 'Export {{tool}} settings…' },
  menuImport: { vi: 'Nhập cấu hình cho {{tool}}…', en: 'Import {{tool}} settings…' },
  menuReset: { vi: 'Đặt lại dữ liệu {{tool}}…', en: 'Reset {{tool}} data…' },
  menuBackup: { vi: 'Sao lưu & khôi phục toàn app…', en: 'Back up or restore the whole app…' },
  toolNotInFile: {
    vi: 'File này không có dữ liệu của {{tool}}. Mở Settings → Sao lưu & khôi phục để xem file chứa gì.',
    en: 'This file has no {{tool}} data. Open Settings → Backup & restore to see what it contains.',
  },
  noDataToExport: { vi: '{{tool}} chưa có dữ liệu đã lưu để xuất.', en: '{{tool}} has no saved data to export yet.' },
  resetTitle: { vi: 'Đặt lại dữ liệu {{tool}}?', en: 'Reset {{tool}} data?' },
  resetBody: {
    vi: 'Xoá mọi tuỳ chọn, lịch sử và dữ liệu đã lưu của {{tool}} ({{n}} mục), rồi tải lại app. Bí mật trong kho mã hoá được giữ nguyên. Có thể hoàn tác ngay sau đó.',
    en: 'Clears every option, history entry and saved item of {{tool}} ({{n}} entries), then reloads. Secrets in the vault are kept. You can undo right after.',
  },
  resetConfirm: { vi: 'Đặt lại', en: 'Reset' },
  close: { vi: 'Đóng', en: 'Close' },

  // Notice after the reload
  noticeImport: { vi: 'Đã nhập {{label}} ({{n}} mục thay đổi).', en: 'Imported {{label}} (entries changed: {{n}}).' },
  noticeReset: { vi: 'Đã {{label}}.', en: 'Done: {{label}}.' },
  noticeUndo: { vi: 'Đã hoàn tác: {{label}}.', en: 'Undone: {{label}}.' },
  noticeUndoAction: { vi: 'Hoàn tác', en: 'Undo' },
});
