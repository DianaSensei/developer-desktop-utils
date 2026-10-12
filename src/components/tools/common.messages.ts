import { defineMessages } from '@/lib/i18n';

/**
 * Strings shared across tools (pane labels, common buttons). Technical terms
 * (JSON, token, header, regex…) stay in English in the VI dictionaries. Only
 * UI text is translated; engine diagnostics stay in English because they also
 * reach MCP clients and tests match them verbatim.
 */
export default defineMessages({
  input: { vi: 'Đầu vào', en: 'Input' },
  output: { vi: 'Kết quả', en: 'Output' },
  result: { vi: 'Kết quả', en: 'Result' },
  copy: { vi: 'Sao chép', en: 'Copy' },
  copyAll: { vi: 'Sao chép tất cả', en: 'Copy all' },
  clear: { vi: 'Xoá', en: 'Clear' },
  reset: { vi: 'Đặt lại', en: 'Reset' },
  download: { vi: 'Tải xuống', en: 'Download' },
  swap: { vi: 'Đảo chiều', en: 'Swap' },
  indent: { vi: 'Thụt lề', en: 'Indent' },
  spaces: { vi: '{{n}} dấu cách', en: '{{n}} spaces' },
  tab: { vi: 'Tab', en: 'Tab' },
  generate: { vi: 'Tạo', en: 'Generate' },
  error: { vi: 'Lỗi', en: 'Error' },
  noMatches: { vi: 'Không có kết quả khớp', en: 'No matches found' },
  quickPasteMac: { vi: 'Nhấn ⌘V để dán', en: 'Press ⌘V to paste' },
  quickPasteOther: { vi: 'Nhấn Ctrl+V để dán', en: 'Press Ctrl+V to paste' },
});
