import { describe, it, expect } from 'vitest';
import { generateCode } from './codegen';
import { newRequest } from './types';

describe('generateCode — Shell/curl', () => {
  it('produces a well-formed multi-line command (no doubled line-continuation backslash)', () => {
    const req = newRequest({
      method: 'POST',
      url: 'https://api.example.com/users',
      headers: [{ id: 'h1', key: 'X-Test', value: '1', enabled: true }],
      body: { mode: 'json', raw: '{"a":1}', form: [] },
    });
    const out = generateCode(req, {}, 'Shell', 'curl', true, []);

    expect(out).toBe(
      [
        'curl --request POST \\',
        "  --url 'https://api.example.com/users' \\",
        "  --header 'X-Test: 1' \\",
        "  --header 'Content-Type: application/json' \\",
        "  --data '{\"a\":1}'",
      ].join('\n'),
    );
    // Every continued line ends in exactly one backslash, and only that one.
    const body = out.split('\n');
    for (const line of body.slice(0, -1)) expect(line).toMatch(/[^\\]\\$/);
    expect(body.at(-1)).not.toMatch(/\\$/);
  });

  it('is a single line (no trailing backslash) for a bare GET with no headers', () => {
    const req = newRequest({ method: 'GET', url: 'https://api.example.com/users' });
    const out = generateCode(req, {}, 'Shell', 'curl', true, []);
    expect(out).toBe("curl --request GET \\\n  --url 'https://api.example.com/users'");
  });
});

describe('generateCode — matches what is sent', () => {
  it('a GET keeps no body in the generated command, since none is sent', () => {
    const req = newRequest({ method: 'GET', url: 'https://es.test/_search' });
    req.body = { mode: 'json', raw: '{"query":{"match_all":{}}}', form: [] };
    const out = generateCode(req, {}, 'Shell', 'curl', true, []);
    expect(out).not.toContain('match_all');
    expect(out).not.toMatch(/--data/);
  });
});

describe('generateCode — what Send adds on top of the request', () => {
  it('attaches matching jar cookies unless the request sets its own Cookie', () => {
    const req = newRequest({ method: 'GET', url: 'https://api.test/me' });
    const cookieJar = [{ name: 'sid', value: 'xyz', domain: 'api.test', path: '/' }];
    expect(generateCode(req, {}, 'Shell', 'curl', true, [], { cookieJar })).toContain("--header 'Cookie: sid=xyz'");

    req.headers = [{ id: 'h1', key: 'Cookie', value: 'mine=1', enabled: true }];
    const own = generateCode(req, {}, 'Shell', 'curl', true, [], { cookieJar });
    expect(own).toContain("--header 'Cookie: mine=1'");
    expect(own).not.toContain('sid=xyz');
  });
});
