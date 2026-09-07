// Runner result exports. Kept out of RunnerDialog so the row/column shape can
// be tested directly — the CSV is the format someone actually opens after a
// data-driven run over a large file, so a silently mis-escaped cell (a comma
// in an error message, a quote in a response) would corrupt the one artifact
// the run produced.

import { type RunRecord, isHttp2xx, isOk, statusKey } from './runnerStats';

// RFC 4180: quote a cell that contains the delimiter, a quote, or a newline,
// and double any quote inside it. `\r` counts too — left bare it would end
// the record early in Excel.
export function csvCell(v: unknown): string {
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

// One row per executed request, with the data file's columns spliced on so a
// failing row can be traced straight back to the CSV row that produced it.
// `dataColumns` is passed rather than derived from the records: a run whose
// early rows happen to have an empty column still needs that column present,
// and the column order should match the file, not first-seen order.
export function buildResultsCsv(records: RunRecord[], dataColumns: string[] = []): string {
  const lines = [[...CSV_COLUMNS, ...dataColumns].map(csvCell).join(',')];
  for (const r of records) {
    lines.push([
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
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
}
