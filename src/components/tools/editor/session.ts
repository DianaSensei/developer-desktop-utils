// The one EditorStore per app session, shared by every mount of the tool so
// switching to another tool and back finds the same tabs and unsaved edits.

import type { PluginSdk } from '@/platform';
import { createNativeFs } from './fs';
import { createMemoryFs, DEMO_ROOT } from './memoryFs';
import { EditorStore } from './store';

let session: EditorStore | null = null;

export function getEditorStore(sdk: PluginSdk): EditorStore {
  if (!session) {
    const fs = sdk.env.isTauri
      ? createNativeFs(sdk)
      // The browser build has no disk access: a seeded in-memory folder,
      // pre-authorised so it shows under Recent.
      : createMemoryFs({ authorised: [DEMO_ROOT] });
    session = new EditorStore(fs, sdk.storage);
    if (typeof window !== 'undefined') {
      // Don't lose the last few hundred ms of layout changes on quit.
      window.addEventListener('pagehide', () => session?.flushPersist());
    }
  }
  return session;
}

/** Tests only: flushes pending writes and starts over. */
export function resetEditorSession() {
  session?.flushPersist();
  session = null;
}
