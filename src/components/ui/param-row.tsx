// Parameter row in four parts:
//
//   Poll interval  ?      500ms     [default]     How often the client polls
//   └─ label + help       └─ value  └─ tag        └─ explanation
//
//   1. The value is right-aligned, monospace and tabular so values scan as a
//      column.
//   2. A tag classifies at most two kinds per list (default / changed), so
//      `tag` takes one short string.
//   3. The explanation is always visible, not hidden in a tooltip; `help`
//      is only for detail beyond it.

import * as React from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { useMessages } from '@/contexts/LocaleContext';
import UI from '@/components/ui/ui.messages';

export interface ParamRowProps {
  label: React.ReactNode;
  /** `?` tooltip content, only for detail beyond `children`. */
  help?: string;
  /** Current value; right-aligned, monospace. */
  value: React.ReactNode;
  /** Short tag: "default", "changed", "required". At most two kinds per list. */
  tag?: string;
  /** Emphasized tag (changed from default) instead of a quiet one. */
  tagActive?: boolean;
  /** Explanation, always shown. */
  children?: React.ReactNode;
  className?: string;
}

export function ParamRow({
  label,
  help,
  value,
  tag,
  tagActive,
  children,
  className,
}: ParamRowProps) {
  const ui = useMessages(UI);
  return (
    <div className={cn('border-b border-line-soft py-2.5 last:border-b-0', className)}>
      <div className="flex items-baseline gap-3">
        <span className="flex min-w-0 items-center gap-1 text-dense font-medium">
          <span className="truncate">{label}</span>
          {help && (
            // An icon, not a "?" glyph: at 9–10px a character is unreadable and
            // text under 11px is not allowed.
            <Tooltip label={help} side="top">
              <span
                tabIndex={0}
                role="button"
                aria-label={ui('moreInfo')}
                className={cn(
                  'shrink-0 cursor-help text-fg-mute/70',
                  'transition-colors hover:text-fg-mute',
                  'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
                )}
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </span>
            </Tooltip>
          )}
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-2">
          {tag && (
            <span
              className={cn(
                'rounded-xs px-1.5 py-0.5 text-[11px] leading-none',
                tagActive
                  ? 'bg-acc-tint text-acc-ink'
                  : 'bg-bg-2 text-fg-mute',
              )}
            >
              {tag}
            </span>
          )}
          <span className="font-mono text-dense font-semibold tabular-nums">{value}</span>
        </span>
      </div>

      {children && (
        <p className="mt-0.5 pr-1 text-xs leading-snug text-fg-mute">
          {children}
        </p>
      )}
    </div>
  );
}
