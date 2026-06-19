// Data model for the API Client tool.
//
// The model is intentionally close to Postman's Collection v2.1 shape so that
// import/export is mostly a field mapping (see postman.ts). Folders nest, just
// like Postman, so imported collections keep their structure.

export const HTTP_METHODS = [
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

// A single enabled/disabled key-value pair (used for params, headers, form
// fields, and environment variables).
export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export type BodyMode = 'none' | 'json' | 'raw' | 'form-data' | 'urlencoded';

export interface RequestBody {
  mode: BodyMode;
  raw: string;          // used for `json` and `raw`
  form: KeyValue[];     // used for `form-data` and `urlencoded`
}

export type AuthType = 'none' | 'bearer' | 'basic';

export interface Auth {
  type: AuthType;
  token: string;        // bearer
  username: string;     // basic
  password: string;     // basic
}

// Pre-request and post-response JavaScript, Bruno-style.
export interface RequestScript {
  req: string;   // pre-request script
  res: string;   // post-response script
}

// Declarative variable assignment (Bruno's "Vars" tab). `value` is a JS
// expression: pre-request vars see {{...}}-substituted text; post-response vars
// are evaluated with `res`/`bru` in scope to extract values from the response.
export interface VarDef {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
}
export interface RequestVars {
  req: VarDef[];   // set before the request
  res: VarDef[];   // set from the response
}

export const ASSERT_OPERATORS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'notContains', 'matches', 'length',
] as const;
export type AssertOperator = (typeof ASSERT_OPERATORS)[number];

// Declarative assertion (Bruno's "Assert" tab). `expr` is evaluated with `res`
// in scope (e.g. `res.status`, `res.body.id`, `res.responseTime`).
export interface Assertion {
  id: string;
  expr: string;
  operator: AssertOperator;
  value: string;
  enabled: boolean;
}

export interface ApiRequest {
  type: 'request';
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: RequestBody;
  auth: Auth;
  script: RequestScript;
  vars: RequestVars;
  assertions: Assertion[];
  tests: string;          // post-response test script (expect/test)
}

// A flat map of variable name → value, used for {{var}} substitution.
export type VarMap = Record<string, string>;

// ─── scripting results ──────────────────────────────────────────────────────

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface LogEntry {
  level: 'log' | 'info' | 'warn' | 'error';
  text: string;
}

export interface Folder {
  type: 'folder';
  id: string;
  name: string;
  items: TreeItem[];
  collapsed?: boolean;
  script?: RequestScript;   // inherited by requests inside
}

export type TreeItem = ApiRequest | Folder;

export interface Collection {
  id: string;
  name: string;
  items: TreeItem[];
  collapsed?: boolean;
  script?: RequestScript;   // inherited by all requests
}

export interface Environment {
  id: string;
  name: string;
  variables: KeyValue[];
}

// Result of executing a request.
export interface ApiResponse {
  status: number;
  statusText: string;
  ok: boolean;
  headers: [string, string][];
  body: string;
  contentType: string;
  timeMs: number;
  sizeBytes: number;
}

// A single past send (most-recent first), kept for the History tab.
export interface HistoryEntry {
  id: string;
  at: number;            // epoch ms
  method: HttpMethod;
  url: string;           // resolved URL actually sent
  status: number;        // 0 when the request errored before a response
  ok: boolean;
  timeMs: number;
  error?: string;
}

// ─── factories ──────────────────────────────────────────────────────────────

export const uid = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const newKeyValue = (key = '', value = ''): KeyValue => ({
  id: uid(), key, value, enabled: true,
});

export const newVarDef = (): VarDef => ({ id: uid(), name: '', value: '', enabled: true });

export const newAssertion = (): Assertion => ({
  id: uid(), expr: '', operator: 'eq', value: '', enabled: true,
});

export function newRequest(partial: Partial<ApiRequest> = {}): ApiRequest {
  return {
    type: 'request',
    id: uid(),
    name: partial.name ?? 'New Request',
    method: partial.method ?? 'GET',
    url: partial.url ?? '',
    params: partial.params ?? [],
    headers: partial.headers ?? [],
    body: partial.body ?? { mode: 'none', raw: '', form: [] },
    auth: partial.auth ?? { type: 'none', token: '', username: '', password: '' },
    script: partial.script ?? { req: '', res: '' },
    vars: partial.vars ?? { req: [], res: [] },
    assertions: partial.assertions ?? [],
    tests: partial.tests ?? '',
  };
}

// Backfill scripting fields on requests loaded from an older persisted shape or
// a Postman import that didn't set them. Returns the same object when complete.
export function normalizeRequest(req: ApiRequest): ApiRequest {
  if (req.script && req.vars && req.assertions && typeof req.tests === 'string') return req;
  return {
    ...req,
    script: req.script ?? { req: '', res: '' },
    vars: req.vars ?? { req: [], res: [] },
    assertions: req.assertions ?? [],
    tests: req.tests ?? '',
  };
}

export function newFolder(name = 'New Folder'): Folder {
  return { type: 'folder', id: uid(), name, items: [] };
}

export function newCollection(name = 'New Collection'): Collection {
  return { id: uid(), name, items: [] };
}

export function newEnvironment(name = 'New Environment'): Environment {
  return { id: uid(), name, variables: [] };
}
