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

/**
 * `searchedYears`: số năm đã quét. Ít hơn `count` lần chạy nghĩa là chỉ có
 * chừng đó lần TRONG khoảng đó — không phải "không bao giờ chạy" (lịch thưa
 * như 29/2 rơi vào thứ Hai cách nhau tới 28 năm).
 */
export type NextRunsResult = { runs: Date[]; searchedYears: number } | { unsupported: string };

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
const DAYS: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

/** Số năm quét khi không ghim năm — đủ cho lịch "29/2" (≤ 8 năm giữa hai lần). */
const SEARCH_YEARS = 8;

class Unsupported extends Error {}

/** Tập giá trị của một trường số (không có ký hiệu đặc biệt). */
/**
 * `wrap`: chu kỳ của trường vòng (thứ trong tuần = 7). Khi đầu mút cuối nhỏ hơn
 * đầu mút đầu (`SAT-SUN` = 6-0, `FRI-MON` = 5-1) thì khoảng đi vòng qua cuối
 * tuần thay vì thành tập rỗng; người gọi lấy `% wrap` trên kết quả.
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
  // Quartz đánh số 1–7 (1 = CN) → trừ 1. Linux/Spring 0–7 (0 và 7 = CN): giữ
  // NGUYÊN 7 ở bước này — quy 7→0 trước khi mở rộng phạm vi biến `5-7` thành
  // lo=5, hi=0 (tập rỗng), nên `5-7`, `SAT-SUN`, `0-7` từng ra "không chạy".
  // Việc quy 7→0 làm SAU, trên từng giá trị đã mở rộng.
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
      // `L` một mình ở ngày-trong-tuần = thứ Bảy (ngày cuối tuần theo Quartz).
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
    // Linux (Vixie cron): khi CẢ HAI trường ngày đều bị giới hạn thì khớp MỘT
    // trong hai là đủ. Quartz/Spring: phải khớp cả hai (thường một bên là `?`).
    const dayOk: DayMatcher =
      flavor === 'linux' && !dom.any && !dow.any
        ? (d) => dom.match(d) || dow.match(d)
        : (d) => dom.match(d) && dow.match(d);

    // Ghim năm (Quartz) thì quét tới hết năm lớn nhất được phép — `… 2099` cách
    // xa hơn 8 năm từng bị báo "không chạy". Không ghim thì quét SEARCH_YEARS năm.
    const lastYear = years ? Math.max(...years) : from.getFullYear() + SEARCH_YEARS;
    const searchedYears = lastYear - from.getFullYear();
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
