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
  netHint_dns: { vi: 'Không tìm thấy tên miền (DNS). Kiểm tra lại địa chỉ, hoặc mạng/VPN đang dùng.', en: 'The host name could not be found (DNS). Check the address, or your network/VPN.' },
  netHint_refused: { vi: 'Server từ chối kết nối — không có gì đang nghe ở cổng này. Server đã chạy chưa, đúng cổng chưa?', en: 'The connection was refused — nothing is listening on that port. Is the server running, on the right port?' },
  netHint_timeout: { vi: 'Hết thời gian chờ. Server chậm hoặc không trả lời; thử lại hoặc kiểm tra firewall/VPN.', en: 'The request timed out. The server is slow or not answering; retry or check a firewall/VPN.' },
  netHint_unreachable: { vi: 'Không kết nối được tới server. Kiểm tra địa chỉ, kết nối mạng, proxy/VPN.', en: 'Could not reach the server. Check the address, your connection, and any proxy/VPN.' },
});
