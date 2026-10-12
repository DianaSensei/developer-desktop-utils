import { storageGet, storageSet } from '@/lib/persistentStore';

/**
 * Accent tone: four presets in design/tokens.css (`[data-accent="…"]`),
 * applied through `document.documentElement.dataset.accent`; `--a-h/-s/-l`
 * and everything derived from them follow via CSS.
 *
 * Must match tokens.css (checked by accentPreference.test.ts).
 */
export type AccentTone = 'azure' | 'teal' | 'iris' | 'amber';

export const ACCENT_TONES: AccentTone[] = ['azure', 'teal', 'iris', 'amber'];

const ACCENT_KEY = 'devtool-accent';
const DEFAULT_ACCENT: AccentTone = 'azure';

function isAccentTone(value: string | null): value is AccentTone {
  return value !== null && (ACCENT_TONES as string[]).includes(value);
}

export function getAccentPreference(): AccentTone {
  const saved = storageGet(ACCENT_KEY);
  return isAccentTone(saved) ? saved : DEFAULT_ACCENT;
}

export function setAccentPreference(tone: AccentTone): void {
  storageSet(ACCENT_KEY, tone);
}

/** Sets `<html data-accent>`, which every accent color reads. */
export function applyAccentToDocument(tone: AccentTone): void {
  document.documentElement.dataset.accent = tone;
}
