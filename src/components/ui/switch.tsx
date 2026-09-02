import * as React from 'react';
import { cn } from '@/lib/utils';

// Minimal, dependency-free toggle switch. Controlled via `checked` /
// `onCheckedChange`.
//
// The ON state is GREEN, not the accent. A switch reports state ("this is on"),
// and state colors are a separate fixed system from the swappable accent — so
// re-toning the app to a red or amber accent must not recolor every toggle.
// See design/RULES.md, "Màu theo nghĩa".
//
// ── Vì sao con trượt không chỉ "dịch sang phải" ──────────────────────────────
// Bản trước là `translate-x` phẳng trong 200ms linear-ish. Nó ĐÚNG mà TẺ, và
// tẻ ở đây có lý do vật lý: một vật thật bị hất sang đầu kia thì tăng tốc, vượt
// qua đích một chút rồi lắc về. Đường cong `--ease-spring` làm đúng việc đó, và
// nó là khác biệt lớn nhất giữa một cái toggle "có chạy" và một cái toggle đã
// tay người chỉnh.
//
// Con trượt còn BÓP NGANG lúc đang đi (`scale-x-90` giữa hành trình, qua
// `group-active`): vật bị đẩy nhanh thì biến dạng theo hướng đi. Không có nó,
// cú vọt của spring đọc ra là "vẽ sai vị trí" chứ không phải "đang lao".
//
// Máng đổi màu trong `--dur-fast`, NHANH HƠN con trượt (`--dur-base`): trạng
// thái mới (bật/tắt) phải đọc được ngay, còn con trượt là thứ kể lại chuyện đó
// vừa xảy ra như thế nào. Hai thứ khác nhịp là cố ý.
export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, disabled, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'group relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full',
        'transition-[background-color,border-color,box-shadow] duration-fast ease-out-soft',
        'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-acc/50 focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-ok' : 'bg-sunk border border-line',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm',
          'transition-transform duration-base ease-spring',
          // Bóp ngang khi ngón tay còn giữ — hết giữ thì spring trả về tròn.
          'motion-safe:group-active:scale-x-90',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  ),
);
Switch.displayName = 'Switch';
