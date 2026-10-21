// @vitest-environment node
//
// Node rather than jsdom: Web Crypto and jose need a single realm (see
// jwt/jwtCrypto.test.ts). The OpenSSH output was also checked once by hand
// against ssh-keygen (-y, -l, -Y sign/verify) and openssl; these tests pin
// the structure so a regression shows up without those tools in CI.

import { describe, expect, it } from 'vitest';
import { calculateJwkThumbprint, importJWK, importPKCS8, importSPKI, SignJWT, jwtVerify } from 'jose';
import { generateKey, isPresetSupported, KEY_PRESETS, type KeyPairResult, type SecretResult } from '@/components/tools/keygen/keygen';

/** Minimal reader for the SSH wire format. */
class Reader {
  private off = 0;
  constructor(private buf: Uint8Array) {}
  u32() { const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.off, 4).getUint32(0); this.off += 4; return v; }
  bytes() { const n = this.u32(); const v = this.buf.subarray(this.off, this.off + n); this.off += n; return v; }
  str() { return new TextDecoder().decode(this.bytes()); }
  raw(n: number) { const v = this.buf.subarray(this.off, this.off + n); this.off += n; return v; }
  get rest() { return this.buf.subarray(this.off); }
}

const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

function parseOpenSshPrivate(pemText: string) {
  const body = pemText.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const r = new Reader(b64(body));
  expect(new TextDecoder().decode(r.raw(15))).toBe('openssh-key-v1\0');
  expect(r.str()).toBe('none');
  expect(r.str()).toBe('none');
  expect(r.bytes().length).toBe(0);
  expect(r.u32()).toBe(1);
  const pub = r.bytes();
  const section = r.bytes();
  expect(section.length % 8).toBe(0);
  const s = new Reader(section);
  expect(s.u32()).toBe(s.u32()); // checkints match
  return { pub, keyType: s.str(), section: s };
}

describe('keygen — key pairs', () => {
  it.each(['ed25519', 'rsa-2048', 'ec-p256', 'ec-p384', 'ec-p521'] as const)('%s: PEM, JWK and OpenSSH agree', async (id) => {
    const r = (await generateKey(id, { comment: 'me@host' })) as KeyPairResult;
    const alg = KEY_PRESETS.find((p) => p.id === id)!.jwsAlg!;

    // PEM private signs, PEM public verifies.
    const token = await new SignJWT({ a: 1 }).setProtectedHeader({ alg }).sign(await importPKCS8(r.privatePem, alg));
    await expect(jwtVerify(token, await importSPKI(r.publicPem, alg))).resolves.toBeTruthy();
    // JWK public verifies the same token; kid is its RFC 7638 thumbprint.
    await expect(jwtVerify(token, await importJWK(r.publicJwk, alg))).resolves.toBeTruthy();
    expect(r.kid).toBe(await calculateJwkThumbprint(r.publicJwk));
    expect(r.publicJwk).not.toHaveProperty('d');
    expect(r.publicJwk).not.toHaveProperty('key_ops');
    expect(JSON.parse(r.jwks).keys[0]).toEqual(r.publicJwk);

    // OpenSSH: public line, private file and fingerprint describe the same key.
    const [type, blob, comment] = r.ssh!.publicKey.split(' ');
    expect(comment).toBe('me@host');
    const priv = parseOpenSshPrivate(r.ssh!.privateKey);
    expect(Buffer.from(priv.pub).toString('base64')).toBe(blob);
    expect(priv.keyType).toBe(type);
    const digest = Buffer.from(await crypto.subtle.digest('SHA-256', b64(blob))).toString('base64').replace(/=+$/, '');
    expect(r.ssh!.fingerprint).toBe(`SHA256:${digest}`);
  });

  it('writes the Ed25519 secret as seed ‖ public key, as OpenSSH expects', async () => {
    const r = (await generateKey('ed25519')) as KeyPairResult;
    const { section } = parseOpenSshPrivate(r.ssh!.privateKey);
    const pub = section.bytes();
    const secret = section.bytes();
    expect(secret.length).toBe(64);
    expect(Buffer.from(secret.subarray(32))).toEqual(Buffer.from(pub));
    expect(Buffer.from(secret.subarray(0, 32)).toString('base64url')).toBe(r.privateJwk.d);
    expect(section.str()).toBe(''); // no comment given
  });

  it('gives X25519 WireGuard-style raw keys and no SSH output', async () => {
    if (!(await isPresetSupported('x25519'))) return;
    const r = (await generateKey('x25519')) as KeyPairResult;
    expect(r.ssh).toBeUndefined();
    expect(b64(r.wireguard!.privateKey)).toHaveLength(32);
    expect(Buffer.from(b64(r.wireguard!.publicKey)).toString('base64url')).toBe(r.publicJwk.x);
    expect(r.publicJwk.use).toBe('enc');
  });

  it('makes a different key every time', async () => {
    const [a, b] = await Promise.all([generateKey('ed25519'), generateKey('ed25519')]) as KeyPairResult[];
    expect(a.privatePem).not.toBe(b.privatePem);
  });
});

describe('keygen — secrets', () => {
  it('sizes HMAC / AES secrets and gives a matching oct JWK', async () => {
    for (const [id, bytes, alg] of [['hmac-256', 32, 'HS256'], ['hmac-512', 64, 'HS512'], ['aes-128', 16, 'A128GCM'], ['aes-256', 32, 'A256GCM']] as const) {
      const r = (await generateKey(id)) as SecretResult;
      expect(r.bytes).toBe(bytes);
      expect(r.hex).toHaveLength(bytes * 2);
      expect(b64(r.base64)).toHaveLength(bytes);
      expect(r.jwk).toMatchObject({ kty: 'oct', k: r.base64url, alg });
    }
  });

  it('honours the length of random bytes and rejects nonsense', async () => {
    expect(((await generateKey('random', { bytes: 48 })) as SecretResult).bytes).toBe(48);
    await expect(generateKey('random', { bytes: 0 })).rejects.toThrow(/between 1 and 1024/);
    await expect(generateKey('random', { bytes: 5000 })).rejects.toThrow(/between 1 and 1024/);
  });
});
