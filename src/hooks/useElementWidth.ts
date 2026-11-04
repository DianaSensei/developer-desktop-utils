import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Live width (px) of an element, for layouts that must change shape when
 * *their own* space is small — a narrow window, or one pane of a split view —
 * rather than at a viewport breakpoint. 0 until measured (and in jsdom).
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
