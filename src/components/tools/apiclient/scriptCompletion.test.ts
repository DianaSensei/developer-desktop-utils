// Keeps scriptCompletion.ts's hand-written autocomplete shapes in sync with
// runtime.ts: builds a real instance of each factory and asserts every
// own-enumerable key path exists in the matching shadow shape.

import { describe, expect, it } from 'vitest';
import { scriptCompletionShapes } from './scriptCompletion';
import {
  makeAssert, makeDt, makeConsole, makeExpect, makePm, makeReq, makeRes,
} from './runtime';
import { newRequest, type ApiResponse } from './types';

// Collects every own-enumerable key path from a real (possibly getter-laden)
// object or function. Stops descending past two kinds of terminal node:
//  - `to.have`/`to.be` — Postman assertion-matcher getters (e.g.
//    pm.response.to.be.ok) that run a real assertion the moment they're
//    *read*, which would throw for a fixture that doesn't happen to satisfy
//    them.
//  - a bare root-level `headers`/`body` — makeRes()'s actual response
//    headers/parsed-body data, not part of the scripting API surface (the
//    shadow shape correctly types these as opaque placeholders).
// Either way, the key's own *name* is still recorded; only descendants' values
// are never touched.
function collectPaths(obj: unknown, prefix: string, out: Set<string>, readValues = true): void {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return;
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.add(path);
    if (!readValues) continue;
    let value: unknown;
    try {
      value = (obj as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // Opaque response data — the shadow shape has no matching substructure
      // to compare against (it's `null`/`{}` there on purpose), so don't
      // descend into it at all, not even to list one level of names.
      if (path === 'headers' || path === 'body') continue;
      const stopHere = path.endsWith('.to.have') || path.endsWith('.to.be');
      collectPaths(value, path, out, !stopHere);
    }
  }
}

function pathsOf(obj: unknown): Set<string> {
  const out = new Set<string>();
  collectPaths(obj, '', out);
  return out;
}

function assertNoMissing(real: Set<string>, shadow: Set<string>) {
  const missing = [...real].filter((p) => !shadow.has(p)).sort();
  expect(missing, `autocomplete shape is missing: ${missing.join(', ')}`).toEqual([]);
}

const fakeResponse: ApiResponse = {
  status: 200, statusText: 'OK', ok: true, headers: [['content-type', 'application/json']],
  body: '{"id":1}', contentType: 'application/json', timeMs: 5, sizeBytes: 8,
};

describe('scriptCompletion shape parity', () => {
  it('dt', () => {
    const real = pathsOf(makeDt({ collectionVar: {}, collectionEnv: {}, globalEnv: {}, collectionEnvName: null, globalEnvName: null }));
    assertNoMissing(real, pathsOf(scriptCompletionShapes.dt));
  });

  it('req', () => {
    const real = pathsOf(makeReq(newRequest({ url: 'https://api.test/x' })));
    assertNoMissing(real, pathsOf(scriptCompletionShapes.req));
  });

  it('res', () => {
    const real = pathsOf(makeRes(fakeResponse));
    assertNoMissing(real, pathsOf(scriptCompletionShapes.res));
  });

  it('assert', () => {
    const real = pathsOf(makeAssert());
    assertNoMissing(real, pathsOf(scriptCompletionShapes.assert));
  });

  it('console', () => {
    const real = pathsOf(makeConsole([]));
    assertNoMissing(real, pathsOf(scriptCompletionShapes.console));
  });

  it('pm', () => {
    const dt = makeDt({ collectionVar: {}, collectionEnv: {}, globalEnv: {}, collectionEnvName: null, globalEnvName: null });
    const req = makeReq(newRequest({ url: 'https://api.test/x' }));
    const res = makeRes(fakeResponse);
    const real = pathsOf(makePm({ dt, req, res, expect: makeExpect(), test: async () => {} }));
    assertNoMissing(real, pathsOf(scriptCompletionShapes.pm));
  });
});
