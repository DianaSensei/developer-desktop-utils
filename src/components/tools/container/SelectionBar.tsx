import type { ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Row / header checkbox for the container tool's tables. The header instance
 * takes `indeterminate` so a partial selection reads as a dash rather than as
 * "nothing selected" — without it, clicking a half-filled header checkbox
 * looks like it should clear when it actually selects.
 */
export function RowCheckbox({ checked, indeterminate, onToggle, title }: {
  checked: boolean;
  indeterminate?: boolean;
  /** Receives the raw event so callers can honour shift-click range select. */
  onToggle: (e: React.MouseEvent) => void;
  title: string;
}) {
  const active = checked || !!indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={title}
      onClick={onToggle}
      title={title}
      className={cn(
        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors',
        active ? 'border-acc bg-acc text-acc-fg' : 'border-sunk hover:border-acc/60',
      )}
    >
      {checked ? <Check className="h-2.5 w-2.5" /> : indeterminate ? <Minus className="h-2.5 w-2.5" /> : null}
    </button>
  );
}

/**
 * The bar that appears above a table once anything is selected: the count, a
 * "select every visible row" shortcut for when the current filter shows more
 * than what's ticked, Clear, and whatever bulk actions the view passes in.
 */
export function SelectionBar({ count, unselectedVisibleCount, onSelectAllVisible, onClear, children }: {
  count: number;
  unselectedVisibleCount: number;
  onSelectAllVisible: () => void;
  onClear: () => void;
  children?: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="mx-5 mt-3 shrink-0 flex flex-wrap items-center justify-between gap-2 rounded-md border border-acc/30 bg-acc/5 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-fg-mute">{count.toLocaleString()} selected</span>
        {unselectedVisibleCount > 0 && (
          <button type="button" className="text-xs text-acc hover:underline" onClick={onSelectAllVisible}>
            Select all {(count + unselectedVisibleCount).toLocaleString()} shown
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {children}
        <Button size="sm" variant="outline" className="h-ctl" onClick={onClear}>Clear</Button>
      </div>
    </div>
  );
}
