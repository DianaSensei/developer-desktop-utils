// Global "live connection" registry, keyed by tool featureId (e.g. 'rabbit-client',
// 'kafka-explorer'). The messaging tools mark themselves live while connected to a
// broker; the app sidebar reads this to show a live dot on the tool — visible
// whether the sidebar is collapsed or expanded, and on any page.
//
// Seeded from the tools' persisted "connected" ids so the dot is correct on a
// fresh launch before the tool's component has mounted.

import { useSyncExternalStore } from 'react';

const live = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: string[] = [];

function emit() {
  snapshot = Array.from(live);
  listeners.forEach((l) => l());
}

function seed(featureId: string, storageKey: string) {
  try {
    // usePersistentState stores JSON; a non-empty connected id means "connected".
    if (JSON.parse(localStorage.getItem(storageKey) ?? '""')) live.add(featureId);
  } catch { /* ignore */ }
}
seed('rabbit-client', 'devtool:rabbit:connectedConnId');
seed('kafka-explorer', 'devtool:kafka:connectedBrokerId');
snapshot = Array.from(live);

export const liveConnections = {
  set(featureId: string, on: boolean) {
    if (on === live.has(featureId)) return;
    if (on) live.add(featureId); else live.delete(featureId);
    emit();
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Reactive list of featureIds currently connected. */
export function useLiveConnections(): string[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
