import { useEffect } from 'react';

// This is a desktop app, not a web page, so browser-style affordances don't
// belong: the native right-click context menu (Back / Reload / Inspect / Open
// Link / Look Up …) and history back/forward navigation. This hook disables
// both app-wide. Call it once near the app root.

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function useDesktopChrome() {
  useEffect(() => {
    // Suppress the browser/WebKit context menu everywhere.
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onKeyDown = (e: KeyboardEvent) => {
      // Backspace / Delete must never navigate back — only edit text.
      if ((e.key === 'Backspace' || e.key === 'Delete') && !isEditable(e.target)) {
        e.preventDefault();
        return;
      }
      // ⌘[ / ⌘] are pure history back/forward — block always.
      if (e.metaKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        return;
      }
      // ⌘R / Ctrl+R reloads the webview (WKWebView on macOS, WebView2 on Windows),
      // wiping all React state. Block unconditionally.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        return;
      }
      // ⌘F / Ctrl+F opens the native browser find bar — not useful in a desktop app
      // and overlays the UI. Block unconditionally.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        return;
      }
      // ⌘←/→ and Alt+←/→ navigate history, but the same keys move the caret in
      // text fields — only block them when not editing.
      if ((e.metaKey || e.altKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isEditable(e.target)) {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
