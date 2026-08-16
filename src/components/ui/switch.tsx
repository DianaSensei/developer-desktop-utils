import * as React from 'react';
import { cn } from '@/lib/utils';

// Minimal, dependency-free toggle switch. Controlled via `checked` /
// `onCheckedChange`.
//
// The ON state is GREEN, not the accent. A switch reports state ("this is on"),
// and state colors are a separate fixed system from the swappable accent — so
// re-toning the app to a red or amber accent must not recolor every toggle.
// See design/RULES.md, "Màu theo nghĩa".
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
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-ok' : 'bg-input border border-border',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  ),
);
Switch.displayName = 'Switch';
