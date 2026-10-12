import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Keycap } from '@/components/ui/keycap';

const buttonVariants = cva(
  // Hover changes color only, never position (design/RULES.md). `transform`
  // is transitioned for the press effect (active:scale): fast press, slower
  // release (rule 3 in design/tokens.css: `--dur-press` while active).
  //
  // All shadows use the kit scale (`--sh-sm/--sh/--sh-lg`) through Tailwind's
  // shadow variables. A second shadow system that wrote `box-shadow` directly
  // used to be overridden by the focus ring depending on CSS order, and there
  // is no accent glow (RULES.md: no hover lift, no glow).
  [
    'inline-flex items-center justify-center whitespace-nowrap rounded-sm text-sm font-medium',
    'transition-[color,background-color,border-color,box-shadow,transform] duration-fast ease-out-soft',
    'motion-safe:active:scale-[0.97] motion-safe:active:duration-press',
    // Kit focus style: no outline, 3px ring in `--acc-ring` (the preset's
    // default ring color).
    'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
    'disabled:pointer-events-none disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      variant: {
        // `shadow-btn` adds inner light/dark 1px edges to the soft shadow so a
        // solid button reads as pressable (see `--sh-btn`); on press the edges
        // switch off and the shadow goes inward (`shadow-btn-press`).
        default:
          'bg-acc text-acc-fg shadow-btn hover:bg-acc-hi active:bg-acc-hi active:shadow-btn-press',
        // `tint`: light accent background with matching text, between the
        // solid `default` and the nearly invisible `outline`/`ghost`. For
        // secondary actions that still need weight.
        tint: 'bg-acc-tint text-acc-ink hover:bg-acc-tint-2 active:bg-acc-tint-2',
        destructive:
          'bg-bad text-white shadow-btn hover:bg-bad/90 active:shadow-btn-press',
        // Kit outline: `--card` surface and `--sh-sm`; hover changes border
        // and background, never the shadow. No `--edge-lite` (invisible on a
        // white surface), but the press shadow still applies.
        outline:
          'border border-line bg-card shadow-soft hover:border-acc-edge hover:bg-chrome active:bg-sunk active:shadow-btn-press',
        secondary:
          'bg-bg-2 text-fg shadow-btn hover:bg-bg-2/80 active:bg-sunk active:shadow-btn-press',
        // Kit ghost sets `--fg-mute`, but many icon buttons set their own text
        // color here, so only the hover background is taken.
        ghost: 'hover:bg-sunk hover:text-fg active:bg-sunk',
        link: 'text-acc underline-offset-4 hover:underline',
      },
      size: {
        // One control height app-wide: --h (34px). `lg` (--h-lg, 40px) for a
        // page's main action; `sm` for dense toolbars.
        default: 'h-ctl px-3 py-2',
        sm: 'h-ctl rounded-sm px-2.5',
        lg: 'h-ctl-lg rounded-sm px-5',
        icon: 'h-ctl w-ctl',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Inline shortcut hint after a divider: `<Button sc="⏎">Run</Button>` →
   * `[ Run │ ⏎ ]`. Use `scMod` to prefix ⌘/Ctrl. Ignored with `asChild`.
   */
  sc?: string;
  /** Prefixes ⌘ (macOS) or Ctrl to `sc`. */
  scMod?: boolean;
  /**
   * The button's task is running: spins the first icon, disables the
   * button and sets `aria-busy`. The existing icon spins instead of being
   * swapped for `<Spinner>`, so the width does not change.
   */
  busy?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, sc, scMod, busy, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size }),
          busy && '[&>svg:first-child]:animate-spin',
          className,
        )}
        ref={ref}
        disabled={disabled ?? busy}
        aria-busy={busy || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {children}
            {sc && (
              <Keycap inline mod={scMod}>
                {sc}
              </Keycap>
            )}
          </>
        )}
      </Comp>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
