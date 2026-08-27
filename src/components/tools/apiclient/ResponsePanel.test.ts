import { describe, expect, it } from 'vitest';
import { parseScriptErrors, looksLikeCorsRejection } from './ResponsePanel';
import type { ApiResponse } from './types';

describe('parseScriptErrors', () => {
  it('splits a single labelled error into label + message', () => {
    expect(parseScriptErrors('Pre-request script: TypeError: x is not a function (line 4)')).toEqual([
      { label: 'Pre-request script', message: 'TypeError: x is not a function (line 4)', jumpTab: 'script' },
    ]);
  });

  it('splits multiple \\n-joined errors into separate entries', () => {
    const joined = [
      'Post-response script: boom',
      'Inherited post-response script #2: from folder',
    ].join('\n');
    expect(parseScriptErrors(joined)).toEqual([
      { label: 'Post-response script', message: 'boom', jumpTab: 'script' },
      { label: 'Inherited post-response script #2', message: 'from folder', jumpTab: undefined },
    ]);
  });

  it('maps own-request script labels to the tab that holds them', () => {
    expect(parseScriptErrors('Test script: failed').map((e) => e.jumpTab)).toEqual(['tests']);
  });

  it('does not offer a jump for inherited (collection/folder) scripts', () => {
    expect(parseScriptErrors('Inherited pre-request script: boom')[0].jumpTab).toBeUndefined();
  });

  it('treats an unlabelled transport error as message-only', () => {
    expect(parseScriptErrors('connection refused')).toEqual([
      { label: '', message: 'connection refused' },
    ]);
  });
});

describe('looksLikeCorsRejection', () => {
  const res = (over: Partial<ApiResponse> = {}): ApiResponse => ({
    status: 403, statusText: 'Forbidden', ok: false, headers: [], body: '',
    contentType: 'text/plain', timeMs: 5, sizeBytes: 0, ...over,
  });

  it('flags a 403 body that mentions CORS', () => {
    expect(looksLikeCorsRejection(res({ body: 'Request blocked by CORS policy' }))).toBe(true);
  });

  it('flags a 403 body saying the origin is not allowed', () => {
    expect(looksLikeCorsRejection(res({ body: 'Origin http://localhost is not allowed' }))).toBe(true);
  });

  it('flags an Access-Control-Allow-Origin mismatch message', () => {
    expect(looksLikeCorsRejection(res({ body: 'No Access-Control-Allow-Origin header present' }))).toBe(true);
  });

  it('also checks response headers, not just the body', () => {
    expect(looksLikeCorsRejection(res({ body: 'forbidden', headers: [['x-error', 'origin rejected']] }))).toBe(true);
  });

  it('does not flag an unrelated 403', () => {
    expect(looksLikeCorsRejection(res({ body: 'Invalid API key' }))).toBe(false);
  });

  it('does not flag a 2xx response even if it happens to mention CORS', () => {
    expect(looksLikeCorsRejection(res({ status: 200, ok: true, body: 'CORS is enabled for this origin' }))).toBe(false);
  });

  it('does not flag a 5xx server error', () => {
    expect(looksLikeCorsRejection(res({ status: 500, statusText: 'Internal Server Error', body: 'cors origin blocked' }))).toBe(false);
  });
});
