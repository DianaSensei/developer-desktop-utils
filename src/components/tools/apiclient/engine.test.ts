import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeRequest } from './engine';
import { __setSandboxWorkerFactory } from './scriptHost';
import { runPhase, type PhaseInput, type PhaseOutput } from './scriptPhases';
import { newRequest, type ApiRequest, type Environment } from './types';

// jsdom has no Worker, and the sandbox now refuses to run a phase without one
// (a collection script must never touch the main thread). These tests are about
// engine behaviour rather than the sandbox, so stand in a worker that runs the
// real `runPhase` in-process and answers over the same message protocol.
class InProcessWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private controllers = new Map<number, AbortController>();

  postMessage(msg: { type: string; id: number; input?: PhaseInput }) {
    if (msg.type === 'abort') {
      this.controllers.get(msg.id)?.abort();
      return;
    }
    const controller = new AbortController();
    this.controllers.set(msg.id, controller);
    void runPhase(msg.input!, controller.signal)
      .then((output: PhaseOutput) => {
        this.onmessage?.({ data: { type: 'done', id: msg.id, output } } as MessageEvent);
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        this.onmessage?.({ data: { type: 'failed', id: msg.id, message } } as MessageEvent);
      })
      .finally(() => { this.controllers.delete(msg.id); });
  }

  terminate() { this.controllers.forEach((c) => c.abort()); }
}

beforeEach(() => {
  __setSandboxWorkerFactory(() => new InProcessWorker() as unknown as Worker);
});

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

const env = (variables: Record<string, string>, collectionId: string | null = null): Environment => ({
  id: 'e1',
  name: 'Test',
  collectionId,
  variables: Object.entries(variables).map(([key, value], i) => ({ id: `v${i}`, key, value, enabled: true })),
});

describe('executeRequest — script error attribution', () => {
  it('names the pre-request script and does not send', async () => {
    const spy = stubJson('{}');
    const r = await executeRequest(req({ script: { req: 'throw new Error("bad setup");', res: '' } }), null, null, {});
    expect(spy).not.toHaveBeenCalled();
    expect(r.response).toBeNull();
    expect(r.error).toContain('Pre-request script');
    expect(r.error).toContain('bad setup');
  });

  it('names an inherited pre-request script separately', async () => {
    stubJson('{}');
    const r = await executeRequest(req(), null, null, {}, undefined, { pre: ['throw new Error("from folder");'], post: [] });
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
      null, null, {},
    );
    expect(r.response?.status).toBe(200);
    expect(r.error).toContain('Post-response script');
    expect(r.tests).toEqual([{ name: 'status', passed: true }]);
  });

  it('reports every failing script rather than only the last', async () => {
    stubJson('{}');
    const r = await executeRequest(
      req({ script: { req: '', res: 'throw new Error("one");' }, tests: 'throw new Error("two");' }),
      null, null, {},
    );
    expect(r.error).toContain('one');
    expect(r.error).toContain('two');
  });

  it('reports a transport failure as the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused'); }));
    const r = await executeRequest(req(), null, null, {});
    expect(r.response).toBeNull();
    expect(r.error).toContain('connection refused');
  });
});

describe('executeRequest — variables', () => {
  it('applies collection-environment variables and persists script-set changes', async () => {
    const spy = stubJson('{"token":"t-123"}');
    const r = await executeRequest(
      req({
        url: 'https://{{host}}/x',
        script: { req: '', res: "bru.setEnvVar('token', res.getBody().token);" },
      }),
      env({ host: 'api.test' }, 'c1'), null, {},
    );
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('https://api.test/x');
    expect(r.collectionEnvChanged).toBe(true);
    expect(r.collectionEnvVars.token).toBe('t-123');
    expect(r.globalEnvChanged).toBe(false);
  });

  it('applies global-environment variables and persists script-set changes separately from the collection env', async () => {
    const spy = stubJson('{"token":"g-123"}');
    const r = await executeRequest(
      req({
        url: 'https://{{host}}/x',
        script: { req: '', res: "bru.setEnvVar('token', res.getBody().token, 'global');" },
      }),
      null, env({ host: 'global.test' }), {},
    );
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('https://global.test/x');
    expect(r.globalEnvChanged).toBe(true);
    expect(r.globalEnvVars.token).toBe('g-123');
    expect(r.collectionEnvChanged).toBe(false);
  });

  it('persists a script write to Collection Variables via bru.setCollectionVar', async () => {
    stubJson('{"limit":42}');
    const r = await executeRequest(
      req({ script: { req: '', res: "bru.setCollectionVar('limit', String(res.getBody().limit));" } }),
      null, null, {},
    );
    expect(r.collectionVarsChanged).toBe(true);
    expect(r.collectionVars.limit).toBe('42');
    expect(r.collectionEnvChanged).toBe(false);
    expect(r.globalEnvChanged).toBe(false);
  });

  it('lets the collection environment override the global environment for the same name', async () => {
    const spy = stubJson('{}');
    await executeRequest(
      req({ url: 'https://{{host}}/x' }),
      env({ host: 'coll-env.test' }, 'c1'),
      env({ host: 'global-env.test' }),
      {},
    );
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('https://coll-env.test/x');
  });

  it('lets runtime vars win over both environments', async () => {
    const spy = stubJson('{}');
    await executeRequest(
      req({ url: 'https://{{host}}/x' }),
      env({ host: 'coll-env.test' }, 'c1'),
      env({ host: 'global-env.test' }),
      { host: 'runtime.test' },
    );
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('https://runtime.test/x');
  });

  it('persists a runtime var set with bru.setVar in a pre-request script', async () => {
    // Direct regression test for the report that a pre-request bru.setVar
    // seemed to "stick" no matter what — this confirms the base mechanism
    // (script -> stores.runtime -> ExecResult.runtimeVars) actually works;
    // the stickiness itself is correct (runtime wins over everything and
    // isn't cleared by picking No Environment) — see RuntimeVarsInspector's
    // onClear/onDeleteVar for the fix to *that*.
    const spy = stubJson('{}');
    const r = await executeRequest(
      req({
        url: 'https://{{host}}/x',
        script: { req: "bru.setVar('host', 'from-script.test');", res: '' },
      }),
      null, null, {},
    );
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('https://from-script.test/x');
    expect(r.runtimeVars.host).toBe('from-script.test');
  });

  it('keeps a runtime var across a send that no longer sets it, until explicitly cleared by the caller', async () => {
    // Mirrors what a caller (ApiClient.tsx) does: it feeds the *previous*
    // result's runtimeVars back in as `runtimeVarsIn` on the next call. A
    // script that stops calling bru.setVar for a name doesn't erase it —
    // only an explicit runtimeVarsIn without that key (i.e. the UI's
    // "Clear"/"Clear all") does.
    stubJson('{}');
    const first = await executeRequest(
      req({ script: { req: "bru.setVar('sticky', 'first-value');", res: '' } }),
      null, null, {},
    );
    expect(first.runtimeVars.sticky).toBe('first-value');

    const spy = stubJson('{}');
    const second = await executeRequest(
      req({ url: 'https://{{sticky}}/x', script: { req: '', res: '' } }),
      null, null, first.runtimeVars,
    );
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('https://first-value/x');
    expect(second.runtimeVars.sticky).toBe('first-value');
  });

  it('lets a data-file row override both environments but not runtime vars', async () => {
    const spy = stubJson('{}');
    await executeRequest(
      req({ url: 'https://{{host}}/{{path}}' }),
      env({ host: 'env.test', path: 'env' }, 'c1'),
      null,
      { path: 'runtime' },
      undefined, { pre: [], post: [] }, [], { host: 'data.test', path: 'data' },
    );
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('https://data.test/runtime');
  });

  it('lets a collection variable apply when nothing else overrides it', async () => {
    const spy = stubJson('{}');
    await executeRequest(
      req({ url: 'https://{{host}}/x' }),
      null, null, {}, undefined, { pre: [], post: [] }, [], {}, undefined, {},
      { host: 'collection.test' },
    );
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('https://collection.test/x');
  });

  it('lets the collection environment override a collection variable of the same name', async () => {
    const spy = stubJson('{}');
    await executeRequest(
      req({ url: 'https://{{host}}/x' }),
      env({ host: 'env.test' }, 'c1'), null, {}, undefined, { pre: [], post: [] }, [], {}, undefined, {},
      { host: 'collection.test' },
    );
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('https://env.test/x');
  });

  it('lets the global environment override a collection variable of the same name', async () => {
    const spy = stubJson('{}');
    await executeRequest(
      req({ url: 'https://{{host}}/x' }),
      null, env({ host: 'global.test' }), {}, undefined, { pre: [], post: [] }, [], {}, undefined, {},
      { host: 'collection.test' },
    );
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('https://global.test/x');
  });

  it('lets vault still take lowest precedence under a collection variable', async () => {
    const spy = stubJson('{}');
    await executeRequest(
      req({ url: 'https://{{host}}/x' }),
      null, null, {}, undefined, { pre: [], post: [] }, [], {}, undefined,
      { host: 'vault.test' },
      { host: 'collection.test' },
    );
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('https://collection.test/x');
  });

  it('exposes declarative post-response vars to later scripts', async () => {
    stubJson('{"id":42}');
    const r = await executeRequest(
      req({
        vars: { req: [], res: [{ id: 'v1', name: 'itemId', value: 'res.body.id', enabled: true }] },
        tests: 'test("var", () => expect(bru.getVar("itemId")).to.equal("42"));',
      }),
      null, null, {},
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
      null, null, {},
    );
    expect(r.tests.map((t) => t.passed)).toEqual([true, true, false]);
  });
});

describe('executeRequest — request mutation from scripts', () => {
  it('applies header changes made in the pre-request script', async () => {
    const spy = stubJson('{}');
    await executeRequest(
      req({ script: { req: "req.setHeader('X-Trace', 'abc'); req.setMethod('post');", res: '' } }),
      null, null, {},
    );
    const init = (spy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['X-Trace']).toBe('abc');
    expect(init.method).toBe('POST');
  });

  it('does not mutate the stored request', async () => {
    stubJson('{}');
    const original = req({ script: { req: "req.setUrl('https://other.test/y');", res: '' } });
    await executeRequest(original, null, null, {});
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

    const r = await executeRequest(req(), null, null, {});
    expect(r.response?.status).toBe(200);
    expect(factory).not.toHaveBeenCalled();
  });

  it('reports a script that overruns its timeout instead of hanging', async () => {
    stubJson('{}');
    __setSandboxWorkerFactory(() => new SilentWorker() as unknown as Worker);

    const r = await executeRequest(
      req({ script: { req: 'while (true) {}', res: '' } }),
      null, null, {}, undefined, { pre: [], post: [] }, [], {},
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
      null, null, {}, undefined, { pre: [], post: [] }, [], {},
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
      null, null, {},
    );
    expect(r.nextRequest).toBe('Cleanup');
  });

  it('surfaces null for an early end of iteration', async () => {
    stubJson('{}');
    const r = await executeRequest(req({ tests: 'bru.setNextRequest(null);' }), null, null, {});
    expect(r.nextRequest).toBeNull();
  });

  it('leaves nextRequest undefined when no script asked', async () => {
    stubJson('{}');
    const r = await executeRequest(req({ tests: 'test("t", () => expect(1).to.equal(1));' }), null, null, {});
    expect(r.nextRequest).toBeUndefined();
  });
});
