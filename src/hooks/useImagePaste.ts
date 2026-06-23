import { useEffect, useRef } from 'react';
import { readImageFromClipboard } from '@/lib/clipboard';

/**
 * True when focus is in a field where the user is actively typing/editing.
 * There ⌘V should paste text at the cursor, not capture an image.
 */
function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

function fileToDataUrl(file: File, onImage: (dataUrl: string) => void) {
  const reader = new FileReader();
  reader.onload = () => onImage(reader.result as string);
  reader.readAsDataURL(file);
}

/**
 * ⌘V / Ctrl+V (and the native `paste` event) captures an image from the
 * clipboard and calls `onImage(dataUrl)` with a PNG/data-URL representation —
 * the image counterpart to {@link useQuickPaste}. Uses the Tauri clipboard
 * plugin in the desktop app and the async Clipboard API on the web.
 */
export function useImagePaste(onImage: (dataUrl: string) => void, enabled = true) {
  const handlerRef = useRef(onImage);
  handlerRef.current = onImage;

  useEffect(() => {
    if (!enabled) return;

    // The keydown (clipboard read) and native paste paths can both fire for a
    // single ⌘V on the web — dedupe captures within a short window.
    let lastCaptureAt = 0;
    const emit = (dataUrl: string) => {
      const now = Date.now();
      if (now - lastCaptureAt < 500) return;
      lastCaptureAt = now;
      handlerRef.current(dataUrl);
    };

    const onKeyDown = async (event: KeyboardEvent) => {
      const isPasteCombo =
        (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'v';
      if (!isPasteCombo) return;
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;

      const dataUrl = await readImageFromClipboard();
      if (dataUrl) {
        event.preventDefault();
        emit(dataUrl);
      }
    };

    // Native paste event — fires with image File items in browsers/WebViews
    // that expose them, avoiding a clipboard-read permission prompt on the web.
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            fileToDataUrl(file, emit);
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
    };
  }, [enabled]);
}
