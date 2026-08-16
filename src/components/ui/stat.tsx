// A labelled number — the single most re-invented widget in the app. Six tools
// had each written a local `Stat`/`StatCard`: RabbitMQ's overview and queue
// detail, the API Client runner summary, Network Tools, Text Counter, and the
// Deduplicator toolbar. They differed in radius, label case, value size and
// which colors "good" and "bad" were.
//
// Three shapes cover every existing use:
//   card    — bordered tile in a grid (overview dashboards)
//   compact — smaller bordered tile for a summary strip above results
//   inline  — value + label on one baseline, for toolbars and status rows
//
// Pair `card`/`compact` with `StatGrid` for the responsive grid.

import * as React from 'react';
import { cn } from '@/lib/utils';

export type StatTone = 'default' | 'muted' | 'success' | 'warning' | 'danger' | 'accent';
export type StatVariant = 'card' | 'compact' | 'inline';

const TONE_CLASS: Record<StatTone, string> = {
  default: 'text-fg',
  muted: 'text-fg-mute',
  success: 'text-ok',
  warning: 'text-warn',
  danger: 'text-bad',
  accent: 'text-acc-ink',
};

export interface StatProps {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Secondary line under the value (rate, share, unit). `card` variant only. */
  sub?: React.ReactNode;
  tone?: StatTone;
  variant?: StatVariant;
  /** Small glyph before the label. */
  icon?: React.ReactNode;
  /** Rendered at the right edge of a `card`/`compact` tile — e.g. a CopyButton. */
  action?: React.ReactNode;
  /**
   * The value is an identifier (IP, hostname, node name), not a metric: render
   * it monospaced and wrapping instead of as a large tabular number.
   */
  mono?: boolean;
  className?: string;
  title?: string;
}

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
  variant = 'card',
  icon,
  action,
  mono,
  className,
  title,
}: StatProps) {
  if (variant === 'inline') {
    return (
      <div className={cn('flex items-baseline gap-1', className)} title={title}>
        <span className={cn('text-base font-bold leading-none', mono ? 'font-mono' : 'tabular-nums', TONE_CLASS[tone])}>{value}</span>
        <span className="flex items-center gap-1 text-xs text-fg-mute">{icon}{label}</span>
      </div>
    );
  }

  const compact = variant === 'compact';
  return (
    <div
      title={title}
      className={cn(
        'flex items-start gap-2',
        compact ? 'min-w-[5.5rem] rounded-md border bg-muted/20 px-3 py-1.5' : 'rounded-lg border bg-card/40 px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className={cn(
          'flex items-center gap-1 uppercase tracking-wide text-fg-mute',
          'text-[11px]',
        )}>
          {icon}{label}
        </p>
        <p className={cn(
          mono
            ? 'mt-0.5 break-all font-mono text-sm leading-snug'
            : cn('font-semibold tabular-nums', compact ? 'text-base' : 'mt-1 text-xl'),
          TONE_CLASS[tone],
        )}>
          {value}
        </p>
        {sub && !compact && <p className="mt-0.5 text-[11px] text-fg-mute">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const COLUMNS_CLASS = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 xl:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
} as const;

export interface StatGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Widest column count; the grid steps down to 1 on narrow panes. Default 3. */
  columns?: keyof typeof COLUMNS_CLASS;
}

export function StatGrid({ columns = 3, className, ...props }: StatGridProps) {
  return <div className={cn('grid gap-2', COLUMNS_CLASS[columns], className)} {...props} />;
}
