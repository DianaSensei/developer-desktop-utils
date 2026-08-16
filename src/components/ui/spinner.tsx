// The busy indicator. `<Loader2 className="h-4 w-4 animate-spin" />` appears
// ~50 times across the app, and the specific pairing of it with a muted
// "Loading…" caption — `flex items-center gap-2 text-sm text-fg-mute`
// — is duplicated verbatim in 13 Kafka/RabbitMQ views.
//
//   <Spinner />                          inside a Button, next to its label
//   <LoadingRow />                       "Loading…" while a list fetches
//   <LoadingRow label="Loading topic details…" />
//
// The spin is intentionally not behind `motion-safe:` — a frozen spinner
// communicates nothing, and this is a status indicator rather than decoration.

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const SIZE_CLASS = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-6 w-6',
} as const;

export interface SpinnerProps {
  size?: keyof typeof SIZE_CLASS;
  className?: string;
  /** Accessible name when the spinner stands alone with no adjacent text. */
  label?: string;
}

export function Spinner({ size = 'md', className, label }: SpinnerProps) {
  return (
    <Loader2
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('shrink-0 animate-spin', SIZE_CLASS[size], className)}
    />
  );
}

export interface LoadingRowProps {
  /** Default "Loading…". Pass something specific when the wait is long. */
  label?: React.ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}

/** Muted inline "⟳ Loading…" line — the placeholder a view shows while fetching. */
export function LoadingRow({ label = 'Loading…', size = 'md', className }: LoadingRowProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-2 text-fg-mute',
        size === 'sm' ? 'text-[11px]' : 'text-sm',
        className,
      )}
    >
      <Spinner size={size === 'sm' ? 'xs' : 'md'} />
      {label}
    </div>
  );
}
