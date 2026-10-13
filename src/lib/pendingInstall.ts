// Queue of manifest URLs waiting to be installed, between deepLink.ts (which
// receives `desktop-devtool-app://install?...`) and SettingsExtensions (which
// opens the install preview). A deep link can arrive before that screen
// mounts, hence the queue. Nothing is installed here: every item still goes
// through the preview and confirmation.
//
// Listeners are notified on enqueue because a link that arrives while
// Settings → Extensions is already open does not remount it.

export interface PendingInstallItem {
  url: string;
  /** Market that supplied the URL, if any; passed to
   *  `installArtifact(url, marketId)`. */
  marketId?: string;
}

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

let queue: PendingInstallItem[] = [];

export const pendingInstall = {
  /** Replaces the queue with new URLs (plugin first, then service), all
   *  from one source, and notifies listeners. Replacing rather than
   *  appending means a new install request always wins over an unfinished
   *  one. */
  enqueue(urls: string[], marketId?: string) {
    const cleaned = urls.map((u) => u.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    queue = cleaned.map((url) => ({ url, marketId }));
    notify();
  },
  /** Takes the next item, or `null` when empty. */
  dequeue(): PendingInstallItem | null {
    if (queue.length === 0) return null;
    const [next, ...rest] = queue;
    queue = rest;
    return next;
  },
  /** Takes every item at once, so a plugin and its sidecar can share one
   *  preview. */
  dequeueAll(): PendingInstallItem[] {
    const all = queue;
    queue = [];
    return all;
  },
  /** Notifies when items are added. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
