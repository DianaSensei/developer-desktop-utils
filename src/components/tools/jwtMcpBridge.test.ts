// @vitest-environment node
//
// jose compares key material with `instanceof Uint8Array`, which jsdom's
// second realm breaks — same reason jwt/jwtCrypto.test.ts and
// apiclient/jsonwebtokenShim.test.ts run under Node.

import { describe, expect, it } from 'vitest';
import { buildJwtHandlers } from './jwtMcpBridge';

const handlers = buildJwtHandlers();

// header {"alg":"HS256","typ":"JWT"}, payload {"sub":"1234567890","name":"John Doe","iat":1516239022}
// (the standard jwt.io example token; signature is not checked by jwt_decode)
const SAMPLE_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('jwtMcpBridge — jwt_decode', () => {
  it('decodes header and payload', async () => {
    const res = await handlers.jwt_decode({ token: SAMPLE_TOKEN }) as { header: unknown; payload: unknown };
    expect(res.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(res.payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 });
  });

  it('errors on a malformed token', async () => {
    await expect(handlers.jwt_decode({ token: 'not-a-jwt' })).rejects.toThrow();
  });

  it('requires token', async () => {
    await expect(handlers.jwt_decode({})).rejects.toThrow(/"token" is required/);
  });
});

describe('jwtMcpBridge — jwt_decode answers "is it expired?"', () => {
  it('reports expiry rather than leaving epoch math to the caller', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const { token } = await handlers.jwt_sign({ payload: { exp: past }, algorithm: 'HS256', key: 's' }) as { token: string };
    const res = await handlers.jwt_decode({ token }) as { expired: boolean; notYetValid: boolean };
    expect(res.expired).toBe(true);
    expect(res.notYetValid).toBe(false);
  });
});

describe('jwtMcpBridge — jwt_sign', () => {
  it('signs and round-trips through jwt_verify', async () => {
    const { token } = await handlers.jwt_sign({ payload: { sub: 'u1' }, algorithm: 'HS256', key: 'secret' }) as { token: string };
    const res = await handlers.jwt_verify({ token, algorithm: 'HS256', key: 'secret' }) as { valid: boolean; payload: { sub: string } };
    expect(res.valid).toBe(true);
    expect(res.payload.sub).toBe('u1');
  });

  it('takes the payload as a JSON string too', async () => {
    const { token } = await handlers.jwt_sign({ payload: '{"a":1}', algorithm: 'HS256', key: 'secret' }) as { token: string };
    expect((await handlers.jwt_decode({ token }) as { payload: { a: number } }).payload.a).toBe(1);
  });

  it('reads expiresIn as a duration from now', async () => {
    const { token } = await handlers.jwt_sign({ payload: {}, algorithm: 'HS256', key: 'secret', expiresIn: '1h' }) as { token: string };
    const { payload } = await handlers.jwt_decode({ token }) as { payload: { exp: number; iat: number } };
    expect(payload.exp - payload.iat).toBe(3600);
  });

  it('rejects a missing key, a bad algorithm and a non-object payload', async () => {
    await expect(handlers.jwt_sign({ payload: {}, algorithm: 'HS256' })).rejects.toThrow(/"key" is required/);
    await expect(handlers.jwt_sign({ payload: {}, algorithm: 'HS999', key: 's' })).rejects.toThrow(/Unknown algorithm/);
    await expect(handlers.jwt_sign({ payload: [1], algorithm: 'HS256', key: 's' })).rejects.toThrow(/JSON object/);
  });

  it('signs alg "none" without a key, and the result verifies as invalid', async () => {
    const { token } = await handlers.jwt_sign({ payload: { a: 1 }, algorithm: 'none' }) as { token: string };
    expect(token.split('.')[2]).toBe('');
    const res = await handlers.jwt_verify({ token, algorithm: 'none', key: '' }) as { valid: boolean };
    expect(res.valid).toBe(false);
  });
});

describe('jwtMcpBridge — jwt_verify', () => {
  it('returns a failed check as a result, not a thrown error', async () => {
    const { token } = await handlers.jwt_sign({ payload: { a: 1 }, algorithm: 'HS256', key: 'right' }) as { token: string };
    const res = await handlers.jwt_verify({ token, algorithm: 'HS256', key: 'wrong' }) as { valid: boolean; reason: string };
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('signature');
  });

  it('will not take the algorithm from the token header', async () => {
    const res = await handlers.jwt_verify({ token: SAMPLE_TOKEN, algorithm: 'RS256', key: '-----BEGIN PUBLIC KEY-----' }) as { valid: boolean; reason: string };
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('alg');
  });

  it('honours keyEncoding when the secret is base64', async () => {
    const { token } = await handlers.jwt_sign({ payload: {}, algorithm: 'HS256', key: 'c2VjcmV0', keyEncoding: 'base64' }) as { token: string };
    expect((await handlers.jwt_verify({ token, algorithm: 'HS256', key: 'secret' }) as { valid: boolean }).valid).toBe(true);
    expect((await handlers.jwt_verify({ token, algorithm: 'HS256', key: 'c2VjcmV0' }) as { valid: boolean }).valid).toBe(false);
  });

  it('separates expired from forged, and honours clockTolerance', async () => {
    const past = Math.floor(Date.now() / 1000) - 30;
    const { token } = await handlers.jwt_sign({ payload: { exp: past }, algorithm: 'HS256', key: 'secret' }) as { token: string };
    expect((await handlers.jwt_verify({ token, algorithm: 'HS256', key: 'secret' }) as { reason: string }).reason).toBe('expired');
    expect((await handlers.jwt_verify({ token, algorithm: 'HS256', key: 'secret', clockTolerance: 300 }) as { valid: boolean }).valid).toBe(true);
  });

  it('validates its own arguments', async () => {
    await expect(handlers.jwt_verify({ algorithm: 'HS256', key: 's' })).rejects.toThrow(/"token" is required/);
    await expect(handlers.jwt_verify({ token: SAMPLE_TOKEN, algorithm: 'HS256', key: 's', clockTolerance: 'lots' }))
      .rejects.toThrow(/clockTolerance/);
  });
});
