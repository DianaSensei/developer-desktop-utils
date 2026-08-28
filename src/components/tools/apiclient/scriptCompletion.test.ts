// Guards scriptCompletion.ts's hand-maintained autocomplete shapes against
// drifting from the real runtime.ts API. There's no static way to derive the
// shapes (their real shape depends on closures built at call time — see
// scriptCompletion.ts's own header comment), so instead: build a real
// instance of each factory, walk its own-enumerable-key paths, and assert
// every one of them exists in the corresponding shadow shape. A future
// rename/addition to makeBru/makeReq/makeRes/makePm/makeAssert/makeConsole
// that isn't mirrored here now fails a test instead of silently going stale.

import { describe, expect, it } from 'vitest';
import { scriptCompletionShapes } from './scriptCompletion';
import {
  makeAssert, makeBru, makeConsole, makeExpect, makePm, makeReq, makeRes,
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
  it('bru', () => {
    const real = pathsOf(makeBru({ collectionVar: {}, collectionEnv: {}, globalEnv: {}, collectionEnvName: null, globalEnvName: null }));
    assertNoMissing(real, pathsOf(scriptCompletionShapes.bru));
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
    const bru = makeBru({ collectionVar: {}, collectionEnv: {}, globalEnv: {}, collectionEnvName: null, globalEnvName: null });
    const req = makeReq(newRequest({ url: 'https://api.test/x' }));
    const res = makeRes(fakeResponse);
    const real = pathsOf(makePm({ bru, req, res, expect: makeExpect(), test: async () => {} }));
    assertNoMissing(real, pathsOf(scriptCompletionShapes.pm));
  });
});
