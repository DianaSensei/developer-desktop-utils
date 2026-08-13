import { useEffect, useState } from 'react';

/**
 * Reads the resolved dark/light state straight off `<html>`, and re-renders
 * whenever it flips.
 *
 * `useThemeSync` already owns the *decision* (preference + OS media query) and
 * writes the `dark` class, but it returns `isDark` only to `AppContent` — there
 * is no context carrying it down. Rather than thread a provider through the
 * whole tree for the handful of components that need the boolean in JS (rather
 * than in CSS, where `.dark` already handles it), this observes the class the
 * theme system already maintains.
 *
 * The observer is the cheap kind: one `attributes` filter on a single element,
 * shared shape across every caller.
 */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setIsDark(root.classList.contains('dark'));
    // Re-read once on mount: the class may have changed between the initial
    // useState and the effect running.
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
