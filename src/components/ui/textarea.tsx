import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        // Disable macOS/WebKit smart-quote, autocorrect, and autocapitalize
        // substitutions by default so a typed " stays a straight ASCII quote
        // (curly quotes break JSON/code). Overridable via props (prose tools
        // re-enable spellCheck); these attributes are no-ops on Windows/Linux.
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className={cn(
          'flex min-h-[80px] w-full rounded-sm border border-input bg-bg px-3 py-2 text-sm ring-offset-bg transition-[color,border-color,box-shadow] duration-150 placeholder:text-fg-mute/75 hover:border-border/80 focus-visible:outline-none focus-visible:border-acc/60 focus-visible:ring-2 focus-visible:ring-acc/35 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
