// Collection/folder Runner (Postman-style), organised as a Setup → Results flow:
//
//  • Setup: choose requests (reorder/select), set iterations / delay / parallel /
//    tag filters, advanced options, and optionally bind a CSV or JSON data file
//    ({{var}} per row).
//  • Results: a summary dashboard, a progress bar, an iteration rail (for
//    data/iterated runs), the executed sequence with pass/fail, and a drill-in
//    showing the exact request and response for any run.
//
// Results are an ordered list of executions rather than a map keyed by request:
// `setNextRequest` lets a request run more than once — or not at all — in a
// single iteration, so the sequence is what actually happened, not the plan.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check, ChevronLeft, ChevronRight, Clock, CornerDownRight, Download, FileSpreadsheet,
  GripVertical, ListChecks, Loader2, Play, RotateCcw, Settings2, Square, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { methodColor } from './method-color';
import { statusColor, substituteVars } from './request';
import { ResponsePanel } from './ResponsePanel';
import { pickDataFile, saveJsonFile } from './fileio';
import { type DataRow, dataColumns, parseDataFile } from './datafile';
import type { ExecResult } from './engine';
import { MAX_STEPS_PER_ITERATION, describeJump, nextStepIndex, type JumpRequest } from './runnerFlow';
import type { ApiRequest, HttpMethod, TestResult, VarMap } from './types';

interface RunDetail { request: ApiRequest; result: ExecResult; dataVars?: VarMap }

// One executed request. `step` is its position in the iteration's actual
// execution order, which is what makes a record unique when flow control causes
// the same request to run twice.
interface RunRecord {
  key: string;
  iter: number;
  step: number;
  requestId: string;
  name: string;
  method: HttpMethod;
  url: string;
  status: number;
  ms: number;
  passed: number;
  total: number;
  error?: string | null;
  tests: TestResult[];
  // Omitted when "Save responses" is off, so long runs don't hold every body.
  detail?: RunDetail;
  // Set when a script steered the run from this request.
  jump?: JumpRequest;
}

interface Props {
  title: string;
  requests: ApiRequest[];
  runRequest: (req: ApiRequest, dataVars?: VarMap, signal?: AbortSignal) => Promise<ExecResult>;
  open: boolean;
  onClose: () => void;
}

const isOk = (r: RunRecord) => !r.error && r.status >= 200 && r.status < 400 && r.passed === r.total;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const parseTags = (s: string): string[] =>
  s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);

type ResultFilter = 'all' | 'passed' | 'failed';

export function RunnerDialog({ title, requests, runRequest, open, onClose }: Props) {
  const [phase, setPhase] = useState<'setup' | 'results'>('setup');

  // Run order (reorderable) and selection.
  const [order, setOrder] = useState<ApiRequest[]>(requests);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(requests.map((r) => r.id)));

  // Config.
  const [delay, setDelay] = useState('');
  const [iterations, setIterations] = useState('1');
  const [parallel, setParallel] = useState(false);
  const [stopOnFailure, setStopOnFailure] = useState(false);
  const [saveResponses, setSaveResponses] = useState(true);
  const [includeTags, setIncludeTags] = useState('');
  const [excludeTags, setExcludeTags] = useState('');

  // Data-driven runs: each row of the file binds variables for one iteration.
  const [dataFile, setDataFile] = useState<{ name: string; rows: DataRow[] } | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);

  // Run state.
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [current, setCurrent] = useState<{ iter: number; name: string; method: HttpMethod } | null>(null);
  const [viewIter, setViewIter] = useState(0);
  const [ranIters, setRanIters] = useState(0);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [elapsed, setElapsed] = useState(0);
  // Iterations stopped by the step ceiling (a setNextRequest cycle).
  const [cappedIters, setCappedIters] = useState<Set<number>>(() => new Set());
  const startedAtRef = useRef<number | null>(null);
  // While true the results view tracks whichever iteration is running; clicking
  // an iteration in the rail pins it there instead.
  const followIterRef = useRef(true);
  const dragId = useRef<string | null>(null);

  const resetRun = () => {
    setRecords([]); setDetailKey(null); setCurrent(null);
    setViewIter(0); setRanIters(0); setElapsed(0); setFilter('all'); setCappedIters(new Set());
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

  const cancelledRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { cancelledRef.current = true; abortRef.current?.abort(); }, []);

  // Wall-clock timer while a run is in progress.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (startedAtRef.current) setElapsed(Date.now() - startedAtRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [running]);

  // Execute one request and record what happened. Returns the record so the
  // driver can read the flow-control request out of it.
  const runOne = async (
    req: ApiRequest, iter: number, step: number, dataVars: VarMap | undefined,
    names: string[],
  ): Promise<RunRecord | null> => {
    setCurrent({ iter, name: req.name, method: req.method });
    let record: RunRecord;
    try {
      const r = await runRequest(req, dataVars, abortRef.current?.signal);
      if (cancelledRef.current) return null;
      const passed = r.tests.filter((t) => t.passed).length;
      record = {
        key: `${iter}:${step}`,
        iter, step,
        requestId: req.id,
        name: req.name,
        method: req.method,
        url: r.response?.url ?? req.url,
        status: r.response?.status ?? 0,
        ms: r.response?.timeMs ?? 0,
        passed,
        total: r.tests.length,
        error: r.error,
        tests: r.tests,
        detail: saveResponses ? { request: req, result: r, dataVars } : undefined,
      };
      record.jump = describeJump(r.nextRequest, names);
    } catch (e) {
      if (cancelledRef.current) return null;
      record = {
        key: `${iter}:${step}`,
        iter, step,
        requestId: req.id,
        name: req.name,
        method: req.method,
        url: req.url,
        status: 0, ms: 0, passed: 0, total: 0,
        error: (e as Error).message,
        tests: [],
      };
    }
    setRecords((prev) => [...prev, record]);
    return record;
  };

  const run = async () => {
    cancelledRef.current = false;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    startedAtRef.current = Date.now();
    setRunning(true); resetRun(); setPhase('results');

    const plan = effective;
    const names = plan.map((r) => r.name);
    const capped = new Set<number>();
    let startedIters = 0;
    followIterRef.current = true;

    try {
      for (let i = 0; i < iters; i++) {
        if (cancelledRef.current) break;
        startedIters = i + 1;
        // Follow the running iteration in the rail until the user picks one.
        if (followIterRef.current) setViewIter(i);
        const dataVars = dataFile ? dataFile.rows[i] : undefined;

        if (parallel) {
          // Flow control has no meaning when everything starts at once.
          await Promise.all(plan.map((req, step) => runOne(req, i, step, dataVars, names)));
        } else {
          let index: number | null = 0;
          let step = 0;
          while (index !== null && step < MAX_STEPS_PER_ITERATION) {
            if (cancelledRef.current) break;
            const record = await runOne(plan[index], i, step, dataVars, names);
            if (!record) break;
            step += 1;

            if (stopOnFailure && !isOk(record)) { cancelledRef.current = true; break; }

            index = nextStepIndex(index, record.jump, names);
            if (index !== null && delayMs > 0) await sleep(delayMs);
          }
          if (step >= MAX_STEPS_PER_ITERATION) capped.add(i);
        }

        setRanIters(startedIters);
      }
    } finally {
      setCurrent(null);
      setRunning(false);
      setCappedIters(capped);
      setRanIters(startedIters);
      if (startedAtRef.current) setElapsed(Date.now() - startedAtRef.current);
    }
  };

  const stop = () => { cancelledRef.current = true; abortRef.current?.abort(); };

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
    setStopOnFailure(false); setSaveResponses(true);
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
    const rows = records.filter((r) => r.iter === iter);
    return { ok: rows.filter(isOk).length, total: rows.length };
  };

  // Overall summary across every run.
  const totalRun = records.length;
  const passedRun = records.filter(isOk).length;
  const assertPass = records.reduce((s, r) => s + r.passed, 0);
  const assertTotal = records.reduce((s, r) => s + r.total, 0);

  const plannedCount = effective.length * iters;
  const dataRow = dataFile ? dataFile.rows[viewIter] : undefined;
  const multiIter = ranIters > 1 || (running && iters > 1);

  const iterRecords = records.filter((r) => r.iter === viewIter);
  const shown = iterRecords.filter((r) => (filter === 'all' ? true : filter === 'passed' ? isOk(r) : !isOk(r)));
  const failedCount = records.length - passedRun;

  const exportResults = async () => {
    const report = {
      collection: title,
      finishedAt: new Date().toISOString(),
      durationMs: elapsed,
      iterations: ranIters,
      summary: {
        requests: totalRun,
        passed: passedRun,
        failed: totalRun - passedRun,
        assertions: { total: assertTotal, passed: assertPass, failed: assertTotal - assertPass },
      },
      runs: records.map((r) => ({
        iteration: r.iter + 1,
        step: r.step + 1,
        name: r.name,
        method: r.method,
        url: r.url,
        status: r.status,
        timeMs: r.ms,
        error: r.error ?? undefined,
        tests: r.tests.map((t) => ({ name: t.name, passed: t.passed, error: t.error })),
      })),
    };
    const safe = (title || 'run').replace(/[^\w.-]+/g, '-');
    await saveJsonFile(`${safe}.run-results.json`, JSON.stringify(report, null, 2));
  };

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

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Advanced</p>
                  <OptionRow
                    label="Stop run if an error occurs"
                    checked={stopOnFailure}
                    onChange={setStopOnFailure}
                  />
                  <OptionRow
                    label="Save responses"
                    hint="Keep each response so you can open it afterwards."
                    checked={saveResponses}
                    onChange={setSaveResponses}
                  />
                  <OptionRow
                    label="Run in parallel"
                    hint={parallel ? 'Flow control (setNextRequest) is ignored in parallel runs.' : undefined}
                    checked={parallel}
                    onChange={setParallel}
                  />
                </div>

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
              <Button onClick={run} disabled={plannedCount === 0} className="h-9 gap-1.5 bg-amber-400 px-4 text-neutral-900 hover:bg-amber-500">
                <Play className="h-4 w-4" /> Run {plannedCount} request{plannedCount === 1 ? '' : 's'}
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
              <Stat label="Requests" value={`${totalRun}${running ? ` / ${plannedCount}` : ''}`} />
              <Stat label="Passed" value={passedRun} tone="ok" />
              <Stat label="Failed" value={failedCount} tone={failedCount ? 'bad' : 'muted'} />
              <Stat label="Assertions" value={`${assertPass}/${assertTotal}`} tone={assertTotal && assertPass < assertTotal ? 'bad' : assertTotal ? 'ok' : 'muted'} />
              <Stat label="Duration" value={formatDuration(elapsed)} icon={<Clock className="h-3 w-3" />} />
              <div className="ml-auto flex items-center gap-2">
                {running ? (
                  <Button onClick={stop} variant="destructive" size="sm" className="h-8 gap-1.5">
                    <Square className="h-3.5 w-3.5" /> Stop
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={exportResults}
                      disabled={totalRun === 0}
                      variant="outline" size="sm"
                      className="h-8 gap-1.5 text-xs"
                    >
                      <Download className="h-3.5 w-3.5" /> Export
                    </Button>
                    <Button onClick={run} size="sm" className="h-8 gap-1.5 bg-amber-400 text-neutral-900 hover:bg-amber-500">
                      <RotateCcw className="h-3.5 w-3.5" /> Run again
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* progress — fixed-height strip so the layout doesn't shift */}
            <div className="h-0.5 shrink-0 overflow-hidden bg-muted">
              {running && (
                <div
                  className="h-full bg-amber-400 transition-[width] duration-200"
                  style={{ width: `${plannedCount > 0 ? Math.min(100, (totalRun / plannedCount) * 100) : 0}%` }}
                />
              )}
            </div>

            <div className="flex min-h-0 flex-1">
              {/* iteration rail (data / multi-iteration runs) */}
              {multiIter && !detailKey && (
                <div className="w-48 shrink-0 overflow-y-auto border-r">
                  {Array.from({ length: Math.max(ranIters, running ? iters : 0) }, (_, i) => {
                    const s = iterStats(i);
                    const ok = s.total > 0 && s.ok === s.total;
                    const row = dataFile?.rows[i];
                    const labelVals = row ? Object.values(row).slice(0, 2).join(', ') : '';
                    return (
                      <button
                        key={i}
                        onClick={() => { followIterRef.current = false; setViewIter(i); }}
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
                {detailKey && records.find((r) => r.key === detailKey)?.detail ? (
                  <RunDetailView entry={records.find((r) => r.key === detailKey)!.detail!} onBack={() => setDetailKey(null)} />
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

                    {iterRecords.length > 0 && (
                      <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
                        {(['all', 'passed', 'failed'] as ResultFilter[]).map((f) => (
                          <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={cn('rounded px-2 py-0.5 text-[11px] font-medium capitalize transition-colors',
                              filter === f ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                          >
                            {f}
                          </button>
                        ))}
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {shown.length} of {iterRecords.length}
                        </span>
                      </div>
                    )}

                    <div className="min-h-0 flex-1 divide-y overflow-y-auto">
                      {shown.map((r) => (
                        <RecordRow key={r.key} record={r} onOpen={() => r.detail && setDetailKey(r.key)} />
                      ))}
                      {running && current && current.iter === viewIter && (
                        <div className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs">
                          <span className="w-5 shrink-0"><Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /></span>
                          <span className={cn('w-12 shrink-0 font-bold uppercase', methodColor(current.method))}>{current.method}</span>
                          <span className="min-w-0 flex-1 truncate font-medium text-muted-foreground">{current.name}</span>
                        </div>
                      )}
                      {iterRecords.length === 0 && !running && (
                        <p className="px-4 py-6 text-center text-xs text-muted-foreground">No requests ran.</p>
                      )}
                      {iterRecords.length > 0 && shown.length === 0 && (
                        <p className="px-4 py-6 text-center text-xs text-muted-foreground">Nothing matches this filter.</p>
                      )}
                      {cappedIters.has(viewIter) && (
                        <p className="px-3 py-2 text-[11px] text-destructive">
                          Stopped after {MAX_STEPS_PER_ITERATION} requests — setNextRequest appears to loop.
                        </p>
                      )}
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

// ─── one executed request ─────────────────────────────────────────────────────

function RecordRow({ record: r, onOpen }: { record: RunRecord; onOpen: () => void }) {
  const ok = isOk(r);
  return (
    <div>
      <button
        disabled={!r.detail}
        onClick={onOpen}
        className={cn('group flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs transition-colors',
          r.detail ? 'cursor-pointer hover:bg-accent/50' : 'cursor-default')}
      >
        <span className="w-5 shrink-0">
          {ok ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <X className="h-3.5 w-3.5 text-destructive" />}
        </span>
        <span className={cn('w-12 shrink-0 font-bold uppercase', methodColor(r.method))}>{r.method}</span>
        <span className="min-w-0 flex-1 truncate font-medium" title={r.url}>{r.name}</span>
        {r.total > 0 && <span className={cn('shrink-0', r.passed === r.total ? 'text-emerald-500' : 'text-destructive')}>{r.passed}/{r.total} tests</span>}
        <span className={cn('w-12 shrink-0 text-right font-semibold', r.error ? 'text-destructive' : statusColor(r.status))}>{r.error ? 'ERR' : r.status}</span>
        <span className="w-16 shrink-0 text-right text-muted-foreground">{r.ms} ms</span>
        {r.detail && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 group-hover:text-muted-foreground" />}
      </button>
      {r.jump && (
        <p className={cn('flex items-center gap-1.5 px-3 pb-1.5 pl-10 text-[11px]',
          r.jump.missing ? 'text-destructive' : 'text-muted-foreground')}>
          <CornerDownRight className="h-3 w-3 shrink-0" />
          {r.jump.to === null
            ? 'Script ended the iteration here.'
            : r.jump.missing
              ? `Script asked for "${r.jump.to}", which isn't in this run — continued in order.`
              : `Script jumped to "${r.jump.to}".`}
        </p>
      )}
    </div>
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
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

function OptionRow({ label, hint, checked, onChange }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border px-3 py-2">
      <span className="min-w-0">
        <span className="block text-xs font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} className="shrink-0" />
    </label>
  );
}
