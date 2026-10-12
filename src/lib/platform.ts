// Single place to answer "running in Tauri or a browser?" and "is this
// macOS?", so detection can change in one file.

/** True inside the Tauri webview (false in browsers and window-less tests). */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** True on macOS/iOS, from `navigator.userAgent` (`navigator.platform` is
 *  deprecated). Read once at module load. */
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Modifier key label for shortcuts (⌘K / Ctrl+K). */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';
