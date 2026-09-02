import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Ô tick dùng chung.
 *
 * Trước đây không có component nào cho việc này, nên mỗi chỗ cần một ô tick lại
 * tự dựng lại: `KeysListView.RowCheckbox`, hàng request trong `RunnerDialog`,
 * các nút bật/tắt trong `LuckyWheel`… Cả ba đều viết cùng một kiểu
 * `{checked && <Check />}` — nghĩa là cái tick BẬT RA đứt đoạn, không có lấy
 * một khung hình chuyển tiếp, trong khi cái hộp quanh nó lại có
 * `transition-colors`. Nửa nọ nửa kia như vậy đọc ra tệ hơn là không có gì.
 *
 * ── Nét tick tự vẽ ──────────────────────────────────────────────────────────
 * Ở đây tick được VẼ: `stroke-dasharray` bằng đúng chiều dài đường path, rồi
 * kéo `stroke-dashoffset` từ hết về 0 trong `--dur-fast`. Vì sao không fade —
 * một cái tick mờ dần vào chỗ trống trông như nó vốn đã ở đó và chỉ đang hiện
 * lên; một nét được kéo từ trái sang phải đọc đúng nghĩa "vừa mới xong", tức
 * là chính việc người dùng vừa làm. Chỉ tốn một keyframe và không tốn layout.
 *
 * Hộp lún 0.9 lúc nhấn (`--dur-press`) và nền vào trong `--dur-fast`, nên trạng
 * thái mới đọc được ngay còn nét tick kể lại sau — cùng thứ tự với `Switch`.
 *
 * Khi người dùng bật "giảm chuyển động", chốt chặn toàn cục trong
 * `design/tokens.css` rút animation về 0.01ms: tick hiện ngay, không mất thông
 * tin nào.
 */
export interface CheckboxProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** `sm` (14px) cho ô tick trong hàng danh sách dày; `md` (16px) mặc định. */
  size?: 'sm' | 'md';
  /** Trạng thái "một phần" cho ô tick ở đầu cột — vẽ vạch ngang thay cho tick. */
  indeterminate?: boolean;
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ checked, onCheckedChange, size = 'md', indeterminate, className, onClick, disabled, ...props }, ref) => {
    const on = checked || indeterminate;
    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={indeterminate ? 'mixed' : checked}
        disabled={disabled}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) onCheckedChange?.(!checked);
        }}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-sm border',
          'transition-[background-color,border-color,transform] duration-fast ease-out-soft',
          'motion-safe:active:scale-90 motion-safe:active:duration-press',
          'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
          'disabled:pointer-events-none disabled:opacity-50',
          size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4',
          on ? 'border-acc bg-acc text-acc-fg' : 'border-sunk hover:border-line',
          className,
        )}
        {...props}
      >
        {on && (
          <svg
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'}
            /* Chiều dài path, để keyframe `tick-draw` biết kéo từ đâu. Vạch
               "một phần" ngắn hơn nên nét của nó cũng phải nhanh tương ứng. */
            style={{ ['--tick-len' as string]: indeterminate ? 8 : 16 }}
          >
            <path
              d={indeterminate ? 'M4 8h8' : 'M3.5 8.5l3 3 6-6.5'}
              stroke="currentColor"
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={indeterminate ? 8 : 16}
              className="motion-safe:animate-tick-draw"
            />
          </svg>
        )}
      </button>
    );
  },
);
Checkbox.displayName = 'Checkbox';
