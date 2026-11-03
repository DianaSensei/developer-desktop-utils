import { defineMessages } from '@/lib/i18n';

/** App-wide reminder toasts (reminders.tsx). */
export default defineMessages({
  region: { vi: 'Nhắc việc', en: 'Reminders' },
  badgeOverdue: { vi: '{{n}} việc quá hạn', en: '{{n}} overdue' },
  badgeToday: { vi: '{{n}} việc hạn hôm nay', en: '{{n}} due today' },
  taskReminder: { vi: 'Nhắc task', en: 'Task reminder' },
  meetingSoon: { vi: 'Họp sau {{n}} phút', en: 'Meeting in {{n}} min' },
  meetingNow: { vi: 'Cuộc họp đang bắt đầu', en: 'Meeting starting now' },
  meetingNotify: { vi: 'Họp lúc {{time}}', en: 'Meeting at {{time}}' },
  untitledMeeting: { vi: 'Cuộc họp chưa đặt tên', en: 'Untitled meeting' },
  markDone: { vi: 'Xong', en: 'Done' },
  open: { vi: 'Mở', en: 'Open' },
  snooze: { vi: 'Báo lại', en: 'Snooze' },
  snooze10: { vi: 'Sau 10 phút', en: 'In 10 minutes' },
  snooze60: { vi: 'Sau 1 giờ', en: 'In 1 hour' },
  snoozeTomorrow: { vi: 'Sáng mai 9:00', en: 'Tomorrow 9:00' },
  dismiss: { vi: 'Bỏ qua', en: 'Dismiss' },
  more: { vi: '+{{n}} nhắc việc nữa', en: '+{{n}} more reminders' },
  dismissAll: { vi: 'Bỏ qua tất cả', en: 'Dismiss all' },
});
