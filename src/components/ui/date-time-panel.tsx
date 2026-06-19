import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { DatePicker } from './date-picker';
import { TimePicker } from './time-picker';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// DateTimePanel — a self-contained, confirm-on-apply date + time picker panel.
// Left: month-grid calendar (with month/year dropdowns). Right: HR/MIN/SEC
// scroll columns. Below: a timezone-aware preview and Cancel / Confirm.
//
// Reusable anywhere a full date+time selection is needed (drop it inside your
// own popover/modal). All times are interpreted in `tz` (default: local).
// ---------------------------------------------------------------------------

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Minutes by which `tz` local time is AHEAD of UTC (positive = east of UTC).
function tzOffsetMinutes(date: Date, tz: string): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = date.toLocaleString('en-US', { timeZone: tz });
  return (new Date(tzStr).getTime() - new Date(utcStr).getTime()) / 60000;
}

// Format an absolute Date as wall-clock time in `tz`.
function formatInTz(date: Date, tz: string, fmt: string): string {
  const offset = tzOffsetMinutes(date, tz);
  return format(new Date(date.getTime() + offset * 60000), fmt);
}

function tzShortLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

const p2 = (n: number) => String(n).padStart(2, '0');

export interface DateTimePanelProps {
  /** The date+time to seed the panel with. */
  value: Date;
  onConfirm: (d: Date) => void;
  onCancel?: () => void;
  /** Timezone the wall-clock values are interpreted in. Default: local. */
  tz?: string;
  /** Include a seconds column. Default: true. */
  showSeconds?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  className?: string;
}

export function DateTimePanel({
  value,
  onConfirm,
  onCancel,
  tz = LOCAL_TZ,
  showSeconds = true,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  className,
}: DateTimePanelProps) {
  // Seed from the wall-clock representation of `value` in `tz`.
  const initWall = useMemo(() => new Date(formatInTz(value, tz, 'yyyy-MM-dd HH:mm:ss')), [value, tz]);

  const [selYear, setSelYear] = useState(initWall.getFullYear());
  const [selMonth, setSelMonth] = useState(initWall.getMonth());
  const [selDay, setSelDay] = useState(initWall.getDate());
  const [hour, setHour] = useState(initWall.getHours());
  const [minute, setMinute] = useState(initWall.getMinutes());
  const [second, setSecond] = useState(initWall.getSeconds());

  const dateISO = `${selYear}-${p2(selMonth + 1)}-${p2(selDay)}`;
  const timeStr = showSeconds
    ? `${p2(hour)}:${p2(minute)}:${p2(second)}`
    : `${p2(hour)}:${p2(minute)}`;

  const handleConfirm = () => {
    const utcGuess = new Date(Date.UTC(selYear, selMonth, selDay, hour, minute, second));
    const offset = tzOffsetMinutes(utcGuess, tz);
    onConfirm(new Date(utcGuess.getTime() - offset * 60000));
  };

  // Match the time column's height to the calendar exactly (the time list then
  // fills + scrolls within that height rather than dictating its own).
  const dateRef = useRef<HTMLDivElement>(null);
  const [dateH, setDateH] = useState<number>();
  useLayoutEffect(() => {
    const el = dateRef.current;
    if (!el) return;
    const update = () => setDateH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={cn('rounded-md border bg-card p-3 shadow-lg space-y-3', className)}>
      <div className="flex items-start gap-3">
        {/* Date (left) — the height reference */}
        <div ref={dateRef}>
          <DatePicker
            inline
            monthYearNav
            value={dateISO}
            onChange={(iso) => {
              const [y, mo, da] = iso.split('-').map(Number);
              if (y && mo && da) { setSelYear(y); setSelMonth(mo - 1); setSelDay(da); }
            }}
          />
        </div>

        {/* Time (right) — constrained to the calendar's height */}
        <div style={dateH ? { height: dateH } : undefined}>
          <TimePicker
            inline
            showSeconds={showSeconds}
            value={timeStr}
            onChange={(t) => {
              const [h, m, s] = t.split(':').map(Number);
              setHour(h || 0); setMinute(m || 0); setSecond(s || 0);
            }}
          />
        </div>
      </div>

      {/* Preview */}
      <div className="border-t pt-1.5 text-center font-mono text-[10px] text-muted-foreground">
        {dateISO} {timeStr}{' '}
        <span className="text-sky-500 dark:text-sky-400">{tzShortLabel(tz) || tz}</span>
      </div>

      {/* Actions */}
      <div className="flex gap-2 border-t pt-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
