import { describe, expect, it } from 'vitest';
import { litBars } from './QuotaPanel';

describe('litBars', () => {
  it('lights a bar per started quarter of what is used', () => {
    expect([0, 1, 25, 26, 50, 74, 76, 100].map((u) => litBars(u, 'used'))).toEqual([0, 1, 1, 2, 2, 3, 4, 4]);
  });

  it('counts what is left when asked, clamped to 0–4', () => {
    expect([0, 26, 84, 100, 140, -5].map((u) => litBars(u, 'left'))).toEqual([4, 3, 1, 0, 0, 4]);
  });
});
