import * as React from 'react';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Tints the button with the active/selected treatment (bg-acc/10 + text-acc). */
  active?: boolean;
  /**
   * `sm` and `md` are both the app's one control height (34px) — they have
   * never differed, and 24 call sites depend on that, so they stay as they are.
   * `xs` (24px) is the genuinely smaller box, for a micro-affordance that sits
   * beside an 11px `SectionLabel` rather than beside other controls; at 34px
   * such a button drives the caption row taller than the list rows under it.
   *
   * Set the size through this prop, never with an `h-*`/`w-*` class: `cn()`
   * cannot tell that `h-6` and `h-ctl` are the same property (`h-ctl` is a
   * preset utility outside tailwind-merge's height scale), so both survive the
   * merge and stylesheet order decides — which is why an `h-6 w-6` override
   * here silently rendered at 34px.
   */
  size?: 'xs' | 'sm' | 'md';
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
        size === 'xs' ? 'h-6 w-6' : 'h-ctl w-ctl',
        active && 'bg-acc/10 text-acc hover:bg-acc/15',
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';
