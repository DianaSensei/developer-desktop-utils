// Outline notice: the middle of the three status levels.
//
//   <StatusChip>     glanceable, no explanation
//   <OutlineNotice>  pending item with one action   ← this
//   <ExplainBand>    explanation and fixable examples
//
// Border only, no fill: noticeable without painting the panel for something
// that is not urgent. For standing states (open consumer, unsaved draft,
// connection lost earlier), not fresh errors (<ExplainBand tone="bad">).

import * as React from 'react';
import { cn } from '@/lib/utils';

export type OutlineNoticeTone = 'warn' | 'bad' | 'info' | 'ok';

const TONE: Record<OutlineNoticeTone, { edge: string; label: string; pip: string }> = {
  warn: { edge: 'border-warn-edge', label: 'text-warn', pip: 'bg-warn' },
  bad: { edge: 'border-bad-edge', label: 'text-bad', pip: 'bg-bad' },
  info: { edge: 'border-info-edge', label: 'text-info', pip: 'bg-info' },
  ok: { edge: 'border-ok-edge', label: 'text-ok', pip: 'bg-ok' },
};

export interface OutlineNoticeProps {
  tone: OutlineNoticeTone;
  /** Short status label: "Pending", "Unsaved". */
  label?: React.ReactNode;
  children: React.ReactNode;
  /** Action on the right, usually <Button variant="ghost" size="sm">. */
  action?: React.ReactNode;
  className?: string;
}

export function OutlineNotice({
  tone,
  label,
  children,
  action,
  className,
}: OutlineNoticeProps) {
  const t = TONE[tone];
  return (
    <div
      role="status"
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md border bg-transparent px-3 py-2',
        t.edge,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', t.pip)} />
      <p className="min-w-0 flex-1 text-dense leading-snug">
        {label && <span className={cn('font-medium', t.label)}>{label} · </span>}
        {children}
      </p>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
