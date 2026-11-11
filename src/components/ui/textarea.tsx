import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

/** Pastes at least this long skip the browser's own insertion (see below). */
export const LARGE_PASTE_CHARS = 100_000;

/**
 * Chromium (WebView2 on Windows too) takes tens of seconds to lay out a very
 * long line that was inserted into a wrapping <textarea> by a native paste,
 * and pays that again whenever the field is shown again (a kept-alive tool
 * coming back to the front). The same text assigned through `value` lays out
 * in about a second. So a large paste is applied as a value change instead:
 * same result at the caret, minus the browser's own undo step for it (tools
 * keep their own history with `useInputHistory`).
 */
function applyLargePaste(e: React.ClipboardEvent<HTMLTextAreaElement>): void {
  const el = e.currentTarget;
  if (e.defaultPrevented || el.readOnly || el.disabled || el.maxLength >= 0) return;
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (text.length < LARGE_PASTE_CHARS) return;
  e.preventDefault();
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  // The prototype setter, not `el.value = …`: React tracks the instance
  // property and would swallow the change event otherwise.
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, next);
  const caret = start + text.length;
  el.setSelectionRange(caret, caret);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, onPaste, ...props }, ref) => {
    return (
      <textarea
        onPaste={(e) => {
          onPaste?.(e);
          applyLargePaste(e);
        }}
        // Disable macOS/WebKit smart-quote, autocorrect, and autocapitalize
        // substitutions by default so a typed " stays a straight ASCII quote
        // (curly quotes break JSON/code). Overridable via props (prose tools
        // re-enable spellCheck); these attributes are no-ops on Windows/Linux.
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className={cn(
          // Same as Input: `--line` border, `--card` background (see ui/input.tsx).
          'flex min-h-[80px] w-full rounded-sm border border-line bg-card px-3 py-2 text-sm transition-[color,border-color,box-shadow] duration-fast ease-out-soft placeholder:text-fg-mute/75 hover:border-line-strong focus-visible:outline-hidden focus-visible:border-acc/60 focus-visible:ring-[3px] focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50',
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
