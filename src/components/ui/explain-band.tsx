// Dải nhuộm — bậc NẶNG NHẤT trong ba bậc trạng thái, dùng khi cần GIẢI THÍCH.
//
// Điểm khác biệt so với <Callout>: dải này sống BÊN TRONG panel, ngay dưới thanh
// tiêu đề, và chỉ hiện khi có gì đáng nói. Callout là một thẻ rời — mỗi lần nó
// xuất hiện hay biến mất là layout nhảy một nhịp, và trong tool thì trạng thái
// hợp lệ ↔ lỗi đổi liên tục theo từng ký tự người dùng gõ.
//
// Hai điều bắt buộc, cả hai đều học từ Sony Color Lab:
//
//   1. Câu giải thích LUÔN hiện, không giấu sau tooltip.
//   2. Component này phải dùng được để DẠY (tone="ok") chứ không chỉ để BÁO LỖI
//      (tone="bad"). Một thứ để học, không phải hai. Ví dụ: cùng dải này giải
//      thích cron hợp lệ nghĩa là gì, và báo cron sai ở đâu.
//
// `examples` là các chip bấm được — cho người dùng sửa ngay tại chỗ thay vì
// phải tự suy ra cú pháp đúng.

import * as React from 'react';
import { cn } from '@/lib/utils';

export type ExplainBandTone = 'ok' | 'warn' | 'bad' | 'info';

const TONE: Record<ExplainBandTone, { band: string; title: string; chip: string }> = {
  ok: {
    band: 'bg-ok-tint border-ok-edge',
    title: 'text-ok',
    chip: 'border-ok-edge text-ok hover:bg-ok/10',
  },
  warn: {
    band: 'bg-warn-tint border-warn-edge',
    title: 'text-warn',
    chip: 'border-warn-edge text-warn hover:bg-warn/10',
  },
  bad: {
    band: 'bg-bad-tint border-bad-edge',
    title: 'text-bad',
    chip: 'border-bad-edge text-bad hover:bg-bad/10',
  },
  info: {
    band: 'bg-info-tint border-info-edge',
    title: 'text-info',
    chip: 'border-info-edge text-info hover:bg-info/10',
  },
};

export interface ExplainBandExample {
  label: string;
  /** Bỏ trống thì chip chỉ để đọc, không bấm được. */
  onPick?: () => void;
  title?: string;
}

export interface ExplainBandProps {
  tone: ExplainBandTone;
  /** Nhãn ngắn in đậm ở đầu — "Lỗi cú pháp", "Hợp lệ", "Sắp hết hạn". */
  title?: React.ReactNode;
  /** Câu giải thích. Luôn hiện — đây là lý do component này tồn tại. */
  children: React.ReactNode;
  /** Chip ví dụ, bấm được để áp dụng ngay. */
  examples?: ExplainBandExample[];
  className?: string;
}

export function ExplainBand({ tone, title, children, examples, className }: ExplainBandProps) {
  const t = TONE[tone];
  return (
    <div
      className={cn('rounded-md border px-3 py-2.5', t.band, className)}
      // Lỗi phải được đọc lên ngay; các tông khác chỉ cần thông báo lịch sự.
      role={tone === 'bad' ? 'alert' : 'status'}
    >
      {/* div, không phải p: một số chỗ gọi cần thêm dòng lỗi/cảnh báo phụ bên
          dưới câu giải thích chính (xem CronGenerator) — nội dung khối bên
          trong p sẽ bị trình duyệt tự đóng thẻ p sớm, làm rối DOM. */}
      <div className="text-[13px] leading-relaxed text-fg">
        {title && <span className={cn('font-semibold', t.title)}>{title} · </span>}
        {children}
      </div>
      {examples && examples.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {examples.map((ex) =>
            ex.onPick ? (
              <button
                key={ex.label}
                type="button"
                onClick={ex.onPick}
                title={ex.title}
                className={cn(
                  'rounded-xs border bg-card/60 px-2 py-1 font-mono text-[11px] leading-none',
                  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                  t.chip,
                )}
              >
                {ex.label}
              </button>
            ) : (
              <span
                key={ex.label}
                title={ex.title}
                className={cn(
                  'rounded-xs border bg-card/60 px-2 py-1 font-mono text-[11px] leading-none',
                  t.chip,
                )}
              >
                {ex.label}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}
