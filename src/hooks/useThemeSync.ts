import { useEffect, useRef, useState } from 'react';
import type { ThemePreference } from '@/lib/persistentStore';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const TRANSITION_CLASS = 'theme-transition';
const TRANSITION_DURATION_MS = 260;

function resolveIsDark(preference: ThemePreference, media: MediaQueryList): boolean {
  return preference === 'system' ? media.matches : preference === 'dark';
}

/**
 * Applies the resolved light/dark class to `<html>` for a given 3-state
 * theme preference, and — while the preference is `'system'` — subscribes to
 * OS theme changes so the app updates in real time without needing a
 * restart. The media-query listener is added/removed exactly when the
 * preference enters/leaves `'system'` (and on unmount).
 *
 * Returns the resolved `isDark` boolean (useful for icon state elsewhere in
 * the UI).
 */
export function useThemeSync(themePreference: ThemePreference): boolean {
  const [isDark, setIsDark] = useState(() =>
    resolveIsDark(themePreference, window.matchMedia(DARK_MEDIA_QUERY))
  );
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
    },
    []
  );

  useEffect(() => {
    const media = window.matchMedia(DARK_MEDIA_QUERY);

    const applyTransitionClass = () => {
      const reduceMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches;
      if (reduceMotion) return;
      const root = document.documentElement;
      root.classList.add(TRANSITION_CLASS);
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
      transitionTimer.current = setTimeout(() => {
        root.classList.remove(TRANSITION_CLASS);
      }, TRANSITION_DURATION_MS);
    };

    const resolve = () => {
      const dark = resolveIsDark(themePreference, media);
      setIsDark(dark);
      document.documentElement.classList.toggle('dark', dark);
    };

    resolve();

    if (themePreference !== 'system') return;

    const handleOsChange = () => {
      applyTransitionClass();
      resolve();
    };
    media.addEventListener('change', handleOsChange);
    return () => media.removeEventListener('change', handleOsChange);
  }, [themePreference]);

  return isDark;
}

/** Triggers the same brief color-swap animation used on OS-driven changes,
 * for use on explicit user-initiated theme switches. */
export function triggerThemeTransition(): void {
  const reduceMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches;
  if (reduceMotion) return;
  const root = document.documentElement;
  root.classList.add(TRANSITION_CLASS);
  setTimeout(() => {
    root.classList.remove(TRANSITION_CLASS);
  }, TRANSITION_DURATION_MS);
}
