import { describe, expect, it } from 'vitest';
import { nextCronRuns, type CronFieldValues } from '@/lib/cronNext';

const f = (o: Partial<CronFieldValues>): CronFieldValues => ({
  seconds: '0', minute: '*', hour: '*', dayOfMonth: '*', month: '*', dayOfWeek: '*', year: '', ...o,
});
// Thứ Tư 2026-01-07 10:02:30 giờ địa phương.
const FROM = new Date(2026, 0, 7, 10, 2, 30);
const runs = (r: ReturnType<typeof nextCronRuns>) => ('runs' in r ? r.runs : []);
const hm = (d: Date) => `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

describe('nextCronRuns', () => {
  it('steps: */5 minutes', () => {
    expect(runs(nextCronRuns('linux', f({ minute: '*/5' }), FROM, 3)).map(hm)).toEqual(['1/7 10:05', '1/7 10:10', '1/7 10:15']);
  });

  it('weekday mornings, with names', () => {
    expect(runs(nextCronRuns('linux', f({ minute: '30', hour: '9', dayOfWeek: 'MON-FRI' }), FROM, 3)).map(hm))
      .toEqual(['1/8 9:30', '1/9 9:30', '1/12 9:30']);
  });

  it('linux ORs day-of-month with day-of-week when both are set', () => {
    // ngày 10 HOẶC Chủ nhật
    const r = runs(nextCronRuns('linux', f({ minute: '0', hour: '0', dayOfMonth: '10', dayOfWeek: '0' }), FROM, 3)).map(hm);
    expect(r).toEqual(['1/10 0:00', '1/11 0:00', '1/18 0:00']);
  });

  it('quartz: 1 = Sunday, seconds field, L and #', () => {
    const sun = runs(nextCronRuns('quartz', f({ seconds: '0', minute: '0', hour: '12', dayOfMonth: '?', dayOfWeek: '1' }), FROM, 1));
    expect(sun[0].getDay()).toBe(0);
    const lastDay = runs(nextCronRuns('quartz', f({ minute: '0', hour: '0', dayOfMonth: 'L', dayOfWeek: '?' }), FROM, 2)).map(hm);
    expect(lastDay).toEqual(['1/31 0:00', '2/28 0:00']);
    const secondMon = runs(nextCronRuns('quartz', f({ minute: '0', hour: '0', dayOfMonth: '?', dayOfWeek: '2#2' }), FROM, 1)).map(hm);
    expect(secondMon).toEqual(['1/12 0:00']);
    const lastFri = runs(nextCronRuns('quartz', f({ minute: '0', hour: '0', dayOfMonth: '?', dayOfWeek: '6L' }), FROM, 1)).map(hm);
    expect(lastFri).toEqual(['1/30 0:00']);
  });

  it('finds leap-day schedules years ahead', () => {
    const r = runs(nextCronRuns('linux', f({ minute: '0', hour: '0', dayOfMonth: '29', month: '2' }), FROM, 1));
    expect(r[0].getFullYear()).toBe(2028);
  });

  it('reports W as unsupported instead of guessing', () => {
    expect(nextCronRuns('quartz', f({ dayOfMonth: '15W', dayOfWeek: '?' }), FROM)).toEqual({ unsupported: '15W' });
  });

  // Góp ý review PR #173: chuẩn hoá 7→0 trước khi mở rộng phạm vi làm `5-7`
  // thành lo=5, hi=0 (rỗng).
  it('day-of-week ranges ending at 7 / SUN, and wrapping ranges', () => {
    const days = (dow: string) =>
      new Set(runs(nextCronRuns('linux', f({ minute: '0', hour: '0', dayOfWeek: dow }), FROM, 14)).map((d) => d.getDay()));
    expect([...days('5-7')].sort()).toEqual([0, 5, 6]);
    expect([...days('SAT-SUN')].sort()).toEqual([0, 6]);
    expect(days('0-7').size).toBe(7);
    expect([...days('FRI-MON')].sort()).toEqual([0, 1, 5, 6]);
    expect([...days('1-5')].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('year-pinned Quartz schedules beyond 8 years are found, not reported as never', () => {
    const r = nextCronRuns('quartz', f({ minute: '0', hour: '0', dayOfMonth: '1', month: '1', dayOfWeek: '?', year: '2099' }), FROM, 5);
    expect(runs(r)).toHaveLength(1);
    expect(runs(r)[0].getFullYear()).toBe(2099);
  });

  it('reports how many years were searched so a short list is not mistaken for "never"', () => {
    const r = nextCronRuns('linux', f({ minute: '0', hour: '0', dayOfMonth: '29', month: '2' }), FROM, 5);
    expect('searchedYears' in r && r.searchedYears).toBe(8);
    expect(runs(r).length).toBeLessThan(5);
  });
});
