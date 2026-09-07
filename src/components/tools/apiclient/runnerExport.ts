// Runner result exports. Kept out of RunnerDialog so the row/column shape can
// be tested directly — the CSV is the format someone actually opens after a
// data-driven run over a large file, so a silently mis-escaped cell (a comma
// in an error message, a quote in a response) would corrupt the one artifact
// the run produced.
//
// Both formats are produced as **generators of chunks**, never as one string.
// A 100k-row data file run yields one record per request per row: serialising
// that into a single `JSON.stringify` (or one `lines.join('\n')`) means
// holding the entire report — hundreds of MB for a run that kept responses —
// in one contiguous JS string before a single byte reaches disk, which is how
// an export of exactly the run you most wanted to keep ends up being the one
// that runs out of memory. Chunking also lets the writer flush and let the UI
// breathe between batches (see saveStreamedTextFile in fileio.ts).

import { type RunRecord, isHttp2xx, isOk, statusKey } from './runnerStats';

// RFC 4180: quote a cell that contains the delimiter, a quote, or a newline,
// and double any quote inside it. `\r` counts too — left bare it would end
// the record early in Excel.
// `string | number` rather than `unknown`: a cell is text or a count, and an
// object reaching here would silently become "[object Object]" in the file
// instead of failing at the call site.
export type CsvValue = string | number | null | undefined;

export function csvCell(v: CsvValue): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// `httpOk` and `outcome` are deliberately separate columns: httpOk is the
// HTTP verdict alone (2xx or not), outcome folds in assertions too. Filtering
// a sheet for "which calls actually failed at the HTTP level" is the common
// case, and it shouldn't require reading status codes by eye.
export const CSV_COLUMNS = [
  'iteration', 'step', 'name', 'method', 'url',
  'status', 'statusText', 'httpOk', 'outcome', 'timeMs', 'ttfbMs', 'sizeBytes',
  'assertionsPassed', 'assertionsTotal', 'failedAssertions', 'error',
] as const;

/** Records per emitted chunk. Big enough that the per-chunk overhead is
 *  irrelevant, small enough that no single string gets unwieldy. */
const CSV_ROWS_PER_CHUNK = 2000;
const JSON_RUNS_PER_CHUNK = 500;

function csvRow(r: RunRecord, dataColumns: string[]): string {
  return [
    r.iter + 1,
    r.step + 1,
    r.name,
    r.method,
    r.url,
    // 'error' rather than 0 for a request that never got a response, so a
    // spreadsheet filter on status can tell "no response" from a real code.
    statusKey(r),
    r.statusText,
    isHttp2xx(r.status) ? 'yes' : 'no',
    isOk(r) ? 'pass' : 'fail',
    r.ms,
    r.ttfbMs ?? '',
    r.sizeBytes,
    r.passed,
    r.total,
    r.tests.filter((t) => !t.passed).map((t) => t.name).join(' | '),
    r.error ?? '',
    ...dataColumns.map((c) => r.dataVars?.[c] ?? ''),
  ].map(csvCell).join(',');
}

// One row per executed request, with the data file's columns spliced on so a
// failing row can be traced straight back to the CSV row that produced it.
// `dataColumns` is passed rather than derived from the records: a run whose
// early rows happen to have an empty column still needs that column present,
// and the column order should match the file, not first-seen order.
export function* csvChunks(records: RunRecord[], dataColumns: string[] = []): Generator<string> {
  yield [...CSV_COLUMNS, ...dataColumns].map(csvCell).join(',');
  let batch: string[] = [];
  for (const r of records) {
    batch.push(csvRow(r, dataColumns));
    if (batch.length >= CSV_ROWS_PER_CHUNK) {
      yield `\n${batch.join('\n')}`;
      batch = [];
    }
  }
  if (batch.length) yield `\n${batch.join('\n')}`;
}

/** The whole CSV as one string. Convenience for tests and small runs; the
 *  export path itself streams `csvChunks` straight to disk. */
export function buildResultsCsv(records: RunRecord[], dataColumns: string[] = []): string {
  return [...csvChunks(records, dataColumns)].join('');
}

// ─── JSON report ──────────────────────────────────────────────────────────────

/** Everything about the run that isn't a per-execution record. Built by the
 *  dialog (it owns the options and the stats) and serialised here. */
export interface RunReportHead {
  collection: string;
  startedAt: string | null;
  finishedAt: string;
  durationMs: number;
  options: Record<string, unknown>;
  summary: Record<string, unknown>;
}

// The embedded failure list is a convenience index into `runs`, not new data,
// so it is capped: a run where 60k of 100k rows failed would otherwise repeat
// most of the report inside its own summary.
export const FAILURE_LIST_CAP = 1000;

export function failureEntries(records: RunRecord[]): {
  failures: unknown[]; failuresTruncated: boolean; failuresTotal: number;
} {
  const failures: unknown[] = [];
  let total = 0;
  for (const r of records) {
    if (isOk(r)) continue;
    total++;
    if (failures.length >= FAILURE_LIST_CAP) continue;
    failures.push({
      iteration: r.iter + 1,
      step: r.step + 1,
      name: r.name,
      status: r.status,
      error: r.error ?? undefined,
      failedTests: r.tests.filter((t) => !t.passed).map((t) => ({ name: t.name, error: t.error })),
    });
  }
  return { failures, failuresTruncated: total > failures.length, failuresTotal: total };
}

export function runEntry(r: RunRecord): Record<string, unknown> {
  return {
    iteration: r.iter + 1,
    step: r.step + 1,
    at: new Date(r.at).toISOString(),
    name: r.name,
    method: r.method,
    url: r.url,
    status: r.status,
    statusText: r.statusText,
    httpOk: isHttp2xx(r.status),
    outcome: isOk(r) ? 'pass' : 'fail',
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
  };
}

// Emits the report as valid JSON without ever building it whole: the head is
// serialised once, then `runs` is streamed a batch of entries at a time.
export function* jsonReportChunks(head: RunReportHead, records: RunRecord[]): Generator<string> {
  // Serialise the head as an object, then splice `runs` in before its closing
  // brace — so the head's own formatting (and any nesting inside it) still
  // comes from JSON.stringify rather than hand-written JSON.
  const headJson = JSON.stringify(head, null, 2);
  yield `${headJson.slice(0, headJson.lastIndexOf('}'))},\n  "runs": [`;

  let batch: string[] = [];
  let first = true;
  const flush = () => {
    const text = (first ? '\n' : ',\n') + batch.join(',\n');
    first = false;
    batch = [];
    return text;
  };
  for (const r of records) {
    // Indented to sit inside "runs": [ … ] at the same depth JSON.stringify
    // would have produced.
    batch.push(JSON.stringify(runEntry(r), null, 2).split('\n').map((l) => `    ${l}`).join('\n'));
    if (batch.length >= JSON_RUNS_PER_CHUNK) yield flush();
  }
  if (batch.length) yield flush();
  yield first ? ']\n}\n' : '\n  ]\n}\n';
}
