// Open-request tab strip, à la Bruno — every request you open gets a tab with a
// method-colored label and a close button. The right cluster holds the
// environment selector, history, and the request/response layout toggle.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Columns2, Folder, Globe, Plus, Rows2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ContextMenu, useContextMenu, type ContextMenuEntry } from '@/components/ui/context-menu';
import { Spinner } from '@/components/ui/spinner';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { IconButton } from '@/components/ui/icon-button';
import { StatusDot } from '@/components/ui/status-dot';
import { ToolToolbar } from '@/components/ui/tool-layout';
import { methodColor, methodShort } from './method-color';
import { EnvQuickView } from './EnvQuickView';
import type { ApiStore } from './store';
import type { SplitDirection } from './ApiClient';
import type { ApiResponse, Collection, ResolvedVar, TreeItem } from './types';
import { t } from './i18n';

// The one slice of ApiClient's per-tab RunState a tab actually needs to know
// about — kept as its own shape (rather than importing RunState) so this
// component doesn't reach into ApiClient's internal state type.
export interface TabRunStatus {
  error: string | null;
  response: ApiResponse | null;
  sending: boolean;
}

interface Props {
  store: ApiStore;
  runs: Record<string, TabRunStatus>;
  direction: SplitDirection;
  onToggleDirection: () => void;
  onNewRequest: () => void;
  onManageEnvironments: () => void;
  onManageVault: () => void;
  // The merged, source-tagged variable set (collection/env/vault) for
  // EnvQuickView's glance popover — see ApiClient.tsx's `resolvedVars`.
  resolvedVars: ResolvedVar[];
  historyActive: boolean;
  onSelectRequest: (id: string) => void;
  onOpenHistory: () => void;
  onCloseHistory: () => void;
  // "Reveal in sidebar" button, far right of the strip (Postman-style) — the
  // sidebar already auto-scrolls the active row into view the moment a tab
  // *becomes* active, so this is for jumping back after scrolling the
  // sidebar away on its own, without switching tabs.
  onRevealActive: () => void;
}

// A tab "needs attention" once it has settled on a transport/script error or a
// 4xx/5xx response — not while still in flight, and not for a 3xx (a
// redirect isn't a failure; see request.ts's statusColor, which treats it as
// merely worth noticing, not bad).
function tabFailed(run: TabRunStatus | undefined): boolean {
  if (!run || run.sending) return false;
  if (run.error) return true;
  return !!run.response && run.response.status >= 400;
}

function containsRequest(items: TreeItem[], id: string): boolean {
  return items.some((it) => (it.type === 'request' ? it.id === id : containsRequest(it.items, id)));
}

function activeCollection(store: ApiStore): Collection | null {
  if (store.activeRequestId) {
    const found = store.collections.find((c) => containsRequest(c.items, store.activeRequestId!));
    if (found) return found;
  }
  return store.collections[0] ?? null;
}

export function RequestTabs({
  store, runs, direction, onToggleDirection, onNewRequest, onManageEnvironments, onManageVault, resolvedVars,
  historyActive, onSelectRequest, onOpenHistory, onCloseHistory, onRevealActive,
}: Props) {
  const { openRequests, activeRequestId } = store;
  const collection = activeCollection(store);
  const globalEnvs = store.environments.filter((e) => !e.collectionId);
  const collectionEnvs = store.environments.filter((e) => e.collectionId === store.activeCollectionId);
  const menu = useContextMenu();

  // The strip scrolls (no-scrollbar) once tabs overflow, so a tab activated
  // from the sidebar, History, ⌘P or Ctrl+Tab could sit out of view with
  // nothing on screen saying which one is current. Bring it into view on
  // every activation — `nearest` so the strip doesn't jump when it's
  // already visible.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (historyActive) return;
    stripRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activeRequestId, historyActive]);

  // Whether tabs are hidden off either end. The strip hides its scrollbar
  // (no-scrollbar), so without an edge fade a scrolled-away tab leaves no
  // trace at all — a tab you opened a minute ago simply isn't there, with
  // nothing saying to scroll. The fades are the scrollbar's job, done in a
  // way that costs no height in a 28px strip.
  const [edges, setEdges] = useState({ start: false, end: false });
  const measureEdges = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);
  useEffect(() => {
    measureEdges();
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measureEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureEdges, openRequests.length, historyActive, activeRequestId]);

  // Right-click on a tab — the browser-tab vocabulary everyone already has.
  // Close Others / to the Right go through store.closeTabs in one update so
  // the tab kept stays the active one (see the store for why not N × closeTab).
  const tabEntries = (id: string): ContextMenuEntry[] => {
    const ids = openRequests.map((r) => r.id);
    const idx = ids.indexOf(id);
    const others = ids.filter((t) => t !== id);
    const toRight = ids.slice(idx + 1);
    return [
      { label: t('tabs.close'), onClick: () => store.closeTab(id) },
      { label: t('tabs.closeOthers'), disabled: others.length === 0, onClick: () => store.closeTabs(others) },
      { label: t('tabs.closeRight'), disabled: toRight.length === 0, onClick: () => store.closeTabs(toRight) },
      { label: t('tabs.closeAll'), sep: true, onClick: () => store.closeTabs(ids) },
    ];
  };

  return (
    // ToolToolbar (`header-chrome` = bg-chrome + border-b border-line), not a
    // hand-rolled `bg-bg-2/10` — that was ~10% opacity of an already-pale
    // tone, i.e. functionally transparent, so this bar never read as a real
    // toolbar the way every other tool's ToolToolbar/Sidebar's chrome does.
    // px-0 py-0: this row's own children (the tab strip, the +New/reveal
    // icons, the right cluster) already carry their own padding/dividers —
    // ToolToolbar's default px-4 py-2.5 would double up.
    <ToolToolbar className="flex items-stretch px-0 py-0">
      {/* tabs (scrollable) + new */}
      {/* Double-click on the empty part of the strip opens a new request —
          the browser-tab-bar gesture; the + button stays for discoverability. */}
      <div className="relative flex min-w-0 flex-1 items-stretch">
      <div
        ref={stripRef}
        onScroll={measureEdges}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar px-1.5 py-1"
        onDoubleClick={(e) => { if (e.target === e.currentTarget) onNewRequest(); }}
      >
        {openRequests.map((req) => {
          const run = runs[req.id];
          const active = !historyActive && req.id === activeRequestId;
          const failed = tabFailed(run);
          const tip = [
            `${req.method} ${req.name}${failed ? ' — last send failed' : run?.sending ? ' — sending…' : ''}`,
            req.url,
          ].filter(Boolean).join('\n');
          return (
            <div
              key={req.id}
              data-active={active || undefined}
              onClick={() => onSelectRequest(req.id)}
              // Middle-click closes, as in every browser/editor tab strip.
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); store.closeTab(req.id); } }}
              onContextMenu={(e) => menu.open(e, tabEntries(req.id))}
              title={tip}
              className={cn(
                // scale-in plays once when a tab mounts; reordered tabs keep their
                // DOM node by `key`. The active tab is a filled rounded pill.
                'group relative flex max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors motion-safe:animate-scale-in',
                active ? 'bg-card text-fg shadow-sm' : 'text-fg-mute hover:bg-bg/50 hover:text-fg',
              )}
            >
              <span className={cn('shrink-0 text-[11px] font-bold uppercase', methodColor(req.method))}>
                {methodShort(req.method)}
              </span>
              <span className="truncate">{req.name}</span>
              {/* In flight beats failed: a resend clears the old failure
                  the moment it starts, and the spinner is what tells you
                  which of several tabs is still waiting. */}
              {run?.sending
                ? <Spinner size="xs" className="shrink-0 text-fg-mute" label={t('tabs.sending')} />
                : failed && <StatusDot tone="error" size="xs" className="shrink-0" />}
              {/* The slot keeps its 16px whether or not the × is showing, so a
                  tab's label doesn't reflow the moment the pointer enters it. */}
              <button
                onClick={(e) => { e.stopPropagation(); store.closeTab(req.id); }}
                className={cn(
                  'grid h-4 w-4 shrink-0 place-items-center rounded-sm text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                )}
                title={t('tabs.closeTab')}
                aria-label={t('tabs.closeTab')}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        {historyActive && (
          <div className="group relative flex shrink-0 items-center gap-1.5 rounded-md bg-card px-2.5 py-1.5 text-xs text-fg shadow-sm motion-safe:animate-scale-in">
            <Clock className="h-3.5 w-3.5 shrink-0 text-acc-ink" />
            <span>{t('tabs.history')}</span>
            <button
              onClick={onCloseHistory}
              className="grid h-4 w-4 shrink-0 place-items-center rounded-sm text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
              title={t('tabs.closeHistory')}
                aria-label={t('tabs.closeHistory')}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* pointer-events-none so a fade never eats a click on the tab under it.
          via-bg/80 puts a real opaque stop inside the ramp — a bare
          `from-bg to-transparent` over a surface that is itself ~bg washed
          out nothing at all and read as no affordance. */}
      {edges.start && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-bg via-bg/80 to-transparent" />}
      {edges.end && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-bg via-bg/80 to-transparent" />}
      </div>

      {/* Outside the scrolling tab strip so "new request" is never
          scrolled out of reach. */}
      <IconButton onClick={onNewRequest} title={t('tabs.newRequest')} aria-label={t('tabs.newRequest')} className="h-auto w-auto shrink-0 rounded-none border-l border-line px-2 hover:bg-bg">
        <Plus className="h-4 w-4" />
      </IconButton>

      {/* Reveal the active request in the sidebar tree. The sidebar already
          auto-scrolls to it the moment a tab *becomes* active — this is for
          jumping back after scrolling the sidebar away on its own, without
          switching tabs (which wouldn't re-trigger that on its own, since
          activeRequestId doesn't actually change). Disabled with nothing
          open/History showing rather than hidden, so its position in the
          cluster never shifts. */}
      <IconButton
        onClick={onRevealActive}
        disabled={historyActive || !activeRequestId}
        title={t('tabs.reveal')}
        aria-label={t('tabs.reveal')}
        className="h-auto w-auto shrink-0 rounded-none border-l border-line px-2 hover:bg-bg"
      >
        <Folder className="h-4 w-4" />
      </IconButton>

      {/* right cluster: environment · history · layout */}
      {/* py-1 keeps the 34px selects from touching the toolbar edges. */}
      {/* max-w-[45%] stops this cluster from squeezing the tab strip
          (`flex-1 min-w-0`) to a couple of tabs on narrow windows.
          overflow-x-auto lets it scroll internally once it cannot shrink
          further, so History and the layout toggle stay reachable. */}
      <div className="flex min-w-0 max-w-[45%] shrink items-center gap-1 overflow-x-auto no-scrollbar border-l border-line py-1 pl-2 pr-1.5 text-fg-mute">
        {/* Two independent pickers, not one — a Collection env and a Global
            env can both be active at once (Collection wins on a name
            collision; see EnvQuickView's precedence note). The folder/globe
            glyphs are load-bearing, not decoration: they're what makes the
            two selects self-explanatory at a glance instead of reading as
            duplicates of each other. */}
        <Select
          value={(store.activeCollectionId && store.activeEnvByCollection[store.activeCollectionId]) || 'none'}
          onValueChange={(v) => store.activeCollectionId && store.setActiveCollectionEnv(store.activeCollectionId, v === 'none' ? null : v)}
        >
          {/* h-ctl matches the neighboring IconButton. A <div>, not a <span>:
              SelectTrigger's `[&>span]:line-clamp-1` targets its direct child
              span, and Radix's SelectValue does not forward `className`, so
              truncation is applied here with `[&>span]`. Without it a long
              name wraps onto a second line. */}
          <SelectTrigger
            className="h-ctl w-28 min-w-[4.5rem] shrink text-xs rounded-sm"
            title={t('tabs.collectionEnvHint')}
          >
            <div className="flex min-w-0 items-center gap-1 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate">
              <Folder className="h-3 w-3 shrink-0 opacity-70" />
              <SelectValue placeholder={t('noEnvironment')} />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('noEnvironment')}</SelectItem>
            {collectionEnvs.length > 0 && (
              <SelectGroup>
                <SelectLabel className="text-[11px] uppercase tracking-wide text-fg-mute">{collection?.name ?? t('tabs.collection')}</SelectLabel>
                {collectionEnvs.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        <Select
          value={store.activeGlobalEnvId ?? 'none'}
          onValueChange={(v) => store.setActiveGlobalEnv(v === 'none' ? null : v)}
        >
          <SelectTrigger
            className="h-ctl w-28 min-w-[4.5rem] shrink text-xs rounded-sm"
            title={t('tabs.globalEnvHint')}
          >
            <div className="flex min-w-0 items-center gap-1 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate">
              <Globe className="h-3 w-3 shrink-0 opacity-70" />
              <SelectValue placeholder={t('tabs.noGlobalEnv')} />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('tabs.noGlobalEnv')}</SelectItem>
            {globalEnvs.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {/* One entry point for "see everything, then go edit it" — no
            separate Vault/gear icon next to this that opened one of the exact
            same destinations: EnvQuickView's own footer already links to
            Environments and Vault, so a second button here for either was
            two controls for one destination. */}
        <EnvQuickView
          collectionEnv={store.activeCollectionEnv}
          globalEnv={store.activeGlobalEnv}
          resolvedVars={resolvedVars}
          onManageEnvironments={onManageEnvironments}
          onManageVault={onManageVault}
        />
        <span className="mx-0.5 h-5 w-px bg-line" />
        <IconButton
          onClick={onOpenHistory}
          title={t('tabs.history')}
          aria-label={t('tabs.history')}
          className={cn('hover:bg-bg', historyActive && 'text-acc-ink')}
        >
          <Clock className="h-4 w-4" />
        </IconButton>
        <IconButton
          onClick={onToggleDirection}
          title={direction === 'horizontal' ? t('tabs.stacked') : t('tabs.sideBySide')}
          aria-label={direction === 'horizontal' ? t('tabs.stacked') : t('tabs.sideBySide')}
          className="hover:bg-bg"
        >
          {direction === 'horizontal' ? <Rows2 className="h-4 w-4" /> : <Columns2 className="h-4 w-4" />}
        </IconButton>
      </div>
      {menu.state && <ContextMenu state={menu.state} onClose={menu.close} width={180} />}
    </ToolToolbar>
  );
}
