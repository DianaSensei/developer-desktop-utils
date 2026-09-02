// Ranking for the ⌘P "go to request" palette (RequestQuickOpen.tsx). Pure so
// it can be tested without rendering: walks every collection, scores each
// request against the query, and returns the best matches with the
// collection › folder path they live under (the name alone is ambiguous
// the moment two collections both have a "Login").
//
// The query is split on whitespace and every token has to match somewhere
// in the request's name, URL, method, or path — so "post user" narrows to
// the POSTs whose name/URL mention "user" instead of everything containing
// either word. Scoring prefers a name that *starts* with the query over one
// that merely contains it, and a name hit over a URL hit, so the row you
// most likely meant is first and Enter just works.

import type { ApiRequest, Collection, TreeItem } from './types';

export interface QuickOpenHit {
  request: ApiRequest;
  collectionId: string;
  // Breadcrumb from the collection down to (not including) the request.
  path: string[];
  score: number;
}

// Every request in every collection, in tree order, with its breadcrumb —
// the query-independent half of `searchRequests`. Exposed so the empty
// query can list "everything" without re-implementing the walk.
export function listRequests(collections: Collection[]): Omit<QuickOpenHit, 'score'>[] {
  const out: Omit<QuickOpenHit, 'score'>[] = [];
  const walk = (items: TreeItem[], collectionId: string, path: string[]) => {
    for (const it of items) {
      if (it.type === 'request') out.push({ request: it, collectionId, path });
      else walk(it.items, collectionId, [...path, it.name]);
    }
  };
  for (const c of collections) walk(c.items, c.id, [c.name]);
  return out;
}

const scoreToken = (hit: Omit<QuickOpenHit, 'score'>, token: string): number => {
  const name = hit.request.name.toLowerCase();
  const url = hit.request.url.toLowerCase();
  const method = hit.request.method.toLowerCase();
  if (name === token) return 100;
  if (name.startsWith(token)) return 80;
  // A word boundary inside the name ("get user" for "Get User By Id") beats
  // an arbitrary substring ("ser" for the same).
  if (name.includes(` ${token}`) || name.includes(`-${token}`) || name.includes(`_${token}`) || name.includes(`/${token}`)) return 70;
  if (name.includes(token)) return 60;
  if (method === token) return 50;
  if (url.includes(token)) return 40;
  if (hit.path.some((p) => p.toLowerCase().includes(token))) return 20;
  return 0;
};

export function searchRequests(collections: Collection[], query: string, limit = 50): QuickOpenHit[] {
  const all = listRequests(collections);
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return all.slice(0, limit).map((h) => ({ ...h, score: 0 }));

  const scored: QuickOpenHit[] = [];
  for (const hit of all) {
    let score = 0;
    let miss = false;
    for (const t of tokens) {
      const s = scoreToken(hit, t);
      if (s === 0) { miss = true; break; }
      score += s;
    }
    if (!miss) scored.push({ ...hit, score });
  }
  // Stable: equal scores keep tree order, so results don't shuffle as you type.
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
