// Global "live connection" registry, keyed by tool featureId (e.g. 'rabbit-client',
// 'kafka-explorer'). The messaging tools mark themselves live while connected to a
// broker; the app sidebar reads this to show a live dot on the tool — visible
// whether the sidebar is collapsed or expanded, and on any page.
//
// Seeded from the tools' persisted "connected" ids so the dot is correct on a
// fresh launch before the tool's component has mounted.

import { useSyncExternalStore } from 'react';
import { storageGet } from '@/lib/persistentStore';

const live = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: string[] = [];

function emit() {
  snapshot = Array.from(live);
  listeners.forEach((l) => l());
}

/**
 * `legacyKey` tồn tại vì các tool đang chuyển dần sang khoá có namespace của
 * Platform (`devtool:<pluginId>:*`). Hàm seed chạy lúc NẠP MODULE, trước khi
 * component nào kịp mount và di trú khoá, nên nó phải đọc được cả hai: khoá mới
 * cho lần khởi động sau khi đã di trú, khoá cũ cho lần đầu tiên sau khi nâng
 * cấp. Chỉ đọc một khoá là chấm live sai đúng một lần chạy — kiểu lỗi không ai
 * báo nhưng ai cũng thấy.
 */
function seed(featureId: string, storageKey: string, legacyKey?: string) {
  try {
    // usePersistentState stores JSON; a non-empty connected id means "connected".
    const raw = storageGet(storageKey) ?? (legacyKey ? storageGet(legacyKey) : null);
    if (JSON.parse(raw ?? '""')) live.add(featureId);
  } catch { /* ignore */ }
}
seed('kafka-explorer', 'devtool:kafka-explorer:connectedBrokerId', 'devtool:kafka:connectedBrokerId');
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
