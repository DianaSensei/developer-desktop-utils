import * as React from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import {
  addMonths, format, isSameDay, isSameMonth, parseISO,
  startOfMonth, startOfWeek, addDays,
} from 'date-fns';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Cross-platform date picker — replaces the native <input type="date">.
// A button shows the selected date and opens a month-grid calendar popover.
// Value is an ISO date string (yyyy-MM-dd); identical on every OS.
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export interface DatePickerProps {
  /** ISO date string, e.g. "2026-06-17". Empty string = no selection. */
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export function DatePicker({ value, onChange, disabled, className, placeholder = 'Pick a date' }: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const selected = React.useMemo(() => {
    if (!value) return null;
    const d = parseISO(value);
    return isNaN(d.getTime()) ? null : d;
  }, [value]);

  const [viewMonth, setViewMonth] = React.useState(() => startOfMonth(selected ?? new Date()));
  React.useEffect(() => { if (selected) setViewMonth(startOfMonth(selected)); }, [selected]);

  // Close on outside click / Escape.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 6 weeks × 7 days grid covering the visible month.
  const gridStart = startOfWeek(startOfMonth(viewMonth));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = new Date();

  const pick = (d: Date) => {
    onChange(format(d, 'yyyy-MM-dd'));
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          'flex h-9 items-center gap-2 rounded-md border border-input bg-card px-2.5 text-sm shadow-sm',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-muted/50',
          className,
        )}
      >
        <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>
          {selected ? format(selected, 'MMM d, yyyy') : placeholder}
        </span>
      </button>

      {open && !disabled && (
        <div className="absolute z-50 mt-1.5 w-64 rounded-lg border bg-popover p-3 shadow-xl">
          {/* Month nav */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium">{format(viewMonth, 'MMMM yyyy')}</span>
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1 text-center text-[10px] font-medium text-muted-foreground">{w}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((d) => {
              const inMonth = isSameMonth(d, viewMonth);
              const isSel = selected && isSameDay(d, selected);
              const isToday = isSameDay(d, today);
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  onClick={() => pick(d)}
                  className={cn(
                    'h-7 rounded-md text-xs transition-colors',
                    !inMonth && 'text-muted-foreground/40',
                    isSel
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : 'hover:bg-muted',
                    !isSel && isToday && 'font-semibold text-primary ring-1 ring-primary/40',
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* Today shortcut */}
          <button
            type="button"
            onClick={() => pick(today)}
            className="mt-2 w-full rounded-md border py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Today
          </button>
        </div>
      )}
    </div>
  );
}
