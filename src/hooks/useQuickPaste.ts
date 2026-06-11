import { useEffect, useRef } from 'react';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** Short hint shown next to inputs that support quick paste. */
export const quickPasteHint = isMac ? 'Press ⌘V to paste' : 'Press Ctrl+V to paste';

/**
 * Reads the clipboard. In the Tauri desktop app this goes through the Rust
 * backend, which avoids the WebKit clipboard-permission popup. In a plain
 * browser it falls back to the Clipboard API.
 */
async function readClipboard(): Promise<string> {
  if (typeof window !== 'undefined' && '__TAURI_IPC__' in window) {
    const { readText } = await import('@tauri-apps/api/clipboard');
    return (await readText()) ?? '';
  }
  return navigator.clipboard.readText();
}

/**
 * Quick paste: pressing the OS paste shortcut (⌘V / Ctrl+V) while the active
 * tool is open reads the clipboard and replaces the tool's primary input via
 * `onPaste` — no popup, no extra click, and it always pastes the current
 * clipboard contents.
 */
export function useQuickPaste(onPaste: (text: string) => void, enabled = true) {
  const handlerRef = useRef(onPaste);
  handlerRef.current = onPaste;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = async (event: KeyboardEvent) => {
      const isPasteCombo =
        (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'v';
      if (!isPasteCombo) return;

      // Take over the paste so the clipboard always lands in the tool's input.
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
