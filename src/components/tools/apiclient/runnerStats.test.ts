import { describe, expect, it } from 'vitest';
import { isOk, summarize, type RunRecord } from './runnerStats';

let seq = 0;
const rec = (over: Partial<RunRecord> = {}): RunRecord => {
  const step = seq++;
  return {
    key: `0:${step}`,
    iter: 0,
    step,
    requestId: `r${step}`,
    name: `Request ${step}`,
    method: 'GET',
    url: 'https://api.test/x',
    status: 200,
    statusText: 'OK',
    ms: 100,
    sizeBytes: 1000,
    at: 0,
    passed: 0,
    total: 0,
    tests: [],
    logs: [],
    ...over,
  };
};

describe('isOk', () => {
  it('accepts a 2xx with all assertions passing', () => {
    expect(isOk(rec({ status: 200, passed: 3, total: 3 }))).toBe(true);
  });

  it('accepts a 3xx', () => {
    expect(isOk(rec({ status: 302 }))).toBe(true);
  });

  it('rejects a 4xx and a 5xx', () => {
    expect(isOk(rec({ status: 404 }))).toBe(false);
    expect(isOk(rec({ status: 500 }))).toBe(false);
  });

  it('rejects a 2xx with a failing assertion', () => {
    expect(isOk(rec({ status: 200, passed: 2, total: 3 }))).toBe(false);
  });

  it('rejects anything carrying an error, even with a good status', () => {
    expect(isOk(rec({ status: 200, error: 'script blew up' }))).toBe(false);
  });

  it('rejects a transport failure', () => {
    expect(isOk(rec({ status: 0, error: 'connection refused' }))).toBe(false);
  });
});

describe('summarize', () => {
  it('reports zeroes for an empty run', () => {
    const s = summarize([]);
    expect(s).toMatchObject({
      total: 0, passed: 0, failed: 0,
      assertTotal: 0, assertPassed: 0,
      avgMs: 0, minMs: 0, maxMs: 0, totalBytes: 0, byStatus: {},
    });
  });

  it('counts passes and failures', () => {
    const s = summarize([
      rec({ status: 200 }),
      rec({ status: 500 }),
      rec({ status: 201, passed: 1, total: 1 }),
    ]);
    expect(s.total).toBe(3);
    expect(s.passed).toBe(2);
    expect(s.failed).toBe(1);
  });

  it('totals assertions across executions', () => {
    const s = summarize([rec({ passed: 2, total: 3 }), rec({ passed: 1, total: 1 })]);
    expect(s.assertTotal).toBe(4);
    expect(s.assertPassed).toBe(3);
  });

  it('computes min / avg / max / total response time', () => {
    const s = summarize([rec({ ms: 50 }), rec({ ms: 150 }), rec({ ms: 100 })]);
    expect(s.minMs).toBe(50);
    expect(s.maxMs).toBe(150);
    expect(s.avgMs).toBe(100);
    expect(s.sumMs).toBe(300);
  });

  it('excludes failed sends from the timing average', () => {
    // A connection failure has no response time; averaging its 0 in would
    // understate how slow the endpoint actually was.
    const s = summarize([
      rec({ ms: 100 }),
      rec({ ms: 200 }),
      rec({ status: 0, ms: 0, error: 'connection refused' }),
    ]);
    expect(s.avgMs).toBe(150);
    expect(s.minMs).toBe(100);
    expect(s.maxMs).toBe(200);
  });

  it('reports zero timing when nothing got a response', () => {
    const s = summarize([rec({ status: 0, ms: 0, error: 'nope' })]);
    expect(s.avgMs).toBe(0);
    expect(s.minMs).toBe(0);
    expect(s.maxMs).toBe(0);
  });

  it('sums the bytes received', () => {
    expect(summarize([rec({ sizeBytes: 1024 }), rec({ sizeBytes: 512 })]).totalBytes).toBe(1536);
  });

  it('breaks executions down by status code', () => {
    const s = summarize([
      rec({ status: 200 }), rec({ status: 200 }), rec({ status: 404 }),
      rec({ status: 0, error: 'boom' }),
    ]);
    expect(s.byStatus).toEqual({ '200': 2, '404': 1, error: 1 });
  });

  it('counts statistics even for records with no saved response detail', () => {
    // "Save responses" off still has to produce a full statistical picture.
    const s = summarize([rec({ status: 200, ms: 42, sizeBytes: 99, passed: 1, total: 1 })]);
    expect(s).toMatchObject({ total: 1, passed: 1, avgMs: 42, totalBytes: 99, assertPassed: 1 });
  });
});
