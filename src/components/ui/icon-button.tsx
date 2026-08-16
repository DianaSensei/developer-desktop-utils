import * as React from 'react';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Tints the button with the active/selected treatment (bg-primary/10 + text-primary). */
  active?: boolean;
  size?: 'sm' | 'md';
}

/**
 * Icon-only action button — the `rounded p-1.5 text-muted-foreground
 * hover:bg-accent hover:text-foreground` pattern that was hand-rolled at
 * every call site (sidebars, tab bars, panel headers). Always pass a `title`
 * for accessibility since there is no visible label.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, active, size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-ctl w-ctl' : 'h-ctl w-ctl',
        active && 'bg-primary/10 text-primary hover:bg-primary/15',
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';
