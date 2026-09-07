import { describe, expect, it } from 'vitest';
import { CSV_COLUMNS, buildResultsCsv, csvCell } from './runnerExport';
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
    expect(row[CSV_COLUMNS.indexOf('error')]).toBe('ECONNREFUSED');
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
