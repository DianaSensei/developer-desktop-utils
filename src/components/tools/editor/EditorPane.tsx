// The editor surface: one CodeMirror view for the whole tool, into which the
// store swaps the active tab's EditorState (so each file keeps its own undo
// history, selection and scroll). Around it: the banners for a file that
// changed or vanished on disk, the placeholder for binary/unreadable files,
// and the welcome screen when nothing is open.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { FileCode2, FileInput, FilePlus2, FileWarning } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { EmptyState } from '@/components/ui/empty-state';
import { IS_MAC, Keycap } from '@/components/ui/keycap';
import { LoadingRow } from '@/components/ui/spinner';
import { useIsDark } from '@/hooks/useIsDark';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './WorkspaceEditor.messages';
import type { EditorSnapshot, EditorStore } from './store';
import { RecentlyClosed } from './RecentlyClosed';
import { LargeFileViewer } from './LargeFileViewer';
import { formatSize } from './Timeline';

interface Props {
  store: EditorStore;
  snap: EditorSnapshot;
}

export function EditorPane({ store, snap }: Props) {
  const m = useMessages(MESSAGES);
  const hostRef = useRef<HTMLDivElement>(null);
  const dark = useIsDark();
  const tab = store.tab(snap.activeId);

  useEffect(() => { store.setDark(dark); }, [store, dark]);

  useEffect(() => {
    if (!hostRef.current) return;
    store.setDark(document.documentElement.classList.contains('dark'));
    const view = new EditorView({ state: EditorState.create({ doc: '' }), parent: hostRef.current });
    store.attachView(view);
    return () => {
      store.attachView(null);
      view.destroy();
    };
  }, [store]);

  const viewer = tab?.mode === 'viewer' && tab.status === 'ready';
  const showEditor = tab?.status === 'ready' && !viewer;
  const errText = tab?.errorCode && MESSAGES[`err.${tab.errorCode}` as keyof typeof MESSAGES]
    ? m(`err.${tab.errorCode}` as keyof typeof MESSAGES)
    : tab?.error;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      {tab?.external === 'changed' && (
        <Callout
          tone="warning"
          size="sm"
          className="m-2 mb-0"
          actions={(
            <>
              <Button size="sm" variant="outline" onClick={() => void store.reload(tab.id)}>{m('reload')}</Button>
              <Button size="sm" variant="ghost" onClick={() => store.keepMine(tab.id)}>{m('keepMine')}</Button>
            </>
          )}
        >
          {m('changedOnDisk')}
        </Callout>
      )}
      {tab?.external === 'deleted' && (
        <Callout tone="warning" size="sm" className="m-2 mb-0">{m('deletedOnDisk')}</Callout>
      )}
      {showEditor && tab.large && (
        <Callout tone="info" size="sm" className="m-2 mb-0">{m('largeFileNotice', { size: formatSize(tab.size) })}</Callout>
      )}
      {viewer && <LargeFileViewer key={tab.id} store={store} tab={tab} />}

      {/* The view stays mounted (only hidden) so switching tabs is a state
          swap, not an editor rebuild. */}
      <div
        ref={hostRef}
        className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', !showEditor && 'hidden')}
        aria-hidden={!showEditor}
      />

      {!tab && <Welcome store={store} snap={snap} />}
      {tab && (tab.status === 'loading' || tab.status === 'idle') && (
        <LoadingRow label={m('loading')} className="m-auto" />
      )}
      {tab?.status === 'binary' && (
        <EmptyState icon={FileWarning} title={tab.name} description={m('binary')} />
      )}
      {tab?.status === 'error' && (
        <EmptyState
          icon={FileWarning}
          title={m('loadFailed')}
          description={errText}
          action={{ label: m('retry'), onClick: () => void store.reload(tab.id), variant: 'outline' }}
        />
      )}
    </div>
  );
}

function Welcome({ store, snap }: Props) {
  const m = useMessages(MESSAGES);
  const hasFolder = snap.folders.length > 0;
  const alt = IS_MAC ? '⌥' : 'Alt+';
  const rows: [React.ReactNode, string][] = [
    [<Keycap mod>P</Keycap>, m('shortcutQuickOpen')],
    [<Keycap mod>N</Keycap>, m('shortcutNewFile')],
    [<Keycap mod>⇧T</Keycap>, m('shortcutReopen')],
    [<Keycap mod>S</Keycap>, m('shortcutSave')],
    [<Keycap mod>⇧S</Keycap>, m('shortcutSaveAs')],
    [<Keycap>{IS_MAC ? '⇧⌥F' : 'Shift+Alt+F'}</Keycap>, m('shortcutFormat')],
    [<Keycap mod>{`${alt}S`}</Keycap>, m('shortcutSaveAll')],
    [<Keycap mod>W</Keycap>, m('shortcutClose')],
    [<Keycap mod>F</Keycap>, m('shortcutFind')],
    [<Keycap>{`${alt}Z`}</Keycap>, m('shortcutWrap')],
  ];
  return (
    <div className="m-auto flex flex-col items-center gap-5 p-8 text-center motion-safe:animate-fade-in-up">
      <FileCode2 className="h-12 w-12 text-fg-mute/30" />
      <p className="text-sm text-fg-mute">{hasFolder ? m('noEditor') : m('noEditorNoFolder')}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" className="gap-1.5" onClick={() => { store.newUntitled(); store.focusEditor(); }}>
          <FilePlus2 className="h-3.5 w-3.5" />{m('newTextFile')}
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void store.openFilePicker()}>
          <FileInput className="h-3.5 w-3.5" />{m('openFile')}
        </Button>
      </div>
      <RecentlyClosed store={store} closed={snap.closed} limit={8} className="w-full max-w-md text-left" />
      <dl className="grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-2 text-xs">
        {rows.map(([keys, label]) => (
          <div key={label} className="contents">
            <dt className="text-right text-fg-mute">{label}</dt>
            <dd className="text-left">{keys}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Line/column readout — its own subscription so typing re-renders only this. */
export function useCursor(store: EditorStore) {
  return useSyncExternalStore(store.subscribeCursor, store.getCursor, store.getCursor);
}
