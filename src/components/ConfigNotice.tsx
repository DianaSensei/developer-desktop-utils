// After an import, reset or undo reloads the app: a small card at the bottom
// right says what changed and offers Undo, then fades away by itself. Not a
// modal — work can go on underneath.

import { useEffect, useState } from 'react';
import { CheckCircle2, RotateCcw, X } from 'lucide-react';
import { useMessages } from '@/contexts/LocaleContext';
import { readUndo, reloadWith, takeNotice, undoLastImport, type ImportNotice } from '@/lib/configTransfer';
import MESSAGES from './configBackup.messages';

const VISIBLE_MS = 12_000;

export function ConfigNotice() {
  const m = useMessages(MESSAGES);
  const [notice, setNotice] = useState<ImportNotice | null>(() => takeNotice());

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), VISIBLE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  if (!notice) return null;
  const text = notice.kind === 'import'
    ? m('noticeImport', { label: notice.label, n: notice.changed })
    : notice.kind === 'reset' ? m('noticeReset', { label: notice.label }) : m('noticeUndo', { label: notice.label });
  const canUndo = notice.kind !== 'undo' && readUndo() !== null;

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-2.5 rounded-lg border border-line bg-card px-3 py-2.5 text-xs shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2"
    >
      <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" />
      <span className="min-w-0 flex-1">{text}</span>
      {canUndo && (
        <button
          type="button"
          onClick={() => {
            undoLastImport();
            void reloadWith({ kind: 'undo', label: notice.label, changed: notice.changed });
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 font-medium text-acc-ink hover:bg-acc-tint focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
        >
          <RotateCcw className="h-3 w-3" />{m('noticeUndoAction')}
        </button>
      )}
      <button
        type="button"
        onClick={() => setNotice(null)}
        aria-label={m('close')}
        className="shrink-0 rounded-sm p-0.5 text-fg-mute hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
