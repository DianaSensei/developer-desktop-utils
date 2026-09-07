import { describe, expect, it } from 'vitest';
import {
  type RunRecord, HTTP_OK_TEST_NAME, STATUS_SAMPLE_CAP, fold, httpOkTest, isHttp2xx, isOk,
  newAcc, statusKey, summarize, toStats,
} from './runnerStats';

// Minimal record factory — the fields the aggregation actually reads.
function rec(over: Partial<RunRecord> = {}): RunRecord {
  const iter = over.iter ?? 0;
  const step = over.step ?? 0;
  return {
    key: `${iter}:${step}`,
    iter, step,
    requestId: 'req-1',
    name: 'Login',
    method: 'GET',
    url: 'https://example.test/login',
    status: 200,
    statusText: 'OK',
    ms: 10,
    sizeBytes: 100,
    at: 0,
    passed: 0,
    total: 0,
    tests: [],
    logs: [],
    ...over,
  };
}

describe('isOk', () => {
  it('passes a 2xx with every assertion green', () => {
    expect(isOk(rec({ status: 200, passed: 2, total: 2 }))).toBe(true);
  });

  it('passes a 3xx', () => {
    expect(isOk(rec({ status: 302 }))).toBe(true);
  });

  it('fails a 4xx/5xx even with no assertions', () => {
    expect(isOk(rec({ status: 404 }))).toBe(false);
    expect(isOk(rec({ status: 500 }))).toBe(false);
  });

  it('fails a 2xx with a failing assertion', () => {
    expect(isOk(rec({ status: 200, passed: 1, total: 2 }))).toBe(false);
  });

  it('fails a transport error regardless of status', () => {
    expect(isOk(rec({ status: 0, error: 'ECONNREFUSED' }))).toBe(false);
  });

  it('fails anything carrying an error, even with a good status', () => {
    // A script that threw after a 200 came back is still a failed run.
    expect(isOk(rec({ status: 200, error: 'script blew up' }))).toBe(false);
  });
});

describe('httpOkTest — the built-in "2xx or it failed" assertion', () => {
  it('passes any 2xx', () => {
    expect(httpOkTest(200, 'OK')).toEqual({ name: HTTP_OK_TEST_NAME, passed: true });
    expect(httpOkTest(204, 'No Content').passed).toBe(true);
    expect(httpOkTest(299, '').passed).toBe(true);
  });

  it('fails a redirect — only 2xx counts as HTTP success', () => {
    const t = httpOkTest(302, 'Found');
    expect(t.passed).toBe(false);
    expect(t.error).toBe('Expected 2xx, got 302 Found');
  });

  it('fails a 4xx/5xx and names what came back instead', () => {
    expect(httpOkTest(404, 'Not Found').error).toBe('Expected 2xx, got 404 Not Found');
    expect(httpOkTest(500, '').error).toBe('Expected 2xx, got 500');
  });

  it('fails a request that never got a response, carrying the transport error', () => {
    expect(httpOkTest(0, '', 'ECONNREFUSED').error).toBe('No response: ECONNREFUSED');
    expect(httpOkTest(0, '').error).toBe('No response');
  });

  it('reads as built-in, so nobody mistakes it for an assertion they wrote', () => {
    expect(HTTP_OK_TEST_NAME).toContain('built-in');
  });
});

describe('isHttp2xx', () => {
  it('accepts only the 2xx range', () => {
    expect(isHttp2xx(200)).toBe(true);
    expect(isHttp2xx(299)).toBe(true);
    expect(isHttp2xx(199)).toBe(false);
    expect(isHttp2xx(302)).toBe(false);
    expect(isHttp2xx(404)).toBe(false);
    expect(isHttp2xx(0)).toBe(false);
  });
});

describe('statusKey', () => {
  it('uses the code for a real response', () => {
    expect(statusKey(rec({ status: 503 }))).toBe('503');
  });

  it('buckets a request that never got a response under "error"', () => {
    expect(statusKey(rec({ status: 0, error: 'timeout' }))).toBe('error');
  });
});

describe('fold / toStats', () => {
  it('matches summarize over the same records (the incremental path is the fast one)', () => {
    const records = [
      rec({ iter: 0, step: 0, status: 200, ms: 10, passed: 1, total: 1 }),
      rec({ iter: 0, step: 1, status: 404, ms: 30, sizeBytes: 20 }),
      rec({ iter: 1, step: 0, status: 0, ms: 0, error: 'boom' }),
      rec({ iter: 1, step: 1, status: 201, ms: 50, passed: 1, total: 2 }),
    ];
    const acc = newAcc();
    for (const r of records) fold(acc, r);
    expect(toStats(acc)).toEqual(summarize(records));
  });

  it('counts pass/fail, assertions, bytes and status codes', () => {
    const stats = summarize([
      rec({ status: 200, sizeBytes: 100, passed: 2, total: 2 }),
      rec({ step: 1, status: 200, sizeBytes: 50 }),
      rec({ step: 2, status: 500, sizeBytes: 10 }),
      rec({ step: 3, status: 0, sizeBytes: 0, error: 'no route' }),
    ]);
    expect(stats.total).toBe(4);
    expect(stats.passed).toBe(2);
    expect(stats.failed).toBe(2);
    expect(stats.assertTotal).toBe(2);
    expect(stats.assertPassed).toBe(2);
    expect(stats.totalBytes).toBe(160);
    expect(stats.byStatus).toEqual({ '200': 2, '500': 1, error: 1 });
    // HTTP success counted independently of assertions.
    expect(stats.http2xx).toBe(2);
  });

  it('counts HTTP success separately from assertion pass/fail', () => {
    const stats = summarize([
      // 2xx but a failing assertion: HTTP fine, run failed.
      rec({ status: 200, passed: 0, total: 1 }),
      // 3xx: a pass under isOk's lenient rule, but not HTTP 2xx.
      rec({ step: 1, status: 302 }),
      rec({ step: 2, status: 500 }),
    ]);
    expect(stats.http2xx).toBe(1);
    expect(stats.passed).toBe(1);
    expect(stats.total - stats.http2xx).toBe(2);
  });

  it('averages timing over responses only, so a failed connection does not drag it to zero', () => {
    const stats = summarize([
      rec({ status: 200, ms: 100 }),
      rec({ step: 1, status: 200, ms: 200 }),
      rec({ step: 2, status: 0, ms: 0, error: 'refused' }),
    ]);
    expect(stats.avgMs).toBe(150);
    expect(stats.minMs).toBe(100);
    expect(stats.maxMs).toBe(200);
    expect(stats.sumMs).toBe(300);
  });

  it('reports zeroed timing when nothing ever responded', () => {
    const stats = summarize([rec({ status: 0, ms: 0, error: 'refused' })]);
    expect(stats.avgMs).toBe(0);
    expect(stats.minMs).toBe(0);
    expect(stats.maxMs).toBe(0);
  });

  it('counts statistics even for records with no saved response detail', () => {
    // "Save responses" off (the default for a large data file) still has to
    // produce a full statistical picture.
    const stats = summarize([rec({ status: 200, ms: 42, sizeBytes: 99, passed: 1, total: 1 })]);
    expect(stats).toMatchObject({ total: 1, passed: 1, avgMs: 42, totalBytes: 99, assertPassed: 1 });
  });

  it('is empty, not NaN, for a run with no records', () => {
    const stats = summarize([]);
    expect(stats).toMatchObject({ total: 0, passed: 0, failed: 0, avgMs: 0, byStatus: {} });
    expect(stats.byRequest).toEqual([]);
    expect(stats.statusSamples).toEqual({});
  });
});

describe('per-request rollup', () => {
  const stats = summarize([
    rec({ iter: 0, step: 0, requestId: 'a', name: 'Login', method: 'POST', status: 200, ms: 10 }),
    rec({ iter: 0, step: 1, requestId: 'b', name: 'Get user', status: 500, ms: 40 }),
    rec({ iter: 1, step: 0, requestId: 'a', name: 'Login', method: 'POST', status: 200, ms: 30 }),
    rec({ iter: 1, step: 1, requestId: 'b', name: 'Get user', status: 200, ms: 20, passed: 1, total: 2 }),
    rec({ iter: 2, step: 1, requestId: 'b', name: 'Get user', status: 0, ms: 0, error: 'timeout' }),
  ]);

  it('keeps one row per request, in first-executed order', () => {
    expect(stats.byRequest.map((r) => r.requestId)).toEqual(['a', 'b']);
    expect(stats.byRequest[0]).toMatchObject({ name: 'Login', method: 'POST' });
  });

  it('tracks each request\'s own response codes', () => {
    expect(stats.byRequest[0].byStatus).toEqual({ '200': 2 });
    expect(stats.byRequest[1].byStatus).toEqual({ '200': 1, '500': 1, error: 1 });
  });

  it('counts HTTP 2xx per request', () => {
    expect(stats.byRequest[0].http2xx).toBe(2);
    // 500, 200, and a transport error → one HTTP success out of three.
    expect(stats.byRequest[1].http2xx).toBe(1);
  });

  it('counts pass/fail per request', () => {
    expect(stats.byRequest[0]).toMatchObject({ total: 2, passed: 2, failed: 0 });
    // 500, a 200 with a failing assertion, and a transport error — all fails.
    expect(stats.byRequest[1]).toMatchObject({ total: 3, passed: 0, failed: 3 });
  });

  it('averages each request\'s timing over its own responses', () => {
    expect(stats.byRequest[0]).toMatchObject({ avgMs: 20, minMs: 10, maxMs: 30 });
    expect(stats.byRequest[1]).toMatchObject({ avgMs: 30, minMs: 20, maxMs: 40 });
  });
});

describe('status-code samples', () => {
  it('records which iterations produced each code, run-wide and per request', () => {
    const stats = summarize([
      rec({ iter: 0, requestId: 'a', status: 200 }),
      rec({ iter: 3, requestId: 'a', status: 500 }),
      rec({ iter: 7, requestId: 'b', status: 500 }),
    ]);
    expect(stats.statusSamples['500']).toEqual([3, 7]);
    expect(stats.byRequest[0].statusSamples['500']).toEqual([3]);
    expect(stats.byRequest[1].statusSamples['500']).toEqual([7]);
  });

  it('spends one sample slot per iteration even when a code repeats within it', () => {
    const stats = summarize([
      rec({ iter: 4, step: 0, status: 500 }),
      rec({ iter: 4, step: 1, status: 500 }),
      rec({ iter: 5, step: 0, status: 500 }),
    ]);
    expect(stats.statusSamples['500']).toEqual([4, 5]);
  });

  it('caps the index so a 100k-iteration run cannot grow it without bound', () => {
    const records = Array.from({ length: STATUS_SAMPLE_CAP + 50 }, (_, i) => rec({ iter: i, status: 500 }));
    const stats = summarize(records);
    expect(stats.statusSamples['500']).toHaveLength(STATUS_SAMPLE_CAP);
    // Counts stay exact even though the sample index is capped.
    expect(stats.byStatus['500']).toBe(STATUS_SAMPLE_CAP + 50);
  });
});
