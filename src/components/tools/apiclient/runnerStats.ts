// The shape of a Runner execution record and the statistics derived from a set
// of them. Kept out of the dialog so the aggregation can be tested directly.

import type { ExecResult } from './engine';
import type { JumpRequest } from './runnerFlow';
import type { ApiRequest, HttpMethod, LogEntry, TestResult, VarMap } from './types';

export interface RunDetail { request: ApiRequest; result: ExecResult; dataVars?: VarMap }

// One executed request. `step` is its position in the iteration's actual
// execution order, which is what makes a record unique when flow control causes
// the same request to run twice.
export interface RunRecord {
  key: string;
  iter: number;
  step: number;
  requestId: string;
  name: string;
  method: HttpMethod;
  url: string;
  status: number;
  statusText: string;
  ms: number;
  // Statistics are always collected, even when responses aren't kept, so a long
  // run still reports timing, size, and test outcomes in full.
  sizeBytes: number;
  ttfbMs?: number;
  downloadMs?: number;
  at: number;
  passed: number;
  total: number;
  error?: string | null;
  tests: TestResult[];
  logs: LogEntry[];
  dataVars?: VarMap;
  // Omitted when "Save responses" is off, so long runs don't hold every body.
  detail?: RunDetail;
  // Set when a script steered the run from this request.
  jump?: JumpRequest;
}

// A run counts as passed only when it got a 2xx/3xx response, raised no
// transport or script error, and every assertion it ran passed.
export const isOk = (r: RunRecord) => !r.error && r.status >= 200 && r.status < 400 && r.passed === r.total;

export interface RunStats {
  total: number;
  passed: number;
  failed: number;
  assertTotal: number;
  assertPassed: number;
  sumMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  totalBytes: number;
  /** Status code → how many responses carried it (0 = no response). */
  byStatus: Record<string, number>;
}

// Mutable running total, folded one record at a time. A data-driven run can
// produce tens of thousands of records; recomputing `summarize(records)` over
// the whole array after every single execution is O(n) per record and O(n²)
// over the run, which is fine at Runner's original demo scale but stalls the
// UI thread well before a 100k-row CSV run finishes. `fold` is the O(1)-per-
// record alternative — call it once as each record lands and read `toStats()`
// whenever the UI needs to render.
export interface RunStatsAcc {
  total: number; passed: number; failed: number;
  assertTotal: number; assertPassed: number;
  sumMs: number; minMs: number; maxMs: number;
  /** Records with a real response, i.e. status !== 0 — what timing stats are averaged over. */
  timed: number;
  totalBytes: number;
  byStatus: Record<string, number>;
}

export function newAcc(): RunStatsAcc {
  return {
    total: 0, passed: 0, failed: 0,
    assertTotal: 0, assertPassed: 0,
    sumMs: 0, minMs: 0, maxMs: 0, timed: 0,
    totalBytes: 0,
    byStatus: {},
  };
}

export function fold(acc: RunStatsAcc, r: RunRecord): void {
  acc.total++;
  if (isOk(r)) acc.passed++; else acc.failed++;
  acc.assertTotal += r.total;
  acc.assertPassed += r.passed;
  acc.totalBytes += r.sizeBytes;
  const code = r.status === 0 ? 'error' : String(r.status);
  acc.byStatus[code] = (acc.byStatus[code] ?? 0) + 1;
  if (r.status !== 0) {
    acc.timed++;
    acc.sumMs += r.ms;
    acc.minMs = acc.timed === 1 ? r.ms : Math.min(acc.minMs, r.ms);
    acc.maxMs = Math.max(acc.maxMs, r.ms);
  }
}

export function toStats(acc: RunStatsAcc): RunStats {
  return {
    total: acc.total, passed: acc.passed, failed: acc.failed,
    assertTotal: acc.assertTotal, assertPassed: acc.assertPassed,
    sumMs: acc.sumMs, avgMs: acc.timed ? Math.round(acc.sumMs / acc.timed) : 0,
    minMs: acc.minMs, maxMs: acc.maxMs,
    totalBytes: acc.totalBytes,
    byStatus: acc.byStatus,
  };
}

export function summarize(records: RunRecord[]): RunStats {
  const acc = newAcc();
  for (const r of records) fold(acc, r);
  return toStats(acc);
}
