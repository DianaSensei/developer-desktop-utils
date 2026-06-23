import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Raised, premium — soft blue accent glow that deepens on hover, lifts a
        // hair and settles on press (Apple/Material key-action elevation).
        default:
          'bg-primary text-primary-foreground shadow-primary hover:bg-primary/95 hover:shadow-primary-lg motion-safe:hover:-translate-y-0.5 active:shadow-primary motion-safe:active:translate-y-0',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm-premium hover:bg-destructive/90 hover:shadow-md-premium motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0',
        outline:
          'border border-input bg-background shadow-sm-premium hover:bg-accent/10 hover:text-foreground hover:border-border/70 hover:shadow-md-premium motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:shadow-sm-premium',
        ghost: 'hover:bg-accent/15 hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-3 py-2',
        sm: 'h-8 rounded-md px-2.5',
        lg: 'h-10 rounded-md px-5',
        icon: 'h-9 w-9',
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
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
