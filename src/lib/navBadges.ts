// Small counts a tool shows on its sidebar entry from any screen, e.g. the
// Time Tracker's overdue + due-today tasks. Same shape as liveConnections:
// a module-level registry the tool (or its background runtime) writes and
// the sidebar reads.

import { useSyncExternalStore } from 'react';

export interface NavBadge {
  count: number;
  /** `bad` when something is overdue, `info` otherwise. */
  tone: 'bad' | 'info';
  /** Tooltip / screen-reader text. */
  label: string;
}

let badges: Record<string, NavBadge> = {};
const listeners = new Set<() => void>();

export const navBadges = {
  set(featureId: string, badge: NavBadge | null) {
    const cur = badges[featureId];
    if (!badge || badge.count <= 0) {
      if (!cur) return;
      const { [featureId]: _removed, ...rest } = badges;
      badges = rest;
    } else {
      if (cur && cur.count === badge.count && cur.tone === badge.tone && cur.label === badge.label) return;
      badges = { ...badges, [featureId]: badge };
    }
    listeners.forEach((l) => l());
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useNavBadges(): Record<string, NavBadge> {
  return useSyncExternalStore(subscribe, () => badges, () => badges);
}
