// Request call history (Bruno-style): a list of past sends on the left and the
// selected entry's response on the right. Entries store the full response, so
// they're viewable after the fact.

import { useState } from 'react';
import { Clock, Eraser, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { methodColor } from './method-color';
import { statusColor } from './request';
import { ResponsePanel } from './ResponsePanel';
import { SplitPane } from './SplitPane';
import type { ApiStore } from './store';
import type { HistoryEntry } from './types';

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m > 1 ? 's' : ''} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}

export function HistoryView({ store }: { store: ApiStore }) {
  const { history } = store;
  const [selectedId, setSelectedId] = useState<string | null>(history[0]?.id ?? null);
  const selected = history.find((h) => h.id === selectedId) ?? history[0] ?? null;

  const list = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> History
        </span>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setSelectedId(history[0]?.id ?? null)} title="Jump to latest" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => store.clearHistory()} title="Clear history" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive">
            <Eraser className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {history.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">No requests sent yet.</p>
        ) : (
          history.map((h) => (
            <button
              key={h.id}
              onClick={() => setSelectedId(h.id)}
              className={cn(
                'flex w-full items-center gap-3 border-b px-3 py-2.5 text-left text-xs hover:bg-accent/50',
                selectedId === h.id && 'bg-accent',
              )}
            >
              <span className="w-24 shrink-0 text-muted-foreground">{timeAgo(h.at)}</span>
              <span className={cn('w-12 shrink-0 font-bold uppercase', methodColor(h.method))}>{h.method}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground" title={h.url}>{h.url}</span>
              <span className={cn('shrink-0 font-semibold', h.error ? 'text-destructive' : statusColor(h.status))}>
                {h.error ? 'ERR' : h.status}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SplitPane
        direction="horizontal"
        minPanePx={320}
        first={list}
        second={
          selected ? (
            <HistoryDetail entry={selected} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Select a request to view its response.
            </div>
          )
        }
      />
    </div>
  );
}

// Read-only detail for one past send: the request line + headers/body it was
// sent with, then the captured response.
function HistoryDetail({ entry }: { entry: HistoryEntry }) {
  const req = entry.request;
  const headers = (req?.headers ?? []).filter((h) => h.enabled && h.key);
  const hasBody = !!(req && req.body.mode !== 'none' && (req.body.raw || req.body.form.length));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* request line */}
      <div className="shrink-0 border-b">
        <div className="flex items-center gap-2 px-3 py-2 text-xs">
          <span className={cn('shrink-0 font-bold uppercase', methodColor(entry.method))}>{entry.method}</span>
          <span className="min-w-0 flex-1 truncate font-mono" title={entry.url}>{entry.url}</span>
          <span className="shrink-0 text-muted-foreground">{new Date(entry.at).toLocaleString()}</span>
        </div>
        {(headers.length > 0 || hasBody) && (
          <details className="border-t px-3 py-1.5 text-xs">
            <summary className="cursor-pointer select-none text-[11px] font-medium text-muted-foreground">Request details</summary>
            {headers.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {headers.map((h) => (
                  <div key={h.id} className="flex gap-3">
                    <span className="w-40 shrink-0 truncate font-medium text-muted-foreground">{h.key}</span>
                    <span className="min-w-0 break-words font-mono">{h.value}</span>
                  </div>
                ))}
              </div>
            )}
            {hasBody && req && (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[11px]">
                {req.body.raw || req.body.form.map((f) => `${f.key}=${f.value}`).join('\n')}
              </pre>
            )}
          </details>
        )}
      </div>

      {/* response */}
      {entry.response || entry.error ? (
        <ResponsePanel
          response={entry.response ?? null}
          sending={false}
          error={entry.error ?? null}
          tests={entry.tests ?? []}
          logs={entry.logs ?? []}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
          No response was captured for this entry.
        </div>
      )}
    </div>
  );
}
