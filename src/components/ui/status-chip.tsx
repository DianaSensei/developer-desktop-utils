// Status chip: the lightest of the three status levels (chip → outline →
// band). Sits in panel headers for at-a-glance state, with no explanation
// (use <ExplainBand> for that). Separate from <Badge>, which is a general
// label; a status chip always has a dot.
//
// Colors come from the fixed status palette, never the accent
// (design/RULES.md).

import * as React from 'react';
import { cn } from '@/lib/utils';

export type StatusChipTone = 'ok' | 'warn' | 'bad' | 'info' | 'idle';

const TONE: Record<StatusChipTone, { chip: string; pip: string }> = {
  ok: { chip: 'bg-ok-tint text-ok border-ok-edge', pip: 'bg-ok' },
  warn: { chip: 'bg-warn-tint text-warn border-warn-edge', pip: 'bg-warn' },
  bad: { chip: 'bg-bad-tint text-bad border-bad-edge', pip: 'bg-bad' },
  info: { chip: 'bg-info-tint text-info border-info-edge', pip: 'bg-info' },
  idle: {
    chip: 'bg-bg-2/60 text-fg-mute border-line',
    pip: 'bg-fg-mute/50',
  },
};

export interface StatusChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: StatusChipTone;
  /** Hides the dot when there is a leading icon. */
  hidePip?: boolean;
  children: React.ReactNode;
}

export function StatusChip({ tone, hidePip, className, children, ...props }: StatusChipProps) {
  const t = TONE[tone];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border',
        'px-2 py-[3px] text-[11px] font-medium leading-none',
        t.chip,
        className,
      )}
      {...props}
    >
      {!hidePip && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', t.pip)} />}
      {children}
    </span>
  );
}
