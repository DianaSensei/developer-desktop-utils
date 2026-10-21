import { defineMessages } from '@/lib/i18n';

export default defineMessages({
  text: { vi: 'Văn bản', en: 'Text' },
  modeLabel: { vi: 'Chế độ so sánh', en: 'Diff mode' },
  textHint: {
    vi: 'So sánh trực tiếp — tô đúng ký tự khác, danh sách chỗ khác theo dòng:cột, và mũi tên để chép thay đổi sang bên kia.',
    en: 'Live diff — exact changed characters highlighted, a line:column list of every change, and arrows to copy changes across.',
  },
  jsonHint: {
    vi: 'So sánh cấu trúc theo path ở dưới, kèm diff từng dòng của JSON đã định dạng.',
    en: 'Structural diff by path below, plus a synced line diff of the formatted JSON.',
  },
  noDifferences: { vi: 'Không có khác biệt', en: 'No differences' },
  swap: { vi: 'Đổi chỗ bản gốc và bản sửa', en: 'Swap original and modified' },
  showFull: { vi: 'Hiện toàn bộ văn bản', en: 'Show full text' },
  collapseUnchanged: { vi: 'Gập các dòng không đổi', en: 'Collapse unchanged lines' },
  original: { vi: 'Bản gốc', en: 'Original' },
  modified: { vi: 'Bản sửa', en: 'Modified' },
  pasteOriginalJson: { vi: 'Dán JSON gốc', en: 'Paste original JSON' },
  pasteModifiedJson: { vi: 'Dán JSON đã sửa', en: 'Paste modified JSON' },
  enterOriginal: { vi: 'Nhập văn bản gốc — {{hint}}', en: 'Enter original text — {{hint}}' },
  enterModified: { vi: 'Nhập văn bản đã sửa — {{hint}}', en: 'Enter modified text — {{hint}}' },
  structuralChanges: { vi: 'Thay đổi cấu trúc', en: 'Structural changes' },
  byPath: { vi: '— {{n}} theo path', en: '— {{n}} by path' },
  invalidJson: { vi: 'JSON không hợp lệ — {{error}}', en: 'Invalid JSON — {{error}}' },
  originalError: { vi: 'Bản gốc: {{error}}', en: 'Original: {{error}}' },
  modifiedError: { vi: 'Bản sửa: {{error}}', en: 'Modified: {{error}}' },
  tooLarge: {
    vi: 'Dữ liệu quá lớn để so sánh cấu trúc — diff từng dòng ở trên vẫn dùng được.',
    en: 'Input is too large for the structural diff — the line diff above still works.',
  },
  exactChanges: { vi: 'Chỗ khác', en: 'Exact changes' },
  changesCount: { vi: '— {{n}} chỗ', en: '— {{n}}' },
  changesCountMax: { vi: '— {{n}} chỗ đầu tiên', en: '— first {{n}}' },
  imprecise: {
    vi: 'Văn bản quá lớn để so từng ký tự trong thời gian cho phép — một số chỗ đang hiện theo khối dòng.',
    en: 'The text is too large to compare character by character in time — some changes are shown as whole blocks.',
  },
  revealChange: { vi: 'Chọn chỗ này ở cả hai bên', en: 'Select this change in both panes' },
  lineCol: { vi: 'Dòng:cột (bản gốc → bản sửa)', en: 'Line:column (original → modified)' },
  'kind.insert': { vi: 'thêm', en: 'added' },
  'kind.delete': { vi: 'xoá', en: 'removed' },
  'kind.replace': { vi: 'sửa', en: 'changed' },
  identical: {
    vi: 'Không có khác biệt — hai giá trị JSON giống hệt nhau về cấu trúc.',
    en: 'No differences — the two JSON values are structurally identical.',
  },
});
