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
