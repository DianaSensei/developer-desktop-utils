import { useEffect, useRef } from 'react';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

export const quickPasteHint = isMac ? 'Press ⌘V to paste' : 'Press Ctrl+V to paste';

async function readClipboard(): Promise<string> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
    return (await readText()) ?? '';
  }
  return navigator.clipboard.readText();
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
