// Inline status banner — the "something went wrong / heads up / it worked"
// strip that sits above or inside a view.
//
// Before this existed, `flex items-start gap-2 rounded-md border
// border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive`
// was pasted verbatim in 16 places (every Kafka and RabbitMQ view, Network
// Tools, the API Client runner) with an amber twin in 7 more — each one
// re-picking its own icon, padding and dark-mode text color. Use this instead
// of hand-rolling the 17th.
//
// Not to be confused with `StatusMessage` (a transient, dismissable toast-like
// banner tied to an action's result). `Callout` is a plain, always-rendered
// piece of state: `{error && <Callout tone="error">{error}</Callout>}`.

import * as React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CalloutTone = 'error' | 'warning' | 'success' | 'info';

/**
 * Semantic tones only — no raw color prop. A new meaning gets a tone here so
 * "what does an amber banner mean in this app" keeps one answer.
 */
const TONE_CLASS: Record<CalloutTone, string> = {
  error: 'border-bad-edge bg-bad-tint text-bad',
  warning: 'border-warn-edge bg-warn-tint text-warn',
  success: 'border-ok-edge bg-ok-tint text-ok',
  info: 'border-border bg-muted/40 text-fg-mute',
};

const TONE_ICON: Record<CalloutTone, LucideIcon> = {
  error: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
};

const SIZE_CLASS = {
  sm: 'px-3 py-2 text-[11px] leading-relaxed',
  md: 'px-3 py-2.5 text-sm',
} as const;

const ICON_SIZE = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
} as const;

export interface CalloutProps {
  tone: CalloutTone;
  /** Bold first line above the body. Omit for a single-line callout. */
  title?: React.ReactNode;
  children?: React.ReactNode;
  /** Override the tone's default glyph, or pass `false` to drop the icon entirely. */
  icon?: LucideIcon | false;
  size?: keyof typeof SIZE_CLASS;
  /** Buttons pinned to the right edge (retry, dismiss, "open settings"…). */
  actions?: React.ReactNode;
  className?: string;
}

export function Callout({
  tone,
  title,
  children,
  icon,
  size = 'md',
  actions,
  className,
}: CalloutProps) {
  const Icon = icon === false ? null : (icon ?? TONE_ICON[tone]);
  return (
    <div
      // Only errors are announced. `info`/`warning` callouts are frequently
      // static explanatory notes, and marking those as live regions would have
      // a screen reader read them out on every render for no reason.
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'flex items-start gap-2 rounded-md border',
        TONE_CLASS[tone],
        SIZE_CLASS[size],
        className,
      )}
    >
      {Icon && <Icon className={cn('mt-0.5 shrink-0', ICON_SIZE[size])} />}
      <div className="min-w-0 flex-1 break-words">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}
