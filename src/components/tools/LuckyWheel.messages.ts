import { defineMessages } from '@/lib/i18n';

export default defineMessages({
  choices: { vi: 'Lựa chọn', en: 'Choices' },
  onePerLine: { vi: '— mỗi dòng một lựa chọn · {{hint}}', en: '— one per line · {{hint}}' },
  placeholder: { vi: 'Lựa chọn 1\nLựa chọn 2\nLựa chọn 3', en: 'Option 1\nOption 2\nOption 3' },
  uniqueOnly: { vi: 'Chỉ giá trị khác nhau', en: 'Unique only' },
  uniqueOnlyHint: { vi: 'Gộp các dòng trùng để mỗi giá trị chỉ có một ô', en: 'Collapse duplicate lines so each value gets one slice' },
  removeWinner: { vi: 'Bỏ người thắng', en: 'Remove winner' },
  removeWinnerHint: { vi: 'Xoá lựa chọn thắng khỏi danh sách sau mỗi lượt quay', en: 'Remove the winning choice from the list after each spin' },
  spinTime: { vi: 'Thời gian quay', en: 'Spin time' },
  spinHistory: { vi: 'Lịch sử quay', en: 'Spin history' },
  winner: { vi: 'Người thắng', en: 'Winner' },
  sortByTime: { vi: 'Sắp xếp theo thời điểm quay', en: 'Sort by spin time' },
  time: { vi: 'Thời điểm', en: 'Time' },
  noSpins: { vi: 'Chưa quay lần nào — quay bánh xe để ghi lại người thắng.', en: 'No spins yet — spin the wheel to record a winner.' },
  latestWinner: { vi: 'Người thắng gần nhất', en: 'Latest winner' },
  spinning: { vi: 'Đang quay…', en: 'Spinning…' },
  spin: { vi: 'Quay', en: 'Spin' },
  winnersToDraw: { vi: 'Số người thắng cần bốc', en: 'Number of winners to draw' },
  autoLeft: { vi: 'Tự động — còn {{n}}', en: 'Auto {{n}} left' },
  autoSpin: { vi: 'Quay tự động', en: 'Auto-spin' },
  needTwo: { vi: 'Thêm ít nhất hai lựa chọn để quay.', en: 'Add at least two choices to spin.' },
});
