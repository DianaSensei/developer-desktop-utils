import { defineMessages } from '@/lib/i18n';

export default defineMessages({
  swapDirections: { vi: 'Đảo chiều chuyển đổi', en: 'Swap directions' },
  prettyXml: { vi: 'XML có thụt lề', en: 'Pretty XML' },
  source: { vi: 'Nguồn · {{format}}', en: 'Source · {{format}}' },
  result: { vi: 'Kết quả · {{format}}', en: 'Result · {{format}}' },
  downloadResult: { vi: 'Tải kết quả xuống', en: 'Download result' },
  conversionError: { vi: 'Lỗi chuyển đổi', en: 'Conversion error' },
  outputPlaceholder: { vi: 'Kết quả chuyển đổi hiện ở đây…', en: 'Converted output appears here…' },
  tomlNeedsTable: {
    vi: 'TOML cần một bảng (object) ở gốc — dữ liệu của bạn là mảng hoặc giá trị đơn. Hãy bọc nó trong một object trước.',
    en: 'TOML output needs a top-level table — your data is an array or scalar at the root. Wrap it in an object first.',
  },
});
