import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label?: React.ReactNode;
  icon?: LucideIcon;
  title?: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

/**
 * Pill / segmented toggle — the canonical mode-switch control for tools.
 *
 * ── Vì sao mục đang chọn là NỀN ĐẶC màu accent ──────────────────────────────
 * Bản trước dùng thẻ trắng (`bg-card`) trên nền xám nhạt (`bg-bg-2`). Trong
 * bảng màu mới hai màu đó gần nhau, nên tương phản gần bằng không — nhìn không
 * ra đang chọn cái nào. Nền đặc + chữ nghịch đảo thì không thể nhầm được, ở cả
 * light lẫn dark, ở cả bốn tone accent.
 *
 * ── Máng lõm ────────────────────────────────────────────────────────────────
 * Máng dùng `bg-sunk` + bóng inset để đọc ra là một RÃNH mà con trượt chạy
 * trong đó. Nếu máng phẳng ngang mặt nền, mục đang chọn trông như một nút rời
 * bay lơ lửng chứ không phải một lựa chọn trong nhóm.
 */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = 'md',
  className,
  ...props
}: SegmentedProps<T>) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(0, options.findIndex((o) => o.value === value));

  /**
   * `role="tablist"` HỨA điều hướng bằng mũi tên; trước đây component không cài
   * gì cả nên mỗi segment là một tab-stop riêng — trái hẳn với kỳ vọng của
   * trình đọc màn hình. Giờ chỉ mục đang chọn nhận Tab (roving tabindex), còn
   * mũi tên/Home/End di chuyển giữa các mục.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const last = options.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = activeIndex === last ? 0 : activeIndex + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = activeIndex === 0 ? last : activeIndex - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    onValueChange(options[next].value);
    refs.current[next]?.focus();
  }

  const trackH = size === 'sm' ? 'h-ctl' : 'h-ctl';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <div
      role="tablist"
      aria-label={props['aria-label']}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-sm border border-line bg-sunk p-0.5',
        'shadow-[inset_0_1px_2px_hsl(var(--fg-c)/0.05)]',
        trackH,
        className
      )}
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            title={opt.title}
            onClick={() => onValueChange(opt.value)}
            onKeyDown={onKeyDown}
            className={cn(
              'inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xs px-3',
              'transition-[color,background-color,box-shadow] duration-200 ease-out',
              // Vòng focus vẽ VÀO TRONG (offset âm) để không bị máng cắt mất —
              // trước đây component không có focus-visible nào, người dùng bàn
              // phím không thấy mình đang ở đâu.
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acc focus-visible:ring-offset-0',
              textSize,
              active
                ? 'bg-acc font-semibold text-acc-fg shadow-soft'
                : 'font-medium text-fg-mute hover:text-fg'
            )}
          >
            {Icon && <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
