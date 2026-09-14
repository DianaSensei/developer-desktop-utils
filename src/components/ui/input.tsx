import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        // Disable macOS/WebKit smart-quote, autocorrect, and autocapitalize
        // substitutions by default so a typed " stays a straight ASCII quote
        // (curly quotes break JSON/code). Overridable via props; no-ops on
        // Windows/Linux WebViews.
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className={cn(
          // Viền là `--line`, KHÔNG phải `--sunk`. `--sunk` là một tông NỀN (97%) — dùng
        // nó làm màu viền thì ô nhập không có mép nào cả trên nền `--bg` (96%), và
        // đó là một trong những nguồn chính của cảm giác "mong manh". DBX dùng
        // `--input` (≈90%) cho đúng việc này; ở đây `--line` (88%) là token tương
        // đương. Nền `--card` để ô sáng hơn mặt phẳng đỡ nó, như mọi IDE.
        'flex h-ctl w-full rounded-sm border border-line bg-card px-3 py-1.5 text-sm transition-[color,border-color,box-shadow] duration-fast ease-out-soft file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-fg-mute/75 hover:border-line-strong focus-visible:outline-hidden focus-visible:border-acc/60 focus-visible:ring-[3px] focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
