import { useEffect, useRef } from 'react';

/**
 * Dismiss-on-outside-click / Escape for popovers and dropdowns. Attach the
 * returned ref to the element that should stay open while interacted with; when
 * `active`, a pointer-down outside it or the Escape key calls `onDismiss`.
 *
 * Consolidates the identical effect previously hand-rolled in the date, time,
 * and color pickers. Pass `active = open` (and `&& !inline` where a picker is
 * rendered inline with no popover to dismiss).
 */
export function useDismissable<T extends HTMLElement = HTMLElement>(
  active: boolean,
  onDismiss: () => void,
) {
  const ref = useRef<T>(null);
  // Keep the latest callback without re-binding listeners every render.
  const cb = useRef(onDismiss);
  cb.current = onDismiss;

  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cb.current();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [active]);

  return ref;
}
