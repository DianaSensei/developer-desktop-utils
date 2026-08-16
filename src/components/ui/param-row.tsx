// Dòng tham số — công thức BỐN TẦNG, học từ Sony Color Lab.
//
//   Poll interval  ?      500ms     [mặc định]    Bao lâu client hỏi broker một lần
//   └─ nhãn + help        └─ giá trị └─ tag       └─ câu giải thích
//
// Ba điều làm nên công thức này, và cả ba đều dễ bị bỏ:
//
//   1. GIÁ TRỊ canh phải, chữ đơn cách, tabular-nums → người dùng quét được cột
//      số. Nhãn canh trái, giá trị canh phải, không trộn.
//   2. TAG phân loại tối đa HAI loại trong một danh sách (mặc định / đã đổi).
//      Ba loại trở lên thì tag hết phân loại được gì — đó là lý do `tag` chỉ
//      nhận một chuỗi ngắn, không nhận mảng.
//   3. CÂU GIẢI THÍCH luôn hiện, không giấu sau tooltip. Đây là thứ DevTool
//      thiếu nhất: 24 tool đầy tham số mà không nói tham số đó làm gì. `help`
//      chỉ dành cho phần sâu hơn câu giải thích một tầng.

import * as React from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';

export interface ParamRowProps {
  label: React.ReactNode;
  /** Nội dung cho dấu `?` — chỉ dùng cho phần SÂU HƠN `children`, không lặp lại nó. */
  help?: string;
  /** Giá trị hiện tại. Canh phải, chữ đơn cách, có trọng lượng. */
  value: React.ReactNode;
  /** Một tag phân loại ngắn: "mặc định", "đã đổi", "bắt buộc". Tối đa hai loại/danh sách. */
  tag?: string;
  /** Tag nhấn mạnh (đã đổi khỏi mặc định) thay vì tag im lặng. */
  tagActive?: boolean;
  /** Câu giải thích — LUÔN hiện. Đây là lý do component này tồn tại. */
  children?: React.ReactNode;
  className?: string;
}

export function ParamRow({
  label,
  help,
  value,
  tag,
  tagActive,
  children,
  className,
}: ParamRowProps) {
  return (
    <div className={cn('border-b border-line-soft py-2.5 last:border-b-0', className)}>
      <div className="flex items-baseline gap-3">
        <span className="flex min-w-0 items-center gap-1 text-[13px] font-medium">
          <span className="truncate">{label}</span>
          {help && (
            // Icon chứ không phải chữ "?" trong vòng tròn: một glyph cỡ 9–10px
            // là chữ không đọc được, mà luật cấm chữ dưới 11px.
            <Tooltip label={help} side="top">
              <span
                tabIndex={0}
                role="button"
                aria-label="Giải thích thêm"
                className={cn(
                  'shrink-0 cursor-help text-fg-mute/70',
                  'transition-colors hover:text-fg-mute',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                )}
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </span>
            </Tooltip>
          )}
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-2">
          {tag && (
            <span
              className={cn(
                'rounded-xs px-1.5 py-0.5 text-[11px] leading-none',
                tagActive
                  ? 'bg-acc-tint text-acc-ink'
                  : 'bg-muted text-fg-mute',
              )}
            >
              {tag}
            </span>
          )}
          <span className="font-mono text-[13px] font-semibold tabular-nums">{value}</span>
        </span>
      </div>

      {children && (
        <p className="mt-0.5 pr-1 text-[12.5px] leading-snug text-fg-mute">
          {children}
        </p>
      )}
    </div>
  );
}
