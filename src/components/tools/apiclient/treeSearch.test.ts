import { describe, expect, it } from 'vitest';
import { collectionMatches, itemMatches, requestMatches } from './treeSearch';
import { newCollection, newFolder, newRequest } from './types';

describe('requestMatches', () => {
  const req = newRequest({ name: 'List all', url: 'https://api.test/api/users?page=1', method: 'DELETE' });

  it('matches on the name (case-insensitive)', () => {
    expect(requestMatches(req, 'list')).toBe(true);
    expect(requestMatches(req, 'LIST')).toBe(false); // caller lower-cases q
  });

  it('matches on the URL, so a request named after its purpose is still found by its path', () => {
    expect(requestMatches(req, 'users')).toBe(true);
    expect(requestMatches(req, 'api.test')).toBe(true);
  });

  it('matches on the exact method name', () => {
    expect(requestMatches(req, 'delete')).toBe(true);
    // A partial method ("del") is not a method match — it would otherwise pull
    // every DELETE into an unrelated search for "del" in a name/URL.
    expect(requestMatches(req, 'del')).toBe(false);
  });

  it('an empty query matches everything', () => {
    expect(requestMatches(req, '')).toBe(true);
  });
});

describe('itemMatches / collectionMatches', () => {
  const folder = newFolder('Auth');
  folder.items.push(newRequest({ name: 'Login', url: '{{baseUrl}}/session' }));
  const collection = newCollection('Shop');
  collection.items.push(folder, newRequest({ name: 'Products', url: '{{baseUrl}}/products' }));

  it('a folder matches on its own name or on any descendant', () => {
    expect(itemMatches(folder, 'auth')).toBe(true);
    expect(itemMatches(folder, 'session')).toBe(true);
    expect(itemMatches(folder, 'products')).toBe(false);
  });

  it('a collection matches on its own name or on anything inside it', () => {
    expect(collectionMatches(collection, 'shop')).toBe(true);
    expect(collectionMatches(collection, 'login')).toBe(true);
    expect(collectionMatches(collection, 'nothing')).toBe(false);
  });
});
