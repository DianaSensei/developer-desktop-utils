import { describe, expect, it } from 'vitest';
import { __evalVarExpr, makeBru, makeReq, makeRes, runScript, type ScriptRun, type VarStores } from './runtime';
import { newRequest, type ApiResponse } from './types';

const emptyRun = (): ScriptRun => ({ logs: [], tests: [], error: null });

const stores = (over: Partial<VarStores> = {}): VarStores => ({
  collectionVar: {}, collectionEnv: {}, globalEnv: {},
  collectionEnvName: null, globalEnvName: null, ...over,
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
  it('interpolates using collectionEnv < data precedence', () => {
    const s = stores({ collectionEnv: { host: 'env-host', only: 'e' }, data: { host: 'data-host' } });
    const bru = makeBru(s);
    expect(bru.interpolate('{{host}}/{{only}}')).toBe('data-host/e');
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

describe('bru — collection var and scoped env stores', () => {
  it('setCollectionVar/getCollectionVar/hasCollectionVar/deleteCollectionVar target their own store', () => {
    const s = stores();
    const bru = makeBru(s);
    expect(bru.hasCollectionVar('limit')).toBe(false);
    bru.setCollectionVar('limit', 10);
    expect(bru.hasCollectionVar('limit')).toBe(true);
    expect(bru.getCollectionVar('limit')).toBe('10');
    expect(s.collectionVar.limit).toBe('10');
    bru.deleteCollectionVar('limit');
    expect(bru.hasCollectionVar('limit')).toBe(false);
  });

  it('setEnvVar defaults to the collection scope', () => {
    const s = stores();
    const bru = makeBru(s);
    bru.setEnvVar('token', 'abc');
    expect(s.collectionEnv.token).toBe('abc');
    expect(s.globalEnv.token).toBeUndefined();
  });

  it('setEnvVar(..., "global") targets the global store instead', () => {
    const s = stores();
    const bru = makeBru(s);
    bru.setEnvVar('token', 'abc', 'global');
    expect(s.globalEnv.token).toBe('abc');
    expect(s.collectionEnv.token).toBeUndefined();
  });

  it('getEnvVar with no scope falls through collection -> global', () => {
    const s = stores({ globalEnv: { host: 'global-host' } });
    const bru = makeBru(s);
    expect(bru.getEnvVar('host')).toBe('global-host');
    s.collectionEnv.host = 'collection-host';
    expect(bru.getEnvVar('host')).toBe('collection-host');
    // An explicit scope bypasses the fallthrough.
    expect(bru.getEnvVar('host', 'global')).toBe('global-host');
  });

  it('getEnvName defaults to the collection env name, falling back to the global one', () => {
    const s = stores({ collectionEnvName: null, globalEnvName: 'Shared' });
    const bru = makeBru(s);
    expect(bru.getEnvName()).toBe('Shared');
    s.collectionEnvName = 'Staging';
    expect(bru.getEnvName()).toBe('Staging');
    expect(bru.getEnvName('global')).toBe('Shared');
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

  it('supports pm.environment.replaceIn', async () => {
    const s = stores({ collectionEnv: { host: 'api.test' } });
    const out = emptyRun();
    await runScript(
      'pm.test("t", () => expect(pm.environment.replaceIn("{{host}}/v1")).to.equal("api.test/v1"));',
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

describe('prototype pollution', () => {
  it('keeps a response header named __proto__ off Object.prototype', () => {
    const res = makeRes(response({
      headers: [['content-type', 'application/json'], ['__proto__', 'polluted']],
    }));
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(Object.getPrototypeOf(res.getHeaders())).toBeNull();
    // Stored as an ordinary own property — the header really was sent.
    expect(res.getHeader('__proto__')).toBe('polluted');
    expect(res.getHeader('Content-Type')).toBe('application/json');
  });

  it('does not hand scripts Object.prototype members as if they were headers', () => {
    const res = makeRes(response());
    expect(res.getHeader('constructor')).toBeUndefined();
    expect(res.getHeader('toString')).toBeUndefined();
  });

  it('keeps a request header named constructor off the prototype chain', () => {
    const req = makeReq(newRequest());
    req.setHeader('constructor', 'polluted');
    req.setHeader('authorization', 'Bearer t');
    expect(Object.getPrototypeOf(req.getHeaders())).toBeNull();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(req.getHeaders().authorization).toBe('Bearer t');
  });

  it('refuses bru.setEnvVar / setCollectionVar on a prototype key', () => {
    const s = stores();
    const bru = makeBru(s);
    bru.setEnvVar('constructor', 'polluted');
    bru.setCollectionVar('__proto__', 'polluted');
    bru.setCollectionVar('token', 'abc');
    expect(Object.prototype.hasOwnProperty.call(s.collectionEnv, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(s.collectionVar, '__proto__')).toBe(false);
    expect(s.collectionVar.token).toBe('abc');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('Assert expression containment', () => {
  const evalVia = (expr: string): unknown => __evalVarExpr(expr, { res: makeRes(response()) });

  it('still evaluates the expressions the Assert tab is for', () => {
    expect(evalVia('res.body.token')).toBe('abc');
    expect(evalVia('res.body.items.length')).toBe(3);
    expect(evalVia('res.status')).toBe(200);
  });

  it('reads bracket keys, numeric indices and paths through them', () => {
    expect(evalVia("res.body['token']")).toBe('abc');
    expect(evalVia('res.body.items[1]')).toBe(2);
    expect(evalVia("res.body['items'][2]")).toBe(3);
    // Reads through a primitive: JS boxes it, so this must resolve too.
    expect(evalVia('res.body.token.length')).toBe(3);
  });

  it('tolerates whitespace inside a path', () => {
    expect(evalVia('res . body . token')).toBe('abc');
    expect(evalVia("res.body [ 'token' ]")).toBe('abc');
  });

  it('evaluates operators, literals and grouping', () => {
    expect(evalVia('40 + 2')).toBe(42);
    expect(evalVia('res.status === 200')).toBe(true);
    expect(evalVia('res.status >= 200 && res.status < 300')).toBe(true);
    expect(evalVia("res.body.token + '!'")).toBe('abc!');
    expect(evalVia('(1 + 2) * 3')).toBe(9);
    expect(evalVia('!res.body.missing')).toBe(true);
    // Short-circuits like JS, so a missing left side is not a path error.
    expect(evalVia('res.body.missing && res.body.missing.deep')).toBeUndefined();
  });

  it('calls a method on an object or a primitive receiver', () => {
    expect(evalVia('res.getStatus()')).toBe(200);
    expect(evalVia('res.body.token.toUpperCase()')).toBe('ABC');
    expect(evalVia("res.getHeader('content-type')")).toBe('application/json');
  });

  it('never turns an expression into code', () => {
    // The old evaluator built a Function; nothing here compiles a string.
    (globalThis as Record<string, unknown>).leaked = undefined;
    for (const expr of [
      "res.body.constructor.constructor('globalThis.leaked = 1')()",
      "res.body.constructor.constructor.call(null, 'globalThis.leaked = 1')",
      'res.body.constructor.constructor',
      'res.body.__proto__.constructor',
      'res.body.token.constructor.prototype',
    ]) {
      // Refused by the key denylist or the grammar — returns the literal back.
      expect(evalVia(expr)).toBe(expr);
    }
    expect((globalThis as Record<string, unknown>).leaked).toBeUndefined();
  });

  it('refuses an unsafe key assembled at evaluation time, not just a literal one', () => {
    // The denylist runs on the *evaluated* key, so a concatenation reaches it
    // too. Worth pinning: checking keys at parse time instead would pass every
    // other test here while leaving this route open.
    for (const expr of [
      "res.body['con' + 'structor']",
      "res.body['__pro' + 'to__']",
      "res.body['proto' + 'type']",
    ]) {
      expect(evalVia(expr)).toBe(expr);
    }
  });

  it('refuses call/apply/bind even where the key itself is readable', () => {
    // `constructor` is stopped by the key denylist long before the callee
    // denylist matters, so those tests never exercise it. `call` is not a
    // denied key — reading it is fine, invoking it is what must be refused,
    // which is the only thing standing between a reachable function and
    // arbitrary receivers.
    for (const expr of [
      "res.body.token.toUpperCase.call('zz')",
      "res.body.token.toUpperCase.apply('zz')",
      'res.body.token.toUpperCase.bind()',
    ]) {
      expect(evalVia(expr)).toBe(expr);
    }
    // Reading the function is allowed and harmless; only the invocation is not.
    expect(typeof evalVia('res.body.token.toUpperCase')).toBe('function');
  });

  it('falls back to the literal for anything outside the grammar', () => {
    // No ambient global is reachable: only a name the scope itself owns
    // resolves, so these come back unparsed rather than as the worker global.
    expect(evalVia('fetch')).toBe('fetch');
    expect(evalVia('globalThis')).toBe('globalThis');
    expect(evalVia('importScripts')).toBe('importScripts');
    // Nor does the scope object's own prototype chain leak in as a root.
    expect(evalVia('toString')).toBe('toString');
    expect(evalVia('hasOwnProperty')).toBe('hasOwnProperty');
    // Assignment is deliberately outside the grammar; it parses to nothing.
    expect(evalVia('leaked = 1')).toBe('leaked = 1');
    expect(evalVia('res.body.token++')).toBe('res.body.token++');
    expect((globalThis as Record<string, unknown>).leaked).toBeUndefined();
  });
});
