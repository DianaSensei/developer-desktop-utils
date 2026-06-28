import { useState, useCallback, useEffect, useRef } from 'react';
import { copyToClipboard } from '@/lib/clipboard';

export function useCopyFeedback(timeout = 2000) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending reset on unmount so we never setState after unmount.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback(async (text: string) => {
    try {
      await copyToClipboard(text);
      setCopied(true);
      // Re-arm: cancel a previous pending reset so rapid copies don't orphan timers.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), timeout);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [timeout]);

  return { copied, copy };
}
