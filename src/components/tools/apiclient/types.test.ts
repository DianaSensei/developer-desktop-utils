// `uid()` is row/request identity across the whole API Client — React keys,
// the ghost-row comparison in the Name/Value tables, request lookup. Its only
// contract is uniqueness, and the branch that is hardest to reach is exactly
// the one where a mistake is invisible: an automated fix once gave the
// no-Web-Crypto fallback a constant suffix, which would have handed every id
// minted in the same millisecond the same value.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { newKeyValue, uid } from './types';

const uniqueCount = (n: number) => new Set(Array.from({ length: n }, () => uid())).size;

afterEach(() => { vi.unstubAllGlobals(); });

describe('uid', () => {
  it('never repeats across a large batch', () => {
    expect(uniqueCount(5000)).toBe(5000);
  });

  it('stays unique with only getRandomValues available (no randomUUID)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: real.getRandomValues.bind(real),
    });
    expect(uniqueCount(2000)).toBe(2000);
  });

  it('stays unique even with no Web Crypto at all', () => {
    // The last-resort branch. Same millisecond for every call here, so a
    // constant suffix would collapse all 500 ids into one.
    vi.stubGlobal('crypto', undefined);
    expect(uniqueCount(500)).toBe(500);
  });

  it('gives each new row its own id', () => {
    const rows = Array.from({ length: 100 }, () => newKeyValue('k', 'v'));
    expect(new Set(rows.map((r) => r.id)).size).toBe(100);
  });
});
