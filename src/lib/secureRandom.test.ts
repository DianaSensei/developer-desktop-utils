import { describe, expect, it } from 'vitest';
import { randomBelow, randomInt, randomString, randomUnitFloat } from './secureRandom';

describe('randomBelow', () => {
  it('stays inside the half-open range', () => {
    for (let i = 0; i < 500; i++) {
      const v = randomBelow(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('is degenerate for a bound of one', () => {
    expect(randomBelow(1)).toBe(0);
  });

  it('rejects a bound that is not a positive integer', () => {
    expect(() => randomBelow(0)).toThrow(RangeError);
    expect(() => randomBelow(-3)).toThrow(RangeError);
    expect(() => randomBelow(2.5)).toThrow(RangeError);
  });

  it('covers every value of a small bound', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(randomBelow(4));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('randomInt', () => {
  it('includes both ends of the range', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 600; i++) seen.add(randomInt(1, 6));
    // A die that cannot roll its max was the bug this replaced.
    expect(seen.has(1)).toBe(true);
    expect(seen.has(6)).toBe(true);
    expect([...seen].every((v) => v >= 1 && v <= 6)).toBe(true);
  });

  it('handles a reversed range and a single-value range', () => {
    expect(randomInt(5, 5)).toBe(5);
    for (let i = 0; i < 50; i++) {
      const v = randomInt(9, 2);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(9);
    }
  });

  it('handles negative ranges', () => {
    for (let i = 0; i < 100; i++) {
      const v = randomInt(-5, -1);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThanOrEqual(-1);
    }
  });
});

describe('randomUnitFloat', () => {
  it('stays in [0, 1)', () => {
    for (let i = 0; i < 500; i++) {
      const v = randomUnitFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('does not return the same value twice in a row', () => {
    const a = randomUnitFloat();
    const b = randomUnitFloat();
    expect(a).not.toBe(b);
  });
});

describe('randomString', () => {
  it('produces the requested length from the given alphabet', () => {
    const out = randomString(64, 'abc');
    expect(out).toHaveLength(64);
    expect([...out].every((c) => 'abc'.includes(c))).toBe(true);
  });

  it('returns empty for an empty alphabet or non-positive length', () => {
    expect(randomString(10, '')).toBe('');
    expect(randomString(0, 'abc')).toBe('');
    expect(randomString(-1, 'abc')).toBe('');
  });

  it('emits whole code points rather than lone surrogates', () => {
    const out = randomString(20, '🙂🚀');
    // Two UTF-16 units per emoji, so 20 characters is 40 units.
    expect(out.length).toBe(40);
    expect(Array.from(out)).toHaveLength(20);
    expect([...out].every((c) => c === '🙂' || c === '🚀')).toBe(true);
  });

  it('uses the whole alphabet', () => {
    const alphabet = 'abcdefghij';
    const seen = new Set(randomString(2000, alphabet));
    expect(seen.size).toBe(alphabet.length);
  });
});
