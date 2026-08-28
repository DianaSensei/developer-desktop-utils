import { describe, expect, it } from 'vitest';
import { runPhase, type PhaseStores } from './scriptPhases';
import { newRequest, type ApiResponse } from './types';

const stores = (over: Partial<PhaseStores> = {}): PhaseStores => ({
  collectionVar: {}, collectionEnv: {}, globalEnv: {},
  collectionEnvName: null, globalEnvName: null, ...over,
});

const response = (over: Partial<ApiResponse> = {}): ApiResponse => ({
  status: 200, statusText: 'OK', ok: true, headers: [['content-type', 'application/json']],
  body: '{"id":7}', contentType: 'application/json', timeMs: 5, sizeBytes: 8, ...over,
});

describe('pre phase', () => {
  it('runs inherited scripts before the request script', async () => {
    const out = await runPhase({
      phase: 'pre',
      draft: newRequest(),
      stores: stores(),
      inherited: ["bru.setCollectionVar('order', 'a');", "bru.setCollectionVar('order', bru.getCollectionVar('order') + 'b');"],
      script: "bru.setCollectionVar('order', bru.getCollectionVar('order') + 'c');",
    });
    expect(out.stores.collectionVar.order).toBe('abc');
    expect(out.errors).toEqual([]);
  });

  it('stops at the first failing inherited script', async () => {
    const out = await runPhase({
      phase: 'pre',
      draft: newRequest(),
      stores: stores(),
      inherited: ['throw new Error("boom");', "bru.setCollectionVar('reached', 'yes');"],
      script: "bru.setCollectionVar('own', 'yes');",
    });
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain('Inherited pre-request script #1');
    expect(out.stores.collectionVar.reached).toBeUndefined();
    expect(out.stores.collectionVar.own).toBeUndefined();
  });

  it('does not number a lone inherited script', async () => {
    const out = await runPhase({
      phase: 'pre',
      draft: newRequest(),
      stores: stores(),
      inherited: ['throw new Error("boom");'],
      script: '',
    });
    expect(out.errors[0]).toMatch(/^Inherited pre-request script: /);
  });

  it('returns the mutated draft', async () => {
    const draft = newRequest({ url: 'https://api.test/x' });
    const out = await runPhase({
      phase: 'pre',
      draft,
      stores: stores(),
      inherited: [],
      script: "req.setUrl('https://changed.test/y'); req.setHeader('X-A', '1');",
    });
    expect(out.draft.url).toBe('https://changed.test/y');
    expect(out.draft.headers.find((h) => h.key === 'X-A')?.value).toBe('1');
  });
});

describe('post phase', () => {
  it('keeps running after a failing script so tests still report', async () => {
    const out = await runPhase({
      phase: 'post',
      draft: newRequest(),
      stores: stores(),
      response: response(),
      inherited: ['throw new Error("folder boom");'],
      script: 'throw new Error("own boom");',
      tests: 'test("still ran", () => expect(res.getStatus()).to.equal(200));',
      assertions: [{ id: 'a1', expr: 'res.body.id', operator: 'equals', value: '7', enabled: true }],
    });
    expect(out.errors).toHaveLength(2);
    expect(out.errors[0]).toContain('Post-response script');
    expect(out.errors[1]).toContain('Inherited post-response script');
    expect(out.tests.map((t) => [t.name, t.passed])).toEqual([
      ['still ran', true],
      ['res.body.id equals 7', true],
    ]);
  });

  it('lets a post-response script feed a later assertion', async () => {
    const out = await runPhase({
      phase: 'post',
      draft: newRequest(),
      stores: stores(),
      response: response(),
      inherited: [],
      script: "bru.setCollectionVar('captured', res.getBody().id);",
      tests: 'test("captured", () => expect(bru.getCollectionVar("captured")).to.equal("7"));',
      assertions: [],
    });
    expect(out.tests).toEqual([{ name: 'captured', passed: true }]);
    expect(out.stores.collectionVar.captured).toBe('7');
  });

  it('collects console output in order', async () => {
    const out = await runPhase({
      phase: 'post',
      draft: newRequest(),
      stores: stores(),
      response: response(),
      inherited: ["console.log('second');"],
      script: "console.log('first');",
      tests: '',
      assertions: [],
    });
    expect(out.logs.map((l) => l.text)).toEqual(['first', 'second']);
  });

  it('honours res.setBody for scripts that run after it', async () => {
    const out = await runPhase({
      phase: 'post',
      draft: newRequest(),
      stores: stores(),
      response: response(),
      inherited: [],
      script: 'res.setBody({ id: 99 });',
      tests: 'test("mutated", () => expect(res.getBody().id).to.equal(99));',
      assertions: [],
    });
    expect(out.tests).toEqual([{ name: 'mutated', passed: true }]);
  });
});

describe('abort signal', () => {
  it('propagates to bru.sleep', async () => {
    const ctl = new AbortController();
    const pending = runPhase({
      phase: 'pre',
      draft: newRequest(),
      stores: stores(),
      inherited: [],
      script: 'await bru.sleep(5000);',
    }, ctl.signal);
    ctl.abort();
    const out = await pending;
    expect(out.errors[0]).toContain('cancelled');
  });
});

describe('runner flow control', () => {
  const post = (script: string, tests = '') => runPhase({
    phase: 'post',
    draft: newRequest(),
    stores: stores(),
    response: response(),
    inherited: [],
    script,
    tests,
    assertions: [],
  });

  it('reports nothing when no script asks for a jump', async () => {
    const out = await post("bru.setCollectionVar('x', '1');");
    expect(out.control.nextRequest).toBeUndefined();
    expect('nextRequest' in out.control).toBe(false);
  });

  it('captures a named jump from bru.setNextRequest', async () => {
    const out = await post("bru.setNextRequest('Login');");
    expect(out.control.nextRequest).toBe('Login');
  });

  it('captures null as end-of-iteration', async () => {
    const out = await post('bru.setNextRequest(null);');
    expect(out.control.nextRequest).toBeNull();
    expect('nextRequest' in out.control).toBe(true);
  });

  it('supports pm.execution.setNextRequest', async () => {
    const out = await post("pm.execution.setNextRequest('Next One');");
    expect(out.control.nextRequest).toBe('Next One');
  });

  it("supports Postman's legacy postman.setNextRequest", async () => {
    const out = await post("postman.setNextRequest('Legacy');");
    expect(out.control.nextRequest).toBe('Legacy');
  });

  it('lets a later script override an earlier jump', async () => {
    const out = await post("bru.setNextRequest('First');", "bru.setNextRequest('Second');");
    expect(out.control.nextRequest).toBe('Second');
  });

  it('is a no-op in the pre phase of a plain send', async () => {
    const out = await runPhase({
      phase: 'pre',
      draft: newRequest(),
      stores: stores(),
      inherited: [],
      script: "bru.setNextRequest('Somewhere'); bru.setCollectionVar('ran', 'yes');",
    });
    // The call is accepted (no crash) and recorded; a plain Send just ignores it.
    expect(out.stores.collectionVar.ran).toBe('yes');
    expect(out.errors).toEqual([]);
    expect(out.control.nextRequest).toBe('Somewhere');
  });
});
