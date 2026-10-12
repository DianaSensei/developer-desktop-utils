import * as React from 'react';
import { cn } from '@/lib/utils';

// Dependency-free toggle switch, controlled via `checked`/`onCheckedChange`.
//
// ON is green, not the accent: a switch shows state, and state colors are
// fixed regardless of the accent tone (design/RULES.md).
//
// The thumb moves with `--ease-spring` and squeezes horizontally while
// pressed. The track recolors in `--dur-fast`, faster than the thumb
// (`--dur-base`), so the new state reads immediately.
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
        'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
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
          // Squeeze while pressed; the spring rounds it out on release.
          'motion-safe:group-active:scale-x-90',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  ),
);
Switch.displayName = 'Switch';
