import { describe, expect, it } from 'vitest';
import { formatRFC3339InTz } from './DateTimeTool';

describe('formatRFC3339InTz', () => {
  // Milliseconds used to leak into the offset (e.g. "-00:0.0152").
  const date = new Date(Date.UTC(2026, 9, 13, 2, 11, 26, 913));

  it('uses Z for UTC even when the date has milliseconds', () => {
    expect(formatRFC3339InTz(date, 'UTC')).toBe('2026-10-13T02:11:26Z');
  });

  it('formats whole-minute offsets east and west of UTC', () => {
    expect(formatRFC3339InTz(date, 'Asia/Ho_Chi_Minh')).toBe('2026-10-13T09:11:26+07:00');
    expect(formatRFC3339InTz(date, 'America/New_York')).toBe('2026-10-12T22:11:26-04:00');
    expect(formatRFC3339InTz(date, 'Asia/Kolkata')).toBe('2026-10-13T07:41:26+05:30');
  });
});

import { parseInTz } from './DateTimeTool';

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('parseInTz — Unix timestamps of any length and unit', () => {
  it('chooses s / ms / µs / ns by magnitude, including 0 and negatives', () => {
    expect(iso(parseInTz('0', 'UTC'))).toBe('1970-01-01T00:00:00.000Z');
    expect(iso(parseInTz('-86400', 'UTC'))).toBe('1969-12-31T00:00:00.000Z');
    expect(iso(parseInTz('946684800', 'UTC'))).toBe('2000-01-01T00:00:00.000Z');
    expect(iso(parseInTz('946684800000', 'UTC'))).toBe('2000-01-01T00:00:00.000Z');
    expect(iso(parseInTz('1700000000', 'Asia/Tokyo'))).toBe('2023-11-14T22:13:20.000Z');
    expect(iso(parseInTz('1700000000123', 'UTC'))).toBe('2023-11-14T22:13:20.123Z');
    expect(iso(parseInTz('1700000000123456', 'UTC'))).toBe('2023-11-14T22:13:20.123Z');
    expect(iso(parseInTz('1700000000123456789', 'UTC'))).toBe('2023-11-14T22:13:20.123Z');
  });

  it('a four-digit number is still a year', () => {
    expect(parseInTz('2026', 'UTC')?.getUTCFullYear()).toBe(2026);
  });
});

describe('parseInTz — an explicit offset wins over the input timezone', () => {
  it('Z and ±hh:mm are instants', () => {
    expect(iso(parseInTz('2026-01-01T00:00:00Z', 'Asia/Tokyo'))).toBe('2026-01-01T00:00:00.000Z');
    expect(iso(parseInTz('2026-01-01T00:00:00+07:00', 'America/New_York'))).toBe('2025-12-31T17:00:00.000Z');
  });

  it('a naive time is read in the input timezone', () => {
    expect(iso(parseInTz('2026-01-01T09:00:00', 'Asia/Tokyo'))).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('parseInTz — around DST changes', () => {
  it('reads the wall time with the offset in force at that time', () => {
    // New York springs forward on 2026-03-08 and falls back on 2026-11-01.
    expect(formatRFC3339InTz(parseInTz('2026-03-08T03:30:00', 'America/New_York')!, 'America/New_York')).toBe('2026-03-08T03:30:00-04:00');
    expect(formatRFC3339InTz(parseInTz('2026-11-01T02:30:00', 'America/New_York')!, 'America/New_York')).toBe('2026-11-01T02:30:00-05:00');
    expect(formatRFC3339InTz(parseInTz('2026-10-03T20:00:00', 'Australia/Sydney')!, 'Australia/Sydney')).toBe('2026-10-03T20:00:00+10:00');
    expect(formatRFC3339InTz(parseInTz('2026-09-27T00:00:00', 'Pacific/Auckland')!, 'Pacific/Auckland')).toBe('2026-09-27T00:00:00+12:00');
  });
});
