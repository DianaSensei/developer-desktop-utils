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
          'flex h-ctl w-full rounded-sm border border-sunk bg-bg px-3 py-1.5 text-sm transition-[color,border-color,box-shadow] duration-fast ease-out-soft file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-fg-mute/75 hover:border-line/80 focus-visible:outline-hidden focus-visible:border-acc/60 focus-visible:ring-[3px] focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50',
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
