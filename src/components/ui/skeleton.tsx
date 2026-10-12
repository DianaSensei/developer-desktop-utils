import * as React from 'react';
import { cn } from '@/lib/utils';
import { useMessages } from '@/contexts/LocaleContext';
import UI from '@/components/ui/ui.messages';

/**
 * Shaped loading placeholder, instead of a spinner in an empty panel.
 *
 * A skeleton keeps the layout of what is coming, so the page does not jump
 * when data arrives, and its shimmer distinguishes "loading" from "loaded
 * and empty". The shimmer loops because it is a status indicator, like
 * `<Spinner>`; with reduced motion it stays still (design/tokens.css).
 */
export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Fully round: avatars, status dots, chips. */
  circle?: boolean;
}

export function Skeleton({ circle, className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden bg-sunk',
        circle ? 'rounded-full' : 'rounded-sm',
        // A sweeping overlay rather than `animate-pulse`, so a list of blocks
        // shows one motion instead of each block pulsing.
        'motion-safe:after:absolute motion-safe:after:inset-0',
        'motion-safe:after:bg-gradient-to-r motion-safe:after:from-transparent motion-safe:after:via-fg/[0.07] motion-safe:after:to-transparent',
        'motion-safe:after:-translate-x-full motion-safe:after:animate-shimmer motion-safe:after:content-[""]',
        className,
      )}
      {...props}
    />
  );
}

export interface SkeletonTextProps {
  /** Number of lines; the last one is shorter. */
  lines?: number;
  className?: string;
}

/** Placeholder text lines for descriptions and message bodies. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  const ui = useMessages(UI);
  return (
    <div role="status" aria-label={ui('loadingShort')} className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn('h-3', i === lines - 1 ? 'w-2/5' : i % 2 ? 'w-4/5' : 'w-full')}
        />
      ))}
    </div>
  );
}

export interface SkeletonListProps {
  /** Number of placeholder rows. */
  rows?: number;
  /** Leaves room for a leading icon or avatar. */
  leading?: boolean;
  className?: string;
}

/**
 * Loading list rows. Row widths vary by index (not `Math.random`, so they
 * are stable across renders), since equal-width bars read as graphics.
 */
export function SkeletonList({ rows = 6, leading, className }: SkeletonListProps) {
  const ui = useMessages(UI);
  const WIDTHS = ['w-2/3', 'w-1/2', 'w-3/5', 'w-5/12', 'w-7/12', 'w-1/2'];
  return (
    <div role="status" aria-label={ui('loadingShort')} className={cn('divide-y divide-line', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          {leading && <Skeleton circle className="h-5 w-5 shrink-0" />}
          <Skeleton className={cn('h-3', WIDTHS[i % WIDTHS.length])} />
          <Skeleton className="ml-auto h-3 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}
