// Regression coverage for a raw crypto-js internal error leaking through
// decrypt_text. crypto-js usually fails a wrong key/malformed ciphertext
// silently (empty string) for the sync (non-aes-gcm) modes — decrypt_text's
// own comment said so and only checked for that — but when the garbage bytes
// a wrong key produces happen to fail crypto-js's OWN UTF-8 decode step
// (`.toString(CryptoJS.enc.Utf8)`), it throws its own "Malformed UTF-8 data"
// instead of returning empty. That's why the sibling test in
// codecMcpBridge.test.ts ("reports a wrong key as...") was intermittently
// flaky: which of the two happens depends on the random ciphertext bytes.
// Isolated in its own file (rather than added to codecMcpBridge.test.ts)
// because it needs to mock `doDecrypt` to force the throwing path
// deterministically, which would corrupt every other, real-crypto test
// sharing that file's module-scope `handlers`.

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
