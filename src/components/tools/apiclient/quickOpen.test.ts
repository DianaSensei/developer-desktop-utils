import { describe, expect, it } from 'vitest';
import { listRequests, searchRequests } from './quickOpen';
import { newCollection, newFolder, newRequest } from './types';

function fixture() {
  const shop = newCollection('Shop');
  const users = newFolder('Users');
  users.items.push(
    newRequest({ name: 'Get User By Id', url: '{{baseUrl}}/users/:id', method: 'GET' }),
    newRequest({ name: 'Create User', url: '{{baseUrl}}/users', method: 'POST' }),
    newRequest({ name: 'Delete User', url: '{{baseUrl}}/users/:id', method: 'DELETE' }),
  );
  shop.items.push(users, newRequest({ name: 'Products', url: '{{baseUrl}}/products', method: 'GET' }));
  const admin = newCollection('Admin');
  admin.items.push(newRequest({ name: 'Login', url: 'https://admin.test/session', method: 'POST' }));
  return { shop, users, admin };
}

describe('listRequests', () => {
  it('walks every collection in tree order and records the breadcrumb path', () => {
    const { shop, admin } = fixture();
    const all = listRequests([shop, admin]);
    expect(all.map((h) => h.request.name)).toEqual(['Get User By Id', 'Create User', 'Delete User', 'Products', 'Login']);
    expect(all[0].path).toEqual(['Shop', 'Users']);
    expect(all[0].collectionId).toBe(shop.id);
    expect(all[3].path).toEqual(['Shop']);
    expect(all[4].path).toEqual(['Admin']);
  });
});

describe('searchRequests', () => {
  it('an empty query lists everything in tree order, capped at the limit', () => {
    const { shop, admin } = fixture();
    expect(searchRequests([shop, admin], '   ').map((h) => h.request.name)).toHaveLength(5);
    expect(searchRequests([shop, admin], '', 2).map((h) => h.request.name)).toEqual(['Get User By Id', 'Create User']);
  });

  it('a name that starts with the query outranks one that merely contains it', () => {
    const { shop, admin } = fixture();
    const names = searchRequests([shop, admin], 'user').map((h) => h.request.name);
    // "Users" folder path matches too, but the three requests whose *name*
    // mentions user come first; "Get User By Id" ties with "Create User"
    // and "Delete User" on a word-boundary hit, so tree order holds.
    expect(names).toEqual(['Get User By Id', 'Create User', 'Delete User']);
  });

  it('a name hit outranks a URL-only hit', () => {
    const { shop, admin } = fixture();
    const names = searchRequests([shop, admin], 'products').map((h) => h.request.name);
    expect(names).toEqual(['Products']);
    const byUrl = searchRequests([shop, admin], 'session').map((h) => h.request.name);
    expect(byUrl).toEqual(['Login']);
  });

  it('every token must match — "post user" narrows to the POSTs about users', () => {
    const { shop, admin } = fixture();
    const names = searchRequests([shop, admin], 'post user').map((h) => h.request.name);
    expect(names).toEqual(['Create User']);
  });

  it('a token can match the breadcrumb path, so a folder name finds its contents', () => {
    const { shop, admin } = fixture();
    const names = searchRequests([shop, admin], 'admin').map((h) => h.request.name);
    expect(names).toEqual(['Login']);
  });

  it('returns nothing when a token matches nowhere', () => {
    const { shop, admin } = fixture();
    expect(searchRequests([shop, admin], 'zzz')).toEqual([]);
  });
});
