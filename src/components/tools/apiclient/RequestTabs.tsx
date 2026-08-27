// Open-request tab strip, à la Bruno — every request you open gets a tab with a
// method-colored label and a close button. The right cluster holds the
// environment selector, history, and the request/response layout toggle.

import { AlertTriangle, Clock, Columns2, KeyRound, Plus, Rows2, Settings2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { IconButton } from '@/components/ui/icon-button';
import { methodColor, methodShort } from './method-color';
import type { ApiStore } from './store';
import type { SplitDirection } from './ApiClient';
import type { Collection, TreeItem } from './types';

interface Props {
  store: ApiStore;
  direction: SplitDirection;
  onToggleDirection: () => void;
  onNewRequest: () => void;
  onManageEnvironments: () => void;
  onManageVault: () => void;
  historyActive: boolean;
  onSelectRequest: (id: string) => void;
  onOpenHistory: () => void;
  onCloseHistory: () => void;
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
  store, direction, onToggleDirection, onNewRequest, onManageEnvironments, onManageVault,
  historyActive, onSelectRequest, onOpenHistory, onCloseHistory,
}: Props) {
  const { openRequests, activeRequestId } = store;
  const collection = activeCollection(store);
  const globalEnvs = store.environments.filter((e) => !e.collectionId);
  const collectionEnvs = store.environments.filter((e) => e.collectionId === store.activeCollectionId);
  // Selected but scoped to a different collection than the one open right now
  // — store.activeEnv resolves to null in this case (see store.ts), so surface
  // it instead of letting the picker silently show "No Environment".
  const mismatchedEnv = store.activeEnvMismatched ? store.selectedEnv : null;

  return (
    <div className="flex items-stretch border-b border-line bg-bg-2/10">
      {/* tabs (scrollable) + new */}
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto no-scrollbar">
        {openRequests.map((req) => {
          const active = !historyActive && req.id === activeRequestId;
          return (
            <div
              key={req.id}
              onClick={() => onSelectRequest(req.id)}
              title={`${req.method} ${req.name}`}
              className={cn(
                'group relative flex max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-line px-2.5 py-1.5 text-xs transition-colors',
                active ? 'bg-bg text-fg' : 'text-fg-mute hover:bg-bg/50 hover:text-fg',
              )}
            >
              {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-acc" />}
              <span className={cn('shrink-0 text-[11px] font-bold uppercase', methodColor(req.method))}>
                {methodShort(req.method)}
              </span>
              <span className="truncate">{req.name}</span>
              {/* The slot keeps its 16px whether or not the × is showing, so a
                  tab's label doesn't reflow the moment the pointer enters it. */}
              <button
                onClick={(e) => { e.stopPropagation(); store.closeTab(req.id); }}
                className={cn(
                  'grid h-4 w-4 shrink-0 place-items-center rounded-sm text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acc/40',
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
          <div className="group relative flex shrink-0 items-center gap-1.5 border-r border-line bg-bg px-2.5 py-1.5 text-xs text-fg">
            <span className="absolute inset-x-0 top-0 h-0.5 bg-acc" />
            <Clock className="h-3.5 w-3.5 shrink-0 text-acc-ink" />
            <span>History</span>
            <button
              onClick={onCloseHistory}
              className="grid h-4 w-4 shrink-0 place-items-center rounded-sm text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acc/40"
              title="Close history"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <IconButton onClick={onNewRequest} title="New request" className="h-auto w-auto shrink-0 rounded-none px-2 hover:bg-bg">
          <Plus className="h-4 w-4" />
        </IconButton>
      </div>

      {/* right cluster: environment · history · layout */}
      {/* py-1 — hàng này dùng items-stretch nên chiều cao thực tế do phần tử cao
          nhất quyết định; SelectTrigger cao đúng h-ctl (34px), không có py thì nó
          CHÍNH LÀ chiều cao cả hàng, khiến pill chạm sát viền trên/dưới toolbar.
          1.5 → 1: đủ để pill không chạm viền, mà thanh tab thấp đi 4px — đây là
          thanh chrome, mọi pixel nó không dùng thì phần response dùng. */}
      <div className="flex shrink-0 items-center gap-0.5 border-l border-line py-1 pl-2 pr-1.5 text-fg-mute">
        {mismatchedEnv && (
          <span
            title={`"${mismatchedEnv.name}" belongs to another collection and is not applied here — its variables won't be substituted into this request. Pick an environment from this collection or Global, or switch back to that collection.`}
          >
            <AlertTriangle className="h-3.5 w-3.5 text-warn" />
          </span>
        )}
        <Select
          value={store.activeEnvId ?? 'none'}
          onValueChange={(v) => store.setActiveEnvId(v === 'none' ? null : v)}
        >
          {/* h-ctl khớp chiều cao IconButton bên cạnh — bản trước dùng h-8 (32px)
              cạnh IconButton mặc định h-ctl (34px), lệch 2px khiến cả cụm nhìn
              không thẳng hàng. */}
          <SelectTrigger className="h-ctl w-40 text-xs rounded-sm"><SelectValue placeholder="No Environment" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Environment</SelectItem>
            {collectionEnvs.length > 0 && (
              <SelectGroup>
                <SelectLabel className="text-[11px] uppercase tracking-wide text-fg-mute">{collection?.name ?? 'Collection'}</SelectLabel>
                {collectionEnvs.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectGroup>
            )}
            {globalEnvs.length > 0 && (
              <SelectGroup>
                <SelectLabel className="text-[11px] uppercase tracking-wide text-fg-mute">Global</SelectLabel>
                {globalEnvs.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectGroup>
            )}
            {mismatchedEnv && (
              <SelectGroup>
                <SelectLabel className="text-[11px] uppercase tracking-wide text-fg-mute">Inactive here</SelectLabel>
                <SelectItem value={mismatchedEnv.id}>{mismatchedEnv.name} (other collection)</SelectItem>
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        <IconButton onClick={onManageEnvironments} title="Configure environments" className="hover:bg-bg">
          <Settings2 className="h-4 w-4" />
        </IconButton>
        <span className="mx-0.5 h-5 w-px bg-line" />
        <IconButton onClick={onManageVault} title="Vault (local secrets)" className="hover:bg-bg">
          <KeyRound className="h-4 w-4" />
        </IconButton>
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
