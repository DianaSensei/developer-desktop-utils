// Scripting runtime — a Bruno-compatible JS sandbox.
//
// Pre-request and post-response scripts, the test runner, declarative vars, and
// declarative assertions all execute here. Scripts run via the AsyncFunction
// constructor inside the app's own JS context with a curated set of globals
// (`bru`, `req`, `res`, `expect`, `test`, `assert`, `console`). This is the same
// trust model as Postman/Bruno: the scripts are the user's own, run locally, and
// nothing is sent anywhere except the HTTP request itself.

import type {
  ApiRequest, ApiResponse, Assertion, LogEntry, TestResult, VarDef, VarMap,
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

function headersObject(pairs: [string, string][]): Record<string, string> {
  const obj: Record<string, string> = {};
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

export interface VarStores {
  runtime: VarMap;   // bru.setVar / getVar  (mutated in place)
  env: VarMap;       // bru.setEnvVar / getEnvVar (mutated in place)
  envName: string | null;
  data?: VarMap;     // current data-file row (read-only; data-driven runs)
  // Mutated by setNextRequest; read by the Runner after the request finishes.
  // Ignored for a single Send, where there is no sequence to steer.
  control?: RunControl;
  // Aborts when the user cancels the send, so a sleeping script stops promptly
  // instead of running on after the request it belongs to is gone.
  signal?: AbortSignal;
}

export function makeBru(stores: VarStores) {
  // Same precedence as the {{substitution}} map in engine.ts: env < data < runtime.
  const allVars = (): VarMap => ({ ...stores.env, ...(stores.data ?? {}), ...stores.runtime });
  return {
    getVar: (k: string) => (k in stores.runtime ? stores.runtime[k] : stores.data?.[k]),
    setVar: (k: string, v: unknown) => { stores.runtime[k] = v == null ? '' : String(v); },
    deleteVar: (k: string) => { delete stores.runtime[k]; },
    hasVar: (k: string) => k in stores.runtime || (!!stores.data && k in stores.data),
    getEnvVar: (k: string) => stores.env[k],
    setEnvVar: (k: string, v: unknown) => { stores.env[k] = v == null ? '' : String(v); },
    hasEnvVar: (k: string) => k in stores.env,
    deleteEnvVar: (k: string) => { delete stores.env[k]; },
    getEnvName: () => stores.envName,
    // Postman parity: bru.getIterationData('x') reads the current data row.
    getIterationData: (k: string) => stores.data?.[k],
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

// Maps Postman's `pm` API onto our bru/req/res primitives. Collection/global
// variables don't have separate stores here, so they alias the runtime vars.
export function makePm({ bru, req, res, expect, test }: PmDeps) {
  const varBag = (get: (k: string) => unknown, set: (k: string, v: unknown) => void) => ({
    get, set,
    has: (k: string) => get(k) !== undefined,
    unset: (k: string) => set(k, ''),
  });
  const variables = bru ? {
    ...varBag(bru.getVar, bru.setVar),
    // pm.variables.replaceIn('{{host}}/users') — resolve tokens in a string.
    replaceIn: (text: string) => bru.interpolate(text),
  } : undefined;
  const pm: Record<string, unknown> = {
    test,
    expect,
    info: { requestName: req?.getName?.() ?? '', requestId: '' },
    environment: bru
      ? { ...varBag(bru.getEnvVar, bru.setEnvVar), name: bru.getEnvName() }
      : undefined,
    variables,
    collectionVariables: variables,
    globals: variables,
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

// ─── declarative vars ───────────────────────────────────────────────────────

// Evaluate a Vars-tab expression. Tries JS evaluation (so `res.body.token` or
// `bru.getVar('x')` work); falls back to the literal string on parse error.
function evalVarExpr(expr: string, scope: Record<string, unknown>): unknown {
  const names = Object.keys(scope);
  try {
    const fn = new Function(...names, `return (${expr});`);
    return fn(...names.map((n) => scope[n]));
  } catch {
    return expr;
  }
}

export function applyVars(defs: VarDef[], stores: VarStores, scope: Record<string, unknown>): void {
  for (const d of defs) {
    if (!d.enabled || !d.name.trim()) continue;
    const val = evalVarExpr(d.value, scope);
    stores.runtime[d.name] = val == null ? '' : String(val);
  }
}

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
