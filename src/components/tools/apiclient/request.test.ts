import { afterEach, describe, expect, it, vi } from 'vitest';
import { authQueryParam, buildUrl, paramsFromUrl, sendRequest, substituteVars, urlWithParams } from './request';
import { newAuth, newKeyValue, newRequest, type ApiRequest } from './types';

// A minimal stand-in for the parts of `Response` that sendRequest reads.
function fakeResponse(bytes: Uint8Array, headers: Record<string, string>, init: { status?: number; statusText?: string; url?: string } = {}) {
  const status = init.status ?? 200;
  return {
    status,
    statusText: init.statusText ?? 'OK',
    ok: status >= 200 && status < 300,
    url: init.url ?? 'https://api.test/x',
    headers: new Headers(headers),
    // Copy into a fresh buffer so the view's offset never leaks into the result.
    arrayBuffer: async () => bytes.slice().buffer,
  } as unknown as Response;
}

function stubFetch(res: Response) {
  const spy = vi.fn(async () => res);
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => { vi.unstubAllGlobals(); });

const req = (over: Partial<ApiRequest> = {}): ApiRequest =>
  newRequest({ url: 'https://api.test/x', ...over });

describe('sendRequest — response decoding', () => {
  it('decodes text bodies and reports the exact decoded size', async () => {
    // 'héllo' is 6 bytes in UTF-8 but 5 characters.
    const bytes = new TextEncoder().encode('héllo');
    stubFetch(fakeResponse(bytes, { 'content-type': 'text/plain' }));

    const res = await sendRequest(req(), {});
    expect(res.body).toBe('héllo');
    expect(res.sizeBytes).toBe(6);
    expect(res.binary).toBe(false);
    expect(res.bodyBase64).toBeUndefined();
  });

  it('ignores a content-length that describes the compressed transfer', async () => {
    const bytes = new TextEncoder().encode('0123456789');
    stubFetch(fakeResponse(bytes, { 'content-type': 'text/plain', 'content-length': '4' }));

    const res = await sendRequest(req(), {});
    expect(res.sizeBytes).toBe(10);
  });

  it('preserves binary payloads as base64 instead of corrupting them', async () => {
    // A PNG signature — invalid UTF-8, so a text decode would lose the bytes.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]);
    stubFetch(fakeResponse(png, { 'content-type': 'image/png' }));

    const res = await sendRequest(req(), {});
    expect(res.binary).toBe(true);
    expect(res.bodyBase64).toBeTruthy();

    const decoded = Uint8Array.from(atob(res.bodyBase64!), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(png));
  });

  it('treats an unlabelled payload containing NUL bytes as binary', async () => {
    stubFetch(fakeResponse(new Uint8Array([1, 0, 2]), {}));
    const res = await sendRequest(req(), {});
    expect(res.binary).toBe(true);
  });

  it('treats JSON as text even without a charset', async () => {
    stubFetch(fakeResponse(new TextEncoder().encode('{"a":1}'), { 'content-type': 'application/json' }));
    const res = await sendRequest(req(), {});
    expect(res.binary).toBe(false);
    expect(res.body).toBe('{"a":1}');
  });

  it('splits the round trip into TTFB and download', async () => {
    stubFetch(fakeResponse(new TextEncoder().encode('ok'), { 'content-type': 'text/plain' }));
    const res = await sendRequest(req(), {});
    expect(res.timings).toBeDefined();
    expect(res.timings!.ttfbMs).toBeGreaterThanOrEqual(0);
    expect(res.timings!.downloadMs).toBeGreaterThanOrEqual(0);
    // The parts must not exceed the whole (allowing for rounding of each part).
    expect(res.timings!.ttfbMs + res.timings!.downloadMs).toBeLessThanOrEqual(res.timeMs + 2);
  });
});

describe('sendRequest — request building', () => {
  it('substitutes variables into the URL and headers', async () => {
    const spy = stubFetch(fakeResponse(new TextEncoder().encode('{}'), { 'content-type': 'application/json' }));
    await sendRequest(
      req({ url: 'https://{{host}}/users', headers: [newKeyValue('X-Key', '{{key}}')] }),
      { host: 'api.test', key: 'secret' },
    );
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/users');
    expect((init.headers as Record<string, string>)['X-Key']).toBe('secret');
  });

  it('applies inherited collection/folder headers ahead of the request\'s own', async () => {
    const spy = stubFetch(fakeResponse(new TextEncoder().encode('{}'), { 'content-type': 'application/json' }));
    await sendRequest(
      req({ headers: [newKeyValue('X-Own', 'request')] }),
      {},
      undefined,
      [],
      [[newKeyValue('X-Collection', 'collection')], [newKeyValue('X-Folder', 'folder')]],
    );
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Collection']).toBe('collection');
    expect(headers['X-Folder']).toBe('folder');
    expect(headers['X-Own']).toBe('request');
  });

  it('lets a request header override an inherited one of the same name, case-insensitively', async () => {
    const spy = stubFetch(fakeResponse(new TextEncoder().encode('{}'), { 'content-type': 'application/json' }));
    await sendRequest(
      req({ headers: [newKeyValue('x-shared', 'from-request')] }),
      {},
      undefined,
      [],
      [[newKeyValue('X-Shared', 'from-collection')]],
    );
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).filter((k) => k.toLowerCase() === 'x-shared')).toHaveLength(1);
    expect(headers['x-shared']).toBe('from-request');
  });

  it('lets an inner folder header override the collection\'s own of the same name', async () => {
    const spy = stubFetch(fakeResponse(new TextEncoder().encode('{}'), { 'content-type': 'application/json' }));
    await sendRequest(
      req(),
      {},
      undefined,
      [],
      [[newKeyValue('X-Shared', 'from-collection')], [newKeyValue('X-Shared', 'from-folder')]],
    );
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Shared']).toBe('from-folder');
  });

  it('rejects an empty URL', async () => {
    stubFetch(fakeResponse(new Uint8Array(), {}));
    await expect(sendRequest(req({ url: '   ' }), {})).rejects.toThrow('Enter a request URL');
  });

  it('defaults to http when no scheme is given', async () => {
    const spy = stubFetch(fakeResponse(new TextEncoder().encode('ok'), { 'content-type': 'text/plain' }));
    await sendRequest(req({ url: 'localhost:3000/health' }), {});
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('http://localhost:3000/health');
  });

  it('aborts with a timeout message when the per-request timeout fires', async () => {
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));
    const settings = { ...newRequest().settings, timeout: 10 };
    await expect(sendRequest(req({ settings }), {})).rejects.toThrow(/timed out after 10 ms/);
  });

  it('passes a danger flag to disable cert verification when verifyTls is off', async () => {
    const spy = stubFetch(fakeResponse(new TextEncoder().encode('{}'), { 'content-type': 'application/json' }));
    const settings = { ...newRequest().settings, verifyTls: false };
    await sendRequest(req({ settings }), {});
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit & { danger?: unknown }];
    expect(init.danger).toEqual({ acceptInvalidCerts: true, acceptInvalidHostnames: true });
  });

  it('omits the danger flag by default (verifyTls left at its default)', async () => {
    const spy = stubFetch(fakeResponse(new TextEncoder().encode('{}'), { 'content-type': 'application/json' }));
    await sendRequest(req(), {});
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit & { danger?: unknown }];
    expect(init.danger).toBeUndefined();
  });
});

describe('URL ⇄ params sync', () => {
  it('reads params out of a URL, preserving {{vars}} verbatim', () => {
    const params = paramsFromUrl('https://api.test/x?a=1&b={{token}}', []);
    expect(params.map((p) => [p.key, p.value])).toEqual([['a', '1'], ['b', '{{token}}']]);
  });

  it('keeps disabled rows that the URL cannot represent', () => {
    const existing = [{ ...newKeyValue('off', 'v'), enabled: false }];
    const params = paramsFromUrl('https://api.test/x?a=1', existing);
    expect(params.map((p) => p.key)).toEqual(['a', 'off']);
    expect(params[1].enabled).toBe(false);
  });

  it('rebuilds the query from enabled params only', () => {
    const rows = [newKeyValue('a', '1'), { ...newKeyValue('b', '2'), enabled: false }, newKeyValue('', 'x')];
    expect(urlWithParams('https://api.test/x?old=1#frag', rows)).toBe('https://api.test/x?a=1#frag');
  });

  it('drops the query entirely when no params remain', () => {
    expect(urlWithParams('https://api.test/x?a=1', [])).toBe('https://api.test/x');
  });
});

describe('substituteVars', () => {
  it('leaves unknown tokens in place so they stay visible', () => {
    expect(substituteVars('{{known}}/{{missing}}', { known: 'ok' })).toBe('ok/{{missing}}');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(substituteVars('{{ name }}', { name: 'x' })).toBe('x');
  });
});

describe('authQueryParam', () => {
  it('returns null when auth is not an api-key-in-query', () => {
    expect(authQueryParam(req())).toBeNull();
    expect(authQueryParam(req({ auth: { ...newAuth(), type: 'apikey', apiKey: { key: 'k', value: 'v', placement: 'header' } } }))).toBeNull();
  });

  it('returns null when the key is blank', () => {
    const auth = { ...newAuth(), type: 'apikey' as const, apiKey: { key: '  ', value: 'v', placement: 'query' as const } };
    expect(authQueryParam(req({ auth }))).toBeNull();
  });

  it('surfaces the key/value when auth places the api key in the query', () => {
    const auth = { ...newAuth(), type: 'apikey' as const, apiKey: { key: 'apiKey', value: 'secret-1', placement: 'query' as const } };
    expect(authQueryParam(req({ auth }))).toEqual({ key: 'apiKey', value: 'secret-1' });
  });
});


describe('buildUrl — disabled query params', () => {
  const id = (s: string) => s;

  it('drops the URL query when every param row is disabled', () => {
    // Reachable on any Postman/OpenAPI import: the URL keeps the full raw
    // query while the params table carries the enabled flags.
    const req = newRequest({
      url: 'https://api.test/search?q=secret',
      params: [{ ...newKeyValue('q', 'secret'), enabled: false }],
    });
    expect(buildUrl(req, id)).toBe('https://api.test/search');
  });

  it('keeps the enabled ones and drops only the disabled', () => {
    const req = newRequest({
      url: 'https://api.test/search?q=a&page=2',
      params: [newKeyValue('q', 'a'), { ...newKeyValue('page', '2'), enabled: false }],
    });
    expect(buildUrl(req, id)).toBe('https://api.test/search?q=a');
  });

  it('leaves the URL alone when there is no params table to govern it', () => {
    const req = newRequest({ url: 'https://api.test/search?q=raw', params: [] });
    expect(buildUrl(req, id)).toBe('https://api.test/search?q=raw');
  });
});
