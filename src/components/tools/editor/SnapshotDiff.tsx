// A Local History snapshot side by side with the editor's current text
// (read-only, line-aligned, unchanged runs folded) — VS Code's "Compare with
// File". From here the snapshot can be restored or deleted.

import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, type Extension } from '@codemirror/state';
import { MergeView } from '@codemirror/merge';
import { RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ModalShell } from '@/components/ui/modal-shell';
import { LoadingRow } from '@/components/ui/spinner';
import { codeThemeWithVscodeHighlight } from '@/components/ui/code-theme';
import { useIsDark } from '@/hooks/useIsDark';
import { useCurrentLocale, useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './WorkspaceEditor.messages';
import type { EditorStore, Tab } from './store';
import type { HistoryEntry } from './fs';
import { loadLanguageByName } from './languages';
import { absoluteTime, formatSize } from './Timeline';

interface Props {
  store: EditorStore;
  tab: Tab;
  entry: HistoryEntry;
  onClose: () => void;
  onRestore: () => void;
  onDelete: () => void;
}

export function SnapshotDiff({ store, tab, entry, onClose, onRestore, onDelete }: Props) {
  const m = useMessages(MESSAGES);
  const locale = useCurrentLocale();
  const dark = useIsDark();
  const hostRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chunks, setChunks] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    store.readSnapshot(tab.path, entry.id).then(
      (t) => { if (!cancelled) setText(t.replace(/\r\n?/g, '\n')); },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { cancelled = true; };
  }, [store, tab.path, entry.id]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || text === null) return;
    let view: MergeView | null = null;
    let cancelled = false;
    void (async () => {
      const lang = tab.language ? await loadLanguageByName(tab.language) : null;
      if (cancelled) return;
      const common: Extension[] = [
        basicSetup,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        codeThemeWithVscodeHighlight(dark, { gutter: 'flush', paddingX: 8 }),
        ...(lang ? [lang.support] : []),
      ];
      view = new MergeView({
        parent: host,
        a: { doc: text, extensions: common },
        b: { doc: store.currentState(tab.id)?.doc.toString() ?? '', extensions: common },
        gutter: true,
        highlightChanges: true,
        collapseUnchanged: { margin: 3, minSize: 4 },
      });
      setChunks(view.chunks.length);
    })();
    return () => { cancelled = true; view?.destroy(); };
  }, [text, dark, store, tab.id, tab.language]);

  return (
    <ModalShell
      onClose={onClose}
      width="max-w-6xl"
      title={`${tab.name} — ${absoluteTime(entry.ts, locale)}`}
      description={[
        m('snapshotVsCurrent'),
        formatSize(entry.size),
        chunks === null ? '' : chunks === 0 ? m('noDifferences') : m('changedRegions', { n: chunks }),
      ].filter(Boolean).join(' · ')}
      bodyClassName="p-0"
      footer={(
        <div className="flex w-full items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 text-bad" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />{m('deleteSnapshot')}
          </Button>
          <span className="flex-1" />
          <Button variant="outline" size="sm" onClick={onClose}>{m('close')}</Button>
          <Button size="sm" className="gap-1.5" onClick={onRestore} disabled={text === null}>
            <RotateCcw className="h-3.5 w-3.5" />{m('restoreSnapshot')}
          </Button>
        </div>
      )}
    >
      {error && <p className="p-4 text-sm text-bad">{error}</p>}
      {text === null && !error && <LoadingRow label={m('loading')} className="justify-center py-10" />}
      <div ref={hostRef} className="h-[65vh] overflow-auto bg-bg text-dense [&_.cm-mergeView]:min-h-full" />
    </ModalShell>
  );
}
