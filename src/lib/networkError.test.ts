import { describe, expect, it } from 'vitest';
import { classifyNetworkError } from '@/lib/networkError';

describe('classifyNetworkError', () => {
  it.each([
    ['error sending request for url (https://x.invalid/): dns error: failed to lookup address information', 'dns'],
    ['tcp connect error: Connection refused (os error 61)', 'refused'],
    ['operation timed out', 'timeout'],
    ['Failed to fetch', 'unreachable'],
    ['Load failed', 'unreachable'],
  ] as const)('%s → %s', (msg, kind) => {
    expect(classifyNetworkError(msg)).toBe(kind);
  });

  it('leaves unrelated errors alone', () => {
    expect(classifyNetworkError('invalid peer certificate: UnknownIssuer')).toBeNull();
    expect(classifyNetworkError('Unexpected token < in JSON')).toBeNull();
  });
});
