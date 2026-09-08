// @vitest-environment node
//
// jose's key-type checks use `instanceof Uint8Array`, which is realm-
// sensitive: under jsdom, vitest's polyfilled `TextEncoder` returns a
// Uint8Array from Node's outer realm, not jsdom's window realm, so the
// check spuriously fails even though the value really is a Uint8Array (a
// known jsdom/vitest artifact, not a real production bug — a real webview
// has only one realm). Running this file under the plain Node environment
// sidesteps the whole double-realm problem.

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

  it('resolves jose (native API) and jsonwebtoken (shim) and can sign+verify an HS256 token with each', async () => {
    const jose = requireModule('jose') as typeof import('jose');
    const joseToken = await new jose.SignJWT({ a: 1 })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode('secret'));
    const { payload } = await jose.jwtVerify(joseToken, new TextEncoder().encode('secret'));
    expect(payload.a).toBe(1);

    const jwt = requireModule('jsonwebtoken') as typeof import('./jsonwebtokenShim').default;
    const token = await jwt.sign({ a: 1 }, 'secret', { algorithm: 'HS256' });
    const decoded = await jwt.verify(token, 'secret', { algorithms: ['HS256'] });
    expect(decoded.a).toBe(1);
  });

  it('resolves ajv and validates a payload against a JSON schema', () => {
    const AjvCtor = requireModule('ajv') as new () => {
      compile: (schema: object) => ((data: unknown) => boolean) & { errors?: unknown[] | null };
    };
    const ajv = new AjvCtor();
    const validate = ajv.compile({
      type: 'object', required: ['id'], properties: { id: { type: 'number' } },
    });
    expect(validate({ id: 1 })).toBe(true);
    expect(validate({ id: 'not-a-number' })).toBe(false);
    expect(validate.errors?.length).toBeGreaterThan(0);
  });

  it('resolves xml2js and parses XML into a plain object', async () => {
    const mod = requireModule('xml2js') as typeof import('xml2js');
    const result = await mod.parseStringPromise('<root><name>Ada</name></root>');
    expect(result).toEqual({ root: { name: ['Ada'] } });
  });

  it('resolves cheerio and can query parsed HTML', () => {
    const mod = requireModule('cheerio') as typeof import('cheerio');
    const $ = mod.load('<ul><li class="item">a</li><li class="item">b</li></ul>');
    expect($('.item').length).toBe(2);
    expect($('.item').first().text()).toBe('a');
  });

  it('resolves nanoid and generates URL-safe ids of the requested length', () => {
    const mod = requireModule('nanoid') as {
      nanoid: (size?: number) => string;
      customAlphabet: (alphabet: string, size: number) => () => string;
    };
    expect(mod.nanoid()).toHaveLength(21);
    expect(mod.nanoid(10)).toHaveLength(10);
    const digitsOnly = mod.customAlphabet('0123456789', 6);
    expect(digitsOnly()).toMatch(/^\d{6}$/);
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
