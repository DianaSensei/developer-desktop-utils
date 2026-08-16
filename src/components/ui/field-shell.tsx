// Khung ô nhập — hiện thực QUY TẮC TỐI ĐA HAI PHỤ KIỆN.
//
//   ┌──────────────────────────────────────────────┐
//   │ [máng] │ nội dung gõ                [chỉ số] │
//   └──────────────────────────────────────────────┘
//     [chip] [chip]          ← mọi thứ khác xuống đây
//
// Không có quy tắc này, ô nhập của DevTool sẽ mọc dần: nhãn định dạng, đếm ký
// tự, nút copy, nút xoá, chỉ báo hợp lệ — cho tới khi chỗ gõ chữ còn 40%. Đó là
// hiện trạng ở vài tool.
//
// Nên khung này chỉ nhận ĐÚNG HAI khe:
//   gutter — nhãn kiểu dữ liệu bên trái ("JSON", "cron", "hex")
//   meter  — MỘT chỉ số bên phải (số ký tự, số dòng, thời gian)
//
// Cái thứ ba không có khe. Nó xuống `chips` bên dưới ô, nơi có chỗ thở.
//
// TypeScript ép luôn: `meter` là ReactNode đơn, không phải mảng.

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface FieldShellProps {
  /** Nhãn kiểu dữ liệu bên trái, trong ô. Ngắn — 3–6 ký tự. */
  gutter?: React.ReactNode;
  /** MỘT chỉ số bên phải, trong ô. Cần cái thứ hai thì cho xuống `chips`. */
  meter?: React.ReactNode;
  /** Chip dưới ô — trạng thái, gợi ý, hành động phụ. Không giới hạn. */
  chips?: React.ReactNode;
  /** Viền theo trạng thái. `undefined` = trung tính. */
  tone?: 'ok' | 'warn' | 'bad';
  /** Ô nhập thật (<Input>, <Textarea>, <InlineCodeField>…). */
  children: React.ReactNode;
  className?: string;
}

const TONE_EDGE = {
  ok: 'border-ok-edge',
  warn: 'border-warn-edge',
  bad: 'border-bad-edge',
} as const;

export function FieldShell({
  gutter,
  meter,
  chips,
  tone,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <div
        className={cn(
          'flex items-stretch overflow-hidden rounded-sm border bg-bg',
          'transition-colors focus-within:border-acc/60 focus-within:ring-2 focus-within:ring-acc/35',
          tone ? TONE_EDGE[tone] : 'border-sunk',
        )}
      >
        {gutter && (
          <span
            className={cn(
              'flex shrink-0 select-none items-center border-r border-line bg-sunk',
              'px-2.5 font-mono text-[11px] uppercase tracking-wide text-fg-mute',
            )}
          >
            {gutter}
          </span>
        )}

        {/* Ô nhập bên trong bỏ viền/bo góc/ring của chính nó — khung ngoài lo
            hết, nếu không sẽ có hai viền lồng nhau và hai vòng focus. */}
        <div
          className={cn(
            'min-w-0 flex-1',
            '[&_input]:border-0 [&_input]:bg-transparent [&_input]:shadow-none [&_input]:ring-0',
            '[&_input]:rounded-none [&_input]:focus-visible:ring-0 [&_input]:focus-visible:border-0',
            '[&_textarea]:border-0 [&_textarea]:bg-transparent [&_textarea]:shadow-none',
            '[&_textarea]:ring-0 [&_textarea]:rounded-none [&_textarea]:focus-visible:ring-0',
          )}
        >
          {children}
        </div>

        {meter && (
          <span
            className={cn(
              'flex shrink-0 select-none items-center pr-2.5',
              'font-mono text-[11px] tabular-nums text-fg-mute',
            )}
          >
            {meter}
          </span>
        )}
      </div>

      {chips && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{chips}</div>}
    </div>
  );
}
