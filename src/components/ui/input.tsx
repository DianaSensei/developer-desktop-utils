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
          'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background transition-[color,border-color,box-shadow] duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/75 hover:border-border/80 focus-visible:outline-none focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
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
