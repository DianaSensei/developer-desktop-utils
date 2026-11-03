// Most-recently-used tools, newest first, for the ⌘K palette's "Recent"
// section (⌘K then Enter goes back to the previous tool). Recorded by
// WorkspaceContext on every tool visit.

import { storageGet, storageSet } from './persistentStore';

const KEY = 'devtool-recent-tools';
export const MAX_RECENT = 8;

export function getRecentTools(): string[] {
  try {
    const v = JSON.parse(storageGet(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function recordToolVisit(id: string): void {
  if (!id) return;
  const list = getRecentTools();
  if (list[0] === id) return;
  storageSet(KEY, JSON.stringify([id, ...list.filter((x) => x !== id)].slice(0, MAX_RECENT)));
}
