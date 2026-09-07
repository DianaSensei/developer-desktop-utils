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
//
// Note the 3xx: this predicate stays deliberately lenient about redirects,
// because "only 2xx counts" is expressed as the built-in assertion below
// rather than baked in here — a run with that assertion off keeps the older,
// more forgiving meaning.
export const isOk = (r: RunRecord) => !r.error && r.status >= 200 && r.status < 400 && r.passed === r.total;

/** Success in the HTTP sense alone — no assertion, no transport error. */
export const isHttp2xx = (status: number) => status >= 200 && status < 300;

// The built-in "did this request even succeed" assertion. Most collections
// only ever want "2xx and I'm happy", and writing that same test into every
// single request is busywork the Runner can do for them — so it is on by
// default (the `Require HTTP 2xx` option) and behaves exactly like a scripted
// assertion: it shows in the Tests tab, counts towards the assertion totals,
// fails the execution, and lands in both exports. Named so a reader can tell
// it apart from something they wrote.
export const HTTP_OK_TEST_NAME = 'HTTP status is 2xx (built-in)';

export function httpOkTest(status: number, statusText: string, error?: string | null): TestResult {
  if (isHttp2xx(status)) return { name: HTTP_OK_TEST_NAME, passed: true };
  return {
    name: HTTP_OK_TEST_NAME,
    passed: false,
    error: status === 0
      ? `No response${error ? `: ${error}` : ''}`
      : `Expected 2xx, got ${status}${statusText ? ` ${statusText}` : ''}`,
  };
}

// How one request behaved across every iteration it ran in. A data-driven run
// executes the same handful of requests thousands of times, so "which request
// is returning the 500s" is a question the per-iteration view can't answer —
// it only ever shows one iteration at a time. This is the rollup that can.
export interface RequestStats {
  requestId: string;
  name: string;
  method: HttpMethod;
  total: number;
  passed: number;
  failed: number;
  /** Executions that came back 2xx — HTTP success on its own terms. */
  http2xx: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  /** Status code → how many of this request's responses carried it. */
  byStatus: Record<string, number>;
  /** Status code → iterations where *this* request returned it (capped). */
  statusSamples: Record<string, number[]>;
}

export interface RunStats {
  total: number;
  passed: number;
  failed: number;
  // HTTP success counted on its own, separately from passed/failed: a run can
  // be 2xx everywhere and still fail assertions, and the two answer different
  // questions ("is the endpoint up" vs "is the response right").
  http2xx: number;
  assertTotal: number;
  assertPassed: number;
  sumMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  totalBytes: number;
  /** Status code → how many responses carried it (0 = no response). */
  byStatus: Record<string, number>;
  /** Per-request rollup, in the order each request first executed. */
  byRequest: RequestStats[];
  // Status code → the first STATUS_SAMPLE_CAP iterations that produced it.
  // Bounded on purpose: over 100k iterations an unbounded index of "which
  // iterations returned 500" is itself a memory leak, and a hundred examples
  // is already more than anyone clicks through. It exists to answer "show me
  // where this code happened" — the counts in byStatus stay exact regardless.
  statusSamples: Record<string, number[]>;
}

export const STATUS_SAMPLE_CAP = 100;

/** The bucket key a record counts towards: its status code, or 'error' when
 *  the request never came back with one (transport failure, abort, throw). */
export const statusKey = (r: RunRecord): string => (r.status === 0 ? 'error' : String(r.status));

/** Per-request running total. `timed` is the divisor for avgMs — see RunStatsAcc. */
interface RequestAcc {
  requestId: string;
  name: string;
  method: HttpMethod;
  total: number; passed: number; failed: number; http2xx: number;
  sumMs: number; minMs: number; maxMs: number; timed: number;
  byStatus: Record<string, number>;
  statusSamples: Map<string, number[]>;
}

// Appends `iter` to a capped, iteration-deduplicated sample list. Shared by
// the run-wide and per-request indexes so both bound the same way.
function sample(index: Map<string, number[]>, code: string, iter: number): void {
  const existing = index.get(code);
  if (!existing) index.set(code, [iter]);
  // One entry per iteration: the same code twice in one iteration (two
  // requests, or a flow-control repeat) shouldn't spend two sample slots.
  else if (existing.length < STATUS_SAMPLE_CAP && existing[existing.length - 1] !== iter) existing.push(iter);
}

// Mutable running total, folded one record at a time. A data-driven run can
// produce tens of thousands of records; recomputing `summarize(records)` over
// the whole array after every single execution is O(n) per record and O(n²)
// over the run, which is fine at Runner's original demo scale but stalls the
// UI thread well before a 100k-row CSV run finishes. `fold` is the O(1)-per-
// record alternative — call it once as each record lands and read `toStats()`
// whenever the UI needs to render.
export interface RunStatsAcc {
  total: number; passed: number; failed: number; http2xx: number;
  assertTotal: number; assertPassed: number;
  sumMs: number; minMs: number; maxMs: number;
  /** Records with a real response, i.e. status !== 0 — what timing stats are averaged over. */
  timed: number;
  totalBytes: number;
  byStatus: Record<string, number>;
  /** Keyed by requestId; insertion order is first-executed order. */
  byRequest: Map<string, RequestAcc>;
  /** Status code → iterations that produced it, capped at STATUS_SAMPLE_CAP. */
  statusSamples: Map<string, number[]>;
}

export function newAcc(): RunStatsAcc {
  return {
    total: 0, passed: 0, failed: 0, http2xx: 0,
    assertTotal: 0, assertPassed: 0,
    sumMs: 0, minMs: 0, maxMs: 0, timed: 0,
    totalBytes: 0,
    byStatus: {},
    byRequest: new Map(),
    statusSamples: new Map(),
  };
}

export function fold(acc: RunStatsAcc, r: RunRecord): void {
  const ok = isOk(r);
  const code = statusKey(r);

  acc.total++;
  if (ok) acc.passed++; else acc.failed++;
  if (isHttp2xx(r.status)) acc.http2xx++;
  acc.assertTotal += r.total;
  acc.assertPassed += r.passed;
  acc.totalBytes += r.sizeBytes;
  acc.byStatus[code] = (acc.byStatus[code] ?? 0) + 1;
  if (r.status !== 0) {
    acc.timed++;
    acc.sumMs += r.ms;
    acc.minMs = acc.timed === 1 ? r.ms : Math.min(acc.minMs, r.ms);
    acc.maxMs = Math.max(acc.maxMs, r.ms);
  }

  let req = acc.byRequest.get(r.requestId);
  if (!req) {
    req = {
      requestId: r.requestId, name: r.name, method: r.method,
      total: 0, passed: 0, failed: 0, http2xx: 0,
      sumMs: 0, minMs: 0, maxMs: 0, timed: 0,
      byStatus: {},
      statusSamples: new Map(),
    };
    acc.byRequest.set(r.requestId, req);
  }
  req.total++;
  if (ok) req.passed++; else req.failed++;
  if (isHttp2xx(r.status)) req.http2xx++;
  req.byStatus[code] = (req.byStatus[code] ?? 0) + 1;
  if (r.status !== 0) {
    req.timed++;
    req.sumMs += r.ms;
    req.minMs = req.timed === 1 ? r.ms : Math.min(req.minMs, r.ms);
    req.maxMs = Math.max(req.maxMs, r.ms);
  }

  sample(acc.statusSamples, code, r.iter);
  sample(req.statusSamples, code, r.iter);
}

export function toStats(acc: RunStatsAcc): RunStats {
  const byRequest: RequestStats[] = [];
  for (const req of acc.byRequest.values()) {
    byRequest.push({
      requestId: req.requestId, name: req.name, method: req.method,
      total: req.total, passed: req.passed, failed: req.failed, http2xx: req.http2xx,
      avgMs: req.timed ? Math.round(req.sumMs / req.timed) : 0,
      minMs: req.minMs, maxMs: req.maxMs,
      byStatus: req.byStatus,
      statusSamples: Object.fromEntries(req.statusSamples),
    });
  }
  return {
    total: acc.total, passed: acc.passed, failed: acc.failed, http2xx: acc.http2xx,
    assertTotal: acc.assertTotal, assertPassed: acc.assertPassed,
    sumMs: acc.sumMs, avgMs: acc.timed ? Math.round(acc.sumMs / acc.timed) : 0,
    minMs: acc.minMs, maxMs: acc.maxMs,
    totalBytes: acc.totalBytes,
    byStatus: acc.byStatus,
    byRequest,
    statusSamples: Object.fromEntries(acc.statusSamples),
  };
}

export function summarize(records: RunRecord[]): RunStats {
  const acc = newAcc();
  for (const r of records) fold(acc, r);
  return toStats(acc);
}
