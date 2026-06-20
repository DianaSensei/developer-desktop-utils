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
// fields, and environment variables). The optional fields are only used by
// multipart form rows, which may carry a file and an explicit Content-Type.
export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  kind?: 'text' | 'file';   // multipart: text value vs. uploaded file
  contentType?: string;     // multipart: explicit Content-Type ('' = Auto)
  fileName?: string;        // multipart file: original name
  fileType?: string;        // multipart file: MIME type
  fileContent?: string;     // multipart file: base64-encoded bytes
}

export type BodyMode =
  | 'none'
  | 'json' | 'xml' | 'text' | 'sparql'   // raw text bodies (differ only by content-type)
  | 'graphql'                            // GraphQL query + variables
  | 'multipart' | 'urlencoded'           // form bodies
  | 'file';                              // raw file / binary upload

export interface RequestBody {
  mode: BodyMode;
  raw: string;          // used for the raw text modes (json/xml/text/sparql)
  form: KeyValue[];     // used for multipart / urlencoded
  graphql?: { query: string; variables: string }; // graphql mode
  fileName?: string;    // file mode: original name
  fileType?: string;    // file mode: MIME type
  fileContent?: string; // file mode: base64-encoded bytes
}

export type AuthType = 'none' | 'inherit' | 'bearer' | 'basic' | 'digest' | 'apikey' | 'oauth2';

export interface ApiKeyAuth { key: string; value: string; placement: 'header' | 'query' }
export interface OAuth2Auth {
  grantType: 'client_credentials' | 'password';
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  username: string;     // password grant
  password: string;     // password grant
}

export interface Auth {
  type: AuthType;
  token: string;        // bearer
  username: string;     // basic / digest
  password: string;     // basic / digest
  apiKey: ApiKeyAuth;
  oauth2: OAuth2Auth;
}

export const newAuth = (): Auth => ({
  type: 'none', token: '', username: '', password: '',
  apiKey: { key: '', value: '', placement: 'header' },
  oauth2: { grantType: 'client_credentials', tokenUrl: '', clientId: '', clientSecret: '', scope: '', username: '', password: '' },
});

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
  'equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn',
  'contains', 'notContains', 'length', 'matches', 'notMatches', 'startsWith', 'endsWith', 'between',
  'isEmpty', 'isNotEmpty', 'isNull', 'isUndefined', 'isDefined', 'isTruthy', 'isFalsy',
  'isJson', 'isNumber', 'isString', 'isBoolean', 'isArray',
] as const;
export type AssertOperator = (typeof ASSERT_OPERATORS)[number];

// Operators that take no right-hand value (the Value cell is hidden for these).
export const UNARY_ASSERT_OPERATORS: readonly AssertOperator[] = [
  'isEmpty', 'isNotEmpty', 'isNull', 'isUndefined', 'isDefined', 'isTruthy', 'isFalsy',
  'isJson', 'isNumber', 'isString', 'isBoolean', 'isArray',
];

// Legacy operator ids from older persisted requests → current names.
const LEGACY_ASSERT_OP: Record<string, AssertOperator> = { eq: 'equals', neq: 'notEquals' };
export const migrateAssertOp = (op: string): AssertOperator =>
  LEGACY_ASSERT_OP[op] ?? (op as AssertOperator);

// Declarative assertion (Bruno's "Assert" tab). `expr` is evaluated with `res`
// in scope (e.g. `res.status`, `res.body.id`, `res.responseTime`).
export interface Assertion {
  id: string;
  expr: string;
  operator: AssertOperator;
  value: string;
  enabled: boolean;
}

// Per-request transport settings (Bruno's "Settings" tab).
export interface RequestSettings {
  encodeUrl: boolean;        // auto-encode query parameters
  followRedirects: boolean;  // follow HTTP redirects automatically
  maxRedirects: number;      // cap on redirects when following
  timeout: number;           // ms to wait before aborting (0 = no limit)
  tags: string[];            // free-form labels
}

export interface ApiRequest {
  type: 'request';
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  pathParams: KeyValue[];   // values for :placeholders in the URL path
  headers: KeyValue[];
  body: RequestBody;
  auth: Auth;
  script: RequestScript;
  vars: RequestVars;
  assertions: Assertion[];
  tests: string;          // post-response test script (expect/test)
  settings: RequestSettings;
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
  auth?: Auth;              // inherited by requests with 'inherit' auth
}

export type TreeItem = ApiRequest | Folder;

export interface Collection {
  id: string;
  name: string;
  items: TreeItem[];
  collapsed?: boolean;
  script?: RequestScript;   // inherited by all requests
  auth?: Auth;              // inherited by requests with 'inherit' auth
}

export interface Environment {
  id: string;
  name: string;
  variables: KeyValue[];
  // null/undefined = global (available everywhere); otherwise scoped to one
  // collection (only available while working inside it), Bruno-style.
  collectionId?: string | null;
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
  request?: ApiRequest;            // snapshot of the request as it was sent
  response?: ApiResponse | null;   // full response, so the entry is replayable
  tests?: TestResult[];
  logs?: LogEntry[];
}

// ─── factories ──────────────────────────────────────────────────────────────

export const uid = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const newKeyValue = (key = '', value = ''): KeyValue => ({
  id: uid(), key, value, enabled: true,
});

export const newVarDef = (): VarDef => ({ id: uid(), name: '', value: '', enabled: true });

export const newAssertion = (): Assertion => ({
  id: uid(), expr: '', operator: 'equals', value: '', enabled: true,
});

export const newSettings = (): RequestSettings => ({
  encodeUrl: true, followRedirects: true, maxRedirects: 5, timeout: 0, tags: [],
});

export function newRequest(partial: Partial<ApiRequest> = {}): ApiRequest {
  return {
    type: 'request',
    id: uid(),
    name: partial.name ?? 'New Request',
    method: partial.method ?? 'GET',
    url: partial.url ?? '',
    params: partial.params ?? [],
    pathParams: partial.pathParams ?? [],
    headers: partial.headers ?? [],
    body: partial.body ?? { mode: 'none', raw: '', form: [] },
    auth: partial.auth ?? newAuth(),
    script: partial.script ?? { req: '', res: '' },
    vars: partial.vars ?? { req: [], res: [] },
    assertions: partial.assertions ?? [],
    tests: partial.tests ?? '',
    settings: partial.settings ?? newSettings(),
  };
}

// Backfill scripting fields on requests loaded from an older persisted shape or
// a Postman import that didn't set them. Returns the same object when complete.
// Map legacy body modes from older persisted shapes / Postman imports.
const LEGACY_BODY_MODE: Record<string, BodyMode> = { raw: 'text', 'form-data': 'multipart' };

export function normalizeRequest(req: ApiRequest): ApiRequest {
  const mode = LEGACY_BODY_MODE[req.body?.mode as string];
  const legacyOp = (req.assertions ?? []).some((a) => a.operator in { eq: 1, neq: 1 });
  const authOk = req.auth && req.auth.apiKey && req.auth.oauth2;
  if (req.script && req.vars && req.assertions && typeof req.tests === 'string' && req.settings && req.pathParams && authOk && !mode && !legacyOp) return req;
  return {
    ...req,
    pathParams: req.pathParams ?? [],
    auth: { ...newAuth(), ...req.auth, apiKey: { ...newAuth().apiKey, ...req.auth?.apiKey }, oauth2: { ...newAuth().oauth2, ...req.auth?.oauth2 } },
    body: mode ? { ...req.body, mode } : req.body,
    script: req.script ?? { req: '', res: '' },
    vars: req.vars ?? { req: [], res: [] },
    assertions: (req.assertions ?? []).map((a) => ({ ...a, operator: migrateAssertOp(a.operator) })),
    tests: req.tests ?? '',
    settings: req.settings ?? newSettings(),
  };
}

export function newFolder(name = 'New Folder'): Folder {
  return { type: 'folder', id: uid(), name, items: [] };
}

export function newCollection(name = 'New Collection'): Collection {
  return { id: uid(), name, items: [] };
}

export function newEnvironment(name = 'New Environment', collectionId: string | null = null): Environment {
  return { id: uid(), name, variables: [], collectionId };
}
