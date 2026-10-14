import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sha3Hex } from '@/lib/sha3';

describe('sha3Hex (FIPS 202)', () => {
  it('matches the NIST vectors and Node for several lengths', () => {
    expect(sha3Hex('', 256)).toBe('a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a');
    expect(sha3Hex('abc', 256)).toBe('3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532');
    for (const s of ['', 'abc', 'a'.repeat(135), 'a'.repeat(136), 'a'.repeat(137), 'Tiếng Việt 😀', 'x'.repeat(1000)]) {
      expect(sha3Hex(s, 256)).toBe(createHash('sha3-256').update(s, 'utf8').digest('hex'));
      expect(sha3Hex(s, 512)).toBe(createHash('sha3-512').update(s, 'utf8').digest('hex'));
    }
  });
});
