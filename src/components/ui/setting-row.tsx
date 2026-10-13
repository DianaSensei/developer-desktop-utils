// Settings row: a fixed shape (icon · title · description) with a control on
// the right that varies by purpose:
//
//   chevron ›        opens another screen or panel
//   toggle           on/off in place (always green when on, not the accent)
//   status chip      read-only
//   small outline    one-off action ("Re-import", "Update")
//   dropdown chip    picks a compact value
//
// The control is passed through `control`; `onOpen` covers the common
// chevron case.

import * as React from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SettingRowProps {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Control on the right: Switch, StatusChip, Button, Select... */
  control?: React.ReactNode;
  /**
   * Live preview strip below the row, full width. For choices that are hard
   * to judge from a name (e.g. code font ligatures).
   */
  preview?: React.ReactNode;
  /**
   * Makes the whole row a button that opens something and shows a chevron.
   * Mutually exclusive with `control`: no clickable control inside a
   * clickable row.
   */
  onOpen?: () => void;
  disabled?: boolean;
  className?: string;
}

export function SettingRow({
  icon: Icon,
  title,
  description,
  control,
  preview,
  onOpen,
  disabled,
  className,
}: SettingRowProps) {
  const interactive = Boolean(onOpen) && !disabled;

  const body = (
    <>
      {Icon && (
        <span
          className={cn(
            'grid h-ctl w-ctl shrink-0 place-items-center rounded-sm border border-line bg-sunk',
            'text-fg-mute',
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug">{title}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-snug text-fg-mute">
            {description}
          </span>
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {control}
        {interactive && <ChevronRight className="h-4 w-4 text-fg-mute/70" />}
      </span>
    </>
  );

  // The main row is separate from the outer frame so the preview can sit
  // below it without breaking the row's flex layout.
  const row = cn(
    'flex w-full items-center gap-3 px-3.5 py-3 text-left',
    disabled && 'pointer-events-none opacity-50',
  );
  const outer = cn('border-b border-line-soft last:border-b-0', className);
  const previewStrip = preview && (
    <div className="border-t border-line-soft px-3.5 py-2.5">{preview}</div>
  );

  if (interactive) {
    return (
      <div className={outer}>
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            row,
            'w-full',
            // Hover changes background, not position (design/RULES.md).
            'transition-colors hover:bg-bg-2/40',
            'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
          )}
        >
          {body}
        </button>
        {previewStrip}
      </div>
    );
  }

  return (
    <div className={outer}>
      <div className={row}>{body}</div>
      {previewStrip}
    </div>
  );
}

/**
 * Frame around a group of SettingRows. The only raised layer; rows inside
 * are separated by hairlines (design/RULES.md: one shadowed layer).
 */
export function SettingGroup({
  title,
  children,
  className,
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {title && (
        <h3 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-fg-mute">
          {title}
        </h3>
      )}
      <div className="overflow-hidden rounded-lg border border-line bg-card shadow-soft">
        {children}
      </div>
    </section>
  );
}
