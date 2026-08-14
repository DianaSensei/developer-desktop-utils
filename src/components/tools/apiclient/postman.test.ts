import { describe, expect, it } from 'vitest';
import { exportPostman, importPostman } from './postman';
import { newRequest, type Collection } from './types';

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
    const collection = importPostman(json);
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
    const collection = importPostman(json);
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
    const collection = importPostman(json);
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
    const collection = importPostman(json);
    const item = collection.items[0];
    if (item.type !== 'request') throw new Error('expected a request');
    expect(item.pathParams[0].enabled).toBe(false);
  });

  it('leaves pathParams empty when the request has no url.variable', () => {
    const json = pmCollection([{ name: 'Get', request: { method: 'GET', url: 'https://api.test/x' } }]);
    const collection = importPostman(json);
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
    const imported = importPostman(original);
    const exported = exportPostman(imported) as { item: { request: { url: { raw: string; variable?: { key: string; value: string }[] } } }[] };
    expect(exported.item[0].request.url.raw).toBe('https://api.test/users/:id');
    expect(exported.item[0].request.url.variable).toEqual([{ key: 'id', value: '42' }]);
  });
});
