// Sidebar search: a request matches on its name, URL or method. `q` arrives
// already trimmed and lower-cased (once per keystroke, by the Sidebar).

import type { ApiRequest, Collection, TreeItem } from './types';

export function requestMatches(r: Pick<ApiRequest, 'name' | 'url' | 'method'>, q: string): boolean {
  if (!q) return true;
  return r.name.toLowerCase().includes(q)
    || r.url.toLowerCase().includes(q)
    || r.method.toLowerCase() === q;
}

export function itemMatches(item: TreeItem, q: string): boolean {
  if (item.type === 'request') return requestMatches(item, q);
  return item.name.toLowerCase().includes(q) || item.items.some((c) => itemMatches(c, q));
}

export function collectionMatches(c: Collection, q: string): boolean {
  return c.name.toLowerCase().includes(q) || c.items.some((i) => itemMatches(i, q));
}
