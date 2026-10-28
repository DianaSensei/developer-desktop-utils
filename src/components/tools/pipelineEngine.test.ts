// @vitest-environment node
//
// Node rather than jsdom: jose checks key material with `instanceof
// Uint8Array`, which jsdom's second realm breaks (see jwt/jwtCrypto.test.ts).

import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { decodeJwt } from 'jose';
import { executePipeline, readJsonPath, StepCache, type ComposePart, type PipelineStep } from '@/components/tools/pipelineEngine';
import { generateKeyPairPem } from '@/components/tools/jwt/jwtCrypto';

let n = 0;
const step = (s: Omit<PipelineStep, 'id'>): PipelineStep => ({ id: `s${n++}`, ...s });
const text = (textValue: string) => step({ op: 'text-sunk', textValue });

async function final(steps: PipelineStep[]) {
  const results = await executePipeline(steps);
  return results.at(-1)!;
}

describe('Pipeline engine — encode / decode', () => {
  it('round-trips every codec', async () => {
    for (const codec of ['base64', 'base64url', 'url', 'hex', 'hex-spaced', 'binary', 'base62', 'html', 'punycode', 'quoted-printable']) {
      const r = await final([text('Xin chào <b>&</b> 123'), step({ op: 'encode', codec }), step({ op: 'decode', codec })]);
      expect(r, codec).toEqual({ output: 'Xin chào <b>&</b> 123' });
    }
  });

  it('keeps compact hex for the "hex" id saved by earlier versions', async () => {
    expect(await final([text('hi'), step({ op: 'encode', codec: 'hex' })])).toEqual({ output: '6869' });
  });
});

describe('Pipeline engine — hash / HMAC / encrypt', () => {
  it('outputs an HMAC as base64 with a base64-encoded key', async () => {
    const key = Buffer.from('raw-secret-bytes').toString('base64');
    const r = await final([
      text('amount=100'),
      step({ op: 'hmac', algorithm: 'sha256', key, keyEncoding: 'base64', digest: 'base64' }),
    ]);
    expect(r.output).toBe(createHmac('sha256', 'raw-secret-bytes').update('amount=100').digest('base64'));
  });

  it('reports HMAC with no key instead of signing with an empty one', async () => {
    const r = await final([text('x'), step({ op: 'hmac', algorithm: 'sha256' })]);
    expect(r.error).toBeTruthy();
    expect(r.output).toBe('');
  });

  it('encrypts then decrypts with crypto-js AES and with AES-GCM', async () => {
    for (const cipher of ['aes-cbc', 'tripledes', 'aes-gcm'] as const) {
      const r = await final([
        text('top secret'),
        step({ op: 'encrypt', cipher, key: 'pass' }),
        step({ op: 'decrypt', cipher, key: 'pass' }),
      ]);
      expect(r, cipher).toEqual({ output: 'top secret' });
    }
  });

  it('fails a crypto-js decrypt with the wrong key instead of passing garbage on', async () => {
    const r = await final([
      text('top secret'),
      step({ op: 'encrypt', cipher: 'aes-cbc', key: 'right' }),
      step({ op: 'decrypt', cipher: 'aes-cbc', key: 'wrong' }),
    ]);
    expect(r.error).toMatch(/Decryption failed/);
  });
});

describe('Pipeline engine — JWT / JWS', () => {
  it('signs a JWT, verifies it and extracts a claim', async () => {
    const r = await final([
      text('{"sub":"42","role":"admin"}'),
      step({ op: 'jwt-sign', jwtAlg: 'HS256', key: 'k', jwtIssuedAt: false, jwtHeader: '{"kid":"a"}' }),
      step({ op: 'jwt-verify', jwtAlg: 'HS256', key: 'k' }),
      step({ op: 'json-path', path: 'role' }),
    ]);
    expect(r).toEqual({ output: 'admin' });
  });

  it('rejects a JWT verified with the wrong secret or a different algorithm', async () => {
    const signed = (await final([text('{"a":1}'), step({ op: 'jwt-sign', jwtAlg: 'HS256', key: 'k' })])).output;
    expect((await final([text(signed), step({ op: 'jwt-verify', jwtAlg: 'HS256', key: 'other' })])).error).toMatch(/does not match/);
    expect((await final([text(signed), step({ op: 'jwt-verify', jwtAlg: 'HS512', key: 'k' })])).error).toMatch(/alg "HS256"/);
  });

  it('signs with RS256 and an expiry, then decodes parts', async () => {
    const { privateKey, publicKey } = await generateKeyPairPem('RS256');
    const token = (await final([
      text('{"sub":"u1"}'),
      step({ op: 'jwt-sign', jwtAlg: 'RS256', key: privateKey, jwtExpiresIn: '1h' }),
    ])).output;
    const claims = decodeJwt(token);
    expect(claims.sub).toBe('u1');
    expect(claims.exp! - claims.iat!).toBe(3600);

    const header = await final([text(token), step({ op: 'jwt-decode', jwtPart: 'header' }), step({ op: 'json-path', path: 'alg' })]);
    expect(header).toEqual({ output: 'RS256' });
    const verified = await final([text(token), step({ op: 'jwt-verify', jwtAlg: 'RS256', key: publicKey }), step({ op: 'json-path', path: '$.sub' })]);
    expect(verified).toEqual({ output: 'u1' });
  });

  it('signs and verifies a JWS over a non-JSON payload, attached and detached', async () => {
    const jws = (await final([text('plain body'), step({ op: 'jws-sign', jwtAlg: 'HS384', key: 'k' })])).output;
    expect(jws.split('.')).toHaveLength(3);
    expect(await final([text(jws), step({ op: 'jwt-decode', jwtPart: 'payload' })])).toEqual({ output: 'plain body' });
    expect(await final([text(jws), step({ op: 'jws-verify', jwtAlg: 'HS384', key: 'k' })])).toEqual({ output: 'plain body' });

    const detached = (await final([text('plain body'), step({ op: 'jws-sign', jwtAlg: 'HS384', key: 'k', jwsDetached: true })])).output;
    expect(detached).toMatch(/^[\w-]+\.\.[\w-]+$/);
    expect(await final([text(detached), step({ op: 'jws-verify', jwtAlg: 'HS384', key: 'k', detachedPayload: 'plain body' })]))
      .toEqual({ output: 'plain body' });
    expect((await final([text(detached), step({ op: 'jws-verify', jwtAlg: 'HS384', key: 'k', detachedPayload: 'tampered' })])).error)
      .toMatch(/does not match/);
  });

  it('decodes a Bearer-prefixed token', async () => {
    const jwt = (await final([text('{"x":1}'), step({ op: 'jwt-sign', jwtAlg: 'none', jwtIssuedAt: false })])).output;
    expect(await final([text(`Bearer ${jwt}`), step({ op: 'jwt-decode', jwtPart: 'payload' }), step({ op: 'json-format', jsonIndent: 'minify' })]))
      .toEqual({ output: '{"x":1}' });
  });
});

describe('Pipeline engine — extract / transform', () => {
  it('reads JSON paths with dots, brackets, quoted keys and negative indexes', () => {
    const doc = { data: { items: [{ id: 1 }, { id: 2 }], 'a.b': true } };
    expect(readJsonPath(doc, 'data.items[0].id')).toBe(1);
    expect(readJsonPath(doc, '$.data.items[-1].id')).toBe(2);
    expect(readJsonPath(doc, 'data["a.b"]')).toBe(true);
    expect(() => readJsonPath(doc, 'data.missing')).toThrow(/Path not found/);
  });

  it('extracts a regex group, all matches, and a split piece', async () => {
    expect(await final([text('a=1&token=xyz&b=2'), step({ op: 'regex-extract', pattern: 'token=([^&]+)' })])).toEqual({ output: 'xyz' });
    expect(await final([text('a1 b22 c333'), step({ op: 'regex-extract', pattern: '\\d+', matchAll: true })])).toEqual({ output: '1\n22\n333' });
    expect(await final([text('x|y|z'), step({ op: 'split-pick', splitSep: '|', splitIndex: '-1' })])).toEqual({ output: 'z' });
    expect((await final([text('abc'), step({ op: 'regex-extract', pattern: '\\d' })])).error).toBe('No match.');
  });

  it('replaces with a regex and back-references', async () => {
    expect(await final([text('2026-10-20'), step({ op: 'replace', regex: true, find: '(\\d+)-(\\d+)-(\\d+)', replacement: '$3/$2/$1' })]))
      .toEqual({ output: '20/10/2026' });
  });

  it('stops at the first failing step', async () => {
    const results = await executePipeline([text('not json'), step({ op: 'json-format' }), step({ op: 'uppercase' })]);
    expect(results).toHaveLength(2);
    expect(results[1].error).toMatch(/not valid JSON/);
  });
});

describe('Pipeline engine — cache', () => {
  it('keeps a random output stable until its input changes', async () => {
    const cache = new StepCache();
    const steps = [text('hello'), step({ op: 'encrypt', cipher: 'aes-cbc', key: 'k' })];
    const a = await executePipeline(steps, cache);
    const b = await executePipeline([...steps, step({ op: 'uppercase' })], cache);
    expect(b[1].output).toBe(a[1].output);
    const c = await executePipeline([text('hello!'), steps[1]], cache);
    expect(c[1].output).not.toBe(a[1].output);
  });
});

describe('Pipeline engine — compose', () => {
  const part = (p: Partial<ComposePart>): ComposePart => ({ id: `p${n++}`, enabled: true, source: 'text', value: '', label: '', ...p });
  const payload = JSON.stringify({ data: { amount: 50000, orderId: ' ord-1 ' }, meta: { ts: 1730000000 } });

  it('builds a signing string from several fields, a fixed field and per-part transforms, then signs it', async () => {
    const results = await executePipeline([
      text(payload),
      step({
        op: 'compose', jsonSeparator: '&', jsonSort: 'asc', jsonFormat: 'key=value',
        composeParts: [
          part({ source: 'json-path', value: 'data.orderId', label: 'orderId', steps: [step({ op: 'trim' }), step({ op: 'uppercase' })] }),
          part({ source: 'json-path', value: 'data.amount', label: 'amount' }),
          part({ source: 'text', value: 'MERCHANT01', label: 'partner' }),
          part({ source: 'json-path', value: 'meta.ts', label: 'ts', enabled: false }),
        ],
      }),
      step({ op: 'hmac', algorithm: 'sha256', key: 'secret' }),
    ]);
    expect(results[1]).toEqual({ output: 'amount=50000&orderId=ORD-1&partner=MERCHANT01' });
    expect(results[2].output).toBe(createHmac('sha256', 'secret').update('amount=50000&orderId=ORD-1&partner=MERCHANT01').digest('hex'));
  });

  it('writes an unlabelled part as the bare value and can join with no separator', async () => {
    const r = await final([
      text(payload),
      step({
        op: 'compose', jsonSeparator: '', jsonFormat: 'key=value',
        composeParts: [
          part({ source: 'json-path', value: 'data.amount', label: 'amount' }),
          part({ source: 'text', value: '|salt' }),
        ],
      }),
    ]);
    expect(r).toEqual({ output: 'amount=50000|salt' });
  });

  it('reads a regex part and the output of an earlier step', async () => {
    const first = text('token=abc123&x=1');
    const r = await final([
      first,
      step({ op: 'uppercase' }),
      step({
        op: 'compose', jsonSeparator: '|', jsonFormat: 'value',
        composeParts: [
          part({ source: 'regex', value: 'TOKEN=([^&]+)' }),
          part({ source: 'step', value: first.id, steps: [step({ op: 'encode', codec: 'base64' })] }),
        ],
      }),
    ]);
    expect(r).toEqual({ output: `ABC123|${Buffer.from('token=abc123&x=1').toString('base64')}` });
  });

  it('names the failing part in the error', async () => {
    const r = await final([
      text(payload),
      step({ op: 'compose', composeParts: [part({ source: 'json-path', value: 'data.missing', label: 'fee' })] }),
    ]);
    expect(r.error).toMatch(/^fee: Path not found/);
  });

  it('refuses a step that reads a later step, and credential steps inside a part', async () => {
    const later = step({ op: 'text-sunk', textValue: 'later' });
    const ref = await executePipeline([
      text('x'),
      step({ op: 'compose', composeParts: [part({ source: 'step', value: later.id, label: 'x' })] }),
      later,
    ]);
    expect(ref[1].error).toMatch(/gone or comes after/);

    const keyed = await final([
      text('x'),
      step({ op: 'compose', composeParts: [part({ source: 'text', value: 'v', steps: [step({ op: 'hmac', key: 'k' })] })] }),
    ]);
    expect(keyed.error).toMatch(/can't run inside a Compose part/);
  });

  it('gives empty parts, not errors, while the input is still empty', async () => {
    const r = await final([
      text(''),
      step({ op: 'compose', jsonFormat: 'value', composeParts: [part({ source: 'json-path', value: 'a' }), part({ source: 'text', value: 'k' })] }),
    ]);
    expect(r).toEqual({ output: '&k' });
  });

  it('re-runs when an earlier step it reads changes, even if its own input does not', async () => {
    // The step right before Compose stays the same, so Compose's own input
    // does too; only the step its part reads changes.
    const cache = new StepCache();
    const src = (v: string): PipelineStep => ({ id: 'src', op: 'text-sunk', textValue: v });
    const fixed: PipelineStep = { id: 'fixed', op: 'text-sunk', textValue: 'same' };
    const composeStep = step({ op: 'compose', jsonFormat: 'value', composeParts: [part({ source: 'step', value: 'src' })] });
    const a = await executePipeline([src('one'), fixed, composeStep], cache);
    const b = await executePipeline([src('two'), fixed, composeStep], cache);
    expect(a[2].output).toBe('one');
    expect(b[2].output).toBe('two');
  });
});
