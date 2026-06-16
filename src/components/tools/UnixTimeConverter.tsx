import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Copy, RotateCcw, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, Calendar, Info, Timer,
} from 'lucide-react';
import {
  format, parseISO, fromUnixTime, getUnixTime,
  startOfDay, endOfDay, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, startOfYear, endOfYear,
  getDaysInMonth, getDay, isSameDay, getWeekOfMonth,
  differenceInMilliseconds, differenceInSeconds, differenceInMinutes,
  differenceInHours, differenceInDays, differenceInWeeks,
  differenceInMonths, differenceInYears,
  intervalToDuration,
} from 'date-fns';
import { usePersistentState } from '@/hooks/usePersistentState';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';

// ─── constants ────────────────────────────────────────────────────────────

const TIMEZONES = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore',
  'Asia/Tokyo', 'Asia/Shanghai',
  'Australia/Sydney', 'Pacific/Auckland',
];

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['Mo','Tu','We','Th','Fr','Sa','Su'];
const THIS_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 101 }, (_, i) => THIS_YEAR - 50 + i);

// ─── helpers ──────────────────────────────────────────────────────────────

// Minutes by which tz local time is AHEAD of UTC (positive = east of UTC)
function tzOffsetMinutes(date: Date, tz: string): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr  = date.toLocaleString('en-US', { timeZone: tz });
  return (new Date(tzStr).getTime() - new Date(utcStr).getTime()) / 60000;
}

function getLocalTzLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: tz, timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch { return ''; }
}

// Format a UTC Date into wall-clock display for the given timezone
function formatInTz(date: Date, tz: string, fmt: string): string {
  try {
    const offset = tzOffsetMinutes(date, tz);
    return format(new Date(date.getTime() + offset * 60000), fmt);
  } catch { return format(date, fmt); }
}

// Parse a date string whose components are expressed in `tz` local time
function parseInTz(str: string, tz: string): Date | null {
  const s = str.trim();
  if (!s) return null;

  // Unix timestamps are absolute — no tz adjustment
  if (/^\d{10}$/.test(s)) return fromUnixTime(parseInt(s));
  if (/^\d{13}$/.test(s)) return new Date(parseInt(s));

  // Time-only: attach today's date (in tz context)
  const timeOnly = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (timeOnly) {
    const todayInTz = formatInTz(new Date(), tz, 'yyyy-MM-dd');
    return parseInTz(`${todayInTz} ${s}`, tz);
  }

  // Parse naive components then reinterpret in tz
  let naive: Date | null = null;
  try {
    naive = s.includes('T') ? parseISO(s) : new Date(s);
    if (isNaN(naive.getTime())) naive = null;
  } catch { /* */ }
  if (!naive) return null;

  // Extract components as typed (ignoring local system offset)
  const yr = naive.getFullYear(), mo = naive.getMonth(), dy = naive.getDate();
  const hr = naive.getHours(), mn = naive.getMinutes(), sc = naive.getSeconds();

  // Treat those components as being in `tz`; find UTC equivalent
  const utcGuess = new Date(Date.UTC(yr, mo, dy, hr, mn, sc));
  const offset = tzOffsetMinutes(utcGuess, tz);
  return new Date(utcGuess.getTime() - offset * 60000);
}

function formatRFC3339InTz(date: Date, tz: string): string {
  const offset = tzOffsetMinutes(date, tz);
  const wall = formatInTz(date, tz, "yyyy-MM-dd'T'HH:mm:ss");
  if (offset === 0) return `${wall}Z`;
  const sign = offset > 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${wall}${sign}${hh}:${mm}`;
}

function tryFormatInTz(date: Date, tz: string, fmt: string): string | null {
  try {
    const result = formatInTz(date, tz, fmt);
    // date-fns returns the format string unchanged when it has no valid tokens
    if (result === fmt && fmt.length > 0) return null;
    return result;
  } catch { return null; }
}

function humanReadableDuration(a: Date, b: Date): string {
  const [earlier, later] = a <= b ? [a, b] : [b, a];
  const dur = intervalToDuration({ start: earlier, end: later });
  const parts = [
    dur.years   && `${dur.years} year${dur.years !== 1 ? 's' : ''}`,
    dur.months  && `${dur.months} month${dur.months !== 1 ? 's' : ''}`,
    dur.days    && `${dur.days} day${dur.days !== 1 ? 's' : ''}`,
    dur.hours   && `${dur.hours} hour${dur.hours !== 1 ? 's' : ''}`,
    dur.minutes && `${dur.minutes} minute${dur.minutes !== 1 ? 's' : ''}`,
    dur.seconds && `${dur.seconds} second${dur.seconds !== 1 ? 's' : ''}`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : '0 seconds';
}

const UNIT_COLORS = [
  'text-violet-500 dark:text-violet-400',   // years
  'text-blue-500 dark:text-blue-400',       // months
  'text-sky-500 dark:text-sky-400',         // days
  'text-amber-500 dark:text-amber-400',     // hours
  'text-orange-500 dark:text-orange-400',   // minutes
  'text-rose-500 dark:text-rose-400',       // seconds
] as const;

function DurationParts({ a, b }: { a: Date; b: Date }) {
  const [earlier, later] = a <= b ? [a, b] : [b, a];
  const dur = intervalToDuration({ start: earlier, end: later });
  const parts = [
    dur.years   && { text: `${dur.years} ${dur.years !== 1 ? 'years' : 'year'}`,     color: UNIT_COLORS[0] },
    dur.months  && { text: `${dur.months} ${dur.months !== 1 ? 'months' : 'month'}`, color: UNIT_COLORS[1] },
    dur.days    && { text: `${dur.days} ${dur.days !== 1 ? 'days' : 'day'}`,         color: UNIT_COLORS[2] },
    dur.hours   && { text: `${dur.hours} ${dur.hours !== 1 ? 'hours' : 'hour'}`,     color: UNIT_COLORS[3] },
    dur.minutes && { text: `${dur.minutes} ${dur.minutes !== 1 ? 'minutes' : 'minute'}`, color: UNIT_COLORS[4] },
    dur.seconds && { text: `${dur.seconds} ${dur.seconds !== 1 ? 'seconds' : 'second'}`, color: UNIT_COLORS[5] },
  ].filter(Boolean) as { text: string; color: string }[];

  if (!parts.length) return <span className={UNIT_COLORS[5]}>0 sec</span>;
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          <span className={cn('font-semibold font-mono', p.color)}>{p.text}</span>
          {i < parts.length - 1 && <span className="text-muted-foreground/50 mx-0.5">·</span>}
        </span>
      ))}
    </>
  );
}

function buildCalGrid(monthDate: Date): (number | null)[] {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startOffset = (getDay(firstDay) + 6) % 7; // Mon=0
  const days = getDaysInMonth(firstDay);
  const cells: (number | null)[] = Array(startOffset).fill(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ─── format / boundary config ─────────────────────────────────────────────

interface FormatRow {
  label: string;
  description: string;
  tzSensitive: boolean;
  value: (d: Date, tz: string) => string;
}

const FORMAT_ROWS: FormatRow[] = [
  {
    label: 'Unix (s)', tzSensitive: false,
    description: 'Integer seconds since 00:00:00 UTC, 1 Jan 1970. Timezone-independent; identical for every tz.',
    value: (d) => getUnixTime(d).toString(),
  },
  {
    label: 'Unix (ms)', tzSensitive: false,
    description: 'Milliseconds since the Unix epoch. Multiply Unix (s) by 1000. Timezone-independent.',
    value: (d) => d.getTime().toString(),
  },
  {
    label: 'ISO 8601', tzSensitive: false,
    description: 'Full ISO 8601 in UTC: YYYY-MM-DDTHH:mm:ss.sssZ. Always ends in Z (zero UTC offset). Timezone-independent.',
    value: (d) => d.toISOString(),
  },
  {
    label: 'ISO 8601 (local)', tzSensitive: true,
    description: 'ISO 8601 extended with local timezone offset (±HH:MM). Same moment as ISO 8601, but expressed in the chosen timezone. Example: 2026-06-14T15:30:00+07:00.',
    value: (d, tz) => formatRFC3339InTz(d, tz),
  },
  {
    label: 'RFC 2822', tzSensitive: false,
    description: 'Email / HTTP date format defined in RFC 2822. Always expressed in UTC (GMT). Example: Sat, 14 Jun 2026 08:30:00 GMT.',
    value: (d) => d.toUTCString(),
  },
  {
    label: 'RFC 3339', tzSensitive: true,
    description: 'Internet timestamp (RFC 3339 / RFC 8601 profile). Like ISO 8601 extended but stricter: requires explicit offset or Z, no fractional seconds by default. Example: 2026-06-14T15:30:00+07:00.',
    value: (d, tz) => formatRFC3339InTz(d, tz),
  },
  {
    label: 'Date', tzSensitive: true,
    description: 'Date-only component in the selected timezone: YYYY-MM-DD. Changes when the timezone crosses midnight.',
    value: (d, tz) => formatInTz(d, tz, 'yyyy-MM-dd'),
  },
  {
    label: 'Date (long)', tzSensitive: true,
    description: 'Human-readable date with full month name. Example: June 14, 2026.',
    value: (d, tz) => formatInTz(d, tz, 'MMMM d, yyyy'),
  },
  {
    label: 'Time', tzSensitive: true,
    description: '24-hour wall-clock time in the selected timezone: HH:mm:ss.',
    value: (d, tz) => formatInTz(d, tz, 'HH:mm:ss'),
  },
  {
    label: 'Time (12 h)', tzSensitive: true,
    description: '12-hour clock with AM/PM in the selected timezone. Example: 03:30:00 PM.',
    value: (d, tz) => formatInTz(d, tz, 'hh:mm:ss a'),
  },
  {
    label: 'DateTime', tzSensitive: true,
    description: 'Combined date and time, space-separated: YYYY-MM-DD HH:mm:ss. Common SQL / log format.',
    value: (d, tz) => formatInTz(d, tz, 'yyyy-MM-dd HH:mm:ss'),
  },
  {
    label: 'Day of week', tzSensitive: true,
    description: 'Full weekday name in the selected timezone. The day can differ from UTC near midnight.',
    value: (d, tz) => formatInTz(d, tz, 'EEEE'),
  },
  {
    label: 'Week of year', tzSensitive: true,
    description: 'ISO week number (1–53). Week 1 is the week containing the first Thursday of the year (Mon-first weeks).',
    value: (d, tz) => `Week ${formatInTz(d, tz, 'w')} of ${formatInTz(d, tz, 'yyyy')}`,
  },
  {
    label: 'Week of month', tzSensitive: true,
    description: 'Which week within the month the date falls in (1–5), counting Mon-first weeks.',
    value: (d, tz) => {
      const wall = new Date(formatInTz(d, tz, 'yyyy-MM-dd HH:mm:ss'));
      const w = getWeekOfMonth(wall, { weekStartsOn: 1 });
      return `Week ${w} of ${formatInTz(d, tz, 'MMMM yyyy')}`;
    },
  },
];

const BOUNDARY_PAIRS: [string, (d: Date) => Date, (d: Date) => Date][] = [
  ['Day',   startOfDay,   endOfDay],
  ['Week',  (d) => startOfWeek(d, { weekStartsOn: 1 }), (d) => endOfWeek(d, { weekStartsOn: 1 })],
  ['Month', startOfMonth, endOfMonth],
  ['Year',  startOfYear,  endOfYear],
];

// ─── sub-components ────────────────────────────────────────────────────────

function InfoTip({ text }: { text: string }) {
  return (
    <span className="relative group/tip inline-flex items-center">
      <Info className="h-2.5 w-2.5 text-muted-foreground/40 hover:text-muted-foreground cursor-help transition-colors" />
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
        hidden group-hover/tip:block w-52 rounded-md border bg-popover px-2.5 py-2
        text-[10px] leading-relaxed text-popover-foreground shadow-md">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-border" />
      </span>
    </span>
  );
}

function CopyValue({ value, dim = false }: { value: string; dim?: boolean }) {
  return (
    <div className="flex items-center gap-1 group min-w-0">
      <span className={cn('font-mono text-xs truncate flex-1', dim && 'text-muted-foreground')}>{value}</span>
      {!dim && (
        <button
          onClick={() => copyToClipboard(value)}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted shrink-0"
        >
          <Copy className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function Section({ title, icon, open, onToggle, children }: {
  title: string; icon?: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border rounded-md px-3">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">{icon}{title}</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

function TzSelect({ label, value, onChange, availableTzs }: {
  label: string; value: string; onChange: (v: string) => void; availableTzs: string[];
}) {
  return (
    <div className="flex items-center gap-2 flex-1">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="flex-1 h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {availableTzs.map((t) => {
            const offset = getLocalTzLabel(t);
            return <SelectItem key={t} value={t}>{t}{offset ? ` (${offset})` : ''}</SelectItem>;
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Date/Time Picker (compact, confirm-on-apply) ─────────────────────────

function NumField({ label, value, min, max, set }: {
  label: string; value: number; min: number; max: number; set: (n: number) => void;
}) {
  const wrap = (n: number) => n < min ? max : n > max ? min : n;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className="flex flex-col items-stretch border rounded bg-background overflow-hidden">
        <button type="button" onClick={() => set(wrap(value + 1))}
          className="flex justify-center py-0.5 hover:bg-muted text-muted-foreground transition-colors">
          <ChevronUp className="h-3 w-3" />
        </button>
        <input
          type="number" min={min} max={max}
          value={String(value).padStart(2, '0')}
          onChange={(e) => { const n = parseInt(e.target.value); if (!isNaN(n)) set(wrap(n)); }}
          className="text-center font-mono text-xs bg-transparent py-0.5 border-y [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none outline-none"
        />
        <button type="button" onClick={() => set(wrap(value - 1))}
          className="flex justify-center py-0.5 hover:bg-muted text-muted-foreground transition-colors">
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function DateTimePicker({ initialValue, tz, onConfirm, onCancel }: {
  initialValue: Date;
  tz: string;
  onConfirm: (d: Date) => void;
  onCancel: () => void;
}) {
  const initWall = useMemo(() => {
    const s = formatInTz(initialValue, tz, 'yyyy-MM-dd HH:mm:ss');
    return new Date(s);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [viewYear,  setViewYear]  = useState(initWall.getFullYear());
  const [viewMonth, setViewMonth] = useState(initWall.getMonth());
  const [selYear,   setSelYear]   = useState(initWall.getFullYear());
  const [selMonth,  setSelMonth]  = useState(initWall.getMonth());
  const [selDay,    setSelDay]    = useState(initWall.getDate());
  const [hour,      setHour]      = useState(initWall.getHours());
  const [minute,    setMinute]    = useState(initWall.getMinutes());
  const [second,    setSecond]    = useState(initWall.getSeconds());

  const grid = useMemo(() => buildCalGrid(new Date(viewYear, viewMonth, 1)), [viewYear, viewMonth]);
  const todayWall = useMemo(() => new Date(formatInTz(new Date(), tz, 'yyyy-MM-dd HH:mm:ss')), [tz]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const pickDay = (day: number) => {
    setSelDay(day); setSelMonth(viewMonth); setSelYear(viewYear);
  };

  const handleConfirm = () => {
    const utcGuess = new Date(Date.UTC(selYear, selMonth, selDay, hour, minute, second));
    const offset = tzOffsetMinutes(utcGuess, tz);
    onConfirm(new Date(utcGuess.getTime() - offset * 60000));
  };

  return (
    <div className="w-64 rounded-md border bg-card shadow-lg p-3 space-y-2">

      {/* Month / Year nav */}
      <div className="flex items-center gap-1">
        <button type="button" onClick={prevMonth}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <div className="flex flex-1 gap-1">
          <Select value={String(viewMonth)} onValueChange={(v) => { const m = parseInt(v); setViewMonth(m); setSelMonth(m); }}>
            <SelectTrigger className="flex-1 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(viewYear)} onValueChange={(v) => { const y = parseInt(v); setViewYear(y); setSelYear(y); }}>
            <SelectTrigger className="w-16 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <button type="button" onClick={nextMonth}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-px">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-0.5">{d}</div>
        ))}
        {grid.map((day, i) => {
          if (!day) return <div key={i} />;
          const isSel = day === selDay && viewMonth === selMonth && viewYear === selYear;
          const isToday = isSameDay(new Date(viewYear, viewMonth, day), todayWall);
          return (
            <button key={i} type="button" onClick={() => pickDay(day)}
              className={cn(
                'text-xs rounded py-1 transition-colors w-full',
                isSel
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : isToday
                  ? 'border border-primary/50 text-primary hover:bg-muted'
                  : 'hover:bg-muted text-foreground'
              )}>
              {day}
            </button>
          );
        })}
      </div>

      {/* Time row */}
      <div className="grid grid-cols-3 gap-1.5 border-t pt-2">
        <NumField label="Hour"   value={hour}   min={0} max={23} set={setHour}   />
        <NumField label="Minute" value={minute} min={0} max={59} set={setMinute} />
        <NumField label="Second" value={second} min={0} max={59} set={setSecond} />
      </div>

      {/* Preview */}
      <div className="border-t pt-1.5 text-center font-mono text-[10px] text-muted-foreground">
        {selYear}-{String(selMonth+1).padStart(2,'0')}-{String(selDay).padStart(2,'0')}
        {' '}
        {String(hour).padStart(2,'0')}:{String(minute).padStart(2,'0')}:{String(second).padStart(2,'0')}
        {' '}
        <span className="text-sky-500 dark:text-sky-400">{getLocalTzLabel(tz) || tz}</span>
      </div>

      {/* Actions */}
      <div className="flex gap-2 border-t pt-1.5">
        <button type="button" onClick={onCancel}
          className="flex-1 rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors">
          Cancel
        </button>
        <button type="button" onClick={handleConfirm}
          className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors">
          Confirm
        </button>
      </div>
    </div>
  );
}

// ─── Diff Date Input (picker-enabled, no live mode) ───────────────────────

function DiffDateInput({ value, onChange, tz }: {
  value: string; onChange: (v: string) => void; tz: string;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [snapshot, setSnapshot] = useState<Date | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => parseInTz(value, tz), [value, tz]);
  const hasError = !!value.trim() && !parsed;

  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPicker]);

  return (
    <div className="relative" ref={ref}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Unix timestamp, ISO 8601, YYYY-MM-DD HH:mm:ss, …"
        className={cn('font-mono text-xs h-8 pr-9', hasError && 'border-destructive')}
      />
      <button
        onClick={() => {
          if (showPicker) { setShowPicker(false); return; }
          setSnapshot(parsed ?? new Date());
          setShowPicker(true);
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        <Calendar className="h-3 w-3" />
      </button>
      {showPicker && snapshot && (
        <div className="absolute top-full left-0 z-50 mt-1">
          <DateTimePicker
            initialValue={snapshot}
            tz={tz}
            onConfirm={(d) => {
              onChange(formatInTz(d, tz, "yyyy-MM-dd'T'HH:mm:ss"));
              setShowPicker(false);
              setSnapshot(null);
            }}
            onCancel={() => { setShowPicker(false); setSnapshot(null); }}
          />
        </div>
      )}
    </div>
  );
}

// ─── main ──────────────────────────────────────────────────────────────────

export function DateTimeTool() {
  const [rawInput, setRawInput] = usePersistentState('devtool:datetime:raw', '');
  const [inputTz, setInputTz] = usePersistentState('devtool:datetime:inputTz', LOCAL_TZ || 'UTC');
  const [outputTz, setOutputTz] = usePersistentState('devtool:datetime:outputTz', LOCAL_TZ || 'UTC');
  const [showPicker, setShowPicker] = useState(false);
  // frozen snapshot of parsedDate at the moment picker was opened
  const [pickerSnapshot, setPickerSnapshot] = useState<Date | null>(null);

  const [diffA, setDiffA] = usePersistentState('devtool:datetime:diffA', '');
  const [diffB, setDiffB] = usePersistentState('devtool:datetime:diffB', '');
  const [showFormats, setShowFormats] = usePersistentState('devtool:datetime:showFormats', true);
  const [showBoundaries, setShowBoundaries] = usePersistentState('devtool:datetime:showBoundaries', true);
  const [showDiff, setShowDiff] = usePersistentState('devtool:datetime:showDiff', true);
  const [customFmt, setCustomFmt] = usePersistentState('devtool:datetime:customFmt', '');

  const [isLive, setIsLive] = useState(true);
  const [liveDate, setLiveDate] = useState(new Date());

  // Live tick
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      setLiveDate(now);
      if (isLive) setRawInput(formatInTz(now, inputTz, "yyyy-MM-dd'T'HH:mm:ss"));
    }, 1000);
    return () => clearInterval(id);
  }, [isLive, inputTz, setRawInput]);

  // Init: if empty, go live
  useEffect(() => {
    if (!rawInput.trim()) {
      setIsLive(true);
      setRawInput(formatInTz(new Date(), inputTz, "yyyy-MM-dd'T'HH:mm:ss"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRawChange = (val: string) => {
    setRawInput(val);
    setIsLive(!val.trim());
  };

  const resetToNow = useCallback(() => {
    setIsLive(true);
    setRawInput(formatInTz(new Date(), inputTz, "yyyy-MM-dd'T'HH:mm:ss"));
  }, [setRawInput, inputTz]);

  // When inputTz changes, update raw display to show same UTC moment in new tz
  const prevInputTz = useRef(inputTz);
  useEffect(() => {
    if (prevInputTz.current === inputTz) return;
    prevInputTz.current = inputTz;
    if (isLive) return; // live mode handles it via the interval
    const d = parseInTz(rawInput, prevInputTz.current);
    if (d) setRawInput(formatInTz(d, inputTz, "yyyy-MM-dd'T'HH:mm:ss"));
  }, [inputTz]); // eslint-disable-line react-hooks/exhaustive-deps

  // Authoritative UTC Date
  const parsedDate: Date | null = useMemo(() => {
    if (isLive) return liveDate;
    return parseInTz(rawInput, inputTz);
  }, [isLive, liveDate, rawInput, inputTz]);

  const openPicker = useCallback(() => {
    setPickerSnapshot(parsedDate ?? new Date());
    setShowPicker(true);
  }, [parsedDate]);

  const confirmPicker = useCallback((d: Date) => {
    setIsLive(false);
    setRawInput(formatInTz(d, inputTz, "yyyy-MM-dd'T'HH:mm:ss"));
    setShowPicker(false);
    setPickerSnapshot(null);
  }, [setRawInput, inputTz]);

  const cancelPicker = useCallback(() => {
    setShowPicker(false);
    setPickerSnapshot(null);
  }, []);

  const isTimestamp = /^\d{10,13}$/.test(rawInput.trim());
  const parseError = !isLive && !!rawInput.trim() && !parsedDate;
  const showHint = !isLive && isTimestamp && !!parsedDate;
  const tzsDiffer = inputTz !== outputTz;

  const availableTzs = useMemo(() => (
    TIMEZONES.includes(LOCAL_TZ) ? TIMEZONES : [LOCAL_TZ, ...TIMEZONES]
  ), []);

  const diffResult = useMemo(() => {
    const a = parseInTz(diffA, inputTz);
    const b = parseInTz(diffB, inputTz);
    if (!a || !b) return null;
    const [earlier, later, sign] = a <= b ? [a, b, 1] : [b, a, -1];
    const abs = (n: number) => (sign * n) || 0;
    return {
      Milliseconds: abs(differenceInMilliseconds(later, earlier)),
      Seconds:      abs(differenceInSeconds(later, earlier)),
      Minutes:      abs(differenceInMinutes(later, earlier)),
      Hours:        abs(differenceInHours(later, earlier)),
      Days:         abs(differenceInDays(later, earlier)),
      Weeks:        abs(differenceInWeeks(later, earlier)),
      Months:       abs(differenceInMonths(later, earlier)),
      Years:        abs(differenceInYears(later, earlier)),
    };
  }, [diffA, diffB, inputTz]);

  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node))
        setShowPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPicker, setShowPicker]);

  // Boundary calculation: apply boundary fn in inputTz space, then convert back
  const applyBoundaryInTz = (fn: (d: Date) => Date, d: Date, tz: string): Date => {
    // Convert UTC date to naive local in tz
    const wallStr = formatInTz(d, tz, 'yyyy-MM-dd HH:mm:ss');
    const naive = new Date(wallStr);
    const bounded = fn(naive);
    // Re-interpret bounded components as tz time
    const utcGuess = new Date(Date.UTC(
      bounded.getFullYear(), bounded.getMonth(), bounded.getDate(),
      bounded.getHours(), bounded.getMinutes(), bounded.getSeconds()
    ));
    const offset = tzOffsetMinutes(utcGuess, tz);
    return new Date(utcGuess.getTime() - offset * 60000);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-4">

        {/* Input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Date / Time</Label>
              {isLive && (
                <span className="flex items-center gap-1 text-[10px] text-primary font-medium">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  LIVE
                </span>
              )}
            </div>
            <button
              onClick={resetToNow}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to now
            </button>
          </div>

          <div className="relative" ref={pickerRef}>
            <Input
              value={rawInput}
              onChange={(e) => handleRawChange(e.target.value)}
              placeholder="Unix timestamp, ISO 8601, YYYY-MM-DD HH:mm:ss, June 14 2026, …"
              className={cn('font-mono text-sm pr-9', parseError && 'border-destructive')}
            />
            <button
              onClick={() => showPicker ? cancelPicker() : openPicker()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <Calendar className="h-3.5 w-3.5" />
            </button>

            {showPicker && pickerSnapshot && (
              <div className="absolute top-full left-0 z-50 mt-1">
                <DateTimePicker
                  initialValue={pickerSnapshot}
                  tz={inputTz}
                  onConfirm={confirmPicker}
                  onCancel={cancelPicker}
                />
              </div>
            )}
          </div>

          {parseError && (
            <p className="text-xs text-destructive">
              Could not parse — try a unix timestamp, ISO 8601, or "June 14 2026 14:30"
            </p>
          )}
          {showHint && parsedDate && (
            <p className="text-xs text-muted-foreground font-mono">→ {parsedDate.toISOString()}</p>
          )}
        </div>

        {/* Timezone selectors */}
        <div className="flex items-start gap-3">
          <div className="flex-1 space-y-0.5">
            <TzSelect label="Input TZ" value={inputTz} onChange={setInputTz} availableTzs={availableTzs} />
            {tzsDiffer && parsedDate && (
              <p className="text-[10px] font-mono text-muted-foreground">
                {formatInTz(parsedDate, inputTz, 'yyyy-MM-dd HH:mm:ss')}{' '}
                <span className="text-sky-500 dark:text-sky-400">{getLocalTzLabel(inputTz)}</span>
              </p>
            )}
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-2" />
          <div className="flex-1 space-y-0.5">
            <TzSelect label="Output TZ" value={outputTz} onChange={setOutputTz} availableTzs={availableTzs} />
            {tzsDiffer && parsedDate && (
              <p className="text-[10px] font-mono text-muted-foreground">
                {formatInTz(parsedDate, outputTz, 'yyyy-MM-dd HH:mm:ss')}{' '}
                <span className="text-amber-500 dark:text-amber-400">{getLocalTzLabel(outputTz)}</span>
              </p>
            )}
          </div>
        </div>

        {/* ── Formats ── */}
        <Section title="Formats" open={showFormats} onToggle={() => setShowFormats(!showFormats)}>
          <div className="grid grid-cols-2 gap-x-4">
            {FORMAT_ROWS.map((row) => {
              const showDual = row.tzSensitive && tzsDiffer;
              const inVal  = parsedDate ? row.value(parsedDate, inputTz)  : '—';
              const outVal = parsedDate ? row.value(parsedDate, outputTz) : '—';

              return (
                <div key={row.label} className="py-1.5 space-y-0.5 border-b last:border-b-0 [&:nth-last-child(2)]:border-b-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">{row.label}</span>
                    <InfoTip text={row.description} />
                  </div>
                  {showDual ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] w-10 shrink-0 text-sky-500 dark:text-sky-400">{getLocalTzLabel(inputTz) || 'In'}</span>
                        <CopyValue value={inVal} dim={!parsedDate} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] w-10 shrink-0 text-amber-500 dark:text-amber-400">{getLocalTzLabel(outputTz) || 'Out'}</span>
                        <CopyValue value={outVal} dim={!parsedDate} />
                      </div>
                    </>
                  ) : (
                    <CopyValue value={inVal} dim={!parsedDate} />
                  )}
                </div>
              );
            })}
          </div>
          {/* Custom format */}
          <div className="border-t mt-0.5 pt-2 space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground shrink-0 w-10">Custom</span>
              <Input
                value={customFmt}
                onChange={(e) => setCustomFmt(e.target.value)}
                placeholder="date-fns format, e.g. HH:mm:ss.SSS"
                className="h-6 text-[10px] font-mono py-0"
              />
            </div>
            {customFmt.trim() && parsedDate && (() => {
              const inVal  = tryFormatInTz(parsedDate, inputTz,  customFmt);
              const outVal = tryFormatInTz(parsedDate, outputTz, customFmt);
              if (inVal === null) return (
                <p className="text-[10px] text-destructive pl-12">invalid format string</p>
              );
              return tzsDiffer ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] w-10 shrink-0 text-sky-500 dark:text-sky-400">{getLocalTzLabel(inputTz) || 'In'}</span>
                    <CopyValue value={inVal} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] w-10 shrink-0 text-amber-500 dark:text-amber-400">{getLocalTzLabel(outputTz) || 'Out'}</span>
                    <CopyValue value={outVal ?? inVal} />
                  </div>
                </>
              ) : (
                <div className="pl-12">
                  <CopyValue value={inVal} />
                </div>
              );
            })()}
          </div>
        </Section>

        {/* ── Boundaries ── */}
        <Section title="Boundaries" open={showBoundaries} onToggle={() => setShowBoundaries(!showBoundaries)}>
          <div className="pt-1">
            <div className="grid grid-cols-[4rem_1fr_1fr] gap-2 pb-1">
              <span />
              <span className="text-[10px] font-medium text-muted-foreground">Start</span>
              <span className="text-[10px] font-medium text-muted-foreground">End</span>
            </div>
            {BOUNDARY_PAIRS.map(([label, startFn, endFn]) => {
              // Compute boundary in the inputTz context
              const s = parsedDate ? applyBoundaryInTz(startFn, parsedDate, inputTz) : null;
              const e = parsedDate ? applyBoundaryInTz(endFn,   parsedDate, inputTz) : null;

              const renderCell = (bd: Date | null) => {
                if (!bd) return <span className="text-xs text-muted-foreground">—</span>;
                const inStr  = formatInTz(bd, inputTz, 'yyyy-MM-dd HH:mm:ss');
                const outStr = formatInTz(bd, outputTz, 'yyyy-MM-dd HH:mm:ss');
                const ts = getUnixTime(bd);
                return (
                  <div className="flex flex-col gap-0.5 group">
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-xs">{inStr}</span>
                      <button onClick={() => copyToClipboard(inStr)} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted">
                        <Copy className="h-2.5 w-2.5" />
                      </button>
                    </div>
                    {tzsDiffer && inStr !== outStr && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {outStr}{' '}(<span className="text-amber-500 dark:text-amber-400">{getLocalTzLabel(outputTz)}</span>)
                      </span>
                    )}
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-[10px] text-muted-foreground">{ts}</span>
                      <button onClick={() => copyToClipboard(String(ts))} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted">
                        <Copy className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>
                );
              };

              return (
                <div key={label} className="grid grid-cols-[4rem_1fr_1fr] gap-2 py-1.5 border-t">
                  <span className="text-xs text-muted-foreground self-start pt-0.5">{label}</span>
                  {renderCell(s)}
                  {renderCell(e)}
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── Time Diff ── */}
        <Section title="Time Difference" icon={<Timer className="h-3.5 w-3.5" />} open={showDiff} onToggle={() => setShowDiff(!showDiff)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {([['From', diffA, setDiffA], ['To', diffB, setDiffB]] as const).map(([lbl, val, set]) => (
                <div key={lbl} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">{lbl}</Label>
                    <button
                      onClick={() => set(formatInTz(new Date(), inputTz, "yyyy-MM-dd'T'HH:mm:ss"))}
                      className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      now
                    </button>
                  </div>
                  <DiffDateInput value={val} onChange={set} tz={inputTz} />
                </div>
              ))}
            </div>
            {diffResult ? (() => {
              const aDate = parseInTz(diffA, inputTz)!;
              const bDate = parseInTz(diffB, inputTz)!;
              const isForward = bDate >= aDate;
              const duration = humanReadableDuration(aDate, bDate);
              return (
                <div className="space-y-2">
                  <div className="rounded-md border px-3 py-2.5 space-y-2.5">
                    {/* Timeline visual */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-foreground shrink-0">From</span>
                      <div className="flex flex-1 items-center gap-1.5 min-w-0">
                        <div className={cn('h-0.5 flex-1 rounded-full', isForward ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-red-500 dark:bg-red-400')} />
                        <span className="shrink-0 text-xs"><DurationParts a={aDate} b={bDate} /></span>
                        <div className={cn('h-0.5 flex-1 rounded-full', isForward ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-red-500 dark:bg-red-400')} />
                      </div>
                      <div className={cn('flex items-center gap-0.5 shrink-0', isForward ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400')}>
                        {isForward ? <ChevronRight className="h-4 w-4 stroke-[2.5]" /> : <ChevronLeft className="h-4 w-4 stroke-[2.5]" />}
                        <span className="text-[10px] font-semibold text-foreground">To</span>
                      </div>
                    </div>
                    {/* Plain-language explanation */}
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      {isForward ? (
                        <>The first date is <span className="font-semibold text-foreground">{duration}</span> <span className="font-semibold text-emerald-600 dark:text-emerald-400">earlier</span> than the second.</>
                      ) : (
                        <>The first date is <span className="font-semibold text-foreground">{duration}</span> <span className="font-semibold text-red-600 dark:text-red-400">later</span> than the second.</>
                      )}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 border rounded-md px-3 py-1">
                    {(Object.entries(diffResult) as [string, number][])
                      .filter(([, val]) => val !== 0)
                      .map(([label, val]) => (
                        <div key={label} className="flex flex-col py-1.5 border-b [&:nth-last-child(-n+2)]:border-b-0">
                          <span className="text-[10px] text-muted-foreground">{label}</span>
                          <CopyValue value={val.toLocaleString()} />
                        </div>
                      ))}
                  </div>
                </div>
              );
            })() : (
              <p className="text-xs text-muted-foreground">Enter two dates above to calculate the difference.</p>
            )}
          </div>
        </Section>

      </div>
    </div>
  );
}

export { DateTimeTool as UnixTimeConverter };
