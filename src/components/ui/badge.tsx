// Small inline label: connection state, HTTP method, message count, "beta",
// queue type.
//
// Two closed axes:
//   tone    — meaning (neutral / success / warning / danger / info / accent)
//   variant — loudness (soft fill / solid fill / outline)
//
// `uppercase` gives the state-chip look (semibold, tracking); leave it off
// for counts and free text.

import * as React from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
export type BadgeVariant = 'soft' | 'solid' | 'outline';

// Tones come from the kit's status palette, so they work in both themes and
// do not change with the accent (design/RULES.md).
const SOFT: Record<BadgeTone, string> = {
  neutral: 'bg-bg-2 text-fg-mute',
  success: 'bg-ok-tint text-ok',
  warning: 'bg-warn-tint text-warn',
  danger: 'bg-bad-tint text-bad',
  info: 'bg-info-tint text-info',
  accent: 'bg-acc-tint text-acc-ink',
};

const SOLID: Record<BadgeTone, string> = {
  neutral: 'bg-fg-mute text-bg',
  // `text-bg`, not white: dark-theme status colors are light, and the
  // background flips with the theme.
  success: 'bg-ok text-bg',
  warning: 'bg-warn text-bg',
  danger: 'bg-bad text-bg',
  info: 'bg-info text-bg',
  accent: 'bg-acc text-acc-fg',
};

const OUTLINE: Record<BadgeTone, string> = {
  neutral: 'border border-line text-fg-mute',
  success: 'border border-ok-edge text-ok',
  warning: 'border border-warn-edge text-warn',
  danger: 'border border-bad-edge text-bad',
  info: 'border border-info-edge text-info',
  accent: 'border border-acc-edge text-acc-ink',
};

const VARIANT: Record<BadgeVariant, Record<BadgeTone, string>> = {
  soft: SOFT,
  solid: SOLID,
  outline: OUTLINE,
};

// 11px is the smallest allowed size.
const SIZE_CLASS = {
  xs: 'px-1.5 py-0.5 text-[11px]',
  sm: 'px-2 py-[3px] text-[11px]',
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
        pill ? 'rounded-full' : 'rounded-xs',
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
