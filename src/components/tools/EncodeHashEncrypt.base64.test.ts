import { describe, expect, it } from 'vitest';
import { base64Decode } from '@/components/tools/EncodeHashEncrypt';

/** Base64 decode accepts the forms people paste and explains failures. */
describe('base64Decode', () => {
  it('decodes standard Base64 with padding and line breaks', () => {
    expect(base64Decode('SGVs\nbG8=')).toBe('Hello');
  });

  it('accepts missing padding (e.g. a JWT segment)', () => {
    expect(base64Decode('SGVsbG8')).toBe('Hello');
    expect(base64Decode('eyJhbGciOiJIUzI1NiJ9')).toBe('{"alg":"HS256"}');
  });

  it('accepts base64url characters', () => {
    // "??>" encodes to "Pz8+" (standard) and "Pz8-" (url-safe).
    expect(base64Decode('Pz8-')).toBe('??>');
    expect(base64Decode('Pz8_')).toBe(base64Decode('Pz8/'));
  });

  it('strips a data: URL prefix', () => {
    expect(base64Decode('data:text/plain;base64,SGVsbG8=')).toBe('Hello');
  });

  it('names the offending character instead of a DOMException', () => {
    expect(() => base64Decode('not base64 at all!!')).toThrow(/unexpected character "!"/);
  });

  it('flags an impossible length', () => {
    expect(() => base64Decode('SGVsb')).toThrow(/truncated/);
  });
});
