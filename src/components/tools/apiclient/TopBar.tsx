// Bruno-style top toolbar for the workbench: shows the active collection name on
// the left and the environment selector (+ manage) on the right.

import { Box, Settings2 } from 'lucide-react';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { ApiStore } from './store';
import type { Collection, TreeItem } from './types';

interface Props {
  store: ApiStore;
  onManageEnvironments: () => void;
}

function containsRequest(items: TreeItem[], id: string): boolean {
  return items.some((it) => it.type === 'request' ? it.id === id : containsRequest(it.items, id));
}

function activeCollection(store: ApiStore): Collection | null {
  if (store.activeRequestId) {
    const found = store.collections.find((c) => containsRequest(c.items, store.activeRequestId!));
    if (found) return found;
  }
  return store.collections[0] ?? null;
}

export function TopBar({ store, onManageEnvironments }: Props) {
  const collection = activeCollection(store);
  const globalEnvs = store.environments.filter((e) => !e.collectionId);
  const collectionEnvs = store.environments.filter((e) => e.collectionId === store.activeCollectionId);
  return (
    <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <Box className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{collection?.name ?? 'API Client'}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <Select
          value={store.activeEnvId ?? 'none'}
          onValueChange={(v) => store.setActiveEnvId(v === 'none' ? null : v)}
        >
          <SelectTrigger className="h-7 w-44 text-xs"><SelectValue placeholder="No Environment" /></SelectTrigger>
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
        <button
          onClick={onManageEnvironments}
          title="Configure environments"
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
