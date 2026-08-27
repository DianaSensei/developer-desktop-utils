import { describe, expect, it } from 'vitest';
import { hasSessionCredentials, looksLikeCmdFormat, parseCurl } from './curl';

describe('parseCurl', () => {
  it('parses method, url, headers, and a raw JSON body', () => {
    const req = parseCurl(
      "curl -X POST 'https://api.example.com/login' \\\n" +
      "  -H 'Content-Type: application/json' \\\n" +
      "  -H 'X-Trace: abc' \\\n" +
      "  -d '{\"user\":\"me\"}'",
    );
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://api.example.com/login');
    expect(req.headers.map((h) => [h.key, h.value])).toEqual([
      ['Content-Type', 'application/json'],
      ['X-Trace', 'abc'],
    ]);
    expect(req.body).toEqual({ mode: 'json', raw: '{"user":"me"}', form: [] });
  });

  it('parses -u/--user into basic auth and strips a redundant Authorization header', () => {
    const req = parseCurl("curl -u alice:s3cret 'https://api.example.com/x' -H 'Authorization: Bearer old'");
    expect(req.auth).toMatchObject({ type: 'basic', username: 'alice', password: 's3cret' });
    expect(req.headers.some((h) => h.key.toLowerCase() === 'authorization')).toBe(false);
  });

  it('parses -b/--cookie into a Cookie header', () => {
    const req = parseCurl("curl 'https://api.example.com/x' -b 'session=abc123'");
    expect(req.headers).toEqual([expect.objectContaining({ key: 'Cookie', value: 'session=abc123' })]);
  });
});

describe('looksLikeCmdFormat', () => {
  it('flags a caret line continuation (Windows cmd.exe)', () => {
    const cmd = 'curl "https://api.example.com" ^\n  -H "Content-Type: application/json"';
    expect(looksLikeCmdFormat(cmd)).toBe(true);
  });

  it('does not flag a bash backslash continuation', () => {
    const bash = "curl 'https://api.example.com' \\\n  -H 'Content-Type: application/json'";
    expect(looksLikeCmdFormat(bash)).toBe(false);
  });

  it('does not flag a single-line command with no continuation at all', () => {
    expect(looksLikeCmdFormat("curl 'https://api.example.com' -H 'Accept: */*'")).toBe(false);
  });
});

describe('hasSessionCredentials', () => {
  it('flags a Cookie header', () => {
    const req = parseCurl("curl 'https://api.example.com/x' -H 'Cookie: session=abc'");
    expect(hasSessionCredentials(req)).toBe(true);
  });

  it('flags an Authorization header', () => {
    const req = parseCurl("curl 'https://api.example.com/x' -H 'Authorization: Bearer abc.def.ghi'");
    expect(hasSessionCredentials(req)).toBe(true);
  });

  it('flags -u/--user basic auth', () => {
    const req = parseCurl("curl -u alice:s3cret 'https://api.example.com/x'");
    expect(hasSessionCredentials(req)).toBe(true);
  });

  it('does not flag a request with no credential headers', () => {
    const req = parseCurl("curl 'https://api.example.com/x' -H 'Accept: application/json'");
    expect(hasSessionCredentials(req)).toBe(false);
  });
});
