// Workspace bar: workspace picker plus the active workspace's tool tabs.
// Rendered in the custom titlebar and in the web header; `size` sets the
// height.
//
// Tabs are documents, not mode switches, so the active tab uses the surface
// color (`--card`); the accent is reserved for mode selection (group tabs,
// Segmented).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, ChevronDown, ChevronsUpDown, Layers, Pencil, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MOD_KEY, IS_MAC } from '@/lib/platform';
import { useLocale } from '@/contexts/LocaleContext';
import { useWorkspaces, workspaceLabel } from '@/contexts/WorkspaceContext';
import { useLiveConnections } from '@/lib/liveConnections';
import { MAX_WORKSPACES } from '@/lib/workspaces';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ContextMenu, useContextMenu } from '@/components/ui/context-menu';
import { requestCommandPalette } from '@/components/CommandPalette';

export interface WorkspaceBarProps {
  /** `titlebar`: the 38px custom titlebar; `header`: the 50px web header. */
  size?: 'titlebar' | 'header';
  /**
   * Shown when there is nothing to switch between (fewer than two tabs and
   * one workspace): the active tool's identity.
   */
  fallback?: ReactNode;
}

/** True when the bar shows tabs (rather than its `fallback`). */
export function useWorkspaceBarVisible() {
  const { workspaces, tabs } = useWorkspaces();
  return tabs.length >= 2 || workspaces.length >= 2;
}

const shortcut = (keys: string) => (IS_MAC ? `${MOD_KEY}${keys}` : `${MOD_KEY}+${keys}`);

export function WorkspaceBar({ size = 'header', fallback = null }: WorkspaceBarProps) {
  const {
    workspaces, active, tabs, activeToolId, openTool, closeTool, closeOtherTools, moveTool,
  } = useWorkspaces();
  const { t } = useLocale();
  const liveIds = useLiveConnections();
  const menu = useContextMenu();
  const visible = useWorkspaceBarVisible();
  const listRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // Keep the active tab in view when the tabs overflow. Scrolls only the
  // tab list: `scrollIntoView` would also scroll every overflow:hidden
  // ancestor (the web header pushed <main> sideways by ~800px).
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !tab) return;
    const left = tab.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft) list.scrollLeft = left;
    else if (left + tab.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = left + tab.offsetWidth - list.clientWidth;
    }
  }, [activeToolId, tabs.length]);

  // Which edges have hidden tabs, for the fades and the "all tabs" menu.
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow((o) => (o.left === left && o.right === right ? o : { left, right }));
  }, []);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', measure); ro?.disconnect(); };
  }, [measure, tabs.length, visible]);

  if (!visible) return <>{fallback}</>;

  const compact = size === 'titlebar';
  const h = compact ? 'h-6' : 'h-ctl';

  // Left/right arrows move between tabs (ARIA tablist pattern).
  function onTabKeyDown(e: ReactKeyboardEvent<HTMLDivElement>, index: number) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openTool(tabs[index].featureId);
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const nodes = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
      const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      nodes?.[next]?.focus();
    }
  }

  return (
    // The titlebar is a "deep" drag region; tabs are divs, so they must
    // opt out explicitly or pressing a tab would drag the window.
    <div className="flex min-w-0 items-center gap-1" data-tauri-drag-region="false">
      <WorkspaceSwitcher compact={compact} />
      <span className="mx-0.5 h-4 w-px shrink-0 bg-line" aria-hidden />
      <div className="relative flex min-w-0 items-center">
      <div
        ref={listRef}
        role="tablist"
        aria-label={t('shell.workspace.tabsLabel', { name: workspaceLabel(active, workspaces.indexOf(active), (n) => t('shell.workspace.defaultName', { n })) })}
        className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto"
        // A plain mouse wheel only scrolls vertically; turn it sideways so
        // hidden tabs are reachable without a trackpad.
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {tabs.map((tool, i) => {
          const Icon = tool.icon;
          const on = tool.featureId === activeToolId;
          // On a non-tab screen (Settings), the first tab takes Tab focus.
          const focusable = on || (i === 0 && !tabs.some((x) => x.featureId === activeToolId));
          const live = liveIds.includes(tool.featureId);
          const hint = i < 8 ? ` (${shortcut(String(i + 1))})` : '';
          return (
            <div
              key={tool.featureId}
              role="tab"
              tabIndex={focusable ? 0 : -1}
              aria-selected={on}
              title={`${tool.label}${hint}`}
              draggable
              onDragStart={(e) => {
                setDragId(tool.featureId);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (dragId && dragId !== tool.featureId) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                // Index in the workspace's full list, which includes hidden
                // (disabled) tools, not in the visible tabs.
                if (dragId) moveTool(dragId, active.toolIds.indexOf(tool.featureId));
                setDragId(null);
              }}
              onDragEnd={() => setDragId(null)}
              onClick={() => openTool(tool.featureId)}
              // Middle click closes the tab, as in browsers.
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTool(tool.featureId);
                }
              }}
              onContextMenu={(e) =>
                menu.open(e, [
                  { icon: <X className="h-3.5 w-3.5" />, label: t('shell.workspace.closeTab', { label: tool.label }), onClick: () => closeTool(tool.featureId) },
                  { label: t('shell.workspace.closeOthers'), onClick: () => closeOtherTools(tool.featureId), disabled: tabs.length < 2 },
                ])
              }
              onKeyDown={(e) => onTabKeyDown(e, i)}
              className={cn(
                'group inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-sm border text-xs leading-none transition-colors',
                h,
                compact ? 'px-2' : 'px-2.5',
                'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
                on
                  ? 'border-line bg-card font-medium text-fg'
                  : 'border-transparent text-fg-mute hover:bg-card/60 hover:text-fg',
                dragId === tool.featureId && 'opacity-50',
              )}
            >
              {live && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" title={t('shell.titlebar.running')} />}
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[10rem] truncate">{tool.label}</span>
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTool(tool.featureId);
                }}
                aria-label={t('shell.workspace.closeTab', { label: tool.label })}
                title={t('shell.workspace.closeTab', { label: tool.label })}
                className={cn(
                  '-mr-1 grid h-4 w-4 shrink-0 place-items-center rounded-xs text-fg-mute transition-opacity hover:bg-fg/10 hover:text-fg',
                  // The active tab always shows its close button.
                  on ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                )}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      {/* Fades mark the edge where tabs are hidden. */}
      {overflow.left && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-chrome to-transparent" />
      )}
      {overflow.right && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-chrome to-transparent" />
      )}
      </div>
      {(overflow.left || overflow.right) && (
        <DropdownMenu className="shrink-0">
          <DropdownMenuTrigger
            title={t('shell.workspace.allTabs', { n: tabs.length })}
            aria-label={t('shell.workspace.allTabs', { n: tabs.length })}
            className={cn(
              'grid place-items-center rounded-sm text-fg-mute transition-colors hover:bg-card/60 hover:text-fg',
              'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
              compact ? 'h-6 w-6' : 'h-ctl w-ctl',
            )}
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>{t('shell.workspace.allTabs', { n: tabs.length })}</DropdownMenuLabel>
            {tabs.map((tool, i) => {
              const Icon = tool.icon;
              return (
                <DropdownMenuItem
                  key={tool.featureId}
                  active={tool.featureId === activeToolId}
                  onClick={() => openTool(tool.featureId)}
                  icon={<Icon className="h-3.5 w-3.5 shrink-0" />}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{tool.label}</span>
                    {i < 9 && (
                      <span className="shrink-0 font-mono text-[11px] text-fg-mute">
                        {shortcut(String(i === tabs.length - 1 && i >= 8 ? 9 : i + 1))}
                      </span>
                    )}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button
        type="button"
        onClick={requestCommandPalette}
        title={t('shell.workspace.openTool', { shortcut: shortcut('K') })}
        aria-label={t('shell.workspace.openTool', { shortcut: shortcut('K') })}
        className={cn(
          'grid shrink-0 place-items-center rounded-sm text-fg-mute transition-colors hover:bg-card/60 hover:text-fg',
          'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
          compact ? 'h-6 w-6' : 'h-ctl w-ctl',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {menu.state && <ContextMenu state={menu.state} onClose={menu.close} />}
    </div>
  );
}

function WorkspaceSwitcher({ compact }: { compact: boolean }) {
  const { workspaces, active, switchWorkspace, deleteWorkspace, promptCreateWorkspace, promptRenameWorkspace } =
    useWorkspaces();
  const { t } = useLocale();
  const nameOf = (i: number) => workspaceLabel(workspaces[i], i, (n) => t('shell.workspace.defaultName', { n }));
  const activeIndex = workspaces.indexOf(active);
  const activeName = nameOf(activeIndex);

  return (
    <DropdownMenu className="shrink-0">
      <DropdownMenuTrigger
        title={t('shell.workspace.switcher', { name: activeName })}
        aria-label={t('shell.workspace.switcher', { name: activeName })}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-sm px-2 text-xs font-semibold leading-none text-fg transition-colors hover:bg-card/60',
          'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
          compact ? 'h-6' : 'h-ctl',
        )}
      >
        <Layers className="h-3.5 w-3.5 shrink-0 text-acc" />
        <span className="max-w-[9rem] truncate">{activeName}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-fg-mute" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>{t('shell.workspace.menuLabel')}</DropdownMenuLabel>
        {workspaces.map((ws, i) => (
          <DropdownMenuItem
            key={ws.id}
            active={ws.id === active.id}
            onClick={() => switchWorkspace(ws.id)}
            icon={<Check className={cn('h-3.5 w-3.5 shrink-0', ws.id === active.id ? 'opacity-100' : 'opacity-0')} />}
          >
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{nameOf(i)}</span>
              <span className="shrink-0 text-[11px] text-fg-mute">
                {t('shell.workspace.tabCount', { n: ws.toolIds.length })}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-fg-mute">
                {IS_MAC ? `${MOD_KEY}⌥${i + 1}` : `${MOD_KEY}+Alt+${i + 1}`}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={promptCreateWorkspace}
          disabled={workspaces.length >= MAX_WORKSPACES}
        >
          {t('shell.workspace.new')}
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => promptRenameWorkspace(active.id)}>
          {t('shell.workspace.rename')}
        </DropdownMenuItem>
        {workspaces.length > 1 && (
          <DropdownMenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => deleteWorkspace(active.id)}>
            {t('shell.workspace.delete')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
