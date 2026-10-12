import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared checkbox.
 *
 * The tick is drawn: `stroke-dasharray` equals the path length and
 * `stroke-dashoffset` animates to 0 in `--dur-fast`, reading as "just done"
 * rather than fading in. The box presses to 0.9 (`--dur-press`) and fills in
 * `--dur-fast`, like `Switch`. Reduced motion makes the tick appear at once
 * (design/tokens.css).
 */
export interface CheckboxProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** `sm` (14px) for dense list rows; `md` (16px) by default. */
  size?: 'sm' | 'md';
  /** "Partial" state for a column header checkbox: a dash instead of a tick. */
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
          on ? 'border-acc bg-acc text-acc-fg' : 'border-line hover:border-line',
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
            /* Path length for the `tick-draw` keyframe; the shorter dash
               animates over its own length. */
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
