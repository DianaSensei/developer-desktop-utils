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
import { requireModule } from './modules';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as
  new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

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
  constructor(private actual: unknown, private negate = false) {}

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
  get not() { return new Expectation(this.actual, !this.negate); }

  private check(pass: boolean, msg: string, negMsg: string) {
    const ok = this.negate ? !pass : pass;
    if (!ok) throw new Error(this.negate ? negMsg : msg);
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
    const has = this.actual != null && Object.prototype.hasOwnProperty.call(this.actual, name);
    this.check(has, `expected object to have property "${name}"`, `expected object to not have property "${name}"`);
    if (has && arguments.length > 1) {
      const v = (this.actual as Record<string, unknown>)[name];
      this.check(deepEqual(v, value), `expected property "${name}" to equal ${this.show(value)}`, `expected property "${name}" to not equal ${this.show(value)}`);
    }
    return this;
  }

  // terminal getter-assertions
  get ok()        { this.check(!!this.actual, `expected ${this.show(this.actual)} to be truthy`, `expected ${this.show(this.actual)} to be falsy`); return this; }
  get true()      { this.check(this.actual === true, `expected ${this.show(this.actual)} to be true`, `expected ${this.show(this.actual)} to not be true`); return this; }
  get false()     { this.check(this.actual === false, `expected ${this.show(this.actual)} to be false`, `expected ${this.show(this.actual)} to not be false`); return this; }
  get null()      { this.check(this.actual === null, `expected ${this.show(this.actual)} to be null`, `expected ${this.show(this.actual)} to not be null`); return this; }
  get undefined() { this.check(this.actual === undefined, `expected ${this.show(this.actual)} to be undefined`, `expected value to be defined`); return this; }
  get exist()     { this.check(this.actual != null, `expected ${this.show(this.actual)} to exist`, `expected value to not exist`); return this; }
  get empty()     {
    const a = this.actual as { length?: number };
    const len = typeof a === 'object' && a !== null && !('length' in a) ? Object.keys(a).length : a?.length ?? 0;
    this.check(len === 0, `expected ${this.show(this.actual)} to be empty`, `expected ${this.show(this.actual)} to not be empty`);
    return this;
  }
}

export function makeExpect() {
  return (actual: unknown) => new Expectation(actual);
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
  const body = parseBody(res);
  return {
    status: res.status,
    statusText: res.statusText,
    headers,
    body,
    responseTime: res.timeMs,
    getStatus: () => res.status,
    getStatusText: () => res.statusText,
    getHeader: (name: string) => headers[name.toLowerCase()],
    getHeaders: () => headers,
    getBody: () => body,
    getResponseTime: () => res.timeMs,
  };
}

// `req` reads and mutates the request draft (a clone) before it is sent.
export function makeReq(draft: ApiRequest) {
  const findHeader = (name: string) => draft.headers.find((h) => h.key.toLowerCase() === name.toLowerCase());
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
      else draft.headers.push({ id: `s-${Date.now()}-${Math.random().toString(36).slice(2)}`, key: name, value: String(value), enabled: true });
    },
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

export interface VarStores {
  runtime: VarMap;   // bru.setVar / getVar  (mutated in place)
  env: VarMap;       // bru.setEnvVar / getEnvVar (mutated in place)
  envName: string | null;
  data?: VarMap;     // current data-file row (read-only; data-driven runs)
}

export function makeBru(stores: VarStores) {
  return {
    getVar: (k: string) => (k in stores.runtime ? stores.runtime[k] : stores.data?.[k]),
    setVar: (k: string, v: unknown) => { stores.runtime[k] = v == null ? '' : String(v); },
    deleteVar: (k: string) => { delete stores.runtime[k]; },
    hasVar: (k: string) => k in stores.runtime || (!!stores.data && k in stores.data),
    getEnvVar: (k: string) => stores.env[k],
    setEnvVar: (k: string, v: unknown) => { stores.env[k] = v == null ? '' : String(v); },
    getEnvName: () => stores.envName,
    // Postman parity: bru.getIterationData('x') reads the current data row.
    getIterationData: (k: string) => stores.data?.[k],
  };
}

// ─── script execution ───────────────────────────────────────────────────────

export interface ScriptRun {
  logs: LogEntry[];
  tests: TestResult[];
  error: string | null;
}

function makeConsole(logs: LogEntry[]) {
  const push = (level: LogEntry['level']) => (...args: unknown[]) =>
    logs.push({ level, text: args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ') });
  return { log: push('log'), info: push('info'), warn: push('warn'), error: push('error'), debug: push('log') };
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
function makePm({ bru, req, res, expect, test }: PmDeps) {
  const varBag = (get: (k: string) => unknown, set: (k: string, v: unknown) => void) => ({
    get, set,
    has: (k: string) => get(k) !== undefined,
    unset: (k: string) => set(k, ''),
  });
  const pm: Record<string, unknown> = {
    test,
    expect,
    info: { requestName: req?.getName?.() ?? '' },
    environment: bru ? varBag(bru.getEnvVar, bru.setEnvVar) : undefined,
    variables: bru ? varBag(bru.getVar, bru.setVar) : undefined,
    collectionVariables: bru ? varBag(bru.getVar, bru.setVar) : undefined,
    globals: bru ? varBag(bru.getVar, bru.setVar) : undefined,
    request: req,
  };
  if (res) {
    const body = res.getBody();
    pm.response = {
      code: res.getStatus(),
      status: res.getStatusText(),
      responseTime: res.getResponseTime(),
      json: () => body,
      text: () => (typeof body === 'string' ? body : JSON.stringify(body)),
      headers: { get: (name: string) => res.getHeader(name) },
      // `pm.response.to.have.status(n)` helper (evaluated lazily when called).
      to: {
        have: { status: (code: number) => expect(res.getStatus()).to.equal(code) },
        get be() {
          return {
            get ok() { return expect(res.getStatus() >= 200 && res.getStatus() < 300).to.be.true; },
          };
        },
      },
    };
  }
  return pm;
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
  const test = async (name: string, fn: () => unknown) => {
    try { await fn(); tests.push({ name, passed: true }); }
    catch (e) { tests.push({ name, passed: false, error: (e as Error).message }); }
  };
  const assert = (cond: unknown, message = 'assertion failed') => { if (!cond) throw new Error(message); };

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
  globals.pm = makePm({
    bru: scope.bru as ReturnType<typeof makeBru> | undefined,
    req: scope.req as ReturnType<typeof makeReq> | undefined,
    res: scope.res as ReturnType<typeof makeRes> | undefined,
    expect, test,
  });

  const names = Object.keys(globals);
  const fn = new AsyncFunction(...names, code);
  try {
    await fn(...names.map((n) => globals[n]));
  } catch (e) {
    out.error = (e as Error).message;
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
