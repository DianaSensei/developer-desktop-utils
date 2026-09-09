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
