// Open-request tab strip, à la Bruno — every request you open gets a tab with a
// method-colored label and a close button. The right cluster holds the
// environment selector, history, and the request/response layout toggle.

import { Clock, Columns2, Plus, Rows2, Settings2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { methodColor } from './method-color';
import type { ApiStore } from './store';
import type { SplitDirection } from './ApiClient';
import type { Collection, TreeItem } from './types';

interface Props {
  store: ApiStore;
  direction: SplitDirection;
  onToggleDirection: () => void;
  onNewRequest: () => void;
  onManageEnvironments: () => void;
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
  store, direction, onToggleDirection, onNewRequest, onManageEnvironments,
  historyActive, onSelectRequest, onOpenHistory, onCloseHistory,
}: Props) {
  const { openRequests, activeRequestId } = store;
  const collection = activeCollection(store);
  const globalEnvs = store.environments.filter((e) => !e.collectionId);
  const collectionEnvs = store.environments.filter((e) => e.collectionId === store.activeCollectionId);

  const iconBtn = 'flex shrink-0 items-center px-2.5 transition-colors hover:bg-background hover:text-foreground';

  return (
    <div className="flex items-stretch border-b bg-muted/10">
      {/* tabs (scrollable) + new */}
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto no-scrollbar">
        {openRequests.map((req) => {
          const active = !historyActive && req.id === activeRequestId;
          return (
            <div
              key={req.id}
              onClick={() => onSelectRequest(req.id)}
              className={cn(
                'group relative flex max-w-[200px] shrink-0 cursor-pointer items-center gap-2 border-r px-3 py-2 text-xs transition-colors',
                active ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-background/50',
              )}
            >
              {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-amber-400" />}
              <span className={cn('text-[10px] font-bold uppercase', methodColor(req.method))}>{req.method}</span>
              <span className="truncate">{req.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); store.closeTab(req.id); }}
                className={cn(
                  'ml-1 rounded p-0.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
                title="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        {historyActive && (
          <div className="group relative flex shrink-0 items-center gap-2 border-r bg-background px-3 py-2 text-xs text-foreground">
            <span className="absolute inset-x-0 top-0 h-0.5 bg-amber-400" />
            <Clock className="h-3.5 w-3.5 text-amber-500" />
            <span>History</span>
            <button onClick={onCloseHistory} className="ml-1 rounded p-0.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground" title="Close history">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <button onClick={onNewRequest} title="New request" className={cn(iconBtn, 'text-muted-foreground')}>
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* right cluster: environment · history · layout */}
      <div className="flex shrink-0 items-center gap-1 border-l pl-2 pr-1.5 text-muted-foreground">
        <Select
          value={store.activeEnvId ?? 'none'}
          onValueChange={(v) => store.setActiveEnvId(v === 'none' ? null : v)}
        >
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="No Environment" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Environment</SelectItem>
            {collectionEnvs.length > 0 && (
              <SelectGroup>
                <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">{collection?.name ?? 'Collection'}</SelectLabel>
                {collectionEnvs.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectGroup>
            )}
            {globalEnvs.length > 0 && (
              <SelectGroup>
                <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Global</SelectLabel>
                {globalEnvs.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        <button onClick={onManageEnvironments} title="Configure environments" className="rounded p-1.5 transition-colors hover:bg-background hover:text-foreground">
          <Settings2 className="h-4 w-4" />
        </button>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <button
          onClick={onOpenHistory}
          title="History"
          className={cn('rounded p-1.5 transition-colors hover:bg-background hover:text-foreground', historyActive && 'text-amber-500')}
        >
          <Clock className="h-4 w-4" />
        </button>
        <button
          onClick={onToggleDirection}
          title={direction === 'horizontal' ? 'Switch to stacked layout' : 'Switch to side-by-side layout'}
          className="rounded p-1.5 transition-colors hover:bg-background hover:text-foreground"
        >
          {direction === 'horizontal' ? <Rows2 className="h-4 w-4" /> : <Columns2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
