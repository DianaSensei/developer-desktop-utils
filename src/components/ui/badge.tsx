// Small inline label — connection state, HTTP method, message count, "beta",
// queue type. Every complex tool had grown its own: RabbitMQ's `StateBadge`,
// the node running/down chip, the API Client sidebar's method badge, Kafka's
// info-modal badge, Time Tracker's count pills, TextDiff's result chip. Each
// picked slightly different padding, radius and dark-mode text colors.
//
// Two axes, both closed-ended:
//   tone    — what it means (neutral / success / warning / danger / info / accent)
//   variant — how loud it is (soft fill / solid fill / outline)
//
// `uppercase` switches to the state-chip look (semibold + tracking); leave it
// off for counts and free text.

import * as React from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
export type BadgeVariant = 'soft' | 'solid' | 'outline';

const SOFT: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  danger: 'bg-destructive/15 text-destructive',
  info: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  accent: 'bg-primary/15 text-primary',
};

const SOLID: Record<BadgeTone, string> = {
  neutral: 'bg-muted-foreground text-background',
  success: 'bg-emerald-500 text-white',
  warning: 'bg-amber-500 text-white',
  danger: 'bg-destructive text-destructive-foreground',
  info: 'bg-sky-500 text-white',
  accent: 'bg-primary text-primary-foreground',
};

const OUTLINE: Record<BadgeTone, string> = {
  neutral: 'border border-border text-muted-foreground',
  success: 'border border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
  warning: 'border border-amber-500/40 text-amber-600 dark:text-amber-400',
  danger: 'border border-destructive/40 text-destructive',
  info: 'border border-sky-500/40 text-sky-600 dark:text-sky-400',
  accent: 'border border-primary/40 text-primary',
};

const VARIANT: Record<BadgeVariant, Record<BadgeTone, string>> = {
  soft: SOFT,
  solid: SOLID,
  outline: OUTLINE,
};

const SIZE_CLASS = {
  xs: 'px-1.5 py-0.5 text-[10px]',
  sm: 'px-2 py-0.5 text-[11px]',
} as const;

export interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: keyof typeof SIZE_CLASS;
  /** State-chip styling: uppercase, semibold, wider tracking. */
  uppercase?: boolean;
  /** Fully rounded (counts, notification bubbles) instead of the default `rounded`. */
  pill?: boolean;
  mono?: boolean;
  children?: React.ReactNode;
}

export function Badge({
  tone = 'neutral',
  variant = 'soft',
  size = 'xs',
  uppercase,
  pill,
  mono,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap leading-none',
        pill ? 'rounded-full' : 'rounded',
        SIZE_CLASS[size],
        VARIANT[variant][tone],
        uppercase ? 'font-semibold uppercase tracking-wide' : 'font-medium',
        mono && 'font-mono',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
