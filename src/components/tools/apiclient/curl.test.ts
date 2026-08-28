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

  // curl's own default: -d/--data with no explicit Content-Type header still
  // sends application/x-www-form-urlencoded, so a bare `-d 'a=1'` is a form
  // body even though nothing in the command says so.
  it('treats a bare -d body with no Content-Type header as urlencoded', () => {
    const req = parseCurl("curl -X POST 'https://api.example.com/x' -d 'ushiw=jwj'");
    expect(req.body).toEqual({ mode: 'urlencoded', raw: '', form: [expect.objectContaining({ key: 'ushiw', value: 'jwj' })] });
  });

  it('treats a bare multi-field -d body as urlencoded and merges it with a following -d', () => {
    const req = parseCurl("curl -X POST 'https://api.example.com/x' -d 'a=1' -d 'b=2'");
    expect(req.body).toEqual({
      mode: 'urlencoded',
      raw: '',
      form: [expect.objectContaining({ key: 'a', value: '1' }), expect.objectContaining({ key: 'b', value: '2' })],
    });
  });

  it('still treats a bare -d JSON body as json, not urlencoded', () => {
    const req = parseCurl("curl -X POST 'https://api.example.com/x' -d '{\"a\":1}'");
    expect(req.body).toEqual({ mode: 'json', raw: '{"a":1}', form: [] });
  });

  it('still treats a bare -d body with no "=" as plain text', () => {
    const req = parseCurl("curl -X POST 'https://api.example.com/x' -d 'not a form body'");
    expect(req.body).toEqual({ mode: 'text', raw: 'not a form body', form: [] });
  });

  it('an explicit non-form Content-Type header overrides the urlencoded default', () => {
    const req = parseCurl("curl -X POST 'https://api.example.com/x' -H 'Content-Type: text/plain' -d 'ushiw=jwj'");
    expect(req.body).toEqual({ mode: 'text', raw: 'ushiw=jwj', form: [] });
  });

  // The exact command from the bug report: a typo'd --data-urlendcode (missing
  // the 'e') is an unknown flag to curl (and to our parser) and its argument is
  // dropped, same as real curl would refuse it — only the plain -d survives.
  it("drops an unrecognized flag's argument (e.g. a typo'd --data-urlendcode) and still form-decodes the surviving -d", () => {
    const req = parseCurl("curl -X POST 'https://api.example.com/x' --data-urlendcode 'avd=aj' -d 'ushiw=jwj'");
    expect(req.body).toEqual({ mode: 'urlencoded', raw: '', form: [expect.objectContaining({ key: 'ushiw', value: 'jwj' })] });
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
