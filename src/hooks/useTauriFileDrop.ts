import { useEffect, useRef, useState } from 'react';

const isTauri = '__TAURI_INTERNALS__' in window;

interface DragDropPayload {
  type: 'enter' | 'over' | 'drop' | 'leave';
  paths?: string[];
  position?: { x: number; y: number };
}

/**
 * OS-level file drag-and-drop for Tauri (dragging from Finder / Explorer / other
 * apps). Tauri intercepts native file drops before the webview, so the browser's
 * HTML5 `ondrop` never receives them — instead Tauri emits a window event with
 * the real filesystem path(s). This hook listens for that event, hit-tests the
 * drop position against the element you attach `dropRef` to, and calls
 * `onDropPaths` with the dropped paths only when the drop lands on that element.
 *
 * Returns `dragging` (true while an OS drag hovers the element) so the UI can
 * show the same highlight as web drag. In a browser (non-Tauri) this is inert;
 * keep your existing HTML5 drop handlers for that case.
 */
export function useTauriFileDrop<T extends HTMLElement = HTMLElement>(
  onDropPaths: (paths: string[]) => void,
  enabled = true,
) {
  const dropRef = useRef<T | null>(null);
  const [dragging, setDragging] = useState(false);
  // Keep the latest callback without re-subscribing the listener each render.
  const cb = useRef(onDropPaths);
  cb.current = onDropPaths;

  useEffect(() => {
    if (!isTauri || !enabled) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      const un = await getCurrentWebview().onDragDropEvent((event) => {
        const p = event.payload as DragDropPayload;
        if (p.type === 'enter' || p.type === 'over') {
          setDragging(isInside(dropRef.current, p.position));
        } else if (p.type === 'drop') {
          const inside = isInside(dropRef.current, p.position);
          setDragging(false);
          if (inside && p.paths && p.paths.length) cb.current(p.paths);
        } else {
          setDragging(false);
        }
      });
      if (cancelled) un();
      else unlisten = un;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      setDragging(false);
    };
  }, [enabled]);

  return { dropRef, dragging, isTauri };
}

/**
 * Is the (physical-pixel) drop position inside the element? Tauri reports the
 * position in physical pixels relative to the webview; `getBoundingClientRect`
 * is CSS pixels, so scale by the device pixel ratio to compare.
 */
function isInside(el: HTMLElement | null, pos?: { x: number; y: number }): boolean {
  if (!el || !pos) return false;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const x = pos.x / dpr;
  const y = pos.y / dpr;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
