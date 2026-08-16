// Phím tắt. Hai chỗ dùng:
//
//   1. Đứng một mình trong danh sách / command palette — <Keycap>⌘K</Keycap>
//   2. Nội tuyến trong nút, ngăn bằng một VẠCH MẢNH chứ không phải dấu ngoặc:
//      <Button sc="⌘⏎">Chạy</Button>  →  [ Chạy │ ⌘⏎ ]
//
// Dấu ngoặc "(⌘⏎)" đọc như chú thích và làm nhãn nút dài ra; vạch mảnh nói đúng
// điều cần nói — đây là một phần của nút, tách khỏi nhãn.
//
// `mod` tự đổi ⌘ ↔ Ctrl theo hệ điều hành, để không phải viết hai nhánh ở mọi
// chỗ gọi.

import * as React from 'react';
import { cn } from '@/lib/utils';

/** macOS dùng ⌘, còn lại dùng Ctrl. Đọc một lần lúc nạp module. */
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

export interface KeycapProps extends React.HTMLAttributes<HTMLElement> {
  /** Chèn phím lệnh của hệ điều hành vào trước — `<Keycap mod>K</Keycap>` → ⌘K / CtrlK. */
  mod?: boolean;
  /** Bản nội tuyến trong nút: thừa hưởng màu chữ, không có nền riêng. */
  inline?: boolean;
  children: React.ReactNode;
}

export function Keycap({ mod, inline, className, children, ...props }: KeycapProps) {
  const label = mod ? (
    <>
      {MOD_KEY}
      {IS_MAC ? '' : '+'}
      {children}
    </>
  ) : (
    children
  );

  return (
    <kbd
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-mono text-[11px] leading-none',
        inline
          ? // Trong nút: chỉ một vạch ngăn. `border-current` để cả vạch lẫn chữ
            // thừa hưởng màu của nút, nên nó đúng ở mọi biến thể (đặc / nhuộm /
            // viền / ghost) mà không cần bảng màu riêng. Độ mờ đặt trên cả phần
            // tử — currentColor không nhận bổ ngữ alpha ở Tailwind 3.
            'ml-2 border-l border-current pl-2 opacity-60'
          : 'rounded-xs border border-line bg-bg-2/60 px-1.5 py-1 text-fg-mute',
        className,
      )}
      {...props}
    >
      {label}
    </kbd>
  );
}
