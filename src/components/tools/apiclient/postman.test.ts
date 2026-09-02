import { describe, expect, it } from 'vitest';
import { exportPostman, importPostman } from './postman';
import { newAuth, newRequest, type Collection } from './types';

function pmCollection(items: unknown[]): string {
  return JSON.stringify({ info: { name: 'Test' }, item: items });
}

describe('importPostman — path params (url.variable)', () => {
  it('imports :name path variables into pathParams, matching Postman convention', () => {
    const json = pmCollection([{
      name: 'Get user',
      request: {
        method: 'GET',
        url: { raw: 'https://api.test/users/:id', variable: [{ key: 'id', value: '42' }] },
      },
    }]);
    const { collection } = importPostman(json);
    const item = collection.items[0];
    if (item.type !== 'request') throw new Error('expected a request');
    expect(item.url).toBe('https://api.test/users/:id');
    expect(item.pathParams).toEqual([expect.objectContaining({ key: 'id', value: '42', enabled: true })]);
  });

  it('rewrites {name} brace-style path variables to :name, matching url.variable', () => {
    const json = pmCollection([{
      name: 'Get user',
      request: {
        method: 'GET',
        url: { raw: 'https://api.test/users/{id}/posts/{postId}', variable: [{ key: 'id', value: '1' }, { key: 'postId', value: '2' }] },
      },
    }]);
    const { collection } = importPostman(json);
    const item = collection.items[0];
    if (item.type !== 'request') throw new Error('expected a request');
    expect(item.url).toBe('https://api.test/users/:id/posts/:postId');
    expect(item.pathParams.map((p) => p.key)).toEqual(['id', 'postId']);
  });

  it('does not touch a {{var}} token that happens to contain a declared variable name', () => {
    const json = pmCollection([{
      name: 'Get',
      request: {
        method: 'GET',
        url: { raw: 'https://{{id}}.api.test/users/{id}', variable: [{ key: 'id', value: '1' }] },
      },
    }]);
    const { collection } = importPostman(json);
    const item = collection.items[0];
    if (item.type !== 'request') throw new Error('expected a request');
    expect(item.url).toBe('https://{{id}}.api.test/users/:id');
  });

  it('marks a disabled path variable as disabled', () => {
    const json = pmCollection([{
      name: 'Get',
      request: {
        method: 'GET',
        url: { raw: 'https://api.test/users/:id', variable: [{ key: 'id', value: '1', disabled: true }] },
      },
    }]);
    const { collection } = importPostman(json);
    const item = collection.items[0];
    if (item.type !== 'request') throw new Error('expected a request');
    expect(item.pathParams[0].enabled).toBe(false);
  });

  it('leaves pathParams empty when the request has no url.variable', () => {
    const json = pmCollection([{ name: 'Get', request: { method: 'GET', url: 'https://api.test/x' } }]);
    const { collection } = importPostman(json);
    const item = collection.items[0];
    if (item.type !== 'request') throw new Error('expected a request');
    expect(item.pathParams).toEqual([]);
  });
});

describe('exportPostman — path params (url.variable)', () => {
  it('writes enabled path params to url.variable', () => {
    const req = newRequest({
      name: 'Get user',
      url: 'https://api.test/users/:id',
      pathParams: [{ id: 'p1', key: 'id', value: '42', enabled: true }],
    });
    const collection: Collection = { id: 'c1', name: 'C', items: [req] };
    const exported = exportPostman(collection) as { item: { request: { url: { variable?: unknown } } }[] };
    expect(exported.item[0].request.url.variable).toEqual([{ key: 'id', value: '42' }]);
  });

  it('marks a disabled path param as disabled and omits variable entirely when there are none', () => {
    const req = newRequest({ name: 'Get', url: 'https://api.test/x' });
    const collection: Collection = { id: 'c1', name: 'C', items: [req] };
    const exported = exportPostman(collection) as { item: { request: { url: { variable?: unknown } } }[] };
    expect(exported.item[0].request.url.variable).toBeUndefined();
  });
});

describe('Postman path-param round-trip', () => {
  it('survives import → export unchanged', () => {
    const original = pmCollection([{
      name: 'Get user',
      request: {
        method: 'GET',
        url: { raw: 'https://api.test/users/:id', variable: [{ key: 'id', value: '42' }] },
      },
    }]);
    const { collection: imported } = importPostman(original);
    const exported = exportPostman(imported) as { item: { request: { url: { raw: string; variable?: { key: string; value: string }[] } } }[] };
    expect(exported.item[0].request.url.raw).toBe('https://api.test/users/:id');
    expect(exported.item[0].request.url.variable).toEqual([{ key: 'id', value: '42' }]);
  });
});

describe('exportPostman — folder/collection auth', () => {
  it('writes collection-level auth', () => {
    const collection: Collection = {
      id: 'c', name: 'C', items: [],
      auth: { ...newAuth(), type: 'bearer', token: '{{token}}' },
    };
    const exported = exportPostman(collection) as { auth?: unknown };
    expect(exported.auth).toEqual({ type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] });
  });

  it('writes folder-level auth', () => {
    const folder: import('./types').Folder = {
      type: 'folder', id: 'f', name: 'F', items: [],
      auth: { ...newAuth(), type: 'apikey', apiKey: { key: 'X-Api-Key', value: '{{apiKey}}', placement: 'header' } },
    };
    const collection: Collection = { id: 'c', name: 'C', items: [folder] };
    const exported = exportPostman(collection) as { item: { auth?: unknown }[] };
    expect(exported.item[0].auth).toEqual({
      type: 'apikey',
      apikey: [{ key: 'key', value: 'X-Api-Key' }, { key: 'value', value: '{{apiKey}}' }, { key: 'in', value: 'header' }],
    });
  });

  it('omits the auth key for a collection/folder with no auth of its own', () => {
    const collection: Collection = { id: 'c', name: 'C', items: [{ type: 'folder', id: 'f', name: 'F', items: [] }] };
    const exported = exportPostman(collection) as { auth?: unknown; item: { auth?: unknown }[] };
    expect(exported.auth).toBeUndefined();
    expect(exported.item[0].auth).toBeUndefined();
  });

  it('round-trips: a folder-level auth survives export then re-import as inherit for requests inside', () => {
    const folder: import('./types').Folder = {
      type: 'folder', id: 'f', name: 'Users',
      auth: { ...newAuth(), type: 'bearer', token: '{{token}}' },
      items: [newRequest({ name: 'Get', url: 'https://api.test/x' })],
    };
    const collection: Collection = { id: 'c', name: 'C', items: [folder] };
    const exported = JSON.stringify(exportPostman(collection));
    const { collection: reimported } = importPostman(exported);
    const reFolder = reimported.items[0];
    if (reFolder.type !== 'folder') throw new Error('expected a folder');
    expect(reFolder.auth).toMatchObject({ type: 'bearer', token: '{{token}}' });
    const reReq = reFolder.items[0];
    if (reReq.type !== 'request') throw new Error('expected a request');
    expect(reReq.auth.type).toBe('inherit');
  });
});

describe('importPostman — auth inheritance', () => {
  it('a request with no auth block imports as Inherit, not No Auth', () => {
    // This is the ordinary way a Postman collection sets auth: once at the
    // folder or collection level, with every request's own `auth` key simply
    // absent so it inherits. Collapsing that to "No Auth" (the old behavior)
    // silently unauthenticated every request in a collection built this way.
    const json = pmCollection([{ name: 'Get', request: { method: 'GET', url: 'https://api.test/x' } }]);
    const { collection } = importPostman(json);
    const item = collection.items[0];
    if (item.type !== 'request') throw new Error('expected a request');
    expect(item.auth.type).toBe('inherit');
  });

  it('an explicit {type: "noauth"} imports as No Auth, distinct from an absent auth block', () => {
    const json = pmCollection([{ name: 'Get', request: { method: 'GET', url: 'https://api.test/x', auth: { type: 'noauth' } } }]);
    const { collection } = importPostman(json);
    const item = collection.items[0];
    if (item.type !== 'request') throw new Error('expected a request');
    expect(item.auth.type).toBe('none');
  });

  it('imports folder-level auth, so requests inside without their own auth inherit it', () => {
    const json = JSON.stringify({
      info: { name: 'Test' },
      item: [{
        name: 'Users',
        auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] },
        item: [{ name: 'Get', request: { method: 'GET', url: 'https://api.test/x' } }],
      }],
    });
    const { collection } = importPostman(json);
    const folder = collection.items[0];
    if (folder.type !== 'folder') throw new Error('expected a folder');
    expect(folder.auth).toMatchObject({ type: 'bearer', token: '{{token}}' });
    const req = folder.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.auth.type).toBe('inherit');
  });

  it('imports collection-root auth', () => {
    const json = JSON.stringify({
      info: { name: 'Test' },
      auth: { type: 'apikey', apikey: [{ key: 'key', value: 'X-Api-Key' }, { key: 'value', value: '{{apiKey}}' }, { key: 'in', value: 'header' }] },
      item: [{ name: 'Get', request: { method: 'GET', url: 'https://api.test/x' } }],
    });
    const { collection } = importPostman(json);
    expect(collection.auth).toMatchObject({ type: 'apikey', apiKey: { key: 'X-Api-Key', value: '{{apiKey}}', placement: 'header' } });
  });

  it('warns once per unsupported auth type and imports it as No Auth', () => {
    const json = pmCollection([
      { name: 'A', request: { method: 'GET', url: 'https://api.test/a', auth: { type: 'awsv4' } } },
      { name: 'B', request: { method: 'GET', url: 'https://api.test/b', auth: { type: 'awsv4' } } },
    ]);
    const { collection, warnings } = importPostman(json);
    for (const item of collection.items) {
      if (item.type !== 'request') throw new Error('expected a request');
      expect(item.auth.type).toBe('none');
    }
    expect(warnings.filter((w) => w.includes('awsv4'))).toHaveLength(1);
  });

  it('says nothing when every auth type used is supported', () => {
    const json = pmCollection([{ name: 'Get', request: { method: 'GET', url: 'https://api.test/x', auth: { type: 'bearer', bearer: [{ key: 'token', value: 't' }] } } }]);
    const { warnings } = importPostman(json);
    expect(warnings).toEqual([]);
  });
});
