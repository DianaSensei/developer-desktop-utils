import { defineMessages } from '@/lib/i18n';

/**
 * Từ dùng lại ở nhiều tool — nhãn pane, nút chung. Thuật ngữ kỹ thuật mà dân
 * dev Việt vẫn nói bằng tiếng Anh (JSON, token, header, payload, regex…) được
 * GIỮ NGUYÊN trong bản VI ở mọi từ điển tool: dịch "token" thành "mã thông
 * báo" làm người đọc phải dịch ngược lại trong đầu.
 *
 * Phạm vi: dịch CHỮ CỦA GIAO DIỆN. Chẩn đoán sinh ra từ engine (lỗi parser
 * JSON, lỗi Web Crypto của JWT kèm lệnh openssl…) giữ tiếng Anh — cùng chuỗi
 * đó còn đi qua MCP bridge tới AI agent và được test khoá nguyên văn, và người
 * đọc sẽ dán nguyên văn đó đi tìm kiếm.
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
