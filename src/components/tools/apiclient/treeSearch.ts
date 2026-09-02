// Sidebar search matching. A request matches on its name, its URL, or its
// method — not name alone. Searching "users" for the request that hits
// `/api/users` but is called "List all" used to come up empty, and typing
// "post" or "delete" is the quickest way to narrow a big collection down to
// the writes. `q` is expected already trimmed + lower-cased (the Sidebar does
// that once per keystroke, not once per node).

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
