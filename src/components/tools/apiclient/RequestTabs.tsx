// Open-request tab strip, à la Bruno — every request you open gets a tab with a
// method-colored label and a close button. Includes the request/response layout
// toggle on the right.

import { Columns2, Rows2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { methodColor } from './method-color';
import type { ApiStore } from './store';
import type { SplitDirection } from './ApiClient';

interface Props {
  store: ApiStore;
  direction: SplitDirection;
  onToggleDirection: () => void;
}

export function RequestTabs({ store, direction, onToggleDirection }: Props) {
  const { openRequests, activeRequestId } = store;

  return (
    <div className="flex items-stretch border-b bg-muted/30">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {openRequests.map((req) => {
          const active = req.id === activeRequestId;
          return (
            <div
              key={req.id}
              onClick={() => store.setActiveRequestId(req.id)}
              className={cn(
                'group flex max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-b-2 px-3 py-1.5 text-xs transition-colors',
                active ? 'border-b-amber-400 bg-background text-foreground' : 'border-b-transparent text-muted-foreground hover:bg-background/60',
              )}
            >
              <span className={cn('text-[9px] font-bold uppercase', methodColor(req.method))}>{req.method}</span>
              <span className="truncate">{req.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); store.closeTab(req.id); }}
                className={cn(
                  'ml-0.5 rounded p-0.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
                title="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        onClick={onToggleDirection}
        title={direction === 'horizontal' ? 'Switch to stacked layout' : 'Switch to side-by-side layout'}
        className="flex shrink-0 items-center border-l px-2.5 text-muted-foreground hover:bg-background hover:text-foreground"
      >
        {direction === 'horizontal' ? <Rows2 className="h-4 w-4" /> : <Columns2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
