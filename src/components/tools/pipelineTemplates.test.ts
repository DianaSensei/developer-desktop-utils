// @vitest-environment node
//
// Node rather than jsdom: jose checks key material with `instanceof
// Uint8Array`, which jsdom's second realm breaks (see jwt/jwtCrypto.test.ts).

import { describe, expect, it } from 'vitest';
import { CompactSign, importPKCS8 } from 'jose';
import { executePipeline, type PipelineStep } from '@/components/tools/pipelineEngine';
import {
  BUILTIN_TEMPLATES, exportTemplates, instantiateTemplate, parseTemplates, toTemplateSteps,
} from '@/components/tools/pipelineTemplates';

// Throwaway self-signed P-256 certificate (CN=pipeline-test), standing in for
// the leaf of Apple's x5c chain. Test fixture only.
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgFZCJj2Zkf1N43iSo
ya0YgDEGdZ5yJAtcsbAlfJzLqSWhRANCAARD+YznLYWFc7mUx3rDn3NOlLc3wG1w
70eUDmG90pFYJcjOXYUOwq14EurieTtq+tJDhaabvP0BXaHhqkhkQ6lK
-----END PRIVATE KEY-----`;
const TEST_CERT = 'MIIBiDCCAS2gAwIBAgIUVyFOPBVGJOwJps9jXgu+C1JcLHEwCgYIKoZIzj0EAwIwGDEWMBQGA1UEAwwNcGlwZWxpbmUtdGVzdDAgFw0yNjEwMjAwMzU3MDdaGA8yMTI2MDkyNjAzNTcwN1owGDEWMBQGA1UEAwwNcGlwZWxpbmUtdGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABEP5jOcthYVzuZTHesOfc06UtzfAbXDvR5QOYb3SkVglyM5dhQ7CrXgS6uJ5O2r60kOFppu8/QFdoeGqSGRDqUqjUzBRMB0GA1UdDgQWBBRAvEbDCiROeAzIxoxI2Xr9UCXcOTAfBgNVHSMEGDAWgBRAvEbDCiROeAzIxoxI2Xr9UCXcOTAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0kAMEYCIQDUWabBe3vBOppL8XpzW1PuMEVd2O9MQ0z9B0OKqZXmvAIhAIumQF2JqhOPXx/NQBe50gyMOLLIrFqLbAO7SmMZLOvH';

async function appleStyleJws(payload: unknown): Promise<string> {
  const key = await importPKCS8(TEST_KEY, 'ES256');
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: 'ES256', x5c: [TEST_CERT] })
    .sign(key);
}

let n = 0;
const ids = () => `id${n++}`;

/** Load a built-in template, put `input` into its first step, run it. */
async function runBuiltin(id: string, input: string) {
  const tpl = BUILTIN_TEMPLATES.find((t) => t.id === id)!;
  const { steps } = instantiateTemplate(tpl, ids);
  steps[0] = { ...steps[0], textValue: input };
  return (await executePipeline(steps)).at(-1)!;
}

describe('Pipeline templates — built-in Apple examples', () => {
  const request = { operation: 'CREATE_SUBSCRIPTION', currency: 'USD', items: [{ sku: 'pro' }] };

  it('Advanced Commerce: verifies the JWS with its x5c, then decodes the base64 request', async () => {
    const jws = await appleStyleJws({ request: Buffer.from(JSON.stringify(request)).toString('base64'), version: '1' });
    expect(await runBuiltin('builtin:apple-advanced-commerce', jws)).toEqual({ output: JSON.stringify(request, null, 2) });
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
});
