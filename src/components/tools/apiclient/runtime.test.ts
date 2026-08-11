import { describe, expect, it } from 'vitest';
import { makeBru, makeReq, makeRes, runScript, type ScriptRun, type VarStores } from './runtime';
import { newRequest, type ApiResponse } from './types';

const emptyRun = (): ScriptRun => ({ logs: [], tests: [], error: null });

const stores = (over: Partial<VarStores> = {}): VarStores => ({
  runtime: {}, env: {}, envName: null, ...over,
});

const response = (over: Partial<ApiResponse> = {}): ApiResponse => ({
  status: 200, statusText: 'OK', ok: true, headers: [['content-type', 'application/json']],
  body: '{"token":"abc","items":[1,2,3]}', contentType: 'application/json',
  timeMs: 12, sizeBytes: 31, ...over,
});

describe('runScript — test collection', () => {
  it('collects results from tests that are not awaited', async () => {
    const out = emptyRun();
    // The Postman/Bruno idiom: call test() without awaiting it. The assertion
    // runs on a microtask after the script body has already returned.
    await runScript(
      `test("async passes", async () => { await Promise.resolve(); expect(1).to.equal(1); });
       test("sync fails", () => { expect(1).to.equal(2); });`,
      { res: makeRes(response()) },
      out,
    );
    expect(out.tests).toHaveLength(2);
    expect(out.tests.find((t) => t.name === 'async passes')?.passed).toBe(true);
    const failed = out.tests.find((t) => t.name === 'sync fails');
    expect(failed?.passed).toBe(false);
    expect(failed?.error).toContain('to equal');
  });

  it('still reports started tests when the script later throws', async () => {
    const out = emptyRun();
    await runScript(
      `test("ran first", () => { expect(true).to.be.true; });
       undefinedFunction();`,
      {},
      out,
    );
    expect(out.error).toBeTruthy();
    expect(out.tests).toEqual([{ name: 'ran first', passed: true }]);
  });
});

describe('runScript — error reporting', () => {
  it('reports the error type and message', async () => {
    const out = emptyRun();
    await runScript('null.foo;', {}, out);
    expect(out.error).toContain('TypeError');
  });

  it('reports a syntax error without running anything', async () => {
    const out = emptyRun();
    await runScript('function (', {}, out);
    expect(out.error).toContain('SyntaxError');
    expect(out.tests).toEqual([]);
  });
});

describe('expect matchers', () => {
  const run = async (code: string) => {
    const out = emptyRun();
    await runScript(`test("t", () => { ${code} });`, { res: makeRes(response()) }, out);
    return out.tests[0];
  };

  it('supports deep as a no-op flag', async () => {
    expect((await run('expect({a:1}).to.deep.equal({a:1});')).passed).toBe(true);
  });

  it('supports oneOf', async () => {
    expect((await run('expect(200).to.be.oneOf([200, 201]);')).passed).toBe(true);
    expect((await run('expect(404).to.be.oneOf([200, 201]);')).passed).toBe(false);
  });

  it('supports closeTo', async () => {
    expect((await run('expect(1.02).to.be.closeTo(1, 0.05);')).passed).toBe(true);
    expect((await run('expect(1.5).to.be.closeTo(1, 0.05);')).passed).toBe(false);
  });

  it('supports keys', async () => {
    expect((await run('expect({a:1,b:2}).to.have.keys("a","b");')).passed).toBe(true);
    expect((await run('expect({a:1}).to.have.keys("a","z");')).passed).toBe(false);
  });

  it('walks dotted paths for nested property', async () => {
    expect((await run('expect({a:{b:{c:7}}}).to.have.nested.property("a.b.c", 7);')).passed).toBe(true);
    expect((await run('expect({a:{b:{}}}).to.have.nested.property("a.b.c");')).passed).toBe(false);
  });

  it('supports throw', async () => {
    expect((await run('expect(() => { throw new Error("boom"); }).to.throw("boom");')).passed).toBe(true);
    expect((await run('expect(() => 1).to.throw();')).passed).toBe(false);
  });

  it('uses a custom message when expect is given one', async () => {
    const t = await run('expect(1, "one must be two").to.equal(2);');
    expect(t.passed).toBe(false);
    expect(t.error).toBe('one must be two');
  });

  it('does not treat the custom message as a negation', async () => {
    expect((await run('expect(1, "should hold").to.equal(1);')).passed).toBe(true);
  });
});

describe('assert helpers', () => {
  const run = async (code: string) => {
    const out = emptyRun();
    await runScript(`test("t", () => { ${code} });`, {}, out);
    return out.tests[0];
  };

  it('is callable', async () => {
    expect((await run('assert(true);')).passed).toBe(true);
    expect((await run('assert(false, "nope");')).error).toBe('nope');
  });

  it('exposes named assertions', async () => {
    expect((await run('assert.isTrue(true); assert.deepEqual({a:1},{a:1}); assert.lengthOf([1,2],2);')).passed).toBe(true);
    expect((await run('assert.isNumber("x");')).passed).toBe(false);
  });
});

describe('bru', () => {
  it('interpolates using env < data < runtime precedence', () => {
    const s = stores({ env: { host: 'env-host', only: 'e' }, data: { host: 'data-host' }, runtime: {} });
    const bru = makeBru(s);
    expect(bru.interpolate('{{host}}/{{only}}')).toBe('data-host/e');
    bru.setVar('host', 'runtime-host');
    expect(bru.interpolate('{{host}}')).toBe('runtime-host');
  });

  it('leaves unknown tokens untouched', () => {
    expect(makeBru(stores()).interpolate('{{nope}}')).toBe('{{nope}}');
  });

  it('rejects sleep when the send is aborted', async () => {
    const ctl = new AbortController();
    const bru = makeBru(stores({ signal: ctl.signal }));
    const pending = bru.sleep(5000);
    ctl.abort();
    await expect(pending).rejects.toThrow('cancelled');
  });

  it('resolves sleep normally', async () => {
    await expect(makeBru(stores()).sleep(1)).resolves.toBeUndefined();
  });
});

describe('req host object', () => {
  it('adds, reads and removes headers and params', () => {
    const draft = newRequest({ url: 'https://example.test' });
    const req = makeReq(draft);
    req.setHeader('X-Trace', 'abc');
    expect(req.getHeader('x-trace')).toBe('abc');
    req.deleteHeader('X-TRACE');
    expect(req.getHeader('X-Trace')).toBeUndefined();

    req.setParam('page', '2');
    expect(req.getParam('page')).toBe('2');
    req.deleteParam('page');
    expect(req.getParam('page')).toBeUndefined();
  });

  it('adjusts transport settings', () => {
    const draft = newRequest();
    const req = makeReq(draft);
    req.setTimeout(2500);
    req.disableRedirects();
    expect(draft.settings.timeout).toBe(2500);
    expect(draft.settings.followRedirects).toBe(false);
  });
});

describe('pm compatibility shim', () => {
  const run = async (code: string) => {
    const out = emptyRun();
    await runScript(code, { res: makeRes(response()), bru: makeBru(stores()) }, out);
    return out;
  };

  it('supports pm.response.to.have.status and header', async () => {
    const out = await run(
      `pm.test("status", () => pm.response.to.have.status(200));
       pm.test("header", () => pm.response.to.have.header("content-type"));
       pm.test("success", () => pm.response.to.be.success);`,
    );
    expect(out.tests.every((t) => t.passed)).toBe(true);
    expect(out.tests).toHaveLength(3);
  });

  it('fails a wrong status with a readable message', async () => {
    const out = await run('pm.test("status", () => pm.response.to.have.status(404));');
    expect(out.tests[0].passed).toBe(false);
    expect(out.tests[0].error).toContain('404');
  });

  it('supports pm.variables.replaceIn', async () => {
    const s = stores({ env: { host: 'api.test' } });
    const out = emptyRun();
    await runScript(
      'pm.test("t", () => expect(pm.variables.replaceIn("{{host}}/v1")).to.equal("api.test/v1"));',
      { bru: makeBru(s), res: makeRes(response()) },
      out,
    );
    expect(out.tests[0].passed).toBe(true);
  });
});

describe('console capture', () => {
  it('records each level', async () => {
    const out = emptyRun();
    await runScript('console.log("a"); console.warn("b"); console.error({ c: 1 }); console.table([1]);', {}, out);
    expect(out.logs).toEqual([
      { level: 'log', text: 'a' },
      { level: 'warn', text: 'b' },
      { level: 'error', text: '{"c":1}' },
      { level: 'log', text: '[1]' },
    ]);
  });
});
