// App-lifetime store for the mock server's request log.
//
// The mock server keeps running (and emitting `mock:request` events) in the Rust
// backend even when the Mock Server tool isn't the open tab — e.g. while you hit
// it from the API Client tool or a browser. If the listener lived inside the
// MockServer component it would be torn down on every tab switch and miss those
// requests. So we register a single listener for the app's lifetime and buffer
// entries here; components subscribe via `useSyncExternalStore`.

import { type RequestLogEntry } from './types';

const LOG_CAP = 500;
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let entries: RequestLogEntry[] = [];
const subscribers = new Set<() => void>();
let listening = false;

function notify() {
  for (const cb of subscribers) cb();
}

// Register the Tauri event listener exactly once, then keep it for the app's
// lifetime (never unlisten) so requests are captured regardless of the open tool.
function ensureListening() {
  if (listening || !isTauri) return;
  listening = true;
  import('@tauri-apps/api/event')
    .then(({ listen }) =>
      // The backend batches requests (~1 event/250ms) so the UI never faces a
      // per-request event storm under load.
      listen<RequestLogEntry[]>('mock:request-batch', (e) => {
        const batch = e.payload;
        if (!batch || batch.length === 0) return;
        // Batch arrives oldest→newest; show newest first, capped.
        entries = [...batch].reverse().concat(entries).slice(0, LOG_CAP);
        notify();
      }),
    )
    .catch(() => {
      // Allow a retry on the next subscribe if wiring up the listener failed.
      listening = false;
    });
}

export function subscribeRequestLog(cb: () => void): () => void {
  subscribers.add(cb);
  ensureListening();
  return () => {
    subscribers.delete(cb);
  };
}

export function getRequestLog(): RequestLogEntry[] {
  return entries;
}

export function clearRequestLog() {
  if (entries.length === 0) return;
  entries = [];
  notify();
}
