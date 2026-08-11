import { describe, expect, it } from 'vitest';
import { runPhase, type PhaseStores } from './scriptPhases';
import { newRequest, type ApiResponse } from './types';

const stores = (over: Partial<PhaseStores> = {}): PhaseStores => ({
  runtime: {}, env: {}, envName: null, ...over,
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
      inherited: ["bru.setVar('order', 'a');", "bru.setVar('order', bru.getVar('order') + 'b');"],
      vars: [],
      script: "bru.setVar('order', bru.getVar('order') + 'c');",
    });
    expect(out.stores.runtime.order).toBe('abc');
    expect(out.errors).toEqual([]);
  });

  it('stops at the first failing inherited script', async () => {
    const out = await runPhase({
      phase: 'pre',
      draft: newRequest(),
      stores: stores(),
      inherited: ['throw new Error("boom");', "bru.setVar('reached', 'yes');"],
      vars: [],
      script: "bru.setVar('own', 'yes');",
    });
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain('Inherited pre-request script #1');
    expect(out.stores.runtime.reached).toBeUndefined();
    expect(out.stores.runtime.own).toBeUndefined();
  });

  it('does not number a lone inherited script', async () => {
    const out = await runPhase({
      phase: 'pre',
      draft: newRequest(),
      stores: stores(),
      inherited: ['throw new Error("boom");'],
      vars: [],
      script: '',
    });
    expect(out.errors[0]).toMatch(/^Inherited pre-request script: /);
  });

  it('applies declarative vars before the request script', async () => {
    const out = await runPhase({
      phase: 'pre',
      draft: newRequest(),
      stores: stores(),
      inherited: [],
      vars: [{ id: 'v1', name: 'n', value: '40 + 2', enabled: true }],
      script: "bru.setVar('doubled', Number(bru.getVar('n')) * 2);",
    });
    expect(out.stores.runtime.n).toBe('42');
    expect(out.stores.runtime.doubled).toBe('84');
  });

  it('returns the mutated draft', async () => {
    const draft = newRequest({ url: 'https://api.test/x' });
    const out = await runPhase({
      phase: 'pre',
      draft,
      stores: stores(),
      inherited: [],
      vars: [],
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
      vars: [],
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
      vars: [],
      script: "bru.setVar('captured', res.getBody().id);",
      tests: 'test("captured", () => expect(bru.getVar("captured")).to.equal("7"));',
      assertions: [],
    });
    expect(out.tests).toEqual([{ name: 'captured', passed: true }]);
    expect(out.stores.runtime.captured).toBe('7');
  });

  it('collects console output in order', async () => {
    const out = await runPhase({
      phase: 'post',
      draft: newRequest(),
      stores: stores(),
      response: response(),
      inherited: ["console.log('second');"],
      vars: [],
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
      vars: [],
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
      vars: [],
      script: 'await bru.sleep(5000);',
    }, ctl.signal);
    ctl.abort();
    const out = await pending;
    expect(out.errors[0]).toContain('cancelled');
  });
});
