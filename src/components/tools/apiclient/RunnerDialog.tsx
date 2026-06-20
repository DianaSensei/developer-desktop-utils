// Collection/folder Runner: sends every request under the chosen node in order
// and shows a pass/fail summary (Bruno's runner).

import { useState } from 'react';
import { Check, Loader2, Play, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { methodColor } from './method-color';
import { statusColor } from './request';
import type { ExecResult } from './engine';
import type { ApiRequest } from './types';

interface RowResult {
  status: number;
  ms: number;
  passed: number;
  total: number;
  error?: string | null;
}

interface Props {
  title: string;
  requests: ApiRequest[];
  runRequest: (req: ApiRequest) => Promise<ExecResult>;
  open: boolean;
  onClose: () => void;
}

const isOk = (r: RowResult) => !r.error && r.status >= 200 && r.status < 400 && r.passed === r.total;

export function RunnerDialog({ title, requests, runRequest, open, onClose }: Props) {
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [current, setCurrent] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const run = async () => {
    setRunning(true); setDone(false); setResults({});
    for (const req of requests) {
      setCurrent(req.id);
      try {
        const r = await runRequest(req);
        const passed = r.tests.filter((t) => t.passed).length;
        setResults((m) => ({ ...m, [req.id]: { status: r.response?.status ?? 0, ms: r.response?.timeMs ?? 0, passed, total: r.tests.length, error: r.error } }));
      } catch (e) {
        setResults((m) => ({ ...m, [req.id]: { status: 0, ms: 0, passed: 0, total: 0, error: (e as Error).message } }));
      }
    }
    setCurrent(null); setRunning(false); setDone(true);
  };

  const ran = Object.values(results);
  const okCount = ran.filter(isOk).length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[70vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center justify-between">
            <span>Run — <span className="font-normal text-muted-foreground">{title}</span></span>
            {done && <span className={cn('text-xs font-semibold', okCount === requests.length ? 'text-emerald-500' : 'text-destructive')}>{okCount}/{requests.length} passed</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b px-4 py-2">
          <Button size="sm" onClick={run} disabled={running || requests.length === 0} className="h-7 gap-1.5">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {running ? 'Running…' : 'Run'}
          </Button>
          <span className="text-xs text-muted-foreground">{requests.length} request{requests.length === 1 ? '' : 's'}</span>
        </div>

        <div className="min-h-0 flex-1 divide-y overflow-y-auto">
          {requests.map((req) => {
            const r = results[req.id];
            const active = current === req.id;
            return (
              <div key={req.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                <span className="w-6 shrink-0">
                  {active ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    : r ? (isOk(r) ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <X className="h-3.5 w-3.5 text-destructive" />)
                    : <span className="block h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />}
                </span>
                <span className={cn('w-12 shrink-0 font-bold uppercase', methodColor(req.method))}>{req.method}</span>
                <span className="min-w-0 flex-1 truncate" title={req.url}>{req.name}</span>
                {r && (
                  <>
                    {r.total > 0 && <span className={cn('shrink-0', r.passed === r.total ? 'text-emerald-500' : 'text-destructive')}>{r.passed}/{r.total} tests</span>}
                    <span className={cn('w-12 shrink-0 text-right font-semibold', r.error ? 'text-destructive' : statusColor(r.status))}>{r.error ? 'ERR' : r.status}</span>
                    <span className="w-16 shrink-0 text-right text-muted-foreground">{r.ms} ms</span>
                  </>
                )}
              </div>
            );
          })}
          {requests.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted-foreground">No requests to run.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
