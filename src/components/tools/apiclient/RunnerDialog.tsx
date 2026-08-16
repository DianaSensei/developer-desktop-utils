// Collection/folder Runner (Postman-style), organised as a Setup → Results flow:
//
//  • Setup: choose requests (reorder/select), set iterations / delay / parallel /
//    tag filters, advanced options, and optionally bind a CSV or JSON data file
//    ({{var}} per row).
//  • Results: a summary dashboard and status/timing breakdown, a progress bar,
//    an iteration rail (for data/iterated runs), the executed sequence with
//    pass/fail, and a drill-in showing the exact request and response for any
//    run. Everything measured is exportable as a JSON report.
//
// Results are an ordered list of executions rather than a map keyed by request:
// `setNextRequest` lets a request run more than once — or not at all — in a
// single iteration, so the sequence is what actually happened, not the plan.
//
// Record shape and aggregation live in runnerStats.ts; sequencing rules in
// runnerFlow.ts — both so they can be tested without a React tree.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check, ChevronLeft, ChevronRight, Clock, CornerDownRight, Download, FileSpreadsheet,
  GripVertical, ListChecks, Play, RotateCcw, Settings2, Square, X,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Stat, type StatProps } from '@/components/ui/stat';
import { Field } from '@/components/ui/tool-section';
import { SectionLabel } from '@/components/ui/section-label';
import { Callout } from '@/components/ui/callout';
import { methodColor } from './method-color';
import { formatBytes, statusColor, substituteVars } from './request';
import { ResponsePanel } from './ResponsePanel';
import { pickDataFile, saveJsonFile } from './fileio';
import { DELIMITER_LABEL, type DataRow, type ParsedDataFile, parseDataFile } from './datafile';
import { type ColumnMapping, collectVarTokens, mapColumns, missingColumns } from './varUsage';
import type { ExecResult } from './engine';
import { MAX_STEPS_PER_ITERATION, describeJump, findDuplicateNames, nextStepIndex } from './runnerFlow';
import { type RunDetail, type RunRecord, isOk, summarize } from './runnerStats';
import type { ApiRequest, HttpMethod, VarMap } from './types';

interface Props {
  title: string;
  requests: ApiRequest[];
  runRequest: (req: ApiRequest, dataVars?: VarMap, signal?: AbortSignal) => Promise<ExecResult>;
  // Variable names resolvable from the environment / session, so the data-file
  // mapping only warns about tokens nothing can supply.
  knownVars?: string[];
  open: boolean;
  onClose: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const parseTags = (s: string): string[] =>
  s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);

type ResultFilter = 'all' | 'passed' | 'failed';

export function RunnerDialog({ title, requests, runRequest, knownVars = [], open, onClose }: Props) {
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
  const [dataFile, setDataFile] = useState<{ name: string; parsed: ParsedDataFile } | null>(null);
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

  const dataRows = dataFile?.parsed.rows;
  const iters = dataRows ? dataRows.length : Math.max(1, Number(iterations) || 1);

  // Which {{tokens}} the selected requests actually reference, so the data file
  // can be shown as a mapping rather than a bare list of column names.
  const usedVars = useMemo(() => collectVarTokens(effective), [effective]);
  const columnMappings = useMemo(
    () => (dataFile ? mapColumns(dataFile.parsed.columns, dataFile.parsed.rows, usedVars) : []),
    [dataFile, usedVars],
  );
  const missingVars = useMemo(
    () => missingColumns(usedVars, dataFile?.parsed.columns ?? [], new Set(knownVars)),
    [usedVars, dataFile, knownVars],
  );
  // Ambiguous setNextRequest('name') targets within this run — see
  // findDuplicateNames. Checked against `effective` (the actual planned run,
  // after selection/tag filters), not the full request list, since a filtered-
  // out duplicate can never be ambiguous.
  const duplicateNames = useMemo(() => findDuplicateNames(effective.map((r) => r.name)), [effective]);
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
        statusText: r.response?.statusText ?? '',
        ms: r.response?.timeMs ?? 0,
        sizeBytes: r.response?.sizeBytes ?? 0,
        ttfbMs: r.response?.timings?.ttfbMs,
        downloadMs: r.response?.timings?.downloadMs,
        at: Date.now(),
        passed,
        total: r.tests.length,
        error: r.error,
        tests: r.tests,
        logs: r.logs,
        dataVars,
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
        status: 0, statusText: '', ms: 0, sizeBytes: 0, at: Date.now(),
        passed: 0, total: 0,
        error: (e as Error).message,
        tests: [],
        logs: [],
        dataVars,
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
        const dataVars = dataRows ? dataRows[i] : undefined;

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
      const parsed = parseDataFile(picked.name, picked.text);
      setDataFile({ name: picked.name, parsed });
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

  // Per-iteration pass/total, computed once per `records` change (O(records))
  // instead of re-scanning the whole array for every iteration-rail row on
  // every render (O(iterations × records) — records grows live while a run is
  // in progress, and a data-driven run can have hundreds of iterations).
  const iterStatsMap = useMemo(() => {
    const map = new Map<number, { ok: number; total: number }>();
    for (const r of records) {
      const s = map.get(r.iter) ?? { ok: 0, total: 0 };
      s.total += 1;
      if (isOk(r)) s.ok += 1;
      map.set(r.iter, s);
    }
    return map;
  }, [records]);
  const iterStats = (iter: number) => iterStatsMap.get(iter) ?? { ok: 0, total: 0 };

  // Overall statistics across every execution in the run.
  const stats = useMemo(() => summarize(records), [records]);
  const { total: totalRun, passed: passedRun, assertPassed: assertPass, assertTotal } = stats;

  const plannedCount = effective.length * iters;
  const dataRow = dataRows ? dataRows[viewIter] : undefined;
  const multiIter = ranIters > 1 || (running && iters > 1);

  const iterRecords = useMemo(() => records.filter((r) => r.iter === viewIter), [records, viewIter]);
  const shown = useMemo(
    () => iterRecords.filter((r) => (filter === 'all' ? true : filter === 'passed' ? isOk(r) : !isOk(r))),
    [iterRecords, filter],
  );
  const failedCount = stats.failed;
  const detailRecord = useMemo(() => records.find((r) => r.key === detailKey) ?? null, [records, detailKey]);

  const exportResults = async () => {
    const report = {
      collection: title,
      startedAt: startedAtRef.current ? new Date(startedAtRef.current).toISOString() : null,
      finishedAt: new Date().toISOString(),
      durationMs: elapsed,
      options: {
        iterations: iters,
        delayMs,
        parallel,
        stopOnFailure,
        saveResponses,
        includeTags: parseTags(includeTags),
        excludeTags: parseTags(excludeTags),
        dataFile: dataFile
          ? {
              name: dataFile.name,
              format: dataFile.parsed.format,
              delimiter: dataFile.parsed.delimiter,
              rows: dataFile.parsed.rows.length,
              columns: columnMappings.map((m) => ({ column: m.column, variable: m.token, used: m.used })),
              unresolvedVariables: missingVars,
            }
          : null,
      },
      summary: {
        iterations: { planned: iters, executed: ranIters },
        requests: { executed: stats.total, passed: stats.passed, failed: stats.failed },
        assertions: { total: stats.assertTotal, passed: stats.assertPassed, failed: stats.assertTotal - stats.assertPassed },
        responseTimeMs: { average: stats.avgMs, min: stats.minMs, max: stats.maxMs, total: stats.sumMs },
        totalDataBytes: stats.totalBytes,
        statusCodes: stats.byStatus,
        failures: records.filter((r) => !isOk(r)).map((r) => ({
          iteration: r.iter + 1,
          step: r.step + 1,
          name: r.name,
          status: r.status,
          error: r.error ?? undefined,
          failedTests: r.tests.filter((t) => !t.passed).map((t) => ({ name: t.name, error: t.error })),
        })),
      },
      runs: records.map((r) => ({
        iteration: r.iter + 1,
        step: r.step + 1,
        at: new Date(r.at).toISOString(),
        name: r.name,
        method: r.method,
        url: r.url,
        status: r.status,
        statusText: r.statusText,
        timeMs: r.ms,
        timings: r.ttfbMs === undefined ? undefined : { ttfbMs: r.ttfbMs, downloadMs: r.downloadMs },
        sizeBytes: r.sizeBytes,
        error: r.error ?? undefined,
        iterationData: r.dataVars,
        nextRequest: r.jump ? { to: r.jump.to, resolved: !r.jump.missing } : undefined,
        tests: r.tests.map((t) => ({ name: t.name, passed: t.passed, error: t.error })),
        console: r.logs.map((l) => ({ level: l.level, text: l.text })),
        // Present only when the run kept responses.
        response: r.detail?.result.response
          ? {
              headers: Object.fromEntries(r.detail.result.response.headers),
              contentType: r.detail.result.response.contentType,
              body: r.detail.result.response.body,
            }
          : undefined,
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
            <Play className="h-4 w-4 shrink-0 text-acc-ink" />
            <span className="shrink-0 text-sm font-semibold">Runner</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            <span className="min-w-0 truncate text-sm font-normal text-muted-foreground">{title}</span>
            {phase === 'results' && (
              <Button
                variant="ghost" size="sm"
                onClick={() => setPhase('setup')}
                className="ml-auto h-ctl shrink-0 gap-1.5 text-xs"
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
                      value={dataRows ? String(dataRows.length) : iterations}
                      onChange={(e) => setIterations(e.target.value)}
                      disabled={!!dataFile}
                      inputMode="numeric"
                      className="h-ctl text-xs disabled:opacity-60"
                    />
                  </Field>
                  <Field label="Delay (ms)">
                    <Input value={delay} onChange={(e) => setDelay(e.target.value)} placeholder="0" inputMode="numeric" className="h-ctl text-xs" />
                  </Field>
                </div>

                <div className="space-y-2">
                  <SectionLabel>Advanced</SectionLabel>
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
                  <SectionLabel>Data file</SectionLabel>
                  {dataFile ? (
                    <div className="space-y-2 rounded-md border p-2">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-ok" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={dataFile.name}>{dataFile.name}</span>
                        <button onClick={() => { setDataFile(null); resetRun(); }} title="Remove" className="rounded p-0.5 text-muted-foreground/60 hover:text-destructive">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {dataFile.parsed.rows.length} row{dataFile.parsed.rows.length === 1 ? '' : 's'}
                        {' · '}{dataFile.parsed.columns.length} column{dataFile.parsed.columns.length === 1 ? '' : 's'}
                        {dataFile.parsed.format === 'csv' && dataFile.parsed.delimiter
                          ? ` · ${DELIMITER_LABEL[dataFile.parsed.delimiter]}-separated`
                          : ' · JSON'}
                      </p>
                      <ColumnMappingTable mappings={columnMappings} />
                      {missingVars.length > 0 && (
                        <p className="text-[11px] text-warn">
                          Used by the run but not in this file or your environment:{' '}
                          <span className="font-mono">{missingVars.map((v) => `{{${v}}}`).join(', ')}</span>
                        </p>
                      )}
                      <DataPreview rows={dataFile.parsed.rows} columns={dataFile.parsed.columns} />
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
                    <Input value={includeTags} onChange={(e) => setIncludeTags(e.target.value)} placeholder="smoke" className="h-ctl text-xs" />
                  </Field>
                  <Field label="Exclude tags">
                    <Input value={excludeTags} onChange={(e) => setExcludeTags(e.target.value)} placeholder="slow" className="h-ctl text-xs" />
                  </Field>
                </div>
              </div>

              {/* request selection */}
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center justify-between border-b px-4 py-2.5 text-xs">
                  <span className="flex items-center gap-1.5 font-medium"><ListChecks className="h-3.5 w-3.5" /> Requests <span className="text-muted-foreground">· {selected.size}/{order.length}</span></span>
                  <button onClick={toggleAll} className="font-medium text-acc-ink hover:underline">
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
                            checked ? 'border-acc bg-acc text-acc-fg' : 'border-input')}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                        <span className={cn('w-12 shrink-0 font-bold uppercase', methodColor(req.method))}>{req.method}</span>
                        <span className="min-w-0 flex-1 truncate" title={req.url}>{req.name}</span>
                        {filteredOut && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">filtered</span>}
                      </div>
                    );
                  })}
                  {order.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted-foreground">No requests to run.</p>}
                </div>
              </div>
            </div>

            {duplicateNames.length > 0 && (
              <div className="shrink-0 border-t px-4 py-2">
                <Callout tone="warning" size="sm">
                  Duplicate request name{duplicateNames.length === 1 ? '' : 's'} in this run:{' '}
                  <span className="font-mono">{duplicateNames.join(', ')}</span>. A script's{' '}
                  <code className="rounded bg-muted px-1">setNextRequest(name)</code> always jumps to the
                  first match — rename one to make a flow-control jump to it unambiguous.
                </Callout>
              </div>
            )}

            {/* action bar */}
            <div className="flex shrink-0 items-center gap-3 border-t px-4 py-3">
              <Button onClick={run} disabled={plannedCount === 0} className="h-ctl-lg gap-1.5 px-4">
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
              <RunStat label="Requests" value={`${totalRun}${running ? ` / ${plannedCount}` : ''}`} />
              <RunStat label="Passed" value={passedRun} tone="success" />
              <RunStat label="Failed" value={failedCount} tone={failedCount ? 'danger' : 'muted'} />
              <RunStat label="Assertions" value={`${assertPass}/${assertTotal}`} tone={assertTotal && assertPass < assertTotal ? 'danger' : assertTotal ? 'success' : 'muted'} />
              <RunStat label="Duration" value={formatDuration(elapsed)} icon={<Clock className="h-3 w-3" />} />
              <RunStat label="Avg time" value={stats.total ? `${stats.avgMs} ms` : '—'} />
              <RunStat label="Data" value={formatBytes(stats.totalBytes)} />
              <div className="ml-auto flex items-center gap-2">
                {running ? (
                  <Button onClick={stop} variant="destructive" size="sm" className="h-ctl gap-1.5">
                    <Square className="h-3.5 w-3.5" /> Stop
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={exportResults}
                      disabled={totalRun === 0}
                      variant="outline" size="sm"
                      className="h-ctl gap-1.5 text-xs"
                    >
                      <Download className="h-3.5 w-3.5" /> Export
                    </Button>
                    <Button onClick={run} size="sm" className="h-ctl gap-1.5">
                      <RotateCcw className="h-3.5 w-3.5" /> Run again
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* full breakdown of what the run measured */}
            {totalRun > 0 && (
              <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-1.5 text-[11px] text-muted-foreground">
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium text-foreground/70">Status</span>
                  {Object.entries(stats.byStatus)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([code, count]) => (
                      <span key={code} className="font-mono">
                        <span className={code === 'error' ? 'text-bad' : statusColor(Number(code))}>{code}</span>
                        <span className="text-muted-foreground"> ×{count}</span>
                      </span>
                    ))}
                </span>
                <span>
                  <span className="font-medium text-foreground/70">Response time</span>{' '}
                  min {stats.minMs} ms · avg {stats.avgMs} ms · max {stats.maxMs} ms
                </span>
                <span>
                  <span className="font-medium text-foreground/70">Iterations</span>{' '}
                  {ranIters}/{iters}
                </span>
              </div>
            )}

            {/* progress — fixed-height strip so the layout doesn't shift */}
            <div className="h-0.5 shrink-0 overflow-hidden bg-muted">
              {running && (
                <div
                  className="h-full bg-acc transition-[width] duration-200"
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
                    const row = dataRows?.[i];
                    const labelVals = row ? Object.values(row).slice(0, 2).join(', ') : '';
                    return (
                      <button
                        key={i}
                        onClick={() => { followIterRef.current = false; setViewIter(i); }}
                        className={cn('flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50',
                          i === viewIter && 'bg-accent')}
                      >
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full',
                          s.total === 0 ? 'bg-muted-foreground/30' : ok ? 'bg-ok' : 'bg-bad')} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">Iteration {i + 1}</span>
                          {labelVals && <span className="block truncate text-[11px] text-muted-foreground" title={labelVals}>{labelVals}</span>}
                        </span>
                        {s.total > 0 && <span className={cn('shrink-0 text-[11px]', ok ? 'text-ok' : 'text-bad')}>{s.ok}/{s.total}</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* request results / detail */}
              <div className="flex min-w-0 flex-1 flex-col">
                {detailRecord?.detail ? (
                  <RunDetailView entry={detailRecord.detail} onBack={() => setDetailKey(null)} />
                ) : (
                  <>
                    {dataRow && Object.keys(dataRow).length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/20 px-3 py-2">
                        <SectionLabel>Data</SectionLabel>
                        {Object.entries(dataRow).map(([k, v]) => (
                          <span key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"><span className="text-muted-foreground">{k}=</span>{v}</span>
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
                          <span className="w-5 shrink-0"><Spinner size="sm" className="text-muted-foreground" /></span>
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
          {ok ? <Check className="h-3.5 w-3.5 text-ok" /> : <X className="h-3.5 w-3.5 text-bad" />}
        </span>
        <span className={cn('w-12 shrink-0 font-bold uppercase', methodColor(r.method))}>{r.method}</span>
        <span className="min-w-0 flex-1 truncate font-medium" title={r.url}>{r.name}</span>
        {r.total > 0 && <span className={cn('shrink-0', r.passed === r.total ? 'text-ok' : 'text-bad')}>{r.passed}/{r.total} tests</span>}
        <span className={cn('w-12 shrink-0 text-right font-semibold', r.error ? 'text-bad' : statusColor(r.status))}>{r.error ? 'ERR' : r.status}</span>
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

// ─── data preview ─────────────────────────────────────────────────────────────

function DataPreview({ rows, columns }: { rows: DataRow[]; columns: string[] }) {
  const cols = columns;
  const shown = rows.slice(0, 20);
  return (
    <div className="max-h-40 overflow-auto rounded border">
      <table className="w-full border-collapse text-[11px]">
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
      {rows.length > shown.length && <p className="px-1.5 py-1 text-[11px] text-muted-foreground">+{rows.length - shown.length} more…</p>}
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
        active === id ? 'border-acc text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
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
              <span key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"><span className="text-muted-foreground">{k}=</span>{v}</span>
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

/** Runner summary tile — the shared compact Stat, used for the whole strip. */
const RunStat = (props: Omit<StatProps, 'variant'>) => <Stat variant="compact" {...props} />;

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

// ─── data-file column → variable mapping ──────────────────────────────────────

// Shows what each column of the file binds to, with a sample of the value that
// will be substituted and whether anything in the run actually uses it.
function ColumnMappingTable({ mappings }: { mappings: ColumnMapping[] }) {
  if (mappings.length === 0) {
    return <p className="text-[11px] text-destructive">No columns found — is the header row present?</p>;
  }
  return (
    <div className="overflow-hidden rounded border">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-x-2 border-b bg-muted/40 px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Column</span>
        <span>Variable</span>
        <span />
      </div>
      <div className="max-h-44 overflow-y-auto">
        {mappings.map((m) => (
          <div key={m.column} className="grid grid-cols-[1fr_1fr_auto] items-center gap-x-2 border-b px-1.5 py-1 text-[11px] last:border-b-0">
            <span className="truncate font-mono" title={m.column}>{m.column}</span>
            <span className="min-w-0">
              <span className="block truncate font-mono text-ok" title={m.token}>{m.token}</span>
              {m.sample && (
                <span className="block truncate text-muted-foreground" title={m.sample}>e.g. {m.sample}</span>
              )}
            </span>
            {m.used ? (
              <Check className="h-3 w-3 shrink-0 text-ok" aria-label="Used by the run" />
            ) : (
              <span className="shrink-0 rounded bg-muted px-1 text-[11px] text-muted-foreground" title="No selected request references this variable">
                unused
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
