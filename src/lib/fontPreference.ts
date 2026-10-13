import { storageGet, storageSet } from '@/lib/persistentStore';

/**
 * UI font (`--sans`): four presets in design/tokens.css (`[data-font="…"]`),
 * applied through `document.documentElement.dataset.font`. Does not affect
 * `--mono` (see monoFontPreference.ts).
 *
 * Must match tokens.css (checked by fontPreference.test.ts).
 */
export type FontPreference = 'default' | 'system' | 'serif' | 'classic';

export const FONT_PREFERENCES: FontPreference[] = ['default', 'system', 'serif', 'classic'];

const FONT_KEY = 'devtool-font';
const DEFAULT_FONT: FontPreference = 'default';

function isFontPreference(value: string | null): value is FontPreference {
  return value !== null && (FONT_PREFERENCES as string[]).includes(value);
}

export function getFontPreference(): FontPreference {
  const saved = storageGet(FONT_KEY);
  return isFontPreference(saved) ? saved : DEFAULT_FONT;
}

export function setFontPreference(pref: FontPreference): void {
  storageSet(FONT_KEY, pref);
}

/** Sets `<html data-font>`, which `--sans` reads. */
export function applyFontToDocument(pref: FontPreference): void {
  document.documentElement.dataset.font = pref;
}
