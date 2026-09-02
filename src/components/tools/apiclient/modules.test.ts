import { describe, expect, it } from 'vitest';
import { requireModule } from './modules';

describe('requireModule', () => {
  it('resolves the existing bundled modules', () => {
    expect(requireModule('lodash')).toBeTruthy();
    expect(requireModule('uuid')).toBeTruthy();
    expect(requireModule('crypto-js')).toBeTruthy();
  });

  it('resolves jwt-decode and can decode a token', () => {
    const mod = requireModule('jwt-decode') as { jwtDecode: (t: string) => unknown };
    // header {"alg":"none","typ":"JWT"}, payload {"sub":"abc"} — unsigned, just for shape.
    const token = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhYmMifQ.';
    expect(mod.jwtDecode(token)).toEqual({ sub: 'abc' });
  });

  it('resolves dayjs and can format a date', () => {
    const mod = requireModule('dayjs') as (input?: unknown) => { format: (fmt: string) => string };
    expect(mod('2024-01-15').format('YYYY-MM-DD')).toBe('2024-01-15');
  });

  it('throws a clear error for an unavailable module, listing what is bundled', () => {
    expect(() => requireModule('left-pad')).toThrow(/left-pad.*not available/);
    expect(() => requireModule('left-pad')).toThrow(/jwt-decode/);
    expect(() => requireModule('left-pad')).toThrow(/dayjs/);
  });

  it('does not resolve Object.prototype properties as if they were bundled modules', () => {
    // `require` is exposed straight to scripts — require('constructor') must
    // report "not available" like any other unbundled name, not hand back a
    // live Object constructor / Object.prototype off the module lookup's own
    // prototype chain.
    expect(() => requireModule('constructor')).toThrow(/constructor.*not available/);
    expect(() => requireModule('__proto__')).toThrow(/not available/);
    expect(() => requireModule('toString')).toThrow(/not available/);
    expect(() => requireModule('hasOwnProperty')).toThrow(/not available/);
  });
});
