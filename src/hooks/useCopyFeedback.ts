import { useState, useCallback } from 'react';
import { copyToClipboard } from '@/lib/clipboard';

export function useCopyFeedback(timeout = 2000) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async (text: string) => {
    try {
      await copyToClipboard(text);
      setCopied(true);
      const timer = setTimeout(() => setCopied(false), timeout);
      return () => clearTimeout(timer);
    } catch (error) {
      console.error('Failed to copy:', error);
      return;
    }
  }, [timeout]);

  return { copied, copy };
}
