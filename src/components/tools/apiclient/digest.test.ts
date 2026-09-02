import { describe, expect, it } from 'vitest';
import { buildDigestHeader, md5, parseDigestChallenge, type DigestChallenge } from './digest';

// Pull the quoted/unquoted value of one parameter out of an
// `Authorization: Digest …` header, so a generated response can be recomputed
// against the cnonce that was actually used.
const param = (header: string, name: string): string => {
  const m = new RegExp(`${name}=(?:"([^"]*)"|([^,\\s]+))`).exec(header);
  return m ? (m[1] ?? m[2]) : '';
};

describe('md5', () => {
  it('matches the RFC 1321 test vectors', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
    expect(md5('12345678901234567890123456789012345678901234567890123456789012345678901234567890'))
      .toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('hashes the UTF-8 bytes, not the UTF-16 code units', () => {
    // A password with an accent has to hash to what the server computes, and
    // the server sees UTF-8 bytes. Vectors from node's crypto.
    expect(md5('é')).toBe('66ddcd97cfdeabb2f6fb8a999b4bc76f');
    expect(md5('café')).toBe('07117fe4a1ebd544965dc19573183da2');
  });

  it('is stable across the 64-byte block boundary', () => {
    // 55/56/64 bytes straddle MD5's padding cases — the classic off-by-one.
    expect(md5('a'.repeat(55))).toBe('ef1772b6dff9a122358552954ad0df65');
    expect(md5('a'.repeat(56))).toBe('3b0c8ac703f828b04c6c197006d17218');
    expect(md5('a'.repeat(64))).toBe('014842d480b571495a4a0363793f7367');
  });
});

describe('parseDigestChallenge', () => {
  it('reads quoted and unquoted parameters', () => {
    const c = parseDigestChallenge(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b71", opaque="5ccc069c", algorithm=MD5-sess',
    )!;
    expect(c).toEqual({
      realm: 'testrealm@host.com',
      nonce: 'dcd98b71',
      qop: 'auth,auth-int',
      opaque: '5ccc069c',
      algorithm: 'MD5-sess',
    });
  });

  it('defaults the algorithm to MD5 and tolerates a missing qop/opaque', () => {
    const c = parseDigestChallenge('Digest realm="r", nonce="n"')!;
    expect(c).toMatchObject({ algorithm: 'MD5', qop: '', opaque: '' });
  });

  it('rejects a non-Digest scheme and a challenge missing realm or nonce', () => {
    expect(parseDigestChallenge('Basic realm="r"')).toBeNull();
    expect(parseDigestChallenge('Digest realm="r"')).toBeNull();
    expect(parseDigestChallenge('Digest nonce="n"')).toBeNull();
    expect(parseDigestChallenge('')).toBeNull();
  });
});

describe('buildDigestHeader', () => {
  const base = {
    username: 'Mufasa',
    password: 'Circle Of Life',
    method: 'GET',
    uri: '/dir/index.html',
  };
  const challenge = (over: Partial<DigestChallenge> = {}): DigestChallenge => ({
    realm: 'testrealm@host.com',
    nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
    qop: 'auth',
    opaque: '5ccc069c403ebaf9f0171e9517f40e41',
    algorithm: 'MD5',
    ...over,
  });

  it('computes the RFC 2617 qop=auth response for the cnonce it generated', () => {
    const c = challenge();
    const header = buildDigestHeader({ ...base, challenge: c });
    const cnonce = param(header, 'cnonce');
    expect(cnonce).toMatch(/^[0-9a-f]{16}$/);

    const ha1 = md5(`${base.username}:${c.realm}:${base.password}`);
    // The RFC's own worked example, so a broken md5 shows up here directly.
    expect(ha1).toBe('939e7578ed9e3c518a452acee763bce9');
    const ha2 = md5(`${base.method}:${base.uri}`);
    expect(ha2).toBe('39aff3a2bab6126f332b942af96d3366');

    expect(param(header, 'response'))
      .toBe(md5(`${ha1}:${c.nonce}:00000001:${cnonce}:auth:${ha2}`));
    expect(param(header, 'qop')).toBe('auth');
    expect(param(header, 'nc')).toBe('00000001');
    expect(param(header, 'uri')).toBe('/dir/index.html');
    expect(param(header, 'opaque')).toBe(c.opaque);
  });

  it('folds nonce and cnonce into HA1 for MD5-sess', () => {
    const c = challenge({ algorithm: 'MD5-sess' });
    const header = buildDigestHeader({ ...base, challenge: c });
    const cnonce = param(header, 'cnonce');
    const ha1 = md5(`${md5(`${base.username}:${c.realm}:${base.password}`)}:${c.nonce}:${cnonce}`);
    const ha2 = md5(`${base.method}:${base.uri}`);
    expect(param(header, 'response'))
      .toBe(md5(`${ha1}:${c.nonce}:00000001:${cnonce}:auth:${ha2}`));
  });

  it('falls back to RFC 2069 when the server offers only auth-int', () => {
    // auth-int needs the body hash folded into HA2, which this does not
    // implement — claiming qop=auth anyway would just be rejected.
    const c = challenge({ qop: 'auth-int' });
    const header = buildDigestHeader({ ...base, challenge: c });
    expect(header).not.toContain('qop=');
    expect(header).not.toContain('cnonce=');
    expect(header).not.toContain('nc=');
    const ha1 = md5(`${base.username}:${c.realm}:${base.password}`);
    const ha2 = md5(`${base.method}:${base.uri}`);
    expect(param(header, 'response')).toBe(md5(`${ha1}:${c.nonce}:${ha2}`));
  });

  it('picks auth out of a qop list that also offers auth-int', () => {
    const header = buildDigestHeader({ ...base, challenge: challenge({ qop: 'auth-int, auth' }) });
    expect(param(header, 'qop')).toBe('auth');
  });

  it('uses a fresh cnonce on every call', () => {
    const c = challenge();
    const a = param(buildDigestHeader({ ...base, challenge: c }), 'cnonce');
    const b = param(buildDigestHeader({ ...base, challenge: c }), 'cnonce');
    expect(a).not.toBe(b);
  });
});
