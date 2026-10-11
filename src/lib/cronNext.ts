/**
 * Tính các lần chạy tiếp theo của một biểu thức cron — cho phần "Next runs"
 * của Cron Generator. Mô tả bằng lời ("every 5 minutes") không đủ để chắc một
 * biểu thức đúng ý; nhìn thấy năm mốc thời gian cụ thể thì đủ. Đây cũng là thứ
 * người ta mở crontab.guru để xem.
 *
 * Phạm vi hỗ trợ: `*`, `?`, danh sách `a,b`, khoảng `a-b`, bước `x/n`, tên
 * tháng/thứ, và các ký hiệu Quartz/Spring hay gặp nhất — `L` ở ngày-trong-
 * tháng (ngày cuối tháng), `xL` (thứ x cuối cùng của tháng) và `x#k` (thứ x
 * lần thứ k) ở ngày-trong-tuần. Ký hiệu hiếm (`W`, `LW`, `L-n`) trả về
 * `unsupported` để UI nói thẳng là không xem trước được, thay vì đoán sai.
 *
 * Giờ địa phương của máy — đúng giờ mà người dùng đang nhìn đồng hồ.
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

export type NextRunsResult = { runs: Date[] } | { unsupported: string };

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
const DAYS: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

/** Sau bao nhiêu ngày thì bỏ cuộc — đủ cho lịch "29/2" (≤ 8 năm giữa hai lần). */
const SEARCH_DAYS = 366 * 8;

class Unsupported extends Error {}

/** Tập giá trị của một trường số (không có ký hiệu đặc biệt). */
function parseSet(field: string, min: number, max: number, alias: (s: string) => number): Set<number> {
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
  // Quartz đánh số 1–7 (1 = CN); Linux/Spring 0–7 (0 và 7 = CN). Quy hết về 0–6.
  const toDow = (s: string) => {
    const v = num(DAYS)(s);
    if (Number.isNaN(v)) return v;
    if (flavor === 'quartz' && /^\d+$/.test(s)) return v - 1;
    return v === 7 ? 0 : v;
  };
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
      // `L` một mình ở ngày-trong-tuần = thứ Bảy (ngày cuối tuần theo Quartz).
      checks.push((d) => d.getDay() === 6);
    } else {
      plain.push(part);
    }
  }
  if (plain.length) {
    const set = new Set([...parseSet(plain.join(','), 0, 7, toDow)].map((v) => (v === 7 ? 0 : v)));
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
    // Linux (Vixie cron): khi CẢ HAI trường ngày đều bị giới hạn thì khớp MỘT
    // trong hai là đủ. Quartz/Spring: phải khớp cả hai (thường một bên là `?`).
    const dayOk: DayMatcher =
      flavor === 'linux' && !dom.any && !dow.any
        ? (d) => dom.match(d) || dow.match(d)
        : (d) => dom.match(d) && dow.match(d);

    const runs: Date[] = [];
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    for (let i = 0; i < SEARCH_DAYS && runs.length < count; i++, day.setDate(day.getDate() + 1)) {
      if (years && !years.has(day.getFullYear())) continue;
      if (!months.has(day.getMonth() + 1) || !dayOk(day)) continue;
      for (const h of hours) {
        for (const m of minutes) {
          for (const s of seconds) {
            const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, s);
            if (t > from) {
              runs.push(t);
              if (runs.length >= count) return { runs };
            }
          }
        }
      }
    }
    return { runs };
  } catch (e) {
    if (e instanceof Unsupported) return { unsupported: e.message };
    throw e;
  }
}
