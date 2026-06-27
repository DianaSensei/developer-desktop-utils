import { useState } from 'react';
import { Trash2, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PaneHeader } from '@/components/ui/tool-layout';
import { methodColor } from '../apiclient/method-color';
import type { HttpMethod } from '../apiclient/types';
import type { RequestLogEntry } from './types';

function statusColor(status: number): string {
  if (status >= 500) return 'text-red-600 dark:text-red-400';
  if (status >= 400) return 'text-amber-600 dark:text-amber-400';
  if (status >= 300) return 'text-violet-600 dark:text-violet-400';
  if (status >= 200) return 'text-emerald-600 dark:text-emerald-400';
  return 'text-muted-foreground';
}

interface Props {
  log: RequestLogEntry[];
  onClear: () => void;
  /** Resolve a stub id to its display name (undefined if it no longer exists). */
  stubName?: (id: string) => string | undefined;
  /** Jump to / select a stub in the editor. */
  onSelectStub?: (id: string) => void;
}

export function RequestLog({ log, onClear, stubName, onSelectStub }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = log.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader
        label="Request log"
        hint={log.length ? `${log.length}` : undefined}
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={onClear}
            disabled={!log.length}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Clear
          </Button>
        }
      />

      {log.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
          <Inbox className="h-8 w-8 opacity-40" />
          <p className="text-xs">Incoming requests appear here while the server is running.</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {log.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelectedId(e.id === selectedId ? null : e.id)}
                className={
                  'flex w-full items-center gap-2 border-b border-border/60 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/40 ' +
                  (e.id === selectedId ? 'bg-muted/50' : '')
                }
              >
                <span className={'w-12 shrink-0 font-mono font-medium ' + methodColor(e.method as HttpMethod)}>
                  {e.method}
                </span>
                <span className={'w-9 shrink-0 font-mono font-medium ' + statusColor(e.status)}>{e.status}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                  {e.path}
                  {e.query ? <span className="text-muted-foreground">?{e.query}</span> : null}
                </span>
                {!e.matchedStubId && (
                  <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                    no match
                  </span>
                )}
                <span className="shrink-0 text-[10px] text-muted-foreground">{e.durationMs}ms</span>
              </button>
            ))}
          </div>

          {selected && (
            <div className="max-h-[45%] shrink-0 space-y-2 overflow-y-auto border-t border-border bg-muted/10 p-3 text-xs">
              <Detail label="Time" value={new Date(selected.ts).toLocaleTimeString()} />
              <div className="flex gap-2">
                <span className="w-14 shrink-0 text-muted-foreground">Matched</span>
                {selected.matchedStubId ? (
                  <button
                    type="button"
                    onClick={() => selected.matchedStubId && onSelectStub?.(selected.matchedStubId)}
                    className="truncate text-left font-medium text-primary hover:underline"
                    title="Open this stub"
                  >
                    {stubName?.(selected.matchedStubId) ?? '(deleted stub)'}
                  </button>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">No stub — default response</span>
                )}
              </div>
              {selected.reqHeaders.length > 0 && (
                <div>
                  <div className="mb-0.5 text-muted-foreground">Request headers</div>
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">
                    {selected.reqHeaders.map((h) => `${h.key}: ${h.value}`).join('\n')}
                  </pre>
                </div>
              )}
              {selected.reqBody && (
                <div>
                  <div className="mb-0.5 text-muted-foreground">Request body</div>
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">{selected.reqBody}</pre>
                </div>
              )}
              <div>
                <div className="mb-0.5 text-muted-foreground">Response body</div>
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">{selected.resBody}</pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px]">{value}</span>
    </div>
  );
}
