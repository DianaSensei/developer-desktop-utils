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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Segmented } from '@/components/ui/segmented';
import { Stat, type StatProps } from '@/components/ui/stat';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/tool-section';
import { SectionLabel } from '@/components/ui/section-label';
import { Callout } from '@/components/ui/callout';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { methodColor } from './method-color';
import { formatBytes, statusColor, substituteVars } from './request';
import { ResponsePanel } from './ResponsePanel';
import { pickDataFile, saveJsonFile, saveTextFile } from './fileio';
import { DELIMITER_LABEL, type DataRow, type ParsedDataFile, parseDataFileAsync } from './datafile';
import { type ColumnMapping, collectVarTokens, mapColumns, missingColumns } from './varUsage';
import type { ExecResult } from './engine';
import { MAX_STEPS_PER_ITERATION, describeJump, findDuplicateNames, nextStepIndex } from './runnerFlow';
import { type RunDetail, type RunRecord, type RunStats, type RunStatsAcc, fold, isOk, newAcc, toStats } from './runnerStats';
import type { ApiRequest, Environment, HttpMethod, VarMap } from './types';

interface Props {
  title: string;
  requests: ApiRequest[];
  runRequest: (req: ApiRequest, dataVars?: VarMap, signal?: AbortSignal, envId?: string | null) => Promise<ExecResult>;
  // Variable names resolvable from the environment / session, so the data-file
  // mapping only warns about tokens nothing can supply.
  knownVars?: string[];
  // Candidates for the run's own environment picker — already scoped to
  // Global + this run's own collection by the caller (ApiClient.tsx), so a
  // scoped environment belonging to some unrelated collection never shows up
  // as an option here.
  environments: Environment[];
  // Preselected on open — the environment currently active app-wide, if it's
  // a valid candidate for this run.
  defaultEnvId: string | null;
  open: boolean;
  onClose: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const parseTags = (s: string): string[] =>
  s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);

type ResultFilter = 'all' | 'passed' | 'failed';

// Above this row count, "Save responses" defaults off (see loadData) and the
// iteration rail switches from a plain list to a virtualized one (see
// VirtualIterRail) — a 100k-row data file is the case this dialog is built
// to handle without the UI or memory footprint degrading.
const LARGE_DATA_ROWS = 2000;
// Row-height the virtualized iteration rail renders at (px) — must match the
// className on each row button below.
const ITER_ROW_H = 44;
const EMPTY_RECORDS: RunRecord[] = [];

export function RunnerDialog({ title, requests, runRequest, knownVars = [], environments, defaultEnvId, open, onClose }: Props) {
  const [phase, setPhase] = useState<'setup' | 'results'>('setup');

  // Run order (reorderable) and selection.
  const [order, setOrder] = useState<ApiRequest[]>(requests);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(requests.map((r) => r.id)));

  // The environment this run will use — pinned independently of whatever is
  // globally active, so switching tabs elsewhere while the Runner is open (or
  // simply having a different collection focused before opening it) can
  // never change what a run already configured actually sends. `null` is a
  // deliberate, explicit "No Environment" choice, distinct from the "auto"
  // behavior a plain Send uses (see runRequest's envId param in ApiClient.tsx).
  const [envId, setEnvId] = useState<string | null>(
    defaultEnvId && environments.some((e) => e.id === defaultEnvId) ? defaultEnvId : null,
  );

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
  const [parsingData, setParsingData] = useState(false);
  // Cap iterations to the file's first N rows — lets a huge CSV (this dialog
  // is built to take ~100k rows) be validated against a handful of rows
  // before committing to a run that could take a long time to fully unwind.
  const [rowLimit, setRowLimit] = useState<number | null>(null);

  // Run state. Records are kept in refs, not React state: a data-driven run
  // over a 100k-row file produces one record per request per row, and
  // re-rendering the whole history array on every single completion (or
  // rescanning it for stats) turns an O(n) run into an O(n²) one long before
  // it finishes. `recordsRef` is the full ordered history (read once, at
  // export); `byIterRef` indexes it per iteration so the results view only
  // ever touches the handful of records belonging to the iteration on
  // screen; `accRef`/`iterStatsRef` are running totals folded in O(1) per
  // record. `tick` is bumped on a throttle to trigger the re-renders that
  // read these refs — see scheduleFlush.
  const recordsRef = useRef<RunRecord[]>([]);
  const byIterRef = useRef<Map<number, RunRecord[]>>(new Map());
  const iterStatsRef = useRef<Map<number, { ok: number; total: number }>>(new Map());
  const accRef = useRef<RunStatsAcc>(newAcc());
  const ranItersRef = useRef(0);
  const [stats, setStats] = useState<RunStats>(() => toStats(newAcc()));
  const [tick, setTick] = useState(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Applies immediately (run start/stop) — bypasses the throttle so the UI
  // never shows a stale trailing record after the run actually finished.
  const flushNow = () => {
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    setStats(toStats(accRef.current));
    setRanIters(ranItersRef.current);
    setTick((t) => t + 1);
  };
  const scheduleFlush = () => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => { flushTimerRef.current = null; flushNow(); }, 120);
  };
  useEffect(() => () => { if (flushTimerRef.current) clearTimeout(flushTimerRef.current); }, []);

  const resetRun = () => {
    recordsRef.current = []; byIterRef.current = new Map(); iterStatsRef.current = new Map();
    accRef.current = newAcc(); ranItersRef.current = 0;
    setStats(toStats(accRef.current)); setTick(0);
    setDetailKey(null); setCurrent(null);
    setViewIter(0); setRanIters(0); setElapsed(0); setFilter('all'); setCappedIters(new Set());
  };

  // Reset everything when the requests prop changes (a different node was run).
  const sig = requests.map((r) => r.id).join(',');
  const lastSig = useRef(sig);
  if (lastSig.current !== sig) {
    lastSig.current = sig;
    setOrder(requests);
    setSelected(new Set(requests.map((r) => r.id)));
    setEnvId(defaultEnvId && environments.some((e) => e.id === defaultEnvId) ? defaultEnvId : null);
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

  const allDataRows = dataFile?.parsed.rows;
  // rowLimit trims which rows actually feed the run (a "test with the first N
  // rows" dry run) without discarding the loaded file — clearing the limit
  // brings every row back. Memoized: re-slicing a large file on every render
  // (this dialog re-renders on every throttled flush while a run is live)
  // would itself become a recurring O(n) cost.
  const dataRows = useMemo(
    () => (allDataRows && rowLimit != null ? allDataRows.slice(0, rowLimit) : allDataRows),
    [allDataRows, rowLimit],
  );
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
      const r = await runRequest(req, dataVars, abortRef.current?.signal, envId);
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
    recordsRef.current.push(record);
    fold(accRef.current, record);
    const s = iterStatsRef.current.get(iter) ?? { ok: 0, total: 0 };
    s.total += 1;
    if (isOk(record)) s.ok += 1;
    iterStatsRef.current.set(iter, s);
    const arr = byIterRef.current.get(iter);
    if (arr) arr.push(record); else byIterRef.current.set(iter, [record]);
    scheduleFlush();
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

        // ranIters drives the iteration rail's rendered range — updating it
        // through React state on every iteration would re-render on every
        // row of a 100k-row run. Folded into the same throttle as records.
        ranItersRef.current = startedIters;
        scheduleFlush();
      }
    } finally {
      setCurrent(null);
      setRunning(false);
      setCappedIters(capped);
      ranItersRef.current = startedIters;
      flushNow();
      if (startedAtRef.current) setElapsed(Date.now() - startedAtRef.current);
    }
  };

  const stop = () => { cancelledRef.current = true; abortRef.current?.abort(); };

  const loadData = async () => {
    setDataError(null);
    setParsingData(true);
    try {
      const picked = await pickDataFile();
      if (!picked) return;
      // Off the main thread above WORKER_THRESHOLD_CHARS — a 100k-row CSV
      // takes real time to walk and would otherwise freeze the dialog on pick.
      const parsed = await parseDataFileAsync(picked.name, picked.text);
      setDataFile({ name: picked.name, parsed });
      setRowLimit(null);
      // Keeping every response in memory for a huge run risks running the
      // app out of memory before the run finishes — default it off and let
      // the user opt back in once they know the file is small enough.
      if (parsed.rows.length > LARGE_DATA_ROWS) setSaveResponses(false);
      resetRun();
    } catch (e) {
      setDataFile(null);
      setDataError((e as Error)?.message || 'Could not load the data file.');
    } finally {
      setParsingData(false);
    }
  };

  const resetAll = () => {
    setOrder(requests);
    setSelected(new Set(requests.map((r) => r.id)));
    setEnvId(defaultEnvId && environments.some((e) => e.id === defaultEnvId) ? defaultEnvId : null);
    setDelay(''); setIterations('1'); setParallel(false); setIncludeTags(''); setExcludeTags('');
    setStopOnFailure(false); setSaveResponses(true);
    setDataFile(null); setDataError(null); setRowLimit(null);
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

  // Per-iteration pass/total — read straight from iterStatsRef (folded in O(1)
  // per record as the run executes; see runOne) rather than rescanning
  // history, which is what let a data-driven run's iteration rail cost
  // O(iterations × records) per render.
  const iterStats = (iter: number) => iterStatsRef.current.get(iter) ?? { ok: 0, total: 0 };

  const { total: totalRun, passed: passedRun, assertPassed: assertPass, assertTotal } = stats;

  const plannedCount = effective.length * iters;
  const dataRow = dataRows ? dataRows[viewIter] : undefined;
  const multiIter = ranIters > 1 || (running && iters > 1);

  // byIterRef gives O(1) access to just this iteration's records instead of
  // filtering the whole run's history on every render — the difference
  // between a responsive results view and one that re-scans up to 100k
  // records on every keystroke-level state change while a run is live.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const iterRecords = useMemo(() => byIterRef.current.get(viewIter) ?? EMPTY_RECORDS, [viewIter, tick]);
  const shown = useMemo(
    () => iterRecords.filter((r) => (filter === 'all' ? true : filter === 'passed' ? isOk(r) : !isOk(r))),
    [iterRecords, filter],
  );
  const failedCount = stats.failed;
  // detailKey is `${iter}:${step}` (see runOne) — look inside just that
  // iteration's bucket instead of scanning the full run.
  const detailRecord = useMemo(() => {
    if (!detailKey) return null;
    const iter = Number(detailKey.slice(0, detailKey.indexOf(':')));
    return (byIterRef.current.get(iter) ?? []).find((r) => r.key === detailKey) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailKey, tick]);

  const exportResults = async () => {
    const report = {
      collection: title,
      startedAt: startedAtRef.current ? new Date(startedAtRef.current).toISOString() : null,
      finishedAt: new Date().toISOString(),
      durationMs: elapsed,
      options: {
        environment: envId ? (environments.find((e) => e.id === envId)?.name ?? envId) : null,
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
        failures: recordsRef.current.filter((r) => !isOk(r)).map((r) => ({
          iteration: r.iter + 1,
          step: r.step + 1,
          name: r.name,
          status: r.status,
          error: r.error ?? undefined,
          failedTests: r.tests.filter((t) => !t.passed).map((t) => ({ name: t.name, error: t.error })),
        })),
      },
      runs: recordsRef.current.map((r) => ({
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

  // A CSV export alongside the JSON one: one row per executed request, with
  // its bound data-file columns spliced in. For a data-driven run over a
  // 100k-row CSV this is the format someone actually wants to open — a
  // spreadsheet loads a flat table instantly, where the equivalent JSON
  // report (deeply nested, one object per run) would be sluggish just to
  // scroll through, and most of that structure doesn't matter for a "which
  // rows failed and why" pass.
  const exportResultsCsv = async () => {
    const dataCols = dataFile?.parsed.columns ?? [];
    const header = [
      'iteration', 'step', 'name', 'method', 'url', 'status', 'ok', 'timeMs', 'sizeBytes',
      'assertionsPassed', 'assertionsTotal', 'error', ...dataCols,
    ];
    const csvCell = (v: unknown): string => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.map(csvCell).join(',')];
    for (const r of recordsRef.current) {
      const row = [
        r.iter + 1, r.step + 1, r.name, r.method, r.url, r.status, isOk(r) ? 'yes' : 'no',
        r.ms, r.sizeBytes, r.passed, r.total, r.error ?? '',
        ...dataCols.map((c) => r.dataVars?.[c] ?? ''),
      ];
      lines.push(row.map(csvCell).join(','));
    }
    const safe = (title || 'run').replace(/[^\w.-]+/g, '-');
    await saveTextFile(`${safe}.run-results.csv`, lines.join('\n'));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* h-[80vh], not just DialogContent's own `max-h-[85vh]`: the results
          view drills into a per-request ResponsePanel, whose body is
          `flex-1 min-h-0` and so resolves to zero against a parent with no
          definite height — the detail pane rendered its tabs and toolbar with
          nothing under them. A fixed height also stops the dialog resizing
          between setup, a run in progress, and a detail view, which made the
          Run button jump under the pointer. */}
      <DialogContent size="full" scrollable className="h-[80vh]">
        <DialogHeader className="flex h-14 shrink-0 flex-row items-center border-b px-4">
          <DialogTitle className="flex w-full items-center gap-2 pr-10">
            <Play className="h-4 w-4 shrink-0 text-acc-ink" />
            <span className="shrink-0 text-sm font-semibold">Runner</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-mute/50" />
            <span className="min-w-0 truncate text-sm font-normal text-fg-mute">{title}</span>
            <Badge tone="neutral" className="shrink-0" title="Environment used for this run">
              {envId ? (environments.find((e) => e.id === envId)?.name ?? envId) : 'No Environment'}
            </Badge>
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
                <Field label="Environment" hint="Pinned to this run — unaffected by whichever environment is active elsewhere in the app.">
                  <Select value={envId ?? 'none'} onValueChange={(v) => setEnvId(v === 'none' ? null : v)}>
                    <SelectTrigger className="h-ctl text-xs"><SelectValue placeholder="No Environment" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Environment</SelectItem>
                      {environments.some((e) => e.collectionId) && (
                        <SelectGroup>
                          <SelectLabel className="text-[11px] uppercase tracking-wide text-fg-mute">This collection</SelectLabel>
                          {environments.filter((e) => e.collectionId).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                        </SelectGroup>
                      )}
                      {environments.some((e) => !e.collectionId) && (
                        <SelectGroup>
                          <SelectLabel className="text-[11px] uppercase tracking-wide text-fg-mute">Global</SelectLabel>
                          {environments.filter((e) => !e.collectionId).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                </Field>

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
                  {/* One bordered surface with hairline dividers, not three
                      separate bordered cards stacked with gaps — three boxes
                      inside a panel that is itself inside a dialog is two
                      frames too many, and it read as three unrelated settings
                      rather than one group. See SettingGroup in the kit for
                      the same shape at Settings-page density. */}
                  <div className="overflow-hidden rounded-md border divide-y divide-line-soft">
                    <OptionRow
                      label="Stop run if an error occurs"
                      checked={stopOnFailure}
                      onChange={setStopOnFailure}
                    />
                    <OptionRow
                      label="Save responses"
                      hint={
                        (dataRows?.length ?? 0) > LARGE_DATA_ROWS
                          ? `Off by default for ${dataRows!.length.toLocaleString()} rows — keeping every response in memory risks running out before the run finishes. Stats, pass/fail and the CSV/JSON export still cover every row either way.`
                          : 'Keep each response so you can open it afterwards.'
                      }
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
                </div>

                <div className="space-y-2">
                  <SectionLabel>Data file</SectionLabel>
                  {dataFile ? (
                    <div className="space-y-2 rounded-md border p-2">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-ok" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={dataFile.name}>{dataFile.name}</span>
                        <button onClick={() => { setDataFile(null); resetRun(); }} title="Remove" className="rounded p-0.5 text-fg-mute/60 hover:text-bad">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="text-[11px] text-fg-mute">
                        {dataFile.parsed.rows.length.toLocaleString()} row{dataFile.parsed.rows.length === 1 ? '' : 's'}
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
                      {dataFile.parsed.rows.length > 1 && (
                        <div className="flex items-center gap-1.5 border-t pt-2">
                          <label className="flex items-center gap-1.5 text-[11px] text-fg-mute">
                            <Checkbox
                              checked={rowLimit != null}
                              onCheckedChange={(v) => setRowLimit(v ? Math.min(10, dataFile.parsed.rows.length) : null)}
                            />
                            Test with only the first
                          </label>
                          <Input
                            value={rowLimit ?? ''}
                            onChange={(e) => {
                              const n = Math.max(1, Math.min(dataFile.parsed.rows.length, Number(e.target.value) || 1));
                              setRowLimit(n);
                            }}
                            disabled={rowLimit == null}
                            inputMode="numeric"
                            className="h-6 w-14 text-[11px] disabled:opacity-50"
                          />
                          <span className="text-[11px] text-fg-mute">
                            row{rowLimit === 1 ? '' : 's'} — verify the mapping before committing to all{' '}
                            {dataFile.parsed.rows.length.toLocaleString()}.
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={loadData}
                      disabled={parsingData}
                      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-2.5 text-xs text-fg-mute transition-colors hover:border-fg/30 hover:text-fg disabled:opacity-60"
                    >
                      {parsingData ? (
                        <><Spinner size="sm" /> Parsing file…</>
                      ) : (
                        <><FileSpreadsheet className="h-3.5 w-3.5" /> Select CSV or JSON file</>
                      )}
                    </button>
                  )}
                  {dataError && <p className="text-[11px] text-bad">{dataError}</p>}
                  {!dataFile && <p className="text-[11px] text-fg-mute">Binds each row's columns to <code className="rounded bg-bg-2 px-1">{'{{var}}'}</code>, one iteration per row. Handles large files (hundreds of thousands of rows) — parsing runs off the main thread so the dialog stays responsive.</p>}
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
                  <span className="flex items-center gap-1.5 font-medium"><ListChecks className="h-3.5 w-3.5" /> Requests <span className="text-fg-mute">· {selected.size}/{order.length}</span></span>
                  <button type="button" onClick={toggleAll} className="font-medium text-acc-ink hover:underline">
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
                        className={cn('group flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs hover:bg-acc/50', !checked && 'opacity-50')}
                      >
                        <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-fg-mute/30 group-hover:text-fg-mute/60" />
                        {/* Hàng bao ngoài đã bắt click (`onClick={() => toggle(req.id)}`),
                            nên ô tick chỉ VẼ trạng thái — `tabIndex={-1}` để nó
                            không thành một tab-stop thứ hai cho cùng một việc. */}
                        <Checkbox checked={checked} tabIndex={-1} aria-hidden="true" />
                        <span className={cn('w-12 shrink-0 font-bold uppercase', methodColor(req.method))}>{req.method}</span>
                        <span className="min-w-0 flex-1 truncate" title={req.url}>{req.name}</span>
                        {filteredOut && <span className="shrink-0 rounded bg-bg-2 px-1.5 py-0.5 text-[11px] text-fg-mute">filtered</span>}
                      </div>
                    );
                  })}
                  {order.length === 0 && <p className="px-4 py-6 text-center text-xs text-fg-mute">No requests to run.</p>}
                </div>
              </div>
            </div>

            {duplicateNames.length > 0 && (
              <div className="shrink-0 border-t px-4 py-2">
                <Callout tone="warning" size="sm">
                  Duplicate request name{duplicateNames.length === 1 ? '' : 's'} in this run:{' '}
                  <span className="font-mono">{duplicateNames.join(', ')}</span>. A script's{' '}
                  <code className="rounded bg-bg-2 px-1">setNextRequest(name)</code> always jumps to the
                  first match — rename one to make a flow-control jump to it unambiguous.
                </Callout>
              </div>
            )}

            {/* action bar */}
            <div className="flex shrink-0 items-center gap-3 border-t px-4 py-3">
              <Button onClick={run} disabled={plannedCount === 0} className="h-ctl-lg gap-1.5 px-4">
                <Play className="h-4 w-4" /> Run {plannedCount.toLocaleString()} request{plannedCount === 1 ? '' : 's'}
              </Button>
              <span className="text-xs text-fg-mute">
                {effective.length} selected × {iters.toLocaleString()} iteration{iters === 1 ? '' : 's'}
                {rowLimit != null && ` (of ${dataFile?.parsed.rows.length.toLocaleString()} rows)`}
              </span>
              <button onClick={resetAll} className="ml-auto flex items-center gap-1 text-xs font-medium text-fg-mute hover:text-fg">
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
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        disabled={totalRun === 0}
                        className="flex h-ctl items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors hover:bg-acc/50 disabled:pointer-events-none disabled:opacity-50"
                      >
                        <Download className="h-3.5 w-3.5" /> Export
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={exportResultsCsv}>
                          CSV — one row per request
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={exportResults}>
                          JSON — full detail (options, tests, responses kept)
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button onClick={run} size="sm" className="h-ctl gap-1.5">
                      <RotateCcw className="h-3.5 w-3.5" /> Run again
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* full breakdown of what the run measured */}
            {totalRun > 0 && (
              <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-1.5 text-[11px] text-fg-mute">
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium text-fg/70">Status</span>
                  {Object.entries(stats.byStatus)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([code, count]) => (
                      <span key={code} className="font-mono">
                        <span className={code === 'error' ? 'text-bad' : statusColor(Number(code))}>{code}</span>
                        <span className="text-fg-mute"> ×{count}</span>
                      </span>
                    ))}
                </span>
                <span>
                  <span className="font-medium text-fg/70">Response time</span>{' '}
                  min {stats.minMs} ms · avg {stats.avgMs} ms · max {stats.maxMs} ms
                </span>
                <span>
                  <span className="font-medium text-fg/70">Iterations</span>{' '}
                  {ranIters.toLocaleString()}/{iters.toLocaleString()}
                </span>
                {running && ranIters > 0 && elapsed > 0 && (
                  <span>
                    <span className="font-medium text-fg/70">Rate</span>{' '}
                    {(ranIters / (elapsed / 1000)).toFixed(1)} iter/s
                    {ranIters < iters && ` · ~${formatDuration(((iters - ranIters) / (ranIters / elapsed)))} left`}
                  </span>
                )}
              </div>
            )}

            {/* progress — fixed-height strip so the layout doesn't shift */}
            <div className="h-0.5 shrink-0 overflow-hidden bg-bg-2">
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
                <VirtualIterRail
                  count={Math.max(ranIters, running ? iters : 0)}
                  viewIter={viewIter}
                  onSelect={(i) => { followIterRef.current = false; setViewIter(i); }}
                  iterStats={iterStats}
                  dataRows={dataRows}
                />
              )}

              {/* request results / detail */}
              <div className="flex min-w-0 flex-1 flex-col">
                {detailRecord?.detail ? (
                  <RunDetailView entry={detailRecord.detail} onBack={() => setDetailKey(null)} />
                ) : (
                  <>
                    {dataRow && Object.keys(dataRow).length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 border-b bg-bg-2/20 px-3 py-2">
                        <SectionLabel>Data</SectionLabel>
                        {Object.entries(dataRow).map(([k, v]) => (
                          <span key={k} className="rounded bg-bg-2 px-1.5 py-0.5 font-mono text-[11px]"><span className="text-fg-mute">{k}=</span>{v}</span>
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
                              filter === f ? 'bg-acc text-fg' : 'text-fg-mute hover:text-fg')}
                          >
                            {f}
                          </button>
                        ))}
                        <span className="ml-auto text-[11px] text-fg-mute">
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
                          <span className="w-5 shrink-0"><Spinner size="sm" className="text-fg-mute" /></span>
                          <span className={cn('w-12 shrink-0 font-bold uppercase', methodColor(current.method))}>{current.method}</span>
                          <span className="min-w-0 flex-1 truncate font-medium text-fg-mute">{current.name}</span>
                        </div>
                      )}
                      {iterRecords.length === 0 && !running && (
                        <p className="px-4 py-6 text-center text-xs text-fg-mute">No requests ran.</p>
                      )}
                      {iterRecords.length > 0 && shown.length === 0 && (
                        <p className="px-4 py-6 text-center text-xs text-fg-mute">Nothing matches this filter.</p>
                      )}
                      {cappedIters.has(viewIter) && (
                        <p className="px-3 py-2 text-[11px] text-bad">
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

// ─── iteration rail (virtualized) ─────────────────────────────────────────────

// A data-driven run over a 100k-row file has up to 100k iterations. Rendering
// one button per iteration (the original implementation) means 100k live DOM
// nodes sitting in the dialog at once — the browser stalls just laying that
// out, long before the run itself is the bottleneck. This renders only the
// rows actually scrolled into view (plus a small overscan), backed by a
// spacer div so the scrollbar still reflects the true list length.
function VirtualIterRail({ count, viewIter, onSelect, iterStats, dataRows }: {
  count: number;
  viewIter: number;
  onSelect: (i: number) => void;
  iterStats: (i: number) => { ok: number; total: number };
  dataRows?: DataRow[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  // Large data-driven runs push a jump box (input + Go) above the rail —
  // scrolling to iteration #87,412 one screenful at a time isn't navigation.
  const [jumpTo, setJumpTo] = useState('');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setViewportH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the active row in view when navigation moved it here from outside
  // this list (the run auto-following its current iteration, or a jump).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const top = viewIter * ITER_ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ITER_ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ITER_ROW_H - el.clientHeight;
  }, [viewIter]);

  const overscan = 8;
  const start = Math.max(0, Math.floor(scrollTop / ITER_ROW_H) - overscan);
  const visible = Math.ceil((viewportH || 1) / ITER_ROW_H) + overscan * 2;
  const end = Math.min(count, start + visible);
  const rows: number[] = [];
  for (let i = start; i < end; i++) rows.push(i);

  const jump = () => {
    const n = Math.round(Number(jumpTo));
    if (!Number.isFinite(n) || n < 1 || n > count) return;
    onSelect(n - 1);
    setJumpTo('');
  };

  return (
    <div className="flex w-48 shrink-0 flex-col border-r">
      {count > 100 && (
        <div className="flex shrink-0 items-center gap-1 border-b p-1.5">
          <Input
            value={jumpTo}
            onChange={(e) => setJumpTo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && jump()}
            placeholder={`# 1–${count.toLocaleString()}`}
            inputMode="numeric"
            className="h-6 flex-1 text-[11px]"
          />
          <button onClick={jump} className="shrink-0 rounded px-1.5 py-1 text-[11px] font-medium text-fg-mute hover:bg-acc hover:text-fg">
            Go
          </button>
        </div>
      )}
      <div ref={containerRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-y-auto">
        <div style={{ height: count * ITER_ROW_H, position: 'relative' }}>
          {rows.map((i) => {
            const s = iterStats(i);
            const ok = s.total > 0 && s.ok === s.total;
            const row = dataRows?.[i];
            const labelVals = row ? Object.values(row).slice(0, 2).join(', ') : '';
            return (
              <button
                key={i}
                onClick={() => onSelect(i)}
                style={{ position: 'absolute', top: i * ITER_ROW_H, left: 0, right: 0, height: ITER_ROW_H }}
                className={cn('flex items-center gap-2 border-b px-3 py-2 text-left text-xs transition-colors hover:bg-acc/50',
                  i === viewIter && 'bg-acc')}
              >
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full',
                  s.total === 0 ? 'bg-fg-mute/30' : ok ? 'bg-ok' : 'bg-bad')} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Iteration {i + 1}</span>
                  {labelVals && <span className="block truncate text-[11px] text-fg-mute" title={labelVals}>{labelVals}</span>}
                </span>
                {s.total > 0 && <span className={cn('shrink-0 text-[11px]', ok ? 'text-ok' : 'text-bad')}>{s.ok}/{s.total}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
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
          r.detail ? 'cursor-pointer hover:bg-acc/50' : 'cursor-default')}
      >
        <span className="w-5 shrink-0">
          {ok ? <Check className="h-3.5 w-3.5 text-ok" /> : <X className="h-3.5 w-3.5 text-bad" />}
        </span>
        <span className={cn('w-12 shrink-0 font-bold uppercase', methodColor(r.method))}>{r.method}</span>
        <span className="min-w-0 flex-1 truncate font-medium" title={r.url}>{r.name}</span>
        {r.total > 0 && <span className={cn('shrink-0', r.passed === r.total ? 'text-ok' : 'text-bad')}>{r.passed}/{r.total} tests</span>}
        <span className={cn('w-12 shrink-0 text-right font-semibold', r.error ? 'text-bad' : statusColor(r.status))}>{r.error ? 'ERR' : r.status}</span>
        <span className="w-16 shrink-0 text-right text-fg-mute">{r.ms} ms</span>
        {r.detail && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-mute/30 group-hover:text-fg-mute" />}
      </button>
      {r.jump && (
        <p className={cn('flex items-center gap-1.5 px-3 pb-1.5 pl-10 text-[11px]',
          r.jump.missing ? 'text-bad' : 'text-fg-mute')}>
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
        <thead className="sticky top-0 bg-bg-2/60">
          <tr>
            <th className="border-b px-1.5 py-1 text-left font-semibold text-fg-mute">#</th>
            {cols.map((c) => <th key={c} className="border-b px-1.5 py-1 text-left font-mono font-semibold">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i} className="odd:bg-bg-2/20">
              <td className="px-1.5 py-0.5 text-fg-mute">{i + 1}</td>
              {cols.map((c) => <td key={c} className="max-w-[8rem] truncate px-1.5 py-0.5 font-mono" title={row[c]}>{row[c]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && <p className="px-1.5 py-1 text-[11px] text-fg-mute">+{rows.length - shown.length} more…</p>}
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
      {/* A Segmented sharing the header line, not a second tab strip of its
          own — ResponsePanel below brings its own row (Response / Headers /
          Timeline / Tests / Console), and two stacked tab rows leave it
          ambiguous which one a click acts on. HistoryView's detail pane, the
          same request-vs-response switch over the same ResponsePanel, already
          settled on exactly this; the Runner kept the stacked version. */}
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
        <button onClick={onBack} className="flex items-center gap-1 rounded px-1.5 py-1 text-fg-mute transition-colors hover:bg-acc hover:text-fg">
          <ChevronLeft className="h-3.5 w-3.5" /> Back
        </button>
        <span className={cn('font-bold uppercase', methodColor(request.method))}>{request.method}</span>
        <span className="min-w-0 truncate font-medium" title={request.name}>{request.name}</span>
        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          {result.response && <span className={cn('font-semibold', statusColor(status))}>{status}</span>}
          {result.error && <span className="font-semibold text-bad">ERR</span>}
          {result.response && <span className="font-mono text-fg-mute">{result.response.timeMs} ms</span>}
          <Segmented
            value={tab}
            onValueChange={setTab}
            size="sm"
            aria-label="Request or response"
            options={[{ value: 'request', label: 'Request' }, { value: 'response', label: 'Response' }]}
          />
        </div>
      </div>
      {tab === 'response' ? (
        <ResponsePanel
          response={result.response}
          sending={false}
          error={result.error}
          tests={result.tests}
          logs={result.logs}
          request={request}
        />
      ) : (
        <RequestDetail request={request} sentUrl={result.response?.url} dataVars={dataVars} />
      )}
    </div>
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
          <p className="mb-1 font-semibold text-fg-mute">Iteration data</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(dataVars).map(([k, v]) => (
              <span key={k} className="rounded bg-bg-2 px-1.5 py-0.5 font-mono text-[11px]"><span className="text-fg-mute">{k}=</span>{v}</span>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="mb-1 font-semibold text-fg-mute">URL</p>
        <p className="break-all font-mono">{sentUrl || sub(request.url) || '—'}</p>
      </div>
      <div>
        <p className="mb-1 font-semibold text-fg-mute">Headers</p>
        {headers.length === 0 ? <p className="text-fg-mute">No headers.</p> : (
          <div className="space-y-0.5 font-mono">
            {headers.map((h) => (
              <p key={h.id} className="break-all"><span className="text-fg-mute">{sub(h.key)}:</span> {sub(h.value)}</p>
            ))}
          </div>
        )}
      </div>
      <div>
        <p className="mb-1 font-semibold text-fg-mute">Body <span className="font-normal">({body.mode})</span></p>
        {bodyText ? <pre className="whitespace-pre-wrap break-all rounded bg-bg-2/40 p-2 font-mono">{sub(bodyText)}</pre> : <p className="text-fg-mute">No body.</p>}
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
    <label className="flex cursor-pointer items-start justify-between gap-3 px-3 py-2 transition-colors hover:bg-bg-2/40">
      <span className="min-w-0">
        <span className="block text-xs font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-fg-mute">{hint}</span>}
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
    return <p className="text-[11px] text-bad">No columns found — is the header row present?</p>;
  }
  return (
    <div className="overflow-hidden rounded border">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-x-2 border-b bg-bg-2/40 px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-mute">
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
                <span className="block truncate text-fg-mute" title={m.sample}>e.g. {m.sample}</span>
              )}
            </span>
            {m.used ? (
              <Check className="h-3 w-3 shrink-0 text-ok" aria-label="Used by the run" />
            ) : (
              <span className="shrink-0 rounded bg-bg-2 px-1 text-[11px] text-fg-mute" title="No selected request references this variable">
                unused
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
