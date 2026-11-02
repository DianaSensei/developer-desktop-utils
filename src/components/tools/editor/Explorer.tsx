// The Explorer side bar: open folders as collapsible trees, VS Code-style.
// Folders list lazily (a folder's children are read the first time it opens),
// rows take the usual gestures — click opens, right-click for the menu, F2
// renames, Delete deletes, drag onto a folder moves — and new/rename happen
// in an inline field in the tree rather than in a dialog.

import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight, ClipboardPaste, Copy, FileInput, FilePlus, FolderInput, FolderPlus, FolderX, History, ListCollapse,
  Pencil, RefreshCw, Scissors, Trash2, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';
import { ContextMenu, useContextMenu, type ContextMenuEntry } from '@/components/ui/context-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { SectionLabel } from '@/components/ui/section-label';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './WorkspaceEditor.messages';
import type { EditorSnapshot, EditorStore } from './store';
import { fileIcon, folderIcon } from './fileIcons';
import { basename, dirname, isUnder } from './paths';

/** An inline name field in the tree: a new entry inside `dir`, or a rename. */
export type PendingEdit =
  | { kind: 'file' | 'dir'; dir: string }
  | { kind: 'rename'; path: string };

interface Props {
  store: EditorStore;
  snap: EditorSnapshot;
  activePath: string | null;
  pending: PendingEdit | null;
  setPending: (p: PendingEdit | null) => void;
  onRequestDelete: (path: string) => void;
  onRequestCloseFolder: (path: string) => void;
  onCopyPath: (path: string, relative: boolean) => void;
}

const ROW = 'flex w-full items-center gap-1.5 rounded-xs pr-2 text-dense leading-6 select-none';

export function Explorer({
  store, snap, activePath, pending, setPending, onRequestDelete, onRequestCloseFolder, onCopyPath,
}: Props) {
  const m = useMessages(MESSAGES);
  const menu = useContextMenu();
  const treeRef = useRef<HTMLDivElement>(null);
  const [dropDir, setDropDir] = useState<string | null>(null);
  const [dragPath, setDragPath] = useState<string | null>(null);

  // Where "New File" lands: the selected folder, the selected file's folder,
  // or the first workspace folder.
  const targetDir = (): string | null => {
    const sel = snap.selected;
    if (sel && store.rootOf(sel)) return store.isDir(sel) ? sel : dirname(sel);
    return snap.folders[0] ?? null;
  };
  const startNew = (kind: 'file' | 'dir', dir = targetDir()) => {
    if (!dir) return;
    void store.toggleDir(dir, true);
    setPending({ kind, dir });
  };

  const entriesFor = (path: string, isDir: boolean, isRoot: boolean): ContextMenuEntry[] => {
    const icon = (I: typeof Copy) => <I className="h-3.5 w-3.5" />;
    const out: ContextMenuEntry[] = [];
    if (isDir) {
      out.push(
        { icon: icon(FilePlus), label: m('newFile'), onClick: () => startNew('file', path) },
        { icon: icon(FolderPlus), label: m('newFolder'), onClick: () => startNew('dir', path) },
      );
      if (snap.cut && !isUnder(path, snap.cut)) {
        out.push({ icon: icon(ClipboardPaste), label: `${m('paste')} — ${basename(snap.cut)}`, onClick: () => void store.paste(path) });
      }
    } else {
      out.push({ icon: icon(FilePlus), label: m('open'), onClick: () => void store.openFile(path) });
    }
    out.push(
      { icon: icon(Copy), label: m('copyPath'), sep: true, onClick: () => onCopyPath(path, false) },
      { icon: icon(Copy), label: m('copyRelativePath'), onClick: () => onCopyPath(path, true) },
    );
    if (isRoot) {
      out.push(
        { icon: icon(RefreshCw), label: m('refresh'), sep: true, onClick: () => void store.loadDir(path) },
        { icon: icon(FolderX), label: m('removeFolder'), onClick: () => onRequestCloseFolder(path) },
      );
    } else {
      out.push(
        { icon: icon(Scissors), label: m('cut'), sep: true, onClick: () => store.markCut(path) },
        { icon: icon(Pencil), label: m('rename'), onClick: () => setPending({ kind: 'rename', path }) },
        { icon: icon(Trash2), label: m('delete'), danger: true, onClick: () => onRequestDelete(path) },
      );
    }
    return out;
  };

  // Keyboard navigation over the visible rows (the tree has focus, not a row).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (pending || e.target !== treeRef.current) return;
    const rows = store.visibleRows();
    const sel = snap.selected;
    const i = sel ? rows.indexOf(sel) : -1;
    const mod = e.metaKey || e.ctrlKey;
    const go = (path: string | undefined) => {
      if (!path) return;
      store.select(path);
      treeRef.current?.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    const isRoot = !!sel && snap.folders.includes(sel);
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); go(rows[Math.min(rows.length - 1, i + 1)]); break;
      case 'ArrowUp': e.preventDefault(); go(rows[Math.max(0, i - 1)]); break;
      case 'Home': e.preventDefault(); go(rows[0]); break;
      case 'End': e.preventDefault(); go(rows[rows.length - 1]); break;
      case 'ArrowRight':
        e.preventDefault();
        if (sel && store.isDir(sel)) {
          if (!snap.expanded[sel]) void store.toggleDir(sel, true);
          else go(rows[i + 1]);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (sel && store.isDir(sel) && snap.expanded[sel]) void store.toggleDir(sel, false);
        else if (sel && !isRoot) go(dirname(sel));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!sel) break;
        if (store.isDir(sel)) void store.toggleDir(sel);
        else void store.openFile(sel);
        break;
      case 'F2':
        if (sel && !isRoot) { e.preventDefault(); setPending({ kind: 'rename', path: sel }); }
        break;
      case 'Delete':
        if (sel && !isRoot) { e.preventDefault(); onRequestDelete(sel); }
        break;
      case 'Backspace':
        // ⌘⌫ on macOS, where there is no Delete key.
        if (mod && sel && !isRoot) { e.preventDefault(); onRequestDelete(sel); }
        break;
      case 'x':
      case 'X':
        if (mod && sel && !isRoot) { e.preventDefault(); store.markCut(sel); }
        break;
      case 'v':
      case 'V':
        if (mod && sel && snap.cut) { e.preventDefault(); void store.paste(store.isDir(sel) ? sel : dirname(sel)); }
        break;
      case 'Escape':
        if (snap.cut) { e.preventDefault(); store.markCut(null); }
        break;
    }
  };

  // Pointer-driven drag to move: Tauri intercepts native drag gestures for
  // OS file drops, so HTML5 drag events never reach the webview (the API
  // Client's tree does the same). Drop targets carry `data-drop-dir`.
  const startDrag = (e: React.PointerEvent, path: string) => {
    if (e.button !== 0 || pending) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let target: string | null = null;
    const valid = (dir: string | null) => !!dir && dir !== dirname(path) && !isUnder(dir, path);
    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < 4 && Math.abs(ev.clientY - startY) < 4) return;
        dragging = true;
        setDragPath(path);
        document.body.style.setProperty('user-select', 'none');
        document.body.style.setProperty('cursor', 'grabbing');
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-drop-dir]');
      const dir = el?.dataset.dropDir ?? null;
      target = valid(dir) ? dir : null;
      setDropDir(target);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      document.body.style.removeProperty('user-select');
      document.body.style.removeProperty('cursor');
      setDragPath(null);
      setDropDir(null);
    };
    const onUp = () => {
      cleanup();
      if (!dragging) return;
      // The release also fires a click on whatever row is under the pointer,
      // which would open/toggle it; swallow that one click.
      const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (target) void store.move(path, target);
    };
    const onCancel = () => cleanup();
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { target = null; cleanup(); } };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
  };

  const ctx: TreeCtx = {
    store, snap, activePath, pending, setPending, menu, entriesFor, startDrag, dropDir, dragPath,
    focusTree: () => treeRef.current?.focus({ preventScroll: true }),
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-chrome">
      <div className="flex h-ctl shrink-0 items-center gap-0.5 border-b border-line pl-3 pr-1">
        <SectionLabel className="mr-auto">{m('explorer')}</SectionLabel>
        <IconButton size="xs" title={m('openFolder')} aria-label={m('openFolder')} onClick={() => void store.openFolder()}>
          <FolderInput className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton size="xs" title={m('openFile')} aria-label={m('openFile')} onClick={() => void store.openFilePicker()}>
          <FileInput className="h-3.5 w-3.5" />
        </IconButton>
        {snap.folders.length > 0 && (
          <>
            <IconButton size="xs" title={m('newFile')} aria-label={m('newFile')} onClick={() => startNew('file')}>
              <FilePlus className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton size="xs" title={m('newFolder')} aria-label={m('newFolder')} onClick={() => startNew('dir')}>
              <FolderPlus className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton size="xs" title={m('refresh')} aria-label={m('refresh')} onClick={() => void store.refresh()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton size="xs" title={m('collapseAll')} aria-label={m('collapseAll')} onClick={() => store.collapseAll()}>
              <ListCollapse className="h-3.5 w-3.5" />
            </IconButton>
          </>
        )}
      </div>

      {snap.folders.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <EmptyState
            icon={FolderInput}
            title={m('noFolder')}
            description={m('noFolderHint')}
            action={{ label: m('openFolder'), onClick: () => void store.openFolder() }}
            className="flex-none px-4 py-8"
          />
          <RecentList store={store} recent={snap.recent} />
        </div>
      ) : (
        <>
          <div
            ref={treeRef}
            role="tree"
            aria-label={m('explorer')}
            tabIndex={0}
            onKeyDown={onKeyDown}
            className="min-h-0 flex-1 overflow-y-auto px-1 py-1 outline-hidden focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus"
          >
            {snap.folders.map((root) => <RootNode key={root} ctx={ctx} root={root} />)}
          </div>
          {snap.recent.length > 0 && (
            <div className="max-h-[30%] shrink-0 overflow-y-auto border-t border-line">
              <RecentList store={store} recent={snap.recent} />
            </div>
          )}
        </>
      )}
      {menu.state && <ContextMenu state={menu.state} onClose={menu.close} width={240} />}
    </div>
  );
}

interface TreeCtx {
  store: EditorStore;
  snap: EditorSnapshot;
  activePath: string | null;
  pending: PendingEdit | null;
  setPending: (p: PendingEdit | null) => void;
  menu: ReturnType<typeof useContextMenu>;
  entriesFor: (path: string, isDir: boolean, isRoot: boolean) => ContextMenuEntry[];
  startDrag: (e: React.PointerEvent, path: string) => void;
  dropDir: string | null;
  dragPath: string | null;
  focusTree: () => void;
}

function RootNode({ ctx, root }: { ctx: TreeCtx; root: string }) {
  const { store, snap } = ctx;
  const open = !!snap.expanded[root];
  const selected = snap.selected === root;
  return (
    <div role="treeitem" aria-expanded={open} aria-selected={selected} aria-level={1}>
      <div
        data-path={root}
        data-drop-dir={root}
        title={root}
        onClick={() => { store.select(root); void store.toggleDir(root); ctx.focusTree(); }}
        onContextMenu={(e) => { store.select(root); ctx.menu.open(e, ctx.entriesFor(root, true, true)); }}
        className={cn(
          ROW, 'cursor-pointer pl-1 font-semibold uppercase tracking-wide text-xs text-fg-mute hover:bg-bg-2/60',
          selected && 'bg-acc/10 text-fg',
          ctx.dropDir === root && 'bg-acc/15 ring-1 ring-inset ring-acc/40',
        )}
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-fast', open && 'rotate-90')} />
        <span className="truncate">{basename(root)}</span>
      </div>
      {open && <DirChildren ctx={ctx} dir={root} depth={1} />}
    </div>
  );
}

function DirChildren({ ctx, dir, depth }: { ctx: TreeCtx; dir: string; depth: number }) {
  const m = useMessages(MESSAGES);
  const state = ctx.snap.dirs[dir];
  const pendingHere = ctx.pending && ctx.pending.kind !== 'rename' && ctx.pending.dir === dir ? ctx.pending : null;
  const pad = { paddingLeft: 6 + depth * 12 };

  return (
    <div role="group">
      {pendingHere && (
        <NameField
          ctx={ctx}
          depth={depth}
          kind={pendingHere.kind}
          initial=""
          placeholder={pendingHere.kind === 'file' ? m('newFilePlaceholder') : m('newFolderPlaceholder')}
          onCommit={async (name) => { await ctx.store.create(dir, name, pendingHere.kind === 'file' ? 'file' : 'dir'); }}
        />
      )}
      {!state?.entries && state?.loading && (
        <div className={cn(ROW, 'text-fg-mute')} style={pad}><Spinner size="xs" /></div>
      )}
      {state?.error && (
        <div className={cn(ROW, 'text-bad')} style={pad} title={state.error}><span className="truncate">{state.error}</span></div>
      )}
      {state?.entries?.length === 0 && !pendingHere && (
        <div className={cn(ROW, 'italic text-fg-mute')} style={pad}>{m('emptyDir')}</div>
      )}
      {state?.entries?.map((entry) => (
        <EntryNode key={entry.path} ctx={ctx} path={entry.path} name={entry.name} isDir={entry.isDir} isSymlink={entry.isSymlink} depth={depth} />
      ))}
      {state?.truncated && (
        <div className={cn(ROW, 'text-[11px] text-fg-mute')} style={pad}>{m('truncated', { n: state.entries?.length ?? 0 })}</div>
      )}
    </div>
  );
}

function EntryNode({ ctx, path, name, isDir, isSymlink, depth }: {
  ctx: TreeCtx; path: string; name: string; isDir: boolean; isSymlink: boolean; depth: number;
}) {
  const m = useMessages(MESSAGES);
  const { store, snap } = ctx;
  const open = isDir && !!snap.expanded[path];
  const selected = snap.selected === path;
  const renaming = ctx.pending?.kind === 'rename' && ctx.pending.path === path;
  const tab = snap.tabs.find((t) => t.path === path);
  const Icon = isDir ? folderIcon(open) : fileIcon(path);
  const rowRef = useRef<HTMLDivElement>(null);

  // Follow the active editor: its file's row scrolls into view when selected
  // from elsewhere (a tab click, Quick Open).
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (renaming) {
    return (
      <NameField
        ctx={ctx}
        depth={depth}
        kind={isDir ? 'dir' : 'file'}
        initial={name}
        onCommit={async (next) => { if (next !== name) await store.rename(path, next); }}
      />
    );
  }

  return (
    <div role="treeitem" aria-expanded={isDir ? open : undefined} aria-selected={selected} aria-level={depth + 1}>
      <div
        ref={rowRef}
        data-path={path}
        data-drop-dir={isDir ? path : dirname(path)}
        title={isSymlink ? `${path} — ${m('symlink')}` : path}
        style={{ paddingLeft: 6 + depth * 12 }}
        onPointerDown={(e) => ctx.startDrag(e, path)}
        onClick={() => {
          store.select(path);
          if (isDir) void store.toggleDir(path);
          else void store.openFile(path);
          ctx.focusTree();
        }}
        onContextMenu={(e) => { store.select(path); ctx.menu.open(e, ctx.entriesFor(path, isDir, false)); }}
        className={cn(
          ROW, 'cursor-pointer text-fg/90 transition-colors duration-fast hover:bg-bg-2/60',
          selected && 'bg-acc/10 text-fg hover:bg-acc/15',
          ctx.activePath === path && !selected && 'text-fg',
          (snap.cut === path || ctx.dragPath === path) && 'opacity-50',
          isDir && ctx.dropDir === path && 'bg-acc/15 ring-1 ring-inset ring-acc/40',
        )}
      >
        {isDir
          ? <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-fg-mute transition-transform duration-fast', open && 'rotate-90')} />
          : <span className="w-3.5 shrink-0" />}
        <Icon className={cn('h-3.5 w-3.5 shrink-0', isDir ? 'text-acc' : 'text-fg-mute')} />
        <span className={cn('truncate', isSymlink && 'italic')}>{name}</span>
        {tab?.dirty && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-fg-mute" aria-label={m('unsaved')} />}
      </div>
      {open && <DirChildren ctx={ctx} dir={path} depth={depth + 1} />}
    </div>
  );
}

/** The inline name field for New File / New Folder / Rename. Enter or blur
 *  commits, Escape cancels; an empty name cancels. */
function NameField({ ctx, depth, kind, initial, placeholder, onCommit }: {
  ctx: TreeCtx; depth: number; kind: 'file' | 'dir' | 'rename'; initial: string; placeholder?: string;
  onCommit: (name: string) => Promise<void>;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const [value, setValue] = useState(initial);
  const Icon = kind === 'dir' ? folderIcon(false) : fileIcon(value || 'file');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Rename selects the name without its extension, as VS Code does.
    const dot = initial.lastIndexOf('.');
    el.setSelectionRange(0, kind !== 'dir' && dot > 0 ? dot : initial.length);
  }, [initial, kind]);

  const finish = async (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = value.trim();
    ctx.setPending(null);
    ctx.focusTree();
    if (commit && name) await onCommit(name);
  };

  return (
    <div className={cn(ROW, 'py-px')} style={{ paddingLeft: 6 + depth * 12 }}>
      <span className="w-3.5 shrink-0" />
      <Icon className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); void finish(true); }
          if (e.key === 'Escape') { e.preventDefault(); void finish(false); }
        }}
        onBlur={() => void finish(true)}
        placeholder={placeholder}
        aria-label={placeholder ?? initial}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className="h-6 min-w-0 flex-1 rounded-xs border border-acc/60 bg-card px-1.5 text-dense text-fg outline-hidden ring-[3px] ring-focus placeholder:text-fg-mute/70"
      />
    </div>
  );
}

function RecentList({ store, recent }: { store: EditorStore; recent: string[] }) {
  const m = useMessages(MESSAGES);
  if (recent.length === 0) return null;
  return (
    <div className="px-1 py-1.5">
      <SectionLabel className="flex items-center gap-1.5 px-2 pb-1">
        <History className="h-3 w-3" />{m('recent')}
      </SectionLabel>
      {recent.slice(0, 12).map((path) => (
        <div key={path} className="group flex items-center gap-1 rounded-xs pr-1 hover:bg-bg-2/60">
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 flex-1 justify-start gap-2 px-2 text-dense font-normal hover:bg-transparent"
            title={path}
            onClick={() => void store.addFolder(path)}
          >
            <FolderInput className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
            <span className="truncate">{basename(path)}</span>
            <span className="min-w-0 truncate text-[11px] text-fg-mute">{dirname(path)}</span>
          </Button>
          <IconButton
            size="xs"
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            title={m('forget')}
            aria-label={m('forget')}
            onClick={() => void store.forgetFolder(path)}
          >
            <X className="h-3 w-3" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
