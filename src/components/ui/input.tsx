import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        // No smart quotes, autocorrect or autocapitalize by default (curly
        // quotes break JSON/code). Overridable via props.
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className={cn(
          // Border is `--line` (a `--sunk` border vanishes on `--bg`); the
          // `--card` background makes the field lighter than its surface.
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
