// @vitest-environment node
//
// Node rather than jsdom, for the same realm reason jsonwebtokenShim.test.ts
// documents: jose checks key material with `instanceof Uint8Array`, and under
// jsdom the polyfilled TextEncoder hands back a Uint8Array from Node's outer
// realm, which fails that check even though the value is exactly right.

import { describe, expect, it } from 'vitest';
import { exportJWK, importSPKI } from 'jose';
import {
  JWT_ALGORITHMS, decodeSecret, decodeToken, generateKeyPairPem, inspectClaims,
  isAlgorithmSupported, isAsymmetric, isHmac, signToken, verifyToken,
  type JwtAlgorithm,
} from './jwtCrypto';

const SECRET = 'top-secret-value';

async function keysFor(alg: JwtAlgorithm) {
  return generateKeyPairPem(alg);
}

describe('algorithm table', () => {
  it('covers every JWS algorithm a webview can do, plus none', () => {
    expect(JWT_ALGORITHMS.map((a) => a.alg)).toEqual([
      'HS256', 'HS384', 'HS512',
      'RS256', 'RS384', 'RS512',
      'PS256', 'PS384', 'PS512',
      'ES256', 'ES384', 'ES512',
      'EdDSA', 'none',
    ]);
  });

  it('classifies the families', () => {
    expect(isHmac('HS384')).toBe(true);
    expect(isHmac('RS256')).toBe(false);
    expect(isAsymmetric('ES512')).toBe(true);
    expect(isAsymmetric('HS256')).toBe(false);
    expect(isAsymmetric('none')).toBe(false);
  });
});

describe('decodeSecret', () => {
  it('reads the same bytes out of every encoding', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(decodeSecret('3q2+7w==', 'base64')).toEqual(bytes);
    expect(decodeSecret('3q2-7w', 'base64url')).toEqual(bytes);
    expect(decodeSecret('deadbeef', 'hex')).toEqual(bytes);
    expect(decodeSecret('AB', 'utf8')).toEqual(new Uint8Array([65, 66]));
  });

  it('signs differently depending on the encoding chosen', async () => {
    // The whole reason the encoding is an explicit control: the same text
    // means different bytes, so it means a different signature.
    const asText = await signToken({ algorithm: 'HS256', payload: { a: 1 }, issuedAt: false, key: { material: 'c2VjcmV0', encoding: 'utf8' } });
    const asBase64 = await signToken({ algorithm: 'HS256', payload: { a: 1 }, issuedAt: false, key: { material: 'c2VjcmV0', encoding: 'base64' } });
    expect(asText).not.toBe(asBase64);

    const out = await verifyToken({ token: asBase64, algorithm: 'HS256', key: { material: 'secret', encoding: 'utf8' } });
    expect(out.valid).toBe(true); // base64 "c2VjcmV0" is the bytes of "secret"
  });

  it('rejects malformed input instead of signing with junk', () => {
    expect(() => decodeSecret('zz', 'hex')).toThrow(/valid hex/);
    expect(() => decodeSecret('abc', 'hex')).toThrow(/valid hex/);
  });
});

describe('sign + verify round trip, every algorithm', () => {
  for (const { alg } of JWT_ALGORITHMS.filter((a) => a.family === 'hmac')) {
    it(`${alg} round-trips on a shared secret`, async () => {
      const token = await signToken({ algorithm: alg, payload: { sub: 'u1' }, key: { material: SECRET } });
      const out = await verifyToken({ token, algorithm: alg, key: { material: SECRET } });
      expect(out.valid).toBe(true);
      expect(out.payload?.sub).toBe('u1');
      expect(out.header?.alg).toBe(alg);
      expect(out.header?.typ).toBe('JWT');
    });
  }

  for (const { alg } of JWT_ALGORITHMS.filter((a) => a.family !== 'hmac' && a.alg !== 'none')) {
    it(`${alg} round-trips on a generated key pair`, async () => {
      if (!(await isAlgorithmSupported(alg))) return; // engine without this curve — probe covers it below
      const { privateKey, publicKey } = await keysFor(alg);
      const token = await signToken({ algorithm: alg, payload: { sub: 'u1' }, key: { material: privateKey } });
      const out = await verifyToken({ token, algorithm: alg, key: { material: publicKey } });
      expect(out.valid).toBe(true);
      expect(out.payload?.sub).toBe('u1');
    });
  }
});

describe('verify says no', () => {
  it('rejects a wrong secret', async () => {
    const token = await signToken({ algorithm: 'HS256', payload: { a: 1 }, key: { material: SECRET } });
    const out = await verifyToken({ token, algorithm: 'HS256', key: { material: 'wrong' } });
    expect(out.valid).toBe(false);
    expect(out.code).toBe('signature');
  });

  it('rejects a tampered payload', async () => {
    const token = await signToken({ algorithm: 'HS256', payload: { admin: false }, key: { material: SECRET } });
    const [h, , s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ admin: true })).toString('base64url');
    const out = await verifyToken({ token: `${h}.${forged}.${s}`, algorithm: 'HS256', key: { material: SECRET } });
    expect(out.valid).toBe(false);
    expect(out.code).toBe('signature');
  });

  it('refuses to take the algorithm from the token header', async () => {
    // Algorithm confusion: an HS256 token offered to an RS256 verifier. The
    // answer must be "no", not "let me use the alg you brought".
    const token = await signToken({ algorithm: 'HS256', payload: { a: 1 }, key: { material: SECRET } });
    const { publicKey } = await keysFor('RS256');
    const out = await verifyToken({ token, algorithm: 'RS256', key: { material: publicKey } });
    expect(out.valid).toBe(false);
    expect(out.code).toBe('alg');
    expect(out.message).toMatch(/HS256/);
  });

  it('separates "expired" from "bad signature"', async () => {
    const token = await signToken({ algorithm: 'HS256', payload: { exp: Math.floor(Date.now() / 1000) - 60 }, key: { material: SECRET } });
    const out = await verifyToken({ token, algorithm: 'HS256', key: { material: SECRET } });
    expect(out.valid).toBe(false);
    expect(out.code).toBe('expired');
    expect(out.payload).toBeDefined(); // the claims still come back, so you can read them
  });

  it('accepts an expired token within the clock tolerance', async () => {
    const token = await signToken({ algorithm: 'HS256', payload: { exp: Math.floor(Date.now() / 1000) - 10 }, key: { material: SECRET } });
    const out = await verifyToken({ token, algorithm: 'HS256', key: { material: SECRET }, clockToleranceSec: 120 });
    expect(out.valid).toBe(true);
  });

  it('reports a failed issuer check as a claim failure, not a signature failure', async () => {
    const token = await signToken({ algorithm: 'HS256', payload: { iss: 'https://real' }, key: { material: SECRET } });
    const out = await verifyToken({ token, algorithm: 'HS256', key: { material: SECRET }, issuer: 'https://expected' });
    expect(out.valid).toBe(false);
    expect(out.code).toBe('claim');
  });

  it('explains a PKCS#1 key instead of failing obscurely', async () => {
    const out = await verifyToken({
      token: await signToken({ algorithm: 'HS256', payload: {}, key: { material: SECRET } }),
      algorithm: 'HS256',
      key: { material: SECRET },
    });
    expect(out.valid).toBe(true);

    const signAttempt = signToken({
      algorithm: 'RS256',
      payload: {},
      key: { material: '-----BEGIN RSA PRIVATE KEY-----\nMII...\n-----END RSA PRIVATE KEY-----' },
    });
    await expect(signAttempt).rejects.toThrow(/PKCS#8|pkcs8/);
  });

  it('will not sign with a public key', async () => {
    const { publicKey } = await keysFor('ES256');
    await expect(signToken({ algorithm: 'ES256', payload: {}, key: { material: publicKey } })).rejects.toThrow(/private key/i);
  });
});

describe('alg "none"', () => {
  it('produces a token with an empty signature', async () => {
    const token = await signToken({ algorithm: 'none', payload: { sub: 'anon' } });
    expect(token.split('.')[2]).toBe('');
    expect(decodeToken(token).header.alg).toBe('none');
  });

  it('never counts as verified', async () => {
    const token = await signToken({ algorithm: 'none', payload: { sub: 'anon' } });
    const out = await verifyToken({ token, algorithm: 'none', key: { material: '' } });
    expect(out.valid).toBe(false);
    expect(out.payload?.sub).toBe('anon'); // readable, just not trusted
  });

  it('does not slip past an HS256 verifier', async () => {
    const token = await signToken({ algorithm: 'none', payload: { admin: true } });
    const out = await verifyToken({ token, algorithm: 'HS256', key: { material: SECRET } });
    expect(out.valid).toBe(false);
    expect(out.code).toBe('alg');
  });
});

describe('JWK and JWK Set keys', () => {
  it('verifies against a public JWK', async () => {
    const { privateKey, publicKey } = await keysFor('ES256');
    const pubJwk = await exportJWK(await importSPKI(publicKey, 'ES256', { extractable: true }));
    const token = await signToken({ algorithm: 'ES256', payload: { a: 1 }, key: { material: privateKey } });
    const out = await verifyToken({ token, algorithm: 'ES256', key: { material: JSON.stringify(pubJwk) } });
    expect(out.valid).toBe(true);
  });

  it('refuses to sign with a public JWK', async () => {
    const { publicKey } = await keysFor('ES256');
    const pubJwk = await exportJWK(await importSPKI(publicKey, 'ES256', { extractable: true }));
    await expect(signToken({ algorithm: 'ES256', payload: {}, key: { material: JSON.stringify(pubJwk) } }))
      .rejects.toThrow(/public key/i);
  });

  it('picks the key with the matching kid out of a JWK Set', async () => {
    const a = await keysFor('ES256');
    const b = await keysFor('ES256');
    const jwkA = { ...(await exportJWK(await importSPKI(a.publicKey, 'ES256', { extractable: true }))), kid: 'a' };
    const jwkB = { ...(await exportJWK(await importSPKI(b.publicKey, 'ES256', { extractable: true }))), kid: 'b' };
    const token = await signToken({ algorithm: 'ES256', payload: { a: 1 }, header: { kid: 'b' }, key: { material: b.privateKey } });

    const jwks = JSON.stringify({ keys: [jwkA, jwkB] });
    expect((await verifyToken({ token, algorithm: 'ES256', key: { material: jwks, kid: 'b' } })).valid).toBe(true);
    expect((await verifyToken({ token, algorithm: 'ES256', key: { material: jwks, kid: 'a' } })).valid).toBe(false);
  });
});

describe('claim helpers', () => {
  it('turns exp/nbf/iat into readable time and a verdict', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const out = inspectClaims({ exp: now / 1000 - 3600, iat: now / 1000 - 7200, iss: 'https://issuer', aud: ['a', 'b'] }, now);
    expect(out.expired).toBe(true);
    expect(out.notYetValid).toBe(false);
    const exp = out.rows.find((r) => r.claim === 'exp')!;
    expect(exp.tone).toBe('bad');
    expect(exp.detail).toBe('1 hour ago');
    expect(out.rows.find((r) => r.claim === 'aud')!.value).toBe('a, b');
  });

  it('flags a token that is valid but expiring within minutes', () => {
    const now = Date.now();
    expect(inspectClaims({ exp: now / 1000 + 60 }, now).rows[0].tone).toBe('warn');
  });

  it('flags a not-yet-valid token without calling it expired', () => {
    const now = Date.now();
    const out = inspectClaims({ nbf: now / 1000 + 600 }, now);
    expect(out.notYetValid).toBe(true);
    expect(out.expired).toBe(false);
  });
});

describe('sign options', () => {
  it('treats a bare number TTL as seconds from now, not a 1970 timestamp', async () => {
    const token = await signToken({ algorithm: 'HS256', payload: {}, expiresIn: 3600, key: { material: SECRET } });
    const { payload } = decodeToken(token);
    expect(payload.exp! - payload.iat!).toBe(3600);
  });

  it('accepts jose duration strings', async () => {
    const token = await signToken({ algorithm: 'HS256', payload: {}, expiresIn: '2h', key: { material: SECRET } });
    const { payload } = decodeToken(token);
    expect(payload.exp! - payload.iat!).toBe(7200);
  });

  it('lets the header carry kid but never a contradicting alg', async () => {
    const token = await signToken({
      algorithm: 'HS256', payload: {}, key: { material: SECRET },
      header: { kid: 'key-1', alg: 'RS256' },
    });
    const { header } = decodeToken(token);
    expect(header.kid).toBe('key-1');
    expect(header.alg).toBe('HS256');
  });

  it('can omit iat', async () => {
    const token = await signToken({ algorithm: 'HS256', payload: {}, issuedAt: false, key: { material: SECRET } });
    expect(decodeToken(token).payload.iat).toBeUndefined();
  });

  it('rejects a payload that is not a JSON object', async () => {
    await expect(signToken({ algorithm: 'HS256', payload: '[1,2]', key: { material: SECRET } })).rejects.toThrow(/JSON object/);
    await expect(signToken({ algorithm: 'HS256', payload: '{oops', key: { material: SECRET } })).rejects.toThrow(/not valid JSON/);
  });
});

describe('isAlgorithmSupported', () => {
  it('is true for HMAC and none without touching the engine', async () => {
    expect(await isAlgorithmSupported('HS512')).toBe(true);
    expect(await isAlgorithmSupported('none')).toBe(true);
  });

  it('answers for every asymmetric algorithm without throwing', async () => {
    for (const { alg } of JWT_ALGORITHMS.filter((a) => a.family !== 'hmac' && a.alg !== 'none')) {
      expect(typeof await isAlgorithmSupported(alg)).toBe('boolean');
    }
  });
});
