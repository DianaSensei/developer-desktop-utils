import { useEffect, useRef } from 'react';

export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

export const quickPasteHint = isMac ? 'Press ⌘V to paste' : 'Press Ctrl+V to paste';

async function readClipboard(): Promise<string> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
    return (await readText()) ?? '';
  }
  return navigator.clipboard.readText();
}

/**
 * True when focus is in a field where the user is actively typing/editing
 * (input, textarea, or contenteditable). In that case ⌘V should paste at the
 * cursor like a normal paste — not replace the whole field via quick-paste.
 */
function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useQuickPaste(onPaste: (text: string) => void, enabled = true) {
  const handlerRef = useRef(onPaste);
  handlerRef.current = onPaste;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = async (event: KeyboardEvent) => {
      const isPasteCombo =
        (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'v';
      if (!isPasteCombo) return;

      // While editing a field, let the browser handle paste normally
      // (insert at the cursor) instead of replacing the entire input.
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;

      event.preventDefault();
      try {
        const text = await readClipboard();
        if (text) handlerRef.current(text);
      } catch {
        // Clipboard read was blocked or unavailable; ignore silently.
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
