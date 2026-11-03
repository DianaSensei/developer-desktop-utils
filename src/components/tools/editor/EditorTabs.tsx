// The open-file tab strip. A dirty tab shows a dot where its × sits (hover
// turns it back into ×), two tabs with the same file name get their folder
// name added, and the usual tab gestures apply: middle-click closes,
// right-click for Close Others / to the Right / Saved / All. At the end of
// the strip: + for a new untitled tab and the Recently Closed menu.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, FilePen, History, Locate, Plus, Save, ScrollText, Wand2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ContextMenu, useContextMenu, type ContextMenuEntry } from '@/components/ui/context-menu';
import { Spinner } from '@/components/ui/spinner';
import { IconButton } from '@/components/ui/icon-button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { RecentlyClosed } from './RecentlyClosed';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './WorkspaceEditor.messages';
import type { EditorSnapshot, EditorStore, Tab } from './store';
import { fileIcon } from './fileIcons';
import { basename, dirname } from './paths';

interface Props {
  store: EditorStore;
  snap: EditorSnapshot;
  onRequestClose: (ids: string[]) => void;
  onCopyPath: (path: string, relative: boolean) => void;
  onSaveAs: (id: string) => void;
  onFormat: (id: string) => void;
  onNewUntitled: () => void;
}

export function EditorTabs({ store, snap, onRequestClose, onCopyPath, onSaveAs, onFormat, onNewUntitled }: Props) {
  const m = useMessages(MESSAGES);
  const menu = useContextMenu();
  const stripRef = useRef<HTMLDivElement>(null);
  const { tabs, activeId } = snap;

  const duplicateNames = useMemo(() => {
    const seen = new Map<string, number>();
    for (const t of tabs) seen.set(t.name, (seen.get(t.name) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
  }, [tabs]);

  useEffect(() => {
    const strip = stripRef.current;
    const active = strip?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    // Arrow keys move between tabs: keep focus on the tab that became active.
    if (strip?.contains(document.activeElement) && active && document.activeElement !== active) active.focus();
  }, [activeId]);

  // The usual tablist keys: ←/→ (and Home/End) move, Enter/Space activate,
  // Delete closes.
  const onTabKey = (e: React.KeyboardEvent, tab: Tab) => {
    // Keys on the tab's own × button belong to that button.
    if (e.target !== e.currentTarget) return;
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        store.activate(tab.id);
        break;
      case 'ArrowRight':
      case 'ArrowLeft':
        e.preventDefault();
        store.activateRelative(e.key === 'ArrowRight' ? 1 : -1);
        break;
      case 'Home':
      case 'End': {
        e.preventDefault();
        const target = e.key === 'Home' ? tabs[0] : tabs.at(-1);
        if (target) store.activate(target.id);
        break;
      }
      case 'Delete':
        e.preventDefault();
        onRequestClose([tab.id]);
        break;
    }
  };

  if (tabs.length === 0) return null;

  const entries = (tab: Tab): ContextMenuEntry[] => {
    const ids = tabs.map((t) => t.id);
    const idx = ids.indexOf(tab.id);
    const others = ids.filter((id) => id !== tab.id);
    const right = ids.slice(idx + 1);
    const saved = tabs.filter((t) => !t.dirty).map((t) => t.id);
    const saveAs: ContextMenuEntry = { icon: <Save className="h-3.5 w-3.5" />, label: m('saveAs'), sep: true, onClick: () => onSaveAs(tab.id) };
    const common: ContextMenuEntry[] = [
      { label: m('close'), onClick: () => onRequestClose([tab.id]) },
      { label: m('closeOthers'), disabled: others.length === 0, onClick: () => onRequestClose(others) },
      { label: m('closeRight'), disabled: right.length === 0, onClick: () => onRequestClose(right) },
      { label: m('closeSaved'), disabled: saved.length === 0, onClick: () => store.closeTabs(saved) },
      { label: m('closeAll'), onClick: () => onRequestClose(ids) },
    ];
    const formatEntry: ContextMenuEntry = { icon: <Wand2 className="h-3.5 w-3.5" />, label: m('formatDocument'), onClick: () => onFormat(tab.id) };
    if (tab.kind === 'untitled') return [...common, saveAs, formatEntry];
    const modeEntry: ContextMenuEntry = tab.mode === 'viewer'
      ? { icon: <FilePen className="h-3.5 w-3.5" />, label: m('openInEditor'), sep: true, onClick: () => void store.openInEditor(tab.id) }
      : { icon: <ScrollText className="h-3.5 w-3.5" />, label: m('openInViewer'), sep: true, onClick: () => void store.openInViewer(tab.path) };
    return [
      ...common,
      ...(tab.mode === 'viewer' ? [] : [{ ...saveAs }, formatEntry]),
      modeEntry,
      { icon: <Copy className="h-3.5 w-3.5" />, label: m('copyPath'), onClick: () => onCopyPath(tab.path, false) },
      { icon: <Copy className="h-3.5 w-3.5" />, label: m('copyRelativePath'), onClick: () => onCopyPath(tab.path, true) },
      { icon: <Locate className="h-3.5 w-3.5" />, label: m('revealInExplorer'), onClick: () => store.select(tab.path) },
    ];
  };

  return (
    <div className="flex h-ctl shrink-0 items-stretch border-b border-line bg-chrome">
    <div
      ref={stripRef}
      role="tablist"
      tabIndex={-1}
      onDoubleClick={(e) => { if (e.target === e.currentTarget) onNewUntitled(); }}
      className="flex min-w-0 flex-1 items-stretch overflow-x-auto no-scrollbar"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const Icon = fileIcon(tab.path);
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            data-active={active || undefined}
            title={tab.kind === 'untitled' ? `${tab.name} — ${m('untitledHint')}` : tab.path}
            tabIndex={active ? 0 : -1}
            onClick={() => store.activate(tab.id)}
            onKeyDown={(e) => onTabKey(e, tab)}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onRequestClose([tab.id]); } }}
            onContextMenu={(e) => menu.open(e, entries(tab))}
            className={cn(
              'group relative flex max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-line pl-3 pr-1.5 text-xs transition-colors duration-fast',
              active ? 'bg-bg text-fg' : 'text-fg-mute hover:bg-bg/60 hover:text-fg',
            )}
          >
            {/* Accent rule on the active tab, like VS Code's top border. */}
            {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-acc" />}
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className={cn('truncate', tab.external === 'deleted' && 'line-through')}>{tab.name}</span>
            {duplicateNames.has(tab.name) && (
              <span className="truncate text-[11px] text-fg-mute">{basename(dirname(tab.path))}</span>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRequestClose([tab.id]); }}
              title={m('close')}
              aria-label={`${m('close')} ${tab.name}`}
              className={cn(
                'grid h-5 w-5 shrink-0 place-items-center rounded-xs text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg',
                'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
                !active && !tab.dirty && !tab.saving && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              )}
            >
              {tab.saving
                ? <Spinner size="xs" label={m('saving')} />
                : tab.dirty
                  ? (
                    <>
                      <span className="h-2 w-2 rounded-full bg-current group-hover:hidden" aria-label={m('unsaved')} />
                      <X className="hidden h-3 w-3 group-hover:inline-block" />
                    </>
                  )
                  : <X className="h-3 w-3" />}
            </button>
          </div>
        );
      })}
    </div>
      <div className="flex shrink-0 items-center gap-0.5 border-l border-line px-1">
        <IconButton size="xs" title={m('newTextFile')} aria-label={m('newTextFile')} onClick={onNewUntitled}>
          <Plus className="h-3.5 w-3.5" />
        </IconButton>
        {snap.closed.length > 0 && <ClosedMenu store={store} snap={snap} />}
      </div>
      {menu.state && <ContextMenu state={menu.state} onClose={menu.close} width={230} />}
    </div>
  );
}

function ClosedMenu({ store, snap }: { store: EditorStore; snap: EditorSnapshot }) {
  const m = useMessages(MESSAGES);
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        title={m('recentlyClosed')}
        aria-label={m('recentlyClosed')}
        className="grid h-6 w-6 place-items-center rounded-sm text-fg-mute transition-colors hover:bg-acc hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
      >
        <History className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-1.5">
        <RecentlyClosed store={store} closed={snap.closed} limit={15} onDone={() => setOpen(false)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
