import { storageGet, storageSet } from '@/lib/persistentStore';

/**
 * Monospace face for code and data (`--mono`), separate from the UI font
 * (`--sans`, fontPreference.ts) because ligature taste varies. Both options
 * are bundled fonts (imported in main.tsx), so they look the same everywhere.
 *
 * Must match the `[data-mono-font="…"]` blocks in design/tokens.css
 * (checked by monoFontPreference.test.ts).
 */
export type MonoFontPreference = 'ibm-plex-mono' | 'fira-code';

export const MONO_FONT_PREFERENCES: MonoFontPreference[] = ['ibm-plex-mono', 'fira-code'];

const MONO_FONT_KEY = 'devtool-mono-font';
const DEFAULT_MONO_FONT: MonoFontPreference = 'ibm-plex-mono';

function isMonoFontPreference(value: string | null): value is MonoFontPreference {
  return value !== null && (MONO_FONT_PREFERENCES as string[]).includes(value);
}

export function getMonoFontPreference(): MonoFontPreference {
  const saved = storageGet(MONO_FONT_KEY);
  return isMonoFontPreference(saved) ? saved : DEFAULT_MONO_FONT;
}

export function setMonoFontPreference(pref: MonoFontPreference): void {
  storageSet(MONO_FONT_KEY, pref);
}

/** Sets `<html data-mono-font>`, which `--mono` reads. */
export function applyMonoFontToDocument(pref: MonoFontPreference): void {
  document.documentElement.dataset.monoFont = pref;
}
