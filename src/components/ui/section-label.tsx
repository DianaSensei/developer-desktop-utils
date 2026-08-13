// The uppercase micro-caption that introduces a group of controls or rows —
// "Operations", "Advanced", "Data file", "Active consumers", "Selected".
//
// Roughly 25 hand-written spans across the app use some spelling of
// `text-[10px] font-semibold uppercase tracking-wide text-muted-foreground`,
// varying between `text-[10px]`/`text-[11px]`/`text-xs` and
// `tracking-wide`/`tracking-wider`/`tracking-widest` with no rule behind the
// choice. Two sizes are enough:
//
//   <SectionLabel>Advanced</SectionLabel>              inside a panel
//   <SectionLabel size="sm">Ports</SectionLabel>       heading a whole section
//   <SectionLabel count={12} rule>Consumers</SectionLabel>
//
// For a labelled form control use `Field` (tool-section.tsx) instead; this is
// a group heading, not a label bound to an input.

import * as React from 'react';
import { cn } from '@/lib/utils';

const SIZE_CLASS = {
  xs: 'text-[10px]',
  sm: 'text-xs',
} as const;

export interface SectionLabelProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: keyof typeof SIZE_CLASS;
  /** Trailing count chip — the "how many rows are under this heading" affordance. */
  count?: number;
  /** Extends a hairline to the right edge, turning the label into a divider. */
  rule?: boolean;
  /** Controls pinned to the right (a link, a small toggle). */
  actions?: React.ReactNode;
}

export function SectionLabel({
  size = 'xs',
  count,
  rule,
  actions,
  className,
  children,
  ...props
}: SectionLabelProps) {
  return (
    <div className={cn('flex items-center gap-2', className)} {...props}>
      <span className={cn('font-semibold uppercase tracking-wide text-muted-foreground', SIZE_CLASS[size])}>
        {children}
      </span>
      {count != null && (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{count}</span>
      )}
      {rule && <span className="h-px flex-1 bg-border" />}
      {actions && <span className={cn('flex items-center gap-1', !rule && 'ml-auto')}>{actions}</span>}
    </div>
  );
}
