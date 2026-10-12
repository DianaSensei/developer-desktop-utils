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
  /**
   * The button's task is running: spins the icon, disables the button and
   * sets `aria-busy`. The icon spins in place rather than being swapped for
   * `<Spinner>`, so the width stays stable.
   */
  busy?: boolean;
}

/**
 * Icon-only action button — the `rounded p-1.5 text-fg-mute
 * hover:bg-acc hover:text-fg` pattern that was hand-rolled at
 * every call site (sidebars, tab bars, panel headers). Always pass a `title`
 * for accessibility since there is no visible label.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, active, size = 'md', type = 'button', busy, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled ?? busy}
      aria-busy={busy || undefined}
      className={cn(
        // Press scale 0.90 in `--dur-press` (stronger than text buttons'
        // 0.97, which is invisible at 24px).
        'inline-flex shrink-0 items-center justify-center rounded-sm text-fg-mute',
        'transition-[color,background-color,transform] duration-fast ease-out-soft',
        'motion-safe:active:scale-90 motion-safe:active:duration-press',
        'hover:bg-acc hover:text-fg active:bg-acc/80',
        'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
        'disabled:pointer-events-none disabled:opacity-50',
        size === 'xs' ? 'h-6 w-6' : 'h-ctl w-ctl',
        active && 'bg-acc/10 text-acc hover:bg-acc/15',
        // Spin the existing icon.
        busy && '[&>svg]:animate-spin',
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';
