// Collection/folder Runner (Postman-style), organised as a Setup → Results flow:
//
//  • Setup: choose requests (reorder/select), set iterations / delay / parallel /
//    tag filters, and optionally bind a CSV or JSON data file ({{var}} per row).
//  • Results: a summary dashboard, an iteration rail (for data/iterated runs),
//    a per-request pass/fail list, and a drill-in showing the exact request and
//    response for any run.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check, ChevronLeft, ChevronRight, Clock, FileSpreadsheet, GripVertical,
  ListChecks, Loader2, Play, RotateCcw, Settings2, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { methodColor } from './method-color';
import { statusColor, substituteVars } from './request';
import { ResponsePanel } from './ResponsePanel';
import { pickDataFile } from './fileio';
import { type DataRow, dataColumns, parseDataFile } from './datafile';
import type { ExecResult } from './engine';
import type { ApiRequest, VarMap } from './types';

interface RunDetail { request: ApiRequest; result: ExecResult; dataVars?: VarMap }

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
  runRequest: (req: ApiRequest, dataVars?: VarMap) => Promise<ExecResult>;
  open: boolean;
  onClose: () => void;
}

const isOk = (r: RowResult) => !r.error && r.status >= 200 && r.status < 400 && r.passed === r.total;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const parseTags = (s: string): string[] =>
  s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
const keyOf = (iter: number, id: string) => `${iter}:${id}`;

export function RunnerDialog({ title, requests, runRequest, open, onClose }: Props) {
  const [phase, setPhase] = useState<'setup' | 'results'>('setup');

  // Run order (reorderable) and selection.
  const [order, setOrder] = useState<ApiRequest[]>(requests);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(requests.map((r) => r.id)));

  // Config.
  const [delay, setDelay] = useState('');
  const [iterations, setIterations] = useState('1');
  const [parallel, setParallel] = useState(false);
  const [includeTags, setIncludeTags] = useState('');
  const [excludeTags, setExcludeTags] = useState('');

  // Data-driven runs: each row of the file binds variables for one iteration.
  const [dataFile, setDataFile] = useState<{ name: string; rows: DataRow[] } | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);

  // Run state (results/details keyed by iteration:requestId).
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [details, setDetails] = useState<Record<string, RunDetail>>({});
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [viewIter, setViewIter] = useState(0);
  const [ranIters, setRanIters] = useState(0);
  const [running, setRunning] = useState(false);
  const dragId = useRef<string | null>(null);

  const resetRun = () => {
    setResults({}); setDetails({}); setDetailKey(null); setCurrentKey(null);
    setViewIter(0); setRanIters(0);
  };

  // Reset everything when the requests prop changes (a different node was run).
  const sig = requests.map((r) => r.id).join(',');
  const lastSig = useRef(sig);
  if (lastSig.current !== sig) {
    lastSig.current = sig;
    setOrder(requests);
    setSelected(new Set(requests.map((r) => r.id)));
    resetRun();
    setPhase('setup');
  }

  // Requests that will actually run: selected and passing the tag filters.
  const effective = useMemo(() => {
    const inc = parseTags(includeTags);
    const exc = parseTags(excludeTags);
    return order.filter((r) => {
      if (!selected.has(r.id)) return false;
      const tags = (r.settings?.tags ?? []).map((t) => t.toLowerCase());
      if (inc.length && !inc.some((t) => tags.includes(t))) return false;
      if (exc.length && exc.some((t) => tags.includes(t))) return false;
      return true;
    });
  }, [order, selected, includeTags, excludeTags]);

  const iters = dataFile ? dataFile.rows.length : Math.max(1, Number(iterations) || 1);
  const delayMs = Math.max(0, Number(delay) || 0);

  const runOne = async (req: ApiRequest, iter: number, dataVars?: VarMap) => {
    const key = keyOf(iter, req.id);
    try {
      const r = await runRequest(req, dataVars);
      const passed = r.tests.filter((t) => t.passed).length;
      const row: RowResult = { status: r.response?.status ?? 0, ms: r.response?.timeMs ?? 0, passed, total: r.tests.length, error: r.error };
      setResults((m) => ({ ...m, [key]: row }));
      setDetails((m) => ({ ...m, [key]: { request: req, result: r, dataVars } }));
    } catch (e) {
      setResults((m) => ({ ...m, [key]: { status: 0, ms: 0, passed: 0, total: 0, error: (e as Error).message } }));
    }
  };

  const cancelledRef = useRef(false);
  useEffect(() => () => { cancelledRef.current = true; }, []);

  const run = async () => {
    cancelledRef.current = false;
    setRunning(true); resetRun(); setPhase('results');
    for (let i = 0; i < iters; i++) {
      if (cancelledRef.current) break;
      const dataVars = dataFile ? dataFile.rows[i] : undefined;
      if (parallel) {
        await Promise.all(effective.map((req) => runOne(req, i, dataVars)));
      } else {
        for (const req of effective) {
          if (cancelledRef.current) break;
          setCurrentKey(keyOf(i, req.id));
          await runOne(req, i, dataVars);
          if (delayMs > 0) await sleep(delayMs);
        }
      }
    }
    if (!cancelledRef.current) { setRanIters(iters); setCurrentKey(null); setRunning(false); }
  };

  const loadData = async () => {
    setDataError(null);
    try {
      const picked = await pickDataFile();
      if (!picked) return;
      const rows = parseDataFile(picked.name, picked.text);
      setDataFile({ name: picked.name, rows });
      resetRun();
    } catch (e) {
      setDataFile(null);
      setDataError((e as Error)?.message || 'Could not load the data file.');
    }
  };

  const resetAll = () => {
    setOrder(requests);
    setSelected(new Set(requests.map((r) => r.id)));
    setDelay(''); setIterations('1'); setParallel(false); setIncludeTags(''); setExcludeTags('');
    setDataFile(null); setDataError(null);
    resetRun(); setPhase('setup');
  };

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = selected.size === order.length && order.length > 0;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(order.map((r) => r.id)));

  const onDrop = (targetId: string) => {
    const from = dragId.current;
    dragId.current = null;
    if (!from || from === targetId) return;
    setOrder((prev) => {
      const arr = [...prev];
      const fi = arr.findIndex((r) => r.id === from);
      const ti = arr.findIndex((r) => r.id === targetId);
      if (fi === -1 || ti === -1) return prev;
      const [moved] = arr.splice(fi, 1);
      arr.splice(ti, 0, moved);
      return arr;
    });
  };

  const iterStats = (iter: number) => {
    let ok = 0, total = 0;
    for (const req of effective) {
      const r = results[keyOf(iter, req.id)];
      if (!r) continue;
      total += 1;
      if (isOk(r)) ok += 1;
    }
    return { ok, total };
  };

  // Overall summary across every run.
  const all = Object.values(results);
  const totalRun = all.length;
  const passedRun = all.filter(isOk).length;
  const assertPass = all.reduce((s, r) => s + r.passed, 0);
  const assertTotal = all.reduce((s, r) => s + r.total, 0);
  const totalMs = all.reduce((s, r) => s + r.ms, 0);

  const runCount = effective.length * iters;
  const dataRow = dataFile ? dataFile.rows[viewIter] : undefined;
  const multiIter = ranIters > 1;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[82vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="flex h-14 shrink-0 flex-row items-center border-b px-4">
          <DialogTitle className="flex w-full items-center gap-2 pr-10">
            <Play className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="shrink-0 text-sm font-semibold">Runner</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            <span className="min-w-0 truncate text-sm font-normal text-muted-foreground">{title}</span>
            {phase === 'results' && (
              <Button
                variant="ghost" size="sm"
                onClick={() => setPhase('setup')}
                className="ml-auto h-7 shrink-0 gap-1.5 text-xs"
              >
                <Settings2 className="h-3.5 w-3.5" /> Configure
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>

        {phase === 'setup' ? (
          /* ─────────────────────────── SETUP ─────────────────────────── */
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              {/* config */}
              <div className="w-80 shrink-0 space-y-4 overflow-y-auto border-r p-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Iterations">
                    <Input
                      value={dataFile ? String(dataFile.rows.length) : iterations}
                      onChange={(e) => setIterations(e.target.value)}
                      disabled={!!dataFile}
                      inputMode="numeric"
                      className="h-8 text-xs disabled:opacity-60"
                    />
                  </Field>
                  <Field label="Delay (ms)">
                    <Input value={delay} onChange={(e) => setDelay(e.target.value)} placeholder="0" inputMode="numeric" className="h-8 text-xs" />
                  </Field>
                </div>

                <label className="flex cursor-pointer items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-xs font-medium">Run in parallel</span>
                  <Switch checked={parallel} onCheckedChange={setParallel} aria-label="Run in parallel" />
                </label>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Data file</p>
                  {dataFile ? (
                    <div className="space-y-2 rounded-md border p-2">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={dataFile.name}>{dataFile.name}</span>
                        <button onClick={() => { setDataFile(null); resetRun(); }} title="Remove" className="rounded p-0.5 text-muted-foreground/60 hover:text-destructive">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {dataFile.rows.length} row{dataFile.rows.length === 1 ? '' : 's'} → {dataColumns(dataFile.rows).map((c) => `{{${c}}}`).join(', ') || 'no columns'}
                      </p>
                      <DataPreview rows={dataFile.rows} />
                    </div>
                  ) : (
                    <button
                      onClick={loadData}
                      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-2.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" /> Select CSV or JSON file
                    </button>
                  )}
                  {dataError && <p className="text-[11px] text-destructive">{dataError}</p>}
                  {!dataFile && <p className="text-[11px] text-muted-foreground">Binds each row's columns to <code className="rounded bg-muted px-1">{'{{var}}'}</code>, one iteration per row.</p>}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Include tags">
                    <Input value={includeTags} onChange={(e) => setIncludeTags(e.target.value)} placeholder="smoke" className="h-8 text-xs" />
                  </Field>
                  <Field label="Exclude tags">
                    <Input value={excludeTags} onChange={(e) => setExcludeTags(e.target.value)} placeholder="slow" className="h-8 text-xs" />
                  </Field>
                </div>
              </div>

              {/* request selection */}
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center justify-between border-b px-4 py-2.5 text-xs">
                  <span className="flex items-center gap-1.5 font-medium"><ListChecks className="h-3.5 w-3.5" /> Requests <span className="text-muted-foreground">· {selected.size}/{order.length}</span></span>
                  <button onClick={toggleAll} className="font-medium text-amber-500 hover:underline">
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="min-h-0 flex-1 divide-y overflow-y-auto">
                  {order.map((req) => {
                    const checked = selected.has(req.id);
                    const filteredOut = checked && !effective.includes(req);
                    return (
                      <div
                        key={req.id}
                        draggable
                        onDragStart={() => { dragId.current = req.id; }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => onDrop(req.id)}
                        onClick={() => toggle(req.id)}
                        className={cn('group flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs hover:bg-accent/50', !checked && 'opacity-50')}
                      >
                        <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/30 group-hover:text-muted-foreground/60" />
                        <span
                          className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                            checked ? 'border-amber-400 bg-amber-400 text-neutral-900' : 'border-input')}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                        <span className={cn('w-12 shrink-0 font-bold uppercase', methodColor(req.method))}>{req.method}</span>
                        <span className="min-w-0 flex-1 truncate" title={req.url}>{req.name}</span>
                        {filteredOut && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">filtered</span>}
                      </div>
                    );
                  })}
                  {order.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted-foreground">No requests to run.</p>}
                </div>
              </div>
            </div>

            {/* action bar */}
            <div className="flex shrink-0 items-center gap-3 border-t px-4 py-3">
              <Button onClick={run} disabled={runCount === 0} className="h-9 gap-1.5 bg-amber-400 px-4 text-neutral-900 hover:bg-amber-500">
                <Play className="h-4 w-4" /> Run {runCount} request{runCount === 1 ? '' : 's'}
              </Button>
              <span className="text-xs text-muted-foreground">
                {effective.length} selected × {iters} iteration{iters === 1 ? '' : 's'}
              </span>
              <button onClick={resetAll} className="ml-auto flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </button>
            </div>
          </div>
        ) : (
          /* ────────────────────────── RESULTS ────────────────────────── */
          <div className="flex min-h-0 flex-1 flex-col">
            {/* summary dashboard */}
            <div className="flex shrink-0 flex-wrap items-stretch gap-2 border-b p-3">
              <Stat label="Requests" value={`${totalRun}${running ? ` / ${runCount}` : ''}`} />
              <Stat label="Passed" value={passedRun} tone="ok" />
              <Stat label="Failed" value={totalRun - passedRun} tone={totalRun - passedRun ? 'bad' : 'muted'} />
              <Stat label="Assertions" value={`${assertPass}/${assertTotal}`} tone={assertTotal && assertPass < assertTotal ? 'bad' : assertTotal ? 'ok' : 'muted'} />
              <Stat label="Total time" value={`${totalMs} ms`} icon={<Clock className="h-3 w-3" />} />
              <div className="ml-auto flex items-center gap-2">
                {running && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…</span>}
                <Button onClick={run} disabled={running} size="sm" className="h-8 gap-1.5 bg-amber-400 text-neutral-900 hover:bg-amber-500">
                  <RotateCcw className="h-3.5 w-3.5" /> Run again
                </Button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              {/* iteration rail (data / multi-iteration runs) */}
              {multiIter && !detailKey && (
                <div className="w-48 shrink-0 overflow-y-auto border-r">
                  {Array.from({ length: ranIters }, (_, i) => {
                    const s = iterStats(i);
                    const ok = s.total > 0 && s.ok === s.total;
                    const row = dataFile?.rows[i];
                    const labelVals = row ? Object.values(row).slice(0, 2).join(', ') : '';
                    return (
                      <button
                        key={i}
                        onClick={() => setViewIter(i)}
                        className={cn('flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50',
                          i === viewIter && 'bg-accent')}
                      >
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full',
                          s.total === 0 ? 'bg-muted-foreground/30' : ok ? 'bg-emerald-500' : 'bg-destructive')} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">Iteration {i + 1}</span>
                          {labelVals && <span className="block truncate text-[10px] text-muted-foreground" title={labelVals}>{labelVals}</span>}
                        </span>
                        {s.total > 0 && <span className={cn('shrink-0 text-[10px]', ok ? 'text-emerald-500' : 'text-destructive')}>{s.ok}/{s.total}</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* request results / detail */}
              <div className="flex min-w-0 flex-1 flex-col">
                {detailKey && details[detailKey] ? (
                  <RunDetailView entry={details[detailKey]} onBack={() => setDetailKey(null)} />
                ) : (
                  <>
                    {dataRow && Object.keys(dataRow).length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/20 px-3 py-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Data</span>
                        {Object.entries(dataRow).map(([k, v]) => (
                          <span key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"><span className="text-muted-foreground">{k}=</span>{v}</span>
                        ))}
                      </div>
                    )}
                    <div className="min-h-0 flex-1 divide-y overflow-y-auto">
                      {effective.map((req) => {
                        const key = keyOf(viewIter, req.id);
                        const r = results[key];
                        const active = currentKey === key;
                        const hasDetail = !!details[key];
                        return (
                          <button
                            key={req.id}
                            disabled={!hasDetail}
                            onClick={() => hasDetail && setDetailKey(key)}
                            className={cn('group flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs transition-colors',
                              hasDetail ? 'cursor-pointer hover:bg-accent/50' : 'cursor-default')}
                          >
                            <span className="w-5 shrink-0">
                              {active ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                : r ? (isOk(r) ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <X className="h-3.5 w-3.5 text-destructive" />)
                                : <span className="block h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />}
                            </span>
                            <span className={cn('w-12 shrink-0 font-bold uppercase', methodColor(req.method))}>{req.method}</span>
                            <span className="min-w-0 flex-1 truncate font-medium" title={req.url}>{req.name}</span>
                            {r && (
                              <>
                                {r.total > 0 && <span className={cn('shrink-0', r.passed === r.total ? 'text-emerald-500' : 'text-destructive')}>{r.passed}/{r.total} tests</span>}
                                <span className={cn('w-12 shrink-0 text-right font-semibold', r.error ? 'text-destructive' : statusColor(r.status))}>{r.error ? 'ERR' : r.status}</span>
                                <span className="w-16 shrink-0 text-right text-muted-foreground">{r.ms} ms</span>
                              </>
                            )}
                            {hasDetail && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 group-hover:text-muted-foreground" />}
                          </button>
                        );
                      })}
                      {effective.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted-foreground">No requests ran.</p>}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── summary stat card ────────────────────────────────────────────────────────

function Stat({ label, value, tone = 'default', icon }: {
  label: string; value: React.ReactNode; tone?: 'default' | 'ok' | 'bad' | 'muted'; icon?: React.ReactNode;
}) {
  const toneCls = tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'bad' ? 'text-destructive'
    : tone === 'muted' ? 'text-muted-foreground' : 'text-foreground';
  return (
    <div className="min-w-[5.5rem] rounded-md border bg-muted/20 px-3 py-1.5">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">{icon}{label}</p>
      <p className={cn('text-base font-semibold tabular-nums', toneCls)}>{value}</p>
    </div>
  );
}

// ─── data preview ─────────────────────────────────────────────────────────────

function DataPreview({ rows }: { rows: DataRow[] }) {
  const cols = dataColumns(rows);
  const shown = rows.slice(0, 20);
  return (
    <div className="max-h-40 overflow-auto rounded border">
      <table className="w-full border-collapse text-[10px]">
        <thead className="sticky top-0 bg-muted/60">
          <tr>
            <th className="border-b px-1.5 py-1 text-left font-semibold text-muted-foreground">#</th>
            {cols.map((c) => <th key={c} className="border-b px-1.5 py-1 text-left font-mono font-semibold">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i} className="odd:bg-muted/20">
              <td className="px-1.5 py-0.5 text-muted-foreground">{i + 1}</td>
              {cols.map((c) => <td key={c} className="max-w-[8rem] truncate px-1.5 py-0.5 font-mono" title={row[c]}>{row[c]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && <p className="px-1.5 py-1 text-[10px] text-muted-foreground">+{rows.length - shown.length} more…</p>}
    </div>
  );
}

// ─── single run detail ────────────────────────────────────────────────────────

function RunDetailView({ entry, onBack }: { entry: RunDetail; onBack: () => void }) {
  const { request, result, dataVars } = entry;
  const [tab, setTab] = useState<'response' | 'request'>('response');
  const status = result.response?.status ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
        <button onClick={onBack} className="flex items-center gap-1 rounded px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" /> Back
        </button>
        <span className={cn('font-bold uppercase', methodColor(request.method))}>{request.method}</span>
        <span className="min-w-0 truncate font-medium" title={request.name}>{request.name}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {result.response && <span className={cn('font-semibold', statusColor(status))}>{status}</span>}
          {result.error && <span className="font-semibold text-destructive">ERR</span>}
          {result.response && <span className="text-muted-foreground">{result.response.timeMs} ms</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4 border-b px-3">
        <DetailTab id="request" active={tab} onClick={setTab}>Request</DetailTab>
        <DetailTab id="response" active={tab} onClick={setTab}>Response</DetailTab>
      </div>
      {tab === 'response' ? (
        <ResponsePanel
          response={result.response}
          sending={false}
          error={result.error}
          tests={result.tests}
          logs={result.logs}
        />
      ) : (
        <RequestDetail request={request} sentUrl={result.response?.url} dataVars={dataVars} />
      )}
    </div>
  );
}

function DetailTab({ id, active, onClick, children }: {
  id: 'response' | 'request'; active: string; onClick: (id: 'response' | 'request') => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={() => onClick(id)}
      className={cn('-mb-px border-b-2 py-2 text-xs font-medium transition-colors',
        active === id ? 'border-amber-400 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
    >
      {children}
    </button>
  );
}

function RequestDetail({ request, sentUrl, dataVars }: { request: ApiRequest; sentUrl?: string; dataVars?: VarMap }) {
  const sub = (s: string) => (dataVars ? substituteVars(s, dataVars) : s);
  const headers = request.headers.filter((h) => h.enabled && h.key);
  const body = request.body;
  let bodyText = '';
  if (body.mode === 'graphql') bodyText = `# query\n${body.graphql?.query ?? ''}\n\n# variables\n${body.graphql?.variables ?? ''}`;
  else if (body.mode === 'urlencoded' || body.mode === 'multipart') bodyText = body.form.filter((f) => f.enabled && f.key).map((f) => `${f.key}: ${f.kind === 'file' ? `(file) ${f.fileName ?? ''}` : f.value}`).join('\n');
  else if (body.mode === 'file') bodyText = body.fileName ? `(file) ${body.fileName}` : '';
  else bodyText = body.raw;

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3 text-xs">
      {dataVars && Object.keys(dataVars).length > 0 && (
        <div>
          <p className="mb-1 font-semibold text-muted-foreground">Iteration data</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(dataVars).map(([k, v]) => (
              <span key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"><span className="text-muted-foreground">{k}=</span>{v}</span>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="mb-1 font-semibold text-muted-foreground">URL</p>
        <p className="break-all font-mono">{sentUrl || sub(request.url) || '—'}</p>
      </div>
      <div>
        <p className="mb-1 font-semibold text-muted-foreground">Headers</p>
        {headers.length === 0 ? <p className="text-muted-foreground">No headers.</p> : (
          <div className="space-y-0.5 font-mono">
            {headers.map((h) => (
              <p key={h.id} className="break-all"><span className="text-muted-foreground">{sub(h.key)}:</span> {sub(h.value)}</p>
            ))}
          </div>
        )}
      </div>
      <div>
        <p className="mb-1 font-semibold text-muted-foreground">Body <span className="font-normal">({body.mode})</span></p>
        {bodyText ? <pre className="whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono">{sub(bodyText)}</pre> : <p className="text-muted-foreground">No body.</p>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
