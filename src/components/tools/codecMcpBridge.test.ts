import { describe, expect, it } from 'vitest';
import { buildCodecHandlers } from './codecMcpBridge';

const handlers = buildCodecHandlers();

async function call(tool: string, args: Record<string, unknown>) {
  const handler = handlers[tool];
  if (!handler) throw new Error(`no handler for ${tool}`);
  return handler(args);
}

describe('codecMcpBridge — codec_encode/codec_decode', () => {
  it('round-trips base64', async () => {
    const enc = await call('codec_encode', { text: 'hello world', algorithm: 'base64' });
    expect(enc).toEqual({ output: 'aGVsbG8gd29ybGQ=' });
    const dec = await call('codec_decode', { text: 'aGVsbG8gd29ybGQ=', algorithm: 'base64' });
    expect(dec).toEqual({ output: 'hello world' });
  });

  it('round-trips morse', async () => {
    const enc = await call('codec_encode', { text: 'SOS', algorithm: 'morse' }) as { output: string };
    const dec = await call('codec_decode', { text: enc.output, algorithm: 'morse' });
    expect(dec).toEqual({ output: 'SOS' });
  });

  it('rejects an unknown algorithm', async () => {
    await expect(call('codec_encode', { text: 'x', algorithm: 'nope' })).rejects.toThrow(/Unknown codec/);
  });

  it('requires text', async () => {
    await expect(call('codec_encode', { algorithm: 'base64' })).rejects.toThrow(/"text" is required/);
  });
});

describe('codecMcpBridge — hash_compute', () => {
  it('returns every algorithm at once when algorithm is omitted', async () => {
    const res = await call('hash_compute', { text: 'hello' }) as Record<string, string>;
    expect(res.md5).toBe('5d41402abc4b2a76b9719d911017c592');
    expect(res.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(res)).toHaveLength(9);
  });

  it('returns one algorithm when given', async () => {
    const res = await call('hash_compute', { text: 'hello', algorithm: 'md5' });
    expect(res).toEqual({ algorithm: 'md5', hash: '5d41402abc4b2a76b9719d911017c592' });
  });

  it('uppercases when upperHex is set', async () => {
    const res = await call('hash_compute', { text: 'hello', algorithm: 'md5', upperHex: true });
    expect(res).toEqual({ algorithm: 'md5', hash: '5D41402ABC4B2A76B9719D911017C592' });
  });
});

describe('codecMcpBridge — hash_hmac', () => {
  it('computes an HMAC', async () => {
    const res = await call('hash_hmac', { text: 'hello', key: 'secret', algorithm: 'sha256' });
    expect((res as { algorithm: string; hmac: string }).algorithm).toBe('sha256');
    expect((res as { hmac: string }).hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects sha3 (no dedicated per-length HMAC function)', async () => {
    await expect(call('hash_hmac', { text: 'x', key: 'k', algorithm: 'sha3-256' })).rejects.toThrow(/Unknown HMAC algorithm/);
  });
});

describe('codecMcpBridge — encrypt_text/decrypt_text', () => {
  it('round-trips aes-gcm (async WebCrypto path)', async () => {
    const enc = await call('encrypt_text', { text: 'secret message', key: 'passphrase', algorithm: 'aes-gcm' }) as { algorithm: string; output: string };
    expect(enc.algorithm).toBe('aes-gcm');
    const dec = await call('decrypt_text', { ciphertext: enc.output, key: 'passphrase', algorithm: 'aes-gcm' });
    expect(dec).toEqual({ algorithm: 'aes-gcm', output: 'secret message' });
  });

  it('round-trips aes-cbc (sync crypto-js path)', async () => {
    const enc = await call('encrypt_text', { text: 'secret message', key: 'passphrase', algorithm: 'aes-cbc' }) as { output: string };
    const dec = await call('decrypt_text', { ciphertext: enc.output, key: 'passphrase', algorithm: 'aes-cbc' });
    expect(dec).toEqual({ algorithm: 'aes-cbc', output: 'secret message' });
  });

  it('reports a wrong key as "Invalid key or ciphertext" for crypto-js modes', async () => {
    const enc = await call('encrypt_text', { text: 'secret message', key: 'right-key', algorithm: 'aes-cbc' }) as { output: string };
    await expect(call('decrypt_text', { ciphertext: enc.output, key: 'wrong-key', algorithm: 'aes-cbc' }))
      .rejects.toThrow(/Invalid key or ciphertext/);
  });

  it('rejects an unknown algorithm', async () => {
    await expect(call('encrypt_text', { text: 'x', key: 'k', algorithm: 'nope' })).rejects.toThrow(/Unknown encryption algorithm/);
  });
});
