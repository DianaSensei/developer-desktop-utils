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
import { methodColor, methodShort } from './method-color';
import { EnvQuickView } from './EnvQuickView';
import type { ApiStore } from './store';
import type { SplitDirection } from './ApiClient';
import type { ApiResponse, Collection, ResolvedVar, TreeItem } from './types';

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
  historyActive, onSelectRequest, onOpenHistory, onCloseHistory,
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
      { label: 'Close', onClick: () => store.closeTab(id) },
      { label: 'Close Others', disabled: others.length === 0, onClick: () => store.closeTabs(others) },
      { label: 'Close to the Right', disabled: toRight.length === 0, onClick: () => store.closeTabs(toRight) },
      { label: 'Close All', sep: true, onClick: () => store.closeTabs(ids) },
    ];
  };

  return (
    <div className="flex items-stretch border-b border-line bg-bg-2/10">
      {/* tabs (scrollable) + new */}
      {/* Double-click on the empty part of the strip opens a new request —
          the browser-tab-bar gesture; the + button stays for discoverability. */}
      <div className="relative flex min-w-0 flex-1 items-stretch">
      <div
        ref={stripRef}
        onScroll={measureEdges}
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto no-scrollbar"
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
                // scale-in plays once, on the fresh mount a newly-opened tab gets
                // (an already-open tab just being reordered/re-rendered keeps its
                // DOM node by `key`, so it never replays).
                'group relative flex max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-line px-2.5 py-1.5 text-xs transition-colors motion-safe:animate-scale-in',
                active ? 'bg-bg text-fg' : 'text-fg-mute hover:bg-bg/50 hover:text-fg',
              )}
            >
              {/* Always mounted, opacity-crossfaded rather than conditionally
                  rendered — switching the active tab used to snap this bar on/off
                  instantly. */}
              <span className={cn('absolute inset-x-0 top-0 h-0.5 bg-acc transition-opacity duration-base ease-out-soft', active ? 'opacity-100' : 'opacity-0')} />
              <span className={cn('shrink-0 text-[11px] font-bold uppercase', methodColor(req.method))}>
                {methodShort(req.method)}
              </span>
              <span className="truncate">{req.name}</span>
              {/* In flight beats failed: a resend clears the old failure
                  the moment it starts, and the spinner is what tells you
                  which of several tabs is still waiting. */}
              {run?.sending
                ? <Spinner size="xs" className="shrink-0 text-fg-mute" label="Sending" />
                : failed && <StatusDot tone="error" size="xs" className="shrink-0" />}
              {/* The slot keeps its 16px whether or not the × is showing, so a
                  tab's label doesn't reflow the moment the pointer enters it. */}
              <button
                onClick={(e) => { e.stopPropagation(); store.closeTab(req.id); }}
                className={cn(
                  'grid h-4 w-4 shrink-0 place-items-center rounded-sm text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-acc/40',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                )}
                title="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        {historyActive && (
          <div className="group relative flex shrink-0 items-center gap-1.5 border-r border-line bg-bg px-2.5 py-1.5 text-xs text-fg motion-safe:animate-scale-in">
            <span className="absolute inset-x-0 top-0 h-0.5 bg-acc" />
            <Clock className="h-3.5 w-3.5 shrink-0 text-acc-ink" />
            <span>History</span>
            <button
              onClick={onCloseHistory}
              className="grid h-4 w-4 shrink-0 place-items-center rounded-sm text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-acc/40"
              title="Close history"
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

      {/* Pinned outside the scrollable tab strip, not inside it — with many
          tabs open (or a narrower window) the strip scrolls/clips before this
          ever would, and "open a new request" is exactly the one action that
          must never end up scrolled out of reach. */}
      <IconButton onClick={onNewRequest} title="New request" className="h-auto w-auto shrink-0 rounded-none border-l border-line px-2 hover:bg-bg">
        <Plus className="h-4 w-4" />
      </IconButton>

      {/* right cluster: environment · history · layout */}
      {/* py-1 — hàng này dùng items-stretch nên chiều cao thực tế do phần tử cao
          nhất quyết định; SelectTrigger cao đúng h-ctl (34px), không có py thì nó
          CHÍNH LÀ chiều cao cả hàng, khiến pill chạm sát viền trên/dưới toolbar.
          1.5 → 1: đủ để pill không chạm viền, mà thanh tab thấp đi 4px — đây là
          thanh chrome, mọi pixel nó không dùng thì phần response dùng. */}
      {/* max-w-[45%] is what stops the environment cluster from eating the tab
          strip. The strip is `flex-1 min-w-0` (basis 0), so it silently
          absorbed every pixel the row was short while this cluster, at
          `shrink-0` and ~380px wide, never gave any back: at a 1180px window
          the strip measured 267px — two tabs out of eight open. A percentage
          cap rather than a minimum on the strip: it can never push a control
          off the (overflow-hidden) row however narrow the pane gets, and
          above ~1300px there is slack for both, so nothing shrinks at all.
          The two selects already elide, so the cap costs a few characters of
          an environment name and nothing else. */}
      <div className="flex min-w-0 max-w-[45%] shrink items-center gap-1 border-l border-line py-1 pl-2 pr-1.5 text-fg-mute">
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
          {/* h-ctl khớp chiều cao IconButton bên cạnh — bản trước dùng h-8 (32px)
              cạnh IconButton mặc định h-ctl (34px), lệch 2px khiến cả cụm nhìn
              không thẳng hàng. */}
          {/* A <div> wrapper, not <span> — SelectTrigger's own base style
              carries `[&>span]:line-clamp-1` for its direct-child span
              (meant for SelectValue's own rendered span), and nesting it a
              level deeper moves it out of that rule's reach. Radix's
              SelectValue doesn't forward `className` to that span at all (its
              class stays empty however it's called), so truncation is
              re-applied here via `[&>span]` on the div — its span really is
              a direct child (verified against the rendered DOM) — instead of
              on SelectValue itself. Without it, a name too long for w-28
              wraps onto a second line under the icon rather than eliding
              with "…". */}
          <SelectTrigger
            className="h-ctl w-28 min-w-[4.5rem] shrink text-xs rounded-sm"
            title="Collection environment — scoped to this collection, follows whichever collection the active request belongs to"
          >
            <div className="flex min-w-0 items-center gap-1 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate">
              <Folder className="h-3 w-3 shrink-0 opacity-70" />
              <SelectValue placeholder="No Environment" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Environment</SelectItem>
            {collectionEnvs.length > 0 && (
              <SelectGroup>
                <SelectLabel className="text-[11px] uppercase tracking-wide text-fg-mute">{collection?.name ?? 'Collection'}</SelectLabel>
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
            title="Global environment — applies across every collection, unaffected by which one is active"
          >
            <div className="flex min-w-0 items-center gap-1 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate">
              <Globe className="h-3 w-3 shrink-0 opacity-70" />
              <SelectValue placeholder="No Global Env" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Global Env</SelectItem>
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
          title="History"
          className={cn('hover:bg-bg', historyActive && 'text-acc-ink')}
        >
          <Clock className="h-4 w-4" />
        </IconButton>
        <IconButton
          onClick={onToggleDirection}
          title={direction === 'horizontal' ? 'Switch to stacked layout' : 'Switch to side-by-side layout'}
          className="hover:bg-bg"
        >
          {direction === 'horizontal' ? <Rows2 className="h-4 w-4" /> : <Columns2 className="h-4 w-4" />}
        </IconButton>
      </div>
      {menu.state && <ContextMenu state={menu.state} onClose={menu.close} width={180} />}
    </div>
  );
}
