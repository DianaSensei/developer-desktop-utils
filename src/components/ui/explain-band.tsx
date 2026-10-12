// Explanation band: the strongest of the three status levels, used when
// something needs explaining. Unlike <Callout>, it lives inside the panel
// under the header, so status changes while typing do not shift the layout.
//
//   1. The explanation is always visible, never hidden in a tooltip.
//   2. It teaches as well as reports: tone="ok" explains a valid value,
//      tone="bad" reports an error.
//
// `examples` are clickable chips that fix the input in place.

import * as React from 'react';
import { cn } from '@/lib/utils';

export type ExplainBandTone = 'ok' | 'warn' | 'bad' | 'info';

const TONE: Record<ExplainBandTone, { band: string; title: string; chip: string }> = {
  ok: {
    band: 'bg-ok-tint border-ok-edge',
    title: 'text-ok',
    chip: 'border-ok-edge text-ok hover:bg-ok/10',
  },
  warn: {
    band: 'bg-warn-tint border-warn-edge',
    title: 'text-warn',
    chip: 'border-warn-edge text-warn hover:bg-warn/10',
  },
  bad: {
    band: 'bg-bad-tint border-bad-edge',
    title: 'text-bad',
    chip: 'border-bad-edge text-bad hover:bg-bad/10',
  },
  info: {
    band: 'bg-info-tint border-info-edge',
    title: 'text-info',
    chip: 'border-info-edge text-info hover:bg-info/10',
  },
};

export interface ExplainBandExample {
  label: string;
  /** Without it the chip is read-only. */
  onPick?: () => void;
  title?: string;
}

export interface ExplainBandProps {
  tone: ExplainBandTone;
  /** Short bold label: "Syntax error", "Valid", "Expiring soon". */
  title?: React.ReactNode;
  /** Explanation, always shown. */
  children: React.ReactNode;
  /** Example chips that apply on click. */
  examples?: ExplainBandExample[];
  className?: string;
}

export function ExplainBand({ tone, title, children, examples, className }: ExplainBandProps) {
  const t = TONE[tone];
  return (
    <div
      className={cn('rounded-md border px-3 py-2.5', t.band, className)}
      // Errors are announced immediately; other tones politely.
      role={tone === 'bad' ? 'alert' : 'status'}
    >
      {/* A div, not a p: some callers add block content below the main
          sentence (see CronGenerator), which a p cannot contain. */}
      <div className="text-dense leading-relaxed text-fg">
        {title && <span className={cn('font-semibold', t.title)}>{title} · </span>}
        {children}
      </div>
      {examples && examples.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {examples.map((ex) =>
            ex.onPick ? (
              <button
                key={ex.label}
                type="button"
                onClick={ex.onPick}
                title={ex.title}
                className={cn(
                  'rounded-xs border bg-card/60 px-2 py-1 font-mono text-[11px] leading-none',
                  'transition-colors focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
                  t.chip,
                )}
              >
                {ex.label}
              </button>
            ) : (
              <span
                key={ex.label}
                title={ex.title}
                className={cn(
                  'rounded-xs border bg-card/60 px-2 py-1 font-mono text-[11px] leading-none',
                  t.chip,
                )}
              >
                {ex.label}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}
