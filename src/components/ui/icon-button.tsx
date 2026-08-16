import * as React from 'react';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Tints the button with the active/selected treatment (bg-acc/10 + text-acc). */
  active?: boolean;
  size?: 'sm' | 'md';
}

/**
 * Icon-only action button — the `rounded p-1.5 text-fg-mute
 * hover:bg-acc hover:text-fg` pattern that was hand-rolled at
 * every call site (sidebars, tab bars, panel headers). Always pass a `title`
 * for accessibility since there is no visible label.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, active, size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm text-fg-mute transition-colors',
        'hover:bg-acc hover:text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acc/40',
        'disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-ctl w-ctl' : 'h-ctl w-ctl',
        active && 'bg-acc/10 text-acc hover:bg-acc/15',
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';
