// Text Editor — a VS Code-style workspace: Explorer on the left (open
// folders, file tree, create/rename/move/delete), tabbed CodeMirror editor
// on the right, status bar below. State lives in the session store
// (store.ts) so unsaved edits survive switching tools; this component wires
// it to the screen, the keyboard and the confirmation dialogs.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePluginSdkFor, usePluginState } from '@/platform';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { SplitPane } from '@/components/ui/split-pane';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './WorkspaceEditor.messages';
import { Explorer, type PendingEdit } from './Explorer';
import { EditorTabs } from './EditorTabs';
import { EditorPane } from './EditorPane';
import { StatusBar } from './StatusBar';
import { QuickOpen } from './QuickOpen';
import { getEditorStore } from './session';
import { toFsError } from './fs';
import { basename, dirname, isUnder, relativeTo } from './paths';

type Choice = 'primary' | 'secondary' | 'cancel';

interface ChoicePrompt {
  title: string;
  description: string;
  primary: string;
  secondary: string;
  destructiveSecondary?: boolean;
  resolve: (choice: Choice) => void;
}

export function WorkspaceEditor() {
  const m = useMessages(MESSAGES);
  const sdk = usePluginSdkFor('text-editor');
  const store = getEditorStore(sdk);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [sidebarPct, setSidebarPct] = usePluginState(sdk, 'sidebarPct', 22);
  const [pending, setPending] = useState<PendingEdit | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [deletePath, setDeletePath] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<ChoicePrompt | null>(null);

  const activeTab = store.tab(snap.activeId);

  useEffect(() => { void store.hydrate(); }, [store]);

  // No file watcher: when the window regains focus, re-list open folders and
  // compare open files with disk (a clean tab reloads, a dirty one is flagged).
  useEffect(() => {
    let last = 0;
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 1500) return;
      last = Date.now();
      void store.checkAll();
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [store]);

  // Info notices (e.g. "Path copied") fade on their own; errors stay.
  useEffect(() => {
    if (snap.notice?.tone !== 'info') return;
    const t = setTimeout(() => store.dismissNotice(), 2000);
    return () => clearTimeout(t);
  }, [snap.notice, store]);

  const ask = useCallback((p: Omit<ChoicePrompt, 'resolve'>) =>
    new Promise<Choice>((resolve) => setPrompt({ ...p, resolve })), []);

  const answer = (choice: Choice) => {
    prompt?.resolve(choice);
    setPrompt(null);
  };

  /** Save with the on-disk conflict check; asks Overwrite / Reload on a clash. */
  const save = useCallback(async (id: string): Promise<boolean> => {
    const result = await store.save(id);
    if (result !== 'conflict') return result === 'saved' || result === 'skipped';
    const tab = store.tab(id);
    const choice = await ask({
      title: m('conflictTitle'),
      description: m('conflictDesc', { name: tab?.name ?? '' }),
      primary: m('overwrite'),
      secondary: m('discardReload'),
      destructiveSecondary: true,
    });
    if (choice === 'primary') return (await store.save(id, true)) === 'saved';
    if (choice === 'secondary') await store.reload(id);
    return false;
  }, [store, ask, m]);

  /** Closes tabs, asking first about unsaved ones. Resolves false on Cancel. */
  const requestClose = useCallback(async (ids: string[]): Promise<boolean> => {
    const dirty = ids.map((id) => store.tab(id)).filter((t) => t?.dirty);
    if (dirty.length > 0) {
      const choice = await ask({
        title: dirty.length === 1
          ? m('saveChangesTitle', { name: dirty[0]!.name })
          : m('saveChangesManyTitle', { n: dirty.length }),
        description: m('saveChangesDesc'),
        primary: dirty.length === 1 ? m('save') : m('saveAll'),
        secondary: m('dontSave'),
        destructiveSecondary: true,
      });
      if (choice === 'cancel') return false;
      if (choice === 'primary') {
        for (const t of dirty) if (!(await save(t!.id))) return false;
      }
    }
    store.closeTabs(ids);
    return true;
  }, [store, ask, save, m]);

  const requestCloseFolder = useCallback(async (path: string) => {
    const ids = store.getSnapshot().tabs.filter((t) => isUnder(t.path, path)).map((t) => t.id);
    if (await requestClose(ids)) store.closeFolder(path);
  }, [store, requestClose]);

  const copyPath = useCallback(async (path: string, relative: boolean) => {
    const root = store.rootOf(path);
    const text = relative && root ? relativeTo(path, root) || basename(path) : path;
    try {
      await sdk.clipboard.writeText(text);
      store.notify(m('pathCopied'), 'info');
    } catch (e) {
      store.notify(e instanceof Error ? e.message : String(e));
    }
  }, [sdk, store, m]);

  // ── keyboard ───────────────────────────────────────────────────────────
  const handlers = useRef({ save, requestClose, setQuickOpen, setPending });
  handlers.current = { save, requestClose, setQuickOpen, setPending };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A modal owns the keyboard while open.
      if (document.querySelector('[role="dialog"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      const h = handlers.current;
      const snapNow = store.getSnapshot();
      const active = snapNow.activeId;
      // e.code, not e.key: ⌥S types "ß" on a Mac keyboard.
      if (mod && e.altKey && e.code === 'KeyS') {
        e.preventDefault();
        void (async () => { for (const t of store.getSnapshot().tabs) if (t.dirty) await h.save(t.id); })();
      } else if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyS') {
        e.preventDefault();
        if (active) void h.save(active);
      } else if (mod && !e.altKey && e.code === 'KeyW') {
        e.preventDefault();
        if (active) void h.requestClose([active]);
      } else if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyP') {
        e.preventDefault();
        h.setQuickOpen(true);
      } else if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyN') {
        e.preventDefault();
        const sel = snapNow.selected;
        const dir = sel && store.rootOf(sel) ? (store.isDir(sel) ? sel : dirname(sel)) : snapNow.folders[0];
        if (dir) {
          void store.toggleDir(dir, true);
          h.setPending({ kind: 'file', dir });
        }
      } else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        store.activateRelative(e.shiftKey ? -1 : 1);
      } else if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault();
        store.toggleWrap();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store]);

  const noticeText = snap.notice
    ? (snap.notice.code && MESSAGES[`err.${snap.notice.code}` as keyof typeof MESSAGES]
      ? m(`err.${snap.notice.code}` as keyof typeof MESSAGES)
      : snap.notice.text)
    : null;
  const deleteIsDir = deletePath ? store.isDir(deletePath) : false;
  const deleteHasDirty = deletePath ? snap.tabs.some((t) => t.dirty && isUnder(t.path, deletePath)) : false;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {store.fs.kind === 'memory' && (
        <Callout tone="info" size="sm" className="m-2 mb-0">{m('webDemo')}</Callout>
      )}
      <SplitPane
        direction="horizontal"
        percent={sidebarPct}
        onPercentChange={setSidebarPct}
        initialPercent={22}
        minPercent={12}
        maxPercent={50}
        minPanePx={200}
        first={(
          <Explorer
            store={store}
            snap={snap}
            activePath={activeTab?.path ?? null}
            pending={pending}
            setPending={setPending}
            onRequestDelete={setDeletePath}
            onRequestCloseFolder={(p) => void requestCloseFolder(p)}
            onCopyPath={(p, rel) => void copyPath(p, rel)}
          />
        )}
        second={(
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <EditorTabs
              store={store}
              snap={snap}
              onRequestClose={(ids) => void requestClose(ids)}
              onCopyPath={(p, rel) => void copyPath(p, rel)}
            />
            {noticeText && (
              <Callout
                tone={snap.notice!.tone === 'info' ? 'success' : 'error'}
                size="sm"
                className="m-2 mb-0"
                actions={(
                  <Button size="sm" variant="ghost" onClick={() => store.dismissNotice()}>{m('dismiss')}</Button>
                )}
              >
                {noticeText}
              </Callout>
            )}
            <EditorPane store={store} snap={snap} />
            <StatusBar store={store} tab={activeTab} wrap={snap.wrap} />
          </div>
        )}
      />

      <QuickOpen
        open={quickOpen}
        onOpenChange={setQuickOpen}
        store={store}
        folderCount={snap.folders.length}
        openPaths={snap.tabs.map((t) => t.path)}
      />

      <ConfirmDialog
        open={deletePath !== null}
        onOpenChange={(o) => { if (!o) setDeletePath(null); }}
        title={m('deleteTitle', { name: deletePath ? basename(deletePath) : '' })}
        description={[
          deleteIsDir ? m('deleteFolderDesc') : m('deleteFileDesc'),
          deleteHasDirty ? m('deleteUnsaved') : '',
        ].filter(Boolean).join(' ')}
        confirmLabel={m('delete')}
        onConfirm={async () => {
          if (!deletePath) return;
          try {
            await store.remove(deletePath);
          } catch (e) {
            // ConfirmDialog shows the message and offers Retry.
            const err = toFsError(e);
            const key = `err.${err.code}` as keyof typeof MESSAGES;
            throw new Error(MESSAGES[key] ? m(key) : err.message);
          }
        }}
      />

      <Dialog open={prompt !== null} onOpenChange={(o) => { if (!o) answer('cancel'); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{prompt?.title}</DialogTitle>
            <DialogDescription>{prompt?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => answer('cancel')}>{m('cancel')}</Button>
            <Button variant={prompt?.destructiveSecondary ? 'destructive' : 'secondary'} onClick={() => answer('secondary')}>
              {prompt?.secondary}
            </Button>
            <Button onClick={() => answer('primary')} autoFocus>{prompt?.primary}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
