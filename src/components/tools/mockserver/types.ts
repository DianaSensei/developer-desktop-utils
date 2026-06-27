// Data model for the Mock HTTP Server tool. The TS shapes mirror the Rust
// structs in `src-tauri/src/mockserver.rs` (serde camelCase), so a stub round-
// trips through `invoke` without any field mapping.

import { type KeyValue } from '../apiclient/types';

// Methods a stub can match. "ANY" matches every method.
export const STUB_METHODS = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type StubMethod = (typeof STUB_METHODS)[number];

export type MatcherTarget = 'query' | 'header' | 'body' | 'path';
export type MatcherOp = 'equals' | 'contains' | 'regex' | 'exists';
export type ResponseMode = 'static' | 'script';
export type BodyType = 'text' | 'json' | 'base64';

export interface Matcher {
  id: string;
  target: MatcherTarget;
  op: MatcherOp;
  key: string;
  value: string;
  /** Body-only UI scope: match the whole body or a JSON field (the `key`).
   *  Backend ignores this and keys off `key` (empty = whole body). */
  bodyMode?: 'whole' | 'field';
}

export interface Stub {
  id: string;
  enabled: boolean;
  name: string;
  method: StubMethod;
  path: string;
  matchers: Matcher[];
  mode: ResponseMode;
  status: number;
  headers: KeyValue[];
  body: string;
  /** How `body` is interpreted in static mode. */
  bodyType: BodyType;
  /** Download filename for base64 bodies (sets Content-Disposition). */
  fileName: string;
  script: string;
  delayMs: number;
}

// Server bind + fallback settings, persisted with the stubs.
export interface MockConfig {
  stubs: Stub[];
  host: string;
  port: number;
  notFoundStatus: number;
  notFoundBody: string;
  notFoundContentType: string;
}

export interface MockStatus {
  running: boolean;
  host: string;
  port: number;
}

export interface RequestLogEntry {
  id: string;
  ts: number;
  method: string;
  path: string;
  query: string;
  status: number;
  matchedStubId: string | null;
  durationMs: number;
  reqHeaders: { key: string; value: string; enabled: boolean }[];
  reqBody: string;
  resBody: string;
}

export interface ScriptResult {
  ok: boolean;
  status: number;
  headers: { key: string; value: string; enabled: boolean }[];
  body: string;
  error: string | null;
}

// ── Factories ────────────────────────────────────────────────────────────────

let counter = 0;
const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const newMatcher = (): Matcher => ({
  id: uid(),
  target: 'query',
  op: 'equals',
  key: '',
  value: '',
});

export const newStub = (): Stub => ({
  id: uid(),
  enabled: true,
  name: 'New stub',
  method: 'GET',
  path: '/hello',
  matchers: [],
  mode: 'static',
  status: 200,
  headers: [],
  body: '{\n  "message": "Hello from the mock server"\n}',
  bodyType: 'json',
  fileName: '',
  script: [
    '// `req` is available: req.method, req.path, req.query, req.headers,',
    '// req.params (path params), req.body. Return a string (200 body) or a',
    '// map: #{ status: 200, headers: #{ "x-foo": "bar" }, body: "..." }',
    '#{ status: 200, headers: #{ "content-type": "application/json" }, body: req.body }',
  ].join('\n'),
  delayMs: 0,
});

export const defaultConfig = (): MockConfig => ({
  stubs: [newStub()],
  host: '127.0.0.1',
  port: 8787,
  notFoundStatus: 404,
  notFoundBody: '{\n  "error": "No matching stub"\n}',
  notFoundContentType: 'application/json',
});
