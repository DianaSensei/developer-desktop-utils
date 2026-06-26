// Date / time / calendar helpers shared across the time-tracking suite.
// All timestamps are epoch milliseconds in local time.

import { pad2 } from '@/lib/utils';

export const MS_MIN = 60_000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;

const uidCounter = { n: 0 };
export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${(uidCounter.n++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const pad = pad2;

// ---------------------------------------------------------------------------
// Duration formatting
// ---------------------------------------------------------------------------

/** Clock-style elapsed: H:MM:SS once past an hour, else MM:SS. */
export function fmtTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Compact total: "2h 5m", "12m", "45s". */
export function fmtTotal(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${total % 60}s`;
}

/** Decimal-hour style used by timesheet cells: "1:30", "0:00". */
export function fmtHM(ms: number): string {
  const total = Math.round(Math.max(0, ms) / MS_MIN);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${pad(m)}`;
}

/** Parse "h", "h:mm", "1.5", "90m" → milliseconds. Returns null when invalid. */
export function parseDuration(str: string): number | null {
  const s = str.trim().toLowerCase();
  if (!s) return 0;
  let m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) {
    const min = Number(m[2]);
    if (min > 59) return null;
    return (Number(m[1]) * 60 + min) * MS_MIN;
  }
  m = s.match(/^(\d+(?:\.\d+)?)\s*h?$/);
  if (m) return Math.round(Number(m[1]) * MS_HOUR);
  m = s.match(/^(\d+)\s*m$/);
  if (m) return Number(m[1]) * MS_MIN;
  return null;
}

// ---------------------------------------------------------------------------
// Clock / day formatting
// ---------------------------------------------------------------------------

export function timeOfDay(ts: number, withSeconds = true): string {
  const d = new Date(ts);
  return withSeconds
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse "HH:MM" / "HH:MM:SS" against the calendar day of `dayTs`. */
export function parseTimeOfDay(str: string, dayTs: number): number | null {
  const m = str.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] ? Number(m[3]) : 0;
  if (h > 23 || min > 59 || s > 59) return null;
  const d = new Date(dayTs);
  d.setHours(h, min, s, 0);
  return d.getTime();
}

export function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function nextMidnight(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function addDays(ts: number, n: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** "YYYY-MM-DD" for a timestamp (local). */
export function toDateInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse "YYYY-MM-DD" → day-start timestamp, or null. */
export function parseDateInput(str: string): number | null {
  const m = str.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function sameDay(a: number, b: number): boolean {
  return dayStart(a) === dayStart(b);
}

/** Minutes since midnight for an "HH:MM" string, or null when invalid. */
export function hmToMinutes(hm: string): number | null {
  const m = hm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Net working hours for a day given the work/lunch ranges (work before lunch +
 * work after lunch). Returns 0 when the ranges are invalid/inconsistent.
 */
export function workHoursForRanges(
  workStart: string,
  lunchStart: string,
  lunchEnd: string,
  workEnd: string
): number {
  const ws = hmToMinutes(workStart);
  const ls = hmToMinutes(lunchStart);
  const le = hmToMinutes(lunchEnd);
  const we = hmToMinutes(workEnd);
  if (ws == null || ls == null || le == null || we == null) return 0;
  const morning = Math.max(0, ls - ws);
  const afternoon = Math.max(0, we - le);
  return Math.round(((morning + afternoon) / 60) * 100) / 100;
}

export function dayLabel(ts: number): string {
  const diff = Math.round((dayStart(Date.now()) - dayStart(ts)) / MS_DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function shortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function monthLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function weekdayShort(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short' });
}

// ---------------------------------------------------------------------------
// Week math
// ---------------------------------------------------------------------------

/** First day (midnight) of the week containing `ts`. */
export function weekStart(ts: number, mondayStart: boolean): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0 = Sun
  const offset = mondayStart ? (dow + 6) % 7 : dow;
  d.setDate(d.getDate() - offset);
  return d.getTime();
}

/** The seven day-start timestamps of the week containing `ts`. */
export function weekDays(ts: number, mondayStart: boolean): number[] {
  const start = weekStart(ts, mondayStart);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function weekRangeLabel(ts: number, mondayStart: boolean): string {
  const days = weekDays(ts, mondayStart);
  const a = new Date(days[0]);
  const b = new Date(days[6]);
  const sameMonth = a.getMonth() === b.getMonth();
  const left = a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const right = b.toLocaleDateString(
    undefined,
    sameMonth ? { day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
  );
  return `${left} – ${right}`;
}

/** Count working days (Mon–Fri) inclusive between two day timestamps. */
export function workingDaysBetween(start: number, end: number): number {
  let count = 0;
  let cur = dayStart(start);
  const last = dayStart(end);
  while (cur <= last) {
    const dow = new Date(cur).getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur = addDays(cur, 1);
  }
  return count;
}

// ---------------------------------------------------------------------------
// Running-entry day splitting
// ---------------------------------------------------------------------------

export interface Splittable {
  id: string;
  start: number;
  end: number | null;
}

/**
 * Close any running record (`end === null`) that began on an earlier calendar
 * day, splitting it at each midnight so every record stays within one day and a
 * fresh running record continues the next day. Generic over the record shape so
 * it works on TimeEntry. Returns the SAME array reference when nothing changes,
 * making it safe to call on every tick.
 */
export function splitRunningAcrossDays<T extends Splittable>(records: T[], nowTs: number): T[] {
  let running = records.find((r) => r.end === null);
  if (!running || dayStart(running.start) >= dayStart(nowTs)) return records;

  let result: T[] = records;
  while (running && dayStart(running.start) < dayStart(nowTs)) {
    const boundary = nextMidnight(running.start);
    const closedId = running.id;
    const cont = { ...running, id: uid(), start: boundary, end: null } as T;
    result = result.map((r) => (r.id === closedId ? ({ ...r, end: boundary } as T) : r));
    result = [...result, cont];
    running = cont;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pomodoro phase + chime
// ---------------------------------------------------------------------------

export interface PomodoroPhase {
  onBreak: boolean;
  remaining: number;
}

export function pomodoroPhase(
  elapsedMs: number,
  workMinutes: number,
  breakMinutes: number
): PomodoroPhase | null {
  const cycle = (workMinutes + breakMinutes) * MS_MIN;
  if (cycle <= 0) return null;
  const inCycle = elapsedMs % cycle;
  const workMs = workMinutes * MS_MIN;
  const onBreak = inCycle >= workMs;
  return { onBreak, remaining: onBreak ? cycle - inCycle : workMs - inCycle };
}

export function playBeep() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.42);
    osc.onended = () => ctx.close();
  } catch {
    // audio unavailable — ignore
  }
}
