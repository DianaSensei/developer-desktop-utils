import { storageGet, storageSet } from '@/lib/persistentStore';

/**
 * Corner style: three presets in design/tokens.css (`[data-corner="…"]`),
 * applied through `document.documentElement.dataset.corner`. The `--r-*`
 * scale and every `rounded-*` reading it follow via CSS. Radii must use the
 * tokens (guard.test.ts rule `hardcodedRadius`).
 *
 * Must match tokens.css (checked by cornerPreference.test.ts).
 */
export type CornerStyle = 'sharp' | 'default' | 'round';

export const CORNER_STYLES: CornerStyle[] = ['sharp', 'default', 'round'];

const CORNER_KEY = 'devtool-corner';
const DEFAULT_CORNER: CornerStyle = 'default';

function isCornerStyle(value: string | null): value is CornerStyle {
  return value !== null && (CORNER_STYLES as string[]).includes(value);
}

export function getCornerPreference(): CornerStyle {
  const saved = storageGet(CORNER_KEY);
  return isCornerStyle(saved) ? saved : DEFAULT_CORNER;
}

export function setCornerPreference(style: CornerStyle): void {
  storageSet(CORNER_KEY, style);
}

/** Sets `<html data-corner>`, which the `--r-*` scale reads. */
export function applyCornerToDocument(style: CornerStyle): void {
  document.documentElement.dataset.corner = style;
}
