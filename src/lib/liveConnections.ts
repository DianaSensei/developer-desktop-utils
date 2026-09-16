// Global "live connection" registry, keyed by tool featureId (e.g.
// 'rabbit-client', 'kafka-explorer' — both externally-installed plugins now,
// see docs/decisions/architecture/optional-broker-plugins.md). The
// messaging tools mark themselves live while connected to a broker; the app
// sidebar reads this to show a live dot on the tool — visible whether the
// sidebar is collapsed or expanded, and on any page.
//
// No compile-time seeding anymore: every tool that used to seed itself here
// (redis/rabbit/container/kafka) moved out to an installable plugin, and a
// plugin only exists in the running app after `initInstalledPlugins()` —
// there's no "before the tool's component has mounted" window left to seed
// for. If a future compiled-in tool needs the dot correct before its own
// mount, re-add a `seed()` helper here reading its persisted "connected" id.

import { useSyncExternalStore } from 'react';

const live = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: string[] = [];

function emit() {
  snapshot = Array.from(live);
  listeners.forEach((l) => l());
}

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
