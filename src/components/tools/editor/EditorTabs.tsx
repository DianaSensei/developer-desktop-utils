// The open-file tab strip. A dirty tab shows a dot where its × sits (hover
// turns it back into ×), two tabs with the same file name get their folder
// name added, and the usual tab gestures apply: middle-click closes,
// right-click for Close Others / to the Right / Saved / All.

import { useEffect, useMemo, useRef } from 'react';
import { Copy, Locate, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ContextMenu, useContextMenu, type ContextMenuEntry } from '@/components/ui/context-menu';
import { Spinner } from '@/components/ui/spinner';
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
}

export function EditorTabs({ store, snap, onRequestClose, onCopyPath }: Props) {
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
    stripRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activeId]);

  if (tabs.length === 0) return null;

  const entries = (tab: Tab): ContextMenuEntry[] => {
    const ids = tabs.map((t) => t.id);
    const idx = ids.indexOf(tab.id);
    const others = ids.filter((id) => id !== tab.id);
    const right = ids.slice(idx + 1);
    const saved = tabs.filter((t) => !t.dirty).map((t) => t.id);
    return [
      { label: m('close'), onClick: () => onRequestClose([tab.id]) },
      { label: m('closeOthers'), disabled: others.length === 0, onClick: () => onRequestClose(others) },
      { label: m('closeRight'), disabled: right.length === 0, onClick: () => onRequestClose(right) },
      { label: m('closeSaved'), disabled: saved.length === 0, onClick: () => store.closeTabs(saved) },
      { label: m('closeAll'), onClick: () => onRequestClose(ids) },
      { icon: <Copy className="h-3.5 w-3.5" />, label: m('copyPath'), sep: true, onClick: () => onCopyPath(tab.path, false) },
      { icon: <Copy className="h-3.5 w-3.5" />, label: m('copyRelativePath'), onClick: () => onCopyPath(tab.path, true) },
      { icon: <Locate className="h-3.5 w-3.5" />, label: m('revealInExplorer'), onClick: () => store.select(tab.path) },
    ];
  };

  return (
    <div
      ref={stripRef}
      role="tablist"
      className="flex h-ctl shrink-0 items-stretch overflow-x-auto no-scrollbar border-b border-line bg-chrome"
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
            title={tab.path}
            tabIndex={active ? 0 : -1}
            onClick={() => store.activate(tab.id)}
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
      {menu.state && <ContextMenu state={menu.state} onClose={menu.close} width={230} />}
    </div>
  );
}
