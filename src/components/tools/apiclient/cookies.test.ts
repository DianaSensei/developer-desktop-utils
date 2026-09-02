import { describe, expect, it } from 'vitest';
import {
  applySetCookies, cookieHeader, cookiesFor, domainMatchesHost, groupByDomain, parseSetCookie,
  type Cookie,
} from './cookies';

const cookie = (partial: Partial<Cookie> & Pick<Cookie, 'name' | 'domain'>): Cookie => ({
  value: 'v', path: '/', ...partial,
});

describe('domainMatchesHost', () => {
  it('accepts the host itself and any parent domain of it', () => {
    expect(domainMatchesHost('api.example.com', 'api.example.com')).toBe(true);
    expect(domainMatchesHost('api.example.com', 'example.com')).toBe(true);
  });

  it('rejects an unrelated domain, a sibling, and a suffix that is not a label boundary', () => {
    expect(domainMatchesHost('evil.test', 'api.bank.example')).toBe(false);
    expect(domainMatchesHost('a.example.com', 'b.example.com')).toBe(false);
    // "notexample.com" ends with "example.com" as a *string* but is a
    // different site — the leading dot in the check is what rules it out.
    expect(domainMatchesHost('notexample.com', 'example.com')).toBe(false);
  });

  it('rejects a single-label domain unless it is the host (keeps `localhost` working)', () => {
    expect(domainMatchesHost('api.example.com', 'com')).toBe(false);
    expect(domainMatchesHost('localhost', 'localhost')).toBe(true);
  });
});

describe('parseSetCookie', () => {
  it('defaults to a host-only cookie scoped to the request path', () => {
    const c = parseSetCookie('sid=abc', 'https://api.example.com/v2/users/42')!;
    expect(c).toMatchObject({ name: 'sid', value: 'abc', domain: 'api.example.com', path: '/v2/users', hostOnly: true });
  });

  it('accepts a Domain attribute that covers the response host, dropping a leading dot', () => {
    const c = parseSetCookie('sid=abc; Domain=.example.com; Path=/', 'https://api.example.com/x')!;
    expect(c).toMatchObject({ domain: 'example.com', hostOnly: false, path: '/' });
  });

  it('rejects a Domain attribute for a host the response did not come from', () => {
    // Without this the jar would attach the cookie to the next request sent
    // to api.bank.example — a cookie planted by an unrelated server.
    const c = parseSetCookie('session=stolen; Domain=api.bank.example', 'https://evil.test/hook')!;
    expect(c).toMatchObject({ domain: 'evil.test', hostOnly: true });
  });

  it('Max-Age wins over Expires, and a name=value pair is required', () => {
    const c = parseSetCookie('a=1; Expires=Thu, 01 Jan 2099 00:00:00 GMT; Max-Age=60', 'https://x.test/')!;
    expect(c.expires).toBeGreaterThan(Date.now());
    expect(c.expires).toBeLessThan(Date.now() + 61_000);
    expect(parseSetCookie('novalue', 'https://x.test/')).toBeNull();
  });
});

describe('applySetCookies', () => {
  it('upserts by (domain, path, name) and deletes on an already-expired cookie', () => {
    const jar = applySetCookies([], ['a=1', 'b=2'], 'https://x.test/');
    expect(jar.map((c) => `${c.name}=${c.value}`).sort()).toEqual(['a=1', 'b=2']);

    const replaced = applySetCookies(jar, ['a=9'], 'https://x.test/');
    expect(replaced.find((c) => c.name === 'a')?.value).toBe('9');

    const cleared = applySetCookies(replaced, ['a=; Max-Age=0'], 'https://x.test/');
    expect(cleared.some((c) => c.name === 'a')).toBe(false);
  });
});

describe('cookiesFor / cookieHeader', () => {
  const jar: Cookie[] = [
    cookie({ name: 'host', domain: 'api.example.com', hostOnly: true }),
    cookie({ name: 'wide', domain: 'example.com', hostOnly: false }),
    cookie({ name: 'deep', domain: 'api.example.com', hostOnly: true, path: '/v2/users' }),
    cookie({ name: 'tls', domain: 'api.example.com', hostOnly: true, secure: true }),
    cookie({ name: 'gone', domain: 'api.example.com', hostOnly: true, expires: 1 }),
  ];

  it('matches on domain, path and secure, and sorts longest path first', () => {
    expect(cookiesFor(jar, 'https://api.example.com/v2/users/42').map((c) => c.name))
      .toEqual(['deep', 'host', 'wide', 'tls']);
  });

  it('never sends a Secure cookie over http, and never an expired one', () => {
    const names = cookiesFor(jar, 'http://api.example.com/v2/users/42').map((c) => c.name);
    expect(names).not.toContain('tls');
    expect(names).not.toContain('gone');
  });

  it('a host-only cookie does not reach a sibling host; a domain cookie does', () => {
    const names = cookiesFor(jar, 'https://cdn.example.com/');
    expect(names.map((c) => c.name)).toEqual(['wide']);
  });

  it('path matching respects label boundaries', () => {
    // /v2/usersXX must not match a cookie scoped to /v2/users.
    expect(cookiesFor(jar, 'https://api.example.com/v2/usersXX').map((c) => c.name)).not.toContain('deep');
  });

  it('serializes to a Cookie header value', () => {
    expect(cookieHeader(jar, 'https://api.example.com/')).toBe('host=v; wide=v; tls=v');
  });
});

describe('groupByDomain', () => {
  it('groups and sorts by domain name', () => {
    const grouped = groupByDomain([
      cookie({ name: 'b', domain: 'z.test' }),
      cookie({ name: 'a', domain: 'a.test' }),
      cookie({ name: 'c', domain: 'a.test' }),
    ]);
    expect(grouped.map(([d, cs]) => [d, cs.length])).toEqual([['a.test', 2], ['z.test', 1]]);
  });
});
