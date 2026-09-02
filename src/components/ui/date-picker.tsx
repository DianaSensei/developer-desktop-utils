import * as React from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import {
  addMonths, format, isSameDay, isSameMonth, parseISO,
  startOfMonth, startOfWeek, addDays,
} from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useDismissable } from '@/hooks/useDismissable';

// ---------------------------------------------------------------------------
// Cross-platform date picker — replaces the native <input type="date">.
// A button shows the selected date and opens a month-grid calendar popover.
// Value is an ISO date string (yyyy-MM-dd); identical on every OS.
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface DatePickerProps {
  /** ISO date string, e.g. "2026-06-17". Empty string = no selection. */
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  /** Render the calendar directly (no trigger button / popover). */
  inline?: boolean;
  /** Show month + year dropdowns (good for far-back dates like a birth date). */
  monthYearNav?: boolean;
}

export function DatePicker({ value, onChange, disabled, className, placeholder = 'Pick a date', inline = false, monthYearNav = false }: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = useDismissable<HTMLDivElement>(open, () => setOpen(false));

  const selected = React.useMemo(() => {
    if (!value) return null;
    const d = parseISO(value);
    return isNaN(d.getTime()) ? null : d;
  }, [value]);

  const [viewMonth, setViewMonth] = React.useState(() => startOfMonth(selected ?? new Date()));
  React.useEffect(() => { if (selected) setViewMonth(startOfMonth(selected)); }, [selected]);

  // 6 weeks × 7 days grid covering the visible month.
  const gridStart = startOfWeek(startOfMonth(viewMonth));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = new Date();

  const years = React.useMemo(() => {
    const cy = new Date().getFullYear();
    const arr: number[] = [];
    for (let y = cy + 10; y >= 1900; y--) arr.push(y);
    return arr;
  }, []);

  const pick = (d: Date) => {
    onChange(format(d, 'yyyy-MM-dd'));
    setOpen(false);
  };

  const calendar = (
    <>
      {/* Month nav */}
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setViewMonth((m) => addMonths(m, -1))}
          className="shrink-0 rounded-md p-1 text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {monthYearNav ? (
          <div className="flex flex-1 gap-1">
            <Select value={String(viewMonth.getMonth())} onValueChange={(v) => setViewMonth(new Date(viewMonth.getFullYear(), Number(v), 1))}>
              <SelectTrigger className="h-ctl flex-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((mn, i) => <SelectItem key={i} value={String(i)}>{mn}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={String(viewMonth.getFullYear())} onValueChange={(v) => setViewMonth(new Date(Number(v), viewMonth.getMonth(), 1))}>
              <SelectTrigger className="h-ctl w-[74px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <span className="flex-1 text-center text-sm font-medium">{format(viewMonth, 'MMMM yyyy')}</span>
        )}
        <button
          type="button"
          onClick={() => setViewMonth((m) => addMonths(m, 1))}
          className="shrink-0 rounded-md p-1 text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1 text-center text-[11px] font-medium text-fg-mute">{w}</div>
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
                'h-ctl rounded-md text-xs transition-colors',
                !inMonth && 'text-fg-mute/40',
                isSel
                  ? 'bg-acc font-semibold text-acc-fg'
                  : 'hover:bg-bg-2',
                !isSel && isToday && 'font-semibold text-acc ring-1 ring-acc/40',
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      {/* Today shortcut — also jumps the visible month to today */}
      <button
        type="button"
        onClick={() => { setViewMonth(startOfMonth(today)); pick(today); }}
        className="mt-2 w-full rounded-md border py-1 text-xs text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg"
      >
        Today
      </button>
    </>
  );

  if (inline) {
    return <div ref={wrapRef} className={cn('w-60 rounded-lg border bg-card p-3', className)}>{calendar}</div>;
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          'flex h-ctl-lg items-center gap-2 rounded-md border border-sunk bg-card px-2.5 text-sm shadow-sm',
          'focus:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-bg-2/50',
          className,
        )}
      >
        <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
        <span className={cn('truncate', !selected && 'text-fg-mute')}>
          {selected ? format(selected, 'MMM d, yyyy') : placeholder}
        </span>
      </button>

      {open && !disabled && (
        <div className="absolute z-50 mt-1.5 w-64 rounded-lg border bg-card p-3 shadow-xl">
          {calendar}
        </div>
      )}
    </div>
  );
}
