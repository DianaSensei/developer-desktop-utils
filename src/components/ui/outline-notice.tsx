// Thông báo viền — bậc GIỮA trong ba bậc trạng thái.
//
//   <StatusChip>     liếc là thấy, không giải thích
//   <OutlineNotice>  việc đang chờ xử lý, kèm một hành động   ← đây
//   <ExplainBand>    cần giải thích và cho ví dụ sửa được
//
// Chỉ có VIỀN, không nền. Đó là toàn bộ điểm khác biệt: nó đủ rõ để không bị bỏ
// qua, nhưng không tô một mảng màu vào giữa panel cho một việc không khẩn cấp.
// Học từ MoMo — thẻ "Chia/Trả tiền · Đang chờ" viền cam, nền trong suốt.
//
// Dùng cho trạng thái THƯỜNG TRỰC còn treo: consumer chưa đóng, bản nháp chưa
// lưu, kết nối mất từ phiên trước. Không dùng cho lỗi vừa xảy ra — cái đó là
// <ExplainBand tone="bad">.

import * as React from 'react';
import { cn } from '@/lib/utils';

export type OutlineNoticeTone = 'warn' | 'bad' | 'info' | 'ok';

const TONE: Record<OutlineNoticeTone, { edge: string; label: string; pip: string }> = {
  warn: { edge: 'border-warn-edge', label: 'text-warn', pip: 'bg-warn' },
  bad: { edge: 'border-bad-edge', label: 'text-bad', pip: 'bg-bad' },
  info: { edge: 'border-info-edge', label: 'text-info', pip: 'bg-info' },
  ok: { edge: 'border-ok-edge', label: 'text-ok', pip: 'bg-ok' },
};

export interface OutlineNoticeProps {
  tone: OutlineNoticeTone;
  /** Nhãn trạng thái ngắn — "Đang chờ", "Chưa lưu". */
  label?: React.ReactNode;
  children: React.ReactNode;
  /** Hành động ở mép phải — thường là một <Button variant="ghost" size="sm">. */
  action?: React.ReactNode;
  className?: string;
}

export function OutlineNotice({
  tone,
  label,
  children,
  action,
  className,
}: OutlineNoticeProps) {
  const t = TONE[tone];
  return (
    <div
      role="status"
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md border bg-transparent px-3 py-2',
        t.edge,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', t.pip)} />
      <p className="min-w-0 flex-1 text-[13px] leading-snug">
        {label && <span className={cn('font-medium', t.label)}>{label} · </span>}
        {children}
      </p>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
