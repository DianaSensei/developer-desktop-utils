/**
 * Next run times of a cron expression, for the Cron Generator's "Next runs"
 * list.
 *
 * Supports `*`, `?`, lists, ranges, steps, month/day names, and Quartz/Spring
 * `L` (last day of month), `xL` (last weekday x) and `x#k` (k-th weekday x).
 * Rarer forms (`W`, `LW`, `L-n`) return `unsupported` rather than a wrong
 * guess. Uses the machine's local time.
 */

export type CronFlavor = 'linux' | 'quartz' | 'spring';

export interface CronFieldValues {
  seconds: string;
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
  year: string;
}

/**
 * `searchedYears`: how many years were searched. Fewer than `count` runs
 * means only that many fall in the window, not "never" (Feb 29 on a Monday
 * can be 28 years apart).
 *
 * `null` when the expression pins years (Quartz): every allowed year was
 * searched, so the list is complete.
 */
export type NextRunsResult = { runs: Date[]; searchedYears: number | null } | { unsupported: string };

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
const DAYS: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

/** Years searched without a year field; enough for Feb 29 (≤ 8 years apart). */
const SEARCH_YEARS = 8;

class Unsupported extends Error {}

/**
 * Values of a numeric field. `wrap` is the cycle length of a circular field
 * (days of week = 7): a range whose end is below its start (`SAT-SUN` = 6-0)
 * wraps around instead of being empty; callers take `% wrap`.
 */
function parseSet(field: string, min: number, max: number, alias: (s: string) => number, wrap?: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [base, stepStr] = part.split('/');
    const step = stepStr === undefined ? 1 : Number(stepStr);
    if (!Number.isInteger(step) || step < 1) throw new Unsupported(part);
    let lo: number;
    let hi: number;
    if (base === '*' || base === '?') {
      lo = min;
      hi = max;
    } else if (base.includes('-')) {
      const [a, b] = base.split('-');
      lo = alias(a);
      hi = alias(b);
    } else {
      lo = alias(base);
      hi = stepStr === undefined ? lo : max;
    }
    if (Number.isNaN(lo) || Number.isNaN(hi)) throw new Unsupported(part);
    if (wrap && hi < lo) hi += wrap;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

const num = (map?: Record<string, number>) => (s: string) => {
  const upper = s.toUpperCase();
  if (map && upper in map) return map[upper];
  return /^\d+$/.test(s) ? Number(s) : NaN;
};

const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
const daysInMonth = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();

type DayMatcher = (date: Date) => boolean;

function domMatcher(field: string): { any: boolean; match: DayMatcher } {
  if (field === '*' || field === '?') return { any: true, match: () => true };
  if (/W/i.test(field) || /^L-/i.test(field)) throw new Unsupported(field);
  const parts = field.split(',');
  const last = parts.some((p) => p.toUpperCase() === 'L');
  const rest = parts.filter((p) => p.toUpperCase() !== 'L');
  const set = rest.length ? parseSet(rest.join(','), 1, 31, num()) : new Set<number>();
  return {
    any: false,
    match: (d) => set.has(d.getDate()) || (last && d.getDate() === daysInMonth(d.getFullYear(), d.getMonth())),
  };
}

function dowMatcher(field: string, flavor: CronFlavor): { any: boolean; match: DayMatcher } {
  if (field === '*' || field === '?') return { any: true, match: () => true };
  // Quartz numbers days 1–7 (1 = Sunday), so subtract 1. Linux/Spring use
  // 0–7 (0 and 7 = Sunday): keep 7 while expanding ranges so `5-7` does
  // not become 5..0 (empty), then map 7 to 0 per value.
  const rawDow = (s: string) => {
    const v = num(DAYS)(s);
    if (Number.isNaN(v)) return v;
    if (flavor === 'quartz' && /^\d+$/.test(s)) return v - 1;
    return v;
  };
  const toDow = (s: string) => rawDow(s) % 7;
  const checks: DayMatcher[] = [];
  const plain: string[] = [];
  for (const part of field.split(',')) {
    const nth = /^(\w+)#(\d)$/.exec(part);
    const lastOf = /^(\w+)L$/i.exec(part);
    if (nth) {
      const dow = toDow(nth[1]);
      const k = Number(nth[2]);
      checks.push((d) => d.getDay() === dow && Math.ceil(d.getDate() / 7) === k);
    } else if (lastOf) {
      const dow = toDow(lastOf[1]);
      checks.push((d) => d.getDay() === dow && d.getDate() + 7 > daysInMonth(d.getFullYear(), d.getMonth()));
    } else if (part.toUpperCase() === 'L') {
      // `L` alone in day-of-week means Saturday in Quartz.
      checks.push((d) => d.getDay() === 6);
    } else {
      plain.push(part);
    }
  }
  if (plain.length) {
    const set = new Set([...parseSet(plain.join(','), 0, flavor === 'quartz' ? 6 : 7, rawDow, 7)].map((v) => v % 7));
    checks.push((d) => set.has(d.getDay()));
  }
  return { any: false, match: (d) => checks.some((c) => c(d)) };
}

export function nextCronRuns(
  flavor: CronFlavor,
  fields: CronFieldValues,
  from: Date = new Date(),
  count = 5,
): NextRunsResult {
  try {
    const seconds = flavor === 'linux' ? [0] : sorted(parseSet(fields.seconds, 0, 59, num()));
    const minutes = sorted(parseSet(fields.minute, 0, 59, num()));
    const hours = sorted(parseSet(fields.hour, 0, 23, num()));
    const months = parseSet(fields.month, 1, 12, num(MONTHS));
    const years = flavor === 'quartz' && fields.year.trim() ? parseSet(fields.year, 1970, 2099, num()) : null;
    const dom = domMatcher(fields.dayOfMonth);
    const dow = dowMatcher(fields.dayOfWeek, flavor);
    // Linux (Vixie cron): when both day fields are restricted, matching
    // either is enough. Quartz/Spring require both (one is usually `?`).
    const dayOk: DayMatcher =
      flavor === 'linux' && !dom.any && !dow.any
        ? (d) => dom.match(d) || dow.match(d)
        : (d) => dom.match(d) && dow.match(d);

    // With pinned years (Quartz), search through the last allowed year;
    // otherwise SEARCH_YEARS.
    const lastYear = years ? Math.max(...years) : from.getFullYear() + SEARCH_YEARS;
    const searchedYears = years ? null : SEARCH_YEARS;
    const end = years ? new Date(lastYear + 1, 0, 1) : new Date(from.getFullYear() + SEARCH_YEARS, from.getMonth(), from.getDate() + 1);
    const runs: Date[] = [];
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    for (; day < end && runs.length < count; day.setDate(day.getDate() + 1)) {
      if (years && !years.has(day.getFullYear())) continue;
      if (!months.has(day.getMonth() + 1) || !dayOk(day)) continue;
      for (const h of hours) {
        for (const m of minutes) {
          for (const s of seconds) {
            const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, s);
            if (t > from) {
              runs.push(t);
              if (runs.length >= count) return { runs, searchedYears };
            }
          }
        }
      }
    }
    return { runs, searchedYears };
  } catch (e) {
    if (e instanceof Unsupported) return { unsupported: e.message };
    throw e;
  }
}
