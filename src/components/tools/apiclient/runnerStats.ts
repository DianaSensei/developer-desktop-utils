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

export function summarize(records: RunRecord[]): RunStats {
  const stats: RunStats = {
    total: records.length,
    passed: 0, failed: 0,
    assertTotal: 0, assertPassed: 0,
    sumMs: 0, avgMs: 0, minMs: 0, maxMs: 0,
    totalBytes: 0,
    byStatus: {},
  };
  // Only responses that arrived count towards timing, so a connection failure
  // doesn't drag the average down to zero.
  let timed = 0;
  for (const r of records) {
    if (isOk(r)) stats.passed++; else stats.failed++;
    stats.assertTotal += r.total;
    stats.assertPassed += r.passed;
    stats.totalBytes += r.sizeBytes;
    const code = r.status === 0 ? 'error' : String(r.status);
    stats.byStatus[code] = (stats.byStatus[code] ?? 0) + 1;
    if (r.status !== 0) {
      timed++;
      stats.sumMs += r.ms;
      stats.minMs = timed === 1 ? r.ms : Math.min(stats.minMs, r.ms);
      stats.maxMs = Math.max(stats.maxMs, r.ms);
    }
  }
  stats.avgMs = timed ? Math.round(stats.sumMs / timed) : 0;
  return stats;
}
