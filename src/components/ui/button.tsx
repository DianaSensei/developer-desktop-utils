import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Rê chuột đổi màu/bóng, KHÔNG đổi vị trí — design/RULES.md. `transform` vẫn
  // nằm trong transition cho hiệu ứng lún khi bấm (active:scale), là phản hồi
  // trực tiếp dưới ngón tay chứ không phải chuyển động khi chỉ lướt qua.
  'inline-flex items-center justify-center whitespace-nowrap rounded-sm text-sm font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-primary hover:bg-primary/95 hover:shadow-primary-lg active:shadow-primary',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm-premium hover:bg-destructive/90 hover:shadow-md-premium',
        outline:
          'border border-input bg-background shadow-sm-premium hover:bg-accent/10 hover:text-foreground hover:border-border/70 hover:shadow-md-premium',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:shadow-sm-premium',
        ghost: 'hover:bg-accent/15 hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        // Một chiều cao control cho cả app: --h (34px). `lg` dùng --h-lg (40px)
        // cho hành động chính của trang. `sm` giữ lại cho toolbar dày đặc.
        default: 'h-ctl px-3 py-2',
        sm: 'h-8 rounded-sm px-2.5',
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
