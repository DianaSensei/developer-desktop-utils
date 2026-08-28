// Open-request tab strip, à la Bruno — every request you open gets a tab with a
// method-colored label and a close button. The right cluster holds the
// environment selector, history, and the request/response layout toggle.

import { Clock, Columns2, Folder, Globe, Plus, Rows2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  onRuntimeVars: () => void;
  // The merged, source-tagged variable set (collection/env/vault/runtime) for
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
  store, runs, direction, onToggleDirection, onNewRequest, onManageEnvironments, onManageVault, onRuntimeVars, resolvedVars,
  historyActive, onSelectRequest, onOpenHistory, onCloseHistory,
}: Props) {
  const { openRequests, activeRequestId } = store;
  const collection = activeCollection(store);
  const globalEnvs = store.environments.filter((e) => !e.collectionId);
  const collectionEnvs = store.environments.filter((e) => e.collectionId === store.activeCollectionId);

  return (
    <div className="flex items-stretch border-b border-line bg-bg-2/10">
      {/* tabs (scrollable) + new */}
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto no-scrollbar">
        {openRequests.map((req) => {
          const active = !historyActive && req.id === activeRequestId;
          const failed = tabFailed(runs[req.id]);
          return (
            <div
              key={req.id}
              onClick={() => onSelectRequest(req.id)}
              title={failed ? `${req.method} ${req.name} — last send failed` : `${req.method} ${req.name}`}
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
              {failed && <StatusDot tone="error" size="xs" className="shrink-0" />}
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
      <div className="flex shrink-0 items-center gap-1 border-l border-line py-1 pl-2 pr-1.5 text-fg-mute">
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
          <SelectTrigger
            className="h-ctl w-28 text-xs rounded-sm"
            title="Collection environment — scoped to this collection, follows whichever collection the active request belongs to"
          >
            <span className="flex min-w-0 items-center gap-1">
              <Folder className="h-3 w-3 shrink-0 opacity-70" />
              <SelectValue placeholder="No Environment" />
            </span>
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
            className="h-ctl w-28 text-xs rounded-sm"
            title="Global environment — applies across every collection, unaffected by which one is active"
          >
            <span className="flex min-w-0 items-center gap-1">
              <Globe className="h-3 w-3 shrink-0 opacity-70" />
              <SelectValue placeholder="No Global Env" />
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Global Env</SelectItem>
            {globalEnvs.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {/* One entry point for "see everything, then go edit it" — no
            separate Vault/gear icon next to this that opened one of the exact
            same destinations: EnvQuickView's own footer already links to
            Environments, Vault, and Runtime Variables, so a second button
            here for any one of them was two controls for one destination. */}
        <EnvQuickView
          collectionEnv={store.activeCollectionEnv}
          globalEnv={store.activeGlobalEnv}
          resolvedVars={resolvedVars}
          onManageEnvironments={onManageEnvironments}
          onManageVault={onManageVault}
          onRuntimeVars={onRuntimeVars}
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
    </div>
  );
}
