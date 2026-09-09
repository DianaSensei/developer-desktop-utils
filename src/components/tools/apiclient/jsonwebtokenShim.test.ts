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
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import * as jwt from './jsonwebtokenShim';

describe('jsonwebtokenShim — HMAC (HS256)', () => {
  it('signs and verifies a round trip', async () => {
    const token = await jwt.sign({ sub: 'user-1', role: 'admin' }, 'top-secret', { algorithm: 'HS256' });
    expect(token.split('.')).toHaveLength(3);

    const payload = await jwt.verify(token, 'top-secret', { algorithms: ['HS256'] });
    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('admin');
    expect(typeof payload.iat).toBe('number');
  });

  it('defaults algorithm to HS256 when omitted, matching real jsonwebtoken', async () => {
    const token = await jwt.sign({ a: 1 }, 'secret');
    const payload = await jwt.verify(token, 'secret', { algorithms: ['HS256'] });
    expect(payload.a).toBe(1);
  });

  it('rejects a wrong secret', async () => {
    const token = await jwt.sign({ a: 1 }, 'right-secret');
    await expect(jwt.verify(token, 'wrong-secret', { algorithms: ['HS256'] }))
      .rejects.toThrow(jwt.JsonWebTokenError);
  });

  it('numeric expiresIn/notBefore are seconds-from-now, not an absolute timestamp', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await jwt.sign({ a: 1 }, 'secret', { expiresIn: 3600, notBefore: -60 });
    const payload = await jwt.verify(token, 'secret', { algorithms: ['HS256'] });
    // If the number were treated as an absolute epoch (jose's own numeric
    // convention), exp would land in 1970 and this token would already read
    // as expired — the whole point of the shim's `toDuration` conversion.
    expect(payload.exp).toBeGreaterThanOrEqual(before + 3600 - 2);
    expect(payload.exp).toBeLessThanOrEqual(before + 3600 + 5);
    expect(payload.nbf).toBeLessThanOrEqual(before);
  });

  it('an expired token throws TokenExpiredError with expiredAt', async () => {
    const token = await jwt.sign({ a: 1 }, 'secret', { expiresIn: -10 });
    await expect(jwt.verify(token, 'secret', { algorithms: ['HS256'] }))
      .rejects.toThrow(jwt.TokenExpiredError);
    try {
      await jwt.verify(token, 'secret', { algorithms: ['HS256'] });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(jwt.TokenExpiredError);
      expect((e as InstanceType<typeof jwt.TokenExpiredError>).expiredAt).toBeInstanceOf(Date);
    }
  });

  it('verify() refuses to run without an explicit algorithms list', async () => {
    const token = await jwt.sign({ a: 1 }, 'secret');
    // @ts-expect-error — deliberately omitting the required option to test the guard
    await expect(jwt.verify(token, 'secret', {})).rejects.toThrow(/algorithms/);
  });
});

describe('jsonwebtokenShim — RSA (RS256)', () => {
  it('signs with a PKCS8 private key PEM and verifies with the SPKI public key PEM', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const privatePem = await exportPKCS8(privateKey);
    const publicPem = await exportSPKI(publicKey);

    const token = await jwt.sign({ sub: 'svc' }, privatePem, { algorithm: 'RS256' });
    const payload = await jwt.verify(token, publicPem, { algorithms: ['RS256'] });
    expect(payload.sub).toBe('svc');
  });

  it('rejects a non-PEM key for an asymmetric algorithm', async () => {
    await expect(jwt.sign({ a: 1 }, 'not-a-pem', { algorithm: 'RS256' }))
      .rejects.toThrow(/PEM-encoded/);
  });
});

describe('jsonwebtokenShim — ECDSA (ES256)', () => {
  it('signs and verifies a round trip', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
    const privatePem = await exportPKCS8(privateKey);
    const publicPem = await exportSPKI(publicKey);

    const token = await jwt.sign({ sub: 'device-9' }, privatePem, { algorithm: 'ES256' });
    const payload = await jwt.verify(token, publicPem, { algorithms: ['ES256'] });
    expect(payload.sub).toBe('device-9');
  });

  it('does not verify against a wrong algorithm even with the right key', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
    const token = await jwt.sign({ a: 1 }, await exportPKCS8(privateKey), { algorithm: 'ES256' });
    await expect(jwt.verify(token, await exportSPKI(publicKey), { algorithms: ['ES384'] }))
      .rejects.toThrow();
  });
});

describe('jsonwebtokenShim — decode()', () => {
  it('reads claims without verifying, and returns header+signature when complete:true', async () => {
    const token = await jwt.sign({ sub: 'x' }, 'secret', { algorithm: 'HS256' });
    expect(jwt.decode(token)).toMatchObject({ sub: 'x' });

    const full = jwt.decode(token, { complete: true }) as { header: { alg: string }; payload: { sub: string } };
    expect(full.header.alg).toBe('HS256');
    expect(full.payload.sub).toBe('x');
  });

  it('returns null for a malformed token instead of throwing', () => {
    expect(jwt.decode('not-a-jwt')).toBeNull();
  });
});
