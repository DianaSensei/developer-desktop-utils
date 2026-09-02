// Scripting runtime — a Bruno-compatible JS sandbox.
//
// Pre-request and post-response scripts, the test runner, and declarative
// assertions all execute here. Scripts run via the AsyncFunction
// constructor inside the app's own JS context with a curated set of globals
// (`bru`, `req`, `res`, `expect`, `test`, `assert`, `console`). This is the same
// trust model as Postman/Bruno: the scripts are the user's own, run locally, and
// nothing is sent anywhere except the HTTP request itself.

import type {
  ApiRequest, ApiResponse, Assertion, LogEntry, TestResult, VarMap,
} from './types';
import { substituteVars } from './vars';
import { requireModule } from './modules';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as
  new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

// ─── error reporting ────────────────────────────────────────────────────────

// Scripts are compiled with the AsyncFunction constructor, so a thrown error's
// stack points at a synthetic source whose first line is the generated function
// header — the reported line number is offset from the line the user wrote. The
// offset differs per engine (V8 on Windows, JavaScriptCore on macOS/Linux), so
// it is measured once with a probe script that throws from its own line 1
// instead of being hard-coded.
let lineOffset: Promise<number | null> | null = null;

function stackLine(stack: string | undefined): number | null {
  if (!stack) return null;
  const m = /(?:<anonymous>|eval|Function|anonymous code)[^\n]*?:(\d+):\d+/.exec(stack)
    ?? /:(\d+):\d+\)?$/m.exec(stack);
  return m ? Number(m[1]) : null;
}

function getLineOffset(): Promise<number | null> {
  if (!lineOffset) {
    lineOffset = (async () => {
      try {
        await new AsyncFunction('throw new Error("probe");')();
      } catch (e) {
        const line = stackLine((e as Error).stack);
        // The probe throws from user-line 1, so anything above that is overhead.
        if (line != null) return line - 1;
      }
      return null;
    })();
  }
  return lineOffset;
}

const errText = (e: unknown): string =>
  e instanceof Error ? (e.message || e.name || String(e)) : String(e);

// Human-readable "TypeError: x is not a function (line 4)" for a script failure.
async function describeScriptError(e: unknown): Promise<string> {
  if (!(e instanceof Error)) return String(e);
  const prefix = e.name && e.name !== 'Error' ? `${e.name}: ` : '';
  const raw = stackLine(e.stack);
  if (raw != null) {
    const offset = await getLineOffset();
    if (offset != null && raw - offset >= 1) return `${prefix}${e.message} (line ${raw - offset})`;
  }
  return `${prefix}${e.message}`;
}

// ─── deep equality (for expect().eql / .equal of objects) ───────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// ─── expect (Chai-style BDD subset) ─────────────────────────────────────────

class Expectation {
  // `message` is chai's optional second argument to expect(); when present it
  // replaces the generated failure text so scripts can explain the intent.
  constructor(private actual: unknown, private negate = false, private message?: string) {}

  // language chains (no-ops that return `this`)
  get to() { return this; }
  get be() { return this; }
  get been() { return this; }
  get is() { return this; }
  get that() { return this; }
  get which() { return this; }
  get and() { return this; }
  get has() { return this; }
  get have() { return this; }
  get with() { return this; }
  get of() { return this; }
  get at() { return this; }
  get itself() { return this; }
  // `.deep`, `.own`, `.nested`, `.any`, `.all` are chai flags that our matchers
  // already imply (equal deep-compares objects, property walks dotted paths), so
  // they are accepted as no-ops for `expect(x).to.deep.equal(y)` parity.
  get deep() { return this; }
  get own() { return this; }
  get nested() { return this; }
  get any() { return this; }
  get all() { return this; }
  get not() { return new Expectation(this.actual, !this.negate, this.message); }

  private check(pass: boolean, msg: string, negMsg: string) {
    const ok = this.negate ? !pass : pass;
    if (!ok) throw new Error(this.message || (this.negate ? negMsg : msg));
  }

  private show(v: unknown): string {
    try { return typeof v === 'string' ? `"${v}"` : JSON.stringify(v); } catch { return String(v); }
  }

  equal(expected: unknown) {
    const pass = typeof expected === 'object' && expected !== null
      ? deepEqual(this.actual, expected)
      : this.actual === expected;
    this.check(pass, `expected ${this.show(this.actual)} to equal ${this.show(expected)}`,
      `expected ${this.show(this.actual)} to not equal ${this.show(expected)}`);
    return this;
  }
  eql(expected: unknown) {
    this.check(deepEqual(this.actual, expected),
      `expected ${this.show(this.actual)} to deeply equal ${this.show(expected)}`,
      `expected ${this.show(this.actual)} to not deeply equal ${this.show(expected)}`);
    return this;
  }
  a(type: string) {
    const t = Array.isArray(this.actual) ? 'array' : this.actual === null ? 'null' : typeof this.actual;
    this.check(t === type, `expected ${this.show(this.actual)} to be a ${type}`, `expected ${this.show(this.actual)} to not be a ${type}`);
    return this;
  }
  an(type: string) { return this.a(type); }
  above(n: number) {
    this.check(Number(this.actual) > n, `expected ${this.show(this.actual)} to be above ${n}`, `expected ${this.show(this.actual)} to not be above ${n}`);
    return this;
  }
  least(n: number) {
    this.check(Number(this.actual) >= n, `expected ${this.show(this.actual)} to be at least ${n}`, `expected ${this.show(this.actual)} to be below ${n}`);
    return this;
  }
  below(n: number) {
    this.check(Number(this.actual) < n, `expected ${this.show(this.actual)} to be below ${n}`, `expected ${this.show(this.actual)} to not be below ${n}`);
    return this;
  }
  most(n: number) {
    this.check(Number(this.actual) <= n, `expected ${this.show(this.actual)} to be at most ${n}`, `expected ${this.show(this.actual)} to be above ${n}`);
    return this;
  }
  include(v: unknown) {
    const a = this.actual;
    const pass = Array.isArray(a) ? a.includes(v) : typeof a === 'string' ? a.includes(String(v)) : false;
    this.check(pass, `expected ${this.show(a)} to include ${this.show(v)}`, `expected ${this.show(a)} to not include ${this.show(v)}`);
    return this;
  }
  contain(v: unknown) { return this.include(v); }
  match(re: RegExp) {
    this.check(re.test(String(this.actual)), `expected ${this.show(this.actual)} to match ${re}`, `expected ${this.show(this.actual)} to not match ${re}`);
    return this;
  }
  lengthOf(n: number) {
    const len = (this.actual as { length?: number })?.length;
    this.check(len === n, `expected length ${len} to be ${n}`, `expected length ${len} to not be ${n}`);
    return this;
  }
  property(name: string, value?: unknown) {
    // Direct key first, then a dotted path so `.nested.property('a.b')` works.
    let found = this.actual != null && Object.prototype.hasOwnProperty.call(this.actual, name);
    let v = found ? (this.actual as Record<string, unknown>)[name] : undefined;
    if (!found && name.includes('.')) {
      let cur: unknown = this.actual;
      found = true;
      for (const part of name.split('.')) {
        if (cur == null || typeof cur !== 'object' || !(part in (cur as object))) { found = false; break; }
        cur = (cur as Record<string, unknown>)[part];
      }
      if (found) v = cur;
    }
    this.check(found, `expected object to have property "${name}"`, `expected object to not have property "${name}"`);
    if (found && arguments.length > 1) {
      this.check(deepEqual(v, value), `expected property "${name}" to equal ${this.show(value)}`, `expected property "${name}" to not equal ${this.show(value)}`);
    }
    return this;
  }
  keys(...names: (string | string[])[]) {
    const want = names.flat();
    const have = this.actual == null ? [] : Object.keys(this.actual as object);
    const pass = want.every((k) => have.includes(k));
    this.check(pass, `expected ${this.show(have)} to have keys ${this.show(want)}`, `expected ${this.show(have)} to not have keys ${this.show(want)}`);
    return this;
  }
  oneOf(list: unknown[]) {
    this.check(list.some((v) => deepEqual(v, this.actual)),
      `expected ${this.show(this.actual)} to be one of ${this.show(list)}`,
      `expected ${this.show(this.actual)} to not be one of ${this.show(list)}`);
    return this;
  }
  closeTo(expected: number, delta = 0) {
    this.check(Math.abs(Number(this.actual) - expected) <= delta,
      `expected ${this.show(this.actual)} to be close to ${expected} ±${delta}`,
      `expected ${this.show(this.actual)} to not be close to ${expected} ±${delta}`);
    return this;
  }
  approximately(expected: number, delta = 0) { return this.closeTo(expected, delta); }
  greaterThan(n: number) { return this.above(n); }
  lessThan(n: number) { return this.below(n); }
  instanceOf(ctor: new (...args: never[]) => unknown) {
    this.check(this.actual instanceof ctor,
      `expected ${this.show(this.actual)} to be an instance of ${ctor?.name ?? 'the given type'}`,
      `expected ${this.show(this.actual)} to not be an instance of ${ctor?.name ?? 'the given type'}`);
    return this;
  }
  // `expect(fn).to.throw()` — the subject must be a function; it is called here.
  throw(expected?: string | RegExp) {
    let threw = false;
    let message = '';
    try { (this.actual as () => unknown)(); } catch (e) { threw = true; message = errText(e); }
    const matched = threw && (expected == null
      || (expected instanceof RegExp ? expected.test(message) : message.includes(expected)));
    this.check(matched,
      expected == null ? 'expected the function to throw' : `expected the function to throw matching ${expected}`,
      'expected the function to not throw');
    return this;
  }
  throws(expected?: string | RegExp) { return this.throw(expected); }

  // terminal getter-assertions
  get ok()        { this.check(!!this.actual, `expected ${this.show(this.actual)} to be truthy`, `expected ${this.show(this.actual)} to be falsy`); return this; }
  get true()      { this.check(this.actual === true, `expected ${this.show(this.actual)} to be true`, `expected ${this.show(this.actual)} to not be true`); return this; }
  get false()     { this.check(this.actual === false, `expected ${this.show(this.actual)} to be false`, `expected ${this.show(this.actual)} to not be false`); return this; }
  get null()      { this.check(this.actual === null, `expected ${this.show(this.actual)} to be null`, `expected ${this.show(this.actual)} to not be null`); return this; }
  get undefined() { this.check(this.actual === undefined, `expected ${this.show(this.actual)} to be undefined`, `expected value to be defined`); return this; }
  get exist()     { this.check(this.actual != null, `expected ${this.show(this.actual)} to exist`, `expected value to not exist`); return this; }
  get NaN()       { this.check(Number.isNaN(this.actual as number), `expected ${this.show(this.actual)} to be NaN`, `expected ${this.show(this.actual)} to not be NaN`); return this; }
  get finite()    { this.check(Number.isFinite(this.actual as number), `expected ${this.show(this.actual)} to be finite`, `expected ${this.show(this.actual)} to not be finite`); return this; }
  get empty()     {
    const a = this.actual as { length?: number };
    const len = typeof a === 'object' && a !== null && !('length' in a) ? Object.keys(a).length : a?.length ?? 0;
    this.check(len === 0, `expected ${this.show(this.actual)} to be empty`, `expected ${this.show(this.actual)} to not be empty`);
    return this;
  }
}

export function makeExpect() {
  return (actual: unknown, message?: string) => new Expectation(actual, false, message);
}

// ─── res / req / bru host objects ───────────────────────────────────────────

// Parse a response body once: JSON when it looks like JSON, else the raw text.
function parseBody(res: ApiResponse): unknown {
  if (/json/i.test(res.contentType) || /^\s*[[{]/.test(res.body)) {
    try { return JSON.parse(res.body); } catch { /* fall through */ }
  }
  return res.body;
}

// Keys that would walk up to Object.prototype instead of landing on the map.
// Variable names reach `bru.setCollectionVar`/`setEnvVar` from scripts and from
// collection files that may have been imported from somewhere untrusted, so a
// write keyed on one of
// these is prototype pollution rather than a variable. Spelled out as a
// disjunction rather than a Set lookup so the guard is visible at the point it
// is applied, to a reader and to a taint-tracking analyser alike.
export function isSafeKey(k: string): boolean {
  return k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
}

// Null-prototype, because header names come straight off the wire: on a plain
// `{}` a response header called `__proto__` writes through to Object.prototype,
// and `getHeader('constructor')` hands a script the Object constructor for a
// header that was never sent. With no prototype there is nothing to pollute and
// nothing to leak — every key is an ordinary own property, including the odd
// ones — while lookup, spread and structured clone all behave as before.
function headersObject(pairs: [string, string][]): Record<string, string> {
  const obj: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [k, v] of pairs) obj[k.toLowerCase()] = v;
  return obj;
}

// `res` carries both properties (res.status, res.body) for assert expressions and
// methods (res.getStatus()) for scripts — covering both Bruno styles.
export function makeRes(res: ApiResponse) {
  const headers = headersObject(res.headers);
  // Mutable so a post-response script can normalise the body for the scripts and
  // assertions that run after it (Bruno allows `res.setBody(...)`).
  let body = parseBody(res);
  return {
    status: res.status,
    statusText: res.statusText,
    headers,
    get body() { return body; },
    responseTime: res.timeMs,
    getStatus: () => res.status,
    getStatusText: () => res.statusText,
    getHeader: (name: string) => headers[name.toLowerCase()],
    getHeaders: () => headers,
    getBody: () => body,
    setBody: (v: unknown) => { body = v; },
    getResponseTime: () => res.timeMs,
    getSize: () => res.sizeBytes,
    getContentType: () => res.contentType,
    getUrl: () => res.url ?? '',
    isOk: () => res.ok,
  };
}

const newId = () => `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// `req` reads and mutates the request draft (a clone) before it is sent.
export function makeReq(draft: ApiRequest) {
  const findHeader = (name: string) => draft.headers.find((h) => h.key.toLowerCase() === name.toLowerCase());
  const findParam = (name: string) => draft.params.find((p) => p.key === name);
  return {
    get url() { return draft.url; },
    get method() { return draft.method; },
    getName: () => draft.name,
    getUrl: () => draft.url,
    setUrl: (url: string) => { draft.url = String(url); },
    getMethod: () => draft.method,
    setMethod: (m: string) => { draft.method = m.toUpperCase() as ApiRequest['method']; },
    getHeaders: () => headersObject(draft.headers.map((h) => [h.key, h.value])),
    getHeader: (name: string) => findHeader(name)?.value,
    setHeader: (name: string, value: string) => {
      const existing = findHeader(name);
      if (existing) { existing.value = String(value); existing.enabled = true; }
      else draft.headers.push({ id: newId(), key: name, value: String(value), enabled: true });
    },
    deleteHeader: (name: string) => {
      draft.headers = draft.headers.filter((h) => h.key.toLowerCase() !== name.toLowerCase());
    },
    getParams: () => headersObject(draft.params.filter((p) => p.enabled).map((p) => [p.key, p.value])),
    getParam: (name: string) => findParam(name)?.value,
    setParam: (name: string, value: string) => {
      const existing = findParam(name);
      if (existing) { existing.value = String(value); existing.enabled = true; }
      else draft.params.push({ id: newId(), key: name, value: String(value), enabled: true });
    },
    deleteParam: (name: string) => {
      draft.params = draft.params.filter((p) => p.key !== name);
    },
    // Per-request transport settings, so a script can relax a timeout or stop
    // redirect-following for one call without editing the Settings tab.
    getTimeout: () => draft.settings.timeout,
    setTimeout: (ms: number) => { draft.settings = { ...draft.settings, timeout: Math.max(0, Number(ms) || 0) }; },
    setMaxRedirects: (n: number) => { draft.settings = { ...draft.settings, maxRedirects: Math.max(0, Number(n) || 0) }; },
    disableRedirects: () => { draft.settings = { ...draft.settings, followRedirects: false }; },
    getBody: () => {
      if (draft.body.mode === 'json') { try { return JSON.parse(draft.body.raw); } catch { return draft.body.raw; } }
      return draft.body.raw;
    },
    setBody: (data: unknown) => {
      if (typeof data === 'object' && data !== null) draft.body = { mode: 'json', raw: JSON.stringify(data), form: [] };
      else draft.body = { ...draft.body, mode: 'text', raw: String(data) };
    },
  };
}

// Runner flow control, set from a script via setNextRequest. `undefined` means
// the script said nothing (continue in order); a string names the request to
// jump to; `null` ends the current iteration.
export interface RunControl {
  nextRequest?: string | null;
}

// Which environment tier bru.*EnvVar targets. Reads with no scope fall
// through collection -> global; writes with no scope default to
// 'collection' (a write can't merge, it has to land somewhere specific).
export type EnvScope = 'collection' | 'global';

export interface VarStores {
  collectionVar: VarMap; // bru.setCollectionVar / getCollectionVar (persisted)
  collectionEnv: VarMap; // bru.setEnvVar(...,'collection') / getEnvVar (persisted)
  globalEnv: VarMap;     // bru.setEnvVar(...,'global') / getEnvVar (persisted)
  collectionEnvName: string | null;
  globalEnvName: string | null;
  data?: VarMap;     // current data-file row (read-only; data-driven runs)
  // Mutated by setNextRequest; read by the Runner after the request finishes.
  // Ignored for a single Send, where there is no sequence to steer.
  control?: RunControl;
  // Aborts when the user cancels the send, so a sleeping script stops promptly
  // instead of running on after the request it belongs to is gone.
  signal?: AbortSignal;
}

// `stores.collectionVar` etc. are plain `{}` maps that came off the wire (an
// imported collection/environment file) or were built up over a run — a key
// named "toString" or "constructor" is a perfectly ordinary variable name a
// user might pick, but a bare `obj[k]` / `k in obj` resolves it against
// Object.prototype instead of reporting "not set". That hands a script a
// live built-in (`bru.getCollectionVar('toString')` -> `Object.prototype.
// toString`) where it expected `undefined`, and makes `bru.hasCollectionVar`
// falsely report a variable that was never set. Same class of bug as the
// `getHeader('constructor')` case noted above `isSafeKey`, just unguarded
// here instead of designed out.
const hasOwn = (obj: VarMap, k: string): boolean => Object.prototype.hasOwnProperty.call(obj, k);

export function makeBru(stores: VarStores) {
  // Same precedence as the {{substitution}} map in engine.ts (vault aside,
  // which never enters these stores — see engine.ts):
  // collectionVar < globalEnv < collectionEnv < data.
  const allVars = (): VarMap => ({
    ...stores.collectionVar, ...stores.globalEnv, ...stores.collectionEnv, ...(stores.data ?? {}),
  });
  const envStore = (scope?: EnvScope) => (scope === 'global' ? stores.globalEnv : stores.collectionEnv);
  return {
    getCollectionVar: (k: string) => (hasOwn(stores.collectionVar, k) ? stores.collectionVar[k] : undefined),
    setCollectionVar: (k: string, v: unknown) => { if (isSafeKey(k)) stores.collectionVar[k] = v == null ? '' : String(v); },
    hasCollectionVar: (k: string) => hasOwn(stores.collectionVar, k),
    deleteCollectionVar: (k: string) => { delete stores.collectionVar[k]; },
    // No scope: read falls through collection -> global (matches precedence);
    // write/delete default to 'collection', the closer analog to the old
    // single-environment behavior.
    getEnvVar: (k: string, scope?: EnvScope) => {
      if (scope) return hasOwn(envStore(scope), k) ? envStore(scope)[k] : undefined;
      if (hasOwn(stores.collectionEnv, k)) return stores.collectionEnv[k];
      return hasOwn(stores.globalEnv, k) ? stores.globalEnv[k] : undefined;
    },
    setEnvVar: (k: string, v: unknown, scope: EnvScope = 'collection') => { if (isSafeKey(k)) envStore(scope)[k] = v == null ? '' : String(v); },
    hasEnvVar: (k: string, scope?: EnvScope) =>
      (scope ? hasOwn(envStore(scope), k) : (hasOwn(stores.collectionEnv, k) || hasOwn(stores.globalEnv, k))),
    deleteEnvVar: (k: string, scope: EnvScope = 'collection') => { delete envStore(scope)[k]; },
    getEnvName: (scope?: EnvScope) =>
      (scope === 'global' ? stores.globalEnvName : scope === 'collection' ? stores.collectionEnvName : (stores.collectionEnvName ?? stores.globalEnvName)),
    // Postman parity: bru.getIterationData('x') reads the current data row.
    getIterationData: (k: string) => (stores.data && hasOwn(stores.data, k) ? stores.data[k] : undefined),
    // Expand {{tokens}} in a string exactly as the send pipeline would.
    interpolate: (text: string) => substituteVars(String(text ?? ''), allVars()),
    getVars: () => allVars(),
    // Runner flow control: jump to another request by name, or pass null to end
    // the iteration. Takes effect once the current request's scripts finish.
    setNextRequest: (name: string | null) => {
      if (stores.control) stores.control.nextRequest = name === null ? null : String(name);
    },
    // Pause inside a script (rate limiting, polling). Rejects if the send is
    // cancelled so a long sleep can't outlive its request.
    sleep: (ms: number) => new Promise<void>((resolve, reject) => {
      const signal = stores.signal;
      if (signal?.aborted) return reject(new Error('Request cancelled'));
      const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, Math.max(0, Number(ms) || 0));
      function onAbort() { clearTimeout(timer); reject(new Error('Request cancelled')); }
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
  };
}

// ─── script execution ───────────────────────────────────────────────────────

export interface ScriptRun {
  logs: LogEntry[];
  tests: TestResult[];
  error: string | null;
}

export function makeConsole(logs: LogEntry[]) {
  const push = (level: LogEntry['level']) => (...args: unknown[]) =>
    logs.push({ level, text: args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ') });
  const log = push('log');
  return {
    log, info: push('info'), warn: push('warn'), error: push('error'),
    debug: log, trace: log, dir: log,
    // Not a real table — but scripts that call it should log, not crash.
    table: (v: unknown) => logs.push({ level: 'log', text: safeStringify(v) }),
  };
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

// ─── pm.* (Postman) compatibility shim ──────────────────────────────────────

interface PmDeps {
  bru?: ReturnType<typeof makeBru>;
  req?: ReturnType<typeof makeReq>;
  res?: ReturnType<typeof makeRes>;
  expect: ReturnType<typeof makeExpect>;
  test: (name: string, fn: () => unknown) => Promise<void>;
}

// Maps Postman's `pm` API onto our bru/req/res primitives.
export function makePm({ bru, req, res, expect, test }: PmDeps) {
  const varBag = (get: (k: string) => unknown, set: (k: string, v: unknown) => void) => ({
    get, set,
    has: (k: string) => get(k) !== undefined,
    unset: (k: string) => set(k, ''),
  });
  const pm: Record<string, unknown> = {
    test,
    expect,
    info: { requestName: req?.getName?.() ?? '', requestId: '' },
    // pm.environment defaults to the collection-scoped env, same as a bare
    // bru.getEnvVar/setEnvVar call — Postman's own "environment" is the
    // one-active-set-at-a-time notion, and Collection env is the closer
    // analog of the two.
    environment: bru
      ? { ...varBag(bru.getEnvVar, bru.setEnvVar), name: bru.getEnvName(), replaceIn: (text: string) => bru.interpolate(text) }
      : undefined,
    // Collection/global variables have their own persisted stores — route
    // each to its own bucket.
    collectionVariables: bru ? { ...varBag(bru.getCollectionVar, bru.setCollectionVar) } : undefined,
    globals: bru
      ? { ...varBag((k) => bru.getEnvVar(k, 'global'), (k, v) => bru.setEnvVar(k, v, 'global')) }
      : undefined,
    iterationData: bru ? { get: (k: string) => bru.getIterationData(k) } : undefined,
    request: req,
    // Postman's current flow-control namespace. `skipRequest` isn't meaningful
    // once a request is already executing, so only setNextRequest is mapped.
    execution: bru ? { setNextRequest: (name: string | null) => bru.setNextRequest(name) } : undefined,
  };
  if (res) {
    const body = res.getBody();
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const code = res.getStatus();
    const inRange = (lo: number, hi: number) => expect(code >= lo && code <= hi).to.be.true;
    pm.response = {
      code,
      status: res.getStatusText(),
      responseTime: res.getResponseTime(),
      responseSize: text.length,
      json: () => body,
      text: () => text,
      size: () => ({ body: text.length }),
      headers: { get: (name: string) => res.getHeader(name), has: (name: string) => res.getHeader(name) !== undefined },
      // `pm.response.to.have.status(n)` helpers (evaluated lazily when called).
      to: {
        have: {
          status: (expected: number | string) =>
            typeof expected === 'number'
              ? expect(code).to.equal(expected)
              : expect(res.getStatusText()).to.equal(expected),
          header: (name: string, value?: string) => {
            const actual = res.getHeader(name);
            expect(actual, `expected header "${name}" to be present`).to.exist;
            return value === undefined ? expect(actual).to.exist : expect(actual).to.equal(value);
          },
          body: (expected?: string) => (expected === undefined ? expect(text).to.not.be.empty : expect(text).to.include(expected)),
          jsonBody: () => expect(typeof body === 'object' && body !== null).to.be.true,
        },
        get be() {
          return {
            get ok() { return inRange(200, 299); },
            get success() { return inRange(200, 299); },
            get redirection() { return inRange(300, 399); },
            get clientError() { return inRange(400, 499); },
            get serverError() { return inRange(500, 599); },
            get error() { return expect(code >= 400).to.be.true; },
            get accepted() { return expect(code).to.equal(202); },
            get badRequest() { return expect(code).to.equal(400); },
            get unauthorized() { return expect(code).to.equal(401); },
            get forbidden() { return expect(code).to.equal(403); },
            get notFound() { return expect(code).to.equal(404); },
          };
        },
      },
    };
  }
  return pm;
}

// Chai-style `assert`: callable, with the common named assertions attached so
// scripts written against Postman/Bruno's assert API don't hit `is not a function`.
export function makeAssert() {
  const fail = (message: string) => { throw new Error(message); };
  const ok = (cond: unknown, message = 'assertion failed') => { if (!cond) fail(message); };
  const show = (v: unknown) => { try { return JSON.stringify(v); } catch { return String(v); } };
  return Object.assign(ok, {
    ok,
    isOk: ok,
    isNotOk: (v: unknown, m = `expected ${show(v)} to be falsy`) => { if (v) fail(m); },
    fail: (m = 'assertion failed') => fail(m),
    equal: (a: unknown, b: unknown, m = `expected ${show(a)} to equal ${show(b)}`) => { if (a != b) fail(m); },
    notEqual: (a: unknown, b: unknown, m = `expected ${show(a)} to not equal ${show(b)}`) => { if (a == b) fail(m); },
    strictEqual: (a: unknown, b: unknown, m = `expected ${show(a)} to strictly equal ${show(b)}`) => { if (a !== b) fail(m); },
    notStrictEqual: (a: unknown, b: unknown, m = `expected ${show(a)} to not strictly equal ${show(b)}`) => { if (a === b) fail(m); },
    deepEqual: (a: unknown, b: unknown, m = `expected ${show(a)} to deeply equal ${show(b)}`) => { if (!deepEqual(a, b)) fail(m); },
    notDeepEqual: (a: unknown, b: unknown, m = `expected ${show(a)} to not deeply equal ${show(b)}`) => { if (deepEqual(a, b)) fail(m); },
    isTrue: (v: unknown, m = `expected ${show(v)} to be true`) => { if (v !== true) fail(m); },
    isFalse: (v: unknown, m = `expected ${show(v)} to be false`) => { if (v !== false) fail(m); },
    isNull: (v: unknown, m = `expected ${show(v)} to be null`) => { if (v !== null) fail(m); },
    isNotNull: (v: unknown, m = `expected ${show(v)} to not be null`) => { if (v === null) fail(m); },
    isUndefined: (v: unknown, m = `expected ${show(v)} to be undefined`) => { if (v !== undefined) fail(m); },
    isDefined: (v: unknown, m = 'expected value to be defined') => { if (v === undefined) fail(m); },
    exists: (v: unknown, m = 'expected value to exist') => { if (v == null) fail(m); },
    isArray: (v: unknown, m = `expected ${show(v)} to be an array`) => { if (!Array.isArray(v)) fail(m); },
    isString: (v: unknown, m = `expected ${show(v)} to be a string`) => { if (typeof v !== 'string') fail(m); },
    isNumber: (v: unknown, m = `expected ${show(v)} to be a number`) => { if (typeof v !== 'number') fail(m); },
    isBoolean: (v: unknown, m = `expected ${show(v)} to be a boolean`) => { if (typeof v !== 'boolean') fail(m); },
    isObject: (v: unknown, m = `expected ${show(v)} to be an object`) => { if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(m); },
    isFunction: (v: unknown, m = 'expected value to be a function') => { if (typeof v !== 'function') fail(m); },
    include: (haystack: unknown, needle: unknown, m = `expected ${show(haystack)} to include ${show(needle)}`) => {
      const has = Array.isArray(haystack) ? haystack.includes(needle)
        : typeof haystack === 'string' ? haystack.includes(String(needle)) : false;
      if (!has) fail(m);
    },
    match: (v: unknown, re: RegExp, m = `expected ${show(v)} to match ${re}`) => { if (!re.test(String(v))) fail(m); },
    lengthOf: (v: unknown, n: number, m = `expected length to be ${n}`) => { if ((v as { length?: number })?.length !== n) fail(m); },
    typeOf: (v: unknown, t: string, m = `expected ${show(v)} to be a ${t}`) => {
      const actual = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
      if (actual !== t) fail(m);
    },
  });
}

// Run a single user script with the given host objects in scope. Test results
// and console output accumulate into `out`; a thrown error stops that script.
export async function runScript(
  code: string,
  scope: Record<string, unknown>,
  out: ScriptRun,
): Promise<void> {
  if (!code.trim()) return;

  const tests: TestResult[] = out.tests;
  // A script that calls `test(...)` without awaiting it (the common style, and
  // what every Postman snippet does) leaves the assertion running after the
  // script body returns. Tracking the promises and settling them below is what
  // keeps async test results from being dropped or landing in a later request's
  // result list.
  const pending: Promise<void>[] = [];
  const test = (name: string, fn: () => unknown) => {
    const p = (async () => {
      try { await fn(); tests.push({ name, passed: true }); }
      catch (e) { tests.push({ name, passed: false, error: errText(e) }); }
    })();
    pending.push(p);
    return p;
  };
  const assert = makeAssert();

  const expect = makeExpect();
  const globals: Record<string, unknown> = {
    ...scope,
    expect,
    test,
    assert,
    require: requireModule,
    console: makeConsole(out.logs),
  };
  // Postman compatibility shim — maps `pm.*` onto the same primitives so many
  // imported Postman scripts run without rewriting.
  const bru = scope.bru as ReturnType<typeof makeBru> | undefined;
  globals.pm = makePm({
    bru,
    req: scope.req as ReturnType<typeof makeReq> | undefined,
    res: scope.res as ReturnType<typeof makeRes> | undefined,
    expect, test,
  });
  // Postman's pre-pm global, still the form most collection scripts use for
  // flow control: `postman.setNextRequest("Login")`.
  globals.postman = {
    setNextRequest: (name: string | null) => bru?.setNextRequest(name),
  };

  const names = Object.keys(globals);
  let fn: (...args: unknown[]) => Promise<unknown>;
  try {
    fn = new AsyncFunction(...names, code);
  } catch (e) {
    // A syntax error never reaches the runtime, so report it without a probe.
    out.error = `SyntaxError: ${errText(e)}`;
    return;
  }
  try {
    await fn(...names.map((n) => globals[n]));
  } catch (e) {
    out.error = await describeScriptError(e);
  } finally {
    // Settle in-flight tests either way, so a script that throws halfway still
    // reports the assertions that had already started.
    await Promise.all(pending);
  }
}

// ─── declarative-expression parser (used by Assert) ─────────────────────────

// Assert expressions are parsed, never evaluated. These fields are
// declarative — `res.body.token`, `res.body.items[0].id` — but they travel
// inside the collection file, so opening a collection someone sent you would
// otherwise run whatever they put in an Assert row. Earlier this was a
// `new Function(...)` with the dangerous globals shadowed out by extra
// parameters, which was defence in depth rather than a boundary:
// `({}).constructor.constructor` still reached Function and `eval` cannot be
// shadowed at all. The grammar below removes code construction entirely — it
// resolves property paths and at most one method call, so there is no string
// that becomes code. The Script tab is the deliberately powerful surface and is
// unaffected: `runScript` keeps its full sandbox, and the worker remains the
// real containment there — no DOM, no app storage, killable on timeout.
//
// The grammar covers what the tab is actually used for: paths, indices, method
// calls on the scope objects, literals, and the arithmetic/comparison/logical
// operators (`40 + 2`, `res.status === 200`). It deliberately stops short of
// assignment, `in`/`instanceof`, and free identifiers — anything not in it
// falls back to the literal string, as a parse error always did.

// Property keys that are never worth traversing from a collection file: they
// are the reachable route to Function and to Object.prototype.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Callables that turn data back into code. Unreachable via UNSAFE_KEYS today;
// refused here too so the property denylist is not the only thing standing
// between a collection file and an evaluator.
const UNSAFE_CALLEES: unknown[] = [
  Function, Function.prototype.call, Function.prototype.apply, Function.prototype.bind,
];

type Tok =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'name'; v: string }
  | { k: 'op'; v: string };

const PUNCT = [
  '===', '!==', '==', '!=', '<=', '>=', '&&', '||', '??',
  '.', '(', ')', '[', ']', ',', '!', '+', '-', '*', '/', '%', '<', '>',
];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "'" || ch === '"') {
      let out = '';
      let j = i + 1;
      for (; j < src.length && src[j] !== ch; j++) {
        if (src[j] === '\\') { out += src[++j] ?? ''; continue; }
        out += src[j];
      }
      if (j >= src.length) throw new Error('Unterminated string');
      toks.push({ k: 'str', v: out });
      i = j + 1;
      continue;
    }
    const num = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) { toks.push({ k: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const name = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i));
    if (name) { toks.push({ k: 'name', v: name[0] }); i += name[0].length; continue; }
    const op = PUNCT.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`Unexpected character ${ch}`);
    toks.push({ k: 'op', v: op });
    i += op.length;
  }
  return toks;
}

// Left-associative binary operators, tightest first. Deliberately no
// assignment, no comma, no `in`/`instanceof` — nothing that mutates or probes.
const BINOPS: Record<string, number> = {
  '*': 6, '/': 6, '%': 6,
  '+': 5, '-': 5,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '==': 3, '!=': 3, '===': 3, '!==': 3,
  '&&': 2, '||': 1, '??': 1,
};

function applyBinop(op: string, a: unknown, b: unknown): unknown {
  switch (op) {
    case '*': return (a as number) * (b as number);
    case '/': return (a as number) / (b as number);
    case '%': return (a as number) % (b as number);
    case '+': return (a as number) + (b as number);
    case '-': return (a as number) - (b as number);
    case '<': return (a as number) < (b as number);
    case '<=': return (a as number) <= (b as number);
    case '>': return (a as number) > (b as number);
    case '>=': return (a as number) >= (b as number);
    // eslint-disable-next-line eqeqeq
    case '==': return a == b;
    // eslint-disable-next-line eqeqeq
    case '!=': return a != b;
    case '===': return a === b;
    case '!==': return a !== b;
    default: throw new Error(`Unsupported operator ${op}`);
  }
}

// Reads a member key, refusing the ones that lead back to Function.
function member(obj: unknown, key: unknown): unknown {
  if (obj == null) throw new Error('Path access failed');
  const k = String(key);
  if (UNSAFE_KEYS.has(k)) throw new Error('Refused key');
  return (obj as Record<string, unknown>)[k];
}

// Recursive-descent evaluator over the token stream. It resolves values as it
// parses — there is no code-generation step at any point, which is the whole
// reason this exists rather than a `new Function(...)`.
class VarExprParser {
  private pos = 0;
  private depth = 0;
  // >0 while parsing the untaken side of a short-circuit: the tokens still have
  // to be consumed, but nothing is read or called.
  private skipping = 0;

  constructor(private toks: Tok[], private scope: Record<string, unknown>) {}

  private peek(): Tok | undefined { return this.toks[this.pos]; }

  private eatOp(v: string): boolean {
    const t = this.peek();
    if (t && t.k === 'op' && t.v === v) { this.pos++; return true; }
    return false;
  }

  private expectOp(v: string): void {
    if (!this.eatOp(v)) throw new Error(`Expected ${v}`);
  }

  parse(): unknown {
    const v = this.expr(0);
    if (this.pos !== this.toks.length) throw new Error('Trailing input');
    return v;
  }

  private expr(minPrec: number): unknown {
    if (++this.depth > 32) throw new Error('Expression too deep');
    try {
      let left = this.unary();
      for (;;) {
        const t = this.peek();
        if (!t || t.k !== 'op') break;
        const prec = BINOPS[t.v];
        if (prec === undefined || prec < minPrec) break;
        this.pos++;
        // Short-circuit the way JS does, so `res.body && res.body.token` is
        // safe on a missing body: the untaken side is parsed, not evaluated.
        const dead = this.skipping > 0
          || (t.v === '&&' && !left)
          || (t.v === '||' && !!left)
          || (t.v === '??' && left != null);
        if (dead) {
          this.skipping++;
          try { this.expr(prec + 1); } finally { this.skipping--; }
          continue;
        }
        const right = this.expr(prec + 1);
        left = t.v === '&&' || t.v === '||' || t.v === '??' ? right : applyBinop(t.v, left, right);
      }
      return left;
    } finally {
      this.depth--;
    }
  }

  private unary(): unknown {
    if (this.eatOp('!')) return !this.unary();
    if (this.eatOp('-')) return -(this.unary() as number);
    if (this.eatOp('+')) return +(this.unary() as number);
    return this.postfix();
  }

  private postfix(): unknown {
    let val = this.primary();
    // `receiver` tracks the object a method was read from, so a call binds
    // `this` correctly for `bru.getCollectionVar('x')` / `res.getStatus()`.
    let receiver: unknown = undefined;
    for (;;) {
      if (this.eatOp('.')) {
        const t = this.peek();
        if (!t || t.k !== 'name') throw new Error('Expected property name');
        this.pos++;
        receiver = val;
        val = this.skipping > 0 ? undefined : member(val, t.v);
      } else if (this.eatOp('[')) {
        const key = this.expr(0);
        this.expectOp(']');
        receiver = val;
        val = this.skipping > 0 ? undefined : member(val, key);
      } else if (this.eatOp('(')) {
        // A bare `foo()` has no receiver: every callable here is reached as a
        // method on a scope object, never as a free identifier.
        const live = this.skipping === 0;
        if (live) {
          if (receiver === undefined) throw new Error('Invalid callee');
          if (typeof val !== 'function') throw new Error('Not callable');
          if (UNSAFE_CALLEES.includes(val)) throw new Error('Refused callee');
        }
        const args: unknown[] = [];
        if (!this.eatOp(')')) {
          do { args.push(this.expr(0)); } while (this.eatOp(','));
          this.expectOp(')');
        }
        val = live ? (val as (...a: unknown[]) => unknown).apply(receiver, args) : undefined;
        receiver = undefined;
      } else {
        return val;
      }
    }
  }

  private primary(): unknown {
    const t = this.peek();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.k === 'num' || t.k === 'str') { this.pos++; return t.v; }
    if (t.k === 'name') {
      this.pos++;
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      if (t.v === 'null') return null;
      if (t.v === 'undefined') return undefined;
      // The root has to be a binding the scope actually owns. Reaching it
      // through the prototype chain would hand back Object.prototype members
      // (`toString`, `hasOwnProperty`) as if they were scope roots, and an
      // ambient worker global must never resolve at all.
      if (!Object.prototype.hasOwnProperty.call(this.scope, t.v)) {
        if (this.skipping > 0) return undefined;
        throw new Error('Unknown root');
      }
      return this.scope[t.v];
    }
    if (t.k === 'op' && t.v === '(') {
      this.pos++;
      const v = this.expr(0);
      this.expectOp(')');
      return v;
    }
    throw new Error(`Unexpected token ${t.v}`);
  }
}

// Evaluate an Assert expression. Supports property paths, indices, method
// calls on the scope objects, literals and the operators above. Anything
// outside that grammar falls back to the literal string, matching the previous
// evaluator's behaviour on a parse error.
function evalVarExpr(expr: string, scope: Record<string, unknown>): unknown {
  try {
    return new VarExprParser(tokenize(expr), scope).parse();
  } catch {
    return expr;
  }
}

// Exposed only for runtime.test.ts's direct coverage of the expression
// grammar/containment (the parser is otherwise only reached indirectly, via
// evalAssertions's operator comparisons).
export const __evalVarExpr = evalVarExpr;

// ─── declarative assertions ─────────────────────────────────────────────────

function coerce(raw: string): unknown {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t);
  return raw;
}

function isEmptyVal(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string' || Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

function isJsonVal(v: unknown): boolean {
  if (typeof v === 'object' && v !== null) return true;
  if (typeof v !== 'string') return false;
  try { JSON.parse(v); return true; } catch { return false; }
}

export function evalAssertions(
  assertions: Assertion[],
  scope: Record<string, unknown>,
): TestResult[] {
  const out: TestResult[] = [];
  for (const a of assertions) {
    if (!a.enabled || !a.expr.trim()) continue;
    const name = `${a.expr} ${a.operator} ${a.value}`;
    let actual: unknown;
    try {
      actual = evalVarExpr(a.expr, scope);
    } catch (e) {
      out.push({ name, passed: false, error: (e as Error).message });
      continue;
    }
    const expected = coerce(a.value);
    const list = () => a.value.split(',').map((s) => coerce(s.trim()));
    const str = String(actual);
    let passed = false;
    try {
      switch (a.operator) {
        case 'equals': passed = typeof expected === 'object' ? deepEqual(actual, expected) : actual == expected; break;
        case 'notEquals': passed = actual != expected; break;
        case 'gt': passed = Number(actual) > Number(expected); break;
        case 'gte': passed = Number(actual) >= Number(expected); break;
        case 'lt': passed = Number(actual) < Number(expected); break;
        case 'lte': passed = Number(actual) <= Number(expected); break;
        case 'in': passed = list().some((x) => x == actual); break;
        case 'notIn': passed = !list().some((x) => x == actual); break;
        case 'contains': passed = Array.isArray(actual) ? actual.includes(expected) : str.includes(String(expected)); break;
        case 'notContains': passed = Array.isArray(actual) ? !actual.includes(expected) : !str.includes(String(expected)); break;
        case 'length': passed = (actual as { length?: number })?.length === Number(expected); break;
        case 'matches': passed = new RegExp(a.value).test(str); break;
        case 'notMatches': passed = !new RegExp(a.value).test(str); break;
        case 'startsWith': passed = str.startsWith(a.value); break;
        case 'endsWith': passed = str.endsWith(a.value); break;
        case 'between': { const [lo, hi] = list(); passed = Number(actual) >= Number(lo) && Number(actual) <= Number(hi); break; }
        case 'isEmpty': passed = isEmptyVal(actual); break;
        case 'isNotEmpty': passed = !isEmptyVal(actual); break;
        case 'isNull': passed = actual === null; break;
        case 'isUndefined': passed = actual === undefined; break;
        case 'isDefined': passed = actual !== undefined; break;
        case 'isTruthy': passed = !!actual; break;
        case 'isFalsy': passed = !actual; break;
        case 'isJson': passed = isJsonVal(actual); break;
        case 'isNumber': passed = typeof actual === 'number' && !Number.isNaN(actual); break;
        case 'isString': passed = typeof actual === 'string'; break;
        case 'isBoolean': passed = typeof actual === 'boolean'; break;
        case 'isArray': passed = Array.isArray(actual); break;
      }
    } catch (e) {
      out.push({ name, passed: false, error: (e as Error).message });
      continue;
    }
    out.push({ name, passed, error: passed ? undefined : `expected ${safeStringify(actual)} ${a.operator} ${a.value}` });
  }
  return out;
}
