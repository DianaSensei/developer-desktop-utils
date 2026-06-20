// Open-request tab strip, à la Bruno — every request you open gets a tab with a
// method-colored label and a close button. Includes the request/response layout
// toggle on the right.

import { Clock, Columns2, Plus, Rows2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { methodColor } from './method-color';
import type { ApiStore } from './store';
import type { SplitDirection } from './ApiClient';

interface Props {
  store: ApiStore;
  direction: SplitDirection;
  onToggleDirection: () => void;
  onNewRequest: () => void;
  historyActive: boolean;
  onSelectRequest: (id: string) => void;
  onOpenHistory: () => void;
  onCloseHistory: () => void;
}

export function RequestTabs({
  store, direction, onToggleDirection, onNewRequest, historyActive, onSelectRequest, onOpenHistory, onCloseHistory,
}: Props) {
  const { openRequests, activeRequestId } = store;

  return (
    <div className="flex items-stretch border-b bg-muted/20">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
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
        <button
          onClick={onNewRequest}
          title="New request"
          className="flex shrink-0 items-center px-2.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <button
        onClick={onOpenHistory}
        title="History"
        className={cn(
          'flex shrink-0 items-center border-l px-2.5 hover:bg-background hover:text-foreground',
          historyActive ? 'text-amber-500' : 'text-muted-foreground',
        )}
      >
        <Clock className="h-4 w-4" />
      </button>
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
