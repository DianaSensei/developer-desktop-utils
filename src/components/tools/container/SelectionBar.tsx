import type { ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Row / header checkbox for the container tool's tables.
 *
 * The unchecked box is outlined in `fg-mute/70` rather than `sunk`: `sunk` is
 * 97% lightness on light and 11% on dark, i.e. within a hair of the surface it
 * sits on, which made the box effectively invisible in both themes. This
 * clears the 3:1 non-text contrast minimum against the card in both.
 *
 * The header instance takes `indeterminate` so a partial selection reads as a
 * dash rather than as "nothing selected" — without it, clicking a half-filled
 * header checkbox looks like it should clear when it actually selects.
 */
export function RowCheckbox({ checked, indeterminate, onToggle, title, disabled }: {
  checked: boolean;
  indeterminate?: boolean;
  /** Receives the raw event so callers can honour shift-click range select. */
  onToggle: (e: React.MouseEvent) => void;
  title: string;
  disabled?: boolean;
}) {
  const active = checked || !!indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={title}
      disabled={disabled}
      onClick={onToggle}
      title={title}
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border transition-colors duration-fast',
        'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-acc/35 focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
        'active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'border-acc bg-acc text-acc-fg hover:bg-acc-hi hover:border-acc-hi'
          : 'border-fg-mute/70 bg-card hover:border-acc hover:bg-acc/10',
      )}
    >
      {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : indeterminate ? <Minus className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  );
}

/**
 * Bulk-action bar for a selection.
 *
 * It floats over the bottom of the list instead of being inserted above the
 * table: as an in-flow element it appeared and disappeared as rows were
 * ticked and unticked, shoving the whole table down and back a row's height
 * on every click. Absolutely positioned, ticking a row changes nothing about
 * the table's geometry. The parent view must be `relative` for the anchor to
 * resolve; the short fade/slide-in is the state transition (suppressed by the
 * global prefers-reduced-motion rule).
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
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-5">
      <div
        role="toolbar"
        aria-label={`${count} selected`}
        className={cn(
          'pointer-events-auto flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg',
          'border border-acc/40 bg-card/95 px-3 py-2 shadow-lg backdrop-blur-xs',
          'animate-in fade-in-0 slide-in-from-bottom-2 duration-base ease-out-soft',
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{count.toLocaleString()} selected</span>
          {unselectedVisibleCount > 0 && (
            <button
              type="button"
              className="rounded-sm text-xs text-acc underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-acc/35"
              onClick={onSelectAllVisible}
            >
              Select all {(count + unselectedVisibleCount).toLocaleString()} shown
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {children}
          <Button size="sm" variant="outline" className="h-ctl" onClick={onClear}>Clear</Button>
        </div>
      </div>
    </div>
  );
}
