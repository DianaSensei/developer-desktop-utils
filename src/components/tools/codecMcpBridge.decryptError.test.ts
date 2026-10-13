// crypto-js sometimes throws "Malformed UTF-8 data" on a wrong key instead of
// returning an empty string, depending on the random ciphertext. This test
// mocks `doDecrypt` to force that path deterministically, so it lives in its
// own file to keep the real-crypto tests in codecMcpBridge.test.ts unaffected.

import { describe, expect, it, vi } from 'vitest';

vi.mock('./EncodeHashEncrypt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./EncodeHashEncrypt')>();
  return {
    ...actual,
    doDecrypt: () => { throw new Error('Malformed UTF-8 data'); },
  };
});

describe('codecMcpBridge — decrypt_text normalizes a raw crypto-js decode error', () => {
  it('reports "Invalid key or ciphertext", not the raw "Malformed UTF-8 data"', async () => {
    const { buildCodecHandlers } = await import('./codecMcpBridge');
    const handlers = buildCodecHandlers();
    await expect(handlers.decrypt_text({ ciphertext: 'anything', key: 'wrong-key', algorithm: 'aes-cbc' }))
      .rejects.toThrow(/Invalid key or ciphertext/);
  });
});
