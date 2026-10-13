import { useCallback, useEffect, useRef, useState } from 'react';

// 130ms = `--dur-exit` in design/tokens.css. Only decides when the panel
// may leave the DOM, so a few ms of drift is harmless.
const EXIT_MS = 130;

/**
 * Open state with an exit animation, for popovers that own their `open`
 * state (ColorPicker, DatePicker, TimePicker). Parent-owned overlays use
 * the same idea in dropdown-menu.tsx, modal-shell.tsx and context-menu.tsx.
 *
 *   const { visible, closing, open, show, close, toggle } = useAnimatedOpen();
 *   const wrapRef = useDismissable(open, close);
 *   <button onClick={toggle}>…</button>
 *   {visible && (
 *     <div className={closing ? 'motion-safe:animate-pop-out' : 'motion-safe:animate-pop-in'}>
 *   )}
 *
 * `open` is the logical state (interactive, dismiss listeners active);
 * `visible` is the DOM state (still rendered during the exit animation).
 * Render the panel from `visible`.
 */
export function useAnimatedOpen(initial = false) {
  const [open, setOpen] = useState(initial);
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const show = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setClosing(false);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen((was) => {
      if (!was) return was;
      if (timerRef.current) clearTimeout(timerRef.current);
      setClosing(true);
      timerRef.current = setTimeout(() => setClosing(false), EXIT_MS);
      return false;
    });
  }, []);

  // Reopening within the exit window cancels it; `show()` already does
  // that.
  const toggle = useCallback(() => { if (open) close(); else show(); }, [open, close, show]);

  return { open, closing, visible: open || closing, show, close, toggle };
}
