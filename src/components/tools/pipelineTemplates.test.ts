// @vitest-environment node
//
// Node rather than jsdom: jose checks key material with `instanceof
// Uint8Array`, which jsdom's second realm breaks (see jwt/jwtCrypto.test.ts).

import { describe, expect, it } from 'vitest';
import { CompactSign } from 'jose';
import { executePipeline, type PipelineStep } from '@/components/tools/pipelineEngine';
import {
  BUILTIN_TEMPLATES, exportTemplates, instantiateTemplate, parseTemplates, toTemplateSteps,
} from '@/components/tools/pipelineTemplates';

import { testChain } from '@/components/tools/jwt/x5cChain.fixtures';

/** Signed like Apple does it (ES256, x5c = leaf, intermediate, root), by the test chain. */
async function appleStyleJws(payload: unknown): Promise<string> {
  const c = await testChain();
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: 'ES256', x5c: [c.leaf, c.intermediate, c.root] })
    .sign(c.leafKey);
}

let n = 0;
const ids = () => `id${n++}`;

/**
 * Load a built-in template, put `input` into its first step, run it. The
 * test chain is not Apple's, so `trustTestRoot` swaps the Apple root for it.
 */
async function runBuiltin(id: string, input: string, trustTestRoot = true) {
  const { root } = await testChain();
  const tpl = BUILTIN_TEMPLATES.find((t) => t.id === id)!;
  const { steps } = instantiateTemplate(tpl, ids);
  steps[0] = { ...steps[0], textValue: input };
  const run = trustTestRoot
    ? steps.map((s) => (s.x5cTrust === 'apple' ? { ...s, x5cTrust: 'custom' as const, trustRoot: root } : s))
    : steps;
  return (await executePipeline(run)).at(-1)!;
}

describe('Pipeline templates — built-in Apple examples', () => {
  const request = { operation: 'CREATE_SUBSCRIPTION', currency: 'USD', items: [{ sku: 'pro' }] };

  it('Advanced Commerce: verifies the JWS chain, then decodes the base64 request', async () => {
    const jws = await appleStyleJws({ request: Buffer.from(JSON.stringify(request)).toString('base64'), version: '1' });
    expect(await runBuiltin('builtin:apple-advanced-commerce', jws)).toEqual({ output: JSON.stringify(request, null, 2) });
  });

  it('Advanced Commerce: as shipped, trusts only Apple Root CA - G3', async () => {
    const jws = await appleStyleJws({ request: 'e30=' });
    expect((await runBuiltin('builtin:apple-advanced-commerce', jws, false)).error).toMatch(/Apple Root CA - G3/);
  });

  it('Advanced Commerce: fails on a tampered payload', async () => {
    const [h, , s] = (await appleStyleJws({ request: 'e30=' })).split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ request: 'e30K' })).toString('base64url')}.${s}`;
    expect((await runBuiltin('builtin:apple-advanced-commerce', forged)).error).toMatch(/does not match/);
  });

  it('App Store notification: verifies the outer and the nested JWS', async () => {
    const tx = { transactionId: '2000000123', productId: 'pro.monthly' };
    const signedPayload = await appleStyleJws({ notificationType: 'SUBSCRIBED', data: { signedTransactionInfo: await appleStyleJws(tx) } });
    expect(await runBuiltin('builtin:apple-notification', JSON.stringify({ signedPayload })))
      .toEqual({ output: JSON.stringify(tx, null, 2) });
  });

  it('checks certificates at the payload signedDate', async () => {
    const jws = await appleStyleJws({ request: 'e30=', signedDate: Date.parse('2020-01-01') });
    expect((await runBuiltin('builtin:apple-advanced-commerce', jws)).error).toMatch(/not valid at 2020-01-01/);
  });

  it('can still check the leaf signature alone, when asked', async () => {
    const jws = await appleStyleJws({ a: 1 });
    const r = await executePipeline([
      { id: 'a', op: 'text-sunk', textValue: jws },
      { id: 'b', op: 'jws-verify', jwtAlg: 'ES256', keySource: 'x5c', x5cTrust: 'none' },
    ]);
    expect(r[1]).toEqual({ output: '{"a":1}' });
  });

  it('says so when a token has no x5c', async () => {
    const r = await executePipeline([
      { id: 'a', op: 'text-sunk', textValue: 'eyJhbGciOiJFUzI1NiJ9.e30.c2ln' },
      { id: 'b', op: 'jws-verify', jwtAlg: 'ES256', keySource: 'x5c' },
    ]);
    expect(r[1].error).toMatch(/no x5c/);
  });
});

describe('Pipeline templates — save / load', () => {
  const steps: PipelineStep[] = [
    { id: 's1', op: 'text-sunk', textValue: 'secret input' },
    {
      id: 's2', op: 'json-input', jsonText: '{"a":1}', jsonSort: 'asc',
      jsonFields: [{ id: 'f1', type: 'json', key: 'a', enabled: true }, { id: 'f2', type: 'custom', key: 'x', customValue: '1', enabled: true }],
    },
    { id: 's3', op: 'hmac', algorithm: 'sha256', key: 'sk_live_123' },
    { id: 's4', op: 'jws-verify', detachedPayload: 'body' },
  ];

  it('never stores a key, and drops input data unless asked', () => {
    const lean = toTemplateSteps(steps, { keepInput: false });
    expect(JSON.stringify(lean)).not.toContain('sk_live_123');
    expect(lean[0].textValue).toBe('');
    expect(lean[1].jsonText).toBe('');
    expect(lean[1].jsonFields).toEqual([steps[1].jsonFields![1]]);
    expect(lean[1].jsonSort).toBe('asc');
    expect(lean[3].detachedPayload).toBe('');

    const full = toTemplateSteps(steps, { keepInput: true });
    expect(JSON.stringify(full)).not.toContain('sk_live_123');
    expect(full[0].textValue).toBe('secret input');
  });

  it('loads with fresh step ids and maps the old ones', () => {
    const { steps: loaded, idMap } = instantiateTemplate({ id: 't', name: 'T', steps, updatedAt: 0 }, ids);
    expect(loaded.map((s) => s.id)).not.toContain('s3');
    expect(loaded[2].id).toBe(idMap.s3);
    expect(loaded[1].jsonFields![0].id).not.toBe('f1');
  });

  it('round-trips export / import and strips keys a shared file carries', () => {
    const exported = exportTemplates([{ id: 'tpl-1', name: 'Mine', steps: toTemplateSteps(steps, { keepInput: false }), updatedAt: 1 }]);
    expect(parseTemplates(exported)[0]).toMatchObject({ id: 'tpl-1', name: 'Mine' });

    const smuggled = JSON.stringify({ name: 'X', steps: [{ id: 'a', op: 'hmac', key: 'leak' }] });
    expect(JSON.stringify(parseTemplates(smuggled))).not.toContain('leak');
    expect(() => parseTemplates('{"name":"bad"}')).toThrow(/not a pipeline template/);
    expect(parseTemplates(JSON.stringify({ id: 'builtin:x', name: 'Y', steps: [] }))[0].id).toBe('');
  });

  describe('compose parts', () => {
    const composeSteps: PipelineStep[] = [
      { id: 'c1', op: 'text-sunk', textValue: '{"a":1}' },
      {
        id: 'c2', op: 'compose', jsonFormat: 'value',
        composeParts: [
          { id: 'p1', enabled: true, source: 'step', value: 'c1', label: '' },
          { id: 'p2', enabled: true, source: 'step', value: 'not-in-template', label: '' },
          { id: 'p3', enabled: true, source: 'text', value: 'v', label: '', steps: [{ id: 'q1', op: 'trim', key: 'stray-key' }] },
        ],
      },
    ];

    it('points a part that reads a step at that step’s new id', () => {
      const { steps: loaded, idMap } = instantiateTemplate({ id: 't', name: 'T', steps: composeSteps, updatedAt: 0 }, ids);
      const parts = loaded[1].composeParts!;
      expect(parts[0].value).toBe(idMap.c1);
      expect(parts[1].value).toBe('not-in-template');
      expect(parts[2].id).not.toBe('p3');
      expect(parts[2].steps![0].id).not.toBe('q1');
    });

    it('keeps keys out of a part’s transforms on save and on import', () => {
      expect(JSON.stringify(toTemplateSteps(composeSteps, { keepInput: true }))).not.toContain('stray-key');
      expect(JSON.stringify(parseTemplates(JSON.stringify({ name: 'C', steps: composeSteps })))).not.toContain('stray-key');
    });
  });
});
