import { describe, expect, it } from 'vitest';
import {
  EnvelopeFormatError, PBKDF2_ITERATIONS,
  decryptAesGcm, encryptAesGcm, isAesGcmEnvelope,
} from './aesGcm';

// 600k PBKDF2 rounds twice per round-trip is slow in jsdom, so the tests use a
// small count except where the default itself is under test.
const FAST = 1000;

describe('AES-256-GCM envelope', () => {
  it('round-trips text', async () => {
    const ct = await encryptAesGcm('attack at dawn', 'correct horse', FAST);
    expect(await decryptAesGcm(ct, 'correct horse')).toBe('attack at dawn');
  });

  it('round-trips unicode and empty input', async () => {
    for (const text of ['', 'xin chào 🌏', 'a'.repeat(50_000)]) {
      const ct = await encryptAesGcm(text, 'pw', FAST);
      expect(await decryptAesGcm(ct, 'pw')).toBe(text);
    }
  });

  it('produces a different ciphertext every time', async () => {
    const a = await encryptAesGcm('same', 'pw', FAST);
    const b = await encryptAesGcm('same', 'pw', FAST);
    // Fresh salt and IV per message, so no two encryptions collide.
    expect(a).not.toBe(b);
    expect(await decryptAesGcm(b, 'pw')).toBe('same');
  });

  it('rejects a wrong passphrase rather than returning garbage', async () => {
    const ct = await encryptAesGcm('secret', 'right', FAST);
    await expect(decryptAesGcm(ct, 'wrong')).rejects.toThrow();
  });

  it('rejects a tampered ciphertext', async () => {
    const ct = await encryptAesGcm('secret', 'pw', FAST);
    const bytes = atob(ct).split('').map((c) => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 0x01; // flip a bit in the tag
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(decryptAesGcm(tampered, 'pw')).rejects.toThrow();
  });

  it('carries its iteration count so old messages still open', async () => {
    const ct = await encryptAesGcm('legacy', 'pw', 2048);
    // Decryption is told nothing about the count — it reads it from the header.
    expect(await decryptAesGcm(ct, 'pw')).toBe('legacy');
  });

  it('defaults to the OWASP iteration count', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it('names the format problem when handed something else', async () => {
    await expect(decryptAesGcm('not base64 !!!', 'pw')).rejects.toBeInstanceOf(EnvelopeFormatError);
    await expect(decryptAesGcm('c2hvcnQ=', 'pw')).rejects.toBeInstanceOf(EnvelopeFormatError);
    // A crypto-js ciphertext is valid base64 of the right length but wrong magic.
    const cryptoJsLike = btoa('Salted__' + 'x'.repeat(64));
    await expect(decryptAesGcm(cryptoJsLike, 'pw')).rejects.toBeInstanceOf(EnvelopeFormatError);
  });

  it('recognises its own envelopes and nothing else', async () => {
    expect(isAesGcmEnvelope(await encryptAesGcm('x', 'pw', FAST))).toBe(true);
    expect(isAesGcmEnvelope(btoa('Salted__' + 'x'.repeat(64)))).toBe(false);
    expect(isAesGcmEnvelope('not base64 !!!')).toBe(false);
    expect(isAesGcmEnvelope('')).toBe(false);
  });
});
