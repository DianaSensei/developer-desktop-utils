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
