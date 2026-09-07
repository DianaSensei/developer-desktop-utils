import { describe, expect, it } from 'vitest';
import {
  CSV_COLUMNS, FAILURE_LIST_CAP, buildResultsCsv, csvCell, csvChunks, failureEntries,
  jsonReportChunks, type RunReportHead,
} from './runnerExport';
import type { RunRecord } from './runnerStats';

function rec(over: Partial<RunRecord> = {}): RunRecord {
  const iter = over.iter ?? 0;
  const step = over.step ?? 0;
  return {
    key: `${iter}:${step}`,
    iter, step,
    requestId: 'req-1',
    name: 'Login',
    method: 'POST',
    url: 'https://example.test/login',
    status: 200,
    statusText: 'OK',
    ms: 12,
    sizeBytes: 340,
    at: 0,
    passed: 0,
    total: 0,
    tests: [],
    logs: [],
    ...over,
  };
}

const rows = (csv: string) => csv.split('\n');
const cells = (line: string) => line.split(',');

describe('csvCell', () => {
  it('leaves a plain value alone', () => {
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell(200)).toBe('200');
  });

  it('renders null/undefined as empty', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes a value containing the delimiter', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
  });

  it('doubles embedded quotes', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes newlines and carriage returns so a cell cannot end the record', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });
});

describe('buildResultsCsv', () => {
  it('emits a header even for an empty run', () => {
    const csv = buildResultsCsv([], []);
    expect(rows(csv)).toHaveLength(1);
    expect(cells(csv)).toEqual([...CSV_COLUMNS]);
  });

  it('appends the data file columns after the fixed ones, in file order', () => {
    const csv = buildResultsCsv([], ['userId', 'token']);
    expect(cells(rows(csv)[0])).toEqual([...CSV_COLUMNS, 'userId', 'token']);
  });

  it('writes one row per record with 1-based iteration and step', () => {
    const csv = buildResultsCsv([
      rec({ iter: 0, step: 0 }),
      rec({ iter: 41, step: 2 }),
    ]);
    const body = rows(csv).slice(1);
    expect(body).toHaveLength(2);
    expect(cells(body[0]).slice(0, 2)).toEqual(['1', '1']);
    expect(cells(body[1]).slice(0, 2)).toEqual(['42', '3']);
  });

  it('tracks the response code, its reason phrase and the outcome', () => {
    const csv = buildResultsCsv([rec({ status: 503, statusText: 'Service Unavailable' })]);
    const row = cells(rows(csv)[1]);
    expect(row[CSV_COLUMNS.indexOf('status')]).toBe('503');
    expect(row[CSV_COLUMNS.indexOf('statusText')]).toBe('Service Unavailable');
    expect(row[CSV_COLUMNS.indexOf('outcome')]).toBe('fail');
  });

  it('marks a request that never responded as "error", not 0', () => {
    const csv = buildResultsCsv([rec({ status: 0, statusText: '', error: 'ECONNREFUSED' })]);
    const row = cells(rows(csv)[1]);
    expect(row[CSV_COLUMNS.indexOf('status')]).toBe('error');
    expect(row[CSV_COLUMNS.indexOf('httpOk')]).toBe('no');
    expect(row[CSV_COLUMNS.indexOf('error')]).toBe('ECONNREFUSED');
  });

  it('carries an httpOk column so HTTP failures filter without reading codes', () => {
    const csv = buildResultsCsv([
      rec({ status: 200 }),
      rec({ step: 1, status: 302, statusText: 'Found' }),
      rec({ step: 2, status: 500, statusText: 'Server Error' }),
    ]);
    const httpOk = rows(csv).slice(1).map((l) => cells(l)[CSV_COLUMNS.indexOf('httpOk')]);
    // Only 2xx is a yes — a redirect is not an HTTP success here.
    expect(httpOk).toEqual(['yes', 'no', 'no']);
  });

  it('keeps httpOk and outcome independent', () => {
    // 2xx, but a scripted assertion failed: HTTP fine, run failed.
    const csv = buildResultsCsv([rec({
      status: 200,
      passed: 0,
      total: 1,
      tests: [{ name: 'body has id', passed: false }],
    })]);
    const row = cells(rows(csv)[1]);
    expect(row[CSV_COLUMNS.indexOf('httpOk')]).toBe('yes');
    expect(row[CSV_COLUMNS.indexOf('outcome')]).toBe('fail');
  });

  it('marks a 2xx with a failing assertion as a fail and names the assertion', () => {
    const csv = buildResultsCsv([rec({
      status: 200,
      passed: 1,
      total: 2,
      tests: [
        { name: 'status is 200', passed: true },
        { name: 'body has id', passed: false, error: 'expected id' },
      ],
    })]);
    const row = cells(rows(csv)[1]);
    expect(row[CSV_COLUMNS.indexOf('outcome')]).toBe('fail');
    expect(row[CSV_COLUMNS.indexOf('failedAssertions')]).toBe('body has id');
  });

  it('binds each row back to the data-file values that produced it', () => {
    const csv = buildResultsCsv(
      [rec({ dataVars: { userId: '42', token: 'abc' } })],
      ['userId', 'token'],
    );
    expect(cells(rows(csv)[1]).slice(-2)).toEqual(['42', 'abc']);
  });

  it('leaves a data column empty when the row did not supply it', () => {
    const csv = buildResultsCsv([rec({ dataVars: { userId: '42' } })], ['userId', 'missing']);
    expect(cells(rows(csv)[1]).slice(-2)).toEqual(['42', '']);
  });

  it('escapes a response value that would otherwise break the row', () => {
    const csv = buildResultsCsv([rec({ error: 'bad request, retry "later"' })]);
    // One record is still exactly one line: the comma inside the error is quoted.
    expect(rows(csv)).toHaveLength(2);
    expect(csv).toContain('"bad request, retry ""later"""');
  });
});

// The exports stream in chunks so a 100k-row run never has to exist as one
// string. What matters is that chunking changes nothing about the result.
describe('csvChunks', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => rec({ iter: i, status: i % 3 ? 200 : 500 }));

  it('joins back into exactly what buildResultsCsv produces', () => {
    const records = many(5);
    expect([...csvChunks(records, ['userId'])].join('')).toBe(buildResultsCsv(records, ['userId']));
  });

  it('emits more than one chunk once the run is large, and still one line per record', () => {
    const records = many(5000);
    const chunks = [...csvChunks(records)];
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('').split('\n')).toHaveLength(5001); // header + 5000 rows
  });

  it('emits just the header for an empty run', () => {
    expect([...csvChunks([])].join('')).toBe([...CSV_COLUMNS].join(','));
  });
});

describe('failureEntries', () => {
  it('indexes only the failures, counting them all', () => {
    const { failures, failuresTotal, failuresTruncated } = failureEntries([
      rec({ status: 200 }),
      rec({ step: 1, status: 500 }),
      rec({ step: 2, status: 0, error: 'boom' }),
    ]);
    expect(failures).toHaveLength(2);
    expect(failuresTotal).toBe(2);
    expect(failuresTruncated).toBe(false);
  });

  it('caps the list but keeps the true total, so a mostly-failing run cannot repeat itself', () => {
    const records = Array.from({ length: FAILURE_LIST_CAP + 250 }, (_, i) => rec({ iter: i, status: 500 }));
    const { failures, failuresTotal, failuresTruncated } = failureEntries(records);
    expect(failures).toHaveLength(FAILURE_LIST_CAP);
    expect(failuresTotal).toBe(FAILURE_LIST_CAP + 250);
    expect(failuresTruncated).toBe(true);
  });
});

describe('jsonReportChunks', () => {
  const head: RunReportHead = {
    collection: 'My collection',
    startedAt: '2026-09-07T00:00:00.000Z',
    finishedAt: '2026-09-07T00:01:00.000Z',
    durationMs: 60_000,
    options: { iterations: 3, nested: { deep: true } },
    summary: { requests: { executed: 3 } },
  };
  const parse = (records: RunRecord[]) => JSON.parse([...jsonReportChunks(head, records)].join(''));

  it('produces valid JSON with the head intact', () => {
    const report = parse([rec({ status: 200 })]);
    expect(report.collection).toBe('My collection');
    expect(report.durationMs).toBe(60_000);
    // Nested structures in the head survive — it is still JSON.stringify's work.
    expect(report.options.nested).toEqual({ deep: true });
    expect(report.summary.requests.executed).toBe(3);
  });

  it('is valid JSON with no runs at all', () => {
    expect(parse([]).runs).toEqual([]);
  });

  it('stays valid across chunk boundaries for a large run', () => {
    // Well past JSON_RUNS_PER_CHUNK, so the batching seam is exercised.
    const records = Array.from({ length: 1200 }, (_, i) => rec({ iter: i, status: i % 2 ? 200 : 404 }));
    const chunks = [...jsonReportChunks(head, records)];
    expect(chunks.length).toBeGreaterThan(2);
    const report = JSON.parse(chunks.join(''));
    expect(report.runs).toHaveLength(1200);
    expect(report.runs[0].iteration).toBe(1);
    expect(report.runs[1199].iteration).toBe(1200);
  });

  it('records the HTTP verdict and outcome per run', () => {
    const report = parse([
      rec({ status: 200 }),
      rec({ step: 1, status: 302, statusText: 'Found' }),
      rec({ step: 2, status: 0, error: 'ECONNREFUSED' }),
    ]);
    expect(report.runs[0]).toMatchObject({ httpOk: true, outcome: 'pass' });
    expect(report.runs[1]).toMatchObject({ httpOk: false, status: 302, outcome: 'pass' });
    expect(report.runs[2]).toMatchObject({ httpOk: false, outcome: 'fail', error: 'ECONNREFUSED' });
  });

  it('carries the iteration data that produced each run', () => {
    const report = parse([rec({ dataVars: { userId: '7' } })]);
    expect(report.runs[0].iterationData).toEqual({ userId: '7' });
  });
});
