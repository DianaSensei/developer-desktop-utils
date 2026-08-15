// Chip trạng thái — bậc NHẸ NHẤT trong ba bậc của hệ (chip → viền → dải nhuộm).
//
// Chỗ đứng của nó là thanh tiêu đề panel: liếc một cái là biết panel đang ở
// trạng thái nào, không cần đọc. Không giải thích gì — cần giải thích thì dùng
// <ExplainBand>.
//
// Vì sao không dùng <Badge tone="success">: Badge là nhãn đa dụng (phương thức
// HTTP, số đếm, "beta"). Chip trạng thái có một việc duy nhất và luôn kèm chấm
// tròn, nên nó là component riêng — đọc code thấy StatusChip là biết ngay đang
// nói về trạng thái, không phải phân loại.
//
// Màu lấy từ hệ trạng thái cố định, KHÔNG theo accent: đổi tone chủ đạo của app
// không được làm "Hợp lệ" đổi màu. Xem design/RULES.md.

import * as React from 'react';
import { cn } from '@/lib/utils';

export type StatusChipTone = 'ok' | 'warn' | 'bad' | 'info' | 'idle';

const TONE: Record<StatusChipTone, { chip: string; pip: string }> = {
  ok: { chip: 'bg-ok-tint text-ok border-ok-edge', pip: 'bg-ok' },
  warn: { chip: 'bg-warn-tint text-warn border-warn-edge', pip: 'bg-warn' },
  bad: { chip: 'bg-bad-tint text-bad border-bad-edge', pip: 'bg-bad' },
  info: { chip: 'bg-info-tint text-info border-info-edge', pip: 'bg-info' },
  idle: {
    chip: 'bg-muted/60 text-muted-foreground border-border',
    pip: 'bg-muted-foreground/50',
  },
};

export interface StatusChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: StatusChipTone;
  /** Ẩn chấm tròn khi đã có icon riêng ở bên trái. */
  hidePip?: boolean;
  children: React.ReactNode;
}

export function StatusChip({ tone, hidePip, className, children, ...props }: StatusChipProps) {
  const t = TONE[tone];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border',
        'px-2 py-[3px] text-[11px] font-medium leading-none',
        t.chip,
        className,
      )}
      {...props}
    >
      {!hidePip && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', t.pip)} />}
      {children}
    </span>
  );
}
