// Input frame that allows at most two accessories inside the field:
//
//   ┌──────────────────────────────────────────────┐
//   │ [gutter] │ typed content             [meter] │
//   └──────────────────────────────────────────────┘
//     [chip] [chip]          ← everything else goes here
//
//   gutter: data type label on the left ("JSON", "cron", "hex")
//   meter:  one metric on the right (characters, lines, time)
//
// Anything more goes in `chips` below, so the typing area stays wide.
// `meter` is a single ReactNode, not an array.

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface FieldShellProps {
  /** Data type label inside the field, left. Short: 3–6 characters. */
  gutter?: React.ReactNode;
  /** One metric inside the field, right. A second one goes in `chips`. */
  meter?: React.ReactNode;
  /** Chips below the field: status, hints, secondary actions. */
  chips?: React.ReactNode;
  /** Border tone; `undefined` is neutral. */
  tone?: 'ok' | 'warn' | 'bad';
  /** The actual input (<Input>, <Textarea>, <InlineCodeField>...). */
  children: React.ReactNode;
  className?: string;
}

const TONE_EDGE = {
  ok: 'border-ok-edge',
  warn: 'border-warn-edge',
  bad: 'border-bad-edge',
} as const;

export function FieldShell({
  gutter,
  meter,
  chips,
  tone,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <div
        className={cn(
          'flex items-stretch overflow-hidden rounded-sm border bg-bg',
          'transition-colors focus-within:border-acc/60 focus-within:ring-[3px] focus-within:ring-focus',
          tone ? TONE_EDGE[tone] : 'border-line',
        )}
      >
        {gutter && (
          <span
            className={cn(
              'flex shrink-0 select-none items-center border-r border-line bg-sunk',
              'px-2.5 font-mono text-[11px] uppercase tracking-wide text-fg-mute',
            )}
          >
            {gutter}
          </span>
        )}

        {/* The inner input drops its own border, radius and ring; the frame
            draws them, so there is one border and one focus ring. */}
        <div
          className={cn(
            'min-w-0 flex-1',
            '[&_input]:border-0 [&_input]:bg-transparent [&_input]:shadow-none [&_input]:ring-0',
            '[&_input]:rounded-none [&_input]:focus-visible:ring-0 [&_input]:focus-visible:border-0',
            '[&_textarea]:border-0 [&_textarea]:bg-transparent [&_textarea]:shadow-none',
            '[&_textarea]:ring-0 [&_textarea]:rounded-none [&_textarea]:focus-visible:ring-0',
          )}
        >
          {children}
        </div>

        {meter && (
          <span
            className={cn(
              'flex shrink-0 select-none items-center pr-2.5',
              'font-mono text-[11px] tabular-nums text-fg-mute',
            )}
          >
            {meter}
          </span>
        )}
      </div>

      {chips && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{chips}</div>}
    </div>
  );
}
