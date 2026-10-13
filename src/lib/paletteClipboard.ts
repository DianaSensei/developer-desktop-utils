// Whether ⌘K reads the clipboard to suggest a tool for what was copied.
// On by default; Settings → Appearance turns it off. Read on every open, so
// the change applies without a restart.

import { storageGet, storageSet } from '@/lib/persistentStore';

const KEY = 'devtool-palette-clipboard';

export function paletteClipboardEnabled(): boolean {
  return storageGet(KEY) !== 'false';
}

export function setPaletteClipboardEnabled(on: boolean): void {
  storageSet(KEY, on ? 'true' : 'false');
}
