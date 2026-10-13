import { useEffect, useRef } from 'react';
import { isTauri, IS_MAC as isMac } from '@/lib/platform';

import { useMessages } from '@/contexts/LocaleContext';
import COMMON from '@/components/tools/common.messages';

export { isMac };
/** Fixed English hint for code outside React; components use `useQuickPasteHint()`. */
export const quickPasteHint = isMac ? 'Press ⌘V to paste' : 'Press Ctrl+V to paste';

/** Localized "⌘V to paste" hint. */
export function useQuickPasteHint(): string {
  const m = useMessages(COMMON);
  return m(isMac ? 'quickPasteMac' : 'quickPasteOther');
}

async function readClipboard(): Promise<string> {
  if (isTauri) {
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
  // A read-only output (focused after selecting text to copy) cannot take a
  // paste, so ⌘V there should still reach the tool's input.
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.readOnly) return false;
  if (el.getAttribute('aria-readonly') === 'true') return false;
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
