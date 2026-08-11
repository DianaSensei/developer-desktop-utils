import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeRequest } from './engine';
import { __setSandboxWorkerFactory } from './scriptHost';
import { newRequest, type ApiRequest, type Environment } from './types';

function stubJson(body: string, status = 200) {
  const bytes = new TextEncoder().encode(body);
  const res = {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    ok: status >= 200 && status < 300,
    url: 'https://api.test/x',
    headers: new Headers({ 'content-type': 'application/json' }),
    arrayBuffer: async () => bytes.slice().buffer,
  } as unknown as Response;
  const spy = vi.fn(async () => res);
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => { vi.unstubAllGlobals(); });

const req = (over: Partial<ApiRequest> = {}): ApiRequest =>
  newRequest({ url: 'https://api.test/x', ...over });

const env = (variables: Record<string, string>): Environment => ({
  id: 'e1',
  name: 'Test',
  variables: Object.entries(variables).map(([key, value], i) => ({ id: `v${i}`, key, value, enabled: true })),
});

describe('executeRequest — script error attribution', () => {
  it('names the pre-request script and does not send', async () => {
    const spy = stubJson('{}');
    const r = await executeRequest(req({ script: { req: 'throw new Error("bad setup");', res: '' } }), null, {});
    expect(spy).not.toHaveBeenCalled();
    expect(r.response).toBeNull();
    expect(r.error).toContain('Pre-request script');
    expect(r.error).toContain('bad setup');
  });

  it('names an inherited pre-request script separately', async () => {
    stubJson('{}');
    const r = await executeRequest(req(), null, {}, undefined, { pre: ['throw new Error("from folder");'], post: [] });
    expect(r.error).toContain('Inherited pre-request script');
    expect(r.error).toContain('from folder');
  });

  it('still runs tests when the post-response script fails', async () => {
    stubJson('{"id":7}');
    const r = await executeRequest(
      req({
        script: { req: '', res: 'throw new Error("post boom");' },
        tests: 'test("status", () => expect(res.getStatus()).to.equal(200));',
      }),
      null, {},
    );
    expect(r.response?.status).toBe(200);
    expect(r.error).toContain('Post-response script');
    expect(r.tests).toEqual([{ name: 'status', passed: true }]);
  });

  it('reports every failing script rather than only the last', async () => {
    stubJson('{}');
    const r = await executeRequest(
      req({ script: { req: '', res: 'throw new Error("one");' }, tests: 'throw new Error("two");' }),
      null, {},
    );
    expect(r.error).toContain('one');
    expect(r.error).toContain('two');
  });

  it('reports a transport failure as the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused'); }));
    const r = await executeRequest(req(), null, {});
    expect(r.response).toBeNull();
    expect(r.error).toContain('connection refused');
  });
});

describe('executeRequest — variables', () => {
  it('applies environment variables and persists script-set env changes', async () => {
    const spy = stubJson('{"token":"t-123"}');
    const r = await executeRequest(
      req({
        url: 'https://{{host}}/x',
        script: { req: '', res: "bru.setEnvVar('token', res.getBody().token);" },
      }),
      env({ host: 'api.test' }), {},
    );
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('https://api.test/x');
    expect(r.envChanged).toBe(true);
    expect(r.envVars.token).toBe('t-123');
  });

  it('lets runtime vars win over the environment', async () => {
    const spy = stubJson('{}');
    await executeRequest(
      req({ url: 'https://{{host}}/x' }),
      env({ host: 'env.test' }),
      { host: 'runtime.test' },
    );
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('https://runtime.test/x');
  });

  it('lets a data-file row override the environment but not runtime vars', async () => {
    const spy = stubJson('{}');
    await executeRequest(
      req({ url: 'https://{{host}}/{{path}}' }),
      env({ host: 'env.test', path: 'env' }),
      { path: 'runtime' },
      undefined, { pre: [], post: [] }, [], { host: 'data.test', path: 'data' },
    );
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('https://data.test/runtime');
  });

  it('exposes declarative post-response vars to later scripts', async () => {
    stubJson('{"id":42}');
    const r = await executeRequest(
      req({
        vars: { req: [], res: [{ id: 'v1', name: 'itemId', value: 'res.body.id', enabled: true }] },
        tests: 'test("var", () => expect(bru.getVar("itemId")).to.equal("42"));',
      }),
      null, {},
    );
    expect(r.tests).toEqual([{ name: 'var', passed: true }]);
    expect(r.runtimeVars.itemId).toBe('42');
  });
});

describe('executeRequest — assertions', () => {
  it('evaluates declarative assertions against the response', async () => {
    stubJson('{"items":[1,2,3]}');
    const r = await executeRequest(
      req({
        assertions: [
          { id: 'a1', expr: 'res.status', operator: 'equals', value: '200', enabled: true },
          { id: 'a2', expr: 'res.body.items', operator: 'length', value: '3', enabled: true },
          { id: 'a3', expr: 'res.status', operator: 'equals', value: '500', enabled: true },
          { id: 'a4', expr: 'res.status', operator: 'equals', value: '999', enabled: false },
        ],
      }),
      null, {},
    );
    expect(r.tests.map((t) => t.passed)).toEqual([true, true, false]);
  });
});

describe('executeRequest — request mutation from scripts', () => {
  it('applies header changes made in the pre-request script', async () => {
    const spy = stubJson('{}');
    await executeRequest(
      req({ script: { req: "req.setHeader('X-Trace', 'abc'); req.setMethod('post');", res: '' } }),
      null, {},
    );
    const init = (spy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['X-Trace']).toBe('abc');
    expect(init.method).toBe('POST');
  });

  it('does not mutate the stored request', async () => {
    stubJson('{}');
    const original = req({ script: { req: "req.setUrl('https://other.test/y');", res: '' } });
    await executeRequest(original, null, {});
    expect(original.url).toBe('https://api.test/x');
  });
});

describe('executeRequest — script sandbox', () => {
  // A worker that never answers, to exercise the timeout path end to end.
  class SilentWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    terminated = false;
    postMessage() { /* never replies */ }
    terminate() { this.terminated = true; }
  }

  afterEach(() => { __setSandboxWorkerFactory(null); });

  it('does not start the sandbox for a request with no scripts, vars, or assertions', async () => {
    stubJson('{}');
    const factory = vi.fn(() => new SilentWorker() as unknown as Worker);
    __setSandboxWorkerFactory(factory);

    const r = await executeRequest(req(), null, {});
    expect(r.response?.status).toBe(200);
    expect(factory).not.toHaveBeenCalled();
  });

  it('reports a script that overruns its timeout instead of hanging', async () => {
    stubJson('{}');
    __setSandboxWorkerFactory(() => new SilentWorker() as unknown as Worker);

    const r = await executeRequest(
      req({ script: { req: 'while (true) {}', res: '' } }),
      null, {}, undefined, { pre: [], post: [] }, [], {},
      20,
    );
    // The send is skipped: the request was never finished being built.
    expect(r.response).toBeNull();
    expect(r.error).toContain('timed out after 20 ms');
  });

  it('keeps the response when a post-response script times out', async () => {
    stubJson('{"id":1}');
    let calls = 0;
    __setSandboxWorkerFactory(() => { calls++; return new SilentWorker() as unknown as Worker; });

    const r = await executeRequest(
      req({ tests: 'while (true) {}' }),
      null, {}, undefined, { pre: [], post: [] }, [], {},
      20,
    );
    expect(r.response?.status).toBe(200);
    expect(r.error).toContain('timed out');
    expect(calls).toBe(1);
  });
});

describe('executeRequest — flow control', () => {
  it('surfaces setNextRequest on the result', async () => {
    stubJson('{}');
    const r = await executeRequest(
      req({ script: { req: '', res: "bru.setNextRequest('Cleanup');" } }),
      null, {},
    );
    expect(r.nextRequest).toBe('Cleanup');
  });

  it('surfaces null for an early end of iteration', async () => {
    stubJson('{}');
    const r = await executeRequest(req({ tests: 'bru.setNextRequest(null);' }), null, {});
    expect(r.nextRequest).toBeNull();
  });

  it('leaves nextRequest undefined when no script asked', async () => {
    stubJson('{}');
    const r = await executeRequest(req({ tests: 'test("t", () => expect(1).to.equal(1));' }), null, {});
    expect(r.nextRequest).toBeUndefined();
  });
});
